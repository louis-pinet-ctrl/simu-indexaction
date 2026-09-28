// Fonction Edge « leads-site » v10
// Recoit les leads du site louispinetavocat.fr et les pousse dans Brevo.
//
// Quatre entrees :
//   1. Webhook Webflow form_submission  -> POST ?token=<WEBHOOK_TOKEN>
//   2. Simulateur de valorisation       -> POST ?src=simulateur
//   3. Formulaire newsletter            -> POST ?src=newsletter
//   4. Simulateur d'indexation          -> POST ?src=indexation
//
// La liste porte la relation, l'attribut ORIGINE porte le canal. Les leads du
// formulaire et de la newsletter vont dans la liste « Prospects », resolue par
// son nom.
// v6 : les leads du simulateur vont dans la seule liste « Simulateur Valo Resto ».
// Si cette liste est introuvable, le lead part dans « Prospects », par repli.
// v7 : le nom de la liste fait foi. Les variables BREVO_LISTE_* ne servent plus
// que si l'API Brevo est injoignable, pour eviter de viser une liste supprimee.
// v10 : source simulateur_indexation, liste « Simulateur Indexation Bail »
// (repli « Prospects »). Le payload porte bail_dossier, lu par le declencheur
// trg_rattacher_bail_au_lead.
//
// Deux attributs de tracage, jamais renseignes par le visiteur :
//   ORIGINE  : le dernier canal emprunte.
//   PARCOURS : tous les canaux empruntes, dans l'ordre, recalcules depuis la
//              table leads_site a chaque passage.
//
// La source newsletter est la seule a porter un consentement explicite : la case
// cochee et le libelle exact affiche sont conserves en base comme preuve.
//
// Minimisation : les donnees economiques des simulateurs restent dans Supabase.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ORIGINES_AUTORISEES = [
  "https://www.louispinetavocat.fr",
  "https://louispinetavocat.fr",
];

const BREVO = "https://api.brevo.com/v3";
const LISTE_CIBLE = "Prospects";
const LISTE_SIMULATEUR = "Simulateur Valo Resto";
const LISTE_INDEXATION = "Simulateur Indexation Bail";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") ?? "";
const WEBHOOK_TOKEN = Deno.env.get("WEBHOOK_TOKEN") ?? "";

// Le libelle lisible de chaque source, tel qu'il apparait dans Brevo.
const LIBELLE_SOURCE: Record<string, string> = {
  formulaire_contact: "Formulaire site",
  simulateur_valorisation: "Simulateur valorisation",
  simulateur_indexation: "Simulateur indexation",
  newsletter: "Newsletter",
};

type Lead = {
  source: "formulaire_contact" | "simulateur_valorisation" | "simulateur_indexation" | "newsletter";
  source_id: string | null;
  email: string;
  prenom: string | null;
  nom: string | null;
  telephone: string | null;
  profil_utilisateur: string | null;
  sujet: string | null;
  message: string | null;
  page_source: string | null;
  ca_n: number | null;
  ebe: number | null;
  loyer: number | null;
  segment: string | null;
  localisation: string | null;
  valorisation_basse: number | null;
  valorisation_med: number | null;
  valorisation_haute: number | null;
  consentement: boolean | null;
  consentement_texte: string | null;
  consentement_le: string | null;
  payload: Record<string, unknown>;
};

function entetesCors(origine: string | null) {
  const autorisee = origine && ORIGINES_AUTORISEES.includes(origine)
    ? origine
    : ORIGINES_AUTORISEES[0];
  return {
    "Access-Control-Allow-Origin": autorisee,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

function nombreOuNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function texteOuNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function emailValide(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}

function decouperNom(complet: string | null): { prenom: string | null; nom: string | null } {
  if (!complet) return { prenom: null, nom: null };
  const parties = complet.trim().split(/\s+/);
  if (parties.length === 1) return { prenom: null, nom: parties[0] };
  return { prenom: parties[0], nom: parties.slice(1).join(" ") };
}

// Brevo rejette l'attribut SMS si le numero n'est pas au format international.
function telephoneE164(brut: string | null): string | null {
  if (!brut) return null;
  let t = brut.replace(/[\s.\-()]/g, "");
  if (t.startsWith("00")) t = "+" + t.slice(2);
  if (/^0[1-9]\d{8}$/.test(t)) return "+33" + t.slice(1);
  if (/^\+33[1-9]\d{8}$/.test(t)) return t;
  if (/^\+\d{8,15}$/.test(t)) return t;
  return null;
}

function premiereValeur(data: Record<string, unknown>, cles: string[]): string | null {
  for (const cle of cles) {
    const trouve = Object.keys(data).find((k) => k.toLowerCase() === cle.toLowerCase());
    if (trouve) {
      const v = texteOuNull(data[trouve]);
      if (v) return v;
    }
  }
  return null;
}

const LEAD_VIDE = {
  profil_utilisateur: null, sujet: null, message: null,
  ca_n: null, ebe: null, loyer: null, segment: null, localisation: null,
  valorisation_basse: null, valorisation_med: null, valorisation_haute: null,
  consentement: null, consentement_texte: null, consentement_le: null,
};

function leadDepuisWebflow(corps: Record<string, any>): Lead | null {
  const p = corps.payload ?? corps;
  const data: Record<string, unknown> = p.data ?? p.formResponse ?? {};
  const email = premiereValeur(data, ["Email", "email", "E-mail", "Adresse email"]);
  if (!email) return null;
  const { prenom, nom } = decouperNom(premiereValeur(data, ["Name", "Nom", "Nom complet"]));
  return {
    ...LEAD_VIDE,
    source: "formulaire_contact",
    source_id: texteOuNull(p.id ?? p._id),
    email: email.toLowerCase(),
    prenom,
    nom,
    telephone: premiereValeur(data, ["Phone No", "Phone", "Telephone", "Téléphone"]),
    sujet: premiereValeur(data, ["Subject", "Sujet", "Objet"]),
    message: premiereValeur(data, ["Your Message", "Message", "Field", "Votre message"]),
    page_source: texteOuNull(p.publishedPath ?? p.pageId) ?? texteOuNull(p.name),
    payload: { formulaire: texteOuNull(p.name), champs: data },
  };
}

function leadDepuisSimulateur(corps: Record<string, any>): Lead | null {
  const email = texteOuNull(corps.email);
  if (!email) return null;
  return {
    ...LEAD_VIDE,
    source: "simulateur_valorisation",
    source_id: null,
    email: email.toLowerCase(),
    prenom: texteOuNull(corps.prenom),
    nom: texteOuNull(corps.nom),
    telephone: texteOuNull(corps.telephone),
    profil_utilisateur: texteOuNull(corps.profil_utilisateur),
    page_source: "/simulateur-valorisation",
    ca_n: nombreOuNull(corps.ca_n),
    ebe: nombreOuNull(corps.ebe),
    loyer: nombreOuNull(corps.loyer),
    segment: texteOuNull(corps.segment),
    localisation: texteOuNull(corps.localisation),
    valorisation_basse: nombreOuNull(corps.valorisation_basse ?? corps.basse),
    valorisation_med: nombreOuNull(corps.valorisation_med ?? corps.med),
    valorisation_haute: nombreOuNull(corps.valorisation_haute ?? corps.haute),
    payload: corps,
  };
}

// Simulateur d'indexation : le loyer paye, le chiffre d'affaires s'il est saisi,
// et le reste du calcul dans payload (bail_dossier compris, pour le rattachement du bail).
function leadDepuisIndexation(corps: Record<string, any>): Lead | null {
  const email = texteOuNull(corps.email);
  if (!email) return null;
  return {
    ...LEAD_VIDE,
    source: "simulateur_indexation",
    source_id: null,
    email: email.toLowerCase(),
    prenom: texteOuNull(corps.prenom),
    nom: texteOuNull(corps.nom),
    telephone: texteOuNull(corps.telephone),
    profil_utilisateur: texteOuNull(corps.profil_utilisateur),
    page_source: "/simulateur-indexation",
    ca_n: nombreOuNull(corps.ca),
    loyer: nombreOuNull(corps.loyer),
    payload: corps,
  };
}

function leadDepuisNewsletter(corps: Record<string, any>): Lead | null {
  const email = texteOuNull(corps.email);
  if (!email || !emailValide(email)) return null;
  // Sans case cochee, pas d'inscription : la finalite serait sans base.
  if (corps.consentement !== true) return null;
  const { prenom, nom } = decouperNom(texteOuNull(corps.nom_complet));
  return {
    ...LEAD_VIDE,
    source: "newsletter",
    source_id: null,
    email: email.toLowerCase(),
    prenom: texteOuNull(corps.prenom) ?? prenom,
    nom: texteOuNull(corps.nom) ?? nom,
    telephone: null,
    profil_utilisateur: texteOuNull(corps.profil_utilisateur),
    page_source: texteOuNull(corps.page) ?? "/newsletter",
    consentement: true,
    consentement_texte: texteOuNull(corps.consentement_texte),
    consentement_le: new Date().toISOString(),
    payload: corps,
  };
}

const entetesBrevo = {
  "api-key": BREVO_API_KEY,
  "content-type": "application/json",
  accept: "application/json",
};

// Resolution des listes par leur nom, tel qu'il apparait dans Brevo : le compte
// fait foi, aucun identifiant a maintenir a la main. Les listes lues sont mises
// en cache pour la duree de l'instance.
let listesBrevo: Array<{ id: number; name: string }> | null = null;

async function chargerListes(): Promise<Array<{ id: number; name: string }> | null> {
  if (listesBrevo) return listesBrevo;
  try {
    const r = await fetch(`${BREVO}/contacts/lists?limit=50&offset=0`, {
      headers: { "api-key": BREVO_API_KEY, accept: "application/json" },
    });
    if (!r.ok) return null;
    const d = await r.json().catch(() => null);
    const lues = ((d && d.lists) || [])
      .filter((l: any) => l && typeof l.id === "number" && l.name)
      .map((l: any) => ({ id: l.id as number, name: String(l.name) }));
    if (!lues.length) return null;
    listesBrevo = lues;
    return listesBrevo;
  } catch {
    return null;
  }
}

async function idListeParNom(nomListe: string, variableSecrete: string): Promise<number | null> {
  const cle = nomListe.toLowerCase();
  const listes = await chargerListes();
  if (listes) {
    const trouvee = listes.find((l) => l.name.toLowerCase() === cle);
    if (trouvee) return trouvee.id;
    // La liste n'existe pas (ou a ete renommee) : ne jamais viser un identifiant
    // devine, sous peine de creer un contact sans liste.
    console.error(`liste « ${nomListe} » absente du compte Brevo`);
    return null;
  }
  // Repli uniquement si Brevo est injoignable.
  const secret = Number(Deno.env.get(variableSecrete) ?? "0");
  return secret ? secret : null;
}

async function idListeProspects(): Promise<number | null> {
  return await idListeParNom(LISTE_CIBLE, "BREVO_LISTE_PROSPECTS");
}

async function idListeSimulateur(): Promise<number | null> {
  try {
    return await idListeParNom(LISTE_SIMULATEUR, "BREVO_LISTE_SIMULATEUR");
  } catch {
    return null;
  }
}

async function idListeIndexation(): Promise<number | null> {
  try {
    return await idListeParNom(LISTE_INDEXATION, "BREVO_LISTE_INDEXATION");
  } catch {
    return null;
  }
}

// L'attribut PARCOURS est cree au premier besoin, une seule fois par instance.
let parcoursDisponible: boolean | null = null;

async function assurerAttributParcours(): Promise<boolean> {
  if (parcoursDisponible !== null) return parcoursDisponible;
  try {
    const r = await fetch(`${BREVO}/contacts/attributes`, { headers: entetesBrevo });
    if (!r.ok) { parcoursDisponible = false; return false; }
    const d = await r.json().catch(() => null);
    const existe = ((d && d.attributes) || [])
      .some((a: any) => String(a.name).toUpperCase() === "PARCOURS");
    if (existe) { parcoursDisponible = true; return true; }
    const c = await fetch(`${BREVO}/contacts/attributes/normal/PARCOURS`, {
      method: "POST",
      headers: entetesBrevo,
      body: JSON.stringify({ type: "text" }),
    });
    parcoursDisponible = c.ok || c.status === 204;
  } catch {
    parcoursDisponible = false;
  }
  return parcoursDisponible;
}

// Le parcours se lit dans la table, pas dans Brevo : la base garde l'historique
// complet de chaque adresse, y compris les passages anterieurs a cet attribut.
async function parcoursDepuisBase(supabase: any, email: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("leads_site")
    .select("source, recu_le")
    .eq("email", email)
    .order("recu_le", { ascending: true });
  if (error || !data) return null;
  const vus: string[] = [];
  for (const l of data) {
    const libelle = LIBELLE_SOURCE[l.source as string];
    if (libelle && !vus.includes(libelle)) vus.push(libelle);
  }
  return vus.length ? vus.join(" + ") : null;
}

async function pousserDansBrevo(lead: Lead, origine: string, parcours: string | null) {
  if (!BREVO_API_KEY) return { ok: false, erreur: "BREVO_API_KEY absente", liste: null };

  // Chaque simulateur a sa propre liste. Les autres sources restent sur « Prospects ».
  let listeId: number | null = null;
  if (lead.source === "simulateur_valorisation") listeId = await idListeSimulateur();
  if (lead.source === "simulateur_indexation") listeId = await idListeIndexation();
  if (!listeId) listeId = await idListeProspects();
  if (!listeId) {
    return { ok: false, erreur: `liste « ${LISTE_CIBLE} » introuvable dans Brevo`, liste: null };
  }
  const listes: number[] = [listeId];

  const base: Record<string, string> = { ORIGINE: origine };
  if (lead.prenom) base.PRENOM = lead.prenom;
  if (lead.nom) base.NOM = lead.nom;
  if (lead.profil_utilisateur) base.JOB_TITLE = lead.profil_utilisateur;

  const sms = telephoneE164(lead.telephone);
  const trace = parcours && (await assurerAttributParcours()) ? parcours : null;

  const envoyer = async (avecSms: boolean, avecParcours: boolean) => {
    const attributs: Record<string, string> = { ...base };
    if (avecSms && sms) attributs.SMS = sms;
    if (avecParcours && trace) attributs.PARCOURS = trace;
    return await fetch(`${BREVO}/contacts`, {
      method: "POST",
      headers: entetesBrevo,
      body: JSON.stringify({
        email: lead.email,
        attributes: attributs,
        listIds: listes,
        updateEnabled: true,
      }),
    });
  };

  // Degradation progressive : un attribut refuse ne doit jamais couter le lead.
  const tentatives: Array<[boolean, boolean]> = [[true, true], [false, true], [true, false], [false, false]];
  let reponse: Response | null = null;
  const deja = new Set<string>();

  for (const [avecSms, avecParcours] of tentatives) {
    const cle = `${avecSms && !!sms}|${avecParcours && !!trace}`;
    if (deja.has(cle)) continue;
    deja.add(cle);
    reponse = await envoyer(avecSms, avecParcours);
    if (reponse.ok || reponse.status === 204) return { ok: true, erreur: null, liste: listeId };
  }

  const detail = reponse ? await reponse.text().catch(() => "") : "";
  const statut = reponse ? reponse.status : 0;
  return { ok: false, erreur: `HTTP ${statut} ${detail}`.slice(0, 500), liste: listeId };
}

Deno.serve(async (req: Request) => {
  const origineHttp = req.headers.get("origin");
  const cors = entetesCors(origineHttp);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ erreur: "methode non autorisee" }), { status: 405, headers: cors });
  }

  const url = new URL(req.url);
  const src = url.searchParams.get("src");
  const token = url.searchParams.get("token");

  let corps: Record<string, any>;
  try {
    corps = await req.json();
  } catch {
    return new Response(JSON.stringify({ erreur: "corps JSON illisible" }), { status: 400, headers: cors });
  }

  const depuisNavigateur = src === "simulateur" || src === "newsletter" || src === "indexation";
  const estWebflow = !depuisNavigateur &&
    (typeof corps.triggerType === "string" || corps.payload?.data !== undefined);

  let lead: Lead | null;
  let origineLead: string;

  if (estWebflow) {
    if (!WEBHOOK_TOKEN || token !== WEBHOOK_TOKEN) {
      return new Response(JSON.stringify({ erreur: "jeton invalide" }), { status: 401, headers: cors });
    }
    if (corps.triggerType && corps.triggerType !== "form_submission") {
      return new Response(JSON.stringify({ ignore: corps.triggerType }), { status: 200, headers: cors });
    }
    lead = leadDepuisWebflow(corps);
    origineLead = "Formulaire site";
  } else {
    if (!origineHttp || !ORIGINES_AUTORISEES.includes(origineHttp)) {
      return new Response(JSON.stringify({ erreur: "origine non autorisee" }), { status: 403, headers: cors });
    }
    if (src === "newsletter") {
      lead = leadDepuisNewsletter(corps);
      origineLead = "Newsletter";
      if (!lead) {
        return new Response(
          JSON.stringify({ erreur: "adresse invalide ou consentement absent" }),
          { status: 400, headers: cors },
        );
      }
    } else if (src === "indexation") {
      lead = leadDepuisIndexation(corps);
      origineLead = "Simulateur indexation";
    } else {
      lead = leadDepuisSimulateur(corps);
      origineLead = "Simulateur valorisation";
    }
  }

  if (!lead) {
    return new Response(JSON.stringify({ erreur: "email absent" }), { status: 400, headers: cors });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  const { data: ligne, error: erreurInsert } = await supabase
    .from("leads_site")
    .upsert({ ...lead }, { onConflict: "source_id", ignoreDuplicates: false })
    .select("id")
    .maybeSingle();

  if (erreurInsert) {
    console.error("insertion leads_site", erreurInsert);
    return new Response(JSON.stringify({ erreur: "insertion impossible" }), { status: 500, headers: cors });
  }

  // Apres l'insertion : le passage en cours fait partie du parcours.
  const parcours = await parcoursDepuisBase(supabase, lead.email);

  const resultat = await pousserDansBrevo(lead, origineLead, parcours);

  if (ligne?.id) {
    await supabase
      .from("leads_site")
      .update({
        brevo_statut: resultat.ok ? "synchronise" : "erreur",
        brevo_erreur: resultat.erreur,
        brevo_liste_id: resultat.liste,
        brevo_synchronise_le: resultat.ok ? new Date().toISOString() : null,
      })
      .eq("id", ligne.id);
  }

  return new Response(
    JSON.stringify({ ok: true, id: ligne?.id ?? null, brevo: resultat.ok, origine: origineLead, parcours }),
    { status: 200, headers: cors },
  );
});

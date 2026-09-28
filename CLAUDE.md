# Simulateur d'indexation du loyer commercial

Même architecture que `simu-valo-chr` (simulateur de valorisation), appliquée au bail commercial.

## Structure

- `index.html` : page autonome (GitHub Pages) = HTML du simulateur + `simu.css` + `indices.js` + `simu.js`.
- `simu.css` : styles scopés sous `#simu-index`, jetons du design system « Louis Pinet Avocat » (Nunito, Lora pour le seul monogramme, `surface-100`, `ink`, `accent`, aucun arrondi, aucune ombre). Le bloc de rendez-vous suit la charte des blocs embed (fond sombre, terracotta).
- `indices.js` : séries ILC, ILAT, ICC par trimestre (`window.INDICES`). Source unique : avis INSEE publiés au Journal officiel.
- `simu.js` : moteur de calcul (indexations, bouclier PME, clause tunnel, échéances, prescription, intérêts, dépôt de garantie), contrôles juridiques, courriers, envoi du lead.
- `webflow-embed.html` : bloc à coller dans l'Embed Webflow. Généré par `python3 build_embed.py`. À recoller seulement quand le HTML change.
- `tests/calcul.test.js` : contrôle du moteur, 21 tests (`node tests/calcul.test.js`).
- `supabase/functions/` : sources des fonctions Edge déployées (`lecture-bail`, `leads-site`). `supabase/migrations/` : copie des migrations appliquées.

## Ce que le simulateur sait faire

- Date de première indexation libre (`premiere_index`, proposée un an après la prise d'effet) : les indexations suivantes tombent à la même date, chaque année ou tous les trois ans.
- Indice de comparaison : même trimestre un an plus tard (`comp_mode=meme`) ou dernier indice publié à la date d'indexation (`comp_mode=dernier`, publication supposée vers le 20 du dernier mois du trimestre suivant).
- Distorsion : à chaque indexation, le moteur compare les mois d'indice aux mois de loyer ; si l'indice couvre plus, alerte « réputé non écrit » (L. 112-1 CMF). Le calcul applique la clause telle qu'écrite.
- Sens de la clause : symétrique, hausse seule, plancher (jamais sous le loyer initial), tunnel, hausse forfaitaire. Hausse seule et plancher sont traités comme réputés non écrits pour la seule stipulation prohibée.
- Historique de paiement : loyer actuel depuis une date, plus des paliers antérieurs (`#paliers`). Avant le plus ancien palier, le loyer payé est supposé conforme à la clause telle qu'appliquée.
- Dépôt de garantie : complément dû si le bail l'indexe ; alerte si un bail conclu ou renouvelé depuis le 28/05/2026 dépasse un trimestre (L. 145-40).
- Intérêts au taux légal : échéance par échéance, depuis la mise en demeure ou l'échéance si elle est postérieure, taux « personne physique » ou « autres cas » selon le bailleur, intérêts simples. Série `TAUX_LEGAL` dans `simu.js`, à partir de 2024.
- Alerte d'indices périmés : si le dernier trimestre publié d'après le calendrier INSEE n'est pas dans `indices.js`, un bandeau le signale.
- Taux d'effort avant et après rattrapage (loyer HT ÷ CA HT), qualification de l'ampleur (repères du cabinet, non juridiques).

## Mise à jour trimestrielle des indices

Chaque trimestre, l'INSEE publie ILC, ILAT et ICC (fin mars, fin juin, fin septembre, fin décembre), puis l'avis paraît au Journal officiel.
1. Rechercher au JORF « Avis relatif à l'indice des loyers commerciaux du … trimestre » (idem ILAT, ICC).
2. Ajouter la valeur dans `indices.js` et mettre à jour `maj`.
3. Lancer `node tests/calcul.test.js`, puis merger sur `main` : aucun recollage Webflow nécessaire.

## Mise à jour semestrielle du taux de l'intérêt légal

L'arrêté fixant le taux paraît au JO fin décembre et fin juin. Ajouter une entrée `{debut:'AAAA-01-01' ou 'AAAA-07-01', pp, autres}` à `TAUX_LEGAL` dans `simu.js` (`pp` = créancier personne physique n'agissant pas pour des besoins professionnels), puis lancer les tests. Valeurs intégrées : 2024 S1 8,01/5,07 ; 2024 S2 8,16/4,92 ; 2025 S1 7,21/3,71 ; 2025 S2 6,65/2,76 ; 2026 S1 6,67/2,62 ; 2026 S2 6,84/2,75.

## Règles de fond appliquées (vérifiées sur Légifrance le 28/09/2026)

- Hausse forfaitaire automatique sans plafond ni durée : réputée non écrite (Cass. 3e civ., 3 sept. 2026, n° 25-14.904, FS-B). Divisibilité confirmée : 4 juil. 2024 n° 23-13.285, 22 mai 2025 n° 23-23.336, 18 déc. 2025 n° 24-12.218.
- Indexation : art. L.112-1 et L.112-2 CMF ; clause à la hausse seule réputée non écrite, seule la stipulation prohibée tombe (Cass. 3e civ., 12 janv. 2022, n° 21-11.169). Clause plancher (loyer jamais inférieur au loyer initial) : même sort (Cass. 3e civ., 25 janv. 2023, n° 20-20.514, F-D, §5-6 et 11). Distorsion : période de variation de l'indice supérieure à la durée entre deux révisions (L. 112-1 al. 2 CMF).
- Clause tunnel symétrique sur l'ILC : art. L.145-38-1 C. com. (loi n° 2026-403 du 26 mai 2026, art. 62, en vigueur le 28/05/2026). Pas de disposition transitoire pour cet article : le II A de l'art. 62 (baux en cours) vise le 2° du I, soit L.145-32-1 (paiement mensuel), cf. nota Légifrance de L.145-32-1 ; les B à D visent le 4°, soit L.145-40 (dépôt de garantie, un trimestre au plus pour les locaux L.145-32-1, baux conclus ou renouvelés depuis le 28/05/2026).
- Bouclier ILC 3,5 % pour les PME, T2 2022 à T1 2024, définitivement acquis : loi n° 2022-1158, art. 14.
- Rattrapage : prescription quinquennale par échéance (art. 2224 C. civ.). Intérêts : art. 1344-1 (mise en demeure), 1343-2 (pas de capitalisation sans stipulation ou demande), taux fixé par arrêté (art. L. 313-2 CMF).
- Restitution au preneur : action en réputé non écrit imprescriptible, restitution sur 5 ans calculée sur le loyer non indexé (Cass. 3e civ., 23 janv. 2025, n° 23-18.643).
- Révision : art. L.145-38 (triennale) et L.145-39 (variation de plus d'un quart, lissage 10 %).

## Lead

`simu.js` poste vers la fonction Edge Supabase `leads-site?src=indexation` (source `simulateur_indexation`, page `/simulateur-indexation`). Version en production : v10, déployée le 28/09/2026, source dans `supabase/functions/leads-site/index.ts`. La contrainte `leads_site_source_check` accepte `simulateur_indexation` (migration `20260928_lectures_bail_journal.sql`). Liste Brevo attendue : « Simulateur Indexation Bail », à créer ; sans elle, le contact est créé sans liste. Le payload porte les données du calcul (première indexation, mode de comparaison, paliers, dépôt, mise en demeure, distorsion, intérêts, rattrapage, prescrit) et `bail_dossier` si un bail a été conservé.

## Lecture automatique du bail

- Fonction Edge Supabase `lecture-bail` v4 (source : `supabase/functions/lecture-bail/index.ts`), déployée le 28/09/2026, `verify_jwt` activé : le navigateur envoie la clé publique `anon` (JWT hérité). Si les clés héritées sont désactivées dans Supabase, la lecture s'arrête : passer alors `verify_jwt` à false, la fonction contrôlant déjà l'origine, ou envoyer un autre JWT.
- Modèle `claude-opus-5-5`, sortie JSON contrainte par schéma, repli automatique `fallbacks: "default"` en cas de refus. Champs lus : date d'effet, loyer, indice, indice de base, périodicité, date de première indexation, indice de comparaison, sens (dont plancher), taux, jeu, échéances, dépôt de garantie et son indexation.
- Secret à créer dans Supabase : `ANTHROPIC_API_KEY`. Sans lui, la fonction répond 503 et le simulateur invite à remplir à la main.
- Garde-fous : origines autorisées (site et GitHub Pages), 3 fichiers et 10 Mo au plus, 5 lectures par IP et par heure comptées dans `lectures_bail_journal` (IP hachée, purge quotidienne à deux jours), consentement obligatoire, contenu jamais journalisé.
- Conservation (case facultative distincte) : fichiers dans l'espace privé `baux-deposes` (`AAAA/MM/<dossier>/`), une ligne par fichier dans `baux_deposes` avec le texte du consentement, l'extraction et `supprimer_apres` = +12 mois. Migration : `supabase/migrations/20260928_baux_deposes.sql`.
- Rattachement : le lead porte `payload.bail_dossier` ; le déclencheur `trg_rattacher_bail_au_lead` remplit `lead_id` et `email`. Vue de travail : `v_baux_deposes`.
- Purge : à chaque appel, la fonction supprime les baux échus (50 au plus), sauf `conserver_client = true` (à cocher quand le visiteur devient client).
- Demande de suppression : supprimer le fichier dans Storage puis la ligne dans `baux_deposes`.
- Limites connues : durée d'exécution des fonctions Edge (un bail scanné de 100 pages peut dépasser le délai), taille de requête (10 Mo de fichiers, soit 13,4 Mo en base64).
- Chaque valeur renvoyée porte l'extrait du bail et sa page ; le visiteur valide ou corrige avant de poursuivre.
- RGPD : mentionner ce traitement (sous-traitant Anthropic) dans la politique de confidentialité du site et le registre des traitements.

## Limites assumées du calcul

- Le loyer payé avant le plus ancien palier saisi est supposé conforme à la clause telle qu'appliquée : aucun rappel n'est chiffré sur cette période.
- Les intérêts sont simples et partent au plus tôt du 1er janvier 2024 (première entrée de `TAUX_LEGAL`).
- Le complément de dépôt suppose un dépôt fixé sur le loyer de référence.
- La distorsion est signalée mais le loyer dû reste calculé selon la clause : l'étendue du réputé non écrit se plaide.

# Simulateur d'indexation du loyer commercial

Même architecture que `simu-valo-chr` (simulateur de valorisation), appliquée au bail commercial.

## Structure

- `index.html` : page autonome (GitHub Pages) = HTML du simulateur + `simu.css` + `indices.js` + `simu.js`.
- `simu.css` : styles scopés sous `#simu-index`, jetons du design system « Louis Pinet Avocat » (Nunito, Lora pour le seul monogramme, `surface-100`, `ink`, `accent`, aucun arrondi, aucune ombre). Le bloc de rendez-vous suit la charte des blocs embed (fond sombre, terracotta).
- `indices.js` : séries ILC, ILAT, ICC par trimestre (`window.INDICES`). Source unique : avis INSEE publiés au Journal officiel.
- `simu.js` : moteur de calcul (indexations, bouclier PME, clause tunnel, échéances, prescription), contrôles juridiques, courriers, envoi du lead.
- `webflow-embed.html` : bloc à coller dans l'Embed Webflow. Généré par `python3 build_embed.py`. À recoller seulement quand le HTML change.
- `tests/calcul.test.js` : contrôle du moteur (`node tests/calcul.test.js`).

## Mise à jour trimestrielle des indices

Chaque trimestre, l'INSEE publie ILC, ILAT et ICC (fin mars, fin juin, fin septembre, fin décembre), puis l'avis paraît au Journal officiel.
1. Rechercher au JORF « Avis relatif à l'indice des loyers commerciaux du … trimestre » (idem ILAT, ICC).
2. Ajouter la valeur dans `indices.js` et mettre à jour `maj`.
3. Lancer `node tests/calcul.test.js`, puis merger sur `main` : aucun recollage Webflow nécessaire.

## Règles de fond appliquées (vérifiées sur Légifrance le 28/09/2026)

- Hausse forfaitaire automatique sans plafond ni durée : réputée non écrite (Cass. 3e civ., 3 sept. 2026, n° 25-14.904, FS-B). Divisibilité confirmée : 4 juil. 2024 n° 23-13.285, 22 mai 2025 n° 23-23.336, 18 déc. 2025 n° 24-12.218.

- Indexation : art. L.112-1 et L.112-2 CMF ; clause à la hausse seule réputée non écrite, seule la stipulation prohibée tombe (Cass. 3e civ., 12 janv. 2022, n° 21-11.169).
- Clause tunnel symétrique sur l'ILC : art. L.145-38-1 C. com. (loi n° 2026-403 du 26 mai 2026, en vigueur le 28/05/2026).
- Bouclier ILC 3,5 % pour les PME, T2 2022 à T1 2024, définitivement acquis : loi n° 2022-1158, art. 14.
- Rattrapage : prescription quinquennale par échéance (art. 2224 C. civ.).
- Restitution au locataire : action en réputé non écrit imprescriptible, restitution sur 5 ans calculée sur le loyer non indexé (Cass. 3e civ., 23 janv. 2025, n° 23-18.643).
- Révision : art. L.145-38 (triennale) et L.145-39 (variation de plus d'un quart, lissage 10 %).

## Lead

`simu.js` poste vers la fonction Edge Supabase `leads-site?src=indexation`. La version en production (v9) ne connaît pas cette source : voir `supabase/leads-site-indexation.md` avant de déployer.

## Lecture automatique du bail

- Fonction Edge Supabase `lecture-bail` v2 (source : `supabase/functions/lecture-bail/index.ts`), déployée le 28/09/2026, `verify_jwt` activé : le navigateur envoie la clé publique `anon`.
- Modèle `claude-opus-5-5`, sortie JSON contrainte par schéma, repli automatique `fallbacks: "default"` en cas de refus.
- Secret à créer dans Supabase : `ANTHROPIC_API_KEY`. Sans lui, la fonction répond 503 et le simulateur invite à remplir à la main.
- Garde-fous : origines autorisées (site et GitHub Pages), 3 fichiers et 10 Mo au plus, 5 lectures par IP et par heure, consentement obligatoire, contenu jamais journalisé.
- Conservation (case facultative distincte) : fichiers dans l'espace privé `baux-deposes` (`AAAA/MM/<dossier>/`), une ligne par fichier dans `baux_deposes` avec le texte du consentement, l'extraction et `supprimer_apres` = +12 mois. Migration : `supabase/migrations/20260928_baux_deposes.sql`.
- Rattachement : le lead porte `payload.bail_dossier` ; le déclencheur `trg_rattacher_bail_au_lead` remplit `lead_id` et `email`. Vue de travail : `v_baux_deposes`.
- Purge : à chaque appel, la fonction supprime les baux échus (50 au plus), sauf `conserver_client = true` (à cocher quand le visiteur devient client).
- Demande de suppression : supprimer le fichier dans Storage puis la ligne dans `baux_deposes`.
- Chaque valeur renvoyée porte l'extrait du bail et sa page ; le visiteur valide ou corrige avant de poursuivre.
- RGPD : mentionner ce traitement (sous-traitant Anthropic) dans la politique de confidentialité du site et le registre des traitements.

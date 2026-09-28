# Brancher le simulateur d'indexation sur `leads-site`

État au 28/09/2026 : la fonction `leads-site` (v9) accepte `src=simulateur` et `src=newsletter`.
Un appel `src=indexation` passe aujourd'hui dans la branche « simulateur de valorisation » : le lead serait enregistré avec la source `simulateur_valorisation`, la page `/simulateur-valorisation` et la liste Brevo « Simulateur Valo Resto ».

Modifications proposées, **non déployées** (à valider par Louis Pinet) :

1. `depuisNavigateur` : ajouter `src === "indexation"`.
2. Nouvelle source `simulateur_indexation`, libellé « Simulateur indexation » dans `LIBELLE_SOURCE`.
3. Fonction `leadDepuisIndexation(corps)` : comme `leadDepuisSimulateur`, avec `page_source: "/simulateur-indexation"`, `loyer: corps.loyer`, le reste dans `payload`.
4. Liste Brevo dédiée (par exemple « Simulateur Indexation Bail »), repli sur « Prospects ».
5. Vérifier la contrainte `CHECK` éventuelle sur `leads_site.source` et l'étendre à `simulateur_indexation` par migration.

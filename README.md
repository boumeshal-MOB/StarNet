# BTM — Topographic Adjustment Processing (interactive mockup)

Maquette web complète et **réellement calculante** du futur module *Topographic Adjustment
Processing* de BlueTrust Monitoring : ajustement 3D par moindres carrés pondérés
(Gauss-Newton + QR rank-revealing) exécuté localement dans un Web Worker, données ATS34
préchargées comme si elles venaient de la base BTM, versionnement intégral des configurations
et des résultats, Analysis Lab, catch-up et reprocessing historique.

Aucun backend, aucun Star*Net, aucun import de fichier dans le parcours utilisateur.

## Démarrage

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # 39 tests : corrections, χ², QR/covariance, identité des points, moteur (synthétique + données réelles)
npm run build        # build production (tsc + vite)
```

Au premier lancement, trois processings sont seedés depuis la base simulée : le réseau
synthétique 3 stations (scénarios réseau), un mono-station synthétique, et le processing
**données réelles** NTE_ATS34 issu du classeur. La persistance est en IndexedDB ;
« Reset demo data » sur l'écran `/#/dev/fixture` remet tout à zéro.

## Tester les scénarios (§14 du cahier des charges)

Guide détaillé : [`docs/context/04-scenarios.md`](docs/context/04-scenarios.md). Résumé :

| Scénario | Où |
|---|---|
| A — projet ATS34 préchargé | `Processings` → `Run now`, ou `Create processing` (10 étapes) |
| B — mauvaise observation + autocorrection | `/#/dev/fixture` → « Run the corrupted slot now » → onglet *Attempts* |
| C — stations désynchronisées :25/:26/:32 → sortie :30 | tout run : bloc *Source epochs per station* |
| D — station manquante → provisoire → catch-up V2 | `/#/dev/fixture` (deliver late ATS36 → catch-up 09:00) |
| E — changement de références V1/V2 par période | `Reprocess` sur 2026-07-09 22:00 → 07-10 02:00, stratégie *per slot* |
| F — distance déjà corrigée (pas de double correction) | test `corrections.test.ts` + Analysis Lab → *Distance state* |
| G — T/P tardives → nouveau facteur ppm → nouvelle version | `/#/dev/fixture` (deliver late ATS35 T/P → catch-up 08:30) |
| H — Analysis Lab complet jusqu'à la nouvelle config | `Analysis Lab` → quick pick « Corrupted observation » |

## Données

Deux projets sont préchargés comme s'ils venaient de la base BTM :

- **Réel** : le classeur `data-source/ATS34 Raw Data, Lookup, Header (1).xlsx` (station
  unique `NTE_ATS34`, mars 2025, 6494 observations, 9 références) converti par
  `node scripts/convert-ats34.mjs` → processing « NTE ATS34 - Real data (workbook) ».
  La résection + rayonnement converge et le χ² bilatéral passe sur les époques réelles.
- **Synthétique** : générateur déterministe 3 stations (ATS34/35/36) portant les scénarios
  réseau (désynchronisation, station manquante, changement de références, T/P tardives,
  observation corrompue) impossibles à rejouer sur un jeu mono-station.

Les exemples de validation du cahier des charges (78,4100 + 0,0089 = 78,4189 m…) sont
vérifiés par les tests et affichés sur `/#/dev/fixture`.

## Identité des points physiques (Physical Point Mapping)

Chaque prisme BTM (par station) est lié à un **point physique versionné** : distincts par
défaut, jamais fusionnés sur un simple nom identique (démo `MPO001` intégrée), liaisons
explicites/datées/justifiées, suggestions par proximité avec confiance, contrôles bloquants
avant run (collisions d'identifiant moteur, connectivité du réseau), snapshot du mapping
résolu dans chaque run. Onglet **Point Identity** dans l'administration + panneau à l'étape 4
du wizard. Détails : [`docs/context/06-physical-points.md`](docs/context/06-physical-points.md).

## Documentation

- [`docs/context/00-mission.md`](docs/context/00-mission.md) — mission, contraintes, décisions
- [`docs/context/01-architecture.md`](docs/context/01-architecture.md) — couches, flux d'un run, immutabilité
- [`docs/context/02-data-model.md`](docs/context/02-data-model.md) — entités, fixture, vrai classeur
- [`docs/context/03-engine.md`](docs/context/03-engine.md) — maths du moteur, hypothèses, **limites vs moteur certifié**
- [`docs/context/04-scenarios.md`](docs/context/04-scenarios.md) — pas-à-pas des scénarios A–H
- [`docs/context/05-ui-screens.md`](docs/context/05-ui-screens.md) — inventaire des écrans
- [`docs/context/06-physical-points.md`](docs/context/06-physical-points.md) — identité des points physiques (mapping versionné)
- `/#/architecture` (dans l'app) — flux BTM cible (Input Builder → worker Star*Net Ultimate →
  parsers `.PTS/.LST/.ERR` → base BTM → front) et couverture explicite de la solution legacy

## Hypothèses topographiques principales

Modèle local plan E/N/H (réseaux courts), une orientation par station et par époque,
contraintes = pseudo-observations pondérées (fixed/weak/free par composante), pondération
distance additive ou quadratique (constante + ppm), correction atmosphérique de démonstration
`standard-ppm-v1` versionnée dans chaque snapshot. Détail complet et limites :
[`docs/context/03-engine.md`](docs/context/03-engine.md).

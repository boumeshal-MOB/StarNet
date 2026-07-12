# Modèle de données et jeu de démonstration

## Entités (src/types/domain.ts)

Toutes les interfaces exigées par le prompt §16 existent : `Processing`, `Station`,
`InstrumentProfile`, `PrismProfile`, `StationPrismSetup`, `TargetMapping`, `ReferencePoint`,
`ReferenceSet`, `RawObservation`, `EnvironmentalObservation`, `ProvisionalCoordinate`,
`AdjustmentTemplate`, `RunPolicy` (=`RunTemplate`), `OutputPolicy` (=`OutputTemplate`),
`ConfigurationVersion`, `AdjustmentRun`, `AdjustmentAttempt`, `AnalysisSession`,
`AnalysisTrial`, `AdjustedCoordinate`, `OutputResultVersion`, `EngineArtifact`, `AuditEvent`.

Points clés :

- `ConfigurationVersion` contient des **copies résolues** (stations, targets, prism setups,
  adjustment/run/output policies, coordonnées provisionnelles) + `templateOrigins`
  (traçabilité des templates et des champs surchargés). Un run référence la version et stocke
  en plus son `inputSnapshot` JSON complet.
- `validFrom` inclus / `validTo` exclu ; la sélection de config se fait par slot.
- `ReferencePoint` : mode par composante `fixed` (`!`), `weak` (sigma numérique en m),
  `free` (`*`).
- `Observation Epoch` ≠ `Output Slot` : l'époque source n'est jamais arrondie ; la publication
  est alignée sur la grille (00/30 pour 30 min).

## Fixture ATS34 (src/data/fixture.ts)

Générateur déterministe (mulberry32, seed 20260711) qui reproduit la **structure exacte** du
classeur `ATS34 Raw Data, Lookup, Header (1).xlsx` :

- **Raw Observations** : `Timestamp, RecordNumber, RTS, Target, Hz, Vz, Sd` — 3 stations
  (ATS34/ATS35/ATS36), 5 références (REF01..05), 8 prismes (MP01..08), cycles 30 min du
  2026-07-08T00:00Z au 2026-07-10T12:00Z, époques décalées :25/:26/:32 (scénario C).
  `Sd` stocké = distance optique − constante de prisme (constante terrain 0 mm, pas de
  correction atmosphérique station) + bruit gaussien conforme aux sigmas instrument.
- **Lookup Table** : trois noms (terrain/ajustement/sortie BTM), hauteurs 0 m, constantes en
  mètres parmi {0 ; 0,0089 ; 0,0265 ; 0,0300}.
- **Header** : `Used from cycle` avec 2 périodes (REF01 re-mesurée au 2026-07-10 → scénario E),
  `!` = fixe (REF04), `*` = libre (hauteur REF05), sigmas 0,5–1,5 mm. Les coordonnées header
  portent le bruit de levé impliqué par leurs sigmas (cohérence statistique du χ² bilatéral).
- Mouvements réels lents injectés : MP01–MP03 (~0,4 mm/j E, −0,6 mm/j H), MP05 (−0,3 mm/j N).
- Anomalies programmées : voir `04-scenarios.md` (constantes exportées `BAD_OBS_SLOT`,
  `ATS36_SILENT_FROM`, `ENV_GAP_FROM/TO`, `REF01_V2_FROM/SHIFT`).
- MP08 vu d'une seule station → démonstration « single-ray target / non contrôlé ».
- Vérifications de conversion (78,4100+0,0089=78,4189 etc.) exposées dans
  `fixture.provenance.validationChecks` et sur l'écran développeur `/dev/fixture`.

## Vrai classeur ATS34 (branché depuis la session 2)

Le classeur réel `data-source/ATS34 Raw Data, Lookup, Header (1).xlsx` est converti par
`node scripts/convert-ats34.mjs` → `src/data/ats34.generated.json`, chargé par
`src/data/realProject.ts` et fusionné dans le repository **à côté** du réseau synthétique :

- station unique `NTE_ATS34`, mars 2025, 6494 observations, cycles ~10 min toutes les ~1-6 h ;
- 9 références serrées `L34RE1100_*` (σ 1-2 mm) + **prior lâche de la station** dans le header
  (σE/σN = 0,1 m, hauteur libre `*`) → résection + rayonnement ;
- constantes 0 / 8,9 / 30 mm, `PrismType/Grade = -1` (non renseignés), noms de colonnes réels
  avec espaces (`StDev (E) `), cycles `YYYYMMDD_HHMM` ;
- processing seedé « NTE ATS34 - Real data (workbook) » : le χ² bilatéral passe sur les
  époques réelles avec le profil TM50 (validation forte du moteur).

Le réseau synthétique multi-stations reste nécessaire pour les scénarios C/D/E/G
(désynchronisation, station manquante, changement de références, T/P tardives) que le jeu
réel mono-station ne peut pas exercer.

## Identité des points physiques

Voir `06-physical-points.md` : `TargetMapping.btmPrismId` + `physicalPointId`,
`PhysicalPoint[]` versionnés dans la ConfigurationVersion, mapping résolu snapshotté par run.

## Persistance

IndexedDB (`src/data/db.ts`, clé `btm-state-v1`) ne stocke que l'état utilisateur
(processings, versions, runs, résultats, sessions, audit, état de livraison des données
tardives). Les observations sources sont régénérées à l'identique à chaque boot (même seed),
comme des données vivant dans la base BTM. « Reset demo » sur `/dev/fixture` vide tout.

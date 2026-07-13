# Inventaire des écrans

| Route | Écran | Contenu clé |
|---|---|---|
| `/` | Processings | liste complète (type, site, stations, version active, statut, dernier/prochain run, qualité, sorties provisoires) + actions Open / Run now / Activate-Deactivate / Duplicate / Archive |
| `/create` | Assistant 10 étapes | General → Stations → Instruments → Targets & Measurement Setups → References → Initial Coordinates → Adjustment (Standard/Expert avec recherche) → Run → Output → Review/Test/Create ; brouillon auto-sauvé (localStorage) ; test d'ajustement réel non persisté |
| `/administration` | Administration | même liste, orientée ouverture des processings |
| `/processings/:id` | Admin processing | onglets Overview, Configurations (timeline, lifecycle, compare/diff), Stations & Instruments, Targets & Prisms, Reference Sets, Initial Coordinates, Adjustment Settings (édition → nouvelle version), Run & Synchronization, Output Variables, Runs & Results (versions par slot, catch-up, promote), Audit Log |
| `/processings/:id/reprocess` + `/reprocess` | Reprocessing historique | plage, stratégie par-slot/forcée, dry-run/publish, aperçu (slots, config par sous-période, gaps, résultats remplacés), comparaison old→new |
| `/runs/:runId` | Résultats d'un run | Summary, Network View (SVG, ellipses, vecteurs, exagération), Adjusted Coordinates, Observations & Residuals (filtres + graphiques), Quality Control, Attempts, Input Snapshot (traces de correction + artefacts .PTS/.LST/.ERR-équivalents) |
| `/analysis` | Analysis Lab | sélection du cas (12.1, avec état des époques/T-P/références avant calcul) + historique des sessions (12.7, réouverture lecture seule, duplication) |
| `/analysis/:sessionId` | Session d'analyse | 3 zones : Parameters & Rules (références, observations, stations/env, poids instrument, ajustement), Network & Confidence, Quality Diagnostics ; workflow trials (run/reset/undo/duplicate/compare/candidate/justification) ; Save as new configuration version avec diff |
| `/templates` | Templates | catalogues Country / Instrument / Prism Setup / Adjustment / Run / Output, usages par processing + champs surchargés, actions tracées à l'audit |
| `/audit` | Audit log | filtres catégorie/processing/texte |
| `/architecture` | Architecture BTM cible | schéma base→Input Builder→worker Star*Net→parsers→base→front + tableau de couverture legacy complet |
| `/dev/fixture` | Écran développeur (hors nav) | provenance fixture, contrôles de conversion, pilotes scénarios B/D/G, reset demo |

Conventions UI : badges de statut partout, drawers pour l'édition, tableaux denses
(`table-dense`), Callouts pédagogiques, valeurs par défaut de template affichées
(`Template default:` / `baseline:`), avertissement avant toute action touchant des résultats
publiés (nouvelle version, jamais d'écrasement).

Le design détaillé des étapes Instruments et Targets, notamment les cycles mélangeant
prismes, feuilles réfléchissantes et mesures laser sans prisme, est défini dans
[`07-measurement-setup-design.md`](07-measurement-setup-design.md).

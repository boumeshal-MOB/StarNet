# Architecture de la maquette

## Couches

```
src/
├── types/domain.ts        # modèle de données complet (voir 02-data-model.md)
├── engine/                # moteur de calcul PUR (aucune dépendance React/store)
│   ├── linalg.ts          # QR Householder + pivotage, covariance depuis R, redondances, ellipses
│   ├── stats.ts           # gamma incomplète, χ² CDF/quantile, quantile normal
│   ├── geometry.ts        # wrap angles, moyenne circulaire, polaire→ENH, azimuts
│   ├── corrections.ts     # chaîne prisme → atmosphère → datum, tracée pas à pas
│   ├── initial.ts         # coordonnées initiales (orientation stations + rayonnement)
│   ├── adjust.ts          # Gauss-Newton 3D pondéré (cœur numérique)
│   ├── runner.ts          # orchestration d'un ajustement + autocorrection + QualityReport
│   ├── worker.ts          # entrée Web Worker
│   └── engineClient.ts    # client worker avec repli synchrone (tests/SSR)
├── data/
│   ├── fixture.ts         # générateur ATS34 déterministe (structure = classeur Excel)
│   ├── repository.ts      # simule les API BTM (+ buckets de données tardives scénarios D/G)
│   ├── templates.ts       # Country/Adjustment/Run/Output templates par défaut
│   └── db.ts              # persistance IndexedDB (état utilisateur uniquement)
├── store/
│   ├── AppStore.tsx       # contexte React : entités, actions, audit, immutabilité
│   ├── runExecution.ts    # slots, sélection de cycles multi-stations, artefacts, valeurs de sortie
│   └── seed.ts            # seed du processing de démo (calculs réels, rien de codé en dur)
├── components/            # ui.tsx (primitives), NetworkView.tsx (SVG E/N), charts.tsx
└── pages/                 # 1 fichier par écran + wizard/ (10 étapes en 5 fichiers)
```

## Flux d'un run

1. `AppStore.executeRun` détermine l'**output slot** (grille 00/30) et la **version de
   configuration valide pour ce slot** (`configForSlot`, jamais la date courante).
2. `runExecution.selectCycles` choisit un cycle par station : *fresh* (dans la tolérance de
   synchro), *reused* (< âge max, résultat provisoire) ou *missing* (fatal si station requise).
3. `engineClient.runAdjustmentAsync` exécute `runner.runAdjustment` dans le Web Worker :
   corrections tracées → points/observations/contraintes moteur → Gauss-Newton →
   boucle d'autocorrection → `QualityReport` par tentative.
4. `persistRun` stocke le run + artefacts (`input-snapshot`, `engine-log`, équivalents
   `.PTS/.LST/.ERR`) ; publie une `OutputResultVersion` **versionnée** si le statut le permet
   (jamais pour Technical error / Failed QC) ; marque la config `usedByRun` (immutabilité).

## Règles d'immutabilité (implémentées dans AppStore)

- `ConfigurationVersion.usedByRun = true` ⇒ plus jamais éditée ; duplication/nouvelle version.
- Résultats : nouvelle version par slot ; `current` bascule selon la politique de remplacement ;
  `promoteResult` permet de re-promouvoir une ancienne version.
- Analysis Lab : snapshot immuable par session ; les overrides d'un trial ne touchent jamais
  les entités stockées (reference sets modifiés matérialisés en mémoire `analysisRefSets`,
  persistés seulement au « Save as new configuration version »).

## Frontière maquette / BTM cible

La page `/architecture` documente le flux serveur cible (base/API → Input Builder → worker
Star*Net Ultimate → parsers de sorties natives → base BTM → front) et la table de couverture
legacy StarAdjust. Rien de tout cela n'est implémenté côté serveur : la maquette représente les
statuts, objets et écrans que ce backend produira.

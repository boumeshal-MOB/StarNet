# Moteur de calcul

## Chaîne de corrections (corrections.ts) — tracée observation par observation

```
prismDelta            = effectiveConstant(profil station/EDM + prisme) − constantAppliedByStation
distanceAfterPrism    = storedDistance + prismDelta          # différentielle, jamais appliquée 2×
atmosphericScale      = 1 + ppm·1e-6 ;  ppm = 281.8 − 0.29065·P / (1 + T/273.15)   [standard-ppm-v1]
distanceAfterAtmo     = distanceAfterPrism × atmosphericScale # sauté si déjà corrigée par la station
finalSlopeDistance    = distanceAfterAtmo                      # entrée 3D du moteur
datumScale            = facteur horizontal séparé             # jamais multiplié à la pente complète
```

Les corrections de prisme puis d'atmosphère s'appliquent à la distance inclinée EDM. Le
facteur datum/grille est conservé séparément pour la réduction horizontale, conformément à
la sémantique de `.SCALE` dans STAR*NET. La formule ppm et son signe appartiennent à la **version du profil instrument**
(`atmosphericModelVersion`) et figurent dans chaque snapshot de run. Politique T/P manquants :
raw-with-warning / assume-corrected / use-defaults / wait-for-late-data (→ provisoire) / fail-run.

## Coordonnées initiales (initial.ts)

Orientation de chaque station = moyenne circulaire pondérée (poids = distance) de
`azimut(station, référence) − direction observée`. Puis rayonnement polaire :
`hd = sd·sin(Vz)` ; `dH = sd·cos(Vz)` ; `az = hz + orientation` ;
`E = Es + hd·sin(az)` ; `N = Ns + hd·cos(az)` ; `H = Hs + ih + dH − th`.
Cibles multi-stations : moyenne + dispersion (spread horizontal/vertical affichés).
Échecs motivés (station non orientable, référence manquante).

## Ajustement (adjust.ts) — Gauss-Newton 3D pondéré

- **Inconnues** : E/N/H de chaque point libre (stations ajustables, références, prismes
  observés) + **une orientation par station** présente dans l'époque (jamais une constante
  cachée permanente). Les points non observés dans l'époque n'entrent pas dans le système
  (pas de déficience artificielle).
- **Équations** : `predictedHz = wrap(atan2(dE,dN) − orientation)` ;
  `predictedVz = atan2(√(dE²+dN²), dH)` ; `predictedSd = ‖ΔENH‖` ; jacobienne analytique ;
  résidus angulaires normalisés dans [−π, π].
- **Contraintes** : pseudo-observations pondérées par composante (fixed → sigma configurable
  `fixedConstraintSigmaM`, weak → sigma du header, free → aucune).
- **Pondération** : angles en radians (arcsec → rad) ; distance additive `c+ppm·D` ou
  quadratique `√(c²+(ppm·D)²)` ; erreurs de centrage optionnelles ajoutées en quadrature
  (angulaire ∝ 1/D). Le sigma final de chaque observation scalaire est stocké et affiché.
- **Résolution** : QR Householder avec pivotage de colonnes (rank-revealing) sur la jacobienne
  pondérée — jamais d'inversion de la matrice normale. Déficience de rang ⇒ échec explicite
  avec la liste des composantes non contrôlées (ex. `MP08.H`), pas de fausse solution.
- **Statistiques** : SSR pondérée, dof, variance factor, total error factor, test χ²
  **bilatéral** (`chi2Inv(α/2, dof)`, `chi2Inv(1−α/2, dof)` — implémentation locale gamma
  incomplète + Wilson-Hilferty/Newton), error factors par type via les **nombres de
  redondance** `r_i = 1 − h_i` (leviers calculés depuis R), résidus standardisés
  `|v_w|/√r_i`, covariance des coordonnées depuis R (échelle variance factor si error
  propagation), ellipses 2D au niveau de confiance demandé (`√χ²Inv(conf, 2)`).

## Autocorrection (runner.ts)

Boucle : ajustement → si χ² échoue **ou** max résidu standardisé > seuil → retirer les
`removalsPerIteration` pires observations scalaires (> seuil, jamais une contrainte, jamais
une observation protégée) → relancer. Garde-fous : max tentatives, max observations retirées
(nombre et ratio), dof minimal, arrêt si plus rien de retirable. Chaque tentative
(`AdjustmentAttempt`) conserve qualité, coordonnées, usages d'observations et raisons
d'exclusion.

## Hypothèses topographiques & limites vs moteur certifié

- Modèle **local plan** E/N/H : pas de courbure terrestre ni réfraction dans les équations
  (les champs `refractionCoefficient`/`earthRadiusM` sont stockés/affichés mais le modèle de
  démonstration ne les applique pas aux Vz — réseaux courts < 300 m ⇒ effet < 0,5 mm).
- Facteur datum/grille scalaire unique (pas de projection cartographique réelle).
- Une orientation par station et par époque (pas de multi-sets par époque).
- Modèle atmosphérique de démonstration documenté, pas celui d'un constructeur précis.
- Pas de corrélations entre observations (matrice de poids diagonale).
- Pas d'estimation de variance par composantes (VCE), pas de fiabilité externe (MDB).
- Les ellipses sont horizontales 2D ; σH séparé (pas d'ellipsoïdes 3D).
- Arithmétique double précision JS ; suffisant pour des réseaux de monitoring, non certifié.

Ces limites sont volontaires : la production utilisera Star*Net Ultimate côté serveur
(voir `/architecture`), la maquette valide écrans, paramètres, diagnostics et workflows.

# Physical Point Mapping — identité des points communs multi-stations

Réponse au prompt « Gestion des points physiques communs ». Lire après `02-data-model.md`.

## Analyse de l'existant et écart corrigé

Avant cette évolution, la maquette fusionnait implicitement les cibles de stations différentes
dès qu'elles partageaient le même `AdjustmentName`, et le moteur était indexé par nom terrain
seul — deux violations des invariants (fusion par nom, collision de noms terrain identiques).
L'extension choisie est **la moins intrusive** : aucun objet existant renommé, aucun ID changé,
pas de nouvelle « table » — le mapping est porté par la `ConfigurationVersion` (déjà immuable
une fois utilisée, déjà versionnée par période) avec des objets structurés contrôlables.

## Modèle

```
Station BTM ─→ cible BTM (TargetMapping.btmPrismId, stable, par station)
                 └─ physicalPointId ─→ PhysicalPoint (versionné dans la ConfigurationVersion)
                                          └─ engineName ─→ identifiant moteur du run
```

- `TargetMapping` (1 par enregistrement cible BTM, y compris si BTM utilise historiquement
  le terme « prism ») : + `btmPrismId`, + `physicalPointId`.
  Le nom terrain (`rawName`) n'est jamais modifié et reste clé **par station** :
  `${stationId}|${rawName}` partout (runner, coordonnées initiales, corrections).
- `PhysicalPoint` : `engineName` (contraintes Star*Net, unique dans le run), `btmPrismIds[]`,
  `state` (resolved / shared / unresolved / suggested / inconsistent), `source`
  (existing / import / suggestion / manual / default), `rationale`, `decidedBy/At`.
- `AdjustmentRun.resolvedMapping` : snapshot immuable `engineName → point physique →
  prismes contributeurs (station + btmPrismId + rawName)` ; aussi dans `inputSnapshot`.
- `AdjustedCoordinate.physicalPointId` : la coordonnée ajustée remonte au point physique.

## Règles implémentées (invariants)

1. **Distinct par défaut** : chaque cible BTM naît avec son propre point (`source: default`).
   Un nom identique n'est jamais une preuve d'identité. En France, par exemple, `MPO001`
   peut être réutilisé par deux stations pour deux points différents : ils gardent deux
   `physicalPointId` et deux identifiants moteur.
2. **Liaison explicite uniquement** : `linkAsSamePoint` / `attachToPoint` / `unlinkPrism` /
   `confirmDistinct` (module `engine/pointIdentity.ts`) — datées, justifiées, auteur tracé.
   Le groupement par `AdjustmentName` commun du lookup est traité comme identifiant métier
   fourni **à l'import** (`source: import`), pas comme une déduction par nom.
3. **Versionnement** : le mapping vit dans la ConfigurationVersion → une version utilisée est
   immuable ; l'onglet admin *Point Identity* stage les modifications et les sauve en
   **nouvelle version** (validFrom/validTo) ; un recalcul historique retrouve le mapping de la
   période ; liaison A→B dans le temps = deux versions.
4. **Moteur** : un point partagé = un seul jeu E/N/H inconnu dans le système (pas de moyenne
   d'ajustements séparés) ; les résidus restent attachés station + prisme + observation source.
5. **Suggestions** : proximité de coordonnées initiales indépendantes (`suggestByProximity`,
   tolérance 5 cm) avec confiance + explication ; acceptation/refus explicites ;
   « Link all identical names » uniquement dans les options avancées, avec aperçu des
   distances entre estimations indépendantes et confirmation explicite.
6. **Contrôles pré-exécution** (`validatePointMapping`, bloquants avant tout run) :
   collision d'engine name entre points différents, prisme lié à deux points, contraintes de
   nommage moteur, mappings non résolus (à confirmer), **connectivité du réseau**
   (composantes indépendantes → run bloqué avec explication), incohérences d'estimation
   (affichées, jamais de rupture automatique de liaison).
7. **Isolation par run/projet** : la résolution utilise toujours la configuration du run ;
   les mêmes noms moteur peuvent exister dans des processings différents sans collision.

## Correspondance Star*Net

`resolvedMapping` est la table `Run + identifiant moteur → point physique → cibles BTM →
observations` requise par l'Input Builder serveur.

### Trois noms à ne pas confondre

| Donnée | Exemple France | Exemple UK | Usage |
|---|---|---|---|
| Nom source BTM | `MPO001` | `L_ANL1100_329` | Identifie la cible dans sa base d'origine ; jamais réécrit |
| Physical Point ID | UUID/ID BTM neutre | UUID/ID BTM neutre | Identité persistante du point physique ; jamais envoyé comme nom dans le `.DAT` |
| Engine point name | `MPO001` ou alias `PT000123` | `L_ANL1100_329` ou alias `PT000456` | Identifiant court utilisé dans le `.DAT` et les sorties STAR*NET |

`MPO` est une **nomenclature France** liée à la base France. Elle ne doit jamais être générée
pour le template UK ni utilisée comme préfixe générique de point physique. Le template UK
utilise les noms et `AdjustmentName` de la Lookup Table fournie dans le contexte Rob/legacy,
par exemple `360_301_34` ou `L_ANL1100_329`.

### Règles de génération du nom moteur

1. Le `physicalPointId` est un identifiant interne opaque et stable, indépendant du pays, du
   nom terrain et du type de réflecteur.
2. Si la base/Lookup fournit un `AdjustmentName` valide, unique dans le processing et confirmé
   pour ce point physique, il devient par défaut l'`engineName`.
3. Si plusieurs cibles BTM correspondent au même point physique, toutes leurs observations
   utilisent **un seul** `engineName`, même si leurs noms source sont différents.
4. Si un nom est absent, interdit, trop long ou déjà utilisé par un autre point, BTM génère un
   alias neutre et déterministe de type `PT000001`. Cet alias est sauvegardé dans le mapping
   versionné ; il n'est pas recalculé à chaque run.
5. Les stations suivent la même règle avec un alias neutre de type `ST0001` lorsque leur nom
   BTM ne peut pas être utilisé directement.
6. Le rôle référence/monitoring ne doit pas être encodé dans l'identifiant : il est porté par
   le header/les contraintes et peut évoluer sans renommer le point.
7. Deux points distincts portant le même nom source reçoivent deux noms moteur distincts. Le
   second ne doit jamais être fusionné automatiquement.
8. L'unicité est requise dans un processing/run seulement. Deux projets exécutés dans des
   dossiers séparés peuvent réutiliser les mêmes noms moteur.

Pour la compatibilité par défaut avec STAR*NET, un nom moteur est limité à 15 caractères,
respecte la casse et utilise de préférence uniquement `[A-Za-z0-9_]`. Le tiret `-` est évité,
car il sert normalement de séparateur entre noms de stations dans les lignes d'observation.
Les espaces, virgules, `=`, `#` et guillemets sont interdits par la règle BTM, même si certains
caractères spéciaux peuvent être acceptés avec des options STAR*NET particulières. L'Input
Builder ne doit pas dépendre d'un changement implicite de séparateur.

### Écriture dans le `.DAT`

L'Input Builder n'envoie ni le `physicalPointId` interne ni automatiquement le nom du prisme
BTM. Il écrit le `engineName` résolu dans les lignes d'observation et le même identifiant dans
le header/les coordonnées initiales. Ainsi :

- deux stations visant le même point physique écrivent le même nom cible dans le `.DAT` ;
- deux cibles `MPO001` distinctes en France écrivent deux noms moteur distincts ;
- un projet UK conserve ses noms métier UK lorsqu'ils sont compatibles STAR*NET ;
- le parser des sorties fait le chemin inverse `engineName → physicalPointId → cible(s) BTM`.

Exemples de résolution :

| Pays | Station/cible source | Point physique | Nom écrit dans le `.DAT` |
|---|---|---|---|
| France | `STA1 / MPO001` | `pp-uuid-A` | `PT000101` |
| France | `STA2 / MPO078` (même point confirmé) | `pp-uuid-A` | `PT000101` |
| France | `STA3 / MPO001` (point distinct) | `pp-uuid-B` | `PT000102` |
| UK | `NTE_ATS34 / L_ANL1100_329` | `pp-uuid-C` | `L_ANL1100_329` |

L'alias neutre n'est donc généré que lorsque le nom métier ne peut pas être utilisé de manière
sûre ou lorsqu'un nom canonique commun doit être créé. Il n'efface jamais les noms source.

Le nom de sortie BTM reste indépendant de l'`engineName`. Le snapshot du run conserve toutes
les correspondances afin que le `.DAT`, les résultats et la base puissent être réconciliés.

## UI

- Wizard étape 4 : panneau *Point Identity* sous le tableau des cibles (lecture/édition draft).
- Admin → onglet *Point Identity* : même panneau ; édition staged → « Save as new version ».
- Colonnes : station, id cible BTM, nom source (indicateur ≠ si le même nom existe ailleurs
  pour un autre point), rôle, point physique, engine id, prismes liés, état, dispersion H/V,
  source de la décision + justification. Filtres : shared / not confirmed / manually decided /
  inconsistent. Connectivité affichée en pied de panneau.

## Tests

`engine/__tests__/pointIdentity.test.ts` : scénarios 1 (noms différents = même point → une
coordonnée, résidus par station), 2 (même nom = points différents → deux engine ids, deux
coordonnées à ~65 m), liaisons/déliaisons sans orphelin ni collision, détection de collision
d'engine name, réseau déconnecté bloqué, snapshot résolu. Scénarios 3 (suggestion par
proximité), 4 (changement dans le temps = nouvelle version) et 6 (isolation) sont couverts
par le panneau + le versionnement de configuration existant.

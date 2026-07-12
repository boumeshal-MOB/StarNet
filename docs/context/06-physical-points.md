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
Station BTM ─→ prisme BTM (TargetMapping.btmPrismId, stable, par station)
                 └─ physicalPointId ─→ PhysicalPoint (versionné dans la ConfigurationVersion)
                                          └─ engineName ─→ identifiant moteur du run
```

- `TargetMapping` (1 par enregistrement prisme BTM) : + `btmPrismId`, + `physicalPointId`.
  Le nom terrain (`rawName`) n'est jamais modifié et reste clé **par station** :
  `${stationId}|${rawName}` partout (runner, coordonnées initiales, corrections).
- `PhysicalPoint` : `engineName` (contraintes Star*Net, unique dans le run), `btmPrismIds[]`,
  `state` (resolved / shared / unresolved / suggested / inconsistent), `source`
  (existing / import / suggestion / manual / default), `rationale`, `decidedBy/At`.
- `AdjustmentRun.resolvedMapping` : snapshot immuable `engineName → point physique →
  prismes contributeurs (station + btmPrismId + rawName)` ; aussi dans `inputSnapshot`.
- `AdjustedCoordinate.physicalPointId` : la coordonnée ajustée remonte au point physique.

## Règles implémentées (invariants)

1. **Distinct par défaut** : chaque prisme naît avec son propre point (`source: default`).
   Un nom identique n'est jamais une preuve d'identité (fixture : `MPO001` sur ATS34 = MP03,
   `MPO001` sur ATS36 = MP07 → deux engine ids, deux coordonnées).
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
   distances entre estimations indépendantes et confirmation explicite (le groupe MPO001 y
   affiche ~65 m → liaison manifestement fausse, démonstration intégrée).
6. **Contrôles pré-exécution** (`validatePointMapping`, bloquants avant tout run) :
   collision d'engine name entre points différents, prisme lié à deux points, contraintes de
   nommage moteur, mappings non résolus (à confirmer), **connectivité du réseau**
   (composantes indépendantes → run bloqué avec explication), incohérences d'estimation
   (affichées, jamais de rupture automatique de liaison).
7. **Isolation par run/projet** : la résolution utilise toujours la configuration du run ;
   les mêmes noms moteur peuvent exister dans des processings différents sans collision.

## Correspondance Star*Net

`resolvedMapping` est exactement la table `Run + identifiant moteur → point physique →
prismes BTM → observations` requise pour le futur Input Builder serveur : deux `DM P00045`
issus de stations différentes proviennent du même `engineName`, deux prismes `MPO001`
distincts produisent deux identifiants. Le générateur `.DAT` n'aura pas besoin d'alias.

## UI

- Wizard étape 4 : panneau *Point Identity* sous le tableau des cibles (lecture/édition draft).
- Admin → onglet *Point Identity* : même panneau ; édition staged → « Save as new version ».
- Colonnes : station, id prisme BTM, nom terrain (indicateur ≠ si le même nom existe ailleurs
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

# Mapping des templates d'ajustement UK et France

Ce document définit les valeurs sources, les correspondances autorisées et les limites de
traduction entre les exemples fournis et le futur processing BTM. Il complète
[`09-templates-and-configuration-rules.md`](09-templates-and-configuration-rules.md).

## 1. Statut des fichiers fournis

| Pays | Source | Moteur source | Usage dans BTM |
|---|---|---|---|
| UK | `HS2_S1_NTE.prj` et le `.snproj` associé | STAR*NET 6 / Ultimate | Template nommé `UK — STAR*NET legacy (HS2/NTE)` |
| France | `config.cfg`, généré par CoMeT IHM 2016.10.11 | CoMeT | Template nommé `France — CoMeT source`, puis traduction explicite vers le moteur cible |

Ces fichiers sont des **configurations de projets réels**, pas des normes nationales. Le pays
sert à proposer un template ; il ne transforme jamais un exemple de projet en règle imposée à
tous les sites UK ou France. La source, le moteur, le nom du fichier et la version du template
restent visibles dans l'audit.

## 2. Trois catégories de paramètres

1. **Communs et transposables** : dimension, système local/grille, unités, nombre maximal
   d'itérations, niveau du test χ², niveau de confiance.
2. **Spécifiques au moteur** : définition de la convergence, Huber, VCE Helmert, fiabilité,
   conventions de limbe et mécanisme d'autocorrection.
3. **Run ou Output** : multi-époques, génération des fichiers, précision d'affichage, contenu
   du listing. Ces options ne doivent pas encombrer l'écran compact d'ajustement.

Une valeur spécifique à CoMeT ne doit jamais être écrite telle quelle dans un champ STAR*NET
portant un nom proche. Elle est soit traduite par une règle documentée et testée, soit conservée
comme métadonnée source avec le statut `Non transposé`.

## 3. Template UK — STAR*NET legacy (HS2/NTE)

### 3.1 Solution et statistiques

| Paramètre métier | Champ source | Valeur source | Règle BTM |
|---|---|---:|---|
| Dimension | `adjustment_type` | `3D` | Préremplir `3D` |
| Unités linéaires | `linear_units` | `Meters` | Préremplir mètres |
| Affichage angulaire | `angle_output_units` | `DMS` | Conserver comme format d'affichage, distinct de l'unité interne |
| Système | `local_or_grid_adjustment` | `0` | Local |
| Ordre des coordonnées | `coordinate_order` | `EN` | Easting / Northing |
| Entrée 3D | `3D_input_mode` | `Slope/Zenith` | Distance inclinée + angle zénithal |
| Facteur d'échelle | `scale_factor` | `1.0` | Aucun facteur supplémentaire |
| Réfraction | `index_of_refraction` | `0.07` | Option avancée |
| Rayon terrestre | `earth_radius_meters` | `6 372 000 m` | Option avancée |
| Convergence STAR*NET | `converge_limit` | `0.01` | **Sans unité** ; variation de la somme des carrés des résidus standardisés |
| Itérations maximales | `maximum_iterations` | `10` | Préremplir 10 |
| Signification χ² | `chi_sqr_percent_significance` | `5 %` | Stocker `0.05`, afficher `5 %` |
| Propagation des erreurs | `perform_error_propagation` | `1` | Activée |
| Confiance des ellipses | `ell_percent_confidence` | `95 %` | Stocker `0.95`, afficher `95 %` |

Le `Convergence Limit` STAR*NET n'est pas une distance. Il ne doit donc porter ni le suffixe
`M` dans le modèle de production ni l'unité `m` dans l'interface.

### 3.2 Pondérations instrument du projet UK

| Paramètre | Valeur source |
|---|---:|
| Erreur constante distance | `1.0 mm` |
| PPM distance | `1.0 ppm` |
| Erreur angle | `1.414″` |
| Erreur direction | `2.5″` |
| Erreur azimut | `1.0″` |
| Erreur zénith | `1.5″` |
| Centrage instrument | `0.8 mm` |
| Centrage cible | `0.8 mm` |
| Centrage vertical | `0.5 mm` |

Ces valeurs sont les **poids du projet**, pas nécessairement les spécifications constructeur du
Leica TM50. Elles deviennent le fallback du template d'ajustement UK. Une configuration de
mesure `station × cible` plus précise reste prioritaire, notamment si plusieurs modes EDM ou
réflecteurs sont mélangés.

### 3.3 Autocorrection STAR*NET Ultimate

Le `.snproj` fourni ajoute :

- résidu standardisé maximal : `3.0` ;
- nombre d'outliers retirés par itération : `1` ;
- maximum d'itérations Auto Adjust : `20`.

Ces valeurs sont distinctes des `10` itérations maximales de la solution. L'interface doit les
présenter sous un résumé `Auto Adjust` repliable. Chaque exclusion et chaque tentative restent
tracées ; aucune observation n'est supprimée de la base.

### 3.4 Listing utile au traitement serveur

Le projet demande notamment les observations, résidus ajustés, convergence, coordonnées,
écarts-types et ellipses. BTM doit demander les sorties nécessaires au parser serveur, mais ces
choix appartiennent au template Output/artefacts et non au formulaire compact d'ajustement.

## 4. Template France — CoMeT source

### 4.1 Valeurs directement lisibles

| Paramètre métier | Champ CoMeT | Valeur |
|---|---|---:|
| Calcul | `TYPECALCUL` | `AJUSTEMENT` |
| Modèle | `TYPEMODEL` | `3D_LOCALE` |
| Unité angulaire | `TYPEANGLES` | `GRD` (gons) |
| Unité linéaire | `LINEARUNIT` | `m` |
| Itérations maximales | `NBMAXITER` | `30` |
| Réseau libre | `FREENET` | `NON` |
| Validation | `VALIDATION` | `95 %` |
| Estimateur robuste | `HUBERVALUE` | `2.0` |
| VCE | `VCE_METHOD` | `HELMERT` |
| Itérations VCE maximales | `VCEITERMAX` | `5` |
| Multi-époques CoMeT | `MEP_MODE` | `NON` |

Les niveaux de confiance 1D et 2D sont à `95 %`. Les paramètres de fiabilité contiennent aussi
des valeurs de risque β (`0.04` en 1D/2D et `0.05` en 3D), qui doivent être conservées comme
métadonnées avancées tant qu'un calcul de fiabilité équivalent n'est pas implémenté.

### 4.2 Paramètres à ne pas traduire automatiquement

| Champ CoMeT | Valeur | Décision |
|---|---:|---|
| `CRITCONV` | `0.0005` | Ne pas copier vers `converge_limit=0.0005` sans définition CoMeT confirmée |
| `HUBERVALUE` | `2.0` | Ne pas remplacer par un seuil de suppression de résidu ; Huber repondère au lieu de supprimer |
| `VCE_METHOD` | `HELMERT` | Ne pas assimiler au variance factor global STAR*NET |
| `APPLIMBE` | `MOY` | Conserver comme convention source jusqu'à documentation fonctionnelle |
| `REG_COORD` | `NEU` | Ne pas l'utiliser comme ordre E/N sans confirmation de sa sémantique CoMeT |
| `SIGMADIST`, `SIGM+STD`, `SIGMAOHDF` | `STD/NON/STD` | Conserver le modèle de sigma source ; traduction soumise aux règles de pondération |

### 4.3 Traduction France vers le moteur cible

Le template compact peut préremplir avec certitude : `3D`, local, mètres, gons, 30 itérations et
95 % de confiance. Les autres fonctions suivent l'une de ces règles :

- **équivalent implémenté et testé** : afficher la valeur traduite et sa provenance ;
- **équivalent approché** : demander une validation explicite et afficher l'écart ;
- **non supporté** : conserver la valeur source, afficher `Non transposé`, ne jamais prétendre
  que STAR*NET ou le moteur local réalise le même traitement.

En particulier, une autocorrection par suppression d'outliers n'est pas un équivalent de
l'estimateur robuste Huber, et la VCE Helmert n'est pas l'activation de la simple propagation
des erreurs.

## 5. Design de l'onglet Adjustment

### Vue compacte

- template sélectionné avec source : `UK — STAR*NET legacy (HS2/NTE)` ou
  `France — CoMeT source / traduction BTM` ;
- dimension ; système local/grille ; unités angulaires ; ordre des coordonnées ;
- maximum d'itérations ; niveau χ² ; niveau de confiance ;
- propagation des erreurs ; résumé de l'autocorrection ;
- badge `Source exacte`, `Traduit`, `Surchargé` ou `Non transposé`.

Les unités linéaires restent en lecture seule si BTM travaille en mètres. Les explications et la
valeur source apparaissent dans un détail dépliable, pas comme un long texte permanent.

### Options avancées

- convergence avec libellé adapté au moteur ;
- réfraction, rayon terrestre et facteur grille/datum ;
- poids distance/angles et erreurs de centrage ;
- paramètres Auto Adjust ;
- Huber, VCE et fiabilité seulement lorsqu'ils sont réellement supportés ;
- paramètres de contraintes fixes et seuils de publication.

Le changement de pays propose le template associé mais ne remplace jamais silencieusement des
valeurs déjà modifiées. BTM affiche un diff et demande confirmation.

## 6. Modèle de données et audit

Chaque valeur résolue doit pouvoir conserver :

- `value` et `unit` ;
- `semanticKey` propre au moteur, par exemple `starnet.convergenceLimit` ;
- `sourceTemplateId`, version et fichier source ;
- `sourceField` et `sourceValue` ;
- statut `exact`, `translated`, `overridden`, `unsupported` ;
- auteur/date de la surcharge.

Le snapshot de run conserve les valeurs finales et la traduction utilisée. Modifier un template
crée une nouvelle version ; aucun run historique n'est recalculé silencieusement.

## 7. Contrôles d'acceptation

- sélectionner UK ne doit plus afficher `0.00005 m`, `20`, `0.13` ou `6 371 000 m` comme
  valeurs héritées du projet fourni ;
- UK doit afficher `0.01` sans unité, `10`, `0.07` et `6 372 000 m` ;
- l'Auto Adjust UK doit distinguer seuil `3.0`, retrait `1` et maximum `20` ;
- sélectionner France doit afficher gons, 30 itérations et confiance 95 % ;
- Huber et Helmert ne doivent jamais être marqués comme actifs si le moteur ne les implémente pas ;
- les poids d'une configuration `station × cible` doivent rester prioritaires sur le fallback UK ;
- le Review doit afficher la provenance, les traductions, les surcharges et les paramètres non
  transposés.

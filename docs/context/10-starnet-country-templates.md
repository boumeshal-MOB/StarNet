# Templates STAR*NET France et Royaume-Uni

BTM utilise un seul moteur de production pour les ajustements : **STAR*NET Ultimate**. Ce
document définit les deux templates initiaux proposés par pays. Aucun paramètre propre à un
autre logiciel ne doit apparaître dans le modèle de données, l'interface ou les fichiers générés.

Les valeurs ci-dessous sont des valeurs initiales versionnées et modifiables, pas des normes
nationales. Une modification crée une nouvelle `ConfigurationVersion` et ne change jamais les
runs historiques.

## 1. Paramètres STAR*NET supportés

Un Adjustment Template BTM ne contient que des paramètres ayant une correspondance STAR*NET :

- type d'ajustement ;
- unités linéaires et format angulaire ;
- système local ou grille ;
- ordre des coordonnées ;
- mode d'entrée 3D ;
- facteur d'échelle ;
- coefficient de réfraction et rayon terrestre ;
- limite de convergence STAR*NET ;
- maximum d'itérations de la solution ;
- niveau de signification χ² ;
- propagation des erreurs et confiance des ellipses ;
- poids par défaut des observations ;
- paramètres Auto Adjust de STAR*NET Ultimate.

La limite de convergence STAR*NET est **sans unité** : elle représente la variation de la somme
des carrés des résidus standardisés entre deux itérations. Elle ne doit jamais être affichée en
mètres ni alimentée par le seuil en mètres du moteur local de la maquette.

## 2. Template `UK — STAR*NET legacy (HS2/NTE)`

Ce template reprend les valeurs des fichiers `.prj` et `.snproj` UK fournis.

### Ajustement

| Paramètre | Champ STAR*NET | Valeur UK |
|---|---|---:|
| Dimension | `adjustment_type` | `3D` |
| Unité linéaire | `linear_units` | `Meters` |
| Format angulaire | `angle_output_units` | `DMS` |
| Système | `local_or_grid_adjustment` | Local |
| Ordre | `coordinate_order` | `EN` |
| Entrée 3D | `3D_input_mode` | `Slope/Zenith` |
| Facteur d'échelle | `scale_factor` | `1.0` |
| Réfraction | `index_of_refraction` | `0.07` |
| Rayon terrestre | `earth_radius_meters` | `6 372 000 m` |
| Convergence | `converge_limit` | `0.01`, sans unité |
| Itérations solution | `maximum_iterations` | `10` |
| Signification χ² | `chi_sqr_percent_significance` | `5 %` |
| Propagation | `perform_error_propagation` | Activée |
| Confiance ellipses | `ell_percent_confidence` | `95 %` |

### Poids par défaut du projet

| Paramètre | Valeur UK |
|---|---:|
| Distance | `1.0 mm + 1.0 ppm` |
| Angle | `1.414″` |
| Direction | `2.5″` |
| Azimut | `1.0″` |
| Zénith | `1.5″` |
| Centrage instrument | `0.8 mm` |
| Centrage cible | `0.8 mm` |
| Centrage vertical | `0.5 mm` |

Ces poids sont des fallbacks du projet. La configuration de mesure explicite du couple
`station × cible` reste prioritaire lorsque le mode EDM ou le réflecteur impose une autre
précision.

### Auto Adjust

- résidu standardisé maximal : `3.0` ;
- observations retirées par itération : `1` ;
- itérations Auto Adjust maximales : `20`.

Les 20 itérations Auto Adjust sont distinctes des 10 itérations maximales de chaque solution.
Chaque tentative et exclusion est conservée dans l'audit ; aucune mesure brute n'est supprimée.

### Bundle instrument et mesures UK

- Leica TM50 I proposé ;
- distances inclinées brutes ;
- constante déjà appliquée : `0.0 mm` ;
- Leica Circular `0.0 mm`, L-bar `+8.9 mm`, Micro Prism `+26.5 mm`, 360 mini `+30.0 mm` ;
- correction atmosphérique avec T/P du cycle lorsqu'elles sont disponibles ;
- nomenclature issue de la Lookup Table UK, jamais de nom `MPO...` généré.

## 3. Template `FR — STAR*NET monitoring`

Ce template est une configuration STAR*NET destinée au fonctionnement français de BTM. Il ne
charge et n'expose aucun paramètre d'un autre moteur.

### Ajustement

| Paramètre | Champ STAR*NET | Valeur FR initiale |
|---|---|---:|
| Dimension | `adjustment_type` | `3D` |
| Unité linéaire | `linear_units` | `Meters` |
| Format angulaire | `angle_output_units` | `Gons` |
| Système | `local_or_grid_adjustment` | Local |
| Ordre | `coordinate_order` | `EN` |
| Entrée 3D | `3D_input_mode` | `Slope/Zenith` |
| Facteur d'échelle | `scale_factor` | `1.0` |
| Réfraction | `index_of_refraction` | `0.13` |
| Rayon terrestre | `earth_radius_meters` | `6 371 000 m` |
| Convergence | `converge_limit` | `0.01`, sans unité |
| Itérations solution | `maximum_iterations` | `30` |
| Signification χ² | `chi_sqr_percent_significance` | `5 %` |
| Propagation | `perform_error_propagation` | Activée |
| Confiance ellipses | `ell_percent_confidence` | `95 %` |

### Auto Adjust

Le template FR utilise le même mécanisme STAR*NET Ultimate, avec des valeurs initiales
explicites et modifiables :

- résidu standardisé maximal : `3.0` ;
- observations retirées par itération : `1` ;
- itérations Auto Adjust maximales : `20`.

### Bundle instrument et mesures France

- Topcon MS05AXII proposé ;
- distances BTM considérées déjà corrigées ;
- correction atmosphérique déjà appliquée ;
- `MPO FR` : constante requise `+25.5 mm`, déjà appliquée `+25.5 mm`, delta BTM `0.0 mm` ;
- `PAV FR` : constante `0.0 mm` ;
- une mesure avec un autre prisme, une feuille ou en mode laser possède sa propre configuration
  `station × cible` ;
- les noms `MPO...` proviennent uniquement de la base France.

## 4. Design de l'onglet Adjustment

### Vue compacte

- sélecteur `Adjustment template` avec `FR — STAR*NET monitoring` ou
  `UK — STAR*NET legacy (HS2/NTE)` ;
- dimension, format angulaire, local/grille, ordre des coordonnées ;
- convergence STAR*NET sans unité et maximum d'itérations ;
- χ², confiance, propagation des erreurs ;
- résumé Auto Adjust : `threshold 3.0 · remove 1 · max 20` ;
- badges `Template`, `Surchargé` et `Valeur de la mesure`.

### Options avancées

- réfraction, rayon terrestre et facteur d'échelle ;
- poids distance/angles et erreurs de centrage ;
- détails Auto Adjust ;
- contraintes fixes et seuils de publication.

Seuls les paramètres STAR*NET listés dans ce document sont présentés. Le changement de template
affiche un diff avant de remplacer une valeur déjà modifiée.

## 5. Résolution, génération et audit

Priorité des poids et paramètres de mesure :

1. valeur réellement enregistrée avec l'observation ;
2. configuration versionnée `station × cible` ;
3. surcharge explicite de la version du processing ;
4. fallback du template STAR*NET sélectionné ;
5. avertissement ou blocage si la valeur nécessaire reste inconnue.

L'Input Builder génère uniquement un `.prj/.snproj` STAR*NET et le `.dat` du cycle. Le snapshot
conserve le template et sa version, toutes les valeurs résolues, les surcharges, les poids par
observation et les paramètres Auto Adjust.

## 6. Contrôles d'acceptation

- UK affiche `DMS`, convergence `0.01` sans unité, 10 itérations, réfraction 0.07 et rayon
  6 372 000 m ;
- FR affiche `Gons`, convergence `0.01` sans unité, 30 itérations, réfraction 0.13 et rayon
  6 371 000 m ;
- les deux templates utilisent uniquement des champs exportables vers STAR*NET ;
- aucun paramètre d'un autre moteur n'apparaît dans l'interface ou le snapshot ;
- Auto Adjust distingue toujours itérations de solution et itérations d'autocorrection ;
- un poids `station × cible` reste prioritaire sur le poids par défaut du template ;
- le Review affiche le template, sa version et les surcharges avant création.

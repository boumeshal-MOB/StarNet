# Design — Instruments et configurations de mesure par cible

## 1. Décision fonctionnelle

Une station totale peut mélanger, dans un même processing et parfois dans un même cycle :

- plusieurs modèles de prismes avec des constantes différentes ;
- des feuilles réfléchissantes ;
- des mesures laser sans réflecteur ;
- plusieurs modes EDM compatibles avec ces cibles.

Le **mode EDM réellement utilisé n'est donc pas un paramètre global de la station**. Il
appartient à la mesure. Dans la configuration BTM, il doit être résolu au niveau du couple
`station × cible BTM`, avec possibilité de récupérer une valeur encore plus précise depuis
l'observation brute lorsque la base la fournit.

La station conserve seulement :

- son modèle et ses capacités ;
- sa hauteur ;
- la politique atmosphérique ;
- éventuellement une configuration de mesure par défaut utilisée uniquement comme fallback.

## 2. Séparation des responsabilités dans l'assistant

### Étape 3 — Instruments

Cette étape décrit ce qui est commun à la station. Elle doit rester compacte.

#### Affichage standard

Pour chaque station sélectionnée :

| Champ | Comportement |
|---|---|
| Instrument template | Modèle de station, par exemple Topcon MS05AXII |
| Instrument height | Hauteur de l'axe des tourillons, généralement 0 m pour une station permanente |
| Atmospheric correction | Déjà appliquée / T-P du cycle / valeurs fixes / aucune correction |
| Measurement summary | Synthèse en lecture seule : nombre de prismes, feuilles et cibles sans réflecteur |

Le sélecteur global **EDM mode doit être retiré de l'affichage standard**. Une station peut
utiliser plusieurs modes dans le même cycle ; un sélecteur unique donne une information
faussement globale.

#### Options avancées

Une option `Default measurement setup` peut être conservée comme fallback :

- elle préremplit les nouvelles cibles ;
- elle ne remplace jamais une information enregistrée avec l'observation ;
- elle ne modifie pas silencieusement les configurations existantes ;
- son utilisation effective est signalée et tracée.

Les détails de la formule atmosphérique, la tolérance temporelle T/P et la stratégie en cas
de données manquantes restent dans ce panneau avancé.

### Étape 4 — Targets & Measurement Setups

Le titre recommandé est `Targets & Measurement Setups`. Si `Targets & Prisms` est conservé
pour rester cohérent avec BTM, le sous-titre doit préciser que l'écran couvre également les
feuilles réfléchissantes et les mesures sans prisme.

#### Tableau compact

| Colonne | Contenu |
|---|---|
| Station | Station qui produit l'observation |
| BTM target | Identifiant et nom de la cible dans BTM |
| Measurement type | Prism / Reflective sheet / Reflectorless |
| Measurement setup | Libellé compact, par exemple `Reflector setup · Fine · corrected` |
| Distance correction | `Already corrected`, `BTM +8.9 mm` ou `Not applicable` |
| Initial coordinates | État des coordonnées initiales |
| Include | Inclusion dans l'ajustement |
| Publish | Publication des coordonnées ajustées |

Le tableau doit permettre :

- filtrage par station, type de mesure et rôle ;
- modification en lot ;
- affichage immédiat des nouvelles cibles non configurées ;
- ouverture des détails d'une seule ligne sans élargir tout le tableau.

#### Détails avancés d'une configuration de mesure

| Champ | Règle |
|---|---|
| Instrument | Hérité de la station, affiché pour vérifier la compatibilité |
| Measurement type | Prism / Reflective sheet / Reflectorless |
| Reflector template | Obligatoire pour Prism, optionnel ou spécifique pour Reflective sheet, absent pour Reflectorless |
| EDM mode | Mode réellement utilisé ou fallback explicite |
| Required constant | Constante effective attendue pour le couple instrument / EDM / réflecteur |
| Already in stored Sd | Valeur déjà incluse dans la distance BTM |
| BTM correction | `required − already applied` |
| Target height | Hauteur ou offset de la cible |
| Distance standard error | Partie constante en mm |
| Distance PPM | Partie proportionnelle en ppm |
| Source | Observation / mapping versionné / template par défaut / override manuel |

`Fine + Prism` ne doit pas être traité comme un seul concept opaque. Le modèle interne doit
pouvoir distinguer :

- le mode de mesure EDM, par exemple Fine ;
- la famille de cible, par exemple Prism ;
- le modèle précis du réflecteur, par exemple MPO FR.

L'interface peut néanmoins composer ces informations dans un libellé compact.

## 3. Types de mesure

### 3.1 Prism

- un réflecteur est obligatoire ;
- la constante effective est résolue pour le couple instrument / EDM / réflecteur ;
- BTM applique uniquement la différence entre la constante requise et celle déjà incluse ;
- les poids distance proviennent de la configuration de mesure correspondante.

### 3.2 Reflective sheet

Une feuille réfléchissante n'est ni un prisme classique ni une surface naturelle sans
réflecteur. Elle possède son propre mode, sa propre portée et ses propres caractéristiques de
précision. Sa constante éventuelle doit provenir du template constructeur/configuré, jamais
être déduite automatiquement d'un prisme `0 mm`.

### 3.3 Reflectorless

- aucun template de prisme ;
- constante requise et constante déjà appliquée affichées `Not applicable` ;
- correction de prisme égale à zéro par construction ;
- correction atmosphérique toujours applicable selon la politique de la station ;
- pondération provenant des spécifications `Non-prism` de l'instrument ;
- hauteur de cible généralement égale à 0 m, sauf offset physique documenté.

Un avertissement avancé rappelle que la couleur, la matière, l'humidité, l'angle d'incidence
et les obstructions peuvent affecter une mesure sans réflecteur.

## 4. Héritage et priorité des données

Pour chaque observation, BTM résout la configuration selon cet ordre :

1. métadonnées réellement enregistrées avec l'observation ;
2. mapping versionné `station × cible BTM` actif à l'époque ;
3. configuration par défaut de la station ;
4. blocage ou avertissement si aucune configuration sûre ne peut être résolue.

Le fallback ne doit jamais être silencieux. Le run snapshot conserve la valeur résolue et sa
source pour chaque observation.

Une modification de mode, réflecteur, constante, hauteur ou pondération crée une nouvelle
version de configuration. Les recalculs historiques utilisent la version valide pour chaque
période.

## 5. Presets pays

### France

Valeurs initiales actuellement demandées :

- Topcon MS05AXII ;
- cible par défaut `MPO FR` ;
- constante requise `+25,5 mm` ;
- constante déjà incluse `+25,5 mm` ;
- correction BTM `0,0 mm` ;
- distance et correction atmosphérique considérées déjà corrigées.

Ce preset reste un défaut. Une cible laser ou un autre réflecteur sur la même station crée une
configuration de mesure distincte.

### Royaume-Uni (UK)

- distances inclinées brutes ;
- constante déjà appliquée `0,0 mm` ;
- constantes de lookup disponibles : `0 / +8,9 / +26,5 / +30,0 mm` ;
- correction atmosphérique calculée avec T/P du cycle lorsqu'elles sont disponibles ;
- chaque cible conserve sa configuration issue de la Lookup Table.

Le comportement présenté par Rob et le fonctionnement StarAdjust legacy constituent la
source métier interne de ce template UK. `Rob` ne doit pas apparaître comme nom de template
ou comme préfixe dans la nomenclature des points.

## 6. Exemple France d'un cycle mixte

Une seule Topcon MS05AXII peut produire :

| Cible | Type | Configuration | Requise | Déjà appliquée | Delta BTM |
|---|---|---|---:|---:|---:|
| MPO001 | Prism | MPO FR · Fine | +25,5 mm | +25,5 mm | 0,0 mm |
| REF01 | Prism | Circular · Fine | 0,0 mm | 0,0 mm | 0,0 mm |
| MP360 | Prism | 360 mini · Fine | +30,0 mm | 0,0 mm | +30,0 mm |
| SHEET01 | Reflective sheet | Sheet · Fine | Configurée | Configurée | Différence |
| WALL01 | Reflectorless | Non-prism · Fine | N/A | N/A | 0,0 mm |

Les cinq observations peuvent appartenir au même cycle. Chacune reçoit sa correction et son
poids propres avant l'ajustement. Les libellés `MPO...` de cet exemple sont propres à la
nomenclature de la base France ; ils ne doivent pas être générés dans un projet UK.

## 7. Nomenclature des cibles, points physiques et noms STAR*NET

Le type de réflecteur et le nom du point sont deux informations différentes. `MPO FR` décrit
une configuration de mesure française ; `MPO001` est un exemple de nom source dans la base
France. Aucun des deux ne doit devenir une nomenclature universelle.

Règles principales :

- conserver le nom source exact par station et par base pays ;
- utiliser un `physicalPointId` interne, stable et sans préfixe pays ;
- réutiliser le `AdjustmentName` fourni par la base/Lookup comme nom moteur uniquement s'il
  est valide, unique et rattaché au bon point physique ;
- générer sinon un alias neutre versionné `PT000001`, jamais un faux nom `MPO...` ;
- écrire ce nom moteur résolu dans toutes les occurrences du point dans le `.DAT` ;
- utiliser le même nom moteur lorsque plusieurs stations visent le même point physique ;
- utiliser des noms moteur différents lorsque deux cibles homonymes représentent des points
  physiques distincts ;
- résoudre les sorties par `engineName → physicalPointId → cible(s) BTM`, sans déduire
  l'identité depuis le texte du nom.

Pour le template France, les noms `MPO...` proviennent donc de la base France. Pour le
template UK, les noms proviennent de la Lookup Table UK/legacy, par exemple `360_301_34` ou
`L_ANL1100_329`. « Rob » reste une source métier interne du template UK et ne constitue pas
une nomenclature affichée ou envoyée à STAR*NET.

Les règles complètes et les exemples de mapping `.DAT` sont définis dans
[`06-physical-points.md`](06-physical-points.md).

## 8. Règles de validation

### Erreurs bloquantes

- mode EDM incompatible avec le modèle d'instrument ;
- cible Prism sans reflector template ;
- cible Reflectorless avec une constante de prisme non nulle ;
- configuration absente et aucun fallback explicitement autorisé ;
- distance déjà corrigée mais correction identique demandée une seconde fois.

### Avertissements

- mode provenant du défaut de station plutôt que de l'observation ou du mapping ;
- mesure sans réflecteur utilisée pour un seuil de monitoring plus fin que sa précision
  configurée ;
- changement de type de mesure au cours de la période active ;
- constante personnalisée différente du template ;
- absence ou invalidité de T/P lorsque BTM doit appliquer la correction atmosphérique.

## 9. Comportement attendu du moteur

Pour chaque distance inclinée :

```text
measurementSetup = resolve(observation, stationTargetMapping, stationDefault)

if measurementType == Reflectorless:
    prismDelta = 0
else:
    prismDelta = requiredConstant - alreadyAppliedConstant

distanceAfterReflector = storedSlopeDistance + prismDelta
distanceAfterAtmosphere = applyAtmosphericPolicy(distanceAfterReflector)
sigmaDistance = combine(setup.constantError, setup.ppmError × distance,
                        configuredWeightingMethod)
```

Le moteur doit utiliser les poids de la **configuration de mesure résolue**, et non un unique
couple `mm + ppm` attaché globalement à la station.

Le snapshot du run conserve au minimum : type de mesure, mode EDM, réflecteur éventuel,
constantes requise/appliquée, delta, politique atmosphérique, poids, source de chaque valeur et
version de configuration.

## 10. Écart actuel de la maquette

À la date de cette spécification :

- `EDM mode` est encore affiché comme une valeur générale de la station ;
- le moteur utilise les poids du template instrument, indépendamment du mode/cible ;
- le type de mesure n'est pas distingué explicitement entre Prism, Reflective sheet et
  Reflectorless ;
- le modèle contient déjà une partie de la relation instrument / EDM / prisme, mais elle doit
  devenir une configuration de mesure résolue et versionnée.

La prochaine évolution doit donc retirer le sélecteur EDM global du parcours standard,
introduire les configurations de mesure par cible et brancher leurs poids dans le moteur.

## 11. Critères d'acceptation UX

- un utilisateur configure une station utilisant 50 réflecteurs identiques sans éditer 50 lignes ;
- il remplace trois exceptions en modification groupée ;
- il ajoute une cible laser sans voir de champ de constante de prisme ;
- le résumé de l'étape Instrument indique immédiatement la composition des mesures ;
- aucune modification du mode EDM ne reste sans effet sur le calcul ;
- Review & Create montre les fallbacks, incompatibilités et corrections non nulles ;
- le détail d'un run explique exactement pourquoi une distance et un poids ont été utilisés.

## 12. Références fonctionnelles

- classeur Rob `ATS34 Raw Data, Lookup, Header` et fonctionnement StarAdjust legacy fourni au
  projet ;
- manuel STAR*NET fourni : pondération des distances par partie constante et ppm, avec
  possibilité de schémas de pondération instrument ;
- documentation constructeur Topcon MS AXII : caractéristiques différentes pour prisme,
  feuille réfléchissante et non-prisme :
  <https://www.topconpositioning.com/content/dam/topcon_digital_asset_hub/collateral/brochures/topcon_msseries-msaxii_7010-2083_enUS23broc.pdf>.

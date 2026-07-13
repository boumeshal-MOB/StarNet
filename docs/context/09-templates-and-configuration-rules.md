# Règles des templates et configurations

Ce document définit ce qu'un template peut préremplir, ce qui appartient à une configuration
versionnée et l'ordre de priorité utilisé par BTM. Il évite qu'un template pays, instrument ou
ajustement devienne par erreur une règle globale applicable à toutes les observations.

## 1. Template, configuration et snapshot

| Niveau | Fonction | Mutable ? |
|---|---|---|
| Template | Proposer des valeurs initiales réutilisables | Nouvelle version ou archivage |
| ConfigurationVersion | Résoudre tous les choix pour un processing et une période | Non après utilisation |
| Run snapshot | Conserver exactement les valeurs utilisées par observation | Jamais |

Modifier un template ne modifie ni une configuration existante ni l'historique. Appliquer une
nouvelle version de template à un processing crée une nouvelle `ConfigurationVersion` après
aperçu du diff.

## 2. Familles de templates

### Country template

Préremplit :

- unités et ordre des coordonnées ;
- instrument et configuration de mesure proposés ;
- catalogues de réflecteurs disponibles ;
- état attendu des distances stockées ;
- politique atmosphérique ;
- paramètres d'ajustement et seuils initiaux ;
- conventions de nomenclature propres à la base pays.

Il ne doit jamais :

- créer automatiquement des points physiques communs ;
- renommer les identifiants source BTM ;
- imposer un mode EDM unique à toute la station ;
- écraser une valeur réellement enregistrée avec une observation.

### Instrument template

Décrit le modèle de station et ses capacités : modes EDM supportés, précisions par famille de
cible, erreurs angulaires, erreurs de centrage, hauteur par défaut et modèle atmosphérique.

Une précision distance ne doit pas être unique si le constructeur distingue Prism, Reflective
sheet et Reflectorless.

### Measurement setup template

Décrit un couple compatible instrument/mode/cible :

- instrument compatible ;
- mode EDM ;
- type et modèle de réflecteur éventuel ;
- constante effective requise ;
- valeur considérée déjà appliquée par défaut ;
- hauteur/offset proposé ;
- erreurs distance mm + ppm ;
- limites ou avertissements.

Il est instancié par couple `station × cible BTM` et peut être surchargé sans modifier les autres
cibles de la même station.

### Adjustment template

Contient dimension, projection, convergence, pondération, χ², confiance, erreurs de centrage,
autocorrection et seuils de publication. Les options avancées restent toujours accessibles.

Un Adjustment Template porte aussi une provenance moteur. Une convergence STAR*NET, un critère
CoMeT et un seuil de déplacement du moteur local sont trois sémantiques distinctes, même si les
interfaces historiques utilisent le mot « convergence ». Les valeurs et règles détaillées sont
définies dans [`10-adjustment-template-mapping.md`](10-adjustment-template-mapping.md).

### Run template

Contient déclenchement, synchronisation, réutilisation, données tardives, catch-up et limites de
recalcul.

### Output template

Contient grille de publication, variables, stratégie de doublon, statut provisoire et règles de
publication.

## 3. Preset France

Valeurs initiales actuellement retenues :

- instrument proposé : Topcon MS05AXII ;
- configuration de mesure proposée : `MPO FR` ;
- constante requise : `+25,5 mm` ;
- constante déjà incluse dans la distance : `+25,5 mm` ;
- correction BTM : `0,0 mm` ;
- distance et correction atmosphérique considérées déjà corrigées ;
- nomenclature `MPO...` provenant exclusivement de la base France.

Une station française peut néanmoins mélanger MPO, autre prisme, feuille et laser sans prisme.
Chaque exception reçoit son propre Measurement Setup.

Le fichier CoMeT fourni propose en plus un ajustement `3D_LOCALE`, mètres, angles en gons,
30 itérations, validation à 95 %, Huber 2.0 et VCE Helmert (5 itérations). Seuls les paramètres
ayant un équivalent démontré sont appliqués au moteur cible. Huber, Helmert et le critère de
convergence CoMeT ne sont jamais assimilés silencieusement à l'autocorrection ou à la convergence
STAR*NET.

## 4. Preset Royaume-Uni

Valeurs initiales :

- instrument proposé : Leica TM50 I ;
- distances inclinées brutes ;
- constante déjà appliquée : `0,0 mm` ;
- Leica Circular Prism : `0,0 mm` ;
- L-bar : `+8,9 mm` ;
- Micro Prism : `+26,5 mm` ;
- 360 mini : `+30,0 mm` ;
- correction atmosphérique avec T/P du cycle lorsque disponibles ;
- noms source et `AdjustmentName` issus de la Lookup Table UK, par exemple `360_301_34` ou
  `L_ANL1100_329` ;
- aucune génération de nom `MPO...`.

Le template d'ajustement associé au projet fourni est nommé
`UK — STAR*NET legacy (HS2/NTE)` et propose : 3D local, mètres, sortie DMS, ordre EN,
Slope/Zenith, convergence STAR*NET 0.01 sans unité, 10 itérations, χ² 5 %, confiance 95 %,
propagation activée, réfraction 0.07 et rayon 6 372 000 m.

Ses poids projet sont 1 mm + 1 ppm, angle 1.414″, direction 2.5″, azimut 1″, zénith 1.5″,
centrage instrument/cible 0.8 mm et vertical 0.5 mm. Ils sont des fallbacks de projet ; une
configuration `station × cible` explicite reste prioritaire.

L'Auto Adjust du `.snproj` associé utilise un résidu standardisé maximal de 3.0, retire une
observation par itération et autorise 20 itérations. Ces 20 itérations ne remplacent pas les
10 itérations maximales de la solution.

Le nom « UK » reste un raccourci de sélection. Ces valeurs viennent du projet HS2/NTE fourni et
ne constituent pas une norme nationale.

## 5. Priorité de résolution

Pour chaque observation :

1. valeur réellement enregistrée dans l'observation ou ses métadonnées ;
2. mapping/configuration versionnée `station × cible` active à l'époque ;
3. override explicite de la ConfigurationVersion ;
4. valeur proposée par le template sélectionné ;
5. fallback station explicitement autorisé ;
6. blocage ou avertissement si la valeur reste inconnue.

Le run snapshot conserve la valeur finale et la source de résolution. Un fallback n'est jamais
silencieux.

## 6. Identité physique et templates

Le mapping de points physiques appartient à la `ConfigurationVersion`, pas au Country Template
ni au Measurement Setup Template.

Un template peut proposer :

- de réutiliser un mapping existant pour les mêmes stations ;
- une tolérance de recherche H/V ;
- un minimum recommandé de trois points communs ;
- des règles de validation.

Il ne peut pas déclarer que deux cibles sont le même point uniquement parce que leur nom ou leur
type de prisme est identique.

Les relations connues entre points distincts sont également versionnées dans la configuration :
endpoints, type, valeur, sigma, repère, validité, source et usage.

## 7. Nomenclature

- conserver le nom source exact de la base pays ;
- `MPO` est réservé à la France ;
- UK utilise ses `AdjustmentName` Lookup ;
- le `physicalPointId` reste un identifiant interne neutre ;
- l'`engineName` réutilise le nom métier s'il est compatible et unique ;
- sinon générer un alias neutre versionné `PT000001` ;
- ne jamais encoder le rôle référence/monitoring dans l'identifiant moteur ;
- conserver un mapping inverse complet vers toutes les cibles BTM.

## 8. Versionnement temporel

Une nouvelle version est requise lors d'un changement de :

- station, instrument, mode EDM ou réflecteur ;
- constante, hauteur, correction atmosphérique ou poids ;
- mapping de point physique ;
- relation géométrique connue ;
- référence ou coordonnée/sigma de référence ;
- paramètres d'ajustement, run ou output.

La version porte `validFrom` inclus et `validTo` exclu. Un recalcul historique choisit la version
valide à chaque slot, sauf override explicite et tracé demandé par l'utilisateur.

La fenêtre d'observations utilisée pour calculer les coordonnées initiales est une provenance de
calcul (`epochFrom` / `epochTo`), pas une période de validité. Elle ne modifie jamais le
`validFrom` de la version de configuration.

Aucune configuration utilisée par un run n'est supprimée. Elle peut être désactivée ou archivée.

## 9. Review et audit

Avant création ou activation, l'utilisateur voit :

- templates et versions d'origine ;
- champs surchargés ;
- données observationnelles prioritaires ;
- fallbacks ;
- corrections non nulles ;
- mappings réutilisés, nouveaux ou modifiés ;
- relations géométriques ;
- période de validité ;
- diff avec la configuration active.

Chaque run conserve les templates résolus, mais son résultat dépend uniquement de son snapshot,
jamais de l'état futur des catalogues.

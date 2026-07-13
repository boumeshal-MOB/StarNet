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

## 4. Preset Royaume-Uni

Le comportement présenté par Rob et StarAdjust legacy est la source métier interne du template
UK, mais `Rob` n'est ni un nom de template visible ni une nomenclature de point.

Valeurs initiales :

- distances inclinées brutes ;
- constante déjà appliquée : `0,0 mm` ;
- constantes Lookup : `0 / +8,9 / +26,5 / +30,0 mm` ;
- correction atmosphérique avec T/P du cycle lorsque disponibles ;
- noms source et `AdjustmentName` issus de la Lookup Table UK, par exemple `360_301_34` ou
  `L_ANL1100_329` ;
- aucune génération de nom `MPO...`.

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

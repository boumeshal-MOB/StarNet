# Mission — Maquette BTM Topographic Adjustment Processing

> Document de contexte pour agents IA / nouveaux développeurs. Lire ce fichier en premier,
> puis `01-architecture.md`, `02-data-model.md`, `03-engine.md`, `04-scenarios.md` et
> `10-adjustment-template-mapping.md` pour les templates UK/France.

## Objet

Maquette web interactive et **réellement calculante** du futur module *Topographic Adjustment
Processing* de BlueTrust Monitoring (BTM) : création d'un processing d'ajustement topographique
(station totale unique ou réseau multi-stations), sélection des prismes/références, calcul des
coordonnées initiales, ajustement 3D par moindres carrés pondérés, exécutions
event-driven/planifiées/manuelles, catch-up, reprocessing historique, Analysis Lab et
versionnement intégral des configurations et résultats.

Le cahier des charges complet est le prompt d'origine (uploadé par le product owner) ; les
choix d'implémentation sont documentés ici.

## Contraintes non négociables (rappel)

1. Pas de Star*Net comme moteur : ajustement réel par moindres carrés pondérés local (Web Worker).
2. Pas d'import Excel / drag-drop / sélecteur de fichier dans le parcours utilisateur BTM.
3. Les données ATS34 sont préchargées comme si elles venaient des API/base BTM.
4. Fonctionne sans backend : IndexedDB simule la persistance.
5. Aucune configuration utilisée par un run ne peut être modifiée ou supprimée
   (désactivation/archivage seulement).
6. Un recalcul crée une **nouvelle version de résultat**, jamais d'écrasement silencieux.
7. Traçabilité totale : données sources, corrections, configs, sessions, tentatives, résultats.
8. Jamais d'inversion naïve de la matrice normale : QR rank-revealing (Householder + pivotage).

## Décisions prises (2026-07-11, session initiale)

- **Données** : le classeur `ATS34 Raw Data, Lookup, Header (1).xlsx` n'était pas disponible →
  fixture **synthétique déterministe** (PRNG seedé) reproduisant exactement la structure des
  3 feuilles (Raw Observations / Lookup Table / Header) et les constantes de prisme connues
  (0 / 8,9 / 26,5 / 30 mm). Le script `scripts/convert-ats34.mjs` convertit le vrai classeur
  lorsqu'il sera fourni (voir `02-data-model.md`).
- **Langue UI** : anglais (plateforme B2B) ; docs de contexte en français.
- **Stack** : React 18 + TypeScript + Vite + Tailwind 3, aucune dépendance runtime lourde ;
  algèbre linéaire et statistiques (χ², gamma incomplète) implémentées localement
  (`src/engine/linalg.ts`, `src/engine/stats.ts`) — équivalent maîtrisé de ml-matrix/jstat.
- Utilisateur de démo : `m.boumeshal`.

## Définition de « terminé »

Tous les critères d'acceptation §17 du prompt sont couverts ; `npm install && npm run dev`
démarre l'app avec le projet ATS34 prêt ; `npm test` vérifie corrections, statistiques,
moindres carrés et scénarios moteur de bout en bout.

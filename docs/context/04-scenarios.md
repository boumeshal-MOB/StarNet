# Scénarios de démonstration (§14 du prompt) — mode d'emploi

Toutes les manipulations se font dans l'UI ; l'écran développeur `/dev/fixture`
(hors navigation produit) pilote les livraisons de données tardives.

## A — Projet ATS34 préchargé
`Processings` : « NTE ATS34 - Network adjustment » (réseau NTE_ATS34, 3 stations) et
« ATS34 - Single station check » existent dès le boot, configurés depuis la base simulée
(lookup + header). `Run now` → run complet (corrections de prisme visibles dans
Input Snapshot, unités vérifiables, coordonnées initiales déjà calculées au seed,
ajustement réel, qualité affichée). Créer un processing de zéro : `Create processing`
(10 étapes, tout recalculé en direct).

## B — Mauvaise observation
L'observation ATS34→MP04 du slot **2026-07-09T10:30Z** porte +25″/+4 mm.
- Run du slot (bouton sur `/dev/fixture` ou Run now + Reprocess de ce créneau) :
  χ² FAIL (SSR ≈ 770), autocorrection retire `…MP04…:hz` puis `…:sd`, tentative finale PASS ;
  l'onglet **Attempts** montre les 3 tentatives conservées.
- Variante manuelle : Analysis Lab → quick pick « Corrupted observation » → baseline FAIL →
  panneau Observations pour modifier/exclure soi-même une valeur (Hz/Vz/Sd éditables).

## C — Réseau désynchronisé
Époques :25 (ATS34), :26 (ATS35), :32 (ATS36) pour chaque slot :00/:30 ; tolérance 10 min.
Visible sur chaque run : « Source epochs per station » (âges 4–5 min, état *fresh*),
sortie publiée au slot rond.

## D — Station manquante puis catch-up
ATS36 muette à partir de **2026-07-10T09:00Z** (dernière époque 08:32).
1. Run du slot 09:00 → ATS36 *reused* (28 min ≤ 45) → résultat **Provisional** V1.
2. `/dev/fixture` → « Deliver late ATS36 observations » → « Trigger catch-up on slot 09:00 »
   → **Result V2 - Final after catch-up** ; V1 conservé (Runs & Results, promotion possible).

## E — Changement de références
Header v2 au **2026-07-10T00:00Z** : REF01 décalée (+2,0/−1,2/+0,8 mm) et re-mesurée.
Le processing de démo a V1 (validité 08→10/07, refset v1) et V2 (10/07→∞, refset v2).
`Reprocess` sur 2026-07-09 22:00 → 2026-07-10 02:00 avec « Use configuration valid for each
output slot » : l'aperçu montre la répartition V1/V2 par sous-période, chaque slot utilise
automatiquement la bonne version.

## F — Distance déjà corrigée
Test unitaire `corrections.test.ts` (« differential… scenario F ») + Analysis Lab :
panneau Stations → « Distance state » sur *Prism corrected* : le trace de correction montre
`prismDelta = 0` (aucune double application). Comparaison chiffrée dans Input Snapshot.

## G — Données environnementales tardives
T/P d'ATS35 manquantes entre **08:00 et 09:00 le 2026-07-10** (politique ATS35 :
*wait for late data*). Run du slot 08:30 → warning + résultat provisoire sans correction
atmosphérique ATS35. `/dev/fixture` → « Deliver late ATS35 T/P » → catch-up 08:30 →
nouveau facteur ppm appliqué, nouvelle version de résultat.

## H — Analysis Lab de bout en bout
1. `Analysis Lab` → quick pick « Corrupted observation » → **Create analysis session**
   (baseline Trial 0 : χ² FAIL, résidu 26,6 identifié, réseau avec rayons suspects rouges).
2. Panneau gauche : exclure l'observation fautive (ou tester un poids justifié) → **Run trial**.
3. Comparer (cases Cmp) : χ², error factor, max stdres, ellipses, rang ; le TrendChart suit
   l'évolution entre trials.
4. Contre-exemple pédagogique : gonfler les sigmas instrument (panneau Weights) jusqu'à faire
   passer le test → alerte « Statistical test passed, but configuration quality degraded ».
5. **Mark as candidate** (justification obligatoire) → **Save as new configuration** :
   nom/raison/validité/activation + diff complet vs baseline. La config source, le baseline et
   tous les trials restent immuables (session consultable en lecture seule après Complete).

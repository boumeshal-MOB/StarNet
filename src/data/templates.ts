// ---------------------------------------------------------------------------
// Default template catalog: Country, Adjustment, Run and Output templates.
// These are editable defaults, never imposed national standards.
// ---------------------------------------------------------------------------

import type {
  AdjustmentTemplate, CountryTemplate, OutputTemplate, RunTemplate,
} from '../types/domain';

export const FR_ADJUSTMENT: AdjustmentTemplate = {
  id: 'adj-default-fr',
  name: 'FR — STAR*NET monitoring',
  version: 1,
  status: 'active',
  dimension: '3D',
  linearUnit: 'm',
  angularUnit: 'gon',
  angleOutputFormat: 'Gons',
  projectionMode: 'local',
  coordinateOrder: 'EN',
  starNetConvergenceLimit: 0.01,
  convergenceThresholdM: 0.00005,
  maxIterations: 30,
  chiSquareSignificance: 0.05,
  confidenceLevel: 0.95,
  errorPropagation: true,
  distanceWeighting: 'quadratic',
  refractionCoefficient: 0.13,
  earthRadiusM: 6371000,
  datumScaleFactor: 1,
  useCenteringErrors: false,
  starNetAutoAdjustStdResLimit: 3,
  starNetAutoAdjustOutliersPerIteration: 1,
  starNetAutoAdjustMaxIterations: 20,
  stdResThreshold: 3.5,
  removalsPerIteration: 1,
  maxAutoCorrectionAttempts: 5,
  maxRemovedObservations: 10,
  maxRemovedRatio: 0.1,
  minDegreesOfFreedom: 5,
  maxEllipseSemiMajorMm: 5,
  autoCorrectionEnabled: true,
  fixedConstraintSigmaM: 0.0001,
  notes: 'France STAR*NET template: 3D local, Gons, 30 solution iterations, Auto Adjust 3/1/20.',
};

export const UK_ADJUSTMENT: AdjustmentTemplate = {
  ...FR_ADJUSTMENT,
  id: 'adj-uk-hs2-nte',
  name: 'UK — STAR*NET legacy (HS2/NTE)',
  angularUnit: 'deg',
  angleOutputFormat: 'DMS',
  maxIterations: 10,
  refractionCoefficient: 0.07,
  earthRadiusM: 6372000,
  useCenteringErrors: true,
  notes: 'Supplied HS2/NTE STAR*NET template: 3D local, DMS, 10 solution iterations, Auto Adjust 3/1/20.',
};

export const DEFAULT_ADJUSTMENT = FR_ADJUSTMENT;
export const ADJUSTMENT_TEMPLATES: AdjustmentTemplate[] = [FR_ADJUSTMENT, UK_ADJUSTMENT];

export const DEFAULT_RUN: RunTemplate = {
  id: 'run-default',
  name: 'Event-driven 30 min network',
  version: 1,
  status: 'active',
  triggerMode: 'event-driven',
  scheduleEveryMinutes: 30,
  syncToleranceMin: 10,
  maxReusedAgeMin: 45,
  requiredStationIds: [],
  optionalStationIds: [],
  reuseMissingStation: true,
  computeWithoutOptional: true,
  markReusedProvisional: true,
  catchUpEnabled: true,
  catchUpWindowH: 24,
  catchUpOnLateObservation: true,
  catchUpOnLateEnvironmental: true,
  maxRecalcPerSlot: 3,
  replaceOnlyIfQualityImproves: false,
  keepAllResultVersions: true,
  notes: 'Trigger checks for data; it never defines output timestamps.',
};

export const DEFAULT_OUTPUT: OutputTemplate = {
  id: 'out-default-30',
  name: '30 min grid output',
  version: 1,
  status: 'active',
  outputIntervalMin: 30,
  gridAlignment: 'round',
  maxEpochToSlotDistanceMin: 10,
  duplicateStrategy: 'new-version',
  lateDataClosingDelayMin: 120,
  publishProvisional: true,
  variables: ['easting', 'northing', 'height', 'dE', 'dN', 'dH',
    'horizontalDisplacement', 'displacement3D', 'sigmaE', 'sigmaN', 'sigmaH',
    'qualityStatus', 'provisionalStatus'],
  notes: 'Published timestamps land on the 00/30 grid; source epochs are preserved in the audit.',
};

const mkCountry = (
  id: string, name: string, over: Partial<CountryTemplate>,
): CountryTemplate => ({
  id,
  name,
  version: 1,
  status: 'active',
  linearUnit: 'm',
  defaultAdjustmentTemplateId: FR_ADJUSTMENT.id,
  defaultInstrumentTemplateId: 'inst-topcon-ms05axii',
  defaultPrismSetupTemplateId: 'prism-std0',
  prismSetupTemplateIds: ['prism-std0', 'prism-circ89', 'prism-360-265', 'prism-tape30'],
  prismCorrectionPolicy: 'apply-from-prism-setup',
  defaultAtmosphericMode: 'automatic',
  defaultMissingEnvPolicy: 'use-defaults',
  notes: 'Editable defaults, not a national standard.',
  ...over,
});

export const COUNTRY_TEMPLATES: CountryTemplate[] = [
  mkCountry('country-fr', 'France', {
    defaultAdjustmentTemplateId: FR_ADJUSTMENT.id,
    defaultInstrumentTemplateId: 'inst-topcon-ms05axii',
    defaultPrismSetupTemplateId: 'prism-mpo-fr',
    prismSetupTemplateIds: ['prism-mpo-fr', 'prism-pav-fr'],
    prismCorrectionPolicy: 'already-applied',
    defaultAtmosphericMode: 'station-corrected',
    notes: 'Topcon MS05AXII + MPO FR (+25.5 mm). BTM distances are considered corrected: atmospheric and prism corrections are already applied.',
  }),
  mkCountry('country-uk', 'United Kingdom', {
    defaultAdjustmentTemplateId: UK_ADJUSTMENT.id,
    defaultInstrumentTemplateId: 'inst-tm50-uk-legacy',
    defaultPrismSetupTemplateId: 'prism-uk-leica-circular-0',
    prismSetupTemplateIds: ['prism-uk-leica-circular-0', 'prism-uk-lbar-89', 'prism-uk-micro-265', 'prism-uk-360mini-30'],
    prismCorrectionPolicy: 'apply-from-prism-setup',
    defaultAtmosphericMode: 'automatic',
    defaultMissingEnvPolicy: 'use-defaults',
    notes: 'Leica monitoring setup from the supplied Lookup note: raw slope distances recorded with 0 mm field constant; apply 0 / +8.9 / +26.5 / +30.0 mm per target, with cycle T/P correction.',
  }),
  mkCountry('country-es', 'Spain', {}),
  mkCountry('country-it', 'Italy', {}),
];

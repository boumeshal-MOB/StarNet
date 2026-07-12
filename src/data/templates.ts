// ---------------------------------------------------------------------------
// Default template catalog: Country, Adjustment, Run and Output templates.
// These are editable defaults, never imposed national standards.
// ---------------------------------------------------------------------------

import type {
  AdjustmentTemplate, CountryTemplate, OutputTemplate, RunTemplate,
} from '../types/domain';

export const DEFAULT_ADJUSTMENT: AdjustmentTemplate = {
  id: 'adj-default-fr',
  name: 'Default 3D adjustment (FR)',
  version: 1,
  status: 'active',
  dimension: '3D',
  linearUnit: 'm',
  angularUnit: 'deg',
  projectionMode: 'local',
  coordinateOrder: 'EN',
  convergenceThresholdM: 0.00005,
  maxIterations: 20,
  chiSquareSignificance: 0.05,
  confidenceLevel: 0.95,
  errorPropagation: true,
  distanceWeighting: 'quadratic',
  refractionCoefficient: 0.13,
  earthRadiusM: 6371000,
  datumScaleFactor: 1,
  useCenteringErrors: false,
  stdResThreshold: 3.5,
  removalsPerIteration: 1,
  maxAutoCorrectionAttempts: 5,
  maxRemovedObservations: 10,
  maxRemovedRatio: 0.1,
  minDegreesOfFreedom: 5,
  maxEllipseSemiMajorMm: 5,
  autoCorrectionEnabled: true,
  fixedConstraintSigmaM: 0.0001,
  notes: 'Weighted 3D Gauss-Newton; quadratic distance weighting (const + ppm).',
};

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
  angularUnit: 'deg',
  coordinateOrder: 'EN',
  projectionMode: 'local',
  refractionCoefficient: 0.13,
  earthRadiusM: 6371000,
  convergenceThresholdM: 0.00005,
  chiSquareSignificance: 0.05,
  confidenceLevel: 0.95,
  defaultInstrumentTemplateId: 'inst-tm50',
  prismSetupTemplateIds: ['prism-std0', 'prism-circ89', 'prism-360-265', 'prism-tape30'],
  notes: 'Editable defaults, not a national standard.',
  ...over,
});

export const COUNTRY_TEMPLATES: CountryTemplate[] = [
  mkCountry('country-fr', 'France', {
    prismSetupTemplateIds: ['prism-mpo-fr', 'prism-pav-fr', 'prism-std0', 'prism-circ89', 'prism-360-265', 'prism-tape30'],
  }),
  mkCountry('country-uk', 'United Kingdom', { coordinateOrder: 'EN', confidenceLevel: 0.95 }),
  mkCountry('country-es', 'Spain', { angularUnit: 'gon' }),
  mkCountry('country-it', 'Italy', {}),
];

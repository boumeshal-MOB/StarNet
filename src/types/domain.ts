// ---------------------------------------------------------------------------
// BTM Topographic Adjustment Processing - domain model
// Every run stores a fully *resolved snapshot* of its configuration, never
// only references to templates (templates may evolve independently).
// ---------------------------------------------------------------------------

export type ISODate = string; // ISO-8601 timestamp

export type ProcessingStatus =
  | 'Draft'
  | 'Waiting for data'
  | 'Ready'
  | 'Running'
  | 'Success'
  | 'Success with warnings'
  | 'Provisional'
  | 'Failed quality control'
  | 'Technical error'
  | 'Disabled'
  | 'Archived';

export type RunQualityStatus =
  | 'Success'
  | 'Success with warnings'
  | 'Provisional'
  | 'Failed quality control'
  | 'Technical error';

export type ConstraintMode = 'fixed' | 'weak' | 'free';
export type TargetRole = 'reference' | 'monitoring' | 'auxiliary';
export type DistanceState =
  | 'raw'                 // Raw - no correction applied
  | 'prism-corrected'     // Prism corrected by station
  | 'atmo-corrected'      // Atmospherically corrected by station
  | 'fully-corrected'     // Fully corrected by station
  | 'unknown';            // Unknown / user assumption

export type AtmosphericMode =
  | 'automatic'           // per station and cycle from T/P variables
  | 'station-corrected'   // already corrected by the station
  | 'none'
  | 'defaults';           // use configured default temperature / pressure

export type MissingEnvPolicy =
  | 'raw-with-warning'
  | 'assume-corrected'
  | 'use-defaults'
  | 'wait-for-late-data'
  | 'fail-run';

export type TriggerMode = 'event-driven' | 'schedule' | 'manual';

// ----------------------------------------------------------- Observations --

export interface RawObservation {
  id: string;
  stationId: string;        // RTS
  rawTargetName: string;    // Target as recorded by the station
  epoch: ISODate;           // real observation timestamp - never rounded
  recordNumber: number;
  hzDeg: number;            // horizontal direction, decimal degrees
  vzDeg: number;            // zenith angle, decimal degrees (~90 = horizontal)
  sdM: number;              // slope distance, metres, as stored in the DB
}

export interface EnvironmentalObservation {
  id: string;
  stationId: string;
  epoch: ISODate;
  temperatureC?: number;
  pressureHPa?: number;
}

// ------------------------------------------------------------- Templates --

export interface CountryTemplate {
  id: string;
  name: string;             // France, United Kingdom, Spain, Italy
  version: number;
  status: 'active' | 'deprecated' | 'archived';
  linearUnit: 'm';
  angularUnit: 'deg' | 'gon';
  coordinateOrder: 'EN' | 'NE';
  projectionMode: 'local' | 'grid';
  refractionCoefficient: number;
  earthRadiusM: number;
  convergenceThresholdM: number;
  chiSquareSignificance: number;   // e.g. 0.05
  confidenceLevel: number;         // e.g. 0.95
  defaultInstrumentTemplateId: string;
  prismSetupTemplateIds: string[];
  notes: string;
}

export interface InstrumentProfile {
  id: string;
  manufacturer: string;
  model: string;
  edmMode: string;
  version: number;
  status: 'active' | 'deprecated' | 'archived';
  wavelengthNm: number;
  distanceStdErrMm: number;        // constant part
  distancePpm: number;
  directionStdErrArcSec: number;
  hzAngleStdErrArcSec: number;
  vzAngleStdErrArcSec: number;
  azimuthStdErrArcSec: number;
  instrumentCenteringErrMm: number;
  targetCenteringErrMm: number;
  verticalCenteringErrMm: number;
  defaultInstrumentHeightM: number;
  atmosphericModel: 'standard-ppm-v1' | 'none';
  atmosphericModelVersion: string; // recorded in run snapshots
  notes: string;
}

export interface PrismProfile {
  id: string;
  name: string;                  // e.g. "MPO FR"
  instrumentProfileId: string;   // effective constant depends on the pair
  edmMode: string;
  manufacturer: string;
  model: string;
  prismType: string;
  grade?: string;
  country: string;
  effectiveConstantM: number;    // stored in metres, displayed in mm
  defaultTargetHeightM: number;
  version: number;
  status: 'active' | 'deprecated' | 'archived';
  validFrom?: ISODate;
  validTo?: ISODate;
  notes: string;
}

export interface AdjustmentTemplate {
  id: string;
  name: string;
  version: number;
  status: 'active' | 'deprecated' | 'archived';
  dimension: '2D' | '3D';
  linearUnit: 'm';
  angularUnit: 'deg' | 'gon';
  projectionMode: 'local' | 'grid';
  coordinateOrder: 'EN' | 'NE';
  convergenceThresholdM: number;
  maxIterations: number;
  chiSquareSignificance: number;
  confidenceLevel: number;
  errorPropagation: boolean;
  distanceWeighting: 'additive' | 'quadratic';   // const + ppm combination
  refractionCoefficient: number;
  earthRadiusM: number;
  datumScaleFactor: number;
  useCenteringErrors: boolean;
  stdResThreshold: number;          // standardized residual rejection limit
  removalsPerIteration: number;
  maxAutoCorrectionAttempts: number;
  maxRemovedObservations: number;
  maxRemovedRatio: number;          // 0..1
  minDegreesOfFreedom: number;
  maxEllipseSemiMajorMm: number;    // publication criterion
  autoCorrectionEnabled: boolean;
  fixedConstraintSigmaM: number;    // sigma used for "fixed" pseudo-observations
  notes: string;
}

export interface RunTemplate {
  id: string;
  name: string;
  version: number;
  status: 'active' | 'deprecated' | 'archived';
  triggerMode: TriggerMode;
  scheduleEveryMinutes: number;
  syncToleranceMin: number;          // normal synchronization tolerance
  maxReusedAgeMin: number;           // maximum age of reused data
  requiredStationIds: string[];
  optionalStationIds: string[];
  reuseMissingStation: boolean;
  computeWithoutOptional: boolean;
  markReusedProvisional: boolean;
  catchUpEnabled: boolean;
  catchUpWindowH: number;
  catchUpOnLateObservation: boolean;
  catchUpOnLateEnvironmental: boolean;
  maxRecalcPerSlot: number;
  replaceOnlyIfQualityImproves: boolean;
  significantChangeThresholdMm?: number;
  keepAllResultVersions: true;       // non-negotiable
  notes: string;
}

export interface OutputTemplate {
  id: string;
  name: string;
  version: number;
  status: 'active' | 'deprecated' | 'archived';
  outputIntervalMin: number;         // 30, 60 or custom
  gridAlignment: 'round';            // slots at 00/30 for 30-min interval
  maxEpochToSlotDistanceMin: number;
  duplicateStrategy: 'new-version' | 'keep-first';
  lateDataClosingDelayMin: number;
  publishProvisional: boolean;
  variables: OutputVariableKey[];
  notes: string;
}

export type OutputVariableKey =
  | 'easting' | 'northing' | 'height'
  | 'dE' | 'dN' | 'dH'
  | 'horizontalDisplacement' | 'displacement3D'
  | 'sigmaE' | 'sigmaN' | 'sigmaH'
  | 'qualityStatus' | 'provisionalStatus';

// ------------------------------------------------------------ Processing --

export interface Station {
  id: string;                  // RTS name, e.g. ATS34
  processingId?: string;
  name: string;
  instrumentProfileId: string;
  edmMode: string;
  instrumentHeightM: number;
  validFrom: ISODate;
  validTo?: ISODate;
  distanceState: DistanceState;
  constantAppliedByStationM: number;   // field constant already applied
  atmosphericMode: AtmosphericMode;
  temperatureVariable?: string;
  pressureVariable?: string;
  envToleranceMin: number;
  defaultTemperatureC: number;
  defaultPressureHPa: number;
  missingEnvPolicy: MissingEnvPolicy;
  required: boolean;           // required vs optional in multi-station sync
  adjustable: boolean;         // station coordinates are unknowns if true
  approxE: number;
  approxN: number;
  approxH: number;
}

export interface StationPrismSetup {
  stationId: string;
  targetKey: string;           // rawTargetName
  prismProfileId: string;
  effectiveConstantM: number;  // resolved constant for station+EDM+prism
  constantAppliedByStationM: number;
  targetHeightM: number;
  source: 'template' | 'manual-override';
}

export type InitialCoordinateStatus =
  | 'computed' | 'manual' | 'missing' | 'to-review';

export interface TargetMapping {
  id: string;
  stationIds: string[];        // stations observing this target (usually one)
  btmPrismId: string;          // BTM prism registration id (stable, per station)
  rawName: string;             // field name - never modified
  adjustmentName: string;      // internal engine name (Star*Net compatible)
  outputName: string;          // BTM output name
  physicalPointId: string;     // resolved physical identity (versioned link)
  role: TargetRole;
  prismProfileId: string;
  grade?: string;
  targetHeightM: number;
  includeInAdjustment: boolean;
  publishOutput: boolean;
  validFrom: ISODate;
  validTo?: ISODate;
  source: 'template' | 'manual-override';
  reviewStatus: 'ok' | 'to-review';
  initialCoordinateStatus: InitialCoordinateStatus;
  nomenclatureIssues: string[];  // forbidden chars, too long, collisions...
}

// ------------------------------------------------------- Physical points --
// A Physical Point is the common topographic identity observed by one or
// several BTM prisms (possibly from different stations). It is versioned by
// the ConfigurationVersion it belongs to; the resolved engine name is what
// the adjustment engine / Star*Net input uses.
export type PhysicalPointState =
  | 'resolved'        // a confirmed physical identity (single or shared)
  | 'shared'          // linked to several BTM prisms across stations
  | 'unresolved'      // detected but not yet confirmed (default for new)
  | 'suggested'       // a link candidate awaiting human decision
  | 'inconsistent';   // contributing estimates disagree beyond tolerance

export type PhysicalPointSource =
  | 'existing'        // reused from a previous configuration
  | 'import'          // provided by a business id at import
  | 'suggestion'      // proposed by BTM (accepted)
  | 'manual'          // manual human confirmation
  | 'default';        // implicit own-point for a non-shared prism

export interface PhysicalPoint {
  id: string;
  label: string;              // human label (e.g. "MP05" or "Pillar P00045")
  engineName: string;         // resolved Star*Net-compatible id, unique in run
  role: TargetRole;
  outputName?: string;        // BTM output name for the shared point
  btmPrismIds: string[];      // contributing BTM prism registrations
  state: PhysicalPointState;
  source: PhysicalPointSource;
  confidence?: number;        // 0..1 for suggestions
  rationale?: string;         // explanation of a suggestion / decision
  decidedBy?: string;
  decidedAt?: ISODate;
  note?: string;
}

export interface PhysicalPointSuggestion {
  kind: 'prior-config' | 'business-id' | 'coordinate-proximity' | 'nomenclature' | 'existing-relation';
  btmPrismIds: string[];
  confidence: number;
  rationale: string;
  distanceM?: number;
}

export interface ReferencePoint {
  pointId: string;
  easting: number;
  northing: number;
  height: number;
  sigmaE?: number;             // undefined => free component ('*')
  sigmaN?: number;
  sigmaH?: number;
  modeE: ConstraintMode;
  modeN: ConstraintMode;
  modeH: ConstraintMode;
  source: string;
  comment: string;
}

export interface ReferenceSet {
  id: string;
  processingId: string;
  name: string;
  version: number;
  points: ReferencePoint[];
  validFrom: ISODate;
  validTo?: ISODate;
  activeInVersion: boolean;
  usedByRun: boolean;          // once true the set is immutable
  createdAt: ISODate;
  createdBy: string;
  comment: string;
}

export interface ProvisionalCoordinate {
  targetId: string;            // adjustmentName
  easting: number;
  northing: number;
  height: number;
  nObservations: number;
  perStation: {
    stationId: string;
    easting: number; northing: number; height: number; nObs: number;
  }[];
  spreadHorizontalM: number;
  spreadVerticalM: number;
  status: InitialCoordinateStatus;
  comment?: string;
  computedAt: ISODate;
  epochFrom: ISODate;
  epochTo: ISODate;
}

// -------------------------------------------------- Configuration version --

export interface ConfigurationVersion {
  id: string;
  processingId: string;
  versionNumber: number;
  label: string;
  description: string;
  technicalReason?: string;
  validFrom: ISODate;
  validTo?: ISODate;           // exclusive; undefined = open-ended
  status: 'draft' | 'scheduled' | 'active' | 'inactive' | 'archived';
  usedByRun: boolean;          // once used, immutable forever
  createdAt: ISODate;
  createdBy: string;
  sourceAnalysisSessionId?: string;
  sourceTrialId?: string;
  // ---- full resolved content (immutable once usedByRun) ----
  stations: Station[];
  prismSetups: StationPrismSetup[];
  targets: TargetMapping[];
  physicalPoints: PhysicalPoint[];     // versioned point-identity mapping
  referenceSetId: string;
  provisionalCoordinates: ProvisionalCoordinate[];
  adjustment: AdjustmentTemplate;      // resolved copy, not a reference
  runPolicy: RunTemplate;              // resolved copy
  outputPolicy: OutputTemplate;        // resolved copy
  templateOrigins: {                   // traceability of template usage
    countryTemplateId?: string;
    adjustmentTemplateId?: string;
    runTemplateId?: string;
    outputTemplateId?: string;
    overriddenFields: string[];
  };
}

export interface Processing {
  id: string;
  name: string;
  type: 'Topographic Adjustment';
  project: string;
  site: string;
  network: string;
  description: string;
  mode: 'standard' | 'expert';
  status: ProcessingStatus;
  active: boolean;
  createdAt: ISODate;
  createdBy: string;
  networkKind: 'single-station' | 'multi-station';
  configurationVersionIds: string[];
  activeConfigurationVersionId?: string;
  lastRunId?: string;
  nextRunAt?: ISODate;
  draftWizard?: unknown;       // auto-saved wizard draft
}

// ------------------------------------------------------------------ Runs --

export interface ObservationUsage {
  observationId: string;
  stationId: string;
  targetId: string;            // adjustmentName
  kind: 'hz' | 'vz' | 'sd';
  used: boolean;
  excludedAtAttempt?: number;
  exclusionReason?: string;
  protected: boolean;
  sigma: number;               // final sigma applied (rad or m)
  residual?: number;
  stdResidual?: number;
}

export interface CorrectionTrace {
  observationId: string;
  stationId: string;
  targetId: string;
  storedDistanceM: number;
  prismDeltaM: number;         // effectiveConstant - constantAppliedByStation
  distanceAfterPrismM: number;
  temperatureC?: number;
  pressureHPa?: number;
  atmosphericPpm: number;
  atmosphericScale: number;
  distanceAfterAtmosphereM: number;
  datumScale: number;
  finalDistanceM: number;
  formulaVersion: string;
  envSource: 'measured' | 'defaults' | 'none' | 'station';
  warnings: string[];
}

/** Resolved point mapping stored in a run snapshot (engine id -> contributors) */
export interface ResolvedPointMapping {
  engineName: string;
  physicalPointId: string;
  label: string;
  role: TargetRole;
  contributors: { stationId: string; btmPrismId: string; rawName: string }[];
}

export interface AdjustedCoordinate {
  targetId: string;            // engine name (resolved from the physical point)
  physicalPointId?: string;
  role: TargetRole;
  easting: number;
  northing: number;
  height: number;
  sigmaE: number;
  sigmaN: number;
  sigmaH: number;
  ellipseSemiMajorM: number;
  ellipseSemiMinorM: number;
  ellipseOrientationDeg: number;   // from North, clockwise
  dE?: number;                     // vs provisional / previous
  dN?: number;
  dH?: number;
  nObservations: number;
  redundant: boolean;              // observed from >1 station / >min obs
}

export interface QualityReport {
  nObservations: number;
  nConstraints: number;
  nUnknowns: number;
  degreesOfFreedom: number;
  weightedSSR: number;
  varianceFactor: number;
  totalErrorFactor: number;
  errorFactorByType: { hz?: number; vz?: number; sd?: number; constraint?: number };
  chiSquareLower: number;
  chiSquareUpper: number;
  chiSquarePassed: boolean;
  chiSquareValue: number;          // = weightedSSR tested against bounds
  converged: boolean;
  iterations: number;
  rank: number;
  rankDeficiency: number;
  rankExplanation?: string;
  maxStdResidual: number;
  maxStdResidualObs?: string;
  maxEllipseSemiMajorM: number;
  meanEllipseSemiMajorM: number;
  referencesUsed: number;
  constrainedComponents: number;
  singleRayTargets: string[];      // targets computed from one ray only
  warnings: string[];
  publishable: boolean;
  publicationBlockers: string[];
}

export interface AdjustmentAttempt {
  attemptNumber: number;           // 0 = initial run
  startedAt: ISODate;
  removedObservationIds: string[];
  removalReason?: string;
  quality: QualityReport;
  coordinates: AdjustedCoordinate[];
  observations: ObservationUsage[];
}

export interface EngineArtifact {
  id: string;
  runId: string;
  kind: 'input-snapshot' | 'engine-log' | 'lst-equivalent' | 'err-equivalent' | 'pts-equivalent';
  label: string;
  content: string;                 // JSON or text payload
  createdAt: ISODate;
}

export interface StationEpochUsage {
  stationId: string;
  epoch: ISODate;
  ageMin: number;
  state: 'fresh' | 'reused' | 'missing';
}

export interface AdjustmentRun {
  id: string;
  processingId: string;
  configurationVersionId: string;
  outputSlot: ISODate;
  trigger: 'manual' | 'event' | 'schedule' | 'catch-up' | 'reprocess' | 'test' | 'analysis';
  startedAt: ISODate;
  finishedAt?: ISODate;
  durationMs?: number;
  status: RunQualityStatus | 'Running';
  provisional: boolean;
  provisionalReasons: string[];
  stationEpochs: StationEpochUsage[];
  observationIds: string[];
  resolvedMapping: ResolvedPointMapping[];   // immutable snapshot of the point mapping used
  corrections: CorrectionTrace[];
  attempts: AdjustmentAttempt[];
  finalAttempt: number;
  engineReturnCode: number;        // 0 = ok (mirrors future Star*Net exit code)
  artifactIds: string[];
  inputSnapshot: string;           // JSON of the fully resolved inputs
  createdBy: string;
}

export interface OutputResultVersion {
  id: string;
  processingId: string;
  outputSlot: ISODate;
  version: number;                 // v1, v2 (catch-up)...
  runId: string;
  label: string;                   // e.g. "Final after catch-up"
  provisional: boolean;
  current: boolean;                // promoted as the current value
  values: Record<string, Partial<Record<OutputVariableKey, number | string>>>;
  createdAt: ISODate;
  createdBy: string;
  reason: string;
  supersededById?: string;
}

// ---------------------------------------------------------- Analysis Lab --

export interface AnalysisOverrides {
  disabledReferencePointIds: string[];
  referenceSigmaOverrides: Record<string, { sigmaE?: number; sigmaN?: number; sigmaH?: number;
    modeE?: ConstraintMode; modeN?: ConstraintMode; modeH?: ConstraintMode }>;
  referenceCoordinateOverrides: Record<string, { easting?: number; northing?: number; height?: number }>;
  provisionalOverrides: Record<string, { easting?: number; northing?: number; height?: number }>;
  excludedStationIds: string[];
  excludedTargetIds: string[];
  excludedObservationIds: string[];
  protectedObservationIds: string[];
  prismConstantOverrides: Record<string, number>;      // key: station|target
  stationHeightOverrides: Record<string, number>;
  targetHeightOverrides: Record<string, number>;
  distanceStateOverrides: Record<string, DistanceState>;
  observationValueOverrides: Record<string, { hzDeg?: number; vzDeg?: number; sdM?: number }>;
  adjustmentOverrides: Partial<AdjustmentTemplate>;
  envOverrides: Record<string, { temperatureC?: number; pressureHPa?: number }>;
  /** per instrument-profile sigma overrides (distance/angle std errors, ppm, centering) */
  instrumentOverrides: Record<string, Partial<InstrumentProfile>>;
}

export interface AnalysisTrial {
  id: string;
  sessionId: string;
  trialNumber: number;             // 0 = baseline
  label: string;
  overrides: AnalysisOverrides;
  changedFields: string[];
  run?: AdjustmentRun;             // full result snapshot
  isCandidate: boolean;
  justification?: string;
  diagnosticFlags: string[];       // anti-manipulation warnings
  createdAt: ISODate;
  createdBy: string;
  comment?: string;
}

export interface AnalysisSession {
  id: string;
  processingId: string;
  configurationVersionId: string;  // baseline config
  outputSlot: ISODate;
  snapshotObservationIds: string[];
  snapshotJson: string;            // immutable snapshot of data + config
  status: 'open' | 'completed' | 'abandoned';
  trials: AnalysisTrial[];
  bestCandidateTrialId?: string;
  resultingConfigurationVersionId?: string;
  createdAt: ISODate;
  createdBy: string;
  comment?: string;
  readOnly: boolean;
}

// ------------------------------------------------------------------ Audit --

export interface AuditEvent {
  id: string;
  at: ISODate;
  user: string;
  category: 'processing' | 'configuration' | 'run' | 'result' | 'analysis'
    | 'template' | 'reference' | 'reprocess' | 'system' | 'data';
  action: string;
  entityId?: string;
  processingId?: string;
  details: string;
}

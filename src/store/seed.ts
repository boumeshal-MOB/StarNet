// ---------------------------------------------------------------------------
// Demo seeding: builds the pre-loaded NTE_ATS34 processings exactly as if
// they had been configured earlier by a BTM user. Provisional coordinates
// are computed with the real engine (no hard-coded results).
// ---------------------------------------------------------------------------

import type {
  AuditEvent, ConfigurationVersion, Processing, ProvisionalCoordinate,
  ReferenceSet, Station, StationPrismSetup, TargetMapping,
} from '../types/domain';
import { repository } from '../data/repository';
import { FIXTURE_START, REF01_V2_FROM } from '../data/fixture';
import { DEFAULT_ADJUSTMENT, DEFAULT_OUTPUT, DEFAULT_RUN } from '../data/templates';
import { computeInitialCoordinates } from '../engine/initial';
import { correctDistance, lookupEnvironment } from '../engine/corrections';
import type { CorrectionTrace } from '../types/domain';

export const DEMO_USER = 'm.boumeshal';

let idSeq = 1;
export function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(idSeq++).toString(36)}`;
}

export function buildStations(stationIds: string[], opts?: Partial<Station>): Station[] {
  const summaries = repository.stationSummaries();
  return stationIds.map((id) => {
    const s = summaries.find((x) => x.id === id)!;
    return {
      id,
      name: id,
      instrumentProfileId: 'inst-tm50',
      edmMode: 'Precise + Reflector',
      instrumentHeightM: 0,
      validFrom: new Date(FIXTURE_START).toISOString(),
      distanceState: 'raw',
      constantAppliedByStationM: 0,
      atmosphericMode: 'automatic',
      temperatureVariable: `${id}.Temperature`,
      pressureVariable: `${id}.Pressure`,
      envToleranceMin: 15,
      defaultTemperatureC: 15,
      defaultPressureHPa: 1015,
      missingEnvPolicy: id === 'ATS35' ? 'wait-for-late-data' : 'use-defaults',
      required: id !== 'ATS36',
      adjustable: true,
      approxE: s.approxE,
      approxN: s.approxN,
      approxH: s.approxH,
      ...opts,
    };
  });
}

export function buildTargetsAndSetups(stationIds: string[]): {
  targets: TargetMapping[]; setups: StationPrismSetup[];
} {
  const lookup = repository.lookup().filter((r) => stationIds.includes(r.RTS));
  const prisms = repository.prismProfiles();
  const byAdjName = new Map<string, TargetMapping>();
  const setups: StationPrismSetup[] = [];
  for (const row of lookup) {
    const prism = prisms.find((p) => Math.abs(p.effectiveConstantM - row.PrismConstant) < 1e-9);
    setups.push({
      stationId: row.RTS,
      targetKey: row.TargetName,
      prismProfileId: prism?.id ?? 'prism-std0',
      effectiveConstantM: row.PrismConstant,
      constantAppliedByStationM: 0,
      targetHeightM: row.TargetHeight,
      source: 'template',
    });
    const existing = byAdjName.get(row.AdjustmentName);
    if (existing) {
      if (!existing.stationIds.includes(row.RTS)) existing.stationIds.push(row.RTS);
      continue;
    }
    byAdjName.set(row.AdjustmentName, {
      id: nextId('target'),
      stationIds: [row.RTS],
      rawName: row.TargetName,
      adjustmentName: row.AdjustmentName,
      outputName: row.OutputName,
      role: row.AdjustmentName.startsWith('REF') ? 'reference' : 'monitoring',
      prismProfileId: prism?.id ?? 'prism-std0',
      grade: row.PrismGrade,
      targetHeightM: row.TargetHeight,
      includeInAdjustment: row.AdjustmentEnabled,
      publishOutput: row.GraphEnabled,
      validFrom: new Date(FIXTURE_START).toISOString(),
      source: 'template',
      reviewStatus: 'ok',
      initialCoordinateStatus: 'missing',
      nomenclatureIssues: [],
    });
  }
  // the lookup keys targets by raw name per station; the engine needs a
  // rawName -> mapping for every station alias as well
  const targets = [...byAdjName.values()];
  return { targets, setups };
}

/** raw-name alias mappings so every station's field name resolves */
export function expandTargetAliases(targets: TargetMapping[], stationIds: string[]): TargetMapping[] {
  const lookup = repository.lookup().filter((r) => stationIds.includes(r.RTS));
  const out: TargetMapping[] = [];
  for (const row of lookup) {
    const base = targets.find((t) => t.adjustmentName === row.AdjustmentName);
    if (!base) continue;
    out.push({ ...base, id: nextId('target'), rawName: row.TargetName, stationIds: [row.RTS] });
  }
  return out;
}

export function computeProvisional(
  stations: Station[],
  targets: TargetMapping[],
  setups: StationPrismSetup[],
  referenceSet: ReferenceSet,
  windowFromMs: number,
  windowToMs: number,
): ProvisionalCoordinate[] {
  const observations = repository.observationsInWindow(stations.map((s) => s.id), windowFromMs, windowToMs);
  const env = repository.environmental();
  const instruments = Object.fromEntries(repository.instrumentProfiles().map((p) => [p.id, p]));
  const setupByKey = new Map(setups.map((s) => [`${s.stationId}|${s.targetKey}`, s]));
  const corrections = new Map<string, CorrectionTrace>();
  const nameMap = new Map<string, string>();
  const heights = new Map<string, number>();
  for (const t of targets) {
    nameMap.set(t.rawName, t.adjustmentName);
    heights.set(t.adjustmentName, t.targetHeightM);
  }
  for (const o of observations) {
    const st = stations.find((s) => s.id === o.stationId);
    const adjName = nameMap.get(o.rawTargetName);
    if (!st || !adjName) continue;
    const setup = setupByKey.get(`${o.stationId}|${o.rawTargetName}`);
    corrections.set(o.id, correctDistance({
      observation: o,
      station: st,
      setup: setup ?? { effectiveConstantM: 0, constantAppliedByStationM: 0 },
      instrument: instruments[st.instrumentProfileId],
      env: lookupEnvironment(st, o.epoch, env),
      datumScale: 1,
      targetId: adjName,
    }));
  }
  const result = computeInitialCoordinates({
    observations,
    corrections,
    stations,
    references: referenceSet.points,
    nameMap,
    targetHeights: heights,
    referenceIds: new Set(referenceSet.points.map((p) => p.pointId)),
    epochFrom: new Date(windowFromMs).toISOString(),
    epochTo: new Date(windowToMs).toISOString(),
  });
  return result.provisional;
}

export interface SeedResult {
  processings: Processing[];
  configVersions: ConfigurationVersion[];
  referenceSets: ReferenceSet[];
  audit: AuditEvent[];
}

export function seedDemo(): SeedResult {
  const now = new Date().toISOString();
  const audit: AuditEvent[] = [];
  const logAudit = (category: AuditEvent['category'], action: string, details: string, processingId?: string) => {
    audit.push({ id: nextId('audit'), at: now, user: DEMO_USER, category, action, details, processingId });
  };

  // ---------------- multi-station network processing --------------------
  const procId = 'proc-nte-ats34';
  const refSets = repository.referenceSetsFromHeader(procId, DEMO_USER);
  const stationIds = ['ATS34', 'ATS35', 'ATS36'];
  const stations = buildStations(stationIds);
  const { targets, setups } = buildTargetsAndSetups(stationIds);
  const aliasTargets = expandTargetAliases(targets, stationIds);

  const initWindowFrom = FIXTURE_START;
  const initWindowTo = FIXTURE_START + 2 * 3600000;
  const provisional = computeProvisional(stations, aliasTargets, setups, refSets[0], initWindowFrom, initWindowTo);
  for (const t of aliasTargets) {
    if (provisional.some((p) => p.targetId === t.adjustmentName)) t.initialCoordinateStatus = 'computed';
  }

  const mkConfig = (
    n: number, label: string, refSetId: string, validFrom: string,
    validTo: string | undefined, status: ConfigurationVersion['status'], description: string,
  ): ConfigurationVersion => ({
    id: `${procId}-v${n}`,
    processingId: procId,
    versionNumber: n,
    label,
    description,
    validFrom,
    validTo,
    status,
    usedByRun: false,
    createdAt: now,
    createdBy: DEMO_USER,
    stations: JSON.parse(JSON.stringify(stations)),
    prismSetups: JSON.parse(JSON.stringify(setups)),
    targets: JSON.parse(JSON.stringify(aliasTargets)),
    referenceSetId: refSetId,
    provisionalCoordinates: JSON.parse(JSON.stringify(provisional)),
    adjustment: { ...DEFAULT_ADJUSTMENT },
    runPolicy: {
      ...DEFAULT_RUN,
      requiredStationIds: ['ATS34', 'ATS35'],
      optionalStationIds: ['ATS36'],
    },
    outputPolicy: { ...DEFAULT_OUTPUT },
    templateOrigins: {
      countryTemplateId: 'country-fr',
      adjustmentTemplateId: DEFAULT_ADJUSTMENT.id,
      runTemplateId: DEFAULT_RUN.id,
      outputTemplateId: DEFAULT_OUTPUT.id,
      overriddenFields: ['runPolicy.requiredStationIds', 'stations.ATS35.missingEnvPolicy'],
    },
  });

  const v1 = mkConfig(1, 'V1 - Initial references', refSets[0].id,
    new Date(FIXTURE_START).toISOString(), new Date(REF01_V2_FROM).toISOString(),
    'inactive', 'Initial configuration imported from BTM (header block v1).');
  const v2 = mkConfig(2, 'V2 - REF01 re-surveyed', refSets[1].id,
    new Date(REF01_V2_FROM).toISOString(), undefined,
    'active', 'REF01 coordinates updated after the July control survey.');

  const processing: Processing = {
    id: procId,
    name: 'NTE ATS34 - Network adjustment',
    type: 'Topographic Adjustment',
    project: repository.project().project,
    site: repository.project().site,
    network: repository.project().network,
    description: '3-station monitoring network (ATS34/35/36), 30 min outputs, event-driven.',
    mode: 'expert',
    status: 'Ready',
    active: true,
    createdAt: now,
    createdBy: DEMO_USER,
    networkKind: 'multi-station',
    configurationVersionIds: [v1.id, v2.id],
    activeConfigurationVersionId: v2.id,
  };

  logAudit('processing', 'create', 'Processing created from BTM data (demo seed)', procId);
  logAudit('configuration', 'create-version', 'V1 created (initial references)', procId);
  logAudit('configuration', 'create-version', 'V2 created (REF01 re-surveyed, valid from 2026-07-10)', procId);
  logAudit('reference', 'import', 'Reference sets imported from header block (2 validity periods)', procId);

  // ---------------- single-station processing (draft) --------------------
  const proc2Id = 'proc-ats34-single';
  const refSets2 = repository.referenceSetsFromHeader(proc2Id, DEMO_USER)
    .map((s) => ({
      ...s,
      points: s.points.filter((p) => ['REF01', 'REF02', 'REF04', 'REF05'].includes(p.pointId)),
    }));
  const stations2 = buildStations(['ATS34']);
  const { targets: t2, setups: s2 } = buildTargetsAndSetups(['ATS34']);
  const alias2 = expandTargetAliases(t2, ['ATS34']);
  const prov2 = computeProvisional(stations2, alias2, s2, refSets2[0], initWindowFrom, initWindowTo);
  for (const t of alias2) {
    if (prov2.some((p) => p.targetId === t.adjustmentName)) t.initialCoordinateStatus = 'computed';
  }
  const v1b: ConfigurationVersion = {
    ...mkConfig(1, 'V1 - Single station', refSets2[0].id,
      new Date(FIXTURE_START).toISOString(), undefined, 'active',
      'Single-station processing on ATS34 only.'),
    id: `${proc2Id}-v1`,
    processingId: proc2Id,
    stations: stations2,
    prismSetups: s2,
    targets: alias2,
    provisionalCoordinates: prov2,
    runPolicy: { ...DEFAULT_RUN, triggerMode: 'manual', requiredStationIds: ['ATS34'], optionalStationIds: [] },
  };
  const processing2: Processing = {
    id: proc2Id,
    name: 'ATS34 - Single station check',
    type: 'Topographic Adjustment',
    project: repository.project().project,
    site: repository.project().site,
    network: repository.project().network,
    description: 'Manual single-station adjustment used for periodic checks.',
    mode: 'standard',
    status: 'Ready',
    active: false,
    createdAt: now,
    createdBy: DEMO_USER,
    networkKind: 'single-station',
    configurationVersionIds: [v1b.id],
    activeConfigurationVersionId: v1b.id,
  };
  logAudit('processing', 'create', 'Single-station processing created (demo seed)', proc2Id);

  return {
    processings: [processing, processing2],
    configVersions: [v1, v2, v1b],
    referenceSets: [...refSets, ...refSets2],
    audit,
  };
}

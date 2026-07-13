// ---------------------------------------------------------------------------
// Demo seeding: builds the pre-loaded NTE_ATS34 processings exactly as if
// they had been configured earlier by a BTM user. Provisional coordinates
// are computed with the real engine (no hard-coded results).
// ---------------------------------------------------------------------------

import type {
  AuditEvent, ConfigurationVersion, PhysicalPoint, Processing, ProvisionalCoordinate,
  ReferenceSet, Station, StationPrismSetup, TargetMapping,
} from '../types/domain';
import { repository } from '../data/repository';
import { FIXTURE_START, REF01_V2_FROM } from '../data/fixture';
import { DEFAULT_ADJUSTMENT, DEFAULT_OUTPUT, DEFAULT_RUN } from '../data/templates';
import { computeInitialCoordinates } from '../engine/initial';
import { correctDistance, lookupEnvironment } from '../engine/corrections';
import { resolveEngineName } from '../engine/pointIdentity';
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
      // stations without T/P series in BTM cannot use automatic correction
      atmosphericMode: s.environmentalData ? 'automatic' : 'none',
      temperatureVariable: s.environmentalData ? `${id}.Temperature` : undefined,
      pressureVariable: s.environmentalData ? `${id}.Pressure` : undefined,
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

/**
 * One TargetMapping per BTM prism registration (per lookup row / per station)
 * plus the versioned Physical Point mapping. Default rule: every prism is its
 * own distinct physical point. Prisms sharing an AdjustmentName in the BTM
 * lookup were declared as one business point at import time -> they form a
 * shared physical point (source 'import'), never merged by field name alone.
 */
export function buildTargetsAndSetups(
  stationIds: string[], referenceIds?: Set<string>,
  options: { reuseConfirmedDemoMapping?: boolean } = {},
): {
  targets: TargetMapping[]; setups: StationPrismSetup[]; physicalPoints: PhysicalPoint[];
} {
  const lookup = repository.lookup().filter((r) => stationIds.includes(r.RTS));
  const prisms = repository.prismProfiles();
  const setups: StationPrismSetup[] = [];
  const targets: TargetMapping[] = [];
  const groups = new Map<string, { rows: typeof lookup; mappings: TargetMapping[] }>();

  const isRef = (adjName: string) =>
    referenceIds ? referenceIds.has(adjName) : adjName.startsWith('REF');

  for (const row of lookup) {
    const prism = prisms.find((p) => Math.abs(p.effectiveConstantM - row.PrismConstant) < 1e-9);
    setups.push({
      stationId: row.RTS,
      targetKey: row.TargetName,
      measurementType: 'prism',
      edmMode: undefined,
      prismProfileId: prism?.id ?? 'prism-std0',
      effectiveConstantM: row.PrismConstant,
      constantAppliedByStationM: 0,
      targetHeightM: row.TargetHeight,
      distanceStdErrMm: undefined,
      distancePpm: undefined,
      source: 'template',
    });
    const mapping: TargetMapping = {
      id: nextId('target'),
      stationIds: [row.RTS],
      btmPrismId: `PRISM-${row.RTS}-${row.TargetName}`,   // stable BTM registration id
      rawName: row.TargetName,
      adjustmentName: row.AdjustmentName,
      outputName: stationIds.length > 1 && !options.reuseConfirmedDemoMapping
        ? `${row.RTS}_${row.TargetName}` : row.OutputName,
      physicalPointId: '',                                 // resolved below
      role: isRef(row.AdjustmentName) ? 'reference' : 'monitoring',
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
    };
    targets.push(mapping);
    // AdjustmentName is not a physical-point identifier. New processings keep
    // every station/target distinct until the user confirms common points.
    // Only the already-configured demo processing may reuse its explicit seed.
    const groupKey = options.reuseConfirmedDemoMapping
      ? row.AdjustmentName : `${row.RTS}|${row.TargetName}`;
    const g = groups.get(groupKey) ?? { rows: [], mappings: [] };
    g.rows.push(row);
    g.mappings.push(mapping);
    groups.set(groupKey, g);
  }

  const physicalPoints: PhysicalPoint[] = [];
  for (const [, g] of groups) {
    const adjName = g.rows[0].AdjustmentName;
    const stationsOf = [...new Set(g.mappings.map((m) => m.stationIds[0]))];
    const shared = stationsOf.length > 1;
    const pp: PhysicalPoint = {
      id: nextId('pp'),
      label: options.reuseConfirmedDemoMapping ? adjName : g.rows[0].TargetName,
      engineName: options.reuseConfirmedDemoMapping
        ? adjName : g.rows[0].TargetName.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 15),
      role: g.mappings[0].role,
      outputName: g.rows[0].OutputName,
      btmPrismIds: g.mappings.map((m) => m.btmPrismId),
      state: shared ? 'shared' : 'resolved',
      source: shared ? 'existing' : 'default',
      rationale: shared
        ? `Confirmed mapping reused from the configured demonstration network (${stationsOf.join(' and ')})`
        : undefined,
      decidedBy: shared ? 'demo configuration' : undefined,
      decidedAt: shared ? new Date(FIXTURE_START).toISOString() : undefined,
    };
    physicalPoints.push(pp);
    for (const m of g.mappings) m.physicalPointId = pp.id;
  }
  return { targets, setups, physicalPoints };
}

export function computeProvisional(
  stations: Station[],
  targets: TargetMapping[],
  setups: StationPrismSetup[],
  physicalPoints: PhysicalPoint[],
  referenceSet: ReferenceSet,
  windowFromMs: number,
  windowToMs: number,
): ProvisionalCoordinate[] {
  const observations = repository.observationsInWindow(stations.map((s) => s.id), windowFromMs, windowToMs);
  const env = repository.environmental();
  const instruments = Object.fromEntries(repository.instrumentProfiles().map((p) => [p.id, p]));
  const setupByKey = new Map(setups.map((s) => [`${s.stationId}|${s.targetKey}`, s]));
  const corrections = new Map<string, CorrectionTrace>();
  // per (station, field name) -> engine name resolved via the physical point
  const nameMap = new Map<string, string>();
  const heights = new Map<string, number>();
  for (const t of targets) {
    const engineName = resolveEngineName(t, physicalPoints);
    for (const sid of t.stationIds) nameMap.set(`${sid}|${t.rawName}`, engineName);
    heights.set(engineName, t.targetHeightM);
  }
  for (const o of observations) {
    const st = stations.find((s) => s.id === o.stationId);
    const engineName = nameMap.get(`${o.stationId}|${o.rawTargetName}`);
    if (!st || !engineName) continue;
    const setup = setupByKey.get(`${o.stationId}|${o.rawTargetName}`);
    corrections.set(o.id, correctDistance({
      observation: o,
      station: st,
      setup: setup ?? { effectiveConstantM: 0, constantAppliedByStationM: 0 },
      instrument: instruments[st.instrumentProfileId],
      env: lookupEnvironment(st, o.epoch, env),
      datumScale: 1,
      targetId: engineName,
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
  const refSets = repository.referenceSetsFromHeader(procId, DEMO_USER, (id) => id.startsWith('REF'));
  const stationIds = ['ATS34', 'ATS35', 'ATS36'];
  const stations = buildStations(stationIds);
  const { targets: aliasTargets, setups, physicalPoints } = buildTargetsAndSetups(
    stationIds, undefined, { reuseConfirmedDemoMapping: true },
  );

  const initWindowFrom = FIXTURE_START;
  const initWindowTo = FIXTURE_START + 2 * 3600000;
  const provisional = computeProvisional(stations, aliasTargets, setups, physicalPoints, refSets[0], initWindowFrom, initWindowTo);
  for (const t of aliasTargets) {
    const engineName = resolveEngineName(t, physicalPoints);
    if (provisional.some((p) => p.targetId === engineName)) t.initialCoordinateStatus = 'computed';
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
    physicalPoints: JSON.parse(JSON.stringify(physicalPoints)),
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
  const refSets2 = repository.referenceSetsFromHeader(proc2Id, DEMO_USER, (id) => id.startsWith('REF'))
    .map((s) => ({
      ...s,
      points: s.points.filter((p) => ['REF01', 'REF02', 'REF04', 'REF05'].includes(p.pointId)),
    }));
  const stations2 = buildStations(['ATS34']);
  const { targets: alias2, setups: s2, physicalPoints: pp2 } = buildTargetsAndSetups(['ATS34']);
  const prov2 = computeProvisional(stations2, alias2, s2, pp2, refSets2[0], initWindowFrom, initWindowTo);
  for (const t of alias2) {
    const engineName = resolveEngineName(t, pp2);
    if (prov2.some((p) => p.targetId === engineName)) t.initialCoordinateStatus = 'computed';
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
    physicalPoints: pp2,
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

  // ---------------- REAL data processing (NTE_ATS34 workbook) -----------
  const real = repository.realProject();
  const processings: Processing[] = [processing, processing2];
  const configVersions: ConfigurationVersion[] = [v1, v2, v1b];
  const referenceSets: ReferenceSet[] = [...refSets, ...refSets2];

  if (real) {
    const proc3Id = 'proc-real-ats34';
    const realPointIds = new Set(real.header.map((h) => h.PointId));
    const refSets3 = repository.referenceSetsFromHeader(proc3Id, DEMO_USER, (id) => realPointIds.has(id));
    const stations3 = buildStations([real.stationId], {
      validFrom: refSets3[0]?.validFrom ?? new Date('2024-12-02T02:00:00Z').toISOString(),
    });
    const refIds3 = new Set(real.referenceIds);
    const { targets: t3, setups: s3, physicalPoints: pp3 } = buildTargetsAndSetups([real.stationId], refIds3);
    // first observation cycle of the real dataset as initialization window
    const epochs = real.rawObservations.map((o) => new Date(o.epoch).getTime()).sort((a, b) => a - b);
    const firstCycleFrom = epochs[0] - 60000;
    const firstCycleTo = epochs[0] + 60 * 60000;
    const prov3 = computeProvisional(stations3, t3, s3, pp3, refSets3[0], firstCycleFrom, firstCycleTo);
    for (const t of t3) {
      const engineName = resolveEngineName(t, pp3);
      if (prov3.some((p) => p.targetId === engineName)) t.initialCoordinateStatus = 'computed';
    }
    const v1c: ConfigurationVersion = {
      ...mkConfig(1, 'V1 - Imported from BTM', refSets3[0].id,
        refSets3[0].validFrom, undefined, 'active',
        'Real NTE_ATS34 dataset (March 2025): 9 tight references, loose station prior, free station height.'),
      id: `${proc3Id}-v1`,
      processingId: proc3Id,
      stations: stations3,
      prismSetups: s3,
      targets: t3,
      physicalPoints: pp3,
      provisionalCoordinates: prov3,
      runPolicy: {
        ...DEFAULT_RUN,
        triggerMode: 'event-driven',
        syncToleranceMin: 30,
        maxReusedAgeMin: 360,
        requiredStationIds: [real.stationId],
        optionalStationIds: [],
      },
      outputPolicy: { ...DEFAULT_OUTPUT, outputIntervalMin: 60, maxEpochToSlotDistanceMin: 30 },
    };
    const processing3: Processing = {
      id: proc3Id,
      name: 'NTE ATS34 - Real data (workbook)',
      type: 'Topographic Adjustment',
      project: real.project,
      site: real.site,
      network: real.network,
      description: `Single-station resection + radiation on the real ATS34 dataset (${real.meta.observationCount} observations, March 2025).`,
      mode: 'expert',
      status: 'Ready',
      active: true,
      createdAt: now,
      createdBy: DEMO_USER,
      networkKind: 'single-station',
      configurationVersionIds: [v1c.id],
      activeConfigurationVersionId: v1c.id,
    };
    processings.push(processing3);
    configVersions.push(v1c);
    referenceSets.push(...refSets3);
    logAudit('processing', 'create', `Real ATS34 processing created from workbook data (${real.meta.source})`, proc3Id);
    logAudit('data', 'ingest', `${real.meta.observationCount} raw observations available in BTM for ${real.stationId}`, proc3Id);
  }

  return { processings, configVersions, referenceSets, audit };
}

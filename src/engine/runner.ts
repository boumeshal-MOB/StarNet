// ---------------------------------------------------------------------------
// Orchestration of one adjustment: domain objects -> corrections -> engine
// inputs (with final sigmas) -> Gauss-Newton -> auto-correction loop ->
// quality report. Pure function: no store access, no persistence.
// ---------------------------------------------------------------------------

import type {
  AdjustedCoordinate, AdjustmentAttempt, AdjustmentTemplate, CorrectionTrace,
  EnvironmentalObservation, GeometricRelationship, InstrumentProfile, ObservationUsage, PhysicalPoint,
  QualityReport, RawObservation, ReferencePoint, Station, StationPrismSetup, TargetMapping,
} from '../types/domain';
import { ARCSEC2RAD, DEG2RAD } from './geometry';
import { correctDistance, lookupEnvironment } from './corrections';
import { resolveEngineName } from './pointIdentity';
import {
  adjustNetwork, type AdjustResult, type EngineConstraint, type EngineGeometricConstraint, type EngineObservation,
  type EnginePoint,
} from './adjust';

export interface RunnerInput {
  observations: RawObservation[];
  env: EnvironmentalObservation[];
  stations: Station[];
  instruments: Record<string, InstrumentProfile>;
  prismSetups: StationPrismSetup[];
  targets: TargetMapping[];
  physicalPoints: PhysicalPoint[];     // resolves engine names (point identity)
  geometricRelationships?: GeometricRelationship[];
  references: ReferencePoint[];
  provisional: Record<string, { e: number; n: number; h: number }>;
  adjustment: AdjustmentTemplate;
  excludedObservationIds?: string[];   // scalar ids `${rawId}:${kind}` or raw ids
  protectedObservationIds?: string[];
  observationValueOverrides?: Record<string, { hzDeg?: number; vzDeg?: number; sdM?: number }>;
  envOverrides?: Record<string, { temperatureC?: number; pressureHPa?: number }>;
  instrumentOverrides?: Record<string, Partial<InstrumentProfile>>;
  autoCorrection?: boolean;            // overrides adjustment.autoCorrectionEnabled
}

export interface RunnerOutput {
  ok: boolean;
  failureReason?: string;
  corrections: CorrectionTrace[];
  attempts: AdjustmentAttempt[];
  finalAttempt: number;
  engineReturnCode: number;
  logs: string[];
  preparationWarnings: string[];
}

export function runAdjustment(input: RunnerInput): RunnerOutput {
  const logs: string[] = [];
  const prepWarnings: string[] = [];
  const adj = input.adjustment;
  const excluded = new Set(input.excludedObservationIds ?? []);
  const protectedIds = new Set(input.protectedObservationIds ?? []);
  const log = (s: string) => logs.push(`[${new Date().toISOString()}] ${s}`);

  log(`Engine start: ${input.observations.length} raw observations, ${input.stations.length} station(s)`);

  // apply instrument sigma overrides (Analysis Lab trials)
  const instruments: Record<string, InstrumentProfile> = { ...input.instruments };
  if (input.instrumentOverrides) {
    for (const [pid, ov] of Object.entries(input.instrumentOverrides)) {
      if (instruments[pid]) instruments[pid] = { ...instruments[pid], ...ov };
    }
  }

  const stationById = new Map(input.stations.map((s) => [s.id, s]));
  // keyed per (station, field name): the same field name on two stations may
  // be two different physical points (never merged by name alone)
  const targetByKey = new Map<string, TargetMapping>();
  for (const t of input.targets) {
    for (const sid of t.stationIds) targetByKey.set(`${sid}|${t.rawName}`, t);
  }
  const mappingFor = (o: RawObservation) => targetByKey.get(`${o.stationId}|${o.rawTargetName}`);
  // engine id resolved through the physical point identity (versioned link)
  const engineNameOf = (t: TargetMapping) => resolveEngineName(t, input.physicalPoints ?? []);
  const setupByKey = new Map(input.prismSetups.map((s) => [`${s.stationId}|${s.targetKey}`, s]));
  const refByName = new Map(input.references.map((r) => [r.pointId, r]));

  // ------------------------------------------------------- corrections ----
  const corrections: CorrectionTrace[] = [];
  const correctedSd = new Map<string, number>();
  for (const o of input.observations) {
    const station = stationById.get(o.stationId);
    const mapping = mappingFor(o);
    if (!station || !mapping) continue;
    const setup = setupByKey.get(`${o.stationId}|${o.rawTargetName}`);
    const instrument = instruments[station.instrumentProfileId];
    const ov = input.observationValueOverrides?.[o.id];
    const obs: RawObservation = ov ? { ...o, ...('hzDeg' in ov && ov.hzDeg !== undefined ? { hzDeg: ov.hzDeg } : {}),
      ...(ov.vzDeg !== undefined ? { vzDeg: ov.vzDeg } : {}), ...(ov.sdM !== undefined ? { sdM: ov.sdM } : {}) } : o;
    let env = lookupEnvironment(station, o.epoch, input.env);
    const envOv = input.envOverrides?.[o.stationId];
    if (envOv && (envOv.temperatureC !== undefined || envOv.pressureHPa !== undefined)) {
      env = {
        temperatureC: envOv.temperatureC ?? env.temperatureC,
        pressureHPa: envOv.pressureHPa ?? env.pressureHPa,
        source: 'measured', warnings: [...env.warnings, 'T/P manually overridden (analysis)'],
      };
    }
    const trace = correctDistance({
      observation: obs,
      station,
      setup: setup ?? { effectiveConstantM: 0, constantAppliedByStationM: station.constantAppliedByStationM },
      instrument,
      env,
      datumScale: adj.projectionMode === 'grid' ? adj.datumScaleFactor : 1,
      targetId: engineNameOf(mapping),
    });
    corrections.push(trace);
    correctedSd.set(o.id, trace.finalDistanceM);
    for (const w of trace.warnings) if (!prepWarnings.includes(w)) prepWarnings.push(w);
  }

  // ------------------------------------------------------ engine points ----
  // only points actually observed in this epoch set become part of the
  // system; a silent station or an unobserved target must never inject
  // unknowns without observations (artificial rank deficiency)
  const observedStations = new Set(input.observations.map((o) => o.stationId));
  const observedTargets = new Set(input.observations
    .map((o) => { const m = mappingFor(o); return m ? engineNameOf(m) : undefined; })
    .filter((x): x is string => !!x));

  const points: EnginePoint[] = [];
  const constraints: EngineConstraint[] = [];
  const seen = new Set<string>();
  for (const s of input.stations) {
    if (!observedStations.has(s.id)) {
      log(`Station ${s.id} has no observation in this epoch set - not part of the system`);
      continue;
    }
    points.push({ id: s.id, e: s.approxE, n: s.approxN, h: s.approxH, free: s.adjustable, role: 'station' });
    seen.add(s.id);
    if (s.adjustable) {
      // an adjustable station still needs its own datum from references
      log(`Station ${s.id} is adjustable (coordinates are unknowns)`);
    }
  }
  for (const r of input.references) {
    const isStationPoint = seen.has(r.pointId); // e.g. loose station prior in the header
    if (!isStationPoint) {
      if (!observedTargets.has(r.pointId)) continue;
      points.push({ id: r.pointId, e: r.easting, n: r.northing, h: r.height, free: true, role: 'reference' });
      seen.add(r.pointId);
    }
    // constraints apply to reference targets AND to station points listed in
    // the header (a station prior only makes sense if the station is free)
    if (isStationPoint && !stationById.get(r.pointId)?.adjustable) continue;
    const sigmaFor = (mode: string, sigma?: number) =>
      mode === 'fixed' ? adj.fixedConstraintSigmaM : mode === 'weak' ? (sigma ?? 0.01) : undefined;
    const sE = sigmaFor(r.modeE, r.sigmaE);
    const sN = sigmaFor(r.modeN, r.sigmaN);
    const sH = sigmaFor(r.modeH, r.sigmaH);
    if (sE !== undefined) constraints.push({ pointId: r.pointId, component: 'e', value: r.easting, sigma: sE });
    if (sN !== undefined) constraints.push({ pointId: r.pointId, component: 'n', value: r.northing, sigma: sN });
    if (sH !== undefined) constraints.push({ pointId: r.pointId, component: 'h', value: r.height, sigma: sH });
  }
  const skippedTargets: string[] = [];
  for (const t of input.targets) {
    const engineName = engineNameOf(t);
    if (seen.has(engineName)) continue;
    if (!t.includeInAdjustment) continue;
    if (!observedTargets.has(engineName)) continue;
    if (t.role === 'reference') continue; // reference targets come from the reference set
    const prov = input.provisional[engineName];
    if (!prov) {
      skippedTargets.push(engineName);
      continue;
    }
    points.push({
      id: engineName, e: prov.e, n: prov.n, h: prov.h, free: true,
      role: t.role === 'monitoring' ? 'monitoring' : 'auxiliary',
    });
    seen.add(engineName);
  }
  if (skippedTargets.length) {
    prepWarnings.push(`No provisional coordinates for: ${skippedTargets.join(', ')} - excluded from adjustment`);
  }
  const physicalById = new Map(input.physicalPoints.map((point) => [point.id, point]));
  const geometricConstraints: EngineGeometricConstraint[] = (input.geometricRelationships ?? [])
    .filter((relation) => relation.enabled)
    .flatMap((relation) => {
      const fromId = physicalById.get(relation.pointAId)?.engineName;
      const toId = physicalById.get(relation.pointBId)?.engineName;
      if (!fromId || !toId || !seen.has(fromId) || !seen.has(toId)) {
        prepWarnings.push(`Known geometry ${relation.id} skipped because one endpoint is not part of this epoch`);
        return [];
      }
      return [{
        id: relation.id, fromId, toId, kind: relation.kind, distanceM: relation.distanceM,
        deltaEM: relation.deltaEM, deltaNM: relation.deltaNM, deltaHM: relation.deltaHM,
        sigma: relation.sigmaM,
      }];
    });

  // -------------------------------------------------- engine observations --
  const engineObs: EngineObservation[] = [];
  for (const o of input.observations) {
    const station = stationById.get(o.stationId);
    const mapping = mappingFor(o);
    if (!station || !mapping) continue;
    if (!mapping.includeInAdjustment) continue;
    const engineName = engineNameOf(mapping);
    if (!seen.has(engineName)) continue;
    const instrument = instruments[station.instrumentProfileId];
    const setup = setupByKey.get(`${o.stationId}|${o.rawTargetName}`);
    const targetHeight = setup?.targetHeightM ?? mapping.targetHeightM;
    const ov = input.observationValueOverrides?.[o.id];
    const hzDeg = ov?.hzDeg ?? o.hzDeg;
    const vzDeg = ov?.vzDeg ?? o.vzDeg;
    const sd = correctedSd.get(o.id) ?? (ov?.sdM ?? o.sdM);

    // ------- final sigma per scalar observation
    const dApprox = Math.max(1, sd);
    const centering2 = adj.useCenteringErrors
      ? ((instrument.instrumentCenteringErrMm / 1000) ** 2 + (instrument.targetCenteringErrMm / 1000) ** 2)
      : 0;
    const hzSigma = Math.sqrt(
      (instrument.hzAngleStdErrArcSec * ARCSEC2RAD) ** 2 + centering2 / (dApprox * dApprox),
    );
    const vCent2 = adj.useCenteringErrors ? (instrument.verticalCenteringErrMm / 1000) ** 2 : 0;
    const vzSigma = Math.sqrt(
      (instrument.vzAngleStdErrArcSec * ARCSEC2RAD) ** 2 + vCent2 / (dApprox * dApprox),
    );
    const c = (setup?.distanceStdErrMm ?? instrument.distanceStdErrMm) / 1000;
    const p = (setup?.distancePpm ?? instrument.distancePpm) * 1e-6 * dApprox;
    let sdSigma = adj.distanceWeighting === 'additive' ? c + p : Math.sqrt(c * c + p * p);
    sdSigma = Math.sqrt(sdSigma * sdSigma + centering2);

    const isProtected = protectedIds.has(o.id);
    const mk = (kind: 'hz' | 'vz' | 'sd', value: number, sigma: number) => {
      const id = `${o.id}:${kind}`;
      if (excluded.has(id) || excluded.has(o.id)) return;
      engineObs.push({
        id, rawObservationId: o.id, stationId: o.stationId,
        targetId: engineName, kind, value, sigma,
        instrumentHeightM: station.instrumentHeightM, targetHeightM: targetHeight,
        protected: isProtected || protectedIds.has(id),
      });
    };
    mk('hz', hzDeg * DEG2RAD, hzSigma);
    mk('vz', vzDeg * DEG2RAD, vzSigma);
    mk('sd', sd, sdSigma);
  }

  log(`Prepared ${engineObs.length} scalar observations, ${constraints.length} constraint pseudo-observations, ${points.filter((p) => p.free).length} free points`);

  // ----------------------------------------------- auto-correction loop ----
  const autoOn = input.autoCorrection ?? adj.autoCorrectionEnabled;
  const attempts: AdjustmentAttempt[] = [];
  const removedIds: string[] = [];
  let currentObs = engineObs.slice();
  let attemptNo = 0;
  let lastResult: AdjustResult | null = null;

  const maxAttempts = autoOn ? Math.max(1, adj.maxAutoCorrectionAttempts + 1) : 1;
  while (attemptNo < maxAttempts) {
    const started = new Date().toISOString();
    const result = adjustNetwork(currentObs, points, constraints, {
      convergenceThresholdM: adj.convergenceThresholdM,
      maxIterations: adj.maxIterations,
      chiSquareSignificance: adj.chiSquareSignificance,
      confidenceLevel: adj.confidenceLevel,
      errorPropagation: adj.errorPropagation,
      geometricConstraints,
    });
    lastResult = result;
    attempts.push(buildAttempt(attemptNo, started, result, engineObs, currentObs, removedIds, input, prepWarnings, adj, corrections));
    log(`Attempt ${attemptNo}: ${result.ok ? '' : 'FAILED - ' + result.failureReason + '; '}SSR=${fmt(result.weightedSSR)} dof=${result.degreesOfFreedom} chi2=${result.chiSquarePassed ? 'PASS' : 'FAIL'} maxStdRes=${fmt(result.maxStdResidual)}`);

    if (!result.ok) break;
    const needsCorrection = !result.chiSquarePassed || result.maxStdResidual > adj.stdResThreshold;
    if (!autoOn || !needsCorrection) break;
    if (attemptNo + 1 >= maxAttempts) { log('Auto-correction attempt limit reached'); break; }

    // candidates: worst standardized residuals above threshold, not protected
    const candidates = result.residuals
      .filter((r) => r.kind !== 'constraint' && r.stdResidual > adj.stdResThreshold)
      .filter((r) => !currentObs.find((o) => o.id === r.obsId)?.protected)
      .sort((a, b) => b.stdResidual - a.stdResidual)
      .slice(0, Math.max(1, adj.removalsPerIteration));
    if (candidates.length === 0) { log('No removable outlier found (all protected or below threshold)'); break; }
    if (removedIds.length + candidates.length > adj.maxRemovedObservations) {
      log(`Would exceed max removed observations (${adj.maxRemovedObservations}) - stopping`); break;
    }
    if ((removedIds.length + candidates.length) / engineObs.length > adj.maxRemovedRatio) {
      log(`Would exceed max removed ratio (${(adj.maxRemovedRatio * 100).toFixed(0)}%) - stopping`); break;
    }
    const nextObs = currentObs.filter((o) => !candidates.some((c) => c.obsId === o.id));
    // never let the network become under-determined
    const futureDof = nextObs.length + constraints.length - result.nUnknowns;
    if (futureDof < adj.minDegreesOfFreedom) {
      log(`Removal would drop degrees of freedom below ${adj.minDegreesOfFreedom} - stopping`); break;
    }
    for (const cnd of candidates) {
      removedIds.push(cnd.obsId);
      log(`Auto-correction: removed ${cnd.obsId} (stdRes=${fmt(cnd.stdResidual)} > ${adj.stdResThreshold})`);
    }
    currentObs = nextObs;
    attemptNo += 1;
  }

  const final = attempts.length - 1;
  const ok = lastResult?.ok ?? false;
  return {
    ok,
    failureReason: lastResult?.failureReason,
    corrections,
    attempts,
    finalAttempt: final,
    engineReturnCode: ok ? 0 : 2,
    logs,
    preparationWarnings: prepWarnings,
  };
}

function fmt(x: number): string {
  return Number.isFinite(x) ? x.toFixed(3) : 'n/a';
}

function buildAttempt(
  attemptNumber: number,
  startedAt: string,
  result: AdjustResult,
  allObs: EngineObservation[],
  usedObs: EngineObservation[],
  removedIds: string[],
  input: RunnerInput,
  prepWarnings: string[],
  adj: AdjustmentTemplate,
  corrections: CorrectionTrace[],
): AdjustmentAttempt {
  const usedSet = new Set(usedObs.map((o) => o.id));
  const residualByObs = new Map(result.residuals.map((r) => [r.obsId, r]));

  const observations: ObservationUsage[] = allObs.map((o) => {
    const r = residualByObs.get(o.id);
    return {
      observationId: o.id,
      stationId: o.stationId,
      targetId: o.targetId,
      kind: o.kind,
      used: usedSet.has(o.id),
      excludedAtAttempt: removedIds.includes(o.id) ? attemptNumber : undefined,
      exclusionReason: removedIds.includes(o.id) ? 'auto-correction: standardized residual above threshold' : undefined,
      protected: o.protected,
      sigma: o.sigma,
      residual: r?.residual,
      stdResidual: r?.stdResidual,
    };
  });

  // rays per target for redundancy flags
  const raysByTarget = new Map<string, Set<string>>();
  for (const o of usedObs) {
    const set = raysByTarget.get(o.targetId) ?? new Set<string>();
    set.add(`${o.stationId}|${o.rawObservationId}`);
    raysByTarget.set(o.targetId, set);
  }

  const provisional = input.provisional;
  const ppByEngine = new Map(input.targets.map((t) =>
    [resolveEngineName(t, input.physicalPoints ?? []), t.physicalPointId] as const));
  const coordinates: AdjustedCoordinate[] = result.points
    .filter((p) => p.role !== 'station' || input.stations.find((s) => s.id === p.id)?.adjustable)
    .map((p) => {
      const prov = provisional[p.id];
      const rays = raysByTarget.get(p.id)?.size ?? 0;
      return {
        targetId: p.id,
        physicalPointId: ppByEngine.get(p.id),
        role: p.role === 'station' ? 'auxiliary' : p.role,
        easting: p.e, northing: p.n, height: p.h,
        sigmaE: p.sigmaE, sigmaN: p.sigmaN, sigmaH: p.sigmaH,
        ellipseSemiMajorM: p.ellipseSemiMajorM,
        ellipseSemiMinorM: p.ellipseSemiMinorM,
        ellipseOrientationDeg: p.ellipseOrientationDeg,
        dE: prov ? p.e - prov.e : undefined,
        dN: prov ? p.n - prov.n : undefined,
        dH: prov ? p.h - prov.h : undefined,
        nObservations: p.nObservations,
        redundant: rays >= 2,
      };
    });

  const singleRay = [...raysByTarget.entries()]
    .filter(([id, rays]) => rays.size < 2 && !input.references.some((r) => r.pointId === id))
    .map(([id]) => id);

  const warnings: string[] = [...prepWarnings];
  if (!result.converged && result.ok) warnings.push('Adjustment did not converge within the iteration limit');
  if (result.rankDeficiency > 0) warnings.push(`Rank deficiency on: ${result.deficientUnknowns.join(', ')}`);
  if (singleRay.length) warnings.push(`Targets computed from a single ray (uncontrolled): ${singleRay.join(', ')}`);
  if (!result.chiSquarePassed && result.ok) warnings.push('Chi-square test failed');

  const ellipses = coordinates.map((c) => c.ellipseSemiMajorM).filter((x) => Number.isFinite(x));
  const maxEllipse = ellipses.length ? Math.max(...ellipses) : 0;
  const meanEllipse = ellipses.length ? ellipses.reduce((a, b) => a + b, 0) / ellipses.length : 0;

  const constrainedComponents = input.references.reduce((acc, r) =>
    acc + (r.modeE !== 'free' ? 1 : 0) + (r.modeN !== 'free' ? 1 : 0) + (r.modeH !== 'free' ? 1 : 0), 0);

  const blockers: string[] = [];
  if (!result.ok) blockers.push(result.failureReason ?? 'technical failure');
  if (!result.converged) blockers.push('not converged');
  if (!result.chiSquarePassed) blockers.push('chi-square failed');
  if (result.degreesOfFreedom < adj.minDegreesOfFreedom) blockers.push(`degrees of freedom < ${adj.minDegreesOfFreedom}`);
  if (maxEllipse * 1000 > adj.maxEllipseSemiMajorMm) blockers.push(`max ellipse ${(maxEllipse * 1000).toFixed(1)} mm > ${adj.maxEllipseSemiMajorMm} mm`);

  const quality: QualityReport = {
    nObservations: result.nObservations,
    nConstraints: result.nConstraints,
    nUnknowns: result.nUnknowns,
    degreesOfFreedom: result.degreesOfFreedom,
    weightedSSR: result.weightedSSR,
    varianceFactor: result.varianceFactor,
    totalErrorFactor: result.totalErrorFactor,
    errorFactorByType: result.errorFactorByType,
    chiSquareLower: result.chiSquareLower,
    chiSquareUpper: result.chiSquareUpper,
    chiSquarePassed: result.chiSquarePassed,
    chiSquareValue: result.weightedSSR,
    converged: result.converged,
    iterations: result.iterations,
    rank: result.rank,
    rankDeficiency: result.rankDeficiency,
    rankExplanation: result.rankDeficiency > 0
      ? `Unresolved components: ${result.deficientUnknowns.join(', ')}` : undefined,
    maxStdResidual: result.maxStdResidual,
    maxStdResidualObs: result.maxStdResidualObs?.obsId,
    maxEllipseSemiMajorM: maxEllipse,
    meanEllipseSemiMajorM: meanEllipse,
    referencesUsed: input.references.length,
    constrainedComponents,
    singleRayTargets: singleRay,
    warnings,
    publishable: blockers.length === 0,
    publicationBlockers: blockers,
  };

  return {
    attemptNumber,
    startedAt,
    removedObservationIds: removedIds.slice(),
    removalReason: removedIds.length ? 'standardized residual above threshold' : undefined,
    quality,
    coordinates,
    observations,
  };
}

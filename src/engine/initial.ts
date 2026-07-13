// ---------------------------------------------------------------------------
// Initial / provisional coordinates (wizard step 6).
// 1. correct distances (prism + atmosphere) for the selected period
// 2. compute each station's initial orientation from known references
//    (weighted circular mean of azimuth(station, ref) - observedDirection)
// 3. transform polar observations into E/N/H
// 4. combine multi-station estimates and report spreads
// ---------------------------------------------------------------------------

import type {
  CorrectionTrace, ProvisionalCoordinate, RawObservation, ReferencePoint, Station,
} from '../types/domain';
import { DEG2RAD, azimuth, circularMean, circularSpread, polarToEnh, wrapPi } from './geometry';

export interface StationOrientation {
  stationId: string;
  orientationRad?: number;
  nReferencesUsed: number;
  spreadRad: number;
  referencesUsed: string[];
  problems: string[];
  source?: 'known-references' | 'fixed-anchor' | 'network-resection';
  estimatedE?: number;
  estimatedN?: number;
  estimatedH?: number;
}

export interface InitialComputationInput {
  observations: RawObservation[];              // already filtered to the period
  corrections: Map<string, CorrectionTrace>;   // by observation id
  stations: Station[];
  references: ReferencePoint[];
  /**
   * `${stationId}|${rawName}` -> resolved engine name (via the physical
   * point identity). Keyed per station because the same field name on two
   * stations may be two different physical points, and different field
   * names may resolve to one shared point.
   */
  nameMap: Map<string, string>;
  /** engine name -> target height (m) */
  targetHeights: Map<string, number>;
  /** engine names of points treated as known references */
  referenceIds: Set<string>;
  /** station|rawTarget keys expected in the initialization sample */
  expectedObservationKeys?: Set<string>;
  /** optional station orientations fixed only for network initialization */
  fixedOrientations?: Map<string, number>;
  epochFrom: string;
  epochTo: string;
}

export interface InitialComputationResult {
  orientations: StationOrientation[];
  provisional: ProvisionalCoordinate[];
  failures: { targetId: string; reason: string }[];
  coverage: InitialCoverage;
}

export interface InitialCoverage {
  observationsUsed: number;
  representativeObservations: number;
  expectedStationTargets: number;
  availableStationTargets: number;
  stationTargetCoveragePercent: number;
  expectedPhysicalPoints: number;
  availablePhysicalPoints: number;
  physicalPointCoveragePercent: number;
  missingStationTargets: string[];
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function circularMedianDeg(values: number[]): number {
  if (values.length === 0) return NaN;
  const radians = values.map((value) => value * DEG2RAD);
  const centre = circularMean(radians) ?? radians[0];
  const unwrapped = radians.map((value) => centre + wrapPi(value - centre));
  const result = median(unwrapped) * 180 / Math.PI;
  return ((result % 360) + 360) % 360;
}

export function initializationCoverage(
  observations: RawObservation[], expectedKeys: Set<string>, nameMap: Map<string, string>,
): InitialCoverage {
  const availableKeys = new Set(observations.map((observation) =>
    `${observation.stationId}|${observation.rawTargetName}`));
  const expectedPoints = new Set([...expectedKeys].map((key) => nameMap.get(key) ?? key));
  const availablePoints = new Set([...availableKeys]
    .filter((key) => expectedKeys.has(key)).map((key) => nameMap.get(key) ?? key));
  const availableStationTargets = [...expectedKeys].filter((key) => availableKeys.has(key)).length;
  const pct = (available: number, expected: number) => expected > 0 ? 100 * available / expected : 0;
  return {
    observationsUsed: observations.length,
    representativeObservations: availableStationTargets,
    expectedStationTargets: expectedKeys.size,
    availableStationTargets,
    stationTargetCoveragePercent: pct(availableStationTargets, expectedKeys.size),
    expectedPhysicalPoints: expectedPoints.size,
    availablePhysicalPoints: availablePoints.size,
    physicalPointCoveragePercent: pct(availablePoints.size, expectedPoints.size),
    missingStationTargets: [...expectedKeys].filter((key) => !availableKeys.has(key)),
  };
}

export function computeInitialCoordinates(input: InitialComputationInput): InitialComputationResult {
  const {
    observations, corrections, stations, references, nameMap, targetHeights, referenceIds,
  } = input;
  const refByName = new Map(references.map((r) => [r.pointId, r]));
  const stationById = new Map(stations.map((s) => [s.id, s]));
  const stationCoordinates = new Map(stations.map((s) => [s.id, { e: s.approxE, n: s.approxN, h: s.approxH }]));

  // Group the complete selected sample, then create one robust representative
  // observation per station-target from component-wise medians. The selected
  // period is source provenance only; it never defines configuration validity.
  const grouped = new Map<string, RawObservation[]>();
  for (const o of observations) {
    const adjName = nameMap.get(`${o.stationId}|${o.rawTargetName}`) ?? o.rawTargetName;
    const key = `${o.stationId}|${adjName}`;
    grouped.set(key, [...(grouped.get(key) ?? []), o]);
  }
  interface Representative { obs: RawObservation; correctedDistanceM: number; nSource: number }
  const byStationTarget = new Map<string, Representative>();
  for (const [key, source] of grouped) {
    const middleEpoch = new Date(median(source.map((observation) => Date.parse(observation.epoch)))).toISOString();
    const template = source[Math.floor(source.length / 2)];
    byStationTarget.set(key, {
      obs: {
        ...template, id: `initial-median:${key}`, epoch: middleEpoch,
        hzDeg: circularMedianDeg(source.map((observation) => observation.hzDeg)),
        vzDeg: median(source.map((observation) => observation.vzDeg)),
        sdM: median(source.map((observation) => observation.sdM)),
      },
      correctedDistanceM: median(source.map((observation) =>
        corrections.get(observation.id)?.finalDistanceM ?? observation.sdM)),
      nSource: source.length,
    });
  }
  const expectedKeys = input.expectedObservationKeys ?? new Set(nameMap.keys());
  const coverage = initializationCoverage(observations, expectedKeys, nameMap);

  // --- station orientations from references
  const orientations: StationOrientation[] = [];
  const orientationByStation = new Map<string, number>();
  for (const st of stations) {
    const fixed = input.fixedOrientations?.get(st.id);
    const angles: number[] = [];
    const weights: number[] = [];
    const used: string[] = [];
    const problems: string[] = [];
    for (const [key, representative] of byStationTarget) {
      const obs = representative.obs;
      const [sid, adjName] = key.split('|');
      if (sid !== st.id) continue;
      if (!referenceIds.has(adjName)) continue;
      const ref = refByName.get(adjName);
      if (!ref) { problems.push(`Reference ${adjName} has no known coordinates`); continue; }
      const az = azimuth({ e: st.approxE, n: st.approxN }, { e: ref.easting, n: ref.northing });
      const hzRad = obs.hzDeg * DEG2RAD;
      angles.push(wrapPi(az - hzRad));
      // weight by horizontal distance (longer rays orient better)
      const sd = representative.correctedDistanceM;
      weights.push(Math.max(1, sd));
      used.push(adjName);
    }
    const mean = fixed ?? circularMean(angles, weights);
    const spread = mean === undefined ? 0 : circularSpread(angles, mean);
    if (fixed !== undefined) problems.push('Orientation fixed for local-datum initialization');
    else if (mean === undefined) problems.push('No reference observed from this station: trying network resection');
    else if (angles.length < 2) problems.push('Single reference used: orientation not controlled');
    orientations.push({
      stationId: st.id,
      orientationRad: mean,
      nReferencesUsed: angles.length,
      spreadRad: spread,
      referencesUsed: used,
      problems,
      source: fixed !== undefined ? 'fixed-anchor' : mean !== undefined ? 'known-references' : undefined,
      estimatedE: st.approxE,
      estimatedN: st.approxN,
      estimatedH: st.approxH,
    });
    if (mean !== undefined) orientationByStation.set(st.id, mean);
  }

  // --- polar -> ENH per station, then combine
  interface Estimate { stationId: string; e: number; n: number; h: number; obs: RawObservation; nObs: number }
  const estimates = new Map<string, Estimate[]>();
  const failures: { targetId: string; reason: string }[] = [];

  const radiatedStations = new Set<string>();
  const radiateStation = (sid: string) => {
    if (radiatedStations.has(sid)) return;
    const st = stationById.get(sid);
    const station = stationCoordinates.get(sid);
    const orientation = orientationByStation.get(sid);
    if (!st || !station || orientation === undefined) return;
    for (const [key, representative] of byStationTarget) {
      const obs = representative.obs;
      const [obsStation, adjName] = key.split('|');
      if (obsStation !== sid) continue;
      const sd = representative.correctedDistanceM;
      const enh = polarToEnh({
        station,
        instrumentHeightM: st.instrumentHeightM,
        targetHeightM: targetHeights.get(adjName) ?? 0,
        slopeDistanceM: sd,
        hzRad: obs.hzDeg * DEG2RAD,
        vzRad: obs.vzDeg * DEG2RAD,
        orientationRad: orientation,
      });
      const list = estimates.get(adjName) ?? [];
      list.push({ stationId: sid, ...enh, obs, nObs: representative.nSource });
      estimates.set(adjName, list);
    }
    radiatedStations.add(sid);
  };
  for (const stationId of orientationByStation.keys()) radiateStation(stationId);

  // Propagate a local datum through common physical points. Once one fixed or
  // referenced station has radiated two shared points, another station can be
  // resected from the corresponding corrected horizontal distances.
  const knownCoordinates = () => {
    const known = new Map<string, { e: number; n: number; h: number }>();
    for (const ref of references) known.set(ref.pointId, { e: ref.easting, n: ref.northing, h: ref.height });
    for (const [name, list] of estimates) {
      if (known.has(name)) continue;
      known.set(name, {
        e: median(list.map((item) => item.e)),
        n: median(list.map((item) => item.n)),
        h: median(list.map((item) => item.h)),
      });
    }
    return known;
  };

  for (let pass = 0; pass < stations.length; pass++) {
    let progressed = false;
    const known = knownCoordinates();
    for (const st of stations) {
      if (orientationByStation.has(st.id)) continue;
      const ties: ResectionTie[] = [];
      for (const [key, representative] of byStationTarget) {
        const obs = representative.obs;
        const [sid, adjName] = key.split('|');
        if (sid !== st.id) continue;
        const target = known.get(adjName);
        if (!target) continue;
        const sd = representative.correctedDistanceM;
        ties.push({
          id: adjName, target, obs,
          horizontalM: Math.abs(sd * Math.sin(obs.vzDeg * DEG2RAD)),
          stationHeightM: target.h - st.instrumentHeightM
            - sd * Math.cos(obs.vzDeg * DEG2RAD) + (targetHeights.get(adjName) ?? 0),
        });
      }
      const solution = resectStation(ties, { e: st.approxE, n: st.approxN });
      if (!solution) continue;
      stationCoordinates.set(st.id, { e: solution.e, n: solution.n, h: solution.h });
      orientationByStation.set(st.id, solution.orientationRad);
      const record = orientations.find((item) => item.stationId === st.id)!;
      record.orientationRad = solution.orientationRad;
      record.nReferencesUsed = ties.length;
      record.referencesUsed = ties.map((tie) => tie.id);
      record.spreadRad = solution.orientationSpreadRad;
      record.problems = ties.length < 3 ? ['Network resection uses only two common points'] : [];
      record.source = 'network-resection';
      record.estimatedE = solution.e;
      record.estimatedN = solution.n;
      record.estimatedH = solution.h;
      radiateStation(st.id);
      progressed = true;
    }
    if (!progressed) break;
  }

  for (const st of stations.filter((station) => !orientationByStation.has(station.id))) {
    failures.push({ targetId: st.id, reason: `Station ${st.id} could not be oriented or resected: provide coordinates/references or two common points` });
  }

  const provisional: ProvisionalCoordinate[] = [];
  const now = new Date().toISOString();
  for (const [adjName, list] of estimates) {
    if (referenceIds.has(adjName)) continue; // references are already known
    const e = median(list.map((item) => item.e));
    const n = median(list.map((item) => item.n));
    const h = median(list.map((item) => item.h));
    let spreadH = 0; let spreadV = 0;
    for (const x of list) {
      spreadH = Math.max(spreadH, Math.hypot(x.e - e, x.n - n));
      spreadV = Math.max(spreadV, Math.abs(x.h - h));
    }
    provisional.push({
      targetId: adjName,
      easting: e, northing: n, height: h,
      nObservations: list.reduce((sum, item) => sum + item.nObs, 0),
      perStation: list.map((x) => ({
        stationId: x.stationId, easting: x.e, northing: x.n, height: x.h, nObs: x.nObs,
      })),
      spreadHorizontalM: spreadH,
      spreadVerticalM: spreadV,
      status: 'computed',
      computedAt: now,
      epochFrom: input.epochFrom,
      epochTo: input.epochTo,
    });
  }

  return { orientations, provisional, failures, coverage };
}

interface ResectionTie {
  id: string;
  target: { e: number; n: number; h: number };
  obs: RawObservation;
  horizontalM: number;
  stationHeightM: number;
}

function resectStation(
  ties: ResectionTie[], approximate: { e: number; n: number },
): { e: number; n: number; h: number; orientationRad: number; orientationSpreadRad: number } | undefined {
  if (ties.length < 2) return undefined;
  const candidates: { e: number; n: number }[] = [];
  for (let i = 0; i < ties.length; i++) {
    for (let j = i + 1; j < ties.length; j++) {
      candidates.push(...circleIntersections(ties[i].target, ties[i].horizontalM, ties[j].target, ties[j].horizontalM));
    }
  }
  if (candidates.length === 0) return undefined;
  const score = (candidate: { e: number; n: number }) => ties.reduce((sum, tie) => {
    const residual = Math.hypot(candidate.e - tie.target.e, candidate.n - tie.target.n) - tie.horizontalM;
    return sum + residual * residual;
  }, 0) + 1e-10 * Math.hypot(candidate.e - approximate.e, candidate.n - approximate.n) ** 2;
  const best = candidates.sort((a, b) => score(a) - score(b))[0];
  const angles = ties.map((tie) => wrapPi(
    azimuth(best, tie.target) - tie.obs.hzDeg * DEG2RAD));
  const orientationRad = circularMean(angles);
  if (orientationRad === undefined) return undefined;
  return {
    ...best,
    h: ties.reduce((sum, tie) => sum + tie.stationHeightM, 0) / ties.length,
    orientationRad,
    orientationSpreadRad: circularSpread(angles, orientationRad),
  };
}

function circleIntersections(
  a: { e: number; n: number }, ra: number,
  b: { e: number; n: number }, rb: number,
): { e: number; n: number }[] {
  const de = b.e - a.e; const dn = b.n - a.n;
  const d = Math.hypot(de, dn);
  if (d < 1e-9 || d > ra + rb + 0.05 || d < Math.abs(ra - rb) - 0.05) return [];
  const x = (ra * ra - rb * rb + d * d) / (2 * d);
  const h2 = Math.max(0, ra * ra - x * x);
  const h = Math.sqrt(h2);
  const e0 = a.e + x * de / d; const n0 = a.n + x * dn / d;
  const pe = -dn / d; const pn = de / d;
  return h < 1e-9
    ? [{ e: e0, n: n0 }]
    : [{ e: e0 + h * pe, n: n0 + h * pn }, { e: e0 - h * pe, n: n0 - h * pn }];
}

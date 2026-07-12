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
  epochFrom: string;
  epochTo: string;
}

export interface InitialComputationResult {
  orientations: StationOrientation[];
  provisional: ProvisionalCoordinate[];
  failures: { targetId: string; reason: string }[];
}

export function computeInitialCoordinates(input: InitialComputationInput): InitialComputationResult {
  const {
    observations, corrections, stations, references, nameMap, targetHeights, referenceIds,
  } = input;
  const refByName = new Map(references.map((r) => [r.pointId, r]));
  const stationById = new Map(stations.map((s) => [s.id, s]));

  // group observations by station, keep latest per (station, target) in period
  const byStationTarget = new Map<string, RawObservation>();
  for (const o of observations) {
    const adjName = nameMap.get(`${o.stationId}|${o.rawTargetName}`) ?? o.rawTargetName;
    const key = `${o.stationId}|${adjName}`;
    const prev = byStationTarget.get(key);
    if (!prev || new Date(o.epoch) > new Date(prev.epoch)) byStationTarget.set(key, o);
  }

  // --- station orientations from references
  const orientations: StationOrientation[] = [];
  const orientationByStation = new Map<string, number>();
  for (const st of stations) {
    const angles: number[] = [];
    const weights: number[] = [];
    const used: string[] = [];
    const problems: string[] = [];
    for (const [key, obs] of byStationTarget) {
      const [sid, adjName] = key.split('|');
      if (sid !== st.id) continue;
      if (!referenceIds.has(adjName)) continue;
      const ref = refByName.get(adjName);
      if (!ref) { problems.push(`Reference ${adjName} has no known coordinates`); continue; }
      const az = azimuth({ e: st.approxE, n: st.approxN }, { e: ref.easting, n: ref.northing });
      const hzRad = obs.hzDeg * DEG2RAD;
      angles.push(wrapPi(az - hzRad));
      // weight by horizontal distance (longer rays orient better)
      const corr = corrections.get(obs.id);
      const sd = corr ? corr.finalDistanceM : obs.sdM;
      weights.push(Math.max(1, sd));
      used.push(adjName);
    }
    const mean = circularMean(angles, weights);
    const spread = mean === undefined ? 0 : circularSpread(angles, mean);
    if (mean === undefined) problems.push('No reference observed from this station: orientation impossible');
    else if (angles.length < 2) problems.push('Single reference used: orientation not controlled');
    orientations.push({
      stationId: st.id,
      orientationRad: mean,
      nReferencesUsed: angles.length,
      spreadRad: spread,
      referencesUsed: used,
      problems,
    });
    if (mean !== undefined) orientationByStation.set(st.id, mean);
  }

  // --- polar -> ENH per station, then combine
  interface Estimate { stationId: string; e: number; n: number; h: number; obs: RawObservation }
  const estimates = new Map<string, Estimate[]>();
  const failures: { targetId: string; reason: string }[] = [];

  for (const [key, obs] of byStationTarget) {
    const [sid, adjName] = key.split('|');
    const st = stationById.get(sid);
    if (!st) continue;
    const orientation = orientationByStation.get(sid);
    if (orientation === undefined) {
      failures.push({ targetId: adjName, reason: `Station ${sid} could not be oriented (no visible reference)` });
      continue;
    }
    const corr = corrections.get(obs.id);
    const sd = corr ? corr.finalDistanceM : obs.sdM;
    const enh = polarToEnh({
      station: { e: st.approxE, n: st.approxN, h: st.approxH },
      instrumentHeightM: st.instrumentHeightM,
      targetHeightM: targetHeights.get(adjName) ?? 0,
      slopeDistanceM: sd,
      hzRad: obs.hzDeg * DEG2RAD,
      vzRad: obs.vzDeg * DEG2RAD,
      orientationRad: orientation,
    });
    const list = estimates.get(adjName) ?? [];
    list.push({ stationId: sid, ...enh, obs });
    estimates.set(adjName, list);
  }

  const provisional: ProvisionalCoordinate[] = [];
  const now = new Date().toISOString();
  for (const [adjName, list] of estimates) {
    if (referenceIds.has(adjName)) continue; // references are already known
    const e = list.reduce((s, x) => s + x.e, 0) / list.length;
    const n = list.reduce((s, x) => s + x.n, 0) / list.length;
    const h = list.reduce((s, x) => s + x.h, 0) / list.length;
    let spreadH = 0; let spreadV = 0;
    for (const x of list) {
      spreadH = Math.max(spreadH, Math.hypot(x.e - e, x.n - n));
      spreadV = Math.max(spreadV, Math.abs(x.h - h));
    }
    provisional.push({
      targetId: adjName,
      easting: e, northing: n, height: h,
      nObservations: list.length,
      perStation: list.map((x) => ({
        stationId: x.stationId, easting: x.e, northing: x.n, height: x.h, nObs: 1,
      })),
      spreadHorizontalM: spreadH,
      spreadVerticalM: spreadV,
      status: 'computed',
      computedAt: now,
      epochFrom: input.epochFrom,
      epochTo: input.epochTo,
    });
  }

  return { orientations, provisional, failures };
}

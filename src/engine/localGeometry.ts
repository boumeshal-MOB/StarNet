import type { RawObservation, Station, StationPrismSetup, TargetMapping } from '../types/domain';

export interface LocalPoint {
  targetId: string;
  stationId: string;
  e: number;
  n: number;
  h: number;
}

export interface SeedPair { aTargetId: string; bTargetId: string }

export interface GeometryCandidate {
  aTargetId: string;
  bTargetId: string;
  horizontalResidualM: number;
  verticalResidualM: number;
  residual3dM: number;
  confidence: number;
  seed: boolean;
}

export interface GeometryCheck {
  status: 'insufficient' | 'weak' | 'ready';
  message: string;
  candidates: GeometryCandidate[];
  rmsM?: number;
}

/** Build station-local coordinates from the most recent observation of each target. */
export function localPoints(
  stationId: string,
  observations: RawObservation[],
  stations: Station[],
  targets: TargetMapping[],
  setups: StationPrismSetup[],
): LocalPoint[] {
  const station = stations.find((item) => item.id === stationId);
  if (!station) return [];
  const latest = new Map<string, RawObservation>();
  for (const observation of observations.filter((item) => item.stationId === stationId)) {
    const previous = latest.get(observation.rawTargetName);
    if (!previous || Date.parse(observation.epoch) > Date.parse(previous.epoch)) {
      latest.set(observation.rawTargetName, observation);
    }
  }
  return targets.filter((target) => target.stationIds.includes(stationId)).flatMap((target) => {
    const observation = latest.get(target.rawName);
    if (!observation) return [];
    const setup = setups.find((item) => item.stationId === stationId && item.targetKey === target.rawName);
    const prismDelta = setup?.measurementType === 'reflectorless' ? 0
      : (setup?.effectiveConstantM ?? 0) - (setup?.constantAppliedByStationM ?? 0);
    const sd = observation.sdM + prismDelta;
    const hz = observation.hzDeg * Math.PI / 180;
    const vz = observation.vzDeg * Math.PI / 180;
    const horizontal = sd * Math.sin(vz);
    return [{
      targetId: target.id,
      stationId,
      e: horizontal * Math.sin(hz),
      n: horizontal * Math.cos(hz),
      h: station.instrumentHeightM + sd * Math.cos(vz) - (setup?.targetHeightM ?? target.targetHeightM),
    }];
  });
}

/**
 * Compare two station-local point clouds after a rigid yaw + ENH translation.
 * Two manual common points solve the four local-frame unknowns but provide no
 * redundancy; three well-spread points are therefore the recommended default.
 */
export function checkLocalGeometry(
  a: LocalPoint[], b: LocalPoint[], seeds: SeedPair[], horizontalToleranceM = 0.05,
  verticalToleranceM = 0.05,
): GeometryCheck {
  if (seeds.length < 2) {
    return { status: 'insufficient', message: 'Select at least two common points. One point leaves the relative orientation undetermined.', candidates: [] };
  }
  const aBy = new Map(a.map((point) => [point.targetId, point]));
  const bBy = new Map(b.map((point) => [point.targetId, point]));
  const valid = seeds.flatMap((seed) => {
    const pa = aBy.get(seed.aTargetId); const pb = bBy.get(seed.bTargetId);
    return pa && pb ? [{ pa, pb }] : [];
  });
  if (valid.length < 2) return { status: 'insufficient', message: 'Two seed pairs with observations are required.', candidates: [] };

  const ca = valid.reduce((s, pair) => ({ e: s.e + pair.pa.e, n: s.n + pair.pa.n, h: s.h + pair.pa.h }), { e: 0, n: 0, h: 0 });
  const cb = valid.reduce((s, pair) => ({ e: s.e + pair.pb.e, n: s.n + pair.pb.n, h: s.h + pair.pb.h }), { e: 0, n: 0, h: 0 });
  for (const c of [ca, cb]) { c.e /= valid.length; c.n /= valid.length; c.h /= valid.length; }
  let dot = 0; let cross = 0;
  for (const { pa, pb } of valid) {
    const ae = pa.e - ca.e; const an = pa.n - ca.n;
    const be = pb.e - cb.e; const bn = pb.n - cb.n;
    dot += be * ae + bn * an;
    cross += be * an - bn * ae;
  }
  if (Math.hypot(dot, cross) < 1e-9) {
    return { status: 'insufficient', message: 'The selected points do not define a usable orientation.', candidates: [] };
  }
  const yaw = Math.atan2(cross, dot); const cos = Math.cos(yaw); const sin = Math.sin(yaw);
  const transform = (point: LocalPoint) => ({
    e: ca.e + cos * (point.e - cb.e) - sin * (point.n - cb.n),
    n: ca.n + sin * (point.e - cb.e) + cos * (point.n - cb.n),
    h: ca.h + point.h - cb.h,
  });

  const candidates: GeometryCandidate[] = [];
  const usedA = new Set<string>();
  const seedKey = new Set(seeds.map((seed) => `${seed.aTargetId}|${seed.bTargetId}`));
  for (const pb of b) {
    const pt = transform(pb);
    let best: { pa: LocalPoint; h: number; v: number; d: number } | undefined;
    for (const pa of a) {
      if (usedA.has(pa.targetId)) continue;
      const h = Math.hypot(pa.e - pt.e, pa.n - pt.n); const v = Math.abs(pa.h - pt.h);
      const d = Math.hypot(h, v);
      if (!best || d < best.d) best = { pa, h, v, d };
    }
    if (!best || best.h > horizontalToleranceM || best.v > verticalToleranceM) continue;
    usedA.add(best.pa.targetId);
    candidates.push({
      aTargetId: best.pa.targetId, bTargetId: pb.targetId,
      horizontalResidualM: best.h, verticalResidualM: best.v, residual3dM: best.d,
      confidence: Math.max(0, Math.min(1, 1 - Math.max(best.h / horizontalToleranceM, best.v / verticalToleranceM))),
      seed: seedKey.has(`${best.pa.targetId}|${pb.targetId}`),
    });
  }
  const rmsM = candidates.length ? Math.sqrt(candidates.reduce((sum, item) => sum + item.residual3dM ** 2, 0) / candidates.length) : undefined;
  const status = valid.length >= 3 ? 'ready' : 'weak';
  return {
    status,
    message: status === 'ready'
      ? `${candidates.length} geometrically compatible pair(s) found. Review before confirming.`
      : `${candidates.length} pair(s) found, but two seed points provide no redundancy. Add a third well-spread common point if possible.`,
    candidates, rmsM,
  };
}

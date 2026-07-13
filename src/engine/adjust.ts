// ---------------------------------------------------------------------------
// 3D non-linear weighted least-squares adjustment (Gauss-Newton).
//
// Unknowns: E/N/H of every free point + one internal horizontal orientation
// per station and direction set (never a hidden permanent constant).
// Observations: horizontal directions (hz), zenith angles (vz), slope
// distances (sd) and constraint pseudo-observations on reference components.
// The system is solved by rank-revealing Householder QR on the weighted
// Jacobian - the normal matrix is never inverted naively.
// ---------------------------------------------------------------------------

import { covarianceFromQr, qrSolve, redundancyNumbers, ellipseFromCov2 } from './linalg';
import { chi2Inv } from './stats';
import { circularMean, wrapPi } from './geometry';

export type ObsKind = 'hz' | 'vz' | 'sd';

export interface EngineObservation {
  id: string;                // scalar observation id: `${rawObsId}:${kind}`
  rawObservationId: string;
  stationId: string;
  targetId: string;
  kind: ObsKind;
  value: number;             // rad for hz/vz, corrected metres for sd
  sigma: number;             // rad or m - final sigma applied
  instrumentHeightM: number;
  targetHeightM: number;
  protected: boolean;
}

export interface EnginePoint {
  id: string;
  e: number; n: number; h: number;
  free: boolean;             // false = held fixed (not an unknown)
  role: 'station' | 'reference' | 'monitoring' | 'auxiliary';
}

export interface EngineConstraint {
  pointId: string;
  component: 'e' | 'n' | 'h';
  value: number;
  sigma: number;
}

export interface EngineGeometricConstraint {
  id: string;
  fromId: string;
  toId: string;
  kind: 'slope-distance' | 'horizontal-distance' | 'height-difference' | 'vector-3d';
  distanceM?: number;
  deltaEM?: number;
  deltaNM?: number;
  deltaHM?: number;
  sigma: number;
}

export interface AdjustOptions {
  convergenceThresholdM: number;
  maxIterations: number;
  chiSquareSignificance: number;   // e.g. 0.05
  confidenceLevel: number;         // e.g. 0.95 for ellipses
  errorPropagation: boolean;       // scale covariance by variance factor
  geometricConstraints?: EngineGeometricConstraint[];
}

export interface ResidualEntry {
  obsId: string;
  rawObservationId: string;
  stationId: string;
  targetId: string;
  kind: ObsKind | 'constraint';
  residual: number;          // observation units (rad or m)
  sigma: number;
  stdResidual: number;       // |v| / (sigma * sqrt(redundancy))
  redundancy: number;
}

export interface AdjustedPointResult {
  id: string;
  role: EnginePoint['role'];
  e: number; n: number; h: number;
  sigmaE: number; sigmaN: number; sigmaH: number;
  covEN: number;
  ellipseSemiMajorM: number;   // scaled to the requested confidence level
  ellipseSemiMinorM: number;
  ellipseOrientationDeg: number;
  nObservations: number;
}

export interface AdjustResult {
  ok: boolean;
  failureReason?: string;
  converged: boolean;
  iterations: number;
  nObservations: number;
  nConstraints: number;
  nUnknowns: number;
  rank: number;
  rankDeficiency: number;
  deficientUnknowns: string[];
  degreesOfFreedom: number;
  weightedSSR: number;
  varianceFactor: number;
  totalErrorFactor: number;
  errorFactorByType: Partial<Record<ObsKind | 'constraint', number>>;
  chiSquareLower: number;
  chiSquareUpper: number;
  chiSquarePassed: boolean;
  points: AdjustedPointResult[];
  orientations: { stationId: string; valueRad: number; sigmaRad: number }[];
  residuals: ResidualEntry[];
  maxStdResidual: number;
  maxStdResidualObs?: ResidualEntry;
}

interface UnknownSlot { name: string; kind: 'coord' | 'orientation' }

export function adjustNetwork(
  observations: EngineObservation[],
  points: EnginePoint[],
  constraints: EngineConstraint[],
  opts: AdjustOptions,
): AdjustResult {
  const pt = new Map(points.map((p) => [p.id, { ...p }]));
  const geometric = opts.geometricConstraints ?? [];
  const geometricRows: { constraint: EngineGeometricConstraint; component: 'e' | 'n' | 'h' | 'distance' }[] = [];
  for (const constraint of geometric) {
    if (constraint.kind === 'vector-3d') {
      geometricRows.push({ constraint, component: 'e' }, { constraint, component: 'n' }, { constraint, component: 'h' });
    } else {
      geometricRows.push({ constraint, component: constraint.kind === 'height-difference' ? 'h' : 'distance' });
    }
  }

  // ------------------------------------------------- unknown parameter map
  const slots: UnknownSlot[] = [];
  const coordIndex = new Map<string, number>(); // pointId -> base index (E,N,H)
  for (const p of points) {
    if (!p.free) continue;
    coordIndex.set(p.id, slots.length);
    slots.push({ name: `${p.id}.E`, kind: 'coord' });
    slots.push({ name: `${p.id}.N`, kind: 'coord' });
    slots.push({ name: `${p.id}.H`, kind: 'coord' });
  }
  const oriIndex = new Map<string, number>();   // stationId -> index
  const stationsWithHz = [...new Set(observations.filter((o) => o.kind === 'hz').map((o) => o.stationId))];
  // initial orientation from current coordinates (weighted circular mean)
  const orientation0 = new Map<string, number>();
  for (const sid of stationsWithHz) {
    const angles: number[] = [];
    for (const o of observations) {
      if (o.kind !== 'hz' || o.stationId !== sid) continue;
      const s = pt.get(sid); const t = pt.get(o.targetId);
      if (!s || !t) continue;
      const az = Math.atan2(t.e - s.e, t.n - s.n);
      angles.push(wrapPi(az - o.value));
    }
    orientation0.set(sid, circularMean(angles) ?? 0);
    oriIndex.set(sid, slots.length);
    slots.push({ name: `${sid}.orientation`, kind: 'orientation' });
  }
  const nUnknowns = slots.length;
  const orientation = new Map(orientation0);

  const missingPoint = observations.find((o) => !pt.has(o.stationId) || !pt.has(o.targetId));
  if (missingPoint) {
    return failed(`Observation ${missingPoint.id} references an unknown point`, nUnknowns, observations.length, constraints.length + geometricRows.length, opts);
  }
  const missingGeometryPoint = geometric.find((constraint) => !pt.has(constraint.fromId) || !pt.has(constraint.toId));
  if (missingGeometryPoint) {
    return failed(`Geometric constraint ${missingGeometryPoint.id} references an unknown point`, nUnknowns,
      observations.length, constraints.length + geometricRows.length, opts);
  }

  // -------------------------------------------------------- iteration loop
  const m = observations.length + constraints.length + geometricRows.length;
  if (m < nUnknowns) {
    return failed(
      `Under-determined system: ${m} observations for ${nUnknowns} unknowns`,
      nUnknowns, observations.length, constraints.length + geometricRows.length, opts,
    );
  }

  let converged = false;
  let iterations = 0;
  let lastQr: ReturnType<typeof qrSolve> | null = null;
  let lastRows: number[][] = [];
  let lastRhs: number[] = [];

  const buildSystem = () => {
    const rows: number[][] = [];
    const rhs: number[] = [];
    for (const o of observations) {
      const s = pt.get(o.stationId)!;
      const t = pt.get(o.targetId)!;
      const dE = t.e - s.e;
      const dN = t.n - s.n;
      const dH = (t.h + o.targetHeightM) - (s.h + o.instrumentHeightM);
      const h2 = dE * dE + dN * dN;
      const h = Math.sqrt(h2);
      const s2 = h2 + dH * dH;
      const sl = Math.sqrt(s2);
      const row = new Array<number>(nUnknowns).fill(0);
      let predicted = 0;
      const iT = coordIndex.get(o.targetId);
      const iS = coordIndex.get(o.stationId);
      if (o.kind === 'hz') {
        const ori = orientation.get(o.stationId) ?? 0;
        predicted = wrapPi(Math.atan2(dE, dN) - ori);
        const dAz_dE = dN / h2;
        const dAz_dN = -dE / h2;
        if (iT !== undefined) { row[iT] += dAz_dE; row[iT + 1] += dAz_dN; }
        if (iS !== undefined) { row[iS] -= dAz_dE; row[iS + 1] -= dAz_dN; }
        const iO = oriIndex.get(o.stationId);
        if (iO !== undefined) row[iO] = -1;
      } else if (o.kind === 'vz') {
        predicted = Math.atan2(h, dH);
        const dV_dh = dH / s2;
        const dV_dH = -h / s2;
        const dh_dE = h > 1e-12 ? dE / h : 0;
        const dh_dN = h > 1e-12 ? dN / h : 0;
        if (iT !== undefined) {
          row[iT] += dV_dh * dh_dE; row[iT + 1] += dV_dh * dh_dN; row[iT + 2] += dV_dH;
        }
        if (iS !== undefined) {
          row[iS] -= dV_dh * dh_dE; row[iS + 1] -= dV_dh * dh_dN; row[iS + 2] -= dV_dH;
        }
      } else {
        predicted = sl;
        if (iT !== undefined) {
          row[iT] += dE / sl; row[iT + 1] += dN / sl; row[iT + 2] += dH / sl;
        }
        if (iS !== undefined) {
          row[iS] -= dE / sl; row[iS + 1] -= dN / sl; row[iS + 2] -= dH / sl;
        }
      }
      let mis = o.value - predicted;
      if (o.kind !== 'sd') mis = wrapPi(mis);
      const w = 1 / o.sigma;
      rows.push(row.map((x) => x * w));
      rhs.push(mis * w);
    }
    for (const c of constraints) {
      const p = pt.get(c.pointId);
      const row = new Array<number>(nUnknowns).fill(0);
      let mis = 0;
      const iP = p ? coordIndex.get(c.pointId) : undefined;
      if (p && iP !== undefined) {
        const off = c.component === 'e' ? 0 : c.component === 'n' ? 1 : 2;
        row[iP + off] = 1;
        const cur = c.component === 'e' ? p.e : c.component === 'n' ? p.n : p.h;
        mis = c.value - cur;
      }
      const w = 1 / c.sigma;
      rows.push(row.map((x) => x * w));
      rhs.push(mis * w);
    }
    for (const { constraint: c, component } of geometricRows) {
      const a = pt.get(c.fromId); const b = pt.get(c.toId);
      const row = new Array<number>(nUnknowns).fill(0);
      let predicted = 0; let expected = 0;
      if (a && b) {
        const dE = b.e - a.e; const dN = b.n - a.n; const dH = b.h - a.h;
        const iA = coordIndex.get(c.fromId); const iB = coordIndex.get(c.toId);
        const assign = (off: number, derivative: number) => {
          if (iB !== undefined) row[iB + off] += derivative;
          if (iA !== undefined) row[iA + off] -= derivative;
        };
        if (component === 'e') { predicted = dE; expected = c.deltaEM ?? 0; assign(0, 1); }
        else if (component === 'n') { predicted = dN; expected = c.deltaNM ?? 0; assign(1, 1); }
        else if (component === 'h') { predicted = dH; expected = c.deltaHM ?? 0; assign(2, 1); }
        else if (c.kind === 'horizontal-distance') {
          predicted = Math.hypot(dE, dN); expected = c.distanceM ?? 0;
          if (predicted > 1e-12) { assign(0, dE / predicted); assign(1, dN / predicted); }
        } else {
          predicted = Math.hypot(dE, dN, dH); expected = c.distanceM ?? 0;
          if (predicted > 1e-12) { assign(0, dE / predicted); assign(1, dN / predicted); assign(2, dH / predicted); }
        }
      }
      const w = 1 / c.sigma;
      rows.push(row.map((value) => value * w));
      rhs.push((expected - predicted) * w);
    }
    return { rows, rhs };
  };

  for (let it = 0; it < opts.maxIterations; it++) {
    iterations = it + 1;
    const { rows, rhs } = buildSystem();
    const qr = qrSolve(rows, rhs);
    lastQr = qr; lastRows = rows; lastRhs = rhs;

    if (qr.rank < nUnknowns) {
      const deficient = qr.deficientColumns.map((j) => slots[j].name);
      return {
        ...failed(
          `Rank deficiency: ${nUnknowns - qr.rank} unresolved component(s). ` +
          'The datum or geometry does not control: ' + deficient.join(', '),
          nUnknowns, observations.length, constraints.length + geometricRows.length, opts,
        ),
        rank: qr.rank,
        rankDeficiency: nUnknowns - qr.rank,
        deficientUnknowns: deficient,
        iterations,
      };
    }

    // apply corrections
    let maxCoordDx = 0;
    let maxOriDx = 0;
    for (const [pid, base] of coordIndex) {
      const p = pt.get(pid)!;
      p.e += qr.x[base];
      p.n += qr.x[base + 1];
      p.h += qr.x[base + 2];
      maxCoordDx = Math.max(maxCoordDx, Math.abs(qr.x[base]), Math.abs(qr.x[base + 1]), Math.abs(qr.x[base + 2]));
    }
    for (const [sid, idx] of oriIndex) {
      orientation.set(sid, wrapPi((orientation.get(sid) ?? 0) + qr.x[idx]));
      maxOriDx = Math.max(maxOriDx, Math.abs(qr.x[idx]));
    }
    if (maxCoordDx < opts.convergenceThresholdM && maxOriDx < 1e-8) {
      converged = true;
      break;
    }
  }

  // final system at the converged solution for residuals and statistics
  const { rows, rhs } = buildSystem();
  const qrF = qrSolve(rows, rhs);
  lastQr = qrF; lastRows = rows; lastRhs = rhs;

  const redund = redundancyNumbers(lastRows, lastQr, nUnknowns);
  let ssr = 0;
  for (const v of lastRhs) ssr += v * v; // rhs is already weighted misclosure = weighted residual (post-fit)
  const dof = m - nUnknowns;
  const varianceFactor = dof > 0 ? ssr / dof : NaN;
  const alpha = opts.chiSquareSignificance;
  const chiLower = dof > 0 ? chi2Inv(alpha / 2, dof) : 0;
  const chiUpper = dof > 0 ? chi2Inv(1 - alpha / 2, dof) : 0;
  const chiPassed = dof > 0 && ssr >= chiLower && ssr <= chiUpper;

  // residual entries (unweighted residual = weightedResidual * sigma)
  const residuals: ResidualEntry[] = [];
  const typeAgg: Partial<Record<ObsKind | 'constraint', { ssr: number; red: number }>> = {};
  const nObsByPoint = new Map<string, number>();
  for (let i = 0; i < m; i++) {
    const isObs = i < observations.length;
    const constraintIndex = i - observations.length;
    const isCoordinateConstraint = !isObs && constraintIndex < constraints.length;
    const kind: ObsKind | 'constraint' = isObs ? observations[i].kind : 'constraint';
    const sigma = isObs ? observations[i].sigma : isCoordinateConstraint
      ? constraints[constraintIndex].sigma : geometricRows[constraintIndex - constraints.length].constraint.sigma;
    const vw = lastRhs[i]; // weighted post-fit misclosure ~ -weighted residual
    const v = vw * sigma;
    const r = redund[i];
    const stdRes = r > 1e-6 ? Math.abs(vw) / Math.sqrt(r) : Math.abs(vw);
    const agg = (typeAgg[kind] ??= { ssr: 0, red: 0 });
    agg.ssr += vw * vw; agg.red += r;
    if (isObs) {
      const o = observations[i];
      residuals.push({
        obsId: o.id, rawObservationId: o.rawObservationId, stationId: o.stationId,
        targetId: o.targetId, kind, residual: v, sigma, stdResidual: stdRes, redundancy: r,
      });
      nObsByPoint.set(o.targetId, (nObsByPoint.get(o.targetId) ?? 0) + 1);
    } else if (isCoordinateConstraint) {
      const c = constraints[i - observations.length];
      residuals.push({
        obsId: `constraint:${c.pointId}.${c.component}`, rawObservationId: '',
        stationId: '', targetId: c.pointId, kind, residual: v, sigma,
        stdResidual: stdRes, redundancy: r,
      });
    } else {
      const g = geometricRows[constraintIndex - constraints.length];
      residuals.push({
        obsId: `geometry:${g.constraint.id}:${g.component}`, rawObservationId: g.constraint.id,
        stationId: g.constraint.fromId, targetId: g.constraint.toId, kind,
        residual: v, sigma, stdResidual: stdRes, redundancy: r,
      });
    }
  }
  const errorFactorByType: AdjustResult['errorFactorByType'] = {};
  for (const k of Object.keys(typeAgg) as (ObsKind | 'constraint')[]) {
    const a = typeAgg[k]!;
    errorFactorByType[k] = a.red > 1e-9 ? Math.sqrt(a.ssr / a.red) : 0;
  }

  // covariance of coordinates
  const sigma02 = opts.errorPropagation && dof > 0 ? Math.max(varianceFactor, 0) : 1;
  const cov = covarianceFromQr(lastQr, nUnknowns, sigma02);
  const confScale = Math.sqrt(chi2Inv(opts.confidenceLevel, 2));

  const outPoints: AdjustedPointResult[] = [];
  for (const p of points) {
    const cur = pt.get(p.id)!;
    const base = coordIndex.get(p.id);
    let sE = 0, sN = 0, sH = 0, cEN = 0;
    if (base !== undefined && cov) {
      sE = Math.sqrt(Math.max(0, cov[base][base]));
      sN = Math.sqrt(Math.max(0, cov[base + 1][base + 1]));
      sH = Math.sqrt(Math.max(0, cov[base + 2][base + 2]));
      cEN = cov[base][base + 1];
    }
    const ell = ellipseFromCov2(sE * sE, sN * sN, cEN);
    outPoints.push({
      id: p.id, role: p.role,
      e: cur.e, n: cur.n, h: cur.h,
      sigmaE: sE, sigmaN: sN, sigmaH: sH, covEN: cEN,
      ellipseSemiMajorM: ell.semiMajor * confScale,
      ellipseSemiMinorM: ell.semiMinor * confScale,
      ellipseOrientationDeg: ell.orientationDegFromNorth,
      nObservations: nObsByPoint.get(p.id) ?? 0,
    });
  }

  const orientationsOut = [...oriIndex.entries()].map(([sid, idx]) => ({
    stationId: sid,
    valueRad: orientation.get(sid) ?? 0,
    sigmaRad: cov ? Math.sqrt(Math.max(0, cov[idx][idx])) : 0,
  }));

  let maxStd = 0;
  let maxEntry: ResidualEntry | undefined;
  for (const r of residuals) {
    if (r.kind === 'constraint') continue;
    if (r.stdResidual > maxStd) { maxStd = r.stdResidual; maxEntry = r; }
  }

  return {
    ok: true,
    converged,
    iterations,
    nObservations: observations.length,
    nConstraints: constraints.length + geometricRows.length,
    nUnknowns,
    rank: lastQr.rank,
    rankDeficiency: nUnknowns - lastQr.rank,
    deficientUnknowns: lastQr.deficientColumns.map((j) => slots[j].name),
    degreesOfFreedom: dof,
    weightedSSR: ssr,
    varianceFactor,
    totalErrorFactor: dof > 0 ? Math.sqrt(Math.max(0, varianceFactor)) : NaN,
    errorFactorByType,
    chiSquareLower: chiLower,
    chiSquareUpper: chiUpper,
    chiSquarePassed: chiPassed,
    points: outPoints,
    orientations: orientationsOut,
    residuals,
    maxStdResidual: maxStd,
    maxStdResidualObs: maxEntry,
  };
}

function failed(
  reason: string, nUnknowns: number, nObs: number, nCon: number, opts: AdjustOptions,
): AdjustResult {
  return {
    ok: false,
    failureReason: reason,
    converged: false,
    iterations: 0,
    nObservations: nObs,
    nConstraints: nCon,
    nUnknowns,
    rank: 0,
    rankDeficiency: nUnknowns,
    deficientUnknowns: [],
    degreesOfFreedom: nObs + nCon - nUnknowns,
    weightedSSR: NaN,
    varianceFactor: NaN,
    totalErrorFactor: NaN,
    errorFactorByType: {},
    chiSquareLower: NaN,
    chiSquareUpper: NaN,
    chiSquarePassed: false,
    points: [],
    orientations: [],
    residuals: [],
    maxStdResidual: 0,
  };
}

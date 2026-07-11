// ---------------------------------------------------------------------------
// Dense linear algebra for the weighted least-squares engine.
// The LSQ solution is computed with a Householder QR factorization with
// column pivoting (rank-revealing). The normal matrix is never inverted
// naively; coordinate covariance is obtained from the R factor.
// ---------------------------------------------------------------------------

export interface QrResult {
  /** solution vector (minimum-norm on the identified rank) */
  x: number[];
  /** numerical rank detected from the pivoted R diagonal */
  rank: number;
  /** column permutation applied by pivoting: column j of R is column perm[j] of A */
  perm: number[];
  /** upper-triangular R factor (rank x n, row-major) */
  r: number[][];
  /** columns (in original indexing) that fell below the rank threshold */
  deficientColumns: number[];
}

/**
 * Solve min ||A x - b|| with Householder QR + column pivoting.
 * A: m x n (m >= n expected), row-major.
 */
export function qrSolve(aIn: number[][], bIn: number[], rankTol = 1e-10): QrResult {
  const m = aIn.length;
  const n = m > 0 ? aIn[0].length : 0;
  const a = aIn.map((row) => row.slice());
  const b = bIn.slice();
  const perm = Array.from({ length: n }, (_, j) => j);

  // squared column norms for pivoting
  const colNorm2 = new Array<number>(n).fill(0);
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let i = 0; i < m; i++) s += a[i][j] * a[i][j];
    colNorm2[j] = s;
  }
  const norm0 = Math.sqrt(Math.max(...colNorm2, 0)) || 1;

  const kMax = Math.min(m, n);
  let rank = 0;

  for (let k = 0; k < kMax; k++) {
    // pivot: column with the largest remaining norm
    let pmax = k;
    for (let j = k + 1; j < n; j++) if (colNorm2[j] > colNorm2[pmax]) pmax = j;
    if (pmax !== k) {
      for (let i = 0; i < m; i++) { const t = a[i][k]; a[i][k] = a[i][pmax]; a[i][pmax] = t; }
      const tp = perm[k]; perm[k] = perm[pmax]; perm[pmax] = tp;
      const tn = colNorm2[k]; colNorm2[k] = colNorm2[pmax]; colNorm2[pmax] = tn;
    }

    // Householder vector for column k
    let alpha = 0;
    for (let i = k; i < m; i++) alpha += a[i][k] * a[i][k];
    alpha = Math.sqrt(alpha);
    if (alpha < rankTol * norm0) break; // remaining columns are numerically zero
    if (a[k][k] > 0) alpha = -alpha;

    const v = new Array<number>(m).fill(0);
    for (let i = k; i < m; i++) v[i] = a[i][k];
    v[k] -= alpha;
    let vNorm2 = 0;
    for (let i = k; i < m; i++) vNorm2 += v[i] * v[i];
    if (vNorm2 === 0) break;

    // apply H = I - 2 v v^T / (v^T v) to A and b
    for (let j = k; j < n; j++) {
      let dot = 0;
      for (let i = k; i < m; i++) dot += v[i] * a[i][j];
      const f = (2 * dot) / vNorm2;
      for (let i = k; i < m; i++) a[i][j] -= f * v[i];
    }
    {
      let dot = 0;
      for (let i = k; i < m; i++) dot += v[i] * b[i];
      const f = (2 * dot) / vNorm2;
      for (let i = k; i < m; i++) b[i] -= f * v[i];
    }
    a[k][k] = alpha;
    for (let i = k + 1; i < m; i++) a[i][k] = 0;

    // update remaining column norms
    for (let j = k + 1; j < n; j++) {
      colNorm2[j] = Math.max(0, colNorm2[j] - a[k][j] * a[k][j]);
    }
    rank = k + 1;
  }

  // rank refinement from R diagonal
  let effRank = 0;
  const rDiag0 = Math.abs(a[0]?.[0] ?? 0) || 1;
  for (let k = 0; k < rank; k++) {
    if (Math.abs(a[k][k]) > rankTol * rDiag0) effRank = k + 1;
    else break;
  }
  rank = effRank;

  // back substitution on the leading rank x rank block
  const y = new Array<number>(n).fill(0);
  for (let i = rank - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < rank; j++) s -= a[i][j] * y[j];
    y[i] = s / a[i][i];
  }
  const x = new Array<number>(n).fill(0);
  for (let j = 0; j < n; j++) x[perm[j]] = y[j];

  const r: number[][] = [];
  for (let i = 0; i < rank; i++) r.push(a[i].slice(0, n));

  const deficientColumns: number[] = [];
  for (let j = rank; j < n; j++) deficientColumns.push(perm[j]);

  return { x, rank, perm, r, deficientColumns };
}

/**
 * Covariance of the parameters: sigma0^2 * (A^T A)^-1 computed from the
 * R factor of the pivoted QR (full-rank case). Returns an n x n matrix in
 * the ORIGINAL column ordering, or null when rank < n.
 */
export function covarianceFromQr(qr: QrResult, n: number, sigma02: number): number[][] | null {
  if (qr.rank < n) return null;
  const r = qr.r;
  // Rinv: invert upper-triangular R (n x n)
  const rinv: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let j = 0; j < n; j++) {
    rinv[j][j] = 1 / r[j][j];
    for (let i = j - 1; i >= 0; i--) {
      let s = 0;
      for (let k = i + 1; k <= j; k++) s += r[i][k] * rinv[k][j];
      rinv[i][j] = -s / r[i][i];
    }
  }
  // C_perm = Rinv * Rinv^T
  const cPerm: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let s = 0;
      for (let k = Math.max(i, j); k < n; k++) s += rinv[i][k] * rinv[j][k];
      cPerm[i][j] = s; cPerm[j][i] = s;
    }
  }
  // un-permute: C[perm[i]][perm[j]] = C_perm[i][j]
  const c: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) c[qr.perm[i]][qr.perm[j]] = sigma02 * cPerm[i][j];
  }
  return c;
}

/**
 * Redundancy numbers r_i = 1 - h_i where h_i is the leverage of weighted
 * row a_i: h_i = || R^-T P^T a_i ||^2 (full-rank case).
 * Rows and R must refer to the same (weighted) system.
 */
export function redundancyNumbers(rows: number[][], qr: QrResult, n: number): number[] {
  const out = new Array<number>(rows.length).fill(1);
  if (qr.rank < n) return out; // fall back to 1 (conservative) when deficient
  const r = qr.r;
  for (let idx = 0; idx < rows.length; idx++) {
    // permuted row
    const ap = new Array<number>(n);
    for (let j = 0; j < n; j++) ap[j] = rows[idx][qr.perm[j]];
    // solve R^T z = ap (forward substitution)
    const z = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      let s = ap[i];
      for (let k = 0; k < i; k++) s -= r[k][i] * z[k];
      z[i] = s / r[i][i];
    }
    let h = 0;
    for (let i = 0; i < n; i++) h += z[i] * z[i];
    out[idx] = Math.min(1, Math.max(0, 1 - h));
  }
  return out;
}

/** eigen decomposition of a symmetric 2x2 matrix -> error ellipse parameters */
export function ellipseFromCov2(cEE: number, cNN: number, cEN: number): {
  semiMajor: number; semiMinor: number; orientationDegFromNorth: number;
} {
  const tr = cEE + cNN;
  const det = cEE * cNN - cEN * cEN;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc;
  const l2 = Math.max(0, tr / 2 - disc);
  // orientation of the major axis measured from North (N axis), clockwise to E
  const theta = 0.5 * Math.atan2(2 * cEN, cNN - cEE);
  let deg = (theta * 180) / Math.PI;
  if (deg < 0) deg += 180;
  return {
    semiMajor: Math.sqrt(Math.max(0, l1)),
    semiMinor: Math.sqrt(Math.max(0, l2)),
    orientationDegFromNorth: deg,
  };
}

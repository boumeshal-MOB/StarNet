import { describe, expect, it } from 'vitest';
import { covarianceFromQr, ellipseFromCov2, qrSolve, redundancyNumbers } from '../linalg';

describe('rank-revealing QR least squares', () => {
  it('solves an overdetermined full-rank system', () => {
    // y = 2x + 1 sampled without noise
    const a = [[1, 0], [1, 1], [1, 2], [1, 3]];
    const b = [1, 3, 5, 7];
    const r = qrSolve(a, b);
    expect(r.rank).toBe(2);
    expect(r.x[0]).toBeCloseTo(1, 10);
    expect(r.x[1]).toBeCloseTo(2, 10);
  });

  it('detects rank deficiency instead of producing a fake solution', () => {
    // second and third columns identical -> rank 2 of 3
    const a = [[1, 1, 1], [1, 2, 2], [1, 3, 3], [1, 4, 4]];
    const b = [1, 2, 3, 4];
    const r = qrSolve(a, b);
    expect(r.rank).toBe(2);
    expect(r.deficientColumns.length).toBe(1);
  });

  it('computes the parameter covariance from the R factor', () => {
    // unweighted mean problem: x = mean(b), var(x) = sigma0^2 / n
    const n = 8;
    const a = Array.from({ length: n }, () => [1]);
    const b = Array.from({ length: n }, (_, i) => 10 + (i % 2 === 0 ? 0.1 : -0.1));
    const r = qrSolve(a, b);
    const cov = covarianceFromQr(r, 1, 1);
    expect(cov).not.toBeNull();
    expect(cov![0][0]).toBeCloseTo(1 / n, 10);
  });

  it('redundancy numbers sum to m - n', () => {
    const a = [[1, 0], [1, 1], [1, 2], [1, 3], [1, 4]];
    const b = [1, 3, 5, 7, 9];
    const r = qrSolve(a, b);
    const red = redundancyNumbers(a, r, 2);
    const sum = red.reduce((s, x) => s + x, 0);
    expect(sum).toBeCloseTo(a.length - 2, 8);
  });
});

describe('error ellipse from 2x2 covariance', () => {
  it('diagonal covariance gives axis-aligned ellipse', () => {
    const e = ellipseFromCov2(4e-6, 1e-6, 0); // sigmaE=2mm > sigmaN=1mm
    expect(e.semiMajor).toBeCloseTo(0.002, 9);
    expect(e.semiMinor).toBeCloseTo(0.001, 9);
    expect(e.orientationDegFromNorth).toBeCloseTo(90, 6); // major axis along E
  });
});

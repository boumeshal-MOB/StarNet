import { describe, expect, it } from 'vitest';
import { chi2Cdf, chi2Inv, ellipseConfidenceScale, normInv } from '../stats';

describe('chi-square distribution', () => {
  it('matches tabulated quantiles', () => {
    expect(chi2Inv(0.95, 10)).toBeCloseTo(18.307, 2);
    expect(chi2Inv(0.05, 10)).toBeCloseTo(3.940, 2);
    expect(chi2Inv(0.975, 34)).toBeCloseTo(51.966, 2);
    expect(chi2Inv(0.025, 34)).toBeCloseTo(19.806, 2);
    expect(chi2Inv(0.99, 1)).toBeCloseTo(6.635, 2);
  });

  it('inverse and CDF are consistent', () => {
    for (const dof of [1, 5, 34, 120]) {
      for (const p of [0.025, 0.5, 0.975]) {
        expect(chi2Cdf(chi2Inv(p, dof), dof)).toBeCloseTo(p, 6);
      }
    }
  });

  it('standard normal quantile', () => {
    expect(normInv(0.975)).toBeCloseTo(1.95996, 4);
    expect(normInv(0.5)).toBeCloseTo(0, 6);
  });

  it('2D confidence scale (95% -> ~2.4477 sigma)', () => {
    expect(ellipseConfidenceScale(0.95)).toBeCloseTo(2.4477, 3);
  });
});

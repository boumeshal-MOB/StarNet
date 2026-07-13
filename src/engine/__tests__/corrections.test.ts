import { describe, expect, it } from 'vitest';
import { atmosphericPpm, correctDistance, isValidEnvironment, lookupEnvironment, prismDelta } from '../corrections';
import type { InstrumentProfile, RawObservation, Station } from '../../types/domain';

const station = (over: Partial<Station> = {}): Station => ({
  id: 'ATS34', name: 'ATS34', instrumentProfileId: 'inst', edmMode: 'P',
  instrumentHeightM: 0, validFrom: '2026-07-08T00:00:00Z',
  distanceState: 'raw', constantAppliedByStationM: 0,
  atmosphericMode: 'none', envToleranceMin: 15,
  defaultTemperatureC: 15, defaultPressureHPa: 1015,
  missingEnvPolicy: 'use-defaults', required: true, adjustable: true,
  approxE: 0, approxN: 0, approxH: 0, ...over,
});

const instrument: InstrumentProfile = {
  id: 'inst', manufacturer: 'Leica', model: 'TM50', edmMode: 'P', version: 1,
  status: 'active', wavelengthNm: 658, distanceStdErrMm: 0.6, distancePpm: 1,
  directionStdErrArcSec: 0.5, hzAngleStdErrArcSec: 0.5, vzAngleStdErrArcSec: 0.5,
  azimuthStdErrArcSec: 0.5, instrumentCenteringErrMm: 0, targetCenteringErrMm: 0,
  verticalCenteringErrMm: 0, defaultInstrumentHeightM: 0,
  atmosphericModel: 'standard-ppm-v1', atmosphericModelVersion: 'v1', notes: '',
};

const obs = (sdM: number): RawObservation => ({
  id: 'o1', stationId: 'ATS34', rawTargetName: 'T1', epoch: '2026-07-08T10:25:00Z',
  recordNumber: 1, hzDeg: 10, vzDeg: 90, sdM,
});

describe('prism correction (workbook validation examples)', () => {
  it('78.4100 m + 8.9 mm = 78.4189 m', () => {
    const t = correctDistance({
      observation: obs(78.41), station: station(),
      setup: { effectiveConstantM: 0.0089, constantAppliedByStationM: 0 },
      instrument, env: { source: 'none', warnings: [] }, datumScale: 1, targetId: 'T1',
    });
    expect(t.distanceAfterPrismM).toBeCloseTo(78.4189, 4);
    expect(t.finalDistanceM).toBeCloseTo(78.4189, 4);
  });

  it('193.5820 m + 30.0 mm = 193.6120 m', () => {
    const t = correctDistance({
      observation: obs(193.582), station: station(),
      setup: { effectiveConstantM: 0.03, constantAppliedByStationM: 0 },
      instrument, env: { source: 'none', warnings: [] }, datumScale: 1, targetId: 'T1',
    });
    expect(t.distanceAfterPrismM).toBeCloseTo(193.612, 4);
  });

  it('4.2138 m + 8.9 mm = 4.2227 m', () => {
    const t = correctDistance({
      observation: obs(4.2138), station: station(),
      setup: { effectiveConstantM: 0.0089, constantAppliedByStationM: 0 },
      instrument, env: { source: 'none', warnings: [] }, datumScale: 1, targetId: 'T1',
    });
    expect(t.distanceAfterPrismM).toBeCloseTo(4.2227, 4);
  });

  it('is differential: constant already applied by the station is not applied twice (scenario F)', () => {
    expect(prismDelta({ effectiveConstantM: 0.0089, constantAppliedByStationM: 0.0089 })).toBeCloseTo(0, 9);
    const t = correctDistance({
      observation: obs(78.4189), station: station({ distanceState: 'prism-corrected', constantAppliedByStationM: 0.0089 }),
      setup: { effectiveConstantM: 0.0089, constantAppliedByStationM: 0.0089 },
      instrument, env: { source: 'none', warnings: [] }, datumScale: 1, targetId: 'T1',
    });
    expect(t.prismDeltaM).toBeCloseTo(0, 9);
    expect(t.finalDistanceM).toBeCloseTo(78.4189, 4);
  });
});

describe('atmospheric correction', () => {
  it('is near zero at the reference atmosphere (~12 degC / 1013 hPa)', () => {
    expect(Math.abs(atmosphericPpm(12, 1013.25))).toBeLessThan(1);
  });

  it('warm low-pressure air lengthens distances (positive ppm)', () => {
    expect(atmosphericPpm(30, 950)).toBeGreaterThan(10);
  });

  it('applies scale after the prism correction and never twice for corrected stations', () => {
    const t = correctDistance({
      observation: obs(100), station: station({ atmosphericMode: 'defaults', defaultTemperatureC: 30, defaultPressureHPa: 950 }),
      setup: { effectiveConstantM: 0.01, constantAppliedByStationM: 0 },
      instrument, env: { source: 'defaults', temperatureC: 30, pressureHPa: 950, warnings: [] },
      datumScale: 1, targetId: 'T1',
    });
    const ppm = atmosphericPpm(30, 950);
    expect(t.distanceAfterPrismM).toBeCloseTo(100.01, 6);
    expect(t.distanceAfterAtmosphereM).toBeCloseTo(100.01 * (1 + ppm * 1e-6), 8);

    const corrected = correctDistance({
      observation: obs(100), station: station({ distanceState: 'fully-corrected' }),
      setup: { effectiveConstantM: 0, constantAppliedByStationM: 0 },
      instrument, env: { source: 'measured', temperatureC: 30, pressureHPa: 950, warnings: [] },
      datumScale: 1, targetId: 'T1',
    });
    expect(corrected.atmosphericScale).toBe(1); // already corrected by the station
  });

  it('does not apply the horizontal datum scale to the slope distance', () => {
    const t = correctDistance({
      observation: obs(100), station: station(),
      setup: { effectiveConstantM: 0, constantAppliedByStationM: 0 },
      instrument, env: { source: 'none', warnings: [] }, datumScale: 0.9996, targetId: 'T1',
    });
    expect(t.finalDistanceM).toBeCloseTo(100, 6);
    expect(t.datumScale).toBe(0.9996);
  });

  it('rejects invalid sensor sentinels and uses the configured fallback', () => {
    expect(isValidEnvironment(-9999, 1013)).toBe(false);
    const s = station({ atmosphericMode: 'automatic', missingEnvPolicy: 'raw-with-warning' });
    const result = lookupEnvironment(s, '2026-07-08T10:25:00Z', [{
      id: 'env-invalid', stationId: 'ATS34', epoch: '2026-07-08T10:24:00Z', temperatureC: -9999, pressureHPa: 1013,
    }]);
    expect(result.source).toBe('none');
    expect(result.warnings.join(' ')).toContain('Invalid T/P');
  });
});

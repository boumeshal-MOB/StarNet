import { describe, expect, it } from 'vitest';
import { computeInitialCoordinates, initializationCoverage } from '../initial';
import type { RawObservation, Station } from '../../types/domain';

function station(id: string, e: number, n: number): Station {
  return {
    id, name: id, processingId: 'test', instrumentProfileId: 'inst', edmMode: 'precise',
    instrumentHeightM: 0, validFrom: '2026-01-01T00:00:00Z', distanceState: 'raw',
    constantAppliedByStationM: 0, atmosphericMode: 'none', envToleranceMin: 0,
    defaultTemperatureC: 15, defaultPressureHPa: 1013, missingEnvPolicy: 'raw-with-warning',
    required: true, adjustable: true, approxE: e, approxN: n, approxH: 0,
  };
}

function observation(id: string, stationId: string, target: string, hzDeg: number): RawObservation {
  return {
    id, stationId, rawTargetName: target, epoch: '2026-01-01T00:00:00Z',
    recordNumber: Number(id.replace(/\D/g, '')) || 1, hzDeg, vzDeg: 90, sdM: Math.sqrt(50),
  };
}

function observationAt(
  id: string, stationId: string, target: string, epoch: string, hzDeg: number, sdM: number,
): RawObservation {
  return { ...observation(id, stationId, target, hzDeg), epoch, sdM };
}

describe('local-datum network initialization', () => {
  it('resects a second station from two physical points radiated by the fixed anchor', () => {
    const observations = [
      observation('o1', 'STA1', 'P1', 45),
      observation('o2', 'STA1', 'P2', 135),
      observation('o3', 'STA2', 'P1', 285), // true orientation = 30°
      observation('o4', 'STA2', 'P2', 195),
    ];
    const result = computeInitialCoordinates({
      observations,
      corrections: new Map(),
      stations: [station('STA1', 0, 0), station('STA2', 9, 0)],
      references: [],
      nameMap: new Map([
        ['STA1|P1', 'P1'], ['STA1|P2', 'P2'],
        ['STA2|P1', 'P1'], ['STA2|P2', 'P2'],
      ]),
      targetHeights: new Map([['P1', 0], ['P2', 0]]),
      referenceIds: new Set(),
      fixedOrientations: new Map([['STA1', 0]]),
      epochFrom: '2026-01-01T00:00:00Z',
      epochTo: '2026-01-01T00:01:00Z',
    });

    const sta2 = result.orientations.find((item) => item.stationId === 'STA2')!;
    expect(sta2.source).toBe('network-resection');
    expect(sta2.estimatedE).toBeCloseTo(10, 6);
    expect(sta2.estimatedN).toBeCloseTo(0, 6);
    expect((sta2.orientationRad ?? 0) * 180 / Math.PI).toBeCloseTo(30, 6);
    expect(result.failures).toEqual([]);
    expect(result.provisional).toHaveLength(2);
  });
});

describe('initialization observation sample', () => {
  it('uses component medians over the selected period instead of the last observation', () => {
    const observations = [
      observationAt('o10', 'STA1', 'P1', '2026-01-01T00:00:00Z', 0, 10),
      observationAt('o11', 'STA1', 'P1', '2026-01-01T00:10:00Z', 0, 12),
      observationAt('o12', 'STA1', 'P1', '2026-01-01T00:20:00Z', 0, 100),
    ];
    const result = computeInitialCoordinates({
      observations,
      corrections: new Map(),
      stations: [station('STA1', 0, 0)],
      references: [],
      nameMap: new Map([['STA1|P1', 'P1']]),
      targetHeights: new Map([['P1', 0]]),
      referenceIds: new Set(),
      expectedObservationKeys: new Set(['STA1|P1']),
      fixedOrientations: new Map([['STA1', 0]]),
      epochFrom: '2026-01-01T00:00:00Z',
      epochTo: '2026-01-01T00:20:00Z',
    });

    expect(Math.hypot(result.provisional[0].easting, result.provisional[0].northing)).toBeCloseTo(12, 6);
    expect(result.provisional[0].nObservations).toBe(3);
    expect(result.coverage.representativeObservations).toBe(1);
  });

  it('reports physical-point and station-target coverage independently', () => {
    const expected = new Set(['STA1|A', 'STA2|B', 'STA2|C']);
    const names = new Map([['STA1|A', 'P1'], ['STA2|B', 'P1'], ['STA2|C', 'P2']]);
    const coverage = initializationCoverage([
      observation('o20', 'STA1', 'A', 0),
      observation('o21', 'STA2', 'C', 0),
    ], expected, names);

    expect(coverage.availablePhysicalPoints).toBe(2);
    expect(coverage.physicalPointCoveragePercent).toBe(100);
    expect(coverage.availableStationTargets).toBe(2);
    expect(coverage.stationTargetCoveragePercent).toBeCloseTo(66.666, 2);
    expect(coverage.missingStationTargets).toEqual(['STA2|B']);
  });
});

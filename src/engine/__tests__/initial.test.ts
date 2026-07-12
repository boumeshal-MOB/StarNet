import { describe, expect, it } from 'vitest';
import { computeInitialCoordinates } from '../initial';
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


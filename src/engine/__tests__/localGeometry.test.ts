import { describe, expect, it } from 'vitest';
import { checkLocalGeometry, type LocalPoint } from '../localGeometry';
import { adjustNetwork } from '../adjust';

describe('station-local geometry matching', () => {
  const a: LocalPoint[] = [
    { targetId: 'a1', stationId: 'A', e: 0, n: 0, h: 1 },
    { targetId: 'a2', stationId: 'A', e: 10, n: 0, h: 2 },
    { targetId: 'a3', stationId: 'A', e: 0, n: 20, h: 3 },
    { targetId: 'a4', stationId: 'A', e: 8, n: 12, h: 4 },
  ];
  const b: LocalPoint[] = a.map((point, index) => ({
    targetId: `b${index + 1}`, stationId: 'B',
    e: point.n - 50, n: -(point.e - 100), h: point.h - 7,
  }));

  it('requires two manually identified common points', () => {
    expect(checkLocalGeometry(a, b, [{ aTargetId: 'a1', bTargetId: 'b1' }]).status).toBe('insufficient');
  });

  it('finds candidates but flags two-point geometry as weak', () => {
    const result = checkLocalGeometry(a, b, [
      { aTargetId: 'a1', bTargetId: 'b1' }, { aTargetId: 'a2', bTargetId: 'b2' },
    ], 0.001, 0.001);
    expect(result.status).toBe('weak');
    expect(result.candidates).toHaveLength(4);
  });

  it('marks a three-point redundant check ready', () => {
    const result = checkLocalGeometry(a, b, [
      { aTargetId: 'a1', bTargetId: 'b1' }, { aTargetId: 'a2', bTargetId: 'b2' },
      { aTargetId: 'a3', bTargetId: 'b3' },
    ], 0.001, 0.001);
    expect(result.status).toBe('ready');
    expect(result.rmsM).toBeLessThan(1e-9);
  });
});

describe('known geometry constraints', () => {
  it('applies a full 3D vector between two different points', () => {
    const result = adjustNetwork([], [
      { id: 'A', e: 0, n: 0, h: 0, free: false, role: 'reference' },
      { id: 'B', e: 9, n: 18, h: 4, free: true, role: 'monitoring' },
    ], [], {
      convergenceThresholdM: 1e-8, maxIterations: 10, chiSquareSignificance: 0.05,
      confidenceLevel: 0.95, errorPropagation: false,
      geometricConstraints: [{ id: 'v1', fromId: 'A', toId: 'B', kind: 'vector-3d', deltaEM: 10, deltaNM: 20, deltaHM: 5, sigma: 0.001 }],
    });
    expect(result.ok).toBe(true);
    expect(result.points.find((point) => point.id === 'B')?.e).toBeCloseTo(10, 8);
    expect(result.points.find((point) => point.id === 'B')?.n).toBeCloseTo(20, 8);
    expect(result.points.find((point) => point.id === 'B')?.h).toBeCloseTo(5, 8);
  });
});

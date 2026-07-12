import { describe, expect, it } from 'vitest';
import { seedDemo } from '../seed';
import { buildOutputValues } from '../runExecution';
import type { AdjustmentRun, ConfigurationVersion } from '../../types/domain';

describe('BTM output mapping', () => {
  it('fans one physical-point coordinate out to every linked BTM prism output', () => {
    const seed = seedDemo();
    const config = JSON.parse(JSON.stringify(
      seed.configVersions.find((c) => c.id === 'proc-nte-ats34-v1'),
    )) as ConfigurationVersion;
    const point = config.physicalPoints.find((p) => p.btmPrismIds.length > 1)!;
    const linked = config.targets.filter((t) => t.physicalPointId === point.id);
    expect(linked.length).toBeGreaterThan(1);
    linked.forEach((target, index) => {
      target.publishOutput = true;
      target.outputName = `BTM_SHARED_${index + 1}`;
    });
    config.outputPolicy.variables = ['easting', 'northing', 'height'];

    const run = {
      status: 'Success', provisional: false, finalAttempt: 0,
      attempts: [{ coordinates: [{
        targetId: point.engineName,
        easting: 100.1, northing: 200.2, height: 3.3,
        sigmaE: 0.001, sigmaN: 0.001, sigmaH: 0.002,
      }] }],
    } as unknown as AdjustmentRun;

    const values = buildOutputValues(run, config);
    expect(Object.keys(values).sort()).toEqual(linked.map((_, i) => `BTM_SHARED_${i + 1}`).sort());
    expect(values.BTM_SHARED_1.easting).toBe(100.1);
    expect(values.BTM_SHARED_2.easting).toBe(100.1);
  });
});


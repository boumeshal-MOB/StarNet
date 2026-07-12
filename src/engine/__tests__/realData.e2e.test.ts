// End-to-end adjustment on the REAL ATS34 workbook data (March 2025):
// single-station resection + radiation, 9 tight references, loose station
// prior, free station height. No mocked numbers anywhere.
import { describe, expect, it } from 'vitest';
import { repository } from '../../data/repository';
import { seedDemo } from '../../store/seed';
import { buildRunnerInput, selectCycles, slotMs } from '../../store/runExecution';
import { runAdjustment } from '../runner';

const real = repository.realProject();
const seed = seedDemo();
const config = seed.configVersions.find((c) => c.id === 'proc-real-ats34-v1');
const refSet = config ? seed.referenceSets.find((r) => r.id === config.referenceSetId) : undefined;

describe.skipIf(!real)('real ATS34 dataset', () => {
  it('workbook is loaded with the expected shape', () => {
    expect(real!.stationId).toBe('NTE_ATS34');
    expect(real!.rawObservations.length).toBeGreaterThan(6000);
    expect(real!.referenceIds.length).toBe(9);
    expect(real!.lookup.length).toBe(43);
    // the documented example observation: Sd 78.4100 m to L34RE1100_329
    const ex = real!.rawObservations.find((o) => o.sdM === 78.41 && o.rawTargetName === 'L34RE1100_329');
    expect(ex).toBeDefined();
  });

  it('seeded processing has provisional coordinates for the monitoring prisms', () => {
    expect(config).toBeDefined();
    const monitoring = config!.targets.filter((t) => t.role === 'monitoring');
    expect(monitoring.length).toBeGreaterThan(20);
    expect(config!.provisionalCoordinates.length).toBeGreaterThan(20);
  });

  it('adjusts a real epoch: resection converges and recovers the references', () => {
    const epochs = real!.rawObservations.map((o) => new Date(o.epoch).getTime()).sort((a, b) => a - b);
    const slot = slotMs(config!.outputPolicy.outputIntervalMin, epochs[0]);
    const cycles = selectCycles(config!, slot, repository.observations());
    expect(cycles.fatal).toBeUndefined();
    expect(cycles.observations.length).toBeGreaterThan(30);

    const out = runAdjustment(buildRunnerInput(config!, cycles.observations,
      repository.environmental(), refSet!, { autoCorrection: true }));
    expect(out.ok).toBe(true);
    const q = out.attempts[out.finalAttempt].quality;
    expect(q.converged).toBe(true);
    expect(q.rankDeficiency).toBe(0);
    expect(q.degreesOfFreedom).toBeGreaterThan(20);

    // adjusted station position stays close to its header prior (loose 0.1 m E/N)
    const attempt = out.attempts[out.finalAttempt];
    const station = attempt.coordinates.find((c) => c.targetId === 'NTE_ATS34');
    expect(station).toBeDefined();
    expect(Math.abs(station!.easting - real!.stationApprox.e)).toBeLessThan(0.05);
    expect(Math.abs(station!.northing - real!.stationApprox.n)).toBeLessThan(0.05);

    // reference residual coordinates remain within a few mm of the header values
    const refPoint = refSet!.points.find((p) => p.pointId === 'L34RE1100_329')!;
    const adjRef = attempt.coordinates.find((c) => c.targetId === 'L34RE1100_329')!;
    expect(Math.abs(adjRef.easting - refPoint.easting)).toBeLessThan(0.01);
    expect(Math.abs(adjRef.northing - refPoint.northing)).toBeLessThan(0.01);
    expect(Math.abs(adjRef.height - refPoint.height)).toBeLessThan(0.01);
  });
});

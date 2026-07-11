// End-to-end engine tests on the real ATS34 fixture: full chain
// selectCycles -> corrections -> weighted 3D Gauss-Newton -> statistics ->
// auto-correction. No mocked results anywhere.
import { describe, expect, it } from 'vitest';
import { repository } from '../../data/repository';
import { BAD_OBS_SLOT, TRUE_POINTS } from '../../data/fixture';
import { seedDemo } from '../../store/seed';
import { buildRunnerInput, selectCycles } from '../../store/runExecution';
import { runAdjustment } from '../runner';
import { computeInitialCoordinates } from '../initial';
import { correctDistance, lookupEnvironment } from '../corrections';
import type { CorrectionTrace } from '../../types/domain';

const seed = seedDemo();
const configV1 = seed.configVersions.find((c) => c.id === 'proc-nte-ats34-v1')!;
const refSetV1 = seed.referenceSets.find((r) => r.id === configV1.referenceSetId)!;

function runSlot(slotMs: number, opts: { autoCorrection?: boolean } = {}) {
  const cycles = selectCycles(configV1, slotMs, repository.observations());
  expect(cycles.fatal).toBeUndefined();
  const input = buildRunnerInput(configV1, cycles.observations, repository.environmental(), refSetV1, {
    autoCorrection: opts.autoCorrection ?? false,
  });
  return runAdjustment(input);
}

describe('initial coordinates from real observations', () => {
  it('recovers the true monitoring positions within a few millimetres', () => {
    const fromMs = Date.UTC(2026, 6, 8, 0, 0, 0);
    const toMs = fromMs + 2 * 3600000;
    const observations = repository.observationsInWindow(['ATS34', 'ATS35', 'ATS36'], fromMs, toMs);
    const instruments = Object.fromEntries(repository.instrumentProfiles().map((p) => [p.id, p]));
    const setupByKey = new Map(configV1.prismSetups.map((s) => [`${s.stationId}|${s.targetKey}`, s]));
    const nameMap = new Map(configV1.targets.map((t) => [t.rawName, t.adjustmentName]));
    const corrections = new Map<string, CorrectionTrace>();
    for (const o of observations) {
      const st = configV1.stations.find((s) => s.id === o.stationId)!;
      const adjName = nameMap.get(o.rawTargetName);
      if (!adjName) continue;
      corrections.set(o.id, correctDistance({
        observation: o, station: st,
        setup: setupByKey.get(`${o.stationId}|${o.rawTargetName}`)!,
        instrument: instruments[st.instrumentProfileId],
        env: lookupEnvironment(st, o.epoch, repository.environmental()),
        datumScale: 1, targetId: adjName,
      }));
    }
    const res = computeInitialCoordinates({
      observations, corrections,
      stations: configV1.stations,
      references: refSetV1.points,
      nameMap,
      targetHeights: new Map(configV1.targets.map((t) => [t.adjustmentName, t.targetHeightM])),
      referenceIds: new Set(refSetV1.points.map((p) => p.pointId)),
      epochFrom: new Date(fromMs).toISOString(),
      epochTo: new Date(toMs).toISOString(),
    });
    expect(res.orientations.every((o) => o.orientationRad !== undefined)).toBe(true);
    const mp1 = res.provisional.find((p) => p.targetId === 'MP01')!;
    const truth = TRUE_POINTS.find((p) => p.id === 'MP01')!;
    expect(Math.abs(mp1.easting - truth.e)).toBeLessThan(0.01);
    expect(Math.abs(mp1.northing - truth.n)).toBeLessThan(0.01);
    expect(Math.abs(mp1.height - truth.h)).toBeLessThan(0.01);
  });
});

describe('full weighted 3D adjustment on a clean epoch', () => {
  const out = runSlot(Date.UTC(2026, 6, 8, 12, 0, 0));

  it('converges with a passing two-sided chi-square test', () => {
    expect(out.ok).toBe(true);
    const q = out.attempts[out.finalAttempt].quality;
    expect(q.converged).toBe(true);
    expect(q.rankDeficiency).toBe(0);
    expect(q.degreesOfFreedom).toBeGreaterThan(10);
    expect(q.chiSquarePassed).toBe(true);
    expect(q.totalErrorFactor).toBeGreaterThan(0.5);
    expect(q.totalErrorFactor).toBeLessThan(1.6);
  });

  it('recovers true coordinates within tolerance', () => {
    const coords = out.attempts[out.finalAttempt].coordinates;
    for (const id of ['MP04', 'MP06', 'MP07']) {
      const c = coords.find((x) => x.targetId === id)!;
      const t = TRUE_POINTS.find((p) => p.id === id)!;
      expect(Math.abs(c.easting - t.e)).toBeLessThan(0.005);
      expect(Math.abs(c.northing - t.n)).toBeLessThan(0.005);
      expect(Math.abs(c.height - t.h)).toBeLessThan(0.005);
      expect(c.sigmaE).toBeGreaterThan(0);
      expect(c.ellipseSemiMajorM).toBeGreaterThan(0);
      expect(c.ellipseSemiMajorM).toBeLessThan(0.01);
    }
  });

  it('flags the single-ray target MP08 as uncontrolled', () => {
    const q = out.attempts[out.finalAttempt].quality;
    expect(q.singleRayTargets).toContain('MP08');
  });
});

describe('scenario B: blunder detection and auto-correction', () => {
  it('fails quality without auto-correction, identifying the corrupted observation', () => {
    const out = runSlot(BAD_OBS_SLOT, { autoCorrection: false });
    expect(out.ok).toBe(true);
    const q = out.attempts[out.finalAttempt].quality;
    expect(q.chiSquarePassed).toBe(false);
    expect(q.maxStdResidualObs ?? '').toContain('ATS34-MP04');
  });

  it('recovers with auto-correction while keeping every attempt', () => {
    const out = runSlot(BAD_OBS_SLOT, { autoCorrection: true });
    expect(out.ok).toBe(true);
    expect(out.attempts.length).toBeGreaterThan(1);
    const final = out.attempts[out.finalAttempt];
    expect(final.quality.chiSquarePassed).toBe(true);
    // the removed observations belong to the corrupted ray
    expect(final.removedObservationIds.every((id) => id.includes('ATS34-MP04'))).toBe(true);
    // the initial attempt stays recorded with its failing quality
    expect(out.attempts[0].quality.chiSquarePassed).toBe(false);
  });
});

describe('scenario C/D: multi-station synchronization and reuse', () => {
  it('desynchronized epochs (:25/:26/:32) are all fresh for the :30 slot', () => {
    const cycles = selectCycles(configV1, Date.UTC(2026, 6, 9, 10, 30, 0), repository.observations());
    expect(cycles.usage.filter((u) => u.state === 'fresh').length).toBe(3);
  });

  it('a silent station is reused within 45 min and marks the run provisional', () => {
    const seedV2 = seed.configVersions.find((c) => c.id === 'proc-nte-ats34-v2')!;
    const cycles = selectCycles(seedV2, Date.UTC(2026, 6, 10, 9, 0, 0), repository.observations());
    const ats36 = cycles.usage.find((u) => u.stationId === 'ATS36')!;
    expect(ats36.state).toBe('reused');
    expect(ats36.ageMin).toBeLessThanOrEqual(45);
    expect(cycles.provisionalReasons.length).toBeGreaterThan(0);
  });
});

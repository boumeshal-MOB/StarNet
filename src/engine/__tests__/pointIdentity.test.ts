// Physical point mapping: identity resolution, default-distinct rule,
// linking scenarios, connectivity and pre-run validation.
import { describe, expect, it } from 'vitest';
import { buildTargetsAndSetups, seedDemo } from '../../store/seed';
import { repository } from '../../data/repository';
import { buildRunnerInput, selectCycles } from '../../store/runExecution';
import { runAdjustment } from '../runner';
import {
  buildResolvedMapping, confirmDistinct, linkAsSamePoint, networkConnectivity,
  resolveEngineName, targetSourceKey, unlinkPrism, validatePointMapping,
} from '../pointIdentity';
import type { ConfigurationVersion } from '../../types/domain';

const seed = seedDemo();
const config = seed.configVersions.find((c) => c.id === 'proc-nte-ats34-v1')!;
const refSet = seed.referenceSets.find((r) => r.id === config.referenceSetId)!;

describe('new-processing default identity', () => {
  it('does not infer common points from identical AdjustmentName values', () => {
    const built = buildTargetsAndSetups(['ATS34', 'ATS35']);
    const ref02 = built.targets.filter((target) => target.adjustmentName === 'REF02');
    expect(ref02).toHaveLength(2);
    expect(new Set(ref02.map((target) => target.physicalPointId)).size).toBe(2);
    expect(built.physicalPoints.every((point) => point.btmPrismIds.length === 1)).toBe(true);
  });
});

describe('scenario "different names, same point"', () => {
  it('MP01 prisms (MP01_34 / MP01_36) share one physical point and one engine id', () => {
    const prisms = config.targets.filter((t) => t.adjustmentName === 'MP01');
    expect(prisms.length).toBe(2);
    expect(new Set(prisms.map((p) => p.rawName)).size).toBe(2);          // different field names
    expect(new Set(prisms.map((p) => p.physicalPointId)).size).toBe(1);  // same physical point
    const engineNames = prisms.map((p) => resolveEngineName(p, config.physicalPoints));
    expect(new Set(engineNames).size).toBe(1);
    const pp = config.physicalPoints.find((p) => p.id === prisms[0].physicalPointId)!;
    expect(pp.state).toBe('shared');
    expect(pp.source).toBe('existing'); // explicit mapping in the configured demo processing
  });

  it('the network produces ONE adjusted coordinate while residuals stay per station', () => {
    const slot = Date.UTC(2026, 6, 8, 12, 0, 0);
    const cycles = selectCycles(config, slot, repository.observations());
    const out = runAdjustment(buildRunnerInput(config, cycles.observations,
      repository.environmental(), refSet, { autoCorrection: false }));
    const attempt = out.attempts[out.finalAttempt];
    expect(attempt.coordinates.filter((c) => c.targetId === 'MP01').length).toBe(1);
    const mp01Residuals = attempt.observations.filter((o) => o.targetId === 'MP01' && o.used);
    const stations = new Set(mp01Residuals.map((o) => o.stationId));
    expect(stations.has('ATS34')).toBe(true);
    expect(stations.has('ATS36')).toBe(true);
    // every residual traces back to its own station's raw observation
    expect(mp01Residuals.every((o) => o.observationId.includes(o.stationId))).toBe(true);
  });
});

describe('scenario "same field name, different points" (MPO001)', () => {
  it('keeps the two MPO001 prisms distinct with different engine ids', () => {
    const prisms = config.targets.filter((t) => t.rawName === 'MPO001');
    expect(prisms.length).toBe(2);
    expect(new Set(prisms.map((p) => p.stationIds[0])).size).toBe(2);   // two stations
    expect(new Set(prisms.map((p) => p.physicalPointId)).size).toBe(2); // distinct by default
    const engineNames = prisms.map((p) => resolveEngineName(p, config.physicalPoints));
    expect(new Set(engineNames).size).toBe(2);                          // two engine ids
  });

  it('uses station + raw name as the source identity', () => {
    const prisms = config.targets.filter((t) => t.rawName === 'MPO001');
    expect(new Set(prisms.map((t) => targetSourceKey(t.stationIds[0], t.rawName))).size).toBe(2);
  });

  it('adjusts them as two separate coordinates', () => {
    const slot = Date.UTC(2026, 6, 8, 12, 0, 0);
    const cycles = selectCycles(config, slot, repository.observations());
    const out = runAdjustment(buildRunnerInput(config, cycles.observations,
      repository.environmental(), refSet, { autoCorrection: false }));
    const coords = out.attempts[out.finalAttempt].coordinates;
    const mp03 = coords.find((c) => c.targetId === 'MP03');
    const mp07 = coords.find((c) => c.targetId === 'MP07');
    expect(mp03).toBeDefined();
    expect(mp07).toBeDefined();
    const d = Math.hypot(mp03!.easting - mp07!.easting, mp03!.northing - mp07!.northing);
    expect(d).toBeGreaterThan(50); // genuinely different physical locations
  });
});

describe('mapping integrity validation', () => {
  it('blocks a dangling target-to-physical-point link', () => {
    const clone: ConfigurationVersion = JSON.parse(JSON.stringify(config));
    clone.targets[0].physicalPointId = 'missing-point';
    expect(validatePointMapping(clone).some((issue) =>
      issue.level === 'blocking' && issue.message.includes('missing physical point'))).toBe(true);
  });

  it('blocks a non-reciprocal physical-point link', () => {
    const clone: ConfigurationVersion = JSON.parse(JSON.stringify(config));
    const target = clone.targets[0];
    const point = clone.physicalPoints.find((p) => p.id === target.physicalPointId)!;
    point.btmPrismIds = point.btmPrismIds.filter((id) => id !== target.btmPrismId);
    expect(validatePointMapping(clone).some((issue) =>
      issue.level === 'blocking' && issue.message.includes('does not contain'))).toBe(true);
  });

  it('blocks one output name assigned to different physical points', () => {
    const clone: ConfigurationVersion = JSON.parse(JSON.stringify(config));
    const distinct = clone.targets.filter((target, index, all) =>
      all.findIndex((other) => other.physicalPointId === target.physicalPointId) === index).slice(0, 2);
    distinct.forEach((target) => { target.publishOutput = true; target.outputName = 'DUPLICATE_OUTPUT'; });
    expect(validatePointMapping(clone).some((issue) =>
      issue.level === 'blocking' && issue.message.includes('DUPLICATE_OUTPUT'))).toBe(true);
  });
});

describe('link / unlink operations (versioned, never silent)', () => {
  it('linking two prisms merges their points; unlinking restores distinct ids', () => {
    const clone: ConfigurationVersion = JSON.parse(JSON.stringify(config));
    const mpo = clone.targets.filter((t) => t.rawName === 'MPO001');
    const linked = linkAsSamePoint(
      { targets: clone.targets, physicalPoints: clone.physicalPoints },
      mpo.map((t) => t.id), 'tester', 'manual', 'test link',
    );
    const linkedPrisms = linked.targets.filter((t) => t.rawName === 'MPO001');
    expect(new Set(linkedPrisms.map((t) => t.physicalPointId)).size).toBe(1);
    const pp = linked.physicalPoints.find((p) => p.id === linkedPrisms[0].physicalPointId)!;
    expect(pp.state).toBe('shared');
    expect(pp.decidedBy).toBe('tester');
    expect(pp.rationale).toBe('test link');

    const unlinked = unlinkPrism(linked, linkedPrisms[0].id, 'tester', 'undo');
    const after = unlinked.targets.filter((t) => t.rawName === 'MPO001');
    expect(new Set(after.map((t) => t.physicalPointId)).size).toBe(2);
    // no orphan points and no engine-name collision
    expect(validatePointMapping({ ...clone, ...unlinked } as ConfigurationVersion)
      .filter((i) => i.level === 'blocking')).toEqual([]);
  });

  it('confirmDistinct marks single-prism points as human-resolved', () => {
    const clone: ConfigurationVersion = JSON.parse(JSON.stringify(config));
    // MP08 is observed by one station only -> its point holds a single prism
    const t = clone.targets.find((x) => x.adjustmentName === 'MP08')!;
    const res = confirmDistinct({ targets: clone.targets, physicalPoints: clone.physicalPoints }, [t.id], 'tester');
    const pp = res.physicalPoints.find((p) => p.id === t.physicalPointId)!;
    expect(pp.source).toBe('manual');
    expect(pp.decidedBy).toBe('tester');
  });
});

describe('validation and connectivity (scenario "disconnected network")', () => {
  it('detects engine-name collisions between different physical points', () => {
    const clone: ConfigurationVersion = JSON.parse(JSON.stringify(config));
    clone.physicalPoints[0].engineName = clone.physicalPoints[1].engineName;
    const blocking = validatePointMapping(clone).filter((i) => i.level === 'blocking');
    expect(blocking.length).toBeGreaterThan(0);
    expect(blocking[0].message).toContain('different physical points');
  });

  it('reports a disconnected network when shared points disappear', () => {
    const clone: ConfigurationVersion = JSON.parse(JSON.stringify(config));
    // detach ATS36: give every ATS36 prism its own isolated point
    let state = { targets: clone.targets, physicalPoints: clone.physicalPoints };
    for (const t of clone.targets.filter((x) => x.stationIds[0] === 'ATS36')) {
      state = unlinkPrism(state, t.id, 'tester', 'isolate ATS36');
    }
    const conn = networkConnectivity({ ...clone, ...state } as ConfigurationVersion);
    expect(conn.connected).toBe(false);
    const blocking = validatePointMapping({ ...clone, ...state } as ConfigurationVersion)
      .filter((i) => i.level === 'blocking');
    expect(blocking.some((b) => b.message.includes('disconnected'))).toBe(true);
  });

  it('the seeded network is connected through shared points', () => {
    const conn = networkConnectivity(config);
    expect(conn.connected).toBe(true);
    expect(conn.sharedPoints.length).toBeGreaterThan(3);
  });
});

describe('run snapshot mapping', () => {
  it('resolves engine id -> physical point -> contributing prisms and observations', () => {
    const mapping = buildResolvedMapping(config);
    const mp01 = mapping.find((m) => m.engineName === 'MP01')!;
    expect(mp01.contributors.length).toBe(2);
    expect(new Set(mp01.contributors.map((c) => c.stationId)).size).toBe(2);
    const mpo = mapping.filter((m) => m.contributors.some((c) => c.rawName === 'MPO001'));
    expect(mpo.length).toBe(2); // two entries: MP03 and MP07
    expect(new Set(mpo.map((m) => m.engineName)).size).toBe(2);
  });
});

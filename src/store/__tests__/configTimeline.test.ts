import { describe, expect, it } from 'vitest';
import { seedDemo } from '../seed';
import {
  planTimelineActivation, timelineSlots, uniqueConfigForSlot,
} from '../configTimeline';
import type { ConfigurationVersion } from '../../types/domain';

const seed = seedDemo();
const template = seed.configVersions.find((c) => c.id === 'proc-nte-ats34-v1')!;

function version(
  id: string, n: number, from: string, to: string | undefined,
  interval = 30, status: ConfigurationVersion['status'] = 'inactive',
): ConfigurationVersion {
  return {
    ...JSON.parse(JSON.stringify(template)) as ConfigurationVersion,
    id,
    processingId: 'timeline-test',
    versionNumber: n,
    label: id,
    validFrom: from,
    validTo: to,
    status,
    outputPolicy: { ...template.outputPolicy, outputIntervalMin: interval },
  };
}

describe('configuration timeline', () => {
  it('closes the previous open period when a later version is activated', () => {
    const v1 = version('v1', 1, '2026-01-01T00:00:00.000Z', undefined, 30, 'active');
    const v2 = version('v2', 2, '2026-02-01T00:00:00.000Z', undefined, 30, 'active');
    const plan = planTimelineActivation([v1], v2);
    expect(plan.ok).toBe(true);
    expect(plan.versions[0].validTo).toBe(v2.validFrom);
    expect(plan.versions[0].status).toBe('inactive');
  });

  it('rejects activation that would split an existing historical period', () => {
    const v1 = version('v1', 1, '2026-01-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z');
    const middle = version('middle', 2, '2026-02-01T00:00:00.000Z', '2026-02-15T00:00:00.000Z', 30, 'active');
    expect(planTimelineActivation([v1], middle).ok).toBe(false);
  });

  it('refuses an ambiguous slot instead of silently choosing the highest version', () => {
    const v1 = version('v1', 1, '2026-01-01T00:00:00.000Z', undefined);
    const v2 = version('v2', 2, '2026-02-01T00:00:00.000Z', undefined);
    expect(uniqueConfigForSlot([v1, v2], 'timeline-test', Date.parse('2026-02-02T00:00:00Z'))).toBeUndefined();
  });

  it('uses each historical configuration output frequency', () => {
    const v1 = version('v1', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T01:00:00.000Z', 30);
    const v2 = version('v2', 2, '2026-01-01T01:00:00.000Z', '2026-01-01T02:00:00.000Z', 15);
    const slots = timelineSlots([v1, v2], 'timeline-test',
      Date.parse('2026-01-01T00:00:00Z'), Date.parse('2026-01-01T01:59:00Z'));
    expect(slots.map((s) => new Date(s).toISOString().slice(11, 16)))
      .toEqual(['00:00', '00:30', '01:00', '01:15', '01:30', '01:45']);
  });
});


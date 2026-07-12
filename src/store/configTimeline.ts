import type { ConfigurationVersion } from '../types/domain';
import { listSlots } from './runExecution';

export function intervalOverlaps(
  aFrom: string, aTo: string | undefined,
  bFrom: string, bTo: string | undefined,
): boolean {
  const aEnd = aTo ?? '9999-12-31T23:59:59.999Z';
  const bEnd = bTo ?? '9999-12-31T23:59:59.999Z';
  return aFrom < bEnd && bFrom < aEnd;
}

export function isTimelineVersion(config: ConfigurationVersion): boolean {
  return config.status !== 'draft';
}

export function configsForSlot(
  versions: ConfigurationVersion[], processingId: string, slot: number,
): ConfigurationVersion[] {
  const slotIso = new Date(slot).toISOString();
  return versions
    .filter((config) => config.processingId === processingId && isTimelineVersion(config))
    .filter((config) => config.validFrom <= slotIso && (!config.validTo || slotIso < config.validTo))
    .sort((a, b) => b.versionNumber - a.versionNumber);
}

/** A slot is usable only when the timeline resolves to exactly one version. */
export function uniqueConfigForSlot(
  versions: ConfigurationVersion[], processingId: string, slot: number,
): ConfigurationVersion | undefined {
  const matches = configsForSlot(versions, processingId, slot);
  return matches.length === 1 ? matches[0] : undefined;
}

export interface TimelineActivationPlan {
  ok: boolean;
  versions: ConfigurationVersion[];
  reason?: string;
}

/**
 * Insert a configuration at the end of an existing timeline. The previous
 * covering version is closed at the new inclusive validFrom. Activating a
 * version in the middle of an existing history is rejected because it would
 * require splitting an immutable version into two records.
 */
export function planTimelineActivation(
  versions: ConfigurationVersion[], candidate: ConfigurationVersion,
): TimelineActivationPlan {
  if (candidate.validTo && candidate.validTo <= candidate.validFrom) {
    return { ok: false, versions, reason: 'Validity end must be after validity start' };
  }

  const siblings = versions.filter((config) =>
    config.processingId === candidate.processingId
    && config.id !== candidate.id
    && isTimelineVersion(config));
  const conflicts = siblings.filter((config) => intervalOverlaps(
    config.validFrom, config.validTo, candidate.validFrom, candidate.validTo));

  const unsupported = conflicts.find((config) => config.validFrom >= candidate.validFrom);
  if (unsupported) {
    return {
      ok: false,
      versions,
      reason: `${candidate.label} overlaps ${unsupported.label}; create a non-overlapping validity period`,
    };
  }
  const candidateEnd = candidate.validTo;
  if (candidateEnd && conflicts.some((config) => !config.validTo || config.validTo > candidateEnd)) {
    return {
      ok: false,
      versions,
      reason: 'Activation inside an existing validity period would split its history',
    };
  }

  const updated = versions.map((config) => {
    if (!conflicts.some((conflict) => conflict.id === config.id)) return config;
    return { ...config, validTo: candidate.validFrom, status: 'inactive' as const };
  });
  return { ok: true, versions: updated };
}

/** Build output slots with the interval valid in each historical period. */
export function timelineSlots(
  versions: ConfigurationVersion[], processingId: string, fromMs: number, toMs: number,
): number[] {
  const slots = new Set<number>();
  for (const config of versions.filter((c) => c.processingId === processingId && isTimelineVersion(c))) {
    const start = Math.max(fromMs, new Date(config.validFrom).getTime());
    const end = Math.min(toMs, config.validTo ? new Date(config.validTo).getTime() - 1 : toMs);
    if (start > end) continue;
    for (const slot of listSlots(config.outputPolicy.outputIntervalMin, start, end)) slots.add(slot);
  }
  return [...slots].sort((a, b) => a - b);
}

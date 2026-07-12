// ---------------------------------------------------------------------------
// Physical-point identity resolution (BTM point mapping).
//
// A BTM prism registration (per station) is linked to a Physical Point; the
// adjustment engine / Star*Net input uses the physical point's resolved
// engine name. Default: one prism = its own physical point (distinct). Two
// prisms are only merged into one point through an explicit, versioned link.
// These helpers are pure and shared by the engine, the store and the UI.
// ---------------------------------------------------------------------------

import type {
  ConfigurationVersion, PhysicalPoint, PhysicalPointSuggestion, ProvisionalCoordinate,
  ResolvedPointMapping, TargetMapping,
} from '../types/domain';

/** Stable identity of one prism registration in the raw BTM observations. */
export function targetSourceKey(stationId: string, rawName: string): string {
  return `${stationId}\u0000${rawName}`;
}

/** engine name (Star*Net id) for a target mapping, resolved via its physical point */
export function resolveEngineName(
  mapping: Pick<TargetMapping, 'adjustmentName' | 'physicalPointId'>,
  physicalPoints: PhysicalPoint[],
): string {
  const pp = physicalPoints.find((p) => p.id === mapping.physicalPointId);
  return pp?.engineName ?? mapping.adjustmentName;
}

/** immutable resolved mapping for a run snapshot */
export function buildResolvedMapping(config: ConfigurationVersion): ResolvedPointMapping[] {
  const byEngine = new Map<string, ResolvedPointMapping>();
  for (const t of config.targets) {
    if (!t.includeInAdjustment) continue;
    const engineName = resolveEngineName(t, config.physicalPoints);
    const pp = config.physicalPoints.find((p) => p.id === t.physicalPointId);
    const entry = byEngine.get(engineName) ?? {
      engineName,
      physicalPointId: t.physicalPointId,
      label: pp?.label ?? t.adjustmentName,
      role: t.role,
      contributors: [],
    };
    for (const stationId of t.stationIds) {
      entry.contributors.push({ stationId, btmPrismId: t.btmPrismId, rawName: t.rawName });
    }
    byEngine.set(engineName, entry);
  }
  return [...byEngine.values()].sort((a, b) => a.engineName.localeCompare(b.engineName));
}

/** Star*Net engine-name constraints (unique within the run, valid characters) */
export function engineNameIssues(name: string, allEngineNames: string[]): string[] {
  const issues: string[] = [];
  if (!name) issues.push('empty engine name');
  if (name.length > 15) issues.push('engine name longer than 15 characters');
  if (/[^A-Za-z0-9_-]/.test(name)) issues.push('forbidden characters for the engine');
  return issues;
}

// ------------------------------------------------------------ connectivity -
export interface Connectivity {
  components: string[][];        // groups of station ids connected by shared points
  connected: boolean;           // single component (or single station)
  sharedPoints: { engineName: string; stationIds: string[] }[];
}

export function networkConnectivity(config: ConfigurationVersion): Connectivity {
  const stations = config.stations.map((s) => s.id);
  // union-find over stations, joined by any physical point observed from >1 station
  const parent = new Map(stations.map((s) => [s, s]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== c) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };
  const union = (a: string, b: string) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  const shared: Connectivity['sharedPoints'] = [];
  const byEngine = new Map<string, Set<string>>();
  for (const t of config.targets) {
    if (!t.includeInAdjustment) continue;
    const engineName = resolveEngineName(t, config.physicalPoints);
    const set = byEngine.get(engineName) ?? new Set<string>();
    for (const s of t.stationIds) set.add(s);
    byEngine.set(engineName, set);
  }
  for (const [engineName, set] of byEngine) {
    if (set.size > 1) {
      const ids = [...set];
      shared.push({ engineName, stationIds: ids });
      for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
    }
  }
  const groups = new Map<string, string[]>();
  for (const s of stations) {
    const r = find(s);
    groups.set(r, [...(groups.get(r) ?? []), s]);
  }
  const components = [...groups.values()];
  return { components, connected: components.length <= 1, sharedPoints: shared };
}

// -------------------------------------------------------------- validation -
export type MappingIssueLevel = 'blocking' | 'confirm' | 'suggestion' | 'warning';
export interface MappingIssue {
  level: MappingIssueLevel;
  message: string;
  engineName?: string;
}

export function validatePointMapping(config: ConfigurationVersion): MappingIssue[] {
  const issues: MappingIssue[] = [];
  const pointById = new Map(config.physicalPoints.map((p) => [p.id, p]));
  const targetByPrism = new Map(config.targets.map((t) => [t.btmPrismId, t]));

  // A raw target name is only unique inside its station. The composite source
  // identity must itself be unique in a configuration version.
  const sourceKeys = new Map<string, TargetMapping[]>();
  for (const target of config.targets) {
    if (target.stationIds.length !== 1) {
      issues.push({ level: 'blocking', message: `BTM prism ${target.btmPrismId} must belong to exactly one station` });
      continue;
    }
    const key = targetSourceKey(target.stationIds[0], target.rawName);
    sourceKeys.set(key, [...(sourceKeys.get(key) ?? []), target]);
  }
  for (const targets of sourceKeys.values()) {
    if (targets.length > 1) {
      const t = targets[0];
      issues.push({ level: 'blocking',
        message: `Duplicate source mapping for ${t.stationIds[0]} / ${t.rawName}` });
    }
  }

  // Target -> point and point -> target links must be fully reciprocal. A
  // broken link is never hidden by the adjustment-name fallback.
  for (const target of config.targets) {
    const point = pointById.get(target.physicalPointId);
    if (!point) {
      issues.push({ level: 'blocking',
        message: `${target.stationIds[0] ?? 'Unknown station'} / ${target.rawName} references a missing physical point` });
    } else if (!point.btmPrismIds.includes(target.btmPrismId)) {
      issues.push({ level: 'blocking', engineName: point.engineName,
        message: `Physical point ${point.label} does not contain its mapped BTM prism ${target.btmPrismId}` });
    }
  }
  for (const point of config.physicalPoints) {
    for (const prismId of point.btmPrismIds) {
      const target = targetByPrism.get(prismId);
      if (!target) {
        issues.push({ level: 'blocking', engineName: point.engineName,
          message: `Physical point ${point.label} contains unknown BTM prism ${prismId}` });
      } else if (target.physicalPointId !== point.id) {
        issues.push({ level: 'blocking', engineName: point.engineName,
          message: `BTM prism ${prismId} points to another physical point` });
      }
    }
  }

  // engine-name collisions: two different physical points sharing an engine name
  const engineToPoints = new Map<string, Set<string>>();
  for (const pp of config.physicalPoints) {
    const set = engineToPoints.get(pp.engineName) ?? new Set<string>();
    set.add(pp.id);
    engineToPoints.set(pp.engineName, set);
  }
  for (const [engineName, ids] of engineToPoints) {
    if (ids.size > 1) {
      issues.push({ level: 'blocking', engineName,
        message: `Engine name "${engineName}" is used by ${ids.size} different physical points` });
    }
    for (const issue of engineNameIssues(engineName, [])) {
      issues.push({ level: 'blocking', engineName, message: `Engine name "${engineName}": ${issue}` });
    }
  }

  // a BTM prism linked to more than one physical point (contradictory mapping)
  const prismToPoints = new Map<string, Set<string>>();
  for (const pp of config.physicalPoints) {
    for (const bid of pp.btmPrismIds) {
      const set = prismToPoints.get(bid) ?? new Set<string>();
      set.add(pp.id);
      prismToPoints.set(bid, set);
    }
  }
  for (const [bid, ids] of prismToPoints) {
    if (ids.size > 1) {
      issues.push({ level: 'blocking', message: `BTM prism ${bid} is linked to ${ids.size} physical points` });
    }
  }

  // Output names are the storage keys of a result. Reusing one for two
  // different physical points would silently overwrite one adjusted value.
  const outputToPoints = new Map<string, Set<string>>();
  for (const target of config.targets.filter((t) => t.publishOutput)) {
    if (!target.outputName.trim()) {
      issues.push({ level: 'blocking', message: `${target.stationIds[0]} / ${target.rawName} has no BTM output name` });
      continue;
    }
    const set = outputToPoints.get(target.outputName) ?? new Set<string>();
    set.add(target.physicalPointId);
    outputToPoints.set(target.outputName, set);
  }
  for (const [outputName, pointIds] of outputToPoints) {
    if (pointIds.size > 1) {
      issues.push({ level: 'blocking',
        message: `BTM output name "${outputName}" is assigned to ${pointIds.size} different physical points` });
    }
  }

  // unresolved / suggested links awaiting confirmation
  for (const pp of config.physicalPoints) {
    if (pp.state === 'suggested') {
      issues.push({ level: 'suggestion', engineName: pp.engineName,
        message: `Suggested link for ${pp.label} (${pp.btmPrismIds.length} prisms) awaits confirmation` });
    } else if (pp.state === 'unresolved') {
      const included = config.targets.some((t) => t.physicalPointId === pp.id && t.includeInAdjustment);
      if (included) issues.push({ level: 'confirm', engineName: pp.engineName,
        message: `${pp.label} identity not confirmed` });
    } else if (pp.state === 'inconsistent') {
      issues.push({ level: 'warning', engineName: pp.engineName,
        message: `${pp.label}: contributing estimates disagree - review before use` });
    }
  }

  // multi-station connectivity
  const conn = networkConnectivity(config);
  if (config.stations.length > 1 && !conn.connected) {
    issues.push({ level: 'blocking',
      message: `Network is disconnected: ${conn.components.length} independent components (${conn.components.map((c) => c.join('+')).join(' | ')}) - add a confirmed common point or extra coordinates` });
  }

  return issues;
}

// ------------------------------------------------------------- suggestions -
/**
 * Coordinate-proximity suggestion: BTM prisms from different stations whose
 * independently computed provisional coordinates are within a tolerance are
 * proposed as the same physical point (never merged automatically).
 */
export function suggestByProximity(
  config: ConfigurationVersion,
  perPrismCoord: Map<string, { e: number; n: number; h: number; stationId: string }>,
  toleranceM = 0.05,
): PhysicalPointSuggestion[] {
  const out: PhysicalPointSuggestion[] = [];
  const entries = [...perPrismCoord.entries()];
  const alreadyShared = new Set<string>();
  for (const pp of config.physicalPoints) {
    if (pp.btmPrismIds.length > 1) pp.btmPrismIds.forEach((b) => alreadyShared.add(b));
  }
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [ai, a] = entries[i];
      const [bi, b] = entries[j];
      if (a.stationId === b.stationId) continue;
      if (alreadyShared.has(ai) || alreadyShared.has(bi)) continue;
      const d = Math.hypot(a.e - b.e, a.n - b.n, a.h - b.h);
      if (d <= toleranceM) {
        out.push({
          kind: 'coordinate-proximity',
          btmPrismIds: [ai, bi],
          confidence: Math.max(0.4, 1 - d / toleranceM),
          distanceM: d,
          rationale: `Independent initial coordinates from ${a.stationId} and ${b.stationId} agree within ${(d * 1000).toFixed(0)} mm (tolerance ${(toleranceM * 1000).toFixed(0)} mm)`,
        });
      }
    }
  }
  return out.sort((x, y) => y.confidence - x.confidence);
}

/** dispersion between the contributing stations' independent estimates */
export function pointDispersion(
  prov: ProvisionalCoordinate | undefined,
): { horizontal: number; vertical: number } | undefined {
  if (!prov || prov.perStation.length < 2) return undefined;
  return { horizontal: prov.spreadHorizontalM, vertical: prov.spreadVerticalM };
}

// ------------------------------------------------------- link operations ---
// Pure mapping edits. They never touch stored entities: callers hold a draft
// copy (wizard) or save the result as a NEW configuration version (admin).

export interface MappingState {
  targets: TargetMapping[];
  physicalPoints: PhysicalPoint[];
}

function uniqueEngineName(base: string, taken: Set<string>): string {
  let name = base.slice(0, 15) || 'PT';
  let n = 2;
  while (taken.has(name)) {
    const suffix = `_${n}`;
    name = base.slice(0, 15 - suffix.length) + suffix;
    n += 1;
  }
  return name;
}

/** drop physical points no prism references anymore */
function pruneOrphans(state: MappingState): MappingState {
  const used = new Set(state.targets.map((t) => t.physicalPointId));
  return { ...state, physicalPoints: state.physicalPoints.filter((p) => used.has(p.id)) };
}

/** link the selected prisms (target mappings) as ONE physical point */
export function linkAsSamePoint(
  state: MappingState, targetIds: string[], user: string,
  source: PhysicalPoint['source'], rationale: string, confidence?: number,
): MappingState {
  const selected = state.targets.filter((t) => targetIds.includes(t.id));
  if (selected.length < 2) return state;
  const selectedPrismIds = new Set(selected.map((t) => t.btmPrismId));
  const outputNamesOutsideSelection = new Set(state.targets
    .filter((t) => !targetIds.includes(t.id))
    .map((t) => t.outputName));
  const resolvedOutputNames = new Map<string, string>();
  for (const target of selected) {
    let outputName = target.outputName;
    if (outputNamesOutsideSelection.has(outputName)) {
      const base = `${outputName}_${target.stationIds[0]}`;
      outputName = base;
      let suffix = 2;
      while (outputNamesOutsideSelection.has(outputName)) outputName = `${base}_${suffix++}`;
    }
    resolvedOutputNames.set(target.id, outputName);
    outputNamesOutsideSelection.add(outputName);
  }
  // remove the moved prisms from their previous points (a prism must never
  // be linked to two physical points) and demote points left with one prism
  const cleaned = state.physicalPoints
    .map((p) => ({ ...p, btmPrismIds: p.btmPrismIds.filter((b) => !selectedPrismIds.has(b)) }))
    .map((p) => (p.state === 'shared' && p.btmPrismIds.length <= 1
      ? { ...p, state: 'resolved' as const } : p));
  const taken = new Set(cleaned.filter((p) => p.btmPrismIds.length > 0).map((p) => p.engineName));
  const names = [...new Set(selected.map((t) => t.adjustmentName))];
  const pp: PhysicalPoint = {
    id: `pp-${Date.now()}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    label: names.length === 1 ? names[0] : names.join('='),
    engineName: uniqueEngineName(names[0], taken),
    role: selected[0].role,
    outputName: resolvedOutputNames.get(selected[0].id),
    btmPrismIds: selected.map((t) => t.btmPrismId),
    state: 'shared',
    source,
    confidence,
    rationale,
    decidedBy: user,
    decidedAt: new Date().toISOString(),
  };
  return pruneOrphans({
    targets: state.targets.map((t) => targetIds.includes(t.id)
      ? { ...t, physicalPointId: pp.id, outputName: resolvedOutputNames.get(t.id) ?? t.outputName }
      : t),
    physicalPoints: [...cleaned, pp],
  });
}

/** detach a prism into its own distinct physical point */
export function unlinkPrism(state: MappingState, targetId: string, user: string, rationale: string): MappingState {
  const t = state.targets.find((x) => x.id === targetId);
  if (!t) return state;
  const taken = new Set(state.physicalPoints.map((p) => p.engineName));
  const outputTakenByOtherPoints = new Set(state.targets
    .filter((x) => x.id !== targetId && x.physicalPointId !== t.physicalPointId)
    .map((x) => x.outputName));
  let outputName = t.outputName;
  let outputSuffix = 2;
  while (outputTakenByOtherPoints.has(outputName)) outputName = `${t.outputName}_${outputSuffix++}`;
  const pp: PhysicalPoint = {
    id: `pp-${Date.now()}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    label: t.adjustmentName,
    engineName: uniqueEngineName(t.adjustmentName, taken),
    role: t.role,
    outputName,
    btmPrismIds: [t.btmPrismId],
    state: 'resolved',
    source: 'manual',
    rationale,
    decidedBy: user,
    decidedAt: new Date().toISOString(),
  };
  // remove the prism from its previous shared point; demote it if it drops
  // to a single remaining prism
  const points = state.physicalPoints.map((p) => {
    if (p.id !== t.physicalPointId) return p;
    const rest = p.btmPrismIds.filter((b) => b !== t.btmPrismId);
    return { ...p, btmPrismIds: rest, state: rest.length <= 1 ? 'resolved' as const : p.state };
  });
  return pruneOrphans({
    targets: state.targets.map((x) => x.id === targetId ? { ...x, physicalPointId: pp.id, outputName } : x),
    physicalPoints: [...points, pp],
  });
}

/** attach prisms to an already-defined physical point */
export function attachToPoint(
  state: MappingState, targetIds: string[], pointId: string, user: string, rationale: string,
): MappingState {
  const pp = state.physicalPoints.find((p) => p.id === pointId);
  if (!pp) return state;
  const selected = state.targets.filter((t) => targetIds.includes(t.id));
  const points = state.physicalPoints.map((p) => {
    if (p.id === pointId) {
      return {
        ...p,
        btmPrismIds: [...new Set([...p.btmPrismIds, ...selected.map((t) => t.btmPrismId)])],
        state: 'shared' as const,
        source: 'manual' as const,
        rationale,
        decidedBy: user,
        decidedAt: new Date().toISOString(),
      };
    }
    // remove moved prisms from their previous points (demote if single left)
    const rest = p.btmPrismIds.filter((b) => !selected.some((t) => t.btmPrismId === b));
    return { ...p, btmPrismIds: rest, state: p.state === 'shared' && rest.length <= 1 ? 'resolved' as const : p.state };
  });
  return pruneOrphans({
    targets: state.targets.map((t) => targetIds.includes(t.id) ? { ...t, physicalPointId: pointId } : t),
    physicalPoints: points,
  });
}

/** confirm that the selected prisms are distinct points (human decision) */
export function confirmDistinct(state: MappingState, targetIds: string[], user: string): MappingState {
  const pointIds = new Set(state.targets.filter((t) => targetIds.includes(t.id)).map((t) => t.physicalPointId));
  return {
    ...state,
    physicalPoints: state.physicalPoints.map((p) => pointIds.has(p.id) && p.btmPrismIds.length === 1
      ? {
        ...p,
        state: 'resolved',
        source: 'manual',
        rationale: 'Confirmed as a distinct physical point',
        decidedBy: user,
        decidedAt: new Date().toISOString(),
      }
      : p),
  };
}

/** per-prism independent coordinates from the provisional computation */
export function perPrismCoordinates(
  state: MappingState, provisional: ProvisionalCoordinate[],
): Map<string, { e: number; n: number; h: number; stationId: string }> {
  const out = new Map<string, { e: number; n: number; h: number; stationId: string }>();
  for (const t of state.targets) {
    const engineName = resolveEngineName(t, state.physicalPoints);
    const prov = provisional.find((p) => p.targetId === engineName);
    if (!prov) continue;
    const stationId = t.stationIds[0];
    const per = prov.perStation.find((s) => s.stationId === stationId);
    if (per) out.set(t.btmPrismId, { e: per.easting, n: per.northing, h: per.height, stationId });
    else if (prov.perStation.length === 0) out.set(t.btmPrismId, { e: prov.easting, n: prov.northing, h: prov.height, stationId });
  }
  return out;
}

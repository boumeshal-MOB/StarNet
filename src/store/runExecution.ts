// ---------------------------------------------------------------------------
// Run execution helpers: output-slot arithmetic, multi-station epoch
// selection (fresh / reused / missing), runner-input assembly from a
// configuration snapshot, status derivation and engine artifacts.
// ---------------------------------------------------------------------------

import type {
  AdjustmentRun, ConfigurationVersion, EngineArtifact, EnvironmentalObservation,
  OutputResultVersion, OutputVariableKey, RawObservation, ReferenceSet,
  RunQualityStatus, StationEpochUsage,
} from '../types/domain';
import type { RunnerInput, RunnerOutput } from '../engine/runner';
import { repository } from '../data/repository';

/** grouping window for one observation cycle (a real cycle spans ~10-15 min) */
const CYCLE_WINDOW_MS = 20 * 60000;

export function slotMs(intervalMin: number, epochMs: number): number {
  const step = intervalMin * 60000;
  return Math.round(epochMs / step) * step;
}

export function listSlots(intervalMin: number, fromMs: number, toMs: number): number[] {
  const step = intervalMin * 60000;
  const first = Math.ceil(fromMs / step) * step;
  const out: number[] = [];
  for (let t = first; t <= toMs; t += step) out.push(t);
  return out;
}

export interface CycleSelection {
  usage: StationEpochUsage[];
  observations: RawObservation[];
  provisionalReasons: string[];
  fatal?: string;
}

/**
 * Select one observation cycle per station for an output slot.
 * Fresh = within the sync tolerance of the slot; otherwise the latest cycle
 * within maxReusedAgeMin is reused (provisional). Missing optional stations
 * are skipped; missing required stations abort the run.
 */
export function selectCycles(
  config: ConfigurationVersion,
  slot: number,
  allObs: RawObservation[],
): CycleSelection {
  const run = config.runPolicy;
  const usage: StationEpochUsage[] = [];
  const observations: RawObservation[] = [];
  const provisionalReasons: string[] = [];
  let fatal: string | undefined;

  for (const st of config.stations) {
    const mine = allObs
      .filter((o) => o.stationId === st.id)
      .sort((a, b) => a.epoch.localeCompare(b.epoch));
    const tol = run.syncToleranceMin * 60000;
    const inWindow = mine.filter((o) => {
      const t = new Date(o.epoch).getTime();
      return t >= slot - tol && t <= slot + tol;
    });
    let cycle: RawObservation[] = [];
    let state: StationEpochUsage['state'] = 'missing';
    let epoch = '';
    if (inWindow.length > 0) {
      // latest cycle in the window: all obs within the cycle window of the newest epoch
      const newest = new Date(inWindow[inWindow.length - 1].epoch).getTime();
      cycle = inWindow.filter((o) => Math.abs(new Date(o.epoch).getTime() - newest) < CYCLE_WINDOW_MS);
      state = 'fresh';
      epoch = inWindow[inWindow.length - 1].epoch;
    } else if (run.reuseMissingStation) {
      const before = mine.filter((o) => {
        const t = new Date(o.epoch).getTime();
        return t < slot && slot - t <= run.maxReusedAgeMin * 60000;
      });
      if (before.length > 0) {
        const newest = new Date(before[before.length - 1].epoch).getTime();
        cycle = before.filter((o) => Math.abs(new Date(o.epoch).getTime() - newest) < CYCLE_WINDOW_MS);
        state = 'reused';
        epoch = before[before.length - 1].epoch;
        if (run.markReusedProvisional) {
          provisionalReasons.push(`${st.id}: reused epoch ${epoch} (age ${Math.round((slot - newest) / 60000)} min)`);
        }
      }
    }
    if (state === 'missing') {
      if (st.required) {
        fatal = `Required station ${st.id} has no usable data within ${run.maxReusedAgeMin} min of the slot`;
      } else if (run.computeWithoutOptional) {
        provisionalReasons.push(`${st.id}: optional station missing - computed without it`);
      } else {
        fatal = `Optional station ${st.id} missing and computeWithoutOptional is disabled`;
      }
    }
    usage.push({
      stationId: st.id,
      epoch: epoch || new Date(slot).toISOString(),
      ageMin: epoch ? Math.round((slot - new Date(epoch).getTime()) / 60000) : NaN,
      state,
    });
    observations.push(...cycle);
  }
  return { usage, observations, provisionalReasons, fatal };
}

export function findReferenceSet(config: ConfigurationVersion, sets: ReferenceSet[]): ReferenceSet | undefined {
  return sets.find((s) => s.id === config.referenceSetId);
}

export function buildRunnerInput(
  config: ConfigurationVersion,
  observations: RawObservation[],
  env: EnvironmentalObservation[],
  referenceSet: ReferenceSet,
  overrides?: Partial<RunnerInput>,
): RunnerInput {
  const instruments: RunnerInput['instruments'] = {};
  for (const p of repository.instrumentProfiles()) instruments[p.id] = p;
  const provisional: RunnerInput['provisional'] = {};
  for (const p of config.provisionalCoordinates) {
    provisional[p.targetId] = { e: p.easting, n: p.northing, h: p.height };
  }
  return {
    observations,
    env,
    stations: config.stations,
    instruments,
    prismSetups: config.prismSetups,
    targets: config.targets,
    physicalPoints: config.physicalPoints ?? [],
    references: referenceSet.points,
    provisional,
    adjustment: config.adjustment,
    ...overrides,
  };
}

export function deriveStatus(out: RunnerOutput, provisional: boolean): RunQualityStatus {
  if (!out.ok) return 'Technical error';
  const q = out.attempts[out.finalAttempt].quality;
  if (!q.converged || q.rankDeficiency > 0) return 'Technical error';
  if (!q.chiSquarePassed) return 'Failed quality control';
  if (provisional) return 'Provisional';
  if (q.warnings.length > 0) return 'Success with warnings';
  return 'Success';
}

// ------------------------------------------------------------- artifacts ---

export function buildArtifacts(runId: string, out: RunnerOutput, input: RunnerInput): EngineArtifact[] {
  const now = new Date().toISOString();
  const q = out.attempts[out.finalAttempt]?.quality;
  const coords = out.attempts[out.finalAttempt]?.coordinates ?? [];
  const pts = coords.map((c) =>
    `${c.targetId.padEnd(12)} ${c.easting.toFixed(4).padStart(12)} ${c.northing.toFixed(4).padStart(12)} ${c.height.toFixed(4).padStart(10)}  ${(c.sigmaE * 1000).toFixed(2)} ${(c.sigmaN * 1000).toFixed(2)} ${(c.sigmaH * 1000).toFixed(2)} mm`).join('\n');
  const lst = [
    'ADJUSTMENT LISTING (native-output equivalent)',
    `Observations: ${q?.nObservations}  Constraints: ${q?.nConstraints}  Unknowns: ${q?.nUnknowns}`,
    `Degrees of freedom: ${q?.degreesOfFreedom}`,
    `Weighted SSR: ${q?.weightedSSR.toFixed(3)}  Variance factor: ${q?.varianceFactor.toFixed(3)}`,
    `Chi-square (2-sided): ${q?.chiSquareLower.toFixed(1)} <= ${q?.chiSquareValue.toFixed(1)} <= ${q?.chiSquareUpper.toFixed(1)} : ${q?.chiSquarePassed ? 'PASSED' : 'FAILED'}`,
    `Iterations: ${q?.iterations}  Converged: ${q?.converged}`,
    '',
    'RESIDUALS (worst 20 by standardized residual)',
    ...(out.attempts[out.finalAttempt]?.observations ?? [])
      .filter((o) => o.used && o.stdResidual !== undefined)
      .sort((a, b) => (b.stdResidual ?? 0) - (a.stdResidual ?? 0))
      .slice(0, 20)
      .map((o) => `${o.observationId.padEnd(44)} v=${((o.residual ?? 0) * (o.kind === 'sd' ? 1000 : 206264.8)).toFixed(2).padStart(9)} ${o.kind === 'sd' ? 'mm' : '"'}  stdres=${(o.stdResidual ?? 0).toFixed(2)}`),
  ].join('\n');
  const errLines = [
    ...(out.ok ? [] : [`ERROR: ${out.failureReason}`]),
    ...(q?.warnings ?? []).map((w) => `WARNING: ${w}`),
    ...out.preparationWarnings.map((w) => `WARNING: ${w}`),
  ];
  return [
    { id: `${runId}-input`, runId, kind: 'input-snapshot', label: 'Input snapshot (.DAT equivalent)', content: JSON.stringify({ observations: input.observations.map((o) => o.id), adjustment: input.adjustment, stations: input.stations.map((s) => s.id), references: input.references }, null, 2), createdAt: now },
    { id: `${runId}-log`, runId, kind: 'engine-log', label: 'Engine log', content: out.logs.join('\n'), createdAt: now },
    { id: `${runId}-pts`, runId, kind: 'pts-equivalent', label: 'Coordinates (.PTS equivalent)', content: pts, createdAt: now },
    { id: `${runId}-lst`, runId, kind: 'lst-equivalent', label: 'Listing (.LST equivalent)', content: lst, createdAt: now },
    { id: `${runId}-err`, runId, kind: 'err-equivalent', label: 'Errors & warnings (.ERR equivalent)', content: errLines.join('\n') || '(no errors, no warnings)', createdAt: now },
  ];
}

// --------------------------------------------------------- output values ---

export function buildOutputValues(
  run: AdjustmentRun,
  config: ConfigurationVersion,
): OutputResultVersion['values'] {
  const attempt = run.attempts[run.finalAttempt];
  if (!attempt) return {};
  const values: OutputResultVersion['values'] = {};
  const wanted = new Set<OutputVariableKey>(config.outputPolicy.variables);
  for (const c of attempt.coordinates) {
    const t = config.targets.find((x) => x.adjustmentName === c.targetId);
    if (!t || !t.publishOutput) continue;
    const v: Partial<Record<OutputVariableKey, number | string>> = {};
    const put = (k: OutputVariableKey, val: number | string | undefined) => {
      if (val !== undefined && wanted.has(k)) v[k] = val;
    };
    put('easting', round6(c.easting));
    put('northing', round6(c.northing));
    put('height', round6(c.height));
    put('dE', c.dE !== undefined ? round6(c.dE) : undefined);
    put('dN', c.dN !== undefined ? round6(c.dN) : undefined);
    put('dH', c.dH !== undefined ? round6(c.dH) : undefined);
    put('horizontalDisplacement', c.dE !== undefined && c.dN !== undefined
      ? round6(Math.hypot(c.dE, c.dN)) : undefined);
    put('displacement3D', c.dE !== undefined && c.dN !== undefined && c.dH !== undefined
      ? round6(Math.hypot(c.dE, c.dN, c.dH)) : undefined);
    put('sigmaE', round6(c.sigmaE));
    put('sigmaN', round6(c.sigmaN));
    put('sigmaH', round6(c.sigmaH));
    put('qualityStatus', run.status);
    put('provisionalStatus', run.provisional ? 'provisional' : 'final');
    values[t.outputName] = v;
  }
  return values;
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

/* eslint-disable react-refresh/only-export-components */
// ---------------------------------------------------------------------------
// Application store: single React context holding all BTM entities, with
// IndexedDB persistence. Immutability rules are enforced here:
//   - a configuration version used by a run can never be edited or deleted
//   - results are never overwritten: recalculation creates a new version
//   - every meaningful action is written to the audit log
// ---------------------------------------------------------------------------

import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import type {
  AdjustmentRun, AnalysisOverrides, AnalysisSession, AnalysisTrial, AuditEvent,
  ConfigurationVersion, EngineArtifact, OutputResultVersion, Processing,
  ProcessingStatus, ReferenceSet,
} from '../types/domain';
import { repository, getDeliveryState, setDeliveryState, type DeliveryState } from '../data/repository';
import { COUNTRY_TEMPLATES, DEFAULT_ADJUSTMENT, DEFAULT_OUTPUT, DEFAULT_RUN } from '../data/templates';
import { loadPersisted, savePersisted, clearPersisted } from '../data/db';
import { runAdjustmentAsync } from '../engine/engineClient';
import { buildResolvedMapping, validatePointMapping } from '../engine/pointIdentity';
import type { RunnerInput, RunnerOutput } from '../engine/runner';
import {
  buildArtifacts, buildOutputValues, buildRunnerInput, deriveStatus,
  findReferenceSet, listSlots, selectCycles, slotMs,
} from './runExecution';
import { DEMO_USER, nextId, seedDemo } from './seed';

export interface AppState {
  booted: boolean;
  user: string;
  processings: Processing[];
  configVersions: ConfigurationVersion[];
  referenceSets: ReferenceSet[];
  runs: AdjustmentRun[];
  results: OutputResultVersion[];
  artifacts: EngineArtifact[];
  analysisSessions: AnalysisSession[];
  audit: AuditEvent[];
  delivery: DeliveryState;
  countryTemplates: typeof COUNTRY_TEMPLATES;
  adjustmentTemplates: (typeof DEFAULT_ADJUSTMENT)[];
  runTemplates: (typeof DEFAULT_RUN)[];
  outputTemplates: (typeof DEFAULT_OUTPUT)[];
  busy: string | null;
}

const initialState: AppState = {
  booted: false,
  user: DEMO_USER,
  processings: [],
  configVersions: [],
  referenceSets: [],
  runs: [],
  results: [],
  artifacts: [],
  analysisSessions: [],
  audit: [],
  delivery: { ats36LateDelivered: false, ats35EnvDelivered: false },
  countryTemplates: COUNTRY_TEMPLATES,
  adjustmentTemplates: [DEFAULT_ADJUSTMENT],
  runTemplates: [DEFAULT_RUN],
  outputTemplates: [DEFAULT_OUTPUT],
  busy: null,
};

type Updater = (s: AppState) => AppState;

export interface ExecuteOptions {
  trigger: AdjustmentRun['trigger'];
  slotIso?: string;
  configVersionId?: string;      // force a configuration (reprocess strategy)
  excludedObservationIds?: string[];
  protectedObservationIds?: string[];
  observationValueOverrides?: RunnerInput['observationValueOverrides'];
  envOverrides?: RunnerInput['envOverrides'];
  instrumentOverrides?: RunnerInput['instrumentOverrides'];
  autoCorrection?: boolean;
  dryRun?: boolean;              // do not persist results (reprocess preview)
  label?: string;                // result label
  reason?: string;
}

export interface AppActions {
  logAudit: (category: AuditEvent['category'], action: string, details: string, processingId?: string, entityId?: string) => void;
  resetDemo: () => Promise<void>;
  update: (fn: Updater) => void;
  createProcessing: (p: Processing, config: ConfigurationVersion, refSets: ReferenceSet[]) => void;
  setProcessingActive: (id: string, active: boolean) => void;
  archiveProcessing: (id: string) => void;
  duplicateProcessing: (id: string) => void;
  configForSlot: (processingId: string, slot: number) => ConfigurationVersion | undefined;
  executeRun: (processingId: string, opts: ExecuteOptions) => Promise<AdjustmentRun | null>;
  catchUp: (processingId: string, slotIso: string, reason: string) => Promise<AdjustmentRun | null>;
  reprocess: (processingId: string, fromIso: string, toIso: string, opts: {
    strategy: 'per-slot' | 'forced'; forcedConfigId?: string; dryRun: boolean;
    autoCorrection: boolean; reason: string;
  }) => Promise<{ slots: number; runs: AdjustmentRun[] }>;
  promoteResult: (resultId: string) => void;
  createConfigVersion: (processingId: string, base: ConfigurationVersion,
    changes: Partial<ConfigurationVersion>, meta: {
      label: string; description: string; technicalReason?: string;
      validFrom: string; validTo?: string; activate: boolean;
      sourceAnalysisSessionId?: string; sourceTrialId?: string;
    }) => ConfigurationVersion;
  setConfigStatus: (configId: string, status: ConfigurationVersion['status']) => void;
  addReferenceSet: (set: ReferenceSet) => void;
  createAnalysisSession: (processingId: string, configVersionId: string, slotIso: string,
    opts: { autoCorrection: boolean; confidence: number; comment?: string }) => Promise<AnalysisSession | null>;
  runTrial: (sessionId: string, overrides: AnalysisOverrides, label: string, comment?: string) => Promise<AnalysisTrial | null>;
  markCandidate: (sessionId: string, trialId: string, justification: string) => void;
  saveTrialAsConfig: (sessionId: string, trialId: string, meta: {
    label: string; description: string; technicalReason: string;
    validFrom: string; validTo?: string; activate: boolean;
  }) => ConfigurationVersion | null;
  setSessionStatus: (sessionId: string, status: AnalysisSession['status']) => void;
  deliverLateObservations: () => number;
  deliverLateEnvironmental: () => number;
  runDraftTest: (config: ConfigurationVersion, refSet: ReferenceSet, slotIso?: string) => Promise<{ output: RunnerOutput; slotIso: string } | null>;
}

const StoreCtx = createContext<{ state: AppState; actions: AppActions } | null>(null);

const PERSIST_KEY = 'btm-state-v1';

type Persisted = Omit<AppState, 'booted' | 'busy'>;

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const update = useCallback((fn: Updater) => {
    setState((s) => {
      const n = fn(s);
      if (n.booted) {
        const { booted, busy, ...persisted } = n;
        savePersisted(PERSIST_KEY, persisted satisfies Persisted);
      }
      return n;
    });
  }, []);

  // ------------------------------------------------------------- boot -----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const persisted = await loadPersisted<Persisted>(PERSIST_KEY);
      if (cancelled) return;
      if (persisted && persisted.processings?.length) {
        setDeliveryState(persisted.delivery);
        setState({ ...initialState, ...persisted, booted: true, busy: null });
      } else {
        const seed = seedDemo();
        setState((s) => ({
          ...s,
          booted: true,
          processings: seed.processings,
          configVersions: seed.configVersions,
          referenceSets: seed.referenceSets,
          audit: seed.audit,
        }));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const logAudit = useCallback<AppActions['logAudit']>((category, action, details, processingId, entityId) => {
    update((s) => ({
      ...s,
      audit: [{
        id: nextId('audit'), at: new Date().toISOString(), user: s.user,
        category, action, details, processingId, entityId,
      }, ...s.audit],
    }));
  }, [update]);

  // -------------------------------------------------------- run core ------
  const executeCore = useCallback(async (
    config: ConfigurationVersion,
    slot: number,
    opts: ExecuteOptions,
  ): Promise<{ run: AdjustmentRun; output: RunnerOutput; artifacts: EngineArtifact[] } | { error: string }> => {
    const s = stateRef.current;
    const refSet = findReferenceSet(config, s.referenceSets) ?? analysisRefSets.get(config.referenceSetId);
    if (!refSet) return { error: `Reference set ${config.referenceSetId} not found` };
    // pre-run point-mapping checks: blocking issues stop the run before the engine
    const mappingIssues = validatePointMapping(config);
    const blocking = mappingIssues.filter((i) => i.level === 'blocking');
    if (blocking.length > 0) {
      return { error: `Point mapping check failed: ${blocking.map((b) => b.message).join(' | ')}` };
    }
    const allObs = repository.observations();
    const cycles = selectCycles(config, slot, allObs);
    if (cycles.fatal) return { error: cycles.fatal };
    if (cycles.observations.length === 0) return { error: 'No observations available for this slot' };
    const env = repository.environmental();

    const input = buildRunnerInput(config, cycles.observations, env, refSet, {
      excludedObservationIds: opts.excludedObservationIds,
      protectedObservationIds: opts.protectedObservationIds,
      observationValueOverrides: opts.observationValueOverrides,
      envOverrides: opts.envOverrides,
      instrumentOverrides: opts.instrumentOverrides,
      autoCorrection: opts.autoCorrection,
    });
    const started = Date.now();
    const output = await runAdjustmentAsync(input);
    const finished = Date.now();

    const waitingEnv = output.preparationWarnings.some((w) => w.includes('waiting for late environmental'));
    const provisional = cycles.provisionalReasons.length > 0 || waitingEnv;
    const provisionalReasons = [...cycles.provisionalReasons];
    if (waitingEnv) provisionalReasons.push('Environmental data missing: waiting for late T/P');
    const status = deriveStatus(output, provisional);
    const runId = nextId('run');
    const artifacts = buildArtifacts(runId, output, input);
    const run: AdjustmentRun = {
      id: runId,
      processingId: config.processingId,
      configurationVersionId: config.id,
      outputSlot: new Date(slot).toISOString(),
      trigger: opts.trigger,
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date(finished).toISOString(),
      durationMs: finished - started,
      status,
      provisional,
      provisionalReasons,
      stationEpochs: cycles.usage,
      observationIds: cycles.observations.map((o) => o.id),
      resolvedMapping: buildResolvedMapping(config),
      corrections: output.corrections,
      attempts: output.attempts,
      finalAttempt: output.finalAttempt,
      engineReturnCode: output.engineReturnCode,
      artifactIds: artifacts.map((a) => a.id),
      inputSnapshot: JSON.stringify({
        configurationVersionId: config.id,
        referenceSetId: refSet.id,
        slot: new Date(slot).toISOString(),
        stationEpochs: cycles.usage,
        observationIds: cycles.observations.map((o) => o.id),
        resolvedPointMapping: buildResolvedMapping(config),
        adjustment: config.adjustment,
        overrides: {
          excluded: opts.excludedObservationIds ?? [],
          values: opts.observationValueOverrides ?? {},
        },
      }, null, 2),
      createdBy: s.user,
    };
    return { run, output, artifacts };
  }, []);

  const persistRun = useCallback((
    run: AdjustmentRun, artifacts: EngineArtifact[], config: ConfigurationVersion, opts: ExecuteOptions,
  ) => {
    // failed runs are recorded with their artifacts but never publish a result version
    const publishes = run.status === 'Success' || run.status === 'Success with warnings'
      || (run.status === 'Provisional' && config.outputPolicy.publishProvisional);
    update((s) => {
      if (!publishes) {
        return {
          ...s,
          runs: [run, ...s.runs],
          artifacts: [...artifacts, ...s.artifacts],
          processings: s.processings.map((p) => p.id === run.processingId
            ? { ...p, lastRunId: run.id, status: statusFromRun(run.status, p) } : p),
          configVersions: s.configVersions.map((c) =>
            c.id === config.id && !c.usedByRun ? { ...c, usedByRun: true } : c),
        };
      }
      const existing = s.results.filter((r) => r.processingId === run.processingId && r.outputSlot === run.outputSlot);
      const version = existing.length + 1;
      const quality = run.attempts[run.finalAttempt]?.quality;
      const prevCurrent = existing.find((r) => r.current);
      let makeCurrent = true;
      if (prevCurrent && config.runPolicy.replaceOnlyIfQualityImproves) {
        const prevRun = s.runs.find((r) => r.id === prevCurrent.runId);
        const prevQ = prevRun?.attempts[prevRun.finalAttempt]?.quality;
        if (prevQ && quality && quality.totalErrorFactor >= prevQ.totalErrorFactor) makeCurrent = false;
      }
      const result: OutputResultVersion = {
        id: nextId('result'),
        processingId: run.processingId,
        outputSlot: run.outputSlot,
        version,
        runId: run.id,
        label: opts.label ?? (version === 1 ? 'Initial result' : `Recalculation V${version}`),
        provisional: run.provisional,
        current: makeCurrent,
        values: buildOutputValues(run, config),
        createdAt: new Date().toISOString(),
        createdBy: s.user,
        reason: opts.reason ?? opts.trigger,
      };
      const results = s.results.map((r) =>
        r.processingId === run.processingId && r.outputSlot === run.outputSlot && makeCurrent
          ? { ...r, current: false, supersededById: result.id }
          : r);
      const processings = s.processings.map((p) => p.id === run.processingId
        ? { ...p, lastRunId: run.id, status: statusFromRun(run.status, p) }
        : p);
      const configVersions = s.configVersions.map((c) =>
        c.id === config.id && !c.usedByRun ? { ...c, usedByRun: true } : c);
      return {
        ...s,
        runs: [run, ...s.runs],
        results: [result, ...results],
        artifacts: [...artifacts, ...s.artifacts],
        processings,
        configVersions,
      };
    });
  }, [update]);

  const configForSlot = useCallback((processingId: string, slot: number): ConfigurationVersion | undefined => {
    const s = stateRef.current;
    const slotIso = new Date(slot).toISOString();
    const versions = s.configVersions
      .filter((c) => c.processingId === processingId && c.status !== 'draft' && c.status !== 'archived')
      .sort((a, b) => b.versionNumber - a.versionNumber);
    return versions.find((c) => c.validFrom <= slotIso && (!c.validTo || slotIso < c.validTo));
  }, []);

  const executeRun = useCallback<AppActions['executeRun']>(async (processingId, opts) => {
    const s = stateRef.current;
    update((x) => ({ ...x, busy: 'Running adjustment...' }));
    try {
      let slot: number;
      const cfg0 = s.configVersions.find((c) => c.id ===
        s.processings.find((p) => p.id === processingId)?.activeConfigurationVersionId);
      if (opts.slotIso) {
        slot = new Date(opts.slotIso).getTime();
      } else {
        // latest slot having data for THIS processing's stations only
        const stationIds = new Set(cfg0?.stations.map((st) => st.id) ?? []);
        const obs = repository.observations().filter((o) => stationIds.has(o.stationId));
        const last = obs.reduce((acc, o) => Math.max(acc, new Date(o.epoch).getTime()), 0);
        if (last === 0) {
          logAudit('run', 'failed', 'No observations available for the stations of this processing', processingId);
          return null;
        }
        slot = slotMs(cfg0?.outputPolicy.outputIntervalMin ?? 30, last);
      }
      const config = opts.configVersionId
        ? s.configVersions.find((c) => c.id === opts.configVersionId)
        : configForSlot(processingId, slot);
      if (!config) {
        logAudit('run', 'failed', `No configuration valid for slot ${new Date(slot).toISOString()}`, processingId);
        return null;
      }
      const res = await executeCore(config, slot, opts);
      if ('error' in res) {
        logAudit('run', 'failed', res.error, processingId);
        update((x) => ({
          ...x,
          processings: x.processings.map((p) => p.id === processingId
            ? { ...p, status: 'Waiting for data' as ProcessingStatus } : p),
        }));
        return null;
      }
      if (!opts.dryRun) {
        persistRun(res.run, res.artifacts, config, opts);
        logAudit('run', opts.trigger, `Run ${res.run.id} on slot ${res.run.outputSlot}: ${res.run.status}`, processingId, res.run.id);
      }
      return res.run;
    } finally {
      update((x) => ({ ...x, busy: null }));
    }
  }, [configForSlot, executeCore, logAudit, persistRun, update]);

  const catchUp = useCallback<AppActions['catchUp']>(async (processingId, slotIso, reason) => {
    const s = stateRef.current;
    const existing = s.results.filter((r) => r.processingId === processingId && r.outputSlot === slotIso);
    const config = configForSlot(processingId, new Date(slotIso).getTime());
    if (config && existing.length >= config.runPolicy.maxRecalcPerSlot) {
      logAudit('run', 'catch-up-blocked', `Max recalculations per slot reached (${config.runPolicy.maxRecalcPerSlot})`, processingId);
      return null;
    }
    const run = await executeRun(processingId, {
      trigger: 'catch-up', slotIso, reason,
      label: `V${existing.length + 1} - ${run0Label(existing.length + 1)}`,
    });
    return run;
  }, [configForSlot, executeRun, logAudit]);

  const reprocess = useCallback<AppActions['reprocess']>(async (processingId, fromIso, toIso, opts) => {
    const s = stateRef.current;
    const proc = s.processings.find((p) => p.id === processingId);
    const interval = s.configVersions.find((c) => c.id === proc?.activeConfigurationVersionId)
      ?.outputPolicy.outputIntervalMin ?? 30;
    const slots = listSlots(interval, new Date(fromIso).getTime(), new Date(toIso).getTime());
    const runs: AdjustmentRun[] = [];
    logAudit('reprocess', opts.dryRun ? 'dry-run' : 'start',
      `Reprocess ${slots.length} slot(s) from ${fromIso} to ${toIso} (${opts.strategy})`, processingId);
    for (const slot of slots) {
      const run = await executeRun(processingId, {
        trigger: 'reprocess',
        slotIso: new Date(slot).toISOString(),
        configVersionId: opts.strategy === 'forced' ? opts.forcedConfigId : undefined,
        autoCorrection: opts.autoCorrection,
        dryRun: opts.dryRun,
        reason: opts.reason,
        label: undefined,
      });
      if (run) runs.push(run);
    }
    logAudit('reprocess', 'done', `Reprocess finished: ${runs.length}/${slots.length} run(s) executed`, processingId);
    return { slots: slots.length, runs };
  }, [executeRun, logAudit]);

  // -------------------------------------------------------- analysis ------
  const createAnalysisSession = useCallback<AppActions['createAnalysisSession']>(
    async (processingId, configVersionId, slotIso, opts) => {
      const s = stateRef.current;
      const config = s.configVersions.find((c) => c.id === configVersionId);
      if (!config) return null;
      update((x) => ({ ...x, busy: 'Running baseline...' }));
      try {
        const res = await executeCore(config, new Date(slotIso).getTime(), {
          trigger: 'analysis', autoCorrection: opts.autoCorrection,
        });
        if ('error' in res) {
          logAudit('analysis', 'failed', `Baseline failed: ${res.error}`, processingId);
          return null;
        }
        const sessionId = nextId('session');
        const baseline: AnalysisTrial = {
          id: nextId('trial'),
          sessionId,
          trialNumber: 0,
          label: 'Trial 0 - Baseline',
          overrides: emptyOverrides(),
          changedFields: [],
          run: res.run,
          isCandidate: false,
          diagnosticFlags: [],
          createdAt: new Date().toISOString(),
          createdBy: s.user,
        };
        const session: AnalysisSession = {
          id: sessionId,
          processingId,
          configurationVersionId: configVersionId,
          outputSlot: slotIso,
          snapshotObservationIds: res.run.observationIds,
          snapshotJson: res.run.inputSnapshot,
          status: 'open',
          trials: [baseline],
          createdAt: new Date().toISOString(),
          createdBy: s.user,
          comment: opts.comment,
          readOnly: false,
        };
        update((x) => ({ ...x, analysisSessions: [session, ...x.analysisSessions] }));
        logAudit('analysis', 'create-session', `Analysis session on slot ${slotIso} (baseline ${res.run.status})`, processingId, sessionId);
        return session;
      } finally {
        update((x) => ({ ...x, busy: null }));
      }
    }, [executeCore, logAudit, update]);

  const runTrial = useCallback<AppActions['runTrial']>(async (sessionId, overrides, label, comment) => {
    const s = stateRef.current;
    const session = s.analysisSessions.find((x) => x.id === sessionId);
    if (!session || session.readOnly) return null;
    const config = s.configVersions.find((c) => c.id === session.configurationVersionId);
    if (!config) return null;
    update((x) => ({ ...x, busy: 'Running trial...' }));
    try {
      const trialConfig = applyOverridesToConfig(config, overrides, s.referenceSets);
      const res = await executeCore(trialConfig.config, new Date(session.outputSlot).getTime(), {
        trigger: 'analysis',
        excludedObservationIds: overrides.excludedObservationIds,
        protectedObservationIds: overrides.protectedObservationIds,
        observationValueOverrides: overrides.observationValueOverrides,
        envOverrides: overrides.envOverrides,
        instrumentOverrides: overrides.instrumentOverrides,
        autoCorrection: (overrides.adjustmentOverrides.autoCorrectionEnabled
          ?? config.adjustment.autoCorrectionEnabled),
      });
      if ('error' in res) {
        logAudit('analysis', 'trial-failed', res.error, session.processingId, sessionId);
        return null;
      }
      const baseline = session.trials.find((t) => t.trialNumber === 0);
      const flags = diagnosticFlags(baseline?.run, res.run, overrides, config);
      const trial: AnalysisTrial = {
        id: nextId('trial'),
        sessionId,
        trialNumber: session.trials.length,
        label: label || `Trial ${session.trials.length}`,
        overrides: JSON.parse(JSON.stringify(overrides)),
        changedFields: trialConfig.changedFields,
        run: res.run,
        isCandidate: false,
        diagnosticFlags: flags,
        createdAt: new Date().toISOString(),
        createdBy: s.user,
        comment,
      };
      update((x) => ({
        ...x,
        analysisSessions: x.analysisSessions.map((se) => se.id === sessionId
          ? { ...se, trials: [...se.trials, trial] } : se),
      }));
      logAudit('analysis', 'run-trial', `${trial.label}: ${res.run.status}${flags.length ? ` [${flags.length} quality flag(s)]` : ''}`, session.processingId, sessionId);
      return trial;
    } finally {
      update((x) => ({ ...x, busy: null }));
    }
  }, [executeCore, logAudit, update]);

  const saveTrialAsConfig = useCallback<AppActions['saveTrialAsConfig']>((sessionId, trialId, meta) => {
    const s = stateRef.current;
    const session = s.analysisSessions.find((x) => x.id === sessionId);
    const trial = session?.trials.find((t) => t.id === trialId);
    const base = s.configVersions.find((c) => c.id === session?.configurationVersionId);
    if (!session || !trial || !base) return null;
    const applied = applyOverridesToConfig(base, trial.overrides, s.referenceSets);
    // materialize the analysis reference set as a persisted new version
    if (applied.config.referenceSetId.endsWith('::analysis')) {
      const tmp = analysisRefSets.get(applied.config.referenceSetId);
      if (tmp) {
        const version = Math.max(0, ...s.referenceSets
          .filter((r) => r.processingId === base.processingId).map((r) => r.version)) + 1;
        const persistedSet: ReferenceSet = {
          ...JSON.parse(JSON.stringify(tmp)) as ReferenceSet,
          id: nextId('refset'),
          name: `${meta.label} references`,
          version,
          usedByRun: false,
          createdAt: new Date().toISOString(),
          createdBy: s.user,
          comment: `Created from analysis session ${sessionId}, trial ${trial.trialNumber}`,
        };
        update((x) => ({ ...x, referenceSets: [...x.referenceSets, persistedSet] }));
        applied.config.referenceSetId = persistedSet.id;
      }
    }
    const created = createConfigVersionInternal(base.processingId, base, {
      stations: applied.config.stations,
      prismSetups: applied.config.prismSetups,
      targets: applied.config.targets,
      adjustment: applied.config.adjustment,
      provisionalCoordinates: applied.config.provisionalCoordinates,
      referenceSetId: applied.config.referenceSetId,
    }, {
      ...meta,
      sourceAnalysisSessionId: sessionId,
      sourceTrialId: trialId,
    });
    update((x) => ({
      ...x,
      analysisSessions: x.analysisSessions.map((se) => se.id === sessionId
        ? { ...se, resultingConfigurationVersionId: created.id, bestCandidateTrialId: trialId } : se),
    }));
    logAudit('analysis', 'save-config', `Trial ${trial.trialNumber} saved as configuration ${created.label}`, base.processingId, created.id);
    return created;
  }, [logAudit, update]);

  // ---------------------------------------------- configuration versions --
  const createConfigVersionInternal = useCallback((
    processingId: string,
    base: ConfigurationVersion,
    changes: Partial<ConfigurationVersion>,
    meta: Parameters<AppActions['createConfigVersion']>[3],
  ): ConfigurationVersion => {
    const s = stateRef.current;
    const versions = s.configVersions.filter((c) => c.processingId === processingId);
    const nextNumber = Math.max(0, ...versions.map((v) => v.versionNumber)) + 1;
    const created: ConfigurationVersion = {
      ...JSON.parse(JSON.stringify(base)) as ConfigurationVersion,
      ...changes,
      id: nextId('config'),
      processingId,
      versionNumber: nextNumber,
      label: meta.label || `V${nextNumber}`,
      description: meta.description,
      technicalReason: meta.technicalReason,
      validFrom: meta.validFrom,
      validTo: meta.validTo,
      status: meta.activate ? 'active' : 'draft',
      usedByRun: false,
      createdAt: new Date().toISOString(),
      createdBy: s.user,
      sourceAnalysisSessionId: meta.sourceAnalysisSessionId,
      sourceTrialId: meta.sourceTrialId,
    };
    update((x) => ({
      ...x,
      configVersions: [
        ...x.configVersions.map((c) => {
          // close the previous open-ended active version to avoid overlaps
          if (meta.activate && c.processingId === processingId && c.status === 'active'
              && (!c.validTo || c.validTo > meta.validFrom)) {
            return { ...c, validTo: meta.validFrom, status: 'inactive' as const };
          }
          return c;
        }),
        created,
      ],
      processings: x.processings.map((p) => p.id === processingId
        ? {
          ...p,
          configurationVersionIds: [...p.configurationVersionIds, created.id],
          activeConfigurationVersionId: meta.activate ? created.id : p.activeConfigurationVersionId,
        }
        : p),
    }));
    logAudit('configuration', 'create-version', `${created.label} created (valid from ${meta.validFrom})`, processingId, created.id);
    return created;
  }, [logAudit, update]);

  // ------------------------------------------------------------- actions --
  const actions = useMemo<AppActions>(() => ({
    logAudit,
    update,
    resetDemo: async () => {
      await clearPersisted();
      window.location.reload();
    },
    createProcessing: (p, config, refSets) => {
      update((s) => ({
        ...s,
        processings: [...s.processings, p],
        configVersions: [...s.configVersions, config],
        referenceSets: [...s.referenceSets, ...refSets],
      }));
      logAudit('processing', 'create', `Processing "${p.name}" created`, p.id);
    },
    setProcessingActive: (id, active) => {
      update((s) => ({
        ...s,
        processings: s.processings.map((p) => p.id === id
          ? { ...p, active, status: active ? 'Ready' : 'Disabled' } : p),
      }));
      logAudit('processing', active ? 'activate' : 'deactivate', `Processing ${active ? 'activated' : 'deactivated'}`, id);
    },
    archiveProcessing: (id) => {
      update((s) => ({
        ...s,
        processings: s.processings.map((p) => p.id === id
          ? { ...p, active: false, status: 'Archived' } : p),
      }));
      logAudit('processing', 'archive', 'Processing archived', id);
    },
    duplicateProcessing: (id) => {
      const s = stateRef.current;
      const src = s.processings.find((p) => p.id === id);
      if (!src) return;
      const newId = nextId('proc');
      const configs = s.configVersions.filter((c) => src.configurationVersionIds.includes(c.id));
      const refSetIds = new Set(configs.map((c) => c.referenceSetId));
      const refSets = s.referenceSets.filter((r) => refSetIds.has(r.id));
      const refMap = new Map<string, string>();
      const newRefSets = refSets.map((r) => {
        const nid = nextId('refset');
        refMap.set(r.id, nid);
        return { ...JSON.parse(JSON.stringify(r)), id: nid, processingId: newId, usedByRun: false };
      });
      const newConfigs = configs.map((c) => ({
        ...JSON.parse(JSON.stringify(c)) as ConfigurationVersion,
        id: nextId('config'),
        processingId: newId,
        referenceSetId: refMap.get(c.referenceSetId) ?? c.referenceSetId,
        usedByRun: false,
      }));
      update((x) => ({
        ...x,
        processings: [...x.processings, {
          ...src,
          id: newId,
          name: `${src.name} (copy)`,
          status: 'Draft',
          active: false,
          createdAt: new Date().toISOString(),
          configurationVersionIds: newConfigs.map((c) => c.id),
          activeConfigurationVersionId: newConfigs[newConfigs.length - 1]?.id,
          lastRunId: undefined,
        }],
        configVersions: [...x.configVersions, ...newConfigs],
        referenceSets: [...x.referenceSets, ...newRefSets],
      }));
      logAudit('processing', 'duplicate', `Duplicated from ${src.name}`, newId);
    },
    configForSlot: (processingId, slot) => configForSlot(processingId, slot),
    executeRun,
    catchUp,
    reprocess,
    promoteResult: (resultId) => {
      update((s) => {
        const target = s.results.find((r) => r.id === resultId);
        if (!target) return s;
        return {
          ...s,
          results: s.results.map((r) =>
            r.processingId === target.processingId && r.outputSlot === target.outputSlot
              ? { ...r, current: r.id === resultId }
              : r),
        };
      });
      logAudit('result', 'promote', `Result ${resultId} promoted as current value`);
    },
    createConfigVersion: (processingId, base, changes, meta) =>
      createConfigVersionInternal(processingId, base, changes, meta),
    setConfigStatus: (configId, status) => {
      const s = stateRef.current;
      const c = s.configVersions.find((x) => x.id === configId);
      if (!c) return;
      if (c.usedByRun && (status === 'draft')) return; // used versions stay immutable
      update((x) => ({
        ...x,
        configVersions: x.configVersions.map((v) => v.id === configId ? { ...v, status } : v),
        processings: x.processings.map((p) => p.id === c.processingId && status === 'active'
          ? { ...p, activeConfigurationVersionId: configId } : p),
      }));
      logAudit('configuration', status, `Configuration ${c.label} -> ${status}`, c.processingId, configId);
    },
    addReferenceSet: (set) => {
      update((s) => ({ ...s, referenceSets: [...s.referenceSets, set] }));
      logAudit('reference', 'create-set', `Reference set "${set.name}" v${set.version} created`, set.processingId, set.id);
    },
    createAnalysisSession,
    runTrial,
    markCandidate: (sessionId, trialId, justification) => {
      update((s) => ({
        ...s,
        analysisSessions: s.analysisSessions.map((se) => se.id === sessionId
          ? {
            ...se,
            bestCandidateTrialId: trialId,
            trials: se.trials.map((t) => t.id === trialId
              ? { ...t, isCandidate: true, justification } : t),
          }
          : se),
      }));
      logAudit('analysis', 'mark-candidate', `Trial marked as candidate: ${justification}`, undefined, sessionId);
    },
    saveTrialAsConfig,
    setSessionStatus: (sessionId, status) => {
      update((s) => ({
        ...s,
        analysisSessions: s.analysisSessions.map((se) => se.id === sessionId
          ? { ...se, status, readOnly: status !== 'open' } : se),
      }));
      logAudit('analysis', `session-${status}`, `Analysis session ${status}`, undefined, sessionId);
    },
    deliverLateObservations: () => {
      const n = repository.deliverAts36LateData();
      update((s) => ({ ...s, delivery: { ...s.delivery, ats36LateDelivered: true } }));
      logAudit('data', 'late-observations', `${n} late ATS36 observations delivered to BTM (catch-up candidates)`);
      return n;
    },
    deliverLateEnvironmental: () => {
      const n = repository.deliverAts35EnvData();
      update((s) => ({ ...s, delivery: { ...s.delivery, ats35EnvDelivered: true } }));
      logAudit('data', 'late-environmental', `${n} late ATS35 T/P records delivered to BTM (catch-up candidates)`);
      return n;
    },
    runDraftTest: async (config, refSet, slotIso) => {
      update((x) => ({ ...x, busy: 'Running test adjustment...' }));
      try {
        const obs = repository.observations()
          .filter((o) => config.stations.some((s) => s.id === o.stationId));
        if (obs.length === 0) return null;
        const last = obs.reduce((acc, o) => Math.max(acc, new Date(o.epoch).getTime()), 0);
        const slot = slotIso ? new Date(slotIso).getTime() : slotMs(config.outputPolicy.outputIntervalMin, last);
        const cycles = selectCycles(config, slot, obs);
        if (cycles.fatal || cycles.observations.length === 0) return null;
        const input = buildRunnerInput(config, cycles.observations, repository.environmental(), refSet);
        const output = await runAdjustmentAsync(input);
        return { output, slotIso: new Date(slot).toISOString() };
      } finally {
        update((x) => ({ ...x, busy: null }));
      }
    },
  }), [catchUp, configForSlot, createAnalysisSession, createConfigVersionInternal,
    executeRun, logAudit, reprocess, runTrial, saveTrialAsConfig, update]);

  return <StoreCtx.Provider value={{ state, actions }}>{children}</StoreCtx.Provider>;
}

export function useApp() {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error('useApp outside provider');
  return ctx;
}

// --------------------------------------------------------------- helpers ---

function statusFromRun(runStatus: AdjustmentRun['status'], p: Processing): ProcessingStatus {
  if (!p.active) return p.status === 'Archived' ? 'Archived' : 'Disabled';
  switch (runStatus) {
    case 'Success': return 'Success';
    case 'Success with warnings': return 'Success with warnings';
    case 'Provisional': return 'Provisional';
    case 'Failed quality control': return 'Failed quality control';
    case 'Technical error': return 'Technical error';
    default: return 'Ready';
  }
}

function run0Label(version: number): string {
  return version <= 1 ? 'Initial result' : 'Final after catch-up';
}

export function emptyOverrides(): AnalysisOverrides {
  return {
    disabledReferencePointIds: [],
    referenceSigmaOverrides: {},
    referenceCoordinateOverrides: {},
    provisionalOverrides: {},
    excludedStationIds: [],
    excludedTargetIds: [],
    excludedObservationIds: [],
    protectedObservationIds: [],
    prismConstantOverrides: {},
    stationHeightOverrides: {},
    targetHeightOverrides: {},
    distanceStateOverrides: {},
    observationValueOverrides: {},
    adjustmentOverrides: {},
    envOverrides: {},
    instrumentOverrides: {},
  };
}

/** apply Analysis Lab overrides to a config copy; returns changed-field list */
export function applyOverridesToConfig(
  base: ConfigurationVersion,
  o: AnalysisOverrides,
  referenceSets: ReferenceSet[],
): { config: ConfigurationVersion; changedFields: string[] } {
  const config: ConfigurationVersion = JSON.parse(JSON.stringify(base));
  const changed: string[] = [];
  config.adjustment = { ...config.adjustment, ...o.adjustmentOverrides };
  for (const k of Object.keys(o.adjustmentOverrides)) changed.push(`adjustment.${k}`);

  config.stations = config.stations
    .filter((s) => !o.excludedStationIds.includes(s.id))
    .map((s) => {
      let st = s;
      if (o.stationHeightOverrides[s.id] !== undefined) {
        st = { ...st, instrumentHeightM: o.stationHeightOverrides[s.id] };
        changed.push(`station.${s.id}.instrumentHeight`);
      }
      if (o.distanceStateOverrides[s.id] !== undefined) {
        st = { ...st, distanceState: o.distanceStateOverrides[s.id] };
        changed.push(`station.${s.id}.distanceState`);
      }
      return st;
    });
  if (o.excludedStationIds.length) changed.push(`stations.excluded:${o.excludedStationIds.join('/')}`);

  config.targets = config.targets
    .filter((t) => !o.excludedTargetIds.includes(t.adjustmentName))
    .map((t) => (o.targetHeightOverrides[t.adjustmentName] !== undefined
      ? { ...t, targetHeightM: o.targetHeightOverrides[t.adjustmentName] }
      : t));
  if (o.excludedTargetIds.length) changed.push(`targets.excluded:${o.excludedTargetIds.join('/')}`);
  for (const k of Object.keys(o.targetHeightOverrides)) changed.push(`target.${k}.height`);

  config.prismSetups = config.prismSetups.map((sp) => {
    const key = `${sp.stationId}|${sp.targetKey}`;
    if (o.prismConstantOverrides[key] !== undefined) {
      changed.push(`prism.${key}.constant`);
      return { ...sp, effectiveConstantM: o.prismConstantOverrides[key], source: 'manual-override' as const };
    }
    return sp;
  });

  for (const [tid, c] of Object.entries(o.provisionalOverrides)) {
    config.provisionalCoordinates = config.provisionalCoordinates.map((p) => p.targetId === tid
      ? {
        ...p,
        easting: c.easting ?? p.easting,
        northing: c.northing ?? p.northing,
        height: c.height ?? p.height,
        status: 'manual' as const,
      }
      : p);
    changed.push(`provisional.${tid}`);
  }

  // reference overrides: materialize a modified in-memory set (never touches
  // the stored reference sets - a saved config creates a new set explicitly)
  const baseSet = referenceSets.find((r) => r.id === base.referenceSetId);
  if (baseSet && (o.disabledReferencePointIds.length
      || Object.keys(o.referenceSigmaOverrides).length
      || Object.keys(o.referenceCoordinateOverrides).length)) {
    const modified: ReferenceSet = {
      ...JSON.parse(JSON.stringify(baseSet)) as ReferenceSet,
      id: `${baseSet.id}::analysis`,
      points: baseSet.points
        .filter((p) => !o.disabledReferencePointIds.includes(p.pointId))
        .map((p) => {
          let np = { ...p };
          const sig = o.referenceSigmaOverrides[p.pointId];
          if (sig) {
            np = { ...np, ...sig };
            changed.push(`reference.${p.pointId}.constraints`);
          }
          const coord = o.referenceCoordinateOverrides[p.pointId];
          if (coord) {
            np = {
              ...np,
              easting: coord.easting ?? np.easting,
              northing: coord.northing ?? np.northing,
              height: coord.height ?? np.height,
            };
            changed.push(`reference.${p.pointId}.coordinates`);
          }
          return np;
        }),
    };
    if (o.disabledReferencePointIds.length) changed.push(`references.disabled:${o.disabledReferencePointIds.join('/')}`);
    analysisRefSets.set(modified.id, modified);
    config.referenceSetId = modified.id;
  }

  if (o.excludedObservationIds.length) changed.push(`observations.excluded:${o.excludedObservationIds.length}`);
  for (const k of Object.keys(o.observationValueOverrides)) changed.push(`observation.${k}.value`);
  for (const k of Object.keys(o.envOverrides)) changed.push(`env.${k}`);
  return { config, changedFields: changed };
}

/** in-memory reference sets created by Analysis Lab overrides */
export const analysisRefSets = new Map<string, ReferenceSet>();

/** anti-manipulation diagnostics (12.5) */
function diagnosticFlags(
  baseline: AdjustmentRun | undefined,
  trial: AdjustmentRun,
  o: AnalysisOverrides,
  baseConfig: ConfigurationVersion,
): string[] {
  const flags: string[] = [];
  const bq = baseline?.attempts[baseline.finalAttempt]?.quality;
  const tq = trial.attempts[trial.finalAttempt]?.quality;
  if (!tq) return flags;

  // sigma inflation vs template
  const a = o.adjustmentOverrides;
  const inflated: string[] = [];
  const check = (key: keyof typeof a, baseVal: number, label: string) => {
    const v = a[key] as number | undefined;
    if (v !== undefined && baseVal > 0 && v > 1.5 * baseVal) inflated.push(label);
  };
  check('fixedConstraintSigmaM', baseConfig.adjustment.fixedConstraintSigmaM, 'fixed constraint sigma');
  const instInflated = Object.values(o.instrumentOverrides ?? {}).some((ov) => {
    const keys: (keyof typeof ov)[] = ['distanceStdErrMm', 'distancePpm', 'hzAngleStdErrArcSec', 'vzAngleStdErrArcSec'];
    return keys.some((k) => typeof ov[k] === 'number' && (ov[k] as number) > 0
      && isInflatedVsProfile(k as string, ov[k] as number));
  });
  const sigmaInflation = inflated.length > 0 || instInflated
    || Object.values(o.referenceSigmaOverrides).some((s) =>
      (s.sigmaE ?? 0) > 0.005 || (s.sigmaN ?? 0) > 0.005 || (s.sigmaH ?? 0) > 0.005);
  if (sigmaInflation) flags.push('Weights strongly relaxed compared to the template');

  const removedRatio = o.excludedObservationIds.length
    / Math.max(1, (baseline?.attempts[0]?.observations.length ?? 1));
  if (removedRatio > 0.15) flags.push(`Excessive observation reduction (${Math.round(removedRatio * 100)}% excluded manually)`);

  if (o.disabledReferencePointIds.length > 0) {
    flags.push(`Reference(s) disabled: ${o.disabledReferencePointIds.join(', ')} - justification required before saving`);
  }
  if (tq.constrainedComponents < 4 || tq.referencesUsed < 2) {
    flags.push('Network weakly constrained (few references / constrained components)');
  }
  if (tq.chiSquarePassed && bq && !bq.chiSquarePassed && sigmaInflation) {
    flags.push('Statistical test passed, but configuration quality degraded (sigma inflation)');
  }
  if (tq.singleRayTargets.length > 0) {
    flags.push(`Uncontrolled single-ray target(s): ${tq.singleRayTargets.join(', ')}`);
  }
  if (bq && tq.chiSquarePassed && tq.maxEllipseSemiMajorM > 1.5 * Math.max(1e-9, bq.maxEllipseSemiMajorM)) {
    flags.push('Chi-square improved but confidence ellipses strongly degraded');
  }
  if (Object.keys(o.referenceCoordinateOverrides).length > 0) {
    flags.push('Reference coordinates changed - verify validity period compatibility');
  }
  return flags;
}

/** compares an overridden instrument sigma to the fixture profile default */
function isInflatedVsProfile(key: string, value: number): boolean {
  const base = repository.instrumentProfiles()[0];
  const ref = (base as unknown as Record<string, number>)[key];
  return typeof ref === 'number' && ref > 0 && value > 1.5 * ref;
}

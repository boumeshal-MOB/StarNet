import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { applyOverridesToConfig, emptyOverrides, useApp } from '../store/AppStore';
import {
  Badge, Button, Callout, Card, Field, Modal, NumberInput, Select, StatusBadge,
  TableWrap, TextInput, Toggle, cls,
} from '../components/ui';
import { NetworkView } from '../components/NetworkView';
import { Chi2Gauge, ResidualBars, TrendChart } from '../components/charts';
import { fmtDateTime, fmtM, fmtMm, fmtNum } from '../lib/format';
import type { AnalysisOverrides, AnalysisTrial } from '../types/domain';
import { repository } from '../data/repository';
import { diffConfigs } from './ProcessingAdminPage';

export function AnalysisSessionPage() {
  const { sessionId } = useParams();
  const { state, actions } = useApp();
  const nav = useNavigate();
  const session = state.analysisSessions.find((s) => s.id === sessionId);
  const config = state.configVersions.find((c) => c.id === session?.configurationVersionId);

  const [overrides, setOverrides] = useState<AnalysisOverrides>(emptyOverrides());
  const [undoStack, setUndoStack] = useState<AnalysisOverrides[]>([]);
  const [selectedTrialId, setSelectedTrialId] = useState<string | null>(null);
  const [trialLabel, setTrialLabel] = useState('');
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [candidateModal, setCandidateModal] = useState<string | null>(null);
  const [justification, setJustification] = useState('');
  const [saveModal, setSaveModal] = useState<AnalysisTrial | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<string | null>(null);

  const baseline = session?.trials.find((t) => t.trialNumber === 0);
  const viewedTrial = session?.trials.find((t) => t.id === selectedTrialId)
    ?? session?.trials[session.trials.length - 1];

  const push = (next: AnalysisOverrides) => {
    setUndoStack((st) => [...st, JSON.parse(JSON.stringify(overrides))]);
    setOverrides(next);
  };
  const patch = (p: Partial<AnalysisOverrides>) => push({ ...overrides, ...p });

  const snapshotObs = useMemo(() => {
    if (!session) return [];
    const ids = new Set(session.snapshotObservationIds);
    return repository.observations().filter((o) => ids.has(o.id));
  }, [session]);

  if (!session || !config) return <Callout tone="error">Analysis session not found.</Callout>;
  const readOnly = session.readOnly;
  const run = viewedTrial?.run;
  const attempt = run?.attempts[run.finalAttempt];
  const q = attempt?.quality;
  const refSet = state.referenceSets.find((r) => r.id === config.referenceSetId);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-bold">
            Analysis session — {fmtDateTime(session.outputSlot)}
            <span className="ml-2"><Badge tone={session.status}>{session.status}</Badge></span>
            {readOnly && <span className="ml-1"><Badge>read-only</Badge></span>}
          </h1>
          <p className="text-xs text-slate-500">
            Baseline: {config.label} · snapshot of {session.snapshotObservationIds.length} observations
            (immutable) · created {fmtDateTime(session.createdAt)} by {session.createdBy}
          </p>
        </div>
        <div className="flex gap-2">
          {session.status === 'open' && (
            <>
              <Button onClick={() => actions.setSessionStatus(session.id, 'completed')}>Complete session</Button>
              <Button variant="danger" onClick={() => actions.setSessionStatus(session.id, 'abandoned')}>Abandon</Button>
            </>
          )}
          <Button onClick={() => nav('/analysis')}>← Analysis Lab</Button>
        </div>
      </div>

      {/* ------------------------------------------------ trial toolbar --- */}
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <TextInput placeholder="trial label..." value={trialLabel}
            onChange={(e) => setTrialLabel(e.target.value)} className="!w-48" />
          <Button variant="primary" disabled={readOnly}
            onClick={async () => {
              const t = await actions.runTrial(session.id, overrides, trialLabel || `Trial ${session.trials.length}`);
              if (t) { setSelectedTrialId(t.id); setTrialLabel(''); }
            }}>
            ▶ Run trial
          </Button>
          <Button disabled={readOnly} onClick={() => push(emptyOverrides())}>Reset to baseline</Button>
          <Button disabled={readOnly || undoStack.length === 0} onClick={() => {
            const prev = undoStack[undoStack.length - 1];
            setUndoStack((st) => st.slice(0, -1));
            setOverrides(prev);
          }}>Undo last change</Button>
          <Button disabled={readOnly || !viewedTrial} onClick={() => {
            if (viewedTrial) push(JSON.parse(JSON.stringify(viewedTrial.overrides)));
          }}>Duplicate trial (load its changes)</Button>
          <span className="ml-auto text-2xs text-slate-400">
            {countChanges(overrides)} pending change(s) vs baseline
          </span>
        </div>
      </Card>

      {/* --------------------------------------------------- 3-zone UI --- */}
      <div className="grid grid-cols-12 gap-4">
        {/* left: parameters & rules */}
        <div className="col-span-3 space-y-3">
          <ParamPanel config={config} overrides={overrides} patch={patch}
            readOnly={readOnly} refSetPoints={refSet?.points ?? []} snapshotObs={snapshotObs} />
        </div>

        {/* center: network & confidence */}
        <div className="col-span-6">
          <Card title={`Network & confidence — ${viewedTrial?.label ?? 'baseline'}`}>
            {attempt && (
              <NetworkView height={430} selected={selectedPoint} onSelect={setSelectedPoint}
                points={[
                  ...config.stations.map((s) => ({
                    id: s.id, e: s.approxE, n: s.approxN, role: 'station' as const,
                    status: overrides.excludedStationIds.includes(s.id) ? 'disabled' as const : 'ok' as const,
                    tooltip: [`station ${s.id}`],
                  })),
                  ...(refSet?.points ?? []).map((p) => ({
                    id: p.pointId, e: p.easting, n: p.northing, role: 'reference' as const,
                    status: overrides.disabledReferencePointIds.includes(p.pointId) ? 'disabled' as const : 'ok' as const,
                    tooltip: [`E ${fmtM(p.easting)} N ${fmtM(p.northing)} H ${fmtM(p.height)}`,
                      `modes ${p.modeE}/${p.modeN}/${p.modeH}`],
                  })),
                  ...attempt.coordinates
                    .filter((c) => !config.stations.some((s) => s.id === c.targetId)
                      && !(refSet?.points ?? []).some((p) => p.pointId === c.targetId))
                    .map((c) => ({
                      id: c.targetId, e: c.easting, n: c.northing, role: 'monitoring' as const,
                      status: overrides.excludedTargetIds.includes(c.targetId) ? 'disabled' as const
                        : !c.redundant ? 'warning' as const : 'ok' as const,
                      ellipse: { semiMajorM: c.ellipseSemiMajorM, semiMinorM: c.ellipseSemiMinorM, orientationDeg: c.ellipseOrientationDeg },
                      displacement: c.dE !== undefined && c.dN !== undefined ? { dE: c.dE, dN: c.dN } : undefined,
                      tooltip: [
                        `E ${fmtM(c.easting)} N ${fmtM(c.northing)} H ${fmtM(c.height)}`,
                        `σ ${fmtMm(c.sigmaE)}/${fmtMm(c.sigmaN)}/${fmtMm(c.sigmaH)} mm`,
                        `ellipse ${fmtMm(c.ellipseSemiMajorM, 1)}×${fmtMm(c.ellipseSemiMinorM, 1)} mm`,
                        `d ${fmtMm(c.dE)}/${fmtMm(c.dN)}/${fmtMm(c.dH)} mm`,
                      ],
                    })),
                ]}
                rays={(attempt.observations ?? []).reduce((acc, o) => {
                  const key = `${o.stationId}|${o.targetId}`;
                  if (acc.some((r) => `${r.from}|${r.to}` === key)) return acc;
                  acc.push({
                    from: o.stationId, to: o.targetId,
                    flag: !o.used ? 'excluded'
                      : (o.stdResidual ?? 0) > config.adjustment.stdResThreshold ? 'suspect' : 'normal',
                  });
                  return acc;
                }, [] as { from: string; to: string; flag: 'normal' | 'suspect' | 'excluded' }[])} />
            )}
          </Card>
        </div>

        {/* right: quality diagnostics */}
        <div className="col-span-3 space-y-3">
          <Card title="Quality diagnostics">
            {q ? (
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span>Chi² test</span>
                  <Badge tone={q.chiSquarePassed ? 'PASS' : 'FAIL'}>{q.chiSquarePassed ? 'PASS' : 'FAIL'}</Badge>
                </div>
                <Chi2Gauge value={q.chiSquareValue} lower={q.chiSquareLower} upper={q.chiSquareUpper} height={58} />
                <Row k="Total error factor" v={fmtNum(q.totalErrorFactor)} />
                <Row k="Degrees of freedom" v={String(q.degreesOfFreedom)} />
                <Row k="Rank" v={`${q.rank}/${q.nUnknowns}${q.rankDeficiency ? ` (−${q.rankDeficiency})` : ''}`} />
                <Row k="Convergence" v={`${q.converged ? 'yes' : 'NO'} (${q.iterations} it.)`} />
                <Row k="Obs Hz/Vz/Sd" v={`${cnt(attempt, 'hz')}/${cnt(attempt, 'vz')}/${cnt(attempt, 'sd')}`} />
                <Row k="EF hz / vz / sd" v={`${fmtNum(q.errorFactorByType.hz, 2)} / ${fmtNum(q.errorFactorByType.vz, 2)} / ${fmtNum(q.errorFactorByType.sd, 2)}`} />
                <Row k="Max std residual" v={`${fmtNum(q.maxStdResidual)} (${q.maxStdResidualObs?.split(':').slice(0, 1) ?? '-'})`} />
                <Row k="References / constrained" v={`${q.referencesUsed} / ${q.constrainedComponents}`} />
                <Row k="Single-ray targets" v={q.singleRayTargets.join(', ') || 'none'} />
                <Row k="Ellipse max / mean" v={`${fmtMm(q.maxEllipseSemiMajorM, 1)} / ${fmtMm(q.meanEllipseSemiMajorM, 1)} mm`} />
                <Row k="Rejected observations" v={String(attempt!.observations.filter((o) => !o.used).length)} />
                <div className="pt-1">
                  <div className="mb-1 text-2xs font-semibold text-slate-500">Largest standardized residuals</div>
                  <ResidualBars height={90}
                    values={attempt!.observations.filter((o) => o.used && o.stdResidual !== undefined).map((o) => o.stdResidual!)}
                    threshold={config.adjustment.stdResThreshold}
                    labels={attempt!.observations.filter((o) => o.used && o.stdResidual !== undefined).map((o) => o.observationId)} />
                </div>
                {viewedTrial && viewedTrial.diagnosticFlags.length > 0 && (
                  <div className="space-y-1 pt-1">
                    {viewedTrial.diagnosticFlags.map((f, i) => <Callout key={i} tone="warning">{f}</Callout>)}
                  </div>
                )}
                {q.warnings.map((w, i) => <Callout key={i} tone="warning">{w}</Callout>)}
              </div>
            ) : <p className="text-xs text-slate-400">Run a trial to see diagnostics.</p>}
          </Card>
          <Card title="Chi² / error factor across trials">
            <TrendChart height={120} series={[
              {
                label: 'error factor', color: '#1d5fec',
                points: session.trials.filter((t) => t.run).map((t) => ({
                  x: `T${t.trialNumber}`,
                  y: t.run!.attempts[t.run!.finalAttempt].quality.totalErrorFactor,
                })),
              },
              {
                label: 'max stdres', color: '#e11d48',
                points: session.trials.filter((t) => t.run).map((t) => ({
                  x: `T${t.trialNumber}`,
                  y: t.run!.attempts[t.run!.finalAttempt].quality.maxStdResidual,
                })),
              },
            ]} />
          </Card>
        </div>
      </div>

      {/* -------------------------------------------------- trial table --- */}
      <Card title={`Trials (${session.trials.length})`}>
        <TableWrap maxH="max-h-72">
          <thead>
            <tr><th>View</th><th>Cmp</th><th>Trial</th><th>Status</th><th>Chi²</th><th>Error factor</th>
              <th>Max StdRes</th><th>Max ellipse (mm)</th><th>Obs removed</th><th>Rank</th>
              <th>Changes</th><th>Flags</th><th>Candidate</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {session.trials.map((t) => {
              const tq = t.run?.attempts[t.run.finalAttempt]?.quality;
              const removed = t.run ? t.run.attempts[t.run.finalAttempt].observations.filter((o) => !o.used).length : 0;
              return (
                <tr key={t.id} className={cls(viewedTrial?.id === t.id && 'bg-brand-50/50')}>
                  <td><input type="radio" checked={viewedTrial?.id === t.id} onChange={() => setSelectedTrialId(t.id)} /></td>
                  <td><input type="checkbox" checked={compareIds.includes(t.id)}
                    onChange={(e) => setCompareIds(e.target.checked
                      ? [...compareIds, t.id] : compareIds.filter((x) => x !== t.id))} /></td>
                  <td className="font-medium">{t.label}</td>
                  <td>{t.run ? <StatusBadge status={t.run.status} /> : '-'}</td>
                  <td>{tq ? <Badge tone={tq.chiSquarePassed ? 'PASS' : 'FAIL'}>{fmtNum(tq.chiSquareValue, 1)}</Badge> : '-'}</td>
                  <td>{fmtNum(tq?.totalErrorFactor)}</td>
                  <td>{fmtNum(tq?.maxStdResidual)}</td>
                  <td>{fmtMm(tq?.maxEllipseSemiMajorM, 1)}</td>
                  <td>{removed}</td>
                  <td>{tq ? `${tq.rank}/${tq.nUnknowns}` : '-'}</td>
                  <td className="max-w-xs whitespace-normal text-2xs">{t.changedFields.join(', ') || 'baseline'}</td>
                  <td>{t.diagnosticFlags.length > 0
                    ? <span title={t.diagnosticFlags.join('\n')} className="text-amber-600">⚠ {t.diagnosticFlags.length}</span> : ''}</td>
                  <td>{t.isCandidate && <Badge tone="Success">candidate</Badge>}</td>
                  <td>
                    <div className="flex gap-1">
                      {t.trialNumber > 0 && !readOnly && (
                        <Button size="xs" onClick={() => { setCandidateModal(t.id); setJustification(t.justification ?? ''); }}>
                          {t.isCandidate ? 'Edit justification' : 'Mark as candidate'}
                        </Button>
                      )}
                      {t.isCandidate && !readOnly && (
                        <Button size="xs" variant="primary" onClick={() => setSaveModal(t)}>Save as new configuration</Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
        {compareIds.length >= 2 && <TrialCompare session={session} ids={compareIds} baselineId={baseline?.id} />}
      </Card>

      {/* candidate justification modal */}
      <Modal open={candidateModal !== null} onClose={() => setCandidateModal(null)}
        title="Mark trial as candidate"
        footer={
          <>
            <Button onClick={() => setCandidateModal(null)}>Cancel</Button>
            <Button variant="primary" disabled={!justification.trim()} onClick={() => {
              if (candidateModal) actions.markCandidate(session.id, candidateModal, justification);
              setCandidateModal(null);
            }}>Confirm</Button>
          </>
        }>
        <Field label="Technical justification (required)"
          hint="Explain why this configuration is technically sound - not just why the test passes.">
          <TextInput value={justification} onChange={(e) => setJustification(e.target.value)}
            placeholder="e.g. excluded Hz ATS34→MP04: prism partially masked by scaffolding since 09/07" />
        </Field>
      </Modal>

      {saveModal && (
        <SaveConfigModal trial={saveModal} sessionId={session.id} configId={config.id}
          onClose={() => setSaveModal(null)} />
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-slate-500">{k}</span>
      <span className="text-right font-medium">{v}</span>
    </div>
  );
}

function cnt(attempt: { observations: { kind: string; used: boolean }[] } | undefined, kind: string): number {
  return attempt?.observations.filter((o) => o.kind === kind && o.used).length ?? 0;
}

function countChanges(o: AnalysisOverrides): number {
  return o.disabledReferencePointIds.length + Object.keys(o.referenceSigmaOverrides).length
    + Object.keys(o.referenceCoordinateOverrides).length + Object.keys(o.provisionalOverrides).length
    + o.excludedStationIds.length + o.excludedTargetIds.length + o.excludedObservationIds.length
    + Object.keys(o.prismConstantOverrides).length + Object.keys(o.stationHeightOverrides).length
    + Object.keys(o.targetHeightOverrides).length + Object.keys(o.distanceStateOverrides).length
    + Object.keys(o.observationValueOverrides).length + Object.keys(o.adjustmentOverrides).length
    + Object.keys(o.envOverrides).length + Object.keys(o.instrumentOverrides ?? {}).length;
}

// ----------------------------------------------------- left param panel ---
import type { ConfigurationVersion, RawObservation, ReferencePoint } from '../types/domain';

function ParamPanel({ config, overrides, patch, readOnly, refSetPoints, snapshotObs }: {
  config: ConfigurationVersion;
  overrides: AnalysisOverrides;
  patch: (p: Partial<AnalysisOverrides>) => void;
  readOnly: boolean;
  refSetPoints: ReferencePoint[];
  snapshotObs: RawObservation[];
}) {
  const [section, setSection] = useState('references');
  const a = config.adjustment;
  const instProfiles = repository.instrumentProfiles()
    .filter((p) => config.stations.some((s) => s.instrumentProfileId === p.id));

  const adjNum = (key: keyof typeof a, label: string, unit?: string, step?: number) => {
    const baseVal = a[key] as number;
    const cur = (overrides.adjustmentOverrides[key] as number | undefined) ?? baseVal;
    return (
      <Field key={String(key)} label={label} unit={unit}
        hint={cur !== baseVal ? `baseline: ${baseVal} → tested: ${cur}` : `baseline: ${baseVal} (template)`}>
        <NumberInput value={cur} step={step} disabled={readOnly}
          onChange={(v) => patch({
            adjustmentOverrides: v === baseVal
              ? Object.fromEntries(Object.entries(overrides.adjustmentOverrides).filter(([k]) => k !== key))
              : { ...overrides.adjustmentOverrides, [key]: v },
          })} />
      </Field>
    );
  };

  return (
    <Card title="Parameters & rules (sandbox)">
      <Select value={section} onChange={setSection} options={[
        { value: 'references', label: 'References & constraints' },
        { value: 'observations', label: 'Observations' },
        { value: 'stations', label: 'Stations & environment' },
        { value: 'weights', label: 'Weights & instrument sigmas' },
        { value: 'adjustment', label: 'Adjustment & auto-correction' },
      ]} />
      <div className="mt-3 max-h-[26rem] space-y-3 overflow-y-auto pr-1">
        {section === 'references' && refSetPoints.map((p) => {
          const disabled = overrides.disabledReferencePointIds.includes(p.pointId);
          const sig = overrides.referenceSigmaOverrides[p.pointId] ?? {};
          return (
            <div key={p.pointId} className={cls('rounded-md p-2 ring-1 ring-slate-200', disabled && 'opacity-50 bg-slate-50')}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">{p.pointId}</span>
                <Toggle checked={!disabled} disabled={readOnly}
                  onChange={(v) => patch({
                    disabledReferencePointIds: v
                      ? overrides.disabledReferencePointIds.filter((x) => x !== p.pointId)
                      : [...overrides.disabledReferencePointIds, p.pointId],
                  })}
                  label={disabled ? 'disabled' : 'active'} />
              </div>
              {!disabled && (
                <div className="mt-1 grid grid-cols-3 gap-1">
                  {(['E', 'N', 'H'] as const).map((c) => {
                    const modeKey = `mode${c}` as const;
                    const sigKey = `sigma${c}` as const;
                    const baseMode = p[modeKey];
                    const curMode = sig[modeKey] ?? baseMode;
                    const baseSig = p[sigKey];
                    const curSig = sig[sigKey] ?? baseSig;
                    return (
                      <div key={c} className="space-y-0.5">
                        <select className="input !px-1 !py-0.5 !text-2xs" value={curMode} disabled={readOnly}
                          onChange={(e) => patch({
                            referenceSigmaOverrides: {
                              ...overrides.referenceSigmaOverrides,
                              [p.pointId]: { ...sig, [modeKey]: e.target.value as ReferencePoint['modeE'] },
                            },
                          })}>
                          <option value="fixed">{c}: fixed</option>
                          <option value="weak">{c}: weak</option>
                          <option value="free">{c}: free</option>
                        </select>
                        {curMode === 'weak' && (
                          <input type="number" step="0.0001" className="input !px-1 !py-0.5 !text-2xs"
                            value={curSig ?? 0.001} disabled={readOnly}
                            title={`baseline σ${c}: ${baseSig ?? '-'} m`}
                            onChange={(e) => patch({
                              referenceSigmaOverrides: {
                                ...overrides.referenceSigmaOverrides,
                                [p.pointId]: { ...sig, [sigKey]: Number(e.target.value) },
                              },
                            })} />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {section === 'observations' && (
          <div className="space-y-1">
            <p className="text-2xs text-slate-400">
              Exclude, protect or modify a raw observation (all three scalar Hz/Vz/Sd components follow).
              Value edits simulate a bad measurement (scenario B).
            </p>
            {snapshotObs.map((o) => {
              const excluded = overrides.excludedObservationIds.includes(o.id);
              const isProtected = overrides.protectedObservationIds.includes(o.id);
              const valueOv = overrides.observationValueOverrides[o.id];
              return (
                <div key={o.id} className={cls('rounded-md p-1.5 ring-1 ring-slate-200 text-2xs', excluded && 'opacity-50 bg-slate-50')}>
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-medium">{o.stationId} → {o.rawTargetName}</span>
                    <div className="flex items-center gap-2">
                      <button disabled={readOnly} title={isProtected ? 'protected (auto-correction cannot remove it)' : 'click to protect'}
                        className={cls('text-sm', isProtected ? '' : 'grayscale opacity-40')}
                        onClick={() => patch({
                          protectedObservationIds: isProtected
                            ? overrides.protectedObservationIds.filter((x) => x !== o.id)
                            : [...overrides.protectedObservationIds, o.id],
                        })}>🔒</button>
                      <Toggle checked={!excluded} disabled={readOnly}
                        onChange={(v) => patch({
                          excludedObservationIds: v
                            ? overrides.excludedObservationIds.filter((x) => x !== o.id)
                            : [...overrides.excludedObservationIds, o.id],
                        })} />
                    </div>
                  </div>
                  <div className="mt-1 grid grid-cols-3 gap-1">
                    <label>Hz° <input type="number" step="0.0001" className="input !px-1 !py-0.5 !text-2xs"
                      value={valueOv?.hzDeg ?? o.hzDeg} disabled={readOnly}
                      onChange={(e) => patch({
                        observationValueOverrides: {
                          ...overrides.observationValueOverrides,
                          [o.id]: { ...valueOv, hzDeg: Number(e.target.value) },
                        },
                      })} /></label>
                    <label>Vz° <input type="number" step="0.0001" className="input !px-1 !py-0.5 !text-2xs"
                      value={valueOv?.vzDeg ?? o.vzDeg} disabled={readOnly}
                      onChange={(e) => patch({
                        observationValueOverrides: {
                          ...overrides.observationValueOverrides,
                          [o.id]: { ...valueOv, vzDeg: Number(e.target.value) },
                        },
                      })} /></label>
                    <label>Sd m <input type="number" step="0.0001" className="input !px-1 !py-0.5 !text-2xs"
                      value={valueOv?.sdM ?? o.sdM} disabled={readOnly}
                      onChange={(e) => patch({
                        observationValueOverrides: {
                          ...overrides.observationValueOverrides,
                          [o.id]: { ...valueOv, sdM: Number(e.target.value) },
                        },
                      })} /></label>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {section === 'stations' && config.stations.map((s) => {
          const excluded = overrides.excludedStationIds.includes(s.id);
          const envOv = overrides.envOverrides[s.id] ?? {};
          return (
            <div key={s.id} className={cls('space-y-1 rounded-md p-2 ring-1 ring-slate-200', excluded && 'opacity-50')}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">{s.id}</span>
                <Toggle checked={!excluded} disabled={readOnly}
                  onChange={(v) => patch({
                    excludedStationIds: v
                      ? overrides.excludedStationIds.filter((x) => x !== s.id)
                      : [...overrides.excludedStationIds, s.id],
                  })} label={excluded ? 'excluded' : 'included'} />
              </div>
              <Field label="Instrument height" unit="m" hint={`baseline: ${s.instrumentHeightM}`}>
                <NumberInput value={overrides.stationHeightOverrides[s.id] ?? s.instrumentHeightM}
                  step={0.001} disabled={readOnly}
                  onChange={(v) => patch({ stationHeightOverrides: { ...overrides.stationHeightOverrides, [s.id]: v } })} />
              </Field>
              <Field label="Distance state" hint={`baseline: ${s.distanceState}`}>
                <Select disabled={readOnly}
                  value={overrides.distanceStateOverrides[s.id] ?? s.distanceState}
                  onChange={(v) => patch({ distanceStateOverrides: { ...overrides.distanceStateOverrides, [s.id]: v as typeof s.distanceState } })}
                  options={[
                    { value: 'raw', label: 'Raw' }, { value: 'prism-corrected', label: 'Prism corrected' },
                    { value: 'atmo-corrected', label: 'Atmo corrected' }, { value: 'fully-corrected', label: 'Fully corrected' },
                    { value: 'unknown', label: 'Unknown' }]} />
              </Field>
              <div className="grid grid-cols-2 gap-1">
                <Field label="T override" unit="degC">
                  <NumberInput value={envOv.temperatureC ?? ('' as unknown as number)} disabled={readOnly}
                    onChange={(v) => patch({ envOverrides: { ...overrides.envOverrides, [s.id]: { ...envOv, temperatureC: v } } })} />
                </Field>
                <Field label="P override" unit="hPa">
                  <NumberInput value={envOv.pressureHPa ?? ('' as unknown as number)} disabled={readOnly}
                    onChange={(v) => patch({ envOverrides: { ...overrides.envOverrides, [s.id]: { ...envOv, pressureHPa: v } } })} />
                </Field>
              </div>
            </div>
          );
        })}

        {section === 'weights' && (
          <div className="space-y-3">
            {instProfiles.map((p) => {
              const ov = overrides.instrumentOverrides?.[p.id] ?? {};
              const num = (key: 'distanceStdErrMm' | 'distancePpm' | 'hzAngleStdErrArcSec' | 'vzAngleStdErrArcSec' | 'instrumentCenteringErrMm' | 'targetCenteringErrMm', label: string, unit: string) => (
                <Field key={key} label={label} unit={unit} hint={`baseline: ${p[key]}`}>
                  <NumberInput value={(ov[key] as number | undefined) ?? p[key]} step={0.1} disabled={readOnly}
                    onChange={(v) => patch({
                      instrumentOverrides: {
                        ...overrides.instrumentOverrides,
                        [p.id]: { ...ov, [key]: v },
                      },
                    })} />
                </Field>
              );
              return (
                <div key={p.id} className="space-y-1 rounded-md p-2 ring-1 ring-slate-200">
                  <div className="text-xs font-semibold">{p.manufacturer} {p.model}</div>
                  {num('distanceStdErrMm', 'Distance std error', 'mm')}
                  {num('distancePpm', 'Distance PPM', 'ppm')}
                  {num('hzAngleStdErrArcSec', 'Hz angle std error', '″')}
                  {num('vzAngleStdErrArcSec', 'Vz angle std error', '″')}
                  {num('instrumentCenteringErrMm', 'Instrument centering', 'mm')}
                  {num('targetCenteringErrMm', 'Target centering', 'mm')}
                </div>
              );
            })}
            {adjNum('fixedConstraintSigmaM', 'Fixed constraint sigma', 'm', 0.0001)}
            <Callout tone="info">
              Raising standard errors only to pass the Chi² is flagged automatically:
              "Statistical test passed, but configuration quality degraded".
            </Callout>
          </div>
        )}

        {section === 'adjustment' && (
          <div className="space-y-2">
            {adjNum('convergenceThresholdM', 'Convergence threshold', 'm', 0.00001)}
            {adjNum('maxIterations', 'Max iterations')}
            {adjNum('chiSquareSignificance', 'Chi² significance', undefined, 0.01)}
            {adjNum('confidenceLevel', 'Confidence level', undefined, 0.01)}
            {adjNum('stdResThreshold', 'Std residual threshold', undefined, 0.1)}
            {adjNum('removalsPerIteration', 'Outliers removed per attempt')}
            {adjNum('maxAutoCorrectionAttempts', 'Max auto-correction attempts')}
            {adjNum('maxRemovedObservations', 'Max removed observations')}
            {adjNum('refractionCoefficient', 'Refraction coefficient', undefined, 0.01)}
            <Field label="Auto-correction"
              hint={`baseline: ${a.autoCorrectionEnabled ? 'enabled' : 'disabled'}`}>
              <Toggle disabled={readOnly}
                checked={overrides.adjustmentOverrides.autoCorrectionEnabled ?? a.autoCorrectionEnabled}
                onChange={(v) => patch({ adjustmentOverrides: { ...overrides.adjustmentOverrides, autoCorrectionEnabled: v } })} />
            </Field>
          </div>
        )}
      </div>
    </Card>
  );
}

// -------------------------------------------------------- trial compare ---
function TrialCompare({ session, ids, baselineId }: {
  session: { trials: AnalysisTrial[] }; ids: string[]; baselineId?: string;
}) {
  const trials = session.trials.filter((t) => ids.includes(t.id) || t.id === baselineId);
  const metric = (t: AnalysisTrial, f: (q: NonNullable<AnalysisTrial['run']>['attempts'][number]['quality']) => string) => {
    const q = t.run?.attempts[t.run.finalAttempt]?.quality;
    return q ? f(q) : '-';
  };
  return (
    <div className="mt-3">
      <div className="mb-1 text-2xs font-semibold text-slate-500">Comparison (selected trials + baseline)</div>
      <TableWrap maxH="max-h-56">
        <thead>
          <tr><th>Metric</th>{trials.map((t) => <th key={t.id}>{t.label}</th>)}</tr>
        </thead>
        <tbody>
          <tr><td>Chi² (bounds)</td>{trials.map((t) => (
            <td key={t.id}>{metric(t, (q) => `${fmtNum(q.chiSquareValue, 1)} [${fmtNum(q.chiSquareLower, 1)},${fmtNum(q.chiSquareUpper, 1)}] ${q.chiSquarePassed ? '✓' : '✗'}`)}</td>))}</tr>
          <tr><td>Error factor</td>{trials.map((t) => <td key={t.id}>{metric(t, (q) => fmtNum(q.totalErrorFactor))}</td>)}</tr>
          <tr><td>Max std residual</td>{trials.map((t) => <td key={t.id}>{metric(t, (q) => fmtNum(q.maxStdResidual))}</td>)}</tr>
          <tr><td>Max ellipse (mm)</td>{trials.map((t) => <td key={t.id}>{metric(t, (q) => fmtMm(q.maxEllipseSemiMajorM, 1))}</td>)}</tr>
          <tr><td>DOF / rank</td>{trials.map((t) => <td key={t.id}>{metric(t, (q) => `${q.degreesOfFreedom} / ${q.rank}`)}</td>)}</tr>
          <tr><td>Removed obs</td>{trials.map((t) => (
            <td key={t.id}>{t.run ? t.run.attempts[t.run.finalAttempt].observations.filter((o) => !o.used).length : '-'}</td>))}</tr>
          <tr><td>Changes</td>{trials.map((t) => <td key={t.id} className="max-w-[12rem] whitespace-normal text-2xs">{t.changedFields.join(', ') || '-'}</td>)}</tr>
          <tr><td>Quality flags</td>{trials.map((t) => <td key={t.id} className="max-w-[12rem] whitespace-normal text-2xs text-amber-700">{t.diagnosticFlags.join('; ') || '-'}</td>)}</tr>
        </tbody>
      </TableWrap>
    </div>
  );
}

// ------------------------------------------------------- save as config ---
function SaveConfigModal({ trial, sessionId, configId, onClose }: {
  trial: AnalysisTrial; sessionId: string; configId: string; onClose: () => void;
}) {
  const { state, actions } = useApp();
  const nav = useNavigate();
  const base = state.configVersions.find((c) => c.id === configId)!;
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [reason, setReason] = useState(trial.justification ?? '');
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 16));
  const [validTo, setValidTo] = useState('');
  const [activation, setActivation] = useState<'draft' | 'activate' | 'schedule'>('draft');
  const [application, setApplication] = useState<'future' | 'reprocess'>('future');

  const diff = useMemo(() => {
    const applied = applyOverridesToConfig(base, trial.overrides, state.referenceSets);
    return diffConfigs(base, applied.config);
  }, [base, trial, state.referenceSets]);

  return (
    <Modal open onClose={onClose} title={`Save ${trial.label} as new configuration version`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!label.trim() || !reason.trim()} onClick={() => {
            const created = actions.saveTrialAsConfig(sessionId, trial.id, {
              label,
              description: description || `Created from Analysis Lab (${trial.label})`,
              technicalReason: reason,
              validFrom: new Date(validFrom + (validFrom.endsWith('Z') ? '' : ':00Z')).toISOString(),
              validTo: validTo ? new Date(validTo + ':00Z').toISOString() : undefined,
              activate: activation === 'activate',
            });
            onClose();
            if (created) nav(`/processings/${created.processingId}`);
          }}>Create version</Button>
        </>
      }>
      <div className="space-y-3">
        <Callout tone="info">
          The source configuration, the baseline and all trials stay immutable. The new version is
          linked to this analysis session and to {trial.label}.
        </Callout>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><TextInput value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. V3 - MP04 Hz excluded (masked prism)" /></Field>
          <Field label="Description"><TextInput value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <Field label="Technical reason (required)"><TextInput value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <Field label="Activation">
            <Select value={activation} onChange={(v) => setActivation(v as typeof activation)}
              options={[
                { value: 'draft', label: 'Save as Draft' },
                { value: 'activate', label: 'Activate immediately' },
                { value: 'schedule', label: 'Schedule (validFrom in the future)' },
              ]} />
          </Field>
          <Field label="Valid from"><TextInput type="datetime-local" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} /></Field>
          <Field label="Valid to (optional)"><TextInput type="datetime-local" value={validTo} onChange={(e) => setValidTo(e.target.value)} /></Field>
          <Field label="Application">
            <Select value={application} onChange={(v) => setApplication(v as typeof application)}
              options={[
                { value: 'future', label: 'Future runs only' },
                { value: 'reprocess', label: 'Prepare a reprocessing (open Reprocess after saving)' },
              ]} />
          </Field>
        </div>
        <div>
          <div className="mb-1 text-2xs font-semibold text-slate-500">Full diff vs {base.label}</div>
          {diff.length === 0 ? <Callout tone="warning">No differences - saving would duplicate the baseline.</Callout> : (
            <TableWrap maxH="max-h-48">
              <thead><tr><th>Field</th><th>Baseline</th><th>New version</th></tr></thead>
              <tbody>
                {diff.map((d, i) => <tr key={i}><td className="font-medium">{d.field}</td><td>{d.a}</td><td>{d.b}</td></tr>)}
              </tbody>
            </TableWrap>
          )}
        </div>
      </div>
    </Modal>
  );
}

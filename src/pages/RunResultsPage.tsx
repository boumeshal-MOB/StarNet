import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp } from '../store/AppStore';
import {
  Badge, Button, Callout, Card, KV, Select, StatusBadge, TableWrap, TextInput,
} from '../components/ui';
import { NetworkView } from '../components/NetworkView';
import { Chi2Gauge, Histogram, ResidualBars } from '../components/charts';
import { fmtDateTime, fmtM, fmtMm, fmtNum } from '../lib/format';

const TABS = [
  { id: 'summary', label: 'Summary' },
  { id: 'network', label: 'Network View' },
  { id: 'coords', label: 'Adjusted Coordinates' },
  { id: 'residuals', label: 'Observations & Residuals' },
  { id: 'quality', label: 'Quality Control' },
  { id: 'attempts', label: 'Attempts' },
  { id: 'snapshot', label: 'Input Snapshot' },
];

export function RunResultsPage() {
  const { runId } = useParams();
  const { state } = useApp();
  const [tab, setTab] = useState('summary');

  const run = state.runs.find((r) => r.id === runId);
  if (!run) return <Callout tone="error">Run not found.</Callout>;
  const config = state.configVersions.find((c) => c.id === run.configurationVersionId);
  const processing = state.processings.find((p) => p.id === run.processingId);
  const attempt = run.attempts[run.finalAttempt];
  const q = attempt?.quality;
  const results = state.results.filter((r) => r.runId === run.id);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-bold">
            Run {fmtDateTime(run.outputSlot)}
            <span className="ml-2"><StatusBadge status={run.status} /></span>
            {run.provisional && <span className="ml-1"><Badge tone="Provisional">Provisional</Badge></span>}
          </h1>
          <p className="text-xs text-slate-500">
            <Link to={`/processings/${run.processingId}`} className="text-brand-700 hover:underline">{processing?.name}</Link>
            {' '}· configuration <span className="font-medium">{config?.label}</span> · trigger {run.trigger}
            · engine return code {run.engineReturnCode}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`-mb-px rounded-t-md border-b-2 px-3 py-2 text-xs font-medium ${tab === t.id ? 'border-brand-600 bg-white text-brand-700' : 'border-transparent text-slate-500 hover:bg-slate-50'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'summary' && q && (
        <div className="grid grid-cols-2 gap-4">
          <Card title="Run summary">
            <KV items={[
              ['Output slot', fmtDateTime(run.outputSlot)],
              ['Configuration version', `${config?.label} (${config?.id})`],
              ['Status', <StatusBadge key="s" status={run.status} />],
              ['Provisional', run.provisional ? `yes - ${run.provisionalReasons.join('; ')}` : 'no (final)'],
              ['Convergence', `${q.converged ? 'converged' : 'NOT converged'} in ${q.iterations} iteration(s)`],
              ['Chi-square', `${fmtNum(q.chiSquareValue, 1)} in [${fmtNum(q.chiSquareLower, 1)}, ${fmtNum(q.chiSquareUpper, 1)}] → ${q.chiSquarePassed ? 'PASS' : 'FAIL'}`],
              ['Total error factor', fmtNum(q.totalErrorFactor)],
              ['Adjusted points', String(attempt.coordinates.length)],
              ['Observations rejected', String(attempt.observations.filter((o) => !o.used).length)],
              ['Duration', `${run.durationMs} ms`],
              ['Result versions', results.map((r) => `V${r.version}${r.current ? ' (current)' : ''}`).join(', ') || 'none'],
            ]} />
          </Card>
          <Card title="Source epochs per station">
            <TableWrap maxH="max-h-44">
              <thead><tr><th>Station</th><th>Source epoch</th><th>Age vs slot</th><th>State</th></tr></thead>
              <tbody>
                {run.stationEpochs.map((s) => (
                  <tr key={s.stationId}>
                    <td className="font-medium">{s.stationId}</td>
                    <td>{s.state === 'missing' ? '-' : fmtDateTime(s.epoch)}</td>
                    <td>{Number.isNaN(s.ageMin) ? '-' : `${s.ageMin} min`}</td>
                    <td><Badge tone={s.state}>{s.state}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <div className="mt-3"><Chi2Gauge value={q.chiSquareValue} lower={q.chiSquareLower} upper={q.chiSquareUpper} /></div>
          </Card>
        </div>
      )}

      {tab === 'network' && <NetworkTab run={run} configLabel={config?.label} />}

      {tab === 'coords' && (
        <Card title="Adjusted coordinates">
          <TableWrap>
            <thead>
              <tr>
                <th>Point</th><th>Role</th><th>E (m)</th><th>N (m)</th><th>H (m)</th>
                <th>σE (mm)</th><th>σN (mm)</th><th>σH (mm)</th>
                <th>dE (mm)</th><th>dN (mm)</th><th>dH (mm)</th>
                <th>Ellipse a×b (mm)</th><th>Obs</th><th>Published</th><th>Result version</th>
              </tr>
            </thead>
            <tbody>
              {attempt?.coordinates.map((c) => {
                const t = config?.targets.find((x) => x.adjustmentName === c.targetId);
                const published = t?.publishOutput && results.length > 0;
                return (
                  <tr key={c.targetId}>
                    <td className="font-medium">{c.targetId}</td>
                    <td><Badge>{c.role}</Badge></td>
                    <td>{fmtM(c.easting)}</td><td>{fmtM(c.northing)}</td><td>{fmtM(c.height)}</td>
                    <td className="text-right">{fmtMm(c.sigmaE)}</td>
                    <td className="text-right">{fmtMm(c.sigmaN)}</td>
                    <td className="text-right">{fmtMm(c.sigmaH)}</td>
                    <td className="text-right">{fmtMm(c.dE)}</td>
                    <td className="text-right">{fmtMm(c.dN)}</td>
                    <td className="text-right">{fmtMm(c.dH)}</td>
                    <td className="text-right">{fmtMm(c.ellipseSemiMajorM, 1)} × {fmtMm(c.ellipseSemiMinorM, 1)}</td>
                    <td>{c.nObservations}{!c.redundant && <span title="single ray - uncontrolled" className="text-amber-600"> ⚠</span>}</td>
                    <td>{published ? <Badge tone="Success">yes</Badge> : <Badge>no</Badge>}</td>
                    <td className="text-2xs">{results.map((r) => `V${r.version}`).join(', ') || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        </Card>
      )}

      {tab === 'residuals' && <ResidualsTab run={run} />}

      {tab === 'quality' && q && (
        <div className="grid grid-cols-2 gap-4">
          <Card title="Statistical test">
            <KV items={[
              ['Chi-square value (weighted SSR)', fmtNum(q.chiSquareValue, 2)],
              ['Bounds (two-sided)', `[${fmtNum(q.chiSquareLower, 2)}, ${fmtNum(q.chiSquareUpper, 2)}]`],
              ['Result', <Badge key="b" tone={q.chiSquarePassed ? 'PASS' : 'FAIL'}>{q.chiSquarePassed ? 'PASSED' : 'FAILED'}</Badge>],
              ['Degrees of freedom', String(q.degreesOfFreedom)],
              ['Variance factor', fmtNum(q.varianceFactor)],
              ['Total error factor', fmtNum(q.totalErrorFactor)],
              ['Error factor Hz', fmtNum(q.errorFactorByType.hz)],
              ['Error factor Vz', fmtNum(q.errorFactorByType.vz)],
              ['Error factor Sd', fmtNum(q.errorFactorByType.sd)],
              ['Error factor constraints', fmtNum(q.errorFactorByType.constraint)],
              ['Convergence', `${q.converged} (${q.iterations} it.)`],
              ['Rank', `${q.rank} / ${q.nUnknowns}${q.rankDeficiency ? ` (deficiency ${q.rankDeficiency})` : ''}`],
              ['References used', `${q.referencesUsed} (${q.constrainedComponents} constrained components)`],
            ]} />
            {q.rankExplanation && <Callout tone="error">{q.rankExplanation}</Callout>}
          </Card>
          <Card title="Publication criteria & warnings">
            <KV items={[
              ['Publishable', q.publishable ? 'yes' : 'no'],
              ['Blockers', q.publicationBlockers.join('; ') || 'none'],
              ['Max ellipse', `${fmtMm(q.maxEllipseSemiMajorM, 2)} mm (mean ${fmtMm(q.meanEllipseSemiMajorM, 2)} mm)`],
              ['Max std residual', `${fmtNum(q.maxStdResidual)} (${q.maxStdResidualObs ?? '-'})`],
              ['Single-ray targets', q.singleRayTargets.join(', ') || 'none'],
            ]} />
            <div className="mt-2 space-y-1">
              {q.warnings.map((w, i) => <Callout key={i} tone="warning">{w}</Callout>)}
              {q.warnings.length === 0 && <Callout tone="success">No warnings.</Callout>}
            </div>
          </Card>
        </div>
      )}

      {tab === 'attempts' && (
        <div className="space-y-3">
          {run.attempts.map((a) => (
            <Card key={a.attemptNumber}
              title={`Attempt ${a.attemptNumber}${a.attemptNumber === 0 ? ' (initial run)' : ' (auto-correction)'}${a.attemptNumber === run.finalAttempt ? ' - FINAL' : ''}`}>
              <div className="grid grid-cols-2 gap-4">
                <KV items={[
                  ['Started', fmtDateTime(a.startedAt)],
                  ['Chi-square', `${fmtNum(a.quality.chiSquareValue, 1)} → ${a.quality.chiSquarePassed ? 'PASS' : 'FAIL'}`],
                  ['Error factor', fmtNum(a.quality.totalErrorFactor)],
                  ['Max std residual', fmtNum(a.quality.maxStdResidual)],
                ]} />
                <KV items={[
                  ['Observations used', String(a.observations.filter((o) => o.used).length)],
                  ['Removed at this attempt', a.removedObservationIds.length
                    ? a.removedObservationIds.join(', ') : 'none'],
                  ['Removal reason', a.removalReason ?? '-'],
                ]} />
              </div>
            </Card>
          ))}
        </div>
      )}

      {tab === 'snapshot' && <SnapshotTab runId={run.id} />}
    </div>
  );
}

// ------------------------------------------------------------- network ----
function NetworkTab({ run, configLabel }: { run: NonNullable<ReturnType<typeof useRun>>; configLabel?: string }) {
  const { state } = useApp();
  const [selected, setSelected] = useState<string | null>(null);
  const config = state.configVersions.find((c) => c.id === run.configurationVersionId);
  const attempt = run.attempts[run.finalAttempt];
  const points = useMemo(() => {
    if (!attempt || !config) return [];
    const refSet = state.referenceSets.find((r) => r.id === config.referenceSetId);
    const stdResByTarget = new Map<string, number>();
    for (const o of attempt.observations) {
      if (o.used && o.stdResidual !== undefined) {
        stdResByTarget.set(o.targetId, Math.max(stdResByTarget.get(o.targetId) ?? 0, o.stdResidual));
      }
    }
    return [
      ...config.stations.map((s) => ({
        id: s.id, e: s.approxE, n: s.approxN, role: 'station' as const,
        tooltip: [`instrument ${s.instrumentProfileId}`, `epoch: ${run.stationEpochs.find((x) => x.stationId === s.id)?.state}`],
      })),
      ...(refSet?.points ?? []).map((p) => ({
        id: p.pointId, e: p.easting, n: p.northing, role: 'reference' as const,
        tooltip: [`E ${fmtM(p.easting)} N ${fmtM(p.northing)} H ${fmtM(p.height)}`,
          `constraints E:${p.modeE} N:${p.modeN} H:${p.modeH}`],
      })),
      ...attempt.coordinates.filter((c) => !config.stations.some((s) => s.id === c.targetId)
        && !(refSet?.points ?? []).some((p) => p.pointId === c.targetId)).map((c) => ({
        id: c.targetId, e: c.easting, n: c.northing,
        role: 'monitoring' as const,
        status: (stdResByTarget.get(c.targetId) ?? 0) > (config.adjustment.stdResThreshold)
          ? 'error' as const : !c.redundant ? 'warning' as const : 'ok' as const,
        ellipse: { semiMajorM: c.ellipseSemiMajorM, semiMinorM: c.ellipseSemiMinorM, orientationDeg: c.ellipseOrientationDeg },
        displacement: c.dE !== undefined && c.dN !== undefined ? { dE: c.dE, dN: c.dN } : undefined,
        tooltip: [
          `E ${fmtM(c.easting)}  N ${fmtM(c.northing)}  H ${fmtM(c.height)}`,
          `σ ${fmtMm(c.sigmaE)}/${fmtMm(c.sigmaN)}/${fmtMm(c.sigmaH)} mm`,
          `ellipse ${fmtMm(c.ellipseSemiMajorM, 1)}×${fmtMm(c.ellipseSemiMinorM, 1)} mm @ ${c.ellipseOrientationDeg.toFixed(0)}°`,
          `max stdres ${fmtNum(stdResByTarget.get(c.targetId))}`,
          `config ${configLabel ?? ''}`,
        ],
      })),
    ];
  }, [attempt, config, run, state.referenceSets, configLabel]);

  const rays = useMemo(() => {
    if (!attempt || !config) return [];
    const seen = new Map<string, 'normal' | 'suspect' | 'excluded'>();
    for (const o of attempt.observations) {
      const key = `${o.stationId}|${o.targetId}`;
      const cur = seen.get(key);
      const flag = !o.used ? 'excluded'
        : (o.stdResidual ?? 0) > config.adjustment.stdResThreshold ? 'suspect' : 'normal';
      if (cur === 'suspect') continue;
      if (flag === 'suspect' || !cur || (cur === 'excluded' && flag === 'normal')) seen.set(key, flag);
    }
    return [...seen.entries()].map(([k, flag]) => {
      const [from, to] = k.split('|');
      return { from, to, flag };
    });
  }, [attempt, config]);

  return (
    <Card title="Network view (local E/N)">
      <NetworkView points={points} rays={rays} selected={selected} onSelect={setSelected} height={480} />
    </Card>
  );
}

function useRun() {
  const { runId } = useParams();
  const { state } = useApp();
  return state.runs.find((r) => r.id === runId);
}

// ----------------------------------------------------------- residuals ----
function ResidualsTab({ run }: { run: NonNullable<ReturnType<typeof useRun>> }) {
  const { state } = useApp();
  const config = state.configVersions.find((c) => c.id === run.configurationVersionId);
  const [attemptNo, setAttemptNo] = useState(run.finalAttempt);
  const [station, setStation] = useState('all');
  const [target, setTarget] = useState('all');
  const [kind, setKind] = useState('all');
  const [minStd, setMinStd] = useState('');
  const [usedFilter, setUsedFilter] = useState('all');
  const attempt = run.attempts[attemptNo];
  if (!attempt) return null;

  const rows = attempt.observations.filter((o) =>
    (station === 'all' || o.stationId === station)
    && (target === 'all' || o.targetId === target)
    && (kind === 'all' || o.kind === kind)
    && (usedFilter === 'all' || (usedFilter === 'used' ? o.used : !o.used))
    && (!minStd || (o.stdResidual ?? 0) >= Number(minStd)));

  const stations = [...new Set(attempt.observations.map((o) => o.stationId))];
  const targets = [...new Set(attempt.observations.map((o) => o.targetId))].sort();
  const stdValues = attempt.observations.filter((o) => o.used && o.stdResidual !== undefined)
    .map((o) => o.stdResidual!);

  return (
    <div className="space-y-4">
      <Card title="Residual diagnostics">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="mb-1 text-2xs font-semibold text-slate-500">Sorted standardized residuals</div>
            <ResidualBars values={stdValues} threshold={config?.adjustment.stdResThreshold ?? 3.5}
              labels={attempt.observations.filter((o) => o.used && o.stdResidual !== undefined).map((o) => o.observationId)} />
          </div>
          <div>
            <div className="mb-1 text-2xs font-semibold text-slate-500">Distribution of standardized residuals</div>
            <Histogram values={stdValues} />
          </div>
        </div>
      </Card>
      <Card title={`Observations (${rows.length})`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Select value={String(attemptNo)} onChange={(v) => setAttemptNo(Number(v))}
              options={run.attempts.map((a) => ({ value: String(a.attemptNumber), label: `Attempt ${a.attemptNumber}` }))} />
            <Select value={station} onChange={setStation}
              options={[{ value: 'all', label: 'All stations' }, ...stations.map((s) => ({ value: s, label: s }))]} />
            <Select value={target} onChange={setTarget}
              options={[{ value: 'all', label: 'All targets' }, ...targets.map((t) => ({ value: t, label: t }))]} />
            <Select value={kind} onChange={setKind}
              options={[{ value: 'all', label: 'Hz+Vz+Sd' }, { value: 'hz', label: 'Hz' }, { value: 'vz', label: 'Vz' }, { value: 'sd', label: 'Sd' }]} />
            <Select value={usedFilter} onChange={setUsedFilter}
              options={[{ value: 'all', label: 'Used + excluded' }, { value: 'used', label: 'Used only' }, { value: 'excluded', label: 'Excluded only' }]} />
            <TextInput placeholder="min |stdres|" value={minStd} onChange={(e) => setMinStd(e.target.value)} className="!w-24" />
          </div>
        }>
        <TableWrap>
          <thead>
            <tr>
              <th>Observation</th><th>Station</th><th>Target</th><th>Type</th>
              <th>σ applied</th><th>Residual</th><th>Std residual</th><th>Used</th><th>Excluded at</th><th>Protected</th>
            </tr>
          </thead>
          <tbody>
            {rows.sort((a, b) => (b.stdResidual ?? -1) - (a.stdResidual ?? -1)).map((o) => (
              <tr key={o.observationId} className={!o.used ? 'opacity-50' : (o.stdResidual ?? 0) > (config?.adjustment.stdResThreshold ?? 3.5) ? 'bg-rose-50' : ''}>
                <td className="text-2xs">{o.observationId}</td>
                <td>{o.stationId}</td>
                <td>{o.targetId}</td>
                <td><Badge>{o.kind}</Badge></td>
                <td className="text-right">{o.kind === 'sd' ? `${fmtMm(o.sigma)} mm` : `${(o.sigma * 206264.8).toFixed(2)}″`}</td>
                <td className="text-right">{o.residual === undefined ? '-' : o.kind === 'sd' ? `${fmtMm(o.residual)} mm` : `${(o.residual * 206264.8).toFixed(2)}″`}</td>
                <td className="text-right font-medium">{fmtNum(o.stdResidual, 2)}</td>
                <td>{o.used ? '✓' : '✗'}</td>
                <td>{o.excludedAtAttempt ?? '-'}</td>
                <td>{o.protected ? '🔒' : ''}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------ snapshot ----
function SnapshotTab({ runId }: { runId: string }) {
  const { state } = useApp();
  const run = state.runs.find((r) => r.id === runId)!;
  const artifacts = state.artifacts.filter((a) => a.runId === runId);
  const [artifactId, setArtifactId] = useState(artifacts[0]?.id ?? '');
  const artifact = artifacts.find((a) => a.id === artifactId);

  return (
    <div className="space-y-4">
      <Card title="Correction traces (prism → atmosphere → datum)">
        <TableWrap maxH="max-h-64">
          <thead>
            <tr>
              <th>Observation</th><th>Target</th><th>Stored Sd (m)</th><th>Prism Δ (mm)</th>
              <th>After prism (m)</th><th>T (°C)</th><th>P (hPa)</th><th>PPM</th><th>Scale</th>
              <th>After atmosphere (m)</th><th>Datum</th><th>Final (m)</th><th>Env source</th><th>Formula</th>
            </tr>
          </thead>
          <tbody>
            {run.corrections.map((c) => (
              <tr key={c.observationId}>
                <td className="text-2xs">{c.observationId}</td>
                <td>{c.targetId}</td>
                <td>{fmtM(c.storedDistanceM)}</td>
                <td className="text-right">{fmtMm(c.prismDeltaM, 1)}</td>
                <td>{fmtM(c.distanceAfterPrismM)}</td>
                <td>{c.temperatureC ?? '-'}</td>
                <td>{c.pressureHPa ?? '-'}</td>
                <td className="text-right">{fmtNum(c.atmosphericPpm, 1)}</td>
                <td>{c.atmosphericScale.toFixed(8)}</td>
                <td>{fmtM(c.distanceAfterAtmosphereM)}</td>
                <td>{c.datumScale}</td>
                <td className="font-medium">{fmtM(c.finalDistanceM)}</td>
                <td><Badge>{c.envSource}</Badge></td>
                <td className="text-2xs">{c.formulaVersion}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
      <Card title="Engine artifacts"
        actions={
          <Select value={artifactId} onChange={setArtifactId}
            options={artifacts.map((a) => ({ value: a.id, label: a.label }))} />
        }>
        <pre className="max-h-96 overflow-auto rounded-md bg-slate-900 p-3 text-2xs leading-relaxed text-slate-100">
          {artifact?.content ?? 'No artifact selected.'}
        </pre>
      </Card>
      <Card title="Resolved input snapshot">
        <pre className="max-h-96 overflow-auto rounded-md bg-slate-50 p-3 text-2xs leading-relaxed text-slate-700 ring-1 ring-slate-200">
          {run.inputSnapshot}
        </pre>
      </Card>
    </div>
  );
}

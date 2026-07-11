import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp } from '../store/AppStore';
import {
  Badge, Button, Callout, Card, Field, Select, TableWrap, TextInput, Toggle,
} from '../components/ui';
import { listSlots } from '../store/runExecution';
import { fmtDateTime, fmtMm, fmtNum } from '../lib/format';
import { FIXTURE_START, FIXTURE_END } from '../data/fixture';
import type { AdjustmentRun } from '../types/domain';

export function ReprocessPage() {
  const { id } = useParams();
  const { state, actions } = useApp();
  const [processingId, setProcessingId] = useState(id ?? state.processings[0]?.id ?? '');
  const processing = state.processings.find((p) => p.id === processingId);
  const configs = state.configVersions.filter((c) => c.processingId === processingId)
    .sort((a, b) => a.versionNumber - b.versionNumber);
  const activeCfg = configs.find((c) => c.id === processing?.activeConfigurationVersionId) ?? configs[0];

  const [from, setFrom] = useState(new Date(FIXTURE_END - 3 * 3600000).toISOString().slice(0, 16));
  const [to, setTo] = useState(new Date(FIXTURE_END).toISOString().slice(0, 16));
  const [strategy, setStrategy] = useState<'per-slot' | 'forced'>('per-slot');
  const [forcedConfigId, setForcedConfigId] = useState('');
  const [autoCorrection, setAutoCorrection] = useState(true);
  const [dryRun, setDryRun] = useState(true);
  const [reason, setReason] = useState('');
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<{ slots: number; runs: AdjustmentRun[] } | null>(null);

  const fromIso = useMemo(() => toIso(from), [from]);
  const toIsoV = useMemo(() => toIso(to), [to]);

  const preview = useMemo(() => {
    if (!activeCfg) return null;
    const interval = activeCfg.outputPolicy.outputIntervalMin;
    const slots = listSlots(interval, new Date(fromIso).getTime(), new Date(toIsoV).getTime());
    const perConfig = new Map<string, number>();
    const gaps: string[] = [];
    for (const s of slots) {
      const cfg = strategy === 'forced'
        ? configs.find((c) => c.id === forcedConfigId)
        : actions.configForSlot(processingId, s);
      if (!cfg) { gaps.push(new Date(s).toISOString()); continue; }
      perConfig.set(cfg.label, (perConfig.get(cfg.label) ?? 0) + 1);
    }
    const existing = state.results.filter((r) => r.processingId === processingId
      && r.outputSlot >= fromIso && r.outputSlot <= toIsoV && r.current);
    return { slots: slots.length, perConfig, gaps, existing };
  }, [activeCfg, fromIso, toIsoV, strategy, forcedConfigId, configs, processingId, actions, state.results]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Historical reprocessing</h1>
        <p className="text-xs text-slate-500">
          Recompute a period with the configuration valid for each output slot (or a forced version).
          Existing results are never deleted - each recomputed slot gets a new result version.
        </p>
      </div>

      <Card title="Parameters">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Processing">
            <Select value={processingId} onChange={setProcessingId}
              options={state.processings.map((p) => ({ value: p.id, label: p.name }))} />
          </Field>
          <Field label="From (date/time)">
            <TextInput type="datetime-local" value={from}
              min={new Date(FIXTURE_START).toISOString().slice(0, 16)}
              onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To (date/time)">
            <TextInput type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Configuration strategy">
            <Select value={strategy} onChange={(v) => setStrategy(v as typeof strategy)}
              options={[
                { value: 'per-slot', label: 'Use configuration valid for each output slot' },
                { value: 'forced', label: 'Force one selected configuration' },
              ]} />
          </Field>
          {strategy === 'forced' && (
            <Field label="Forced version">
              <Select value={forcedConfigId} onChange={setForcedConfigId}
                options={[{ value: '', label: 'Select a version...' },
                  ...configs.map((c) => ({ value: c.id, label: c.label }))]} />
            </Field>
          )}
          <Field label="Auto-correction mode">
            <Toggle checked={autoCorrection} onChange={setAutoCorrection}
              label={autoCorrection ? 'Enabled during reprocess' : 'Disabled'} />
          </Field>
          <Field label="Execution mode">
            <Toggle checked={dryRun} onChange={setDryRun}
              label={dryRun ? 'Dry run (nothing is published)' : 'Publish new result versions'} />
          </Field>
          <Field label="Reason / comment">
            <TextInput value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="required to publish" />
          </Field>
        </div>
      </Card>

      {preview && (
        <Card title="Before launching">
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div className="space-y-1">
              <div><span className="text-slate-500">Output slots concerned:</span> <span className="font-semibold">{preview.slots}</span></div>
              <div><span className="text-slate-500">Estimated runs:</span> <span className="font-semibold">{preview.slots}</span></div>
              <div className="text-slate-500">Configuration per sub-period:</div>
              {[...preview.perConfig.entries()].map(([label, n]) => (
                <div key={label} className="ml-2">• {label}: {n} slot(s)</div>
              ))}
              {preview.gaps.length > 0 && (
                <Callout tone="warning">
                  {preview.gaps.length} slot(s) without any valid configuration (gap):{' '}
                  {preview.gaps.slice(0, 4).map((g) => fmtDateTime(g)).join(', ')}{preview.gaps.length > 4 ? '…' : ''}
                </Callout>
              )}
            </div>
            <div>
              <div className="mb-1 text-slate-500">Existing current results that will get a new version:</div>
              {preview.existing.length === 0 ? <span className="text-slate-400">none</span> : (
                <TableWrap maxH="max-h-36">
                  <thead><tr><th>Slot</th><th>Version</th><th>Provisional</th></tr></thead>
                  <tbody>
                    {preview.existing.map((r) => (
                      <tr key={r.id}>
                        <td>{fmtDateTime(r.outputSlot)}</td>
                        <td>V{r.version}</td>
                        <td>{r.provisional ? 'yes' : 'no'}</td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              )}
            </div>
          </div>
          <div className="mt-3">
            <Button variant="primary" disabled={running || (!dryRun && !reason.trim()) || (strategy === 'forced' && !forcedConfigId)}
              onClick={async () => {
                setRunning(true);
                setOutcome(null);
                try {
                  const res = await actions.reprocess(processingId, fromIso, toIsoV, {
                    strategy, forcedConfigId: forcedConfigId || undefined, dryRun,
                    autoCorrection, reason: reason || 'reprocess',
                  });
                  setOutcome(res);
                } finally {
                  setRunning(false);
                }
              }}>
              {running ? 'Reprocessing…' : dryRun ? 'Launch dry run' : 'Launch and publish'}
            </Button>
          </div>
        </Card>
      )}

      {outcome && (
        <Card title={`Result: ${outcome.runs.length}/${outcome.slots} run(s) executed ${dryRun ? '(dry run - not published)' : ''}`}>
          <TableWrap maxH="max-h-80">
            <thead><tr><th>Slot</th><th>Config</th><th>Status</th><th>Chi²</th><th>Error factor</th>
              <th>Max ellipse (mm)</th><th>Old → new (current)</th><th></th></tr></thead>
            <tbody>
              {outcome.runs.map((r) => {
                const q = r.attempts[r.finalAttempt]?.quality;
                const cfg = state.configVersions.find((c) => c.id === r.configurationVersionId);
                const versions = state.results.filter((x) => x.processingId === processingId && x.outputSlot === r.outputSlot);
                const old = versions.filter((v) => v.runId !== r.id).sort((a, b) => b.version - a.version)[0];
                return (
                  <tr key={r.id}>
                    <td className="font-medium">{fmtDateTime(r.outputSlot)}</td>
                    <td>{cfg?.label}</td>
                    <td><Badge tone={r.status}>{r.status}</Badge></td>
                    <td>{q ? <Badge tone={q.chiSquarePassed ? 'PASS' : 'FAIL'}>{fmtNum(q.chiSquareValue, 1)}</Badge> : '-'}</td>
                    <td>{fmtNum(q?.totalErrorFactor)}</td>
                    <td>{fmtMm(q?.maxEllipseSemiMajorM, 1)}</td>
                    <td className="text-2xs">
                      {old ? `V${old.version} → V${old.version + (dryRun ? 0 : 1)}${dryRun ? ' (dry run: unchanged)' : ''}` : dryRun ? 'new (not stored)' : 'V1 created'}
                    </td>
                    <td>{!dryRun && <Link to={`/runs/${r.id}`} className="text-brand-700 hover:underline">open</Link>}</td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
          {!dryRun && (
            <Callout tone="success">
              New result versions were created for every recomputed slot. Old versions are preserved
              and can be promoted back from the processing administration (Runs & Results tab).
            </Callout>
          )}
        </Card>
      )}
    </div>
  );
}

function toIso(local: string): string {
  return new Date(local + (local.endsWith('Z') ? '' : ':00Z')).toISOString();
}

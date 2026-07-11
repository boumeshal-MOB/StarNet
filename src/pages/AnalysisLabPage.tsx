import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../store/AppStore';
import {
  Badge, Button, Callout, Card, Field, KV, Select, TableWrap, TextInput, Toggle,
} from '../components/ui';
import { repository } from '../data/repository';
import { selectCycles } from '../store/runExecution';
import { fmtDateTime } from '../lib/format';
import { BAD_OBS_SLOT, ATS36_SILENT_FROM, ENV_GAP_FROM } from '../data/fixture';

export function AnalysisLabPage() {
  const { state, actions } = useApp();
  const nav = useNavigate();
  const [processingId, setProcessingId] = useState(state.processings[0]?.id ?? '');
  const processing = state.processings.find((p) => p.id === processingId);
  const configs = state.configVersions.filter((c) => c.processingId === processingId);
  const [configId, setConfigId] = useState('');
  const [slot, setSlot] = useState(new Date(BAD_OBS_SLOT).toISOString().slice(0, 16));
  const [autoCorrection, setAutoCorrection] = useState(false);
  const [confidence, setConfidence] = useState('0.95');
  const [comment, setComment] = useState('');

  const slotIso = useMemo(() => {
    try { return new Date(slot + (slot.endsWith('Z') ? '' : ':00Z')).toISOString(); }
    catch { return new Date(BAD_OBS_SLOT).toISOString(); }
  }, [slot]);

  // default to the configuration valid for the analyzed slot (user can override)
  const config = configs.find((c) => c.id === configId)
    ?? configs.find((c) => c.status !== 'draft' && c.status !== 'archived'
      && c.validFrom <= slotIso && (!c.validTo || slotIso < c.validTo))
    ?? configs.find((c) => c.id === processing?.activeConfigurationVersionId)
    ?? configs[0];

  // pre-run situation report
  const situation = useMemo(() => {
    if (!config) return null;
    const cycles = selectCycles(config, new Date(slotIso).getTime(), repository.observations());
    const env = repository.environmental();
    const envByStation = config.stations.map((s) => {
      const t0 = new Date(slotIso).getTime();
      const near = env.filter((e) => e.stationId === s.id
        && Math.abs(new Date(e.epoch).getTime() - t0) <= s.envToleranceMin * 60000);
      return { stationId: s.id, available: near.length > 0 };
    });
    const refSet = state.referenceSets.find((r) => r.id === config.referenceSetId);
    const observedTargets = new Set(cycles.observations.map((o) => o.rawTargetName));
    const notObserved = config.targets.filter((t) => t.includeInAdjustment && !observedTargets.has(t.rawName));
    return { cycles, envByStation, refSet, notObserved };
  }, [config, slotIso, state.referenceSets]);

  const quickSlots = [
    { label: `Corrupted observation (${fmtDateTime(new Date(BAD_OBS_SLOT).toISOString())})`, v: new Date(BAD_OBS_SLOT).toISOString() },
    { label: `ATS36 missing (${fmtDateTime(new Date(ATS36_SILENT_FROM).toISOString())})`, v: new Date(ATS36_SILENT_FROM).toISOString() },
    { label: `Env gap ATS35 (${fmtDateTime(new Date(ENV_GAP_FROM + 30 * 60000).toISOString())})`, v: new Date(ENV_GAP_FROM + 30 * 60000).toISOString() },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Analysis Lab</h1>
        <p className="text-xs text-slate-500">
          Analyze a real epoch in a sandbox: baseline run, trials with temporary parameter changes,
          quality diagnostics, then save a justified configuration version. Nothing here publishes
          results or modifies active configurations.
        </p>
      </div>

      <Card title="12.1 - Select the case to analyze">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Project / Site / Processing">
            <Select value={processingId} onChange={(v) => { setProcessingId(v); setConfigId(''); }}
              options={state.processings.map((p) => ({ value: p.id, label: `${p.site} — ${p.name}` }))} />
          </Field>
          <Field label="Starting configuration version">
            <Select value={config?.id ?? ''} onChange={setConfigId}
              options={configs.map((c) => ({ value: c.id, label: `${c.label} [${c.status}]` }))} />
          </Field>
          <Field label="Output slot / epoch to analyze">
            <TextInput type="datetime-local" value={slot} onChange={(e) => setSlot(e.target.value)} />
          </Field>
          <Field label="Quick pick (demo scenarios)">
            <Select value="" onChange={(v) => v && setSlot(v.slice(0, 16))}
              options={[{ value: '', label: 'Select an interesting epoch...' },
                ...quickSlots.map((q) => ({ value: q.v, label: q.label }))]} />
          </Field>
          <Field label="Auto-correction mode">
            <Toggle checked={autoCorrection} onChange={setAutoCorrection}
              label={autoCorrection ? 'Baseline with auto-correction' : 'Normal mode (no auto-correction)'} />
          </Field>
          <Field label="Ellipse confidence level">
            <Select value={confidence} onChange={setConfidence}
              options={[{ value: '0.95', label: '95%' }, { value: '0.99', label: '99%' }, { value: '0.90', label: '90%' }]} />
          </Field>
          <Field label="Comment">
            <TextInput value={comment} onChange={(e) => setComment(e.target.value)} placeholder="why this epoch is analyzed..." />
          </Field>
        </div>

        {situation && (
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <div className="mb-1 text-2xs font-semibold text-slate-500">Station epochs at this slot</div>
              <TableWrap maxH="max-h-40">
                <thead><tr><th>Station</th><th>Epoch</th><th>Age</th><th>State</th><th>T/P</th></tr></thead>
                <tbody>
                  {situation.cycles.usage.map((u) => (
                    <tr key={u.stationId}>
                      <td className="font-medium">{u.stationId}</td>
                      <td>{u.state === 'missing' ? '-' : fmtDateTime(u.epoch)}</td>
                      <td>{Number.isNaN(u.ageMin) ? '-' : `${u.ageMin} min`}</td>
                      <td><Badge tone={u.state}>{u.state}</Badge></td>
                      <td>{situation.envByStation.find((e) => e.stationId === u.stationId)?.available
                        ? <Badge tone="Success">available</Badge> : <Badge tone="Provisional">missing</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
            <div className="space-y-2">
              <KV items={[
                ['Active references', situation.refSet
                  ? `${situation.refSet.name} (${situation.refSet.points.length} points)` : 'not found'],
                ['Observations in window', String(situation.cycles.observations.length)],
                ['Targets not observed', situation.notObserved.map((t) => t.adjustmentName).join(', ') || 'none'],
                ['Configuration', config ? `${config.label} (valid ${config.validFrom.slice(0, 10)} → ${config.validTo?.slice(0, 10) ?? 'open'})` : '-'],
              ]} />
              {situation.cycles.provisionalReasons.map((r, i) => <Callout key={i} tone="warning">{r}</Callout>)}
              {situation.cycles.fatal && <Callout tone="error">{situation.cycles.fatal}</Callout>}
            </div>
          </div>
        )}

        <div className="mt-4">
          <Button variant="primary" disabled={!config || !!situation?.cycles.fatal}
            onClick={async () => {
              if (!config) return;
              const session = await actions.createAnalysisSession(processingId, config.id, slotIso, {
                autoCorrection, confidence: Number(confidence), comment,
              });
              if (session) nav(`/analysis/${session.id}`);
            }}>
            Create analysis session
          </Button>
        </div>
      </Card>

      <Card title="12.7 - Analysis history">
        {state.analysisSessions.length === 0
          ? <p className="text-xs text-slate-400">No analysis sessions yet.</p>
          : (
            <TableWrap>
              <thead>
                <tr><th>Processing</th><th>Epoch / slot</th><th>User</th><th>Baseline config</th>
                  <th>Trials</th><th>Best candidate</th><th>Configuration created</th><th>Status</th><th>Date</th><th>Comment</th><th></th></tr>
              </thead>
              <tbody>
                {state.analysisSessions.map((s) => {
                  const proc = state.processings.find((p) => p.id === s.processingId);
                  const cfg = state.configVersions.find((c) => c.id === s.configurationVersionId);
                  const created = state.configVersions.find((c) => c.id === s.resultingConfigurationVersionId);
                  const best = s.trials.find((t) => t.id === s.bestCandidateTrialId);
                  return (
                    <tr key={s.id}>
                      <td>{proc?.name}</td>
                      <td>{fmtDateTime(s.outputSlot)}</td>
                      <td>{s.createdBy}</td>
                      <td>{cfg?.label}</td>
                      <td>{s.trials.length}</td>
                      <td>{best ? `Trial ${best.trialNumber}` : '-'}</td>
                      <td>{created ? <Badge tone="Success">{created.label}</Badge> : '-'}</td>
                      <td><Badge tone={s.status}>{s.status}</Badge></td>
                      <td className="text-2xs">{fmtDateTime(s.createdAt)}</td>
                      <td className="text-2xs">{s.comment ?? '-'}</td>
                      <td>
                        <div className="flex gap-1">
                          <Link to={`/analysis/${s.id}`}><Button size="xs">{s.status === 'open' ? 'Open' : 'Open (read-only)'}</Button></Link>
                          <Button size="xs" onClick={async () => {
                            const dup = await actions.createAnalysisSession(s.processingId, s.configurationVersionId, s.outputSlot, {
                              autoCorrection: false, confidence: 0.95, comment: `Duplicated from session ${s.id} (new snapshot)`,
                            });
                            if (dup) nav(`/analysis/${dup.id}`);
                          }}>Duplicate</Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
      </Card>
    </div>
  );
}

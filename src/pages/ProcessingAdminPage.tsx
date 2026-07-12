import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../store/AppStore';
import {
  Badge, Button, Callout, Card, Drawer, Field, KV, Modal, NumberInput, Select,
  StatusBadge, TableWrap, Tabs, TextInput, Toggle,
} from '../components/ui';
import { fmtDateTime, fmtM, fmtMm, fmtNum } from '../lib/format';
import type { AdjustmentTemplate, ConfigurationVersion } from '../types/domain';
import { repository } from '../data/repository';
import { PointIdentityPanel } from '../components/PointIdentityPanel';

const TAB_IDS = ['Overview', 'Configurations', 'Stations & Instruments', 'Targets & Prisms',
  'Point Identity', 'Reference Sets', 'Initial Coordinates', 'Adjustment Settings',
  'Run & Synchronization', 'Output Variables', 'Runs & Results', 'Audit Log'];

export function ProcessingAdminPage() {
  const { id } = useParams();
  const { state, actions } = useApp();
  const nav = useNavigate();
  const [tab, setTab] = useState('Overview');

  const processing = state.processings.find((p) => p.id === id);
  const configs = state.configVersions
    .filter((c) => c.processingId === id)
    .sort((a, b) => a.versionNumber - b.versionNumber);
  const [selectedConfigId, setSelectedConfigId] = useState<string>('');
  const config = configs.find((c) => c.id === (selectedConfigId || processing?.activeConfigurationVersionId))
    ?? configs[configs.length - 1];

  if (!processing) return <Callout tone="error">Processing not found.</Callout>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-bold">{processing.name} <StatusBadge status={processing.status} /></h1>
          <p className="text-xs text-slate-500">
            {processing.project} · {processing.site} · {processing.network} · {processing.networkKind}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" onClick={async () => {
            const run = await actions.executeRun(processing.id, { trigger: 'manual' });
            if (run) nav(`/runs/${run.id}`);
          }}>Run now</Button>
          <Button onClick={() => nav(`/processings/${processing.id}/reprocess`)}>Reprocess</Button>
          <Button onClick={() => nav('/analysis')}>Analysis Lab</Button>
          <Button onClick={() => actions.setProcessingActive(processing.id, !processing.active)}>
            {processing.active ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Tabs tabs={TAB_IDS.map((t) => ({ id: t, label: t }))} active={tab} onChange={setTab} />
      </div>

      {tab !== 'Overview' && tab !== 'Configurations' && tab !== 'Runs & Results' && tab !== 'Audit Log' && config && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          Viewing configuration:
          <Select value={config.id} onChange={setSelectedConfigId}
            options={configs.map((c) => ({ value: c.id, label: `${c.label} [${c.status}]` }))} />
          {config.usedByRun && <Badge tone="Provisional">used by runs - immutable</Badge>}
        </div>
      )}

      {tab === 'Overview' && <OverviewTab processingId={processing.id} />}
      {tab === 'Configurations' && <ConfigurationsTab processingId={processing.id} />}
      {tab === 'Stations & Instruments' && config && <StationsTab config={config} />}
      {tab === 'Targets & Prisms' && config && <TargetsTab config={config} />}
      {tab === 'Point Identity' && config && <PointIdentityTab config={config} />}
      {tab === 'Reference Sets' && <ReferenceSetsTab processingId={processing.id} />}
      {tab === 'Initial Coordinates' && config && <InitialTab config={config} />}
      {tab === 'Adjustment Settings' && config && <AdjustmentTab config={config} />}
      {tab === 'Run & Synchronization' && config && <RunPolicyTab config={config} />}
      {tab === 'Output Variables' && config && <OutputTab config={config} />}
      {tab === 'Runs & Results' && <RunsResultsTab processingId={processing.id} />}
      {tab === 'Audit Log' && <AuditTab processingId={processing.id} />}
    </div>
  );
}

// ------------------------------------------------------------ overview ----
function OverviewTab({ processingId }: { processingId: string }) {
  const { state } = useApp();
  const p = state.processings.find((x) => x.id === processingId)!;
  const configs = state.configVersions.filter((c) => c.processingId === processingId);
  const runs = state.runs.filter((r) => r.processingId === processingId);
  const results = state.results.filter((r) => r.processingId === processingId);
  const sessions = state.analysisSessions.filter((s) => s.processingId === processingId);
  const active = configs.find((c) => c.id === p.activeConfigurationVersionId);
  return (
    <div className="grid grid-cols-2 gap-4">
      <Card title="Processing">
        <KV items={[
          ['Type', p.type],
          ['Description', p.description || '-'],
          ['Created', `${fmtDateTime(p.createdAt)} by ${p.createdBy}`],
          ['Mode', p.mode],
          ['Active', p.active ? 'yes' : 'no'],
          ['Stations', active?.stations.map((s) => s.id).join(', ') ?? '-'],
          ['Targets included', String(active?.targets.filter((t) => t.includeInAdjustment).length ?? 0)],
          ['Active configuration', active ? `${active.label} (from ${active.validFrom.slice(0, 10)})` : 'none'],
        ]} />
      </Card>
      <Card title="Activity">
        <KV items={[
          ['Configuration versions', String(configs.length)],
          ['Runs executed', String(runs.length)],
          ['Result versions', String(results.length)],
          ['Provisional current results', String(results.filter((r) => r.current && r.provisional).length)],
          ['Analysis sessions', String(sessions.length)],
          ['Trigger', active ? active.runPolicy.triggerMode : '-'],
          ['Output grid', active ? `${active.outputPolicy.outputIntervalMin} min` : '-'],
        ]} />
      </Card>
    </div>
  );
}

// ------------------------------------------------------ configurations ----
function ConfigurationsTab({ processingId }: { processingId: string }) {
  const { state, actions } = useApp();
  const configs = state.configVersions
    .filter((c) => c.processingId === processingId)
    .sort((a, b) => a.versionNumber - b.versionNumber);
  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');
  const diff = useMemo(() => {
    const a = configs.find((c) => c.id === compareA);
    const b = configs.find((c) => c.id === compareB);
    if (!a || !b) return null;
    return diffConfigs(a, b);
  }, [compareA, compareB, configs]);

  return (
    <div className="space-y-4">
      <Card title="Version timeline">
        <TableWrap>
          <thead>
            <tr><th>Version</th><th>Validity</th><th>Status</th><th>Main changes</th><th>Used by runs</th><th>Origin</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {configs.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">{c.label}</td>
                <td>{c.validFrom.slice(0, 10)} → {c.validTo ? c.validTo.slice(0, 10) : 'open'}</td>
                <td><Badge tone={c.status}>{c.status}</Badge></td>
                <td className="max-w-md whitespace-normal text-2xs">{c.description}{c.technicalReason ? ` — ${c.technicalReason}` : ''}</td>
                <td>{c.usedByRun ? <Badge tone="Provisional">immutable</Badge> : 'no'}</td>
                <td className="text-2xs">{c.sourceAnalysisSessionId
                  ? <Link to={`/analysis/${c.sourceAnalysisSessionId}`} className="text-brand-700 hover:underline">analysis session</Link>
                  : 'wizard/admin'}</td>
                <td>
                  <div className="flex gap-1">
                    {c.status !== 'active' && c.status !== 'archived' && (
                      <Button size="xs" onClick={() => actions.setConfigStatus(c.id, 'active')}>Activate</Button>
                    )}
                    {c.status === 'active' && (
                      <Button size="xs" onClick={() => actions.setConfigStatus(c.id, 'inactive')}>Deactivate</Button>
                    )}
                    {c.status !== 'archived'
                      ? <Button size="xs" onClick={() => actions.setConfigStatus(c.id, 'archived')}>Archive</Button>
                      : <Button size="xs" onClick={() => actions.setConfigStatus(c.id, 'inactive')}>Restore visibility</Button>}
                    <Button size="xs" onClick={() => {
                      actions.createConfigVersion(processingId, c, {}, {
                        label: `V${Math.max(...configs.map((x) => x.versionNumber)) + 1} - duplicate of ${c.label}`,
                        description: `Duplicated from ${c.label}`,
                        validFrom: new Date().toISOString(),
                        activate: false,
                      });
                    }}>Duplicate</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <p className="mt-2 text-2xs text-slate-500">
          validFrom is inclusive, validTo exclusive. A version used by at least one run is immutable
          forever: deletion is impossible, only deactivation or archiving. Runs pick the version valid
          for the output slot being computed, never the current date. Gaps between validity periods are
          reported when a run finds no valid configuration.
        </p>
      </Card>
      <Card title="Compare two versions">
        <div className="mb-3 flex gap-2">
          <Select value={compareA} onChange={setCompareA}
            options={[{ value: '', label: 'Version A...' }, ...configs.map((c) => ({ value: c.id, label: c.label }))]} />
          <Select value={compareB} onChange={setCompareB}
            options={[{ value: '', label: 'Version B...' }, ...configs.map((c) => ({ value: c.id, label: c.label }))]} />
        </div>
        {diff && (diff.length === 0
          ? <Callout tone="info">No differences found.</Callout>
          : (
            <TableWrap maxH="max-h-64">
              <thead><tr><th>Field</th><th>Version A</th><th>Version B</th></tr></thead>
              <tbody>
                {diff.map((d, i) => (
                  <tr key={i}><td className="font-medium">{d.field}</td><td>{d.a}</td><td>{d.b}</td></tr>
                ))}
              </tbody>
            </TableWrap>
          ))}
      </Card>
    </div>
  );
}

export function diffConfigs(a: ConfigurationVersion, b: ConfigurationVersion): { field: string; a: string; b: string }[] {
  const out: { field: string; a: string; b: string }[] = [];
  const cmp = (field: string, va: unknown, vb: unknown) => {
    const sa = JSON.stringify(va); const sb = JSON.stringify(vb);
    if (sa !== sb) out.push({ field, a: trunc(sa), b: trunc(sb) });
  };
  cmp('validity', `${a.validFrom}→${a.validTo ?? 'open'}`, `${b.validFrom}→${b.validTo ?? 'open'}`);
  cmp('referenceSetId', a.referenceSetId, b.referenceSetId);
  for (const k of Object.keys(a.adjustment) as (keyof AdjustmentTemplate)[]) {
    cmp(`adjustment.${k}`, a.adjustment[k], b.adjustment[k]);
  }
  cmp('stations', a.stations.map((s) => `${s.id}:${s.instrumentHeightM}:${s.distanceState}:${s.atmosphericMode}`),
    b.stations.map((s) => `${s.id}:${s.instrumentHeightM}:${s.distanceState}:${s.atmosphericMode}`));
  cmp('targets.included', a.targets.filter((t) => t.includeInAdjustment).map((t) => t.rawName).sort(),
    b.targets.filter((t) => t.includeInAdjustment).map((t) => t.rawName).sort());
  cmp('prismSetups', a.prismSetups.map((s) => `${s.stationId}|${s.targetKey}:${s.effectiveConstantM}`),
    b.prismSetups.map((s) => `${s.stationId}|${s.targetKey}:${s.effectiveConstantM}`));
  cmp('runPolicy', a.runPolicy, b.runPolicy);
  cmp('outputPolicy', a.outputPolicy, b.outputPolicy);
  cmp('provisionalCoordinates', a.provisionalCoordinates.map((p) => `${p.targetId}:${p.easting.toFixed(4)}/${p.northing.toFixed(4)}/${p.height.toFixed(4)}`),
    b.provisionalCoordinates.map((p) => `${p.targetId}:${p.easting.toFixed(4)}/${p.northing.toFixed(4)}/${p.height.toFixed(4)}`));
  return out;
}
function trunc(s: string): string { return s.length > 120 ? s.slice(0, 117) + '...' : s; }

// -------------------------------------------------------------- stations --
function StationsTab({ config }: { config: ConfigurationVersion }) {
  const instruments = repository.instrumentProfiles();
  return (
    <Card title={`Stations & instruments (${config.label})`}>
      <TableWrap>
        <thead>
          <tr><th>Station</th><th>Instrument profile</th><th>EDM</th><th>Height (m)</th>
            <th>Distance state</th><th>Station constant (mm)</th><th>Atmospheric mode</th>
            <th>T/P tolerance</th><th>Missing env policy</th><th>Required</th><th>Adjustable</th></tr>
        </thead>
        <tbody>
          {config.stations.map((s) => {
            const inst = instruments.find((i) => i.id === s.instrumentProfileId);
            return (
              <tr key={s.id}>
                <td className="font-medium">{s.id}</td>
                <td>{inst ? `${inst.manufacturer} ${inst.model}` : s.instrumentProfileId}
                  <div className="text-2xs text-slate-400">atmo model {inst?.atmosphericModelVersion}</div></td>
                <td>{s.edmMode}</td>
                <td>{s.instrumentHeightM.toFixed(3)}</td>
                <td><Badge>{s.distanceState}</Badge></td>
                <td className="text-right">{fmtMm(s.constantAppliedByStationM, 1)}</td>
                <td>{s.atmosphericMode}</td>
                <td>{s.envToleranceMin} min</td>
                <td>{s.missingEnvPolicy}</td>
                <td>{s.required ? 'required' : 'optional'}</td>
                <td>{s.adjustable ? 'yes (free station)' : 'no (fixed pillar)'}</td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>
      <Callout tone="info">
        Changing a station, height, prism, constant, reference or parameter always creates a complete
        new configuration version (see Configurations tab or the Analysis Lab save flow).
      </Callout>
    </Card>
  );
}

// --------------------------------------------------------------- targets --
function TargetsTab({ config }: { config: ConfigurationVersion }) {
  const prisms = repository.prismProfiles();
  return (
    <Card title={`Targets & prisms (${config.label})`}>
      <TableWrap>
        <thead>
          <tr><th>Station</th><th>Raw name</th><th>Adjustment name</th><th>Output name</th><th>Role</th>
            <th>Prism</th><th>Height (m)</th><th>Effective const (mm)</th><th>BTM correction (mm)</th>
            <th>Include</th><th>Publish</th><th>Status</th><th>Source</th></tr>
        </thead>
        <tbody>
          {config.targets.map((t) => {
            const setup = config.prismSetups.find((s) => s.targetKey === t.rawName);
            const prism = prisms.find((p) => p.id === t.prismProfileId);
            return (
              <tr key={t.id}>
                <td>{t.stationIds.join(', ')}</td>
                <td className="font-medium">{t.rawName}</td>
                <td>{t.adjustmentName}</td>
                <td className="text-2xs">{t.outputName}</td>
                <td><Badge>{t.role}</Badge></td>
                <td>{prism?.name ?? t.prismProfileId}</td>
                <td>{t.targetHeightM.toFixed(3)}</td>
                <td className="text-right">{fmtMm(setup?.effectiveConstantM, 1)}</td>
                <td className="text-right">{fmtMm((setup?.effectiveConstantM ?? 0) - (setup?.constantAppliedByStationM ?? 0), 1)}</td>
                <td>{t.includeInAdjustment ? '✓' : '✗'}</td>
                <td>{t.publishOutput ? '✓' : '✗'}</td>
                <td><Badge tone={t.reviewStatus === 'to-review' ? 'Provisional' : 'Success'}>{t.reviewStatus}</Badge></td>
                <td>{t.source === 'manual-override' ? <Badge tone="Provisional">Modified from template</Badge> : 'template'}</td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>
    </Card>
  );
}

// --------------------------------------------------------- point identity --
function PointIdentityTab({ config }: { config: ConfigurationVersion }) {
  const { state, actions } = useApp();
  const [draft, setDraft] = useState<{ targets: ConfigurationVersion['targets']; physicalPoints: ConfigurationVersion['physicalPoints'] } | null>(null);
  const [changeLog, setChangeLog] = useState<string[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 16));
  const [activate, setActivate] = useState(true);

  const editing = draft !== null;
  const targets = draft?.targets ?? config.targets;
  const physicalPoints = draft?.physicalPoints ?? config.physicalPoints;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="max-w-3xl text-xs text-slate-500">
          Versioned mapping between BTM prism registrations and physical points. The mapping
          belongs to the configuration version{config.usedByRun ? ' - this version was used by runs, so it is immutable: changes below are staged and saved as a NEW version' : ''}.
          Historical recalculations always reuse the mapping version valid for the recomputed period,
          and every run snapshot stores the resolved engine-id ↔ prisms correspondence.
        </p>
        {!editing
          ? <Button size="xs" variant="primary" onClick={() => setDraft({
            targets: JSON.parse(JSON.stringify(config.targets)),
            physicalPoints: JSON.parse(JSON.stringify(config.physicalPoints)),
          })}>Edit mapping{config.usedByRun ? ' → new version' : ''}</Button>
          : (
            <div className="flex gap-2">
              <Button size="xs" onClick={() => { setDraft(null); setChangeLog([]); }}>Discard changes</Button>
              <Button size="xs" variant="primary" disabled={changeLog.length === 0}
                onClick={() => setSaveOpen(true)}>
                Save as new version... ({changeLog.length} change(s))
              </Button>
            </div>
          )}
      </div>
      {editing && changeLog.length > 0 && (
        <Callout tone="info">Staged changes: {changeLog.join(' · ')}</Callout>
      )}
      <PointIdentityPanel
        stations={config.stations}
        targets={targets}
        physicalPoints={physicalPoints}
        provisional={config.provisionalCoordinates}
        readOnly={!editing}
        user={state.user}
        onChange={(t, pp, summary) => {
          setDraft({ targets: t, physicalPoints: pp });
          setChangeLog((l) => [...l, summary]);
        }}
      />
      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title="Save point mapping as new configuration version"
        footer={
          <>
            <Button onClick={() => setSaveOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={!label.trim()} onClick={() => {
              if (!draft) return;
              actions.createConfigVersion(config.processingId, config, {
                targets: draft.targets,
                physicalPoints: draft.physicalPoints,
              }, {
                label,
                description: `Point identity mapping updated: ${changeLog.join('; ')}`,
                technicalReason: changeLog.join('; '),
                validFrom: new Date(validFrom + (validFrom.endsWith('Z') ? '' : ':00Z')).toISOString(),
                activate,
              });
              setSaveOpen(false); setDraft(null); setChangeLog([]);
            }}>Create version</Button>
          </>
        }>
        <div className="space-y-3">
          <Callout tone="info">
            The current version and every past run stay untouched. Runs after "valid from" will use
            the new mapping; a reprocess of an older period keeps using the version valid then.
          </Callout>
          <Field label="Version label"><TextInput value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder='e.g. "V3 - MP04_34 and MP04_35 linked as one point"' /></Field>
          <Field label="Valid from"><TextInput type="datetime-local" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} /></Field>
          <Toggle checked={activate} onChange={setActivate} label="Activate immediately" />
        </div>
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------ references --
function ReferenceSetsTab({ processingId }: { processingId: string }) {
  const { state, actions } = useApp();
  const sets = state.referenceSets.filter((r) => r.processingId === processingId);
  return (
    <div className="space-y-4">
      {sets.map((rs) => (
        <Card key={rs.id}
          title={`${rs.name} (v${rs.version}) — valid ${rs.validFrom.slice(0, 10)} → ${rs.validTo ? rs.validTo.slice(0, 10) : 'open'}`}
          actions={
            <div className="flex items-center gap-2">
              {rs.usedByRun && <Badge tone="Provisional">used - immutable</Badge>}
              <Button size="xs" onClick={() => {
                actions.addReferenceSet({
                  ...JSON.parse(JSON.stringify(rs)),
                  id: `refset-${Date.now()}`,
                  name: `${rs.name} (copy)`,
                  version: Math.max(...sets.map((x) => x.version)) + 1,
                  usedByRun: false,
                  createdAt: new Date().toISOString(),
                  comment: `Duplicated from ${rs.name}`,
                });
              }}>Duplicate for future period</Button>
            </div>
          }>
          <TableWrap maxH="max-h-56">
            <thead><tr><th>Point</th><th>E</th><th>N</th><th>H</th><th>σE</th><th>σN</th><th>σH</th><th>Modes E/N/H</th><th>Comment</th></tr></thead>
            <tbody>
              {rs.points.map((p) => (
                <tr key={p.pointId}>
                  <td className="font-medium">{p.pointId}</td>
                  <td>{fmtM(p.easting)}</td><td>{fmtM(p.northing)}</td><td>{fmtM(p.height)}</td>
                  <td>{p.modeE === 'free' ? '*' : p.modeE === 'fixed' ? '!' : p.sigmaE}</td>
                  <td>{p.modeN === 'free' ? '*' : p.modeN === 'fixed' ? '!' : p.sigmaN}</td>
                  <td>{p.modeH === 'free' ? '*' : p.modeH === 'fixed' ? '!' : p.sigmaH}</td>
                  <td>{p.modeE}/{p.modeN}/{p.modeH}</td>
                  <td className="text-2xs">{p.comment || p.source}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      ))}
      <Callout tone="info">
        Editing coordinates of a used set automatically goes through a new version
        (duplicate → edit in the wizard or Analysis Lab → save as new configuration version).
      </Callout>
    </div>
  );
}

// ----------------------------------------------------------- initial ------
function InitialTab({ config }: { config: ConfigurationVersion }) {
  return (
    <Card title={`Provisional coordinates snapshot (${config.label})`}>
      <TableWrap>
        <thead>
          <tr><th>Target</th><th>E</th><th>N</th><th>H</th><th>Obs</th><th>Spread H (mm)</th>
            <th>Spread V (mm)</th><th>Status</th><th>Window</th><th>Comment</th></tr>
        </thead>
        <tbody>
          {config.provisionalCoordinates.map((p) => (
            <tr key={p.targetId}>
              <td className="font-medium">{p.targetId}</td>
              <td>{fmtM(p.easting)}</td><td>{fmtM(p.northing)}</td><td>{fmtM(p.height)}</td>
              <td>{p.nObservations}</td>
              <td className="text-right">{fmtMm(p.spreadHorizontalM)}</td>
              <td className="text-right">{fmtMm(p.spreadVerticalM)}</td>
              <td><Badge tone={p.status === 'computed' ? 'Success' : 'Provisional'}>{p.status}</Badge></td>
              <td className="text-2xs">{p.epochFrom.slice(0, 16)} → {p.epochTo.slice(11, 16)}</td>
              <td className="text-2xs">{p.comment ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </Card>
  );
}

// --------------------------------------------------------- adjustment -----
function AdjustmentTab({ config }: { config: ConfigurationVersion }) {
  const { state, actions } = useApp();
  const [draft, setDraft] = useState<AdjustmentTemplate | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 16));
  const [activate, setActivate] = useState(false);
  const a = config.adjustment;

  const rows: [string, keyof AdjustmentTemplate, string][] = [
    ['Dimension', 'dimension', ''], ['Projection', 'projectionMode', ''],
    ['Convergence threshold', 'convergenceThresholdM', 'm'], ['Max iterations', 'maxIterations', ''],
    ['Chi² significance', 'chiSquareSignificance', ''], ['Confidence level', 'confidenceLevel', ''],
    ['Error propagation', 'errorPropagation', ''], ['Distance weighting', 'distanceWeighting', ''],
    ['Centering errors', 'useCenteringErrors', ''], ['Refraction coefficient', 'refractionCoefficient', ''],
    ['Earth radius', 'earthRadiusM', 'm'], ['Datum scale factor', 'datumScaleFactor', ''],
    ['Std residual threshold', 'stdResThreshold', ''], ['Removals per iteration', 'removalsPerIteration', ''],
    ['Max auto-correction attempts', 'maxAutoCorrectionAttempts', ''], ['Max removed observations', 'maxRemovedObservations', ''],
    ['Max removed ratio', 'maxRemovedRatio', ''], ['Min degrees of freedom', 'minDegreesOfFreedom', ''],
    ['Max ellipse semi-major', 'maxEllipseSemiMajorMm', 'mm'], ['Auto-correction', 'autoCorrectionEnabled', ''],
    ['Fixed constraint sigma', 'fixedConstraintSigmaM', 'm'],
  ];

  return (
    <Card title={`Adjustment settings (${config.label})`}
      actions={
        config.usedByRun
          ? <Button size="xs" onClick={() => setDraft({ ...a })}>Edit → creates new version</Button>
          : <Button size="xs" onClick={() => setDraft({ ...a })}>Edit</Button>
      }>
      <TableWrap maxH="max-h-96">
        <thead><tr><th>Parameter</th><th>Value</th><th>Unit</th></tr></thead>
        <tbody>
          {rows.map(([labelTxt, key, unit]) => (
            <tr key={key}><td>{labelTxt}</td><td className="font-medium">{String(a[key])}</td><td>{unit}</td></tr>
          ))}
        </tbody>
      </TableWrap>
      <Drawer open={draft !== null} onClose={() => setDraft(null)} title="Edit adjustment parameters" wide>
        {draft && (
          <div className="space-y-3">
            <Callout tone="warning">
              Saving creates a NEW configuration version - the version currently used by runs stays immutable.
            </Callout>
            <div className="grid grid-cols-3 gap-3">
              {rows.map(([labelTxt, key, unit]) => {
                const v = draft[key];
                if (typeof v === 'boolean') {
                  return <Field key={key} label={labelTxt}><Toggle checked={v}
                    onChange={(nv) => setDraft({ ...draft, [key]: nv })} /></Field>;
                }
                if (typeof v === 'number') {
                  return <Field key={key} label={labelTxt} unit={unit || undefined}>
                    <NumberInput value={v} onChange={(nv) => setDraft({ ...draft, [key]: nv })} /></Field>;
                }
                return <Field key={key} label={labelTxt}><TextInput value={String(v)}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} /></Field>;
              })}
            </div>
            <Button variant="primary" onClick={() => setSaveOpen(true)}>Save as new version...</Button>
          </div>
        )}
      </Drawer>
      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title="Create new configuration version"
        footer={
          <>
            <Button onClick={() => setSaveOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => {
              if (!draft) return;
              actions.createConfigVersion(config.processingId, config, { adjustment: draft }, {
                label: label || `V? - adjusted parameters`,
                description: 'Adjustment parameters edited from administration',
                validFrom: new Date(validFrom + 'Z').toISOString(),
                activate,
              });
              setSaveOpen(false); setDraft(null);
            }}>Create version</Button>
          </>
        }>
        <div className="space-y-3">
          <Field label="Version label"><TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. V3 - relaxed distance weighting" /></Field>
          <Field label="Valid from"><TextInput type="datetime-local" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} /></Field>
          <Toggle checked={activate} onChange={setActivate} label="Activate immediately (closes the current active version)" />
        </div>
      </Modal>
      <div className="mt-2 text-2xs text-slate-400">
        Origin: template {state.adjustmentTemplates.find((t) => t.id === config.templateOrigins.adjustmentTemplateId)?.name ?? config.templateOrigins.adjustmentTemplateId}
        {config.templateOrigins.overriddenFields.length > 0 && ` · overridden: ${config.templateOrigins.overriddenFields.join(', ')}`}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------- run policy ----
function RunPolicyTab({ config }: { config: ConfigurationVersion }) {
  const r = config.runPolicy;
  return (
    <Card title={`Run & synchronization (${config.label})`}>
      <KV items={[
        ['Trigger', r.triggerMode + (r.triggerMode === 'schedule' ? ` every ${r.scheduleEveryMinutes} min` : '')],
        ['Sync tolerance', `${r.syncToleranceMin} min`],
        ['Max reused age', `${r.maxReusedAgeMin} min`],
        ['Required stations', r.requiredStationIds.join(', ') || '-'],
        ['Optional stations', r.optionalStationIds.join(', ') || '-'],
        ['Reuse missing station', r.reuseMissingStation ? 'yes' : 'no'],
        ['Compute without optional', r.computeWithoutOptional ? 'yes' : 'no'],
        ['Mark reused provisional', r.markReusedProvisional ? 'yes' : 'no'],
        ['Catch-up', r.catchUpEnabled ? `enabled - window ${r.catchUpWindowH} h` : 'disabled'],
        ['Catch-up on late observation', r.catchUpOnLateObservation ? 'yes' : 'no'],
        ['Catch-up on late T/P', r.catchUpOnLateEnvironmental ? 'yes' : 'no'],
        ['Max recalculations per slot', String(r.maxRecalcPerSlot)],
        ['Replace only if quality improves', r.replaceOnlyIfQualityImproves ? 'yes' : 'no'],
        ['Keep all result versions', 'always (non-negotiable)'],
      ]} />
    </Card>
  );
}

// -------------------------------------------------------------- output ----
function OutputTab({ config }: { config: ConfigurationVersion }) {
  const o = config.outputPolicy;
  return (
    <Card title={`Output variables (${config.label})`}>
      <KV items={[
        ['Output interval', `${o.outputIntervalMin} min (grid-aligned: 00/${o.outputIntervalMin === 30 ? '30' : '...'})`],
        ['Max epoch → slot distance', `${o.maxEpochToSlotDistanceMin} min`],
        ['Duplicate strategy', o.duplicateStrategy],
        ['Late-data closing delay', `${o.lateDataClosingDelayMin} min`],
        ['Publish provisional', o.publishProvisional ? 'yes' : 'no'],
        ['Variables per target', o.variables.join(', ')],
        ['Published targets', config.targets.filter((t) => t.publishOutput).map((t) => t.outputName).join(', ')],
      ]} />
    </Card>
  );
}

// -------------------------------------------------------- runs/results ----
function RunsResultsTab({ processingId }: { processingId: string }) {
  const { state, actions } = useApp();
  const nav = useNavigate();
  const runs = state.runs.filter((r) => r.processingId === processingId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const results = state.results.filter((r) => r.processingId === processingId);
  const slots = [...new Set(results.map((r) => r.outputSlot))].sort().reverse();

  return (
    <div className="space-y-4">
      <Card title={`Runs (${runs.length})`}>
        <TableWrap maxH="max-h-72">
          <thead>
            <tr><th>Output slot</th><th>Trigger</th><th>Status</th><th>Config</th><th>Attempts</th>
              <th>Chi²</th><th>Error factor</th><th>Duration</th><th>Started</th><th></th></tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const q = r.attempts[r.finalAttempt]?.quality;
              const cfg = state.configVersions.find((c) => c.id === r.configurationVersionId);
              return (
                <tr key={r.id}>
                  <td className="font-medium">{fmtDateTime(r.outputSlot)}</td>
                  <td><Badge>{r.trigger}</Badge></td>
                  <td><StatusBadge status={r.status} />{r.provisional && <Badge tone="Provisional">prov.</Badge>}</td>
                  <td className="text-2xs">{cfg?.label}</td>
                  <td>{r.attempts.length}</td>
                  <td>{q ? <Badge tone={q.chiSquarePassed ? 'PASS' : 'FAIL'}>{q.chiSquarePassed ? 'PASS' : 'FAIL'}</Badge> : '-'}</td>
                  <td>{fmtNum(q?.totalErrorFactor)}</td>
                  <td>{r.durationMs} ms</td>
                  <td className="text-2xs">{fmtDateTime(r.startedAt)}</td>
                  <td><Button size="xs" onClick={() => nav(`/runs/${r.id}`)}>Open</Button></td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>
      <Card title="Result versions per output slot">
        {slots.length === 0 && <p className="text-xs text-slate-400">No published results yet. Use "Run now".</p>}
        <div className="space-y-3">
          {slots.map((slot) => {
            const versions = results.filter((r) => r.outputSlot === slot).sort((a, b) => a.version - b.version);
            return (
              <div key={slot} className="rounded-md ring-1 ring-slate-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold">{fmtDateTime(slot)}</span>
                  <Button size="xs" onClick={() => actions.catchUp(processingId, slot, 'Manual catch-up from administration')}>
                    Catch-up (new version)
                  </Button>
                </div>
                <TableWrap maxH="max-h-40">
                  <thead><tr><th>Version</th><th>Label</th><th>Provisional</th><th>Current</th><th>Run</th><th>Created</th><th>Reason</th><th></th></tr></thead>
                  <tbody>
                    {versions.map((v) => (
                      <tr key={v.id}>
                        <td>V{v.version}</td>
                        <td>{v.label}</td>
                        <td>{v.provisional ? <Badge tone="Provisional">provisional</Badge> : <Badge tone="Success">final</Badge>}</td>
                        <td>{v.current ? '● current' : ''}</td>
                        <td><Link to={`/runs/${v.runId}`} className="text-brand-700 hover:underline">open run</Link></td>
                        <td className="text-2xs">{fmtDateTime(v.createdAt)}</td>
                        <td className="text-2xs">{v.reason}</td>
                        <td>{!v.current && <Button size="xs" onClick={() => actions.promoteResult(v.id)}>Promote as current</Button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// --------------------------------------------------------------- audit ----
function AuditTab({ processingId }: { processingId: string }) {
  const { state } = useApp();
  const events = state.audit.filter((e) => e.processingId === processingId);
  return (
    <Card title={`Audit log (${events.length} events)`}>
      <TableWrap maxH="max-h-96">
        <thead><tr><th>Time</th><th>User</th><th>Category</th><th>Action</th><th>Details</th></tr></thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td className="text-2xs">{fmtDateTime(e.at)}</td>
              <td>{e.user}</td>
              <td><Badge>{e.category}</Badge></td>
              <td className="font-medium">{e.action}</td>
              <td className="max-w-lg whitespace-normal text-2xs">{e.details}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </Card>
  );
}

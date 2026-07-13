import React, { useState } from 'react';
import { useApp } from '../store/AppStore';
import { Badge, Button, Callout, Card, KV, TableWrap, Tabs } from '../components/ui';
import { repository } from '../data/repository';
import { fmtMm } from '../lib/format';

const CATALOGS = ['Country', 'Instrument', 'Prism Setup', 'Adjustment', 'Run', 'Output'];

export function TemplatesPage() {
  const { state, actions } = useApp();
  const [tab, setTab] = useState('Country');
  const instrumentName = (id: string) => {
    const instrument = repository.instrumentProfiles().find((item) => item.id === id);
    return instrument ? `${instrument.manufacturer} ${instrument.model}` : id;
  };
  const prismName = (id: string) => repository.prismProfiles().find((item) => item.id === id)?.name ?? id;
  const adjustmentName = (id: string) => state.adjustmentTemplates.find((item) => item.id === id)?.name ?? id;

  const usage = (templateId: string) =>
    state.configVersions.filter((c) =>
      c.templateOrigins.countryTemplateId === templateId
      || c.templateOrigins.adjustmentTemplateId === templateId
      || c.templateOrigins.runTemplateId === templateId
      || c.templateOrigins.outputTemplateId === templateId
      || c.stations.some((s) => s.instrumentProfileId === templateId)
      || c.targets.some((t) => t.prismProfileId === templateId));

  const usageCell = (id: string) => {
    const configs = usage(id);
    if (configs.length === 0) return <span className="text-slate-400">unused</span>;
    const procs = [...new Set(configs.map((c) => state.processings.find((p) => p.id === c.processingId)?.name ?? c.processingId))];
    const overridden = [...new Set(configs.flatMap((c) => c.templateOrigins.overriddenFields))];
    return (
      <div className="text-2xs">
        <div>{procs.join(', ')}</div>
        {overridden.length > 0 && <div className="text-amber-600">overridden fields: {overridden.join(', ')}</div>}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Templates</h1>
        <p className="text-xs text-slate-500">
          Combinable template families. A new template version never modifies an existing
          configuration version - applying new defaults is an explicit user action with a diff preview.
        </p>
      </div>
      <Tabs tabs={CATALOGS.map((c) => ({ id: c, label: c }))} active={tab} onChange={setTab} />

      {tab === 'Country' && (
        <TableWrap>
          <thead><tr><th>Name</th><th>Version</th><th>Status</th><th>Instrument / reflector</th><th>Stored distance default</th>
            <th>STAR*NET adjustment</th><th>Used by</th><th>Actions</th></tr></thead>
          <tbody>
            {state.countryTemplates.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">{c.name}</td>
                <td>v{c.version}</td>
                <td><Badge tone={c.status}>{c.status}</Badge></td>
                <td className="text-2xs">{instrumentName(c.defaultInstrumentTemplateId)}<br />{prismName(c.defaultPrismSetupTemplateId)}</td>
                <td className="text-2xs">{c.prismCorrectionPolicy === 'already-applied'
                  ? 'Prism + atmosphere already corrected'
                  : `Per-target prism / ${c.defaultAtmosphericMode} atmosphere`}</td>
                <td className="text-2xs">{adjustmentName(c.defaultAdjustmentTemplateId)}</td>
                <td>{usageCell(c.id)}</td>
                <td><TemplateActions name={c.name} kind="country" /></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      {tab === 'Instrument' && (
        <TableWrap>
          <thead><tr><th>Instrument template</th><th>EDM</th><th>Dist σ (mm+ppm)</th><th>Hz/Vz σ (″)</th>
            <th>Centering (mm)</th><th>Atmospheric model</th><th>Version</th><th>Used by</th><th>Actions</th></tr></thead>
          <tbody>
            {repository.instrumentProfiles().map((p) => (
              <tr key={p.id}>
                <td className="font-medium">{p.manufacturer} {p.model}</td>
                <td>{p.edmMode}</td>
                <td>{p.distanceStdErrMm} + {p.distancePpm} ppm</td>
                <td>{p.hzAngleStdErrArcSec} / {p.vzAngleStdErrArcSec}</td>
                <td>{p.instrumentCenteringErrMm} / {p.targetCenteringErrMm} / {p.verticalCenteringErrMm}</td>
                <td className="text-2xs">{p.atmosphericModelVersion}</td>
                <td>v{p.version} <Badge tone={p.status}>{p.status}</Badge></td>
                <td>{usageCell(p.id)}</td>
                <td><TemplateActions name={p.model} kind="instrument" /></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      {tab === 'Prism Setup' && (
        <>
          <Callout tone="info">
            The effective constant belongs to the pair instrument profile / EDM mode + prism type -
            never to the prism alone. Values are stored in metres and displayed in mm.
          </Callout>
          <TableWrap>
            <thead><tr><th>Name</th><th>Instrument profile</th><th>EDM</th><th>Type</th><th>Country</th>
              <th>Effective constant (mm)</th><th>Default height (m)</th><th>Version</th><th>Used by</th><th>Actions</th></tr></thead>
            <tbody>
              {repository.prismProfiles().map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">{p.name}</td>
                  <td>{p.instrumentProfileId}</td>
                  <td>{p.edmMode}</td>
                  <td>{p.prismType}</td>
                  <td>{p.country}</td>
                  <td className="text-right">{fmtMm(p.effectiveConstantM, 1)}</td>
                  <td>{p.defaultTargetHeightM}</td>
                  <td>v{p.version} <Badge tone={p.status}>{p.status}</Badge></td>
                  <td>{usageCell(p.id)}</td>
                  <td><TemplateActions name={p.name} kind="prism" /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </>
      )}

      {tab === 'Adjustment' && state.adjustmentTemplates.map((t) => (
        <Card key={t.id} title={`${t.name} (v${t.version})`} actions={<TemplateActions name={t.name} kind="adjustment" />}>
          <KV items={[
            ['Dimension / projection', `${t.dimension} / ${t.projectionMode}`],
            ['Angle output / coordinate order', `${t.angleOutputFormat} / ${t.coordinateOrder}`],
            ['STAR*NET convergence', `${t.starNetConvergenceLimit} (unitless), max ${t.maxIterations} solution iterations`],
            ['Chi² / confidence', `α=${t.chiSquareSignificance} / ${t.confidenceLevel}`],
            ['Refraction / earth radius', `${t.refractionCoefficient} / ${t.earthRadiusM} m`],
            ['STAR*NET Auto Adjust', t.autoCorrectionEnabled
              ? `enabled: threshold ${t.starNetAutoAdjustStdResLimit}, remove ${t.starNetAutoAdjustOutliersPerIteration}/iteration, max ${t.starNetAutoAdjustMaxIterations}`
              : 'disabled'],
            ['Used by', usage(t.id).length > 0 ? `${usage(t.id).length} configuration version(s)` : 'unused'],
          ]} />
        </Card>
      ))}

      {tab === 'Run' && state.runTemplates.map((t) => (
        <Card key={t.id} title={`${t.name} (v${t.version})`} actions={<TemplateActions name={t.name} kind="run" />}>
          <KV items={[
            ['Trigger', t.triggerMode],
            ['Synchronization', `tolerance ${t.syncToleranceMin} min, reuse ≤ ${t.maxReusedAgeMin} min`],
            ['Catch-up', t.catchUpEnabled ? `window ${t.catchUpWindowH} h, max ${t.maxRecalcPerSlot}/slot` : 'disabled'],
            ['Provisional', t.markReusedProvisional ? 'reused data → provisional' : 'no marking'],
            ['Used by', usage(t.id).length > 0 ? `${usage(t.id).length} configuration version(s)` : 'unused'],
          ]} />
        </Card>
      ))}

      {tab === 'Output' && state.outputTemplates.map((t) => (
        <Card key={t.id} title={`${t.name} (v${t.version})`} actions={<TemplateActions name={t.name} kind="output" />}>
          <KV items={[
            ['Interval / alignment', `${t.outputIntervalMin} min, grid ${t.gridAlignment}`],
            ['Max epoch→slot distance', `${t.maxEpochToSlotDistanceMin} min`],
            ['Duplicates', t.duplicateStrategy],
            ['Publish provisional', t.publishProvisional ? 'yes' : 'no'],
            ['Variables', t.variables.join(', ')],
            ['Used by', usage(t.id).length > 0 ? `${usage(t.id).length} configuration version(s)` : 'unused'],
          ]} />
        </Card>
      ))}
    </div>
  );
}

function TemplateActions({ name, kind }: { name: string; kind: string }) {
  const { actions } = useApp();
  const act = (action: string) => {
    actions.logAudit('template', action, `${action} on ${kind} template "${name}" (mockup: catalog entry recorded)`);
    alert(`"${action}" recorded in the audit log for template "${name}".\n\nIn the mockup the built-in catalogs stay read-only; in BTM this would ${action === 'create-version' ? 'open a new template version editor (existing configuration versions are never modified automatically)' : `${action} the template`}.`);
  };
  return (
    <div className="flex gap-1">
      <Button size="xs" onClick={() => act('duplicate')}>Duplicate</Button>
      <Button size="xs" onClick={() => act('create-version')}>New version</Button>
      <Button size="xs" onClick={() => act('deprecate')}>Deprecate</Button>
      <Button size="xs" onClick={() => act('archive')}>Archive</Button>
    </div>
  );
}

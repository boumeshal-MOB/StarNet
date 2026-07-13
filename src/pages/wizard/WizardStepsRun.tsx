import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WizardDraft } from './wizardTypes';
import { clearDraft } from './wizardTypes';
import {
  Badge, Button, Callout, Card, Field, KV, NumberInput, Select, TableWrap, TextInput, Toggle,
} from '../../components/ui';
import { useApp } from '../../store/AppStore';
import { nextId } from '../../store/seed';
import { repository } from '../../data/repository';
import { validatePointMapping } from '../../engine/pointIdentity';
import type {
  ConfigurationVersion, OutputTemplate, OutputVariableKey, Processing, RunTemplate,
} from '../../types/domain';
import type { RunnerOutput } from '../../engine/runner';
import { fmtDateTime, fmtNum } from '../../lib/format';
import { Chi2Gauge } from '../../components/charts';

// ============================================================ Step 8 =======
export function StepRun({ draft, set }: { draft: WizardDraft; set: (p: Partial<WizardDraft>) => void }) {
  const r = draft.runPolicy;
  const patch = (p: Partial<RunTemplate>) => set({ runPolicy: { ...r, ...p } });
  const toggleReq = (id: string, required: boolean) => {
    patch({
      requiredStationIds: required
        ? [...new Set([...r.requiredStationIds, id])]
        : r.requiredStationIds.filter((x) => x !== id),
      optionalStationIds: required
        ? r.optionalStationIds.filter((x) => x !== id)
        : [...new Set([...r.optionalStationIds, id])],
    });
  };
  return (
    <div className="space-y-4">
      <Card title="Step 8 - Run Configuration / Trigger">
        <Callout tone="info">
          The trigger decides when BTM checks for data and starts a computation.
          It never defines the output variable timestamps (see step 9).
        </Callout>
        <div className="mt-3 grid grid-cols-3 gap-4">
          <Field label="Trigger mode">
            <Select value={r.triggerMode} onChange={(v) => patch({ triggerMode: v as RunTemplate['triggerMode'] })}
              options={[
                { value: 'event-driven', label: 'Event-driven (new data arrives)' },
                { value: 'schedule', label: 'Custom schedule' },
                { value: 'manual', label: 'Manual only' },
              ]} />
          </Field>
          {r.triggerMode === 'schedule' && (
            <Field label="Every" unit="min">
              <NumberInput value={r.scheduleEveryMinutes} onChange={(v) => patch({ scheduleEveryMinutes: v })} />
            </Field>
          )}
        </div>
      </Card>

      <Card title="Multi-station synchronization">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Normal synchronization tolerance" unit="min"
            hint="Example: epochs 10:25 / 10:26 / 10:32 with 10 min tolerance feed the 10:30 output.">
            <NumberInput value={r.syncToleranceMin} onChange={(v) => patch({ syncToleranceMin: v })} />
          </Field>
          <Field label="Maximum age of reused data" unit="min" hint="30 / 45 / 60 or custom.">
            <NumberInput value={r.maxReusedAgeMin} onChange={(v) => patch({ maxReusedAgeMin: v })} />
          </Field>
          <div className="space-y-2 self-end">
            <Toggle checked={r.reuseMissingStation} onChange={(v) => patch({ reuseMissingStation: v })}
              label="Reuse the last data of a missing station" />
            <Toggle checked={r.computeWithoutOptional} onChange={(v) => patch({ computeWithoutOptional: v })}
              label="Compute without an optional station if geometry stays valid" />
            <Toggle checked={r.markReusedProvisional} onChange={(v) => patch({ markReusedProvisional: v })}
              label="Mark the result provisional when data is reused / missing" />
          </div>
        </div>
        <div className="mt-3">
          <div className="mb-1 text-xs font-semibold text-slate-600">Stations required / optional</div>
          <div className="flex gap-4">
            {draft.stationIds.map((id) => (
              <label key={id} className="flex items-center gap-2 text-xs">
                <span className="font-medium">{id}</span>
                <Select value={r.requiredStationIds.includes(id) ? 'required' : 'optional'}
                  onChange={(v) => toggleReq(id, v === 'required')}
                  options={[{ value: 'required', label: 'Required' }, { value: 'optional', label: 'Optional' }]} />
              </label>
            ))}
          </div>
        </div>
      </Card>

      <Card title="Catch-up">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Automatic catch-up">
            <Toggle checked={r.catchUpEnabled} onChange={(v) => patch({ catchUpEnabled: v })}
              label={r.catchUpEnabled ? 'Enabled' : 'Disabled'} />
          </Field>
          <Field label="Catch-up window" unit="h">
            <NumberInput value={r.catchUpWindowH} onChange={(v) => patch({ catchUpWindowH: v })} />
          </Field>
          <Field label="Max recalculations per output slot">
            <NumberInput value={r.maxRecalcPerSlot} onChange={(v) => patch({ maxRecalcPerSlot: v })} />
          </Field>
          <div className="col-span-3 flex flex-wrap gap-6">
            <Toggle checked={r.catchUpOnLateObservation} onChange={(v) => patch({ catchUpOnLateObservation: v })}
              label="Trigger on late station observation" />
            <Toggle checked={r.catchUpOnLateEnvironmental} onChange={(v) => patch({ catchUpOnLateEnvironmental: v })}
              label="Trigger on late temperature / pressure" />
            <Toggle checked={r.replaceOnlyIfQualityImproves} onChange={(v) => patch({ replaceOnlyIfQualityImproves: v })}
              label="Replace current published version only if quality improves" />
          </div>
          <Callout tone="info">Every previous result version is always kept - replacement only changes which version is "current".</Callout>
        </div>
      </Card>
    </div>
  );
}

// ============================================================ Step 9 =======
const ALL_VARS: OutputVariableKey[] = ['easting', 'northing', 'height', 'dE', 'dN', 'dH',
  'horizontalDisplacement', 'displacement3D', 'sigmaE', 'sigmaN', 'sigmaH', 'qualityStatus', 'provisionalStatus'];

export function StepOutput({ draft, set }: { draft: WizardDraft; set: (p: Partial<WizardDraft>) => void }) {
  const o = draft.outputPolicy;
  const patch = (p: Partial<OutputTemplate>) => set({ outputPolicy: { ...o, ...p } });
  return (
    <Card title="Step 9 - Output Configuration">
      <Callout tone="info">
        The output frequency is independent from source timestamps and from the trigger.
        For a 30 min interval, published timestamps are exactly 10:00, 10:30, 11:00...
        Source epochs (10:25, 10:26, 10:32) stay preserved in the audit.
      </Callout>
      <div className="mt-3 grid grid-cols-3 gap-4">
        <Field label="Output interval">
          <Select value={String(o.outputIntervalMin)} onChange={(v) => patch({ outputIntervalMin: Number(v) })}
            options={[{ value: '30', label: '30 minutes (00/30 grid)' }, { value: '60', label: '1 hour' },
              { value: '15', label: '15 minutes (custom)' }, { value: '120', label: '2 hours (custom)' }]} />
        </Field>
        <Field label="Max distance epoch → slot" unit="min">
          <NumberInput value={o.maxEpochToSlotDistanceMin} onChange={(v) => patch({ maxEpochToSlotDistanceMin: v })} />
        </Field>
        <Field label="Duplicate strategy">
          <Select value={o.duplicateStrategy} onChange={(v) => patch({ duplicateStrategy: v as OutputTemplate['duplicateStrategy'] })}
            options={[{ value: 'new-version', label: 'Create a new result version' }, { value: 'keep-first', label: 'Keep the first result' }]} />
        </Field>
        <Field label="Late-data closing delay" unit="min">
          <NumberInput value={o.lateDataClosingDelayMin} onChange={(v) => patch({ lateDataClosingDelayMin: v })} />
        </Field>
        <Field label="Publish provisional results">
          <Toggle checked={o.publishProvisional} onChange={(v) => patch({ publishProvisional: v })}
            label={o.publishProvisional ? 'Yes' : 'No'} />
        </Field>
      </div>
      <div className="mt-4">
        <div className="mb-1 text-xs font-semibold text-slate-600">Variables created per published target</div>
        <div className="grid grid-cols-4 gap-2">
          {ALL_VARS.map((v) => (
            <label key={v} className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={o.variables.includes(v)}
                onChange={(e) => patch({
                  variables: e.target.checked ? [...o.variables, v] : o.variables.filter((x) => x !== v),
                })} />
              {v}
            </label>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ============================================================ Step 10 ======
export function StepReview({ draft, set }: { draft: WizardDraft; set: (p: Partial<WizardDraft>) => void }) {
  const { state, actions } = useApp();
  const nav = useNavigate();
  const [test, setTest] = useState<{ output: RunnerOutput; slotIso: string } | null>(null);
  const [validated, setValidated] = useState<string[] | null>(null);

  const blockers: string[] = [];
  if (!draft.name.trim()) blockers.push('Missing processing name');
  if (draft.stationIds.length === 0) blockers.push('No station selected');
  if (!draft.selectedRefSetId) blockers.push('No reference set selected');
  if (!draft.provisionalSaved) blockers.push('Provisional coordinates not saved');
  if (draft.targets.filter((t) => t.includeInAdjustment).length === 0) blockers.push('No target included in the adjustment');
  const warnings: string[] = [];
  const nomIssues = draft.targets.flatMap((t) => t.nomenclatureIssues);
  if (nomIssues.length) warnings.push(`${nomIssues.length} nomenclature issue(s) in target names`);
  if (draft.targets.some((t) => t.reviewStatus === 'to-review')) warnings.push('Some targets are still "To review" (excluded by default)');
  // point-identity pre-run checks (blocking / confirm / suggestion / warning)
  const mappingIssues = validatePointMapping({
    stations: draft.stations, targets: draft.targets, physicalPoints: draft.physicalPoints,
  } as never);
  for (const i of mappingIssues) {
    if (i.level === 'blocking') blockers.push(`Point mapping: ${i.message}`);
    else warnings.push(`Point mapping (${i.level}): ${i.message}`);
  }

  const buildEntities = (): { processing: Processing; config: ConfigurationVersion } => {
    const procId = nextId('proc');
    const refSets = draft.refSets.map((r) => ({ ...r, processingId: procId, id: r.id.replace('wizard-tmp', procId) }));
    const selectedRefSet = refSets.find((r) => r.id === draft.selectedRefSetId.replace('wizard-tmp', procId))!;
    const config: ConfigurationVersion = {
      id: nextId('config'),
      processingId: procId,
      versionNumber: 1,
      label: 'V1 - Initial configuration',
      description: draft.description || 'Created by the processing wizard',
      validFrom: selectedRefSet.validFrom,
      validTo: undefined,
      status: draft.activeAfterCreation ? 'active' : 'draft',
      usedByRun: false,
      createdAt: new Date().toISOString(),
      createdBy: state.user,
      stations: draft.stations,
      prismSetups: draft.setups,
      targets: draft.targets,
      physicalPoints: draft.physicalPoints,
      geometricRelationships: draft.geometricRelationships,
      referenceSetId: selectedRefSet.id,
      provisionalCoordinates: draft.provisional,
      adjustment: draft.adjustment,
      runPolicy: draft.runPolicy,
      outputPolicy: draft.outputPolicy,
      templateOrigins: {
        countryTemplateId: draft.countryTemplateId,
        adjustmentTemplateId: draft.adjustment.id,
        runTemplateId: draft.runPolicy.id,
        outputTemplateId: draft.outputPolicy.id,
        overriddenFields: draft.targets.filter((t) => t.source === 'manual-override').map((t) => `target.${t.rawName}`),
      },
    };
    const processing: Processing = {
      id: procId,
      name: draft.name,
      type: 'Topographic Adjustment',
      project: draft.project || repository.project().project,
      site: draft.site || repository.project().site,
      network: repository.project().network,
      description: draft.description,
      mode: draft.mode,
      status: draft.activeAfterCreation ? 'Ready' : 'Draft',
      active: draft.activeAfterCreation,
      createdAt: new Date().toISOString(),
      createdBy: state.user,
      networkKind: draft.networkKind,
      configurationVersionIds: [config.id],
      activeConfigurationVersionId: config.id,
    };
    return { processing, config };
  };

  const runTest = async () => {
    const { config } = buildEntities();
    // test uses the wizard's in-memory reference sets
    const refSet = draft.refSets.find((r) => r.id === draft.selectedRefSetId)!;
    const res = await actions.runDraftTest({ ...config, referenceSetId: refSet.id }, refSet);
    setTest(res);
  };

  const create = () => {
    const { processing, config } = buildEntities();
    const refSets = draft.refSets.map((r) => ({
      ...r,
      processingId: processing.id,
      id: r.id.replace('wizard-tmp', processing.id),
    }));
    actions.createProcessing(processing, {
      ...config,
      referenceSetId: config.referenceSetId,
    }, refSets);
    clearDraft();
    nav(`/processings/${processing.id}`);
  };

  const q = test?.output.attempts[test.output.finalAttempt]?.quality;

  return (
    <div className="space-y-4">
      <Card title="Step 10 - Review, Test and Create">
        <div className="grid grid-cols-2 gap-6">
          <KV items={[
            ['Name', draft.name || '-'],
            ['Network', `${draft.networkKind} (${draft.stationIds.join(', ')})`],
            ['Targets', `${draft.targets.length} mapped / ${draft.targets.filter((t) => t.includeInAdjustment).length} included`],
            ['References', draft.refSets.find((r) => r.id === draft.selectedRefSetId)?.name ?? '-'],
            ['Provisional coordinates', `${draft.provisional.length} target(s) ${draft.provisionalSaved ? '(saved)' : '(NOT saved)'}`],
            ['Templates', `${draft.countryTemplateId} / ${draft.adjustment.name}`],
            ['Overrides', String(draft.targets.filter((t) => t.source === 'manual-override').length)],
          ]} />
          <KV items={[
            ['Validity', `from ${draft.refSets.find((r) => r.id === draft.selectedRefSetId)?.validFrom.slice(0, 10) ?? '-'} (open-ended)`],
            ['Run policy', `${draft.runPolicy.triggerMode}, sync ${draft.runPolicy.syncToleranceMin} min, reuse ≤ ${draft.runPolicy.maxReusedAgeMin} min`],
            ['Catch-up', draft.runPolicy.catchUpEnabled ? `enabled (${draft.runPolicy.catchUpWindowH} h window, max ${draft.runPolicy.maxRecalcPerSlot}/slot)` : 'disabled'],
            ['Output policy', `${draft.outputPolicy.outputIntervalMin} min grid, ${draft.outputPolicy.variables.length} variables`],
            ['Quality', `Chi² α=${draft.adjustment.chiSquareSignificance}, confidence ${draft.adjustment.confidenceLevel}, stdres ≤ ${draft.adjustment.stdResThreshold}`],
            ['Auto-correction', draft.adjustment.autoCorrectionEnabled ? `max ${draft.adjustment.maxAutoCorrectionAttempts} attempts` : 'disabled'],
          ]} />
        </div>
        <div className="mt-4 space-y-1">
          {blockers.map((b, i) => <Callout key={i} tone="error">Blocking: {b}</Callout>)}
          {warnings.map((w, i) => <Callout key={i} tone="warning">{w}</Callout>)}
          {validated && blockers.length === 0 && (
            <Callout tone="success">Configuration validated{validated.length ? ` with ${validated.length} warning(s)` : ' without warnings'}.</Callout>
          )}
        </div>
        <div className="mt-4 flex gap-2">
          <Button onClick={() => alert('Draft is saved automatically at every change.')}>Save draft</Button>
          <Button onClick={() => setValidated(warnings)}>Validate configuration</Button>
          <Button onClick={runTest} disabled={blockers.length > 0}>Run test adjustment</Button>
          <Button variant="primary" onClick={create} disabled={blockers.length > 0}>
            {draft.activeAfterCreation ? 'Create and activate' : 'Create as draft'}
          </Button>
        </div>
      </Card>

      {test && q && (
        <Card title={`Test adjustment - slot ${fmtDateTime(test.slotIso)} (not persisted)`}>
          <div className="grid grid-cols-4 gap-4 text-xs">
            <KV items={[
              ['Status', <Badge key="s" tone={q.chiSquarePassed ? 'Success' : 'Failed quality control'}>
                {q.chiSquarePassed ? 'Chi² PASSED' : 'Chi² FAILED'}</Badge>],
              ['Converged', `${q.converged} (${q.iterations} iterations)`],
              ['Observations', `${q.nObservations} + ${q.nConstraints} constraints`],
              ['Degrees of freedom', String(q.degreesOfFreedom)],
            ]} />
            <KV items={[
              ['Total error factor', fmtNum(q.totalErrorFactor)],
              ['Max std residual', fmtNum(q.maxStdResidual)],
              ['Max ellipse', `${(q.maxEllipseSemiMajorM * 1000).toFixed(2)} mm`],
              ['Warnings', String(q.warnings.length)],
            ]} />
            <div className="col-span-2"><Chi2Gauge value={q.chiSquareValue} lower={q.chiSquareLower} upper={q.chiSquareUpper} /></div>
          </div>
          {q.warnings.length > 0 && (
            <div className="mt-2 space-y-1">{q.warnings.map((w, i) => <Callout key={i} tone="warning">{w}</Callout>)}</div>
          )}
        </Card>
      )}
    </div>
  );
}

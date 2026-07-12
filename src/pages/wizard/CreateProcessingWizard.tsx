import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../store/AppStore';
import {
  Badge, Button, Callout, Card, Field, KV, NumberInput, Select, Stepper,
  TableWrap, TextInput, Toggle,
} from '../../components/ui';
import { repository } from '../../data/repository';
import { fmtDateTime } from '../../lib/format';
import {
  WIZARD_STEPS, type WizardDraft, defaultDraft, loadDraft, saveDraft,
} from './wizardTypes';
import { buildStations, buildTargetsAndSetups } from '../../store/seed';
import { StepTargets, StepReferences } from './WizardStepsTargets';
import { StepInitial, StepAdjustment } from './WizardStepsCompute';
import { StepRun, StepOutput, StepReview } from './WizardStepsRun';

export function CreateProcessingWizard() {
  const [draft, setDraft] = useState<WizardDraft>(() => loadDraft() ?? defaultDraft());
  const [resumed] = useState(() => loadDraft() !== null);

  useEffect(() => { saveDraft(draft); }, [draft]);

  const set = (patch: Partial<WizardDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const goto = (i: number) => set({ step: i, maxReached: Math.max(draft.maxReached, i) });

  const stepValid = useMemo(() => validateStep(draft), [draft]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-bold">Create processing</h1>
          <p className="text-xs text-slate-500">Topographic Adjustment - draft is saved automatically at every change.</p>
        </div>
        <Button variant="ghost" size="xs" onClick={() => setDraft(defaultDraft())}>Discard draft</Button>
      </div>
      {resumed && draft.step > 0 && (
        <Callout tone="info">Draft resumed from your previous session (auto-saved).</Callout>
      )}
      <Stepper steps={WIZARD_STEPS} current={draft.step} maxReached={draft.maxReached} onGoto={goto} />

      <div className="max-w-6xl">
        {draft.step === 0 && <Step1 draft={draft} set={set} />}
        {draft.step === 1 && <Step2 draft={draft} set={set} />}
        {draft.step === 2 && <Step3 draft={draft} set={set} />}
        {draft.step === 3 && <StepTargets draft={draft} set={set} />}
        {draft.step === 4 && <StepReferences draft={draft} set={set} />}
        {draft.step === 5 && <StepInitial draft={draft} set={set} />}
        {draft.step === 6 && <StepAdjustment draft={draft} set={set} />}
        {draft.step === 7 && <StepRun draft={draft} set={set} />}
        {draft.step === 8 && <StepOutput draft={draft} set={set} />}
        {draft.step === 9 && <StepReview draft={draft} set={set} />}
      </div>

      <div className="flex items-center gap-2 border-t border-slate-200 pt-4">
        <Button disabled={draft.step === 0} onClick={() => goto(draft.step - 1)}>← Back</Button>
        {draft.step < WIZARD_STEPS.length - 1 && (
          <Button variant="primary" disabled={!stepValid.ok}
            onClick={() => {
              const d2 = prepareNextStep(draft);
              setDraft({ ...d2, step: draft.step + 1, maxReached: Math.max(draft.maxReached, draft.step + 1) });
            }}>
            Continue →
          </Button>
        )}
        {!stepValid.ok && <span className="text-2xs text-rose-600">{stepValid.reason}</span>}
        <span className="ml-auto text-2xs text-slate-400">Step {draft.step + 1} / {WIZARD_STEPS.length}</span>
      </div>
    </div>
  );
}

function validateStep(d: WizardDraft): { ok: boolean; reason?: string } {
  switch (d.step) {
    case 0:
      return d.name.trim() ? { ok: true } : { ok: false, reason: 'Processing name is required' };
    case 1:
      if (d.stationIds.length === 0) return { ok: false, reason: 'Select at least one station' };
      if (d.networkKind === 'single-station' && d.stationIds.length > 1) {
        return { ok: false, reason: 'Single station mode allows exactly one station' };
      }
      return { ok: true };
    case 4:
      return d.selectedRefSetId ? { ok: true } : { ok: false, reason: 'Select a reference set' };
    case 5:
      return d.provisionalSaved ? { ok: true } : { ok: false, reason: 'Compute and save provisional coordinates first' };
    default:
      return { ok: true };
  }
}

/** materialize dependent entities when leaving a step */
function prepareNextStep(d: WizardDraft): WizardDraft {
  if (d.step === 1) {
    // (re)build stations / targets / setups / reference sets when the
    // station selection changed
    const sameStations = d.stations.length === d.stationIds.length
      && d.stations.every((s) => d.stationIds.includes(s.id));
    if (!sameStations) {
      const stations = buildStations(d.stationIds);
      // scope the header rows to the selected network (real vs synthetic)
      const real = repository.realProject();
      const isReal = real ? d.stationIds.includes(real.stationId) : false;
      const realPointIds = new Set(real?.header.map((h) => h.PointId) ?? []);
      const refIds = isReal ? new Set(real?.referenceIds ?? []) : undefined;
      const { targets, setups, physicalPoints } = buildTargetsAndSetups(d.stationIds, refIds);
      const procId = 'wizard-tmp';
      const refSets = repository.referenceSetsFromHeader(procId, 'wizard',
        (id) => (isReal ? realPointIds.has(id) : id.startsWith('REF')));
      // default initialization window = first cycles of the selected stations
      const epochs = repository.observations()
        .filter((o) => d.stationIds.includes(o.stationId))
        .map((o) => new Date(o.epoch).getTime());
      const first = epochs.length ? Math.min(...epochs) : Date.now();
      return {
        ...d, stations, targets, setups, physicalPoints, refSets,
        selectedRefSetId: refSets[0]?.id ?? '',
        provisional: [], provisionalSaved: false,
        initWindowFrom: new Date(first - 60000).toISOString().slice(0, 16),
        initWindowTo: new Date(first + 2 * 3600000).toISOString().slice(0, 16),
      };
    }
  }
  return d;
}

// =============================================================== Step 1 ====
function Step1({ draft, set }: { draft: WizardDraft; set: (p: Partial<WizardDraft>) => void }) {
  const { state } = useApp();
  const proj = repository.project();
  return (
    <Card title="Step 1 - General Information">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Processing type">
          <TextInput value="Topographic Adjustment" disabled />
        </Field>
        <Field label="Processing name" hint="Displayed in the processing list and audit log.">
          <TextInput value={draft.name} onChange={(e) => set({ name: e.target.value })}
            placeholder="e.g. NTE ATS34 - Network adjustment" />
        </Field>
        <Field label="Project">
          <Select value={draft.project || proj.project} onChange={(v) => set({ project: v })}
            options={[{ value: proj.project, label: proj.project }]} />
        </Field>
        <Field label="Site">
          <Select value={draft.site || proj.site} onChange={(v) => set({ site: v })}
            options={[{ value: proj.site, label: proj.site }]} />
        </Field>
        <Field label="Description">
          <TextInput value={draft.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <Field label="Country template" hint="Pre-fills units, thresholds, instrument and prism catalogs. Editable defaults, not national standards.">
          <Select value={draft.countryTemplateId} onChange={(v) => set({ countryTemplateId: v })}
            options={state.countryTemplates.map((c) => ({ value: c.id, label: c.name }))} />
        </Field>
        <Field label="Interface mode" hint="Standard shows the main parameters; Expert exposes weighting, centering and auto-correction details.">
          <Select value={draft.mode} onChange={(v) => set({ mode: v as WizardDraft['mode'] })}
            options={[{ value: 'standard', label: 'Standard mode' }, { value: 'expert', label: 'Expert mode' }]} />
        </Field>
        <Field label="Active after creation">
          <Toggle checked={draft.activeAfterCreation} onChange={(v) => set({ activeAfterCreation: v })}
            label={draft.activeAfterCreation ? 'Yes - runs can trigger immediately' : 'No - created as inactive'} />
        </Field>
      </div>
    </Card>
  );
}

// =============================================================== Step 2 ====
function Step2({ draft, set }: { draft: WizardDraft; set: (p: Partial<WizardDraft>) => void }) {
  const proj = repository.project();
  const stations = repository.stationSummaries();
  const toggleStation = (id: string) => {
    const has = draft.stationIds.includes(id);
    const next = has ? draft.stationIds.filter((x) => x !== id)
      : draft.networkKind === 'single-station' ? [id] : [...draft.stationIds, id];
    set({ stationIds: next });
  };
  return (
    <div className="space-y-4">
      <Card title="Step 2 - Data Source and Network">
        <Callout tone="info">
          Observations are already stored in the BTM database. Select the project data
          and the stations to include - no file, sheet or column mapping is involved.
        </Callout>
        <div className="mt-4 grid grid-cols-2 gap-6">
          <KV items={[
            ['Project', proj.project],
            ['Site', proj.site],
            ['Network', proj.network],
            ['Stations available in BTM', String(stations.length)],
            ['Observation period', `${fmtDateTime(proj.coverage.from)} → ${fmtDateTime(proj.coverage.to)}`],
            ['Last observation', fmtDateTime(proj.lastEpoch)],
            ['Raw observations', String(proj.observationCount)],
            ['Targets observed', String(proj.targetCount)],
            ['Available variables', proj.variables.join(', ')],
            ['Metadata quality', 'Complete (lookup + header block present)'],
          ]} />
          <div>
            <Field label="Network type">
              <Select value={draft.networkKind}
                onChange={(v) => set({ networkKind: v as WizardDraft['networkKind'], stationIds: v === 'single-station' ? draft.stationIds.slice(0, 1) : draft.stationIds })}
                options={[
                  { value: 'single-station', label: 'Single station' },
                  { value: 'multi-station', label: 'Multi-station network' },
                ]} />
            </Field>
          </div>
        </div>
      </Card>
      <Card title="Stations available in BTM">
        <TableWrap>
          <thead>
            <tr><th></th><th>Station</th><th>Last observation</th><th>Targets</th><th>Estimated cycle</th><th>Environmental data</th><th>Readiness</th></tr>
          </thead>
          <tbody>
            {stations.map((s) => (
              <tr key={s.id} className="cursor-pointer" onClick={() => toggleStation(s.id)}>
                <td><input type="checkbox" readOnly checked={draft.stationIds.includes(s.id)} /></td>
                <td className="font-medium">{s.id}</td>
                <td>{fmtDateTime(s.lastObservation)}</td>
                <td>{s.targetCount}</td>
                <td>{s.estimatedCycleMin} min</td>
                <td>{s.environmentalData ? <Badge tone="Success">T / P available</Badge> : <Badge tone="Provisional">none</Badge>}</td>
                <td><Badge tone={s.readiness}>{s.readiness}</Badge></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

// =============================================================== Step 3 ====
function Step3({ draft, set }: { draft: WizardDraft; set: (p: Partial<WizardDraft>) => void }) {
  const instruments = repository.instrumentProfiles();
  const patchStation = (id: string, p: Partial<WizardDraft['stations'][number]>) =>
    set({ stations: draft.stations.map((s) => (s.id === id ? { ...s, ...p } : s)) });

  return (
    <div className="space-y-4">
      {draft.stations.map((s) => (
        <Card key={s.id} title={`Station ${s.id} - Instrument and distance corrections`}>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Instrument template">
              <Select value={s.instrumentProfileId}
                onChange={(v) => patchStation(s.id, { instrumentProfileId: v })}
                options={instruments.map((i) => ({ value: i.id, label: `${i.manufacturer} ${i.model}` }))} />
            </Field>
            <Field label="EDM mode">
              <Select value={s.edmMode} onChange={(v) => patchStation(s.id, { edmMode: v })}
                options={[{ value: 'Precise + Reflector', label: 'Precise + Reflector' },
                  { value: 'Standard + Reflector', label: 'Standard + Reflector' }]} />
            </Field>
            <Field label="Instrument height" unit="m">
              <NumberInput value={s.instrumentHeightM} step={0.001}
                onChange={(v) => patchStation(s.id, { instrumentHeightM: v })} />
            </Field>
            <Field label="Validity from">
              <TextInput type="datetime-local" value={s.validFrom.slice(0, 16)}
                onChange={(e) => patchStation(s.id, { validFrom: new Date(e.target.value + 'Z').toISOString() })} />
            </Field>
            <Field label="Distance state" hint="What the station already applied to stored distances.">
              <Select value={s.distanceState}
                onChange={(v) => patchStation(s.id, { distanceState: v as typeof s.distanceState })}
                options={[
                  { value: 'raw', label: 'Raw - no correction applied' },
                  { value: 'prism-corrected', label: 'Prism corrected by station' },
                  { value: 'atmo-corrected', label: 'Atmospherically corrected by station' },
                  { value: 'fully-corrected', label: 'Fully corrected by station' },
                  { value: 'unknown', label: 'Unknown / user assumption' },
                ]} />
            </Field>
            <Field label="Constant applied by station" unit="mm" hint="Field constant already added by the RTS firmware.">
              <NumberInput value={s.constantAppliedByStationM * 1000} step={0.1}
                onChange={(v) => patchStation(s.id, { constantAppliedByStationM: v / 1000 })} />
            </Field>
          </div>
          <div className="mt-4 rounded-md bg-slate-50 p-3">
            <div className="mb-2 text-xs font-semibold text-slate-600">Atmospheric correction</div>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Mode">
                <Select value={s.atmosphericMode}
                  onChange={(v) => patchStation(s.id, { atmosphericMode: v as typeof s.atmosphericMode })}
                  options={[
                    { value: 'automatic', label: 'Automatic for each station and cycle' },
                    { value: 'station-corrected', label: 'Already corrected by station' },
                    { value: 'none', label: 'No correction' },
                    { value: 'defaults', label: 'Use configured default T / P' },
                  ]} />
              </Field>
              {s.atmosphericMode === 'automatic' && (
                <>
                  <Field label="Temperature variable">
                    <Select value={s.temperatureVariable ?? ''} onChange={(v) => patchStation(s.id, { temperatureVariable: v })}
                      options={[{ value: `${s.id}.Temperature`, label: `${s.id}.Temperature` }]} />
                  </Field>
                  <Field label="Pressure variable">
                    <Select value={s.pressureVariable ?? ''} onChange={(v) => patchStation(s.id, { pressureVariable: v })}
                      options={[{ value: `${s.id}.Pressure`, label: `${s.id}.Pressure` }]} />
                  </Field>
                  <Field label="Temporal tolerance" unit="min" hint="Max age of T/P vs the station epoch.">
                    <NumberInput value={s.envToleranceMin} onChange={(v) => patchStation(s.id, { envToleranceMin: v })} />
                  </Field>
                  <Field label="If T/P missing">
                    <Select value={s.missingEnvPolicy}
                      onChange={(v) => patchStation(s.id, { missingEnvPolicy: v as typeof s.missingEnvPolicy })}
                      options={[
                        { value: 'raw-with-warning', label: 'Use raw distance with warning' },
                        { value: 'assume-corrected', label: 'Assume already corrected' },
                        { value: 'use-defaults', label: 'Use configured defaults' },
                        { value: 'wait-for-late-data', label: 'Wait for late environmental data (provisional)' },
                        { value: 'fail-run', label: 'Fail the run' },
                      ]} />
                  </Field>
                </>
              )}
              {(s.atmosphericMode === 'defaults' || s.atmosphericMode === 'automatic') && (
                <>
                  <Field label="Default temperature" unit="degC">
                    <NumberInput value={s.defaultTemperatureC} onChange={(v) => patchStation(s.id, { defaultTemperatureC: v })} />
                  </Field>
                  <Field label="Default pressure" unit="hPa">
                    <NumberInput value={s.defaultPressureHPa} onChange={(v) => patchStation(s.id, { defaultPressureHPa: v })} />
                  </Field>
                </>
              )}
            </div>
            <p className="mt-2 text-2xs text-slate-500">
              Correction chain (traced per observation): distanceAfterPrism = storedDistance + prismDelta →
              distanceAfterAtmosphere = distanceAfterPrism × atmosphericScale(T, P) → × grid/datum factor.
              PPM formula and sign belong to the instrument profile version and are recorded in every run snapshot.
            </p>
          </div>
        </Card>
      ))}
    </div>
  );
}

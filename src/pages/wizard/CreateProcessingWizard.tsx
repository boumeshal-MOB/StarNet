import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../store/AppStore';
import {
  Badge, Button, Callout, Card, Field, NumberInput, Select, Stepper,
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
  const progress = Math.round(((draft.step + 1) / WIZARD_STEPS.length) * 100);

  return (
    <div className="space-y-5 pb-20">
      <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-brand-950 p-6 text-white shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 text-2xs font-semibold uppercase tracking-[0.18em] text-brand-300">New topographic adjustment</div>
            <h1 className="text-2xl font-bold tracking-tight">Create a processing</h1>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-300">
              Configure the network, point identities, adjustment and execution policy. Technical settings remain available in Advanced options.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="Success">Draft saved</Badge>
            {draft.stationIds.length > 0 && <Badge>{draft.stationIds.length} station(s)</Badge>}
            <Button variant="secondary" size="xs" onClick={() => setDraft(defaultDraft())}>Discard draft</Button>
          </div>
        </div>
        <div className="mt-5 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-brand-400 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <span className="text-2xs font-medium text-slate-300">{progress}%</span>
        </div>
      </div>
      {resumed && draft.step > 0 && (
        <Callout tone="info">Draft resumed from your previous session (auto-saved).</Callout>
      )}
      <Stepper steps={WIZARD_STEPS} current={draft.step} maxReached={draft.maxReached} onGoto={goto} />

      <div>
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

      <div className="fixed bottom-0 left-60 right-0 z-20 flex items-center gap-2 border-t border-slate-200 bg-white/95 px-7 py-3 shadow-[0_-8px_24px_rgba(15,23,42,0.06)] backdrop-blur xl:px-9">
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
        <span className="ml-auto text-2xs text-slate-500">
          <strong className="text-slate-700">{WIZARD_STEPS[draft.step]}</strong> · Step {draft.step + 1} / {WIZARD_STEPS.length}
        </span>
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
      const importedRefSets = repository.referenceSetsFromHeader(procId, 'wizard',
        (id) => (isReal ? realPointIds.has(id) : id.startsWith('REF')));
      // default initialization window = first cycles of the selected stations
      const epochs = repository.observations()
        .filter((o) => d.stationIds.includes(o.stationId))
        .map((o) => new Date(o.epoch).getTime());
      const first = epochs.length ? Math.min(...epochs) : Date.now();
      const localDatumSet = {
        id: 'wizard-local-datum',
        processingId: procId,
        name: 'Local datum — fixed anchor only',
        version: Math.max(0, ...importedRefSets.map((item) => item.version)) + 1,
        points: [],
        validFrom: new Date(first).toISOString(),
        activeInVersion: false,
        usedByRun: false,
        createdAt: new Date().toISOString(),
        createdBy: 'wizard',
        comment: 'No external reference coordinates; datum fixed by the selected anchor station.',
      };
      const refSets = [...importedRefSets, localDatumSet];
      return {
        ...d, stations, targets, setups, physicalPoints, refSets,
        selectedRefSetId: importedRefSets[0]?.id ?? localDatumSet.id,
        initAnchorStationId: stations[0]?.id ?? '',
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
    <Card title="Step 1 - General information">
      <Callout tone="info">
        Start with the essential information. Templates pre-fill safe defaults; every specialised setting remains accessible later under <strong>Advanced options</strong>.
      </Callout>
      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Field label="Processing type">
          <TextInput value="Topographic Adjustment" disabled />
        </Field>
        <Field label="Processing name" hint="Displayed in the processing list and audit log.">
          <TextInput value={draft.name} onChange={(e) => set({ name: e.target.value })}
            placeholder="e.g. NTE ATS34 - Network adjustment" />
        </Field>
        <Field label="Site">
          <Select value={draft.site || proj.site} onChange={(v) => set({ site: v })}
            options={[{ value: proj.site, label: proj.site }]} />
        </Field>
        <Field label="Adjustment type" hint="Choose whether the processing adjusts one station or a complete network.">
          <Select value={draft.networkKind}
            onChange={(v) => set({
              networkKind: v as WizardDraft['networkKind'],
              stationIds: v === 'single-station' ? draft.stationIds.slice(0, 1) : draft.stationIds,
            })}
            options={[
              { value: 'single-station', label: 'Single station adjustment' },
              { value: 'multi-station', label: 'Multi-station network adjustment' },
            ]} />
        </Field>
        <Field label="Description">
          <TextInput value={draft.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <Field label="Country template" hint="Pre-fills units, thresholds, instrument and prism catalogs. Editable defaults, not national standards.">
          <Select value={draft.countryTemplateId} onChange={(v) => set({ countryTemplateId: v })}
            options={state.countryTemplates.map((c) => ({ value: c.id, label: c.name }))} />
        </Field>
        <Field label="Active after creation">
          <Toggle checked={draft.activeAfterCreation} onChange={(v) => set({ activeAfterCreation: v })}
            label={draft.activeAfterCreation ? 'Yes - runs can trigger immediately' : 'No - created as inactive'} />
        </Field>
      </div>

      <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-slate-800">BTM data overview</div>
            <div className="text-2xs text-slate-500">Read-only information from the current project database.</div>
          </div>
          <Badge tone="Success">Metadata complete</Badge>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3 xl:grid-cols-6">
          <CompactInfo label="Observation period" value={`${fmtDateTime(proj.coverage.from)} → ${fmtDateTime(proj.coverage.to)}`} wide />
          <CompactInfo label="Last observation" value={fmtDateTime(proj.lastEpoch)} />
          <CompactInfo label="Raw observations" value={proj.observationCount.toLocaleString()} />
          <CompactInfo label="Targets observed" value={String(proj.targetCount)} />
          <CompactInfo label="Available variables" value={proj.variables.join(', ')} wide />
          <CompactInfo label="Metadata quality" value="Lookup + header block available" wide />
        </div>
      </div>
    </Card>
  );
}

function CompactInfo({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 truncate text-xs font-medium text-slate-700" title={value}>{value}</div>
    </div>
  );
}

// =============================================================== Step 2 ====
function Step2({ draft, set }: { draft: WizardDraft; set: (p: Partial<WizardDraft>) => void }) {
  const stations = repository.stationSummaries();
  const toggleStation = (id: string) => {
    const has = draft.stationIds.includes(id);
    const next = has ? draft.stationIds.filter((x) => x !== id)
      : draft.networkKind === 'single-station' ? [id] : [...draft.stationIds, id];
    set({ stationIds: next });
  };
  return (
    <Card title="Step 2 - Stations available in BTM"
      actions={<Badge tone={draft.stationIds.length > 0 ? 'Ready' : 'Draft'}>{draft.stationIds.length} selected / {stations.length}</Badge>}>
        <p className="mb-4 text-xs text-slate-500">
          Select {draft.networkKind === 'single-station' ? 'the station' : 'the stations'} to include in this adjustment.
        </p>
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

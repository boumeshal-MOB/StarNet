import React, { useMemo, useState } from 'react';
import type { WizardDraft } from './wizardTypes';
import { nomenclatureIssues } from './wizardTypes';
import {
  Badge, Button, Callout, Card, Drawer, Field, NumberInput, Select, TableWrap,
  TextInput, Toggle,
} from '../../components/ui';
import { repository } from '../../data/repository';
import { fmtMm } from '../../lib/format';
import type { GeometricRelationship, ReferencePoint, TargetMapping } from '../../types/domain';
import { PointIdentityPanel } from '../../components/PointIdentityPanel';
import { resolveEngineName, targetSourceKey } from '../../engine/pointIdentity';
import { COUNTRY_TEMPLATES } from '../../data/templates';

// ============================================================ Step 4 =======
export function StepTargets({ draft, set }: { draft: WizardDraft; set: (p: Partial<WizardDraft>) => void }) {
  const [filterStation, setFilterStation] = useState('all');
  const [filterRole, setFilterRole] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const allPrisms = repository.prismProfiles();
  const country = COUNTRY_TEMPLATES.find((item) => item.id === draft.countryTemplateId)
    ?? COUNTRY_TEMPLATES[0];
  const catalogIds = new Set(country.prismSetupTemplateIds);
  const usedIds = new Set(draft.targets.map((target) => target.prismProfileId));
  const prisms = allPrisms.filter((prism) => catalogIds.has(prism.id) || usedIds.has(prism.id));
  const countryDefaultPrism = allPrisms.find((prism) =>
    prism.id === country.defaultPrismSetupTemplateId) ?? prisms[0];
  const appliedByDefault = (effectiveConstantM: number) =>
    country.prismCorrectionPolicy === 'already-applied' ? effectiveConstantM : 0;

  const patchTarget = (id: string, p: Partial<TargetMapping>) => {
    const current = draft.targets.find((t) => t.id === id);
    const targets = draft.targets.map((t) => {
        if (t.id !== id) return t;
        const next = { ...t, ...p, source: 'manual-override' as const };
        next.nomenclatureIssues = nomenclatureIssues(next.adjustmentName,
          draft.targets.filter((x) => x.stationIds[0] === next.stationIds[0]).map((x) => x.id === id ? next.adjustmentName : x.adjustmentName));
        return next;
      });
    // For a point observed by one prism, the editable adjustment label is also
    // the actual engine id. Shared points keep their explicit common engine id.
    const point = current && draft.physicalPoints.find((pp) => pp.id === current.physicalPointId);
    const physicalPoints = point && point.btmPrismIds.length === 1
      ? draft.physicalPoints.map((pp) => pp.id === point.id ? {
          ...pp,
          ...(p.adjustmentName !== undefined ? { engineName: p.adjustmentName, label: p.adjustmentName } : {}),
          ...(p.outputName !== undefined ? { outputName: p.outputName } : {}),
          ...(p.role !== undefined ? { role: p.role } : {}),
        } : pp)
      : draft.physicalPoints;
    set({ targets, physicalPoints });
  };

  const batchPatch = (p: Partial<TargetMapping>) => {
    const selectedTargets = draft.targets.filter((t) => selected.has(t.id));
    const selectedSourceKeys = new Set(selectedTargets.flatMap((t) =>
      t.stationIds.map((stationId) => targetSourceKey(stationId, t.rawName))));
    const prism = p.prismProfileId ? prisms.find((x) => x.id === p.prismProfileId) : undefined;
    set({
      targets: draft.targets.map((t) => selected.has(t.id)
        ? { ...t, ...p, source: 'manual-override' as const } : t),
      setups: prism ? draft.setups.map((setup) => selectedSourceKeys.has(targetSourceKey(setup.stationId, setup.targetKey))
        ? { ...setup, prismProfileId: prism.id, effectiveConstantM: prism.effectiveConstantM,
            measurementType: 'prism' as const, edmMode: prism.edmMode,
            constantAppliedByStationM: appliedByDefault(prism.effectiveConstantM), source: 'manual-override' as const }
        : setup) : draft.setups,
    });
    setBatchOpen(false);
  };

  const detectNew = () => {
    const mapped = new Set(draft.targets.flatMap((t) =>
      t.stationIds.map((stationId) => targetSourceKey(stationId, t.rawName))));
    const observed = new Map<string, { stationId: string; rawName: string }>();
    for (const observation of repository.observations().filter((o) => draft.stationIds.includes(o.stationId))) {
      observed.set(targetSourceKey(observation.stationId, observation.rawTargetName), {
        stationId: observation.stationId,
        rawName: observation.rawTargetName,
      });
    }
    const newOnes = [...observed.entries()].filter(([key]) => !mapped.has(key)).map(([, value]) => value);
    if (newOnes.length === 0) {
      alert('No unmapped target detected in the observations.');
      return;
    }
    // every new prism gets its own distinct physical point (unresolved)
    const newTargets: TargetMapping[] = [];
    const newPoints: typeof draft.physicalPoints = [];
    const newSetups: typeof draft.setups = [];
    newOnes.forEach(({ stationId, rawName }, i) => {
      const baseName = rawName.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 15);
      const taken = new Set([...draft.physicalPoints, ...newPoints].map((pp) => pp.engineName));
      let adjustmentName = baseName || 'PT';
      let suffix = 2;
      while (taken.has(adjustmentName)) {
        const tail = `_${suffix++}`;
        adjustmentName = `${baseName.slice(0, 15 - tail.length)}${tail}`;
      }
      const ppId = `pp-new-${Date.now()}-${i}`;
      const btmPrismId = `PRISM-${stationId}-${rawName}`;
      newPoints.push({
        id: ppId,
        label: adjustmentName,
        engineName: adjustmentName,
        role: 'auxiliary',
        btmPrismIds: [btmPrismId],
        state: 'unresolved',
        source: 'default',
        rationale: 'New target detected in the observations - identity not confirmed',
      });
      newTargets.push({
        id: `new-${Date.now()}-${i}`,
        stationIds: [stationId],
        btmPrismId,
        rawName,
        adjustmentName,
        outputName: `${stationId}_${rawName}`,
        physicalPointId: ppId,
        role: 'auxiliary',
        prismProfileId: 'prism-std0',
        targetHeightM: 0,
        includeInAdjustment: false,       // never auto-included
        publishOutput: false,
        validFrom: new Date().toISOString(),
        source: 'manual-override',
        reviewStatus: 'to-review',
        initialCoordinateStatus: 'to-review',
        nomenclatureIssues: [],
      });
      const defaultPrism = countryDefaultPrism;
      newSetups.push({
        stationId,
        targetKey: rawName,
        measurementType: 'prism',
        edmMode: defaultPrism?.edmMode,
        prismProfileId: defaultPrism?.id ?? 'prism-std0',
        effectiveConstantM: defaultPrism?.effectiveConstantM ?? 0,
        constantAppliedByStationM: appliedByDefault(defaultPrism?.effectiveConstantM ?? 0),
        targetHeightM: 0,
        source: 'manual-override',
      });
    });
    set({
      targets: [...draft.targets, ...newTargets],
      physicalPoints: [...draft.physicalPoints, ...newPoints],
      setups: [...draft.setups, ...newSetups],
    });
  };

  const rows = draft.targets.filter((t) =>
    (filterStation === 'all' || t.stationIds.includes(filterStation))
    && (filterRole === 'all' || t.role === filterRole));

  const issues = draft.targets.flatMap((t) => t.nomenclatureIssues.map((i) => `${t.rawName}: ${i}`));

  return (
    <div className="space-y-4">
    <Card title="Step 4 - Targets and measurement setups"
      actions={
        <div className="flex gap-2">
          <Button size="xs" onClick={detectNew}>Detect new targets</Button>
          <Button size="xs" disabled={selected.size === 0} onClick={() => setBatchOpen(true)}>
            Batch edit ({selected.size})
          </Button>
          <Button size="xs" variant={advancedOpen ? 'primary' : 'secondary'} onClick={() => setAdvancedOpen(!advancedOpen)}>
            {advancedOpen ? 'Hide advanced' : 'Advanced options'}
          </Button>
        </div>
      }>
      <div className="mb-3 flex gap-3">
        <Select value={filterStation} onChange={setFilterStation}
          options={[{ value: 'all', label: 'All stations' },
            ...draft.stationIds.map((s) => ({ value: s, label: s }))]} />
        <Select value={filterRole} onChange={setFilterRole}
          options={[{ value: 'all', label: 'All roles' },
            { value: 'reference', label: 'Reference' },
            { value: 'monitoring', label: 'Monitoring prism' },
            { value: 'auxiliary', label: 'Auxiliary' }]} />
      </div>
      {issues.length > 0 && <Callout tone="warning">Nomenclature issues: {issues.join(' | ')}</Callout>}
      <TableWrap>
        <thead>
          <tr>
            <th><input type="checkbox"
              checked={selected.size === rows.length && rows.length > 0}
              onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>
            <th>Station</th><th>Raw target name</th>
            {advancedOpen && <th>Adjustment label</th>}
            <th>Engine point ID</th>
            {advancedOpen && <th>BTM output name</th>}
            <th>Role</th><th>Measurement</th><th>Target setup</th>
            {advancedOpen && <><th>EDM program</th><th>Height (m)</th><th>Distance σ</th><th>PPM</th><th>Required const (mm)</th><th>Already in stored Sd (mm)</th></>}
            <th>Distance correction</th><th>Initial coords</th><th>Include</th><th>Publish</th>
            {advancedOpen && <th>Source</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const setup = draft.setups.find((s) => s.targetKey === t.rawName && t.stationIds.includes(s.stationId));
            const measurementType = setup?.measurementType ?? 'prism';
            const delta = measurementType === 'reflectorless' ? 0
              : (setup?.effectiveConstantM ?? 0) - (setup?.constantAppliedByStationM ?? 0);
            const patchSetup = (patch: Partial<NonNullable<typeof setup>>) => {
              if (!setup) return;
              set({ setups: draft.setups.map((item) => item === setup
                ? { ...item, ...patch, source: 'manual-override' as const } : item) });
            };
            return (
              <tr key={t.id} className={t.reviewStatus === 'to-review' ? 'bg-amber-50/50' : ''}>
                <td><input type="checkbox" checked={selected.has(t.id)}
                  onChange={(e) => {
                    const n = new Set(selected);
                    if (e.target.checked) n.add(t.id); else n.delete(t.id);
                    setSelected(n);
                  }} /></td>
                <td>{t.stationIds.join(', ')}</td>
                <td className="font-medium">{t.rawName}
                  {t.reviewStatus === 'to-review' && <Badge tone="Provisional">To review</Badge>}
                </td>
                {advancedOpen && <td>
                  <input className="input !w-24 !px-1 !py-0.5 !text-xs" value={t.adjustmentName}
                    onChange={(e) => patchTarget(t.id, { adjustmentName: e.target.value })} />
                  {t.nomenclatureIssues.length > 0 && <span className="text-rose-600"> ⚠</span>}
                </td>}
                <td className="font-mono text-2xs text-brand-700">{resolveEngineName(t, draft.physicalPoints)}</td>
                {advancedOpen && <td>
                  <input className="input !w-40 !px-1 !py-0.5 !text-xs" value={t.outputName}
                    onChange={(e) => patchTarget(t.id, { outputName: e.target.value })} />
                </td>}
                <td>
                  <select className="input !w-28 !px-1 !py-0.5 !text-xs" value={t.role}
                    onChange={(e) => patchTarget(t.id, { role: e.target.value as TargetMapping['role'] })}>
                    <option value="reference">Reference</option>
                    <option value="monitoring">Monitoring</option>
                    <option value="auxiliary">Auxiliary</option>
                  </select>
                </td>
                <td><select className="input !w-36 !px-1 !py-0.5 !text-xs" value={measurementType}
                  onChange={(e) => patchSetup({ measurementType: e.target.value as NonNullable<typeof setup>['measurementType'],
                    ...(e.target.value === 'reflectorless' ? { effectiveConstantM: 0, constantAppliedByStationM: 0, targetHeightM: 0 } : {}) })}>
                  <option value="prism">Prism</option><option value="reflective-sheet">Reflective sheet</option><option value="reflectorless">Reflectorless / laser</option>
                </select></td>
                <td>
                  {measurementType === 'reflectorless' ? <Badge>None</Badge> : <select className="input !w-40 !px-1 !py-0.5 !text-xs" value={t.prismProfileId}
                    onChange={(e) => {
                      const prism = prisms.find((p) => p.id === e.target.value);
                      patchTarget(t.id, { prismProfileId: e.target.value });
                      if (prism) {
                        set({
                          setups: draft.setups.map((s) => s.targetKey === t.rawName && t.stationIds.includes(s.stationId)
                            ? { ...s, prismProfileId: prism.id, effectiveConstantM: prism.effectiveConstantM,
                                edmMode: prism.edmMode,
                                constantAppliedByStationM: appliedByDefault(prism.effectiveConstantM), source: 'manual-override' }
                            : s),
                        });
                      }
                    }}>
                    {prisms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>}
                </td>
                {advancedOpen && <>
                  <td><input className="input !w-28 !px-1 !py-0.5 !text-xs" value={setup?.edmMode ?? ''}
                    placeholder={draft.stations.find((station) => setup?.stationId === station.id)?.edmMode ?? 'Instrument default'}
                    onChange={(e) => patchSetup({ edmMode: e.target.value })} /></td>
                  <td><input className="input !w-20 !px-1 !py-0.5 !text-right !text-xs" type="number" step="0.001"
                    value={setup?.targetHeightM ?? t.targetHeightM} onChange={(e) => patchSetup({ targetHeightM: Number(e.target.value) })} /></td>
                  <td><input className="input !w-20 !px-1 !py-0.5 !text-right !text-xs" type="number" step="0.1"
                    value={setup?.distanceStdErrMm ?? ''} placeholder="default" onChange={(e) => patchSetup({ distanceStdErrMm: e.target.value === '' ? undefined : Number(e.target.value) })} /></td>
                  <td><input className="input !w-20 !px-1 !py-0.5 !text-right !text-xs" type="number" step="0.1"
                    value={setup?.distancePpm ?? ''} placeholder="default" onChange={(e) => patchSetup({ distancePpm: e.target.value === '' ? undefined : Number(e.target.value) })} /></td>
                  <td className="text-right">{fmtMm(setup?.effectiveConstantM, 1)}</td>
                  <td className="text-right">
                    {setup ? <input className="input !w-20 !px-1 !py-0.5 !text-right !text-xs"
                      type="number" step="0.1" value={setup.constantAppliedByStationM * 1000}
                      onChange={(e) => set({ setups: draft.setups.map((item) => item === setup
                        ? { ...item, constantAppliedByStationM: Number(e.target.value) / 1000, source: 'manual-override' }
                        : item) })} /> : '-'}
                  </td>
                </>}
                <td className="text-right font-medium">
                  {Math.abs(delta) < 1e-9
                    ? <Badge tone="Success">{measurementType === 'reflectorless' ? 'No prism correction' : 'Already corrected'}</Badge>
                    : <Badge tone="Ready">BTM {delta > 0 ? '+' : ''}{fmtMm(delta, 1)} mm</Badge>}
                </td>
                <td><Badge tone={t.initialCoordinateStatus === 'computed' ? 'Success' : 'Draft'}>{t.initialCoordinateStatus}</Badge></td>
                <td><Toggle checked={t.includeInAdjustment} onChange={(v) => patchTarget(t.id, { includeInAdjustment: v })} /></td>
                <td><Toggle checked={t.publishOutput} onChange={(v) => patchTarget(t.id, { publishOutput: v })} /></td>
                {advancedOpen && <td>{t.source === 'manual-override'
                  ? <Badge tone="Provisional">Modified from template</Badge>
                  : <Badge>Template</Badge>}</td>}
              </tr>
            );
          })}
        </tbody>
      </TableWrap>
      <p className="mt-2 text-2xs text-slate-500">
        Measurement technology, EDM program, target constant and precision are resolved per station-target pair. A single instrument may therefore mix prisms, reflective sheets and reflectorless observations. The country template only supplies defaults; use Advanced options for an exception. The nomenclature controller keeps the raw field name untouched, validates the internal engine
        name (length, characters, collisions - future Star*Net compatibility) and the BTM output name.
        New targets found in the data are added as <em>To review</em> and never auto-included.
      </p>
      <Drawer open={batchOpen} onClose={() => setBatchOpen(false)} title={`Batch edit ${selected.size} target(s)`}>
        <BatchEdit onApply={batchPatch} prisms={prisms.map((p) => ({ value: p.id, label: p.name }))} />
      </Drawer>
    </Card>

    <PointIdentityPanel
      stations={draft.stations}
      targets={draft.targets}
      physicalPoints={draft.physicalPoints}
      provisional={draft.provisional}
      observations={repository.observations().filter((observation) => draft.stationIds.includes(observation.stationId))}
      setups={draft.setups}
      user="wizard"
      onChange={(targets, physicalPoints) => set({ targets, physicalPoints, provisionalSaved: false })}
    />
    <KnownGeometryPanel draft={draft} set={set} />
    </div>
  );
}

function KnownGeometryPanel({ draft, set }: { draft: WizardDraft; set: (p: Partial<WizardDraft>) => void }) {
  const [open, setOpen] = useState(false);
  const [pointAId, setPointAId] = useState('');
  const [pointBId, setPointBId] = useState('');
  const [kind, setKind] = useState<GeometricRelationship['kind']>('slope-distance');
  const [value, setValue] = useState(0);
  const [deltaN, setDeltaN] = useState(0);
  const [deltaH, setDeltaH] = useState(0);
  const [sigmaMm, setSigmaMm] = useState(1);
  const points = draft.physicalPoints;
  return <Card title="Known geometry (optional)" actions={<Button size="xs" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Add a baseline or vector'}</Button>}>
    <p className="text-xs text-slate-500">
      A known distance or vector links two <strong>different</strong> physical points. It is a surveyed constraint, not proof that the points are identical, and it does not replace the common-point mapping needed to orient two station frames.
    </p>
    {open && <div className="mt-3 grid items-end gap-3 md:grid-cols-7">
      <Field label="Point A"><Select value={pointAId} onChange={setPointAId} options={[{ value: '', label: 'Select…' }, ...points.map((point) => ({ value: point.id, label: point.engineName }))]} /></Field>
      <Field label="Point B"><Select value={pointBId} onChange={setPointBId} options={[{ value: '', label: 'Select…' }, ...points.filter((point) => point.id !== pointAId).map((point) => ({ value: point.id, label: point.engineName }))]} /></Field>
      <Field label="Relationship"><Select value={kind} onChange={(next) => setKind(next as GeometricRelationship['kind'])} options={[
        { value: 'slope-distance', label: 'Slope distance' }, { value: 'horizontal-distance', label: 'Horizontal distance' },
        { value: 'height-difference', label: 'Height difference' }, { value: 'vector-3d', label: '3D vector (advanced)' },
      ]} /></Field>
      <Field label={kind === 'height-difference' ? 'ΔH' : kind === 'vector-3d' ? 'ΔE' : 'Distance'} unit="m"><NumberInput value={value} step={0.001} onChange={setValue} /></Field>
      {kind === 'vector-3d' && <><Field label="ΔN" unit="m"><NumberInput value={deltaN} step={0.001} onChange={setDeltaN} /></Field>
        <Field label="ΔH" unit="m"><NumberInput value={deltaH} step={0.001} onChange={setDeltaH} /></Field></>}
      <div className="flex items-end gap-2"><Field label="σ" unit="mm"><NumberInput value={sigmaMm} step={0.1} onChange={(next) => setSigmaMm(Math.max(0.01, next))} /></Field>
        <Button size="xs" variant="primary" disabled={!pointAId || !pointBId || pointAId === pointBId
          || ((kind === 'slope-distance' || kind === 'horizontal-distance') && value <= 0)
          || (kind === 'vector-3d' && value === 0 && deltaN === 0 && deltaH === 0)} onClick={() => {
          const relation: GeometricRelationship = {
            id: `geometry-${Date.now()}`, pointAId, pointBId, kind, sigmaM: sigmaMm / 1000, enabled: true, source: 'manual',
            ...(kind === 'height-difference' ? { deltaHM: value }
              : kind === 'vector-3d' ? { deltaEM: value, deltaNM: deltaN, deltaHM: deltaH }
                : { distanceM: value }),
          };
          set({ geometricRelationships: [...draft.geometricRelationships, relation] }); setPointAId(''); setPointBId(''); setValue(0); setDeltaN(0); setDeltaH(0);
        }}>Add</Button></div>
    </div>}
    {draft.geometricRelationships.length > 0 && <TableWrap maxH="max-h-48"><thead><tr><th>Point A</th><th>Point B</th><th>Type</th><th>Value</th><th>σ</th><th></th></tr></thead>
      <tbody>{draft.geometricRelationships.map((relation) => <tr key={relation.id}><td>{points.find((point) => point.id === relation.pointAId)?.engineName}</td>
        <td>{points.find((point) => point.id === relation.pointBId)?.engineName}</td><td>{relation.kind}</td>
        <td>{relation.kind === 'vector-3d' ? `(${relation.deltaEM?.toFixed(3)}, ${relation.deltaNM?.toFixed(3)}, ${relation.deltaHM?.toFixed(3)}) m`
          : `${(relation.distanceM ?? relation.deltaHM ?? 0).toFixed(3)} m`}</td><td>{fmtMm(relation.sigmaM, 1)}</td>
        <td><Button size="xs" variant="danger" onClick={() => set({ geometricRelationships: draft.geometricRelationships.filter((item) => item.id !== relation.id) })}>Remove</Button></td></tr>)}</tbody></TableWrap>}
  </Card>;
}

function BatchEdit({ onApply, prisms }: {
  onApply: (p: Partial<TargetMapping>) => void;
  prisms: { value: string; label: string }[];
}) {
  const [role, setRole] = useState('');
  const [include, setInclude] = useState('');
  const [publish, setPublish] = useState('');
  const [prism, setPrism] = useState('');
  return (
    <div className="space-y-3">
      <Field label="Role"><Select value={role} onChange={setRole}
        options={[{ value: '', label: '(unchanged)' }, { value: 'reference', label: 'Reference' },
          { value: 'monitoring', label: 'Monitoring' }, { value: 'auxiliary', label: 'Auxiliary' }]} /></Field>
      <Field label="Include in adjustment"><Select value={include} onChange={setInclude}
        options={[{ value: '', label: '(unchanged)' }, { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} /></Field>
      <Field label="Publish output"><Select value={publish} onChange={setPublish}
        options={[{ value: '', label: '(unchanged)' }, { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} /></Field>
      <Field label="Prism template"><Select value={prism} onChange={setPrism}
        options={[{ value: '', label: '(unchanged)' }, ...prisms]} /></Field>
      <Button variant="primary" onClick={() => {
        const p: Partial<TargetMapping> = {};
        if (role) p.role = role as TargetMapping['role'];
        if (include) p.includeInAdjustment = include === 'yes';
        if (publish) p.publishOutput = publish === 'yes';
        if (prism) p.prismProfileId = prism;
        onApply(p);
      }}>Apply to selection</Button>
    </div>
  );
}

// ============================================================ Step 5 =======
export function StepReferences({ draft, set }: { draft: WizardDraft; set: (p: Partial<WizardDraft>) => void }) {
  const activeSet = draft.refSets.find((r) => r.id === draft.selectedRefSetId);
  const [compareId, setCompareId] = useState('');
  const [newReferenceId, setNewReferenceId] = useState('');
  const compareSet = draft.refSets.find((r) => r.id === compareId);
  const localSet = draft.refSets.find((setItem) => setItem.id.includes('local-datum'));
  const knownSets = draft.refSets.filter((setItem) => !setItem.id.includes('local-datum'));

  const geometry = useMemo(() => {
    if (!activeSet) return { ok: false, messages: ['No initialization datum selected'] };
    if (activeSet.points.length === 0) return draft.initMode === 'local-anchor'
      ? { ok: true, messages: [], constrained: 0, spread: 0 }
      : { ok: false, messages: ['Add at least one reference with coordinates, or use the fixed-station local method.'], constrained: 0, spread: 0 };
    const messages: string[] = [];
    const constrained = activeSet.points.reduce((acc, p) =>
      acc + (p.modeE !== 'free' ? 1 : 0) + (p.modeN !== 'free' ? 1 : 0) + (p.modeH !== 'free' ? 1 : 0), 0);
    if (activeSet.points.length < 2) messages.push('At least two references are recommended for orientation control');
    if (constrained < 4) messages.push('Datum is weak: fewer than 4 constrained components (E/N/H coverage incomplete)');
    const es = activeSet.points.map((p) => p.easting);
    const ns = activeSet.points.map((p) => p.northing);
    const spread = activeSet.points.length > 0
      ? Math.hypot(Math.max(...es) - Math.min(...es), Math.max(...ns) - Math.min(...ns)) : 0;
    if (spread < 50) messages.push('References are geometrically clustered (span < 50 m): orientation is poorly controlled');
    const hCovered = activeSet.points.some((p) => p.modeH !== 'free');
    if (!hCovered) messages.push('No height component constrained: vertical datum missing (rank deficiency expected)');
    return { ok: messages.length === 0, messages, constrained, spread: Math.round(spread) };
  }, [activeSet, draft.initMode]);

  const patchPoint = (setId: string, pointId: string, p: Partial<ReferencePoint>) => {
    set({
      refSets: draft.refSets.map((rs) => rs.id !== setId ? rs : {
        ...rs,
        points: rs.points.map((pt) => pt.pointId === pointId ? { ...pt, ...p } : pt),
      }),
    });
  };

  const duplicateSet = () => {
    if (!activeSet) return;
    const copy = {
      ...JSON.parse(JSON.stringify(activeSet)) as typeof activeSet,
      id: `refset-copy-${Date.now()}`,
      name: `${activeSet.name} (copy)`,
      version: Math.max(...draft.refSets.map((r) => r.version)) + 1,
      usedByRun: false,
    };
    set({ refSets: [...draft.refSets, copy], selectedRefSetId: copy.id });
  };

  const chooseMode = (mode: WizardDraft['initMode']) => {
    const selectedRefSetId = mode === 'local-anchor'
      ? localSet?.id ?? draft.selectedRefSetId
      : (activeSet?.points.length ? activeSet.id : knownSets[0]?.id ?? draft.selectedRefSetId);
    set({ initMode: mode, selectedRefSetId, provisionalSaved: false });
  };

  const availableReferenceIds = [...new Set(draft.targets.map((target) =>
    resolveEngineName(target, draft.physicalPoints)))]
    .filter((id) => !activeSet?.points.some((point) => point.pointId === id));

  const addReference = () => {
    if (!activeSet || !newReferenceId) return;
    const point: ReferencePoint = {
      pointId: newReferenceId, easting: 0, northing: 0, height: 0,
      sigmaE: 0.001, sigmaN: 0.001, sigmaH: 0.001,
      modeE: 'weak', modeN: 'weak', modeH: 'weak',
      source: 'Manual initialization input', comment: 'Coordinates must be completed before calculation',
    };
    set({ refSets: draft.refSets.map((item) => item.id === activeSet.id
      ? { ...item, points: [...item.points, point] } : item), provisionalSaved: false });
    setNewReferenceId('');
  };

  if (!activeSet) return <Callout tone="warning">Import reference sets first (step 2 loads them from the BTM header block).</Callout>;

  return (
    <div className="space-y-4">
      <Card title="Step 5 - Initialisation datum">
        <Callout tone="info">
          Choose one method: provide known reference coordinates, or fix one station and calculate the network in a local coordinate system. Everything needed for the first calculation is grouped in this step.
        </Callout>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Field label="Coordinate source"><Select value={draft.initMode} onChange={(value) => chooseMode(value as WizardDraft['initMode'])}
            options={[{ value: 'known-references', label: 'Use known reference coordinates' },
              { value: 'local-anchor', label: 'No coordinates — fix one station' }]} /></Field>
          {draft.initMode === 'known-references' && <Field label="Reference set"><div className="flex gap-2">
            <Select value={draft.selectedRefSetId} onChange={(value) => set({ selectedRefSetId: value, provisionalSaved: false })}
              options={knownSets.map((item) => ({ value: item.id, label: `${item.name} (from ${item.validFrom.slice(0, 10)})` }))} />
            <Button size="xs" onClick={duplicateSet}>Duplicate</Button>
          </div></Field>}
        </div>
        {draft.initMode === 'local-anchor' ? (
          <Callout tone="success">No external reference coordinates are required. Configure the fixed station coordinates and orientation below; 0 / 0 / 0 / 0 is accepted for a local system.</Callout>
        ) : <>
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
          <Field label="Add a reference point"><Select value={newReferenceId} onChange={setNewReferenceId}
            options={[{ value: '', label: 'Select a target…' }, ...availableReferenceIds.map((id) => ({ value: id, label: id }))]} /></Field>
          <Button size="xs" disabled={!newReferenceId} onClick={addReference}>Add reference</Button>
          <span className="text-2xs text-slate-500">Coordinates and component constraints remain editable before calculation.</span>
        </div>
        <TableWrap maxH="max-h-72">
          <thead>
            <tr>
              <th>Point ID</th><th>Easting</th><th>Northing</th><th>Height</th>
              <th>Mode E</th><th>σE (m)</th><th>Mode N</th><th>σN (m)</th><th>Mode H</th><th>σH (m)</th>
              <th>Valid from</th><th>Source</th>
            </tr>
          </thead>
          <tbody>
            {activeSet.points.map((p) => (
              <tr key={p.pointId}>
                <td className="font-medium">{p.pointId}</td>
                <td><input type="number" step="0.0001" className="input !w-28 !px-1 !py-0.5 !text-xs" value={p.easting}
                  onChange={(event) => patchPoint(activeSet.id, p.pointId, { easting: Number(event.target.value) })} /></td>
                <td><input type="number" step="0.0001" className="input !w-28 !px-1 !py-0.5 !text-xs" value={p.northing}
                  onChange={(event) => patchPoint(activeSet.id, p.pointId, { northing: Number(event.target.value) })} /></td>
                <td><input type="number" step="0.0001" className="input !w-24 !px-1 !py-0.5 !text-xs" value={p.height}
                  onChange={(event) => patchPoint(activeSet.id, p.pointId, { height: Number(event.target.value) })} /></td>
                {(['E', 'N', 'H'] as const).map((c) => {
                  const modeKey = `mode${c}` as 'modeE' | 'modeN' | 'modeH';
                  const sigKey = `sigma${c}` as 'sigmaE' | 'sigmaN' | 'sigmaH';
                  return (
                    <React.Fragment key={c}>
                      <td>
                        <select className="input !w-20 !px-1 !py-0.5 !text-xs" value={p[modeKey]}
                          onChange={(e) => patchPoint(activeSet.id, p.pointId, { [modeKey]: e.target.value } as Partial<ReferencePoint>)}>
                          <option value="fixed">Fixed</option>
                          <option value="weak">Weak</option>
                          <option value="free">Free</option>
                        </select>
                      </td>
                      <td>
                        {p[modeKey] === 'weak' ? (
                          <input type="number" step="0.0001" className="input !w-20 !px-1 !py-0.5 !text-xs"
                            value={p[sigKey] ?? ''}
                            onChange={(e) => patchPoint(activeSet.id, p.pointId, { [sigKey]: Number(e.target.value) } as Partial<ReferencePoint>)} />
                        ) : p[modeKey] === 'fixed' ? '(!)' : '(*)'}
                      </td>
                    </React.Fragment>
                  );
                })}
                <td className="text-2xs">{activeSet.validFrom.slice(0, 10)}</td>
                <td className="text-2xs">{p.source}{p.comment ? ` - ${p.comment}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <div className="mt-3 space-y-1">
          {geometry.messages.map((m, i) => <Callout key={i} tone="warning">{m}</Callout>)}
          {geometry.ok && (
            <Callout tone="success">
              Geometry check passed: {geometry.constrained} constrained components, spatial span ≈ {geometry.spread} m.
              Rank and E/N/H coverage are re-verified by the engine at run time.
            </Callout>
          )}
        </div>
        </>}
      </Card>
      {draft.initMode === 'known-references' && <Card title="Compare two reference sets" actions={
        <Select value={compareId} onChange={setCompareId}
          options={[{ value: '', label: 'Select a set to compare...' },
            ...draft.refSets.filter((r) => r.id !== activeSet.id)
              .map((r) => ({ value: r.id, label: r.name }))]} />
      }>
        {compareSet ? (
          <TableWrap maxH="max-h-56">
            <thead><tr><th>Point</th><th>ΔE (mm)</th><th>ΔN (mm)</th><th>ΔH (mm)</th></tr></thead>
            <tbody>
              {activeSet.points.map((p) => {
                const o = compareSet.points.find((x) => x.pointId === p.pointId);
                if (!o) return <tr key={p.pointId}><td>{p.pointId}</td><td colSpan={3}>only in {activeSet.name}</td></tr>;
                const dE = (p.easting - o.easting) * 1000;
                const dN = (p.northing - o.northing) * 1000;
                const dH = (p.height - o.height) * 1000;
                const hot = Math.max(Math.abs(dE), Math.abs(dN), Math.abs(dH)) > 0.5;
                return (
                  <tr key={p.pointId} className={hot ? 'bg-amber-50' : ''}>
                    <td>{p.pointId}</td><td>{dE.toFixed(2)}</td><td>{dN.toFixed(2)}</td><td>{dH.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        ) : <p className="text-xs text-slate-400">Pick a second set to see the coordinate differences.</p>}
      </Card>}
    </div>
  );
}

import React, { useState } from 'react';
import type { WizardDraft } from './wizardTypes';
import {
  Badge, Button, Callout, Card, Field, NumberInput, Select, TableWrap, TextInput, Toggle,
} from '../../components/ui';
import { computeInitialCoordinates } from '../../engine/initial';
import { resolveEngineName } from '../../engine/pointIdentity';
import { correctDistance, lookupEnvironment } from '../../engine/corrections';
import { repository } from '../../data/repository';
import { fmtArcSec, fmtM, fmtMm } from '../../lib/format';
import type { AdjustmentTemplate, CorrectionTrace } from '../../types/domain';
import { NetworkView } from '../../components/NetworkView';

// ===================================================== Initialisation =======
export function StepInitial({ draft, set }: { draft: WizardDraft; set: (p: Partial<WizardDraft>) => void }) {
  const [computed, setComputed] = useState(draft.provisional.length > 0);
  const anchorId = draft.initAnchorStationId || draft.stationIds[0] || '';
  const anchor = draft.stations.find((station) => station.id === anchorId);
  const patchAnchor = (patch: Partial<NonNullable<typeof anchor>>) => set({
    stations: draft.stations.map((station) => station.id === anchorId ? { ...station, ...patch } : station),
  });

  const compute = () => {
    const refSet = draft.refSets.find((r) => r.id === draft.selectedRefSetId);
    if (!refSet) return;
    const fromMs = new Date(draft.initWindowFrom + (draft.initWindowFrom.endsWith('Z') ? '' : 'Z')).getTime();
    const toMs = new Date(draft.initWindowTo + (draft.initWindowTo.endsWith('Z') ? '' : 'Z')).getTime();
    // orientations computed alongside for display
    const observations = repository.observationsInWindow(draft.stationIds, fromMs, toMs);
    const env = repository.environmental();
    const instruments = Object.fromEntries(repository.instrumentProfiles().map((p) => [p.id, p]));
    const setupByKey = new Map(draft.setups.map((s) => [`${s.stationId}|${s.targetKey}`, s]));
    const corrections = new Map<string, CorrectionTrace>();
    // per (station, field name) -> engine name via the physical point mapping
    const nameMap = new Map<string, string>();
    for (const t of draft.targets) {
      const engineName = resolveEngineName(t, draft.physicalPoints);
      for (const sid of t.stationIds) nameMap.set(`${sid}|${t.rawName}`, engineName);
    }
    for (const o of observations) {
      const st = draft.stations.find((s) => s.id === o.stationId);
      const adjName = nameMap.get(`${o.stationId}|${o.rawTargetName}`);
      if (!st || !adjName) continue;
      const setup = setupByKey.get(`${o.stationId}|${o.rawTargetName}`);
      corrections.set(o.id, correctDistance({
        observation: o, station: st,
        setup: setup ?? { effectiveConstantM: 0, constantAppliedByStationM: 0 },
        instrument: instruments[st.instrumentProfileId],
        env: lookupEnvironment(st, o.epoch, env),
        datumScale: 1, targetId: adjName,
      }));
    }
    const result = computeInitialCoordinates({
      observations, corrections,
      stations: draft.stations,
      references: refSet.points,
      nameMap,
      targetHeights: new Map(draft.targets.map((t) => [resolveEngineName(t, draft.physicalPoints), t.targetHeightM])),
      referenceIds: new Set(refSet.points.map((p) => p.pointId)),
      fixedOrientations: draft.initMode === 'local-anchor'
        ? new Map([[anchorId, draft.initAnchorOrientationDeg * Math.PI / 180]]) : undefined,
      epochFrom: new Date(fromMs).toISOString(),
      epochTo: new Date(toMs).toISOString(),
    });
    set({
      provisional: result.provisional,
      orientations: result.orientations,
      initFailures: result.failures,
      provisionalSaved: false,
      stations: draft.stations.map((station) => {
        const solved = result.orientations.find((item) => item.stationId === station.id);
        return solved?.estimatedE !== undefined ? {
          ...station,
          approxE: solved.estimatedE,
          approxN: solved.estimatedN ?? station.approxN,
          approxH: solved.estimatedH ?? station.approxH,
          adjustable: draft.initMode === 'local-anchor' && station.id === anchorId ? false : station.adjustable,
        } : station;
      }),
      targets: draft.targets.map((t) => result.provisional.some((p) => p.targetId === resolveEngineName(t, draft.physicalPoints))
        ? { ...t, initialCoordinateStatus: 'computed' as const } : t),
    });
    setComputed(true);
  };

  const patchProvisional = (targetId: string, p: { easting?: number; northing?: number; height?: number; comment?: string }) => {
    set({
      provisional: draft.provisional.map((x) => x.targetId === targetId
        ? { ...x, ...p, status: 'manual' as const } : x),
      provisionalSaved: false,
    });
  };

  return (
    <div className="space-y-4">
      <Card title="Calculate initial coordinates"
        actions={
          <Button variant="primary" size="xs" onClick={compute}>Compute initial coordinates</Button>
        }>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Representative period from" hint="Cycle(s) used for the initialization.">
            <TextInput type="datetime-local" value={draft.initWindowFrom}
              onChange={(e) => set({ initWindowFrom: e.target.value })} />
          </Field>
          <Field label="to">
            <TextInput type="datetime-local" value={draft.initWindowTo}
              onChange={(e) => set({ initWindowTo: e.target.value })} />
          </Field>
          <div className="self-end text-2xs leading-5 text-slate-500">
            Distances are corrected (prism + atmosphere), each station is oriented by weighted circular
            mean over known references or propagated from the fixed station through common physical points.
          </div>
        </div>
        {draft.initMode === 'local-anchor' && anchor && (
          <div className="mt-5 rounded-xl border border-brand-100 bg-brand-50/60 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-brand-900">Local datum anchor</div>
                <div className="text-2xs text-brand-700">The anchor is held fixed; other stations can be resected from at least two confirmed common points.</div>
              </div>
              <Badge tone="Ready">Fixed for adjustment</Badge>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
              <Field label="Anchor station"><Select value={anchorId} onChange={(value) => set({ initAnchorStationId: value, provisionalSaved: false })}
                options={draft.stationIds.map((id) => ({ value: id, label: id }))} /></Field>
              <Field label="Easting" unit="m"><NumberInput value={anchor.approxE} step={0.001} onChange={(value) => patchAnchor({ approxE: value })} /></Field>
              <Field label="Northing" unit="m"><NumberInput value={anchor.approxN} step={0.001} onChange={(value) => patchAnchor({ approxN: value })} /></Field>
              <Field label="Height" unit="m"><NumberInput value={anchor.approxH} step={0.001} onChange={(value) => patchAnchor({ approxH: value })} /></Field>
              <Field label="Orientation" unit="deg"><NumberInput value={draft.initAnchorOrientationDeg} step={0.0001}
                onChange={(value) => set({ initAnchorOrientationDeg: value, provisionalSaved: false })} /></Field>
            </div>
          </div>
        )}
      </Card>

      {computed && (
        <>
          <Card title={draft.initMode === 'local-anchor' ? 'Station placement from the fixed anchor' : 'Station orientations from references'}>
            <TableWrap maxH="max-h-44">
              <thead><tr><th>Station</th><th>Source</th><th>Coordinates</th><th>Orientation</th><th>Control points</th><th>Spread</th><th>Problems</th></tr></thead>
              <tbody>
                {draft.orientations.map((o) => (
                  <tr key={o.stationId}>
                    <td className="font-medium">{o.stationId}</td>
                    <td><Badge tone={o.source === 'network-resection' ? 'Ready' : o.source === 'fixed-anchor' ? 'Provisional' : 'Success'}>{o.source ?? 'unresolved'}</Badge></td>
                    <td className="text-2xs">{o.estimatedE !== undefined ? `${o.estimatedE.toFixed(3)} / ${o.estimatedN?.toFixed(3)} / ${o.estimatedH?.toFixed(3)}` : '-'}</td>
                    <td>{o.orientationRad !== undefined ? `${(o.orientationRad * 180 / Math.PI).toFixed(5)} deg` : '-'}</td>
                    <td>{o.nReferencesUsed} ({o.referencesUsed.join(', ')})</td>
                    <td>{fmtArcSec(o.spreadRad)}″</td>
                    <td className="text-2xs text-amber-700">{o.problems.join('; ') || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>

          <Card title={`Provisional coordinates (${draft.provisional.length} targets)`}
            actions={
              <Button variant="primary" size="xs" disabled={draft.provisional.length === 0}
                onClick={() => set({ provisionalSaved: true })}>
                Save as provisional coordinates
              </Button>
            }>
            {draft.provisionalSaved && (
              <Callout tone="success">Provisional coordinates saved into the draft configuration.
                They remain adjustable - promoting a point to a constrained reference is a separate,
                protected action in the Initialisation datum section.</Callout>
            )}
            <TableWrap maxH="max-h-80">
              <thead>
                <tr>
                  <th>Target</th><th>E</th><th>N</th><th>H</th><th>Obs</th>
                  <th>Per station</th><th>Spread horiz (mm)</th><th>Spread vert (mm)</th><th>Status</th><th>Comment</th>
                </tr>
              </thead>
              <tbody>
                {draft.provisional.map((p) => (
                  <tr key={p.targetId} className={p.spreadHorizontalM > 0.01 ? 'bg-amber-50/60' : ''}>
                    <td className="font-medium">{p.targetId}</td>
                    <td><input type="number" step="0.0001" className="input !w-28 !px-1 !py-0.5 !text-xs" value={p.easting}
                      onChange={(e) => patchProvisional(p.targetId, { easting: Number(e.target.value) })} /></td>
                    <td><input type="number" step="0.0001" className="input !w-28 !px-1 !py-0.5 !text-xs" value={p.northing}
                      onChange={(e) => patchProvisional(p.targetId, { northing: Number(e.target.value) })} /></td>
                    <td><input type="number" step="0.0001" className="input !w-24 !px-1 !py-0.5 !text-xs" value={p.height}
                      onChange={(e) => patchProvisional(p.targetId, { height: Number(e.target.value) })} /></td>
                    <td>{p.nObservations}</td>
                    <td className="text-2xs">
                      {p.perStation.map((s) => `${s.stationId}: ${s.easting.toFixed(3)}/${s.northing.toFixed(3)}/${s.height.toFixed(3)}`).join(' | ')}
                    </td>
                    <td className="text-right">{fmtMm(p.spreadHorizontalM)}</td>
                    <td className="text-right">{fmtMm(p.spreadVerticalM)}</td>
                    <td><Badge tone={p.status === 'computed' ? 'Success' : 'Provisional'}>{p.status}</Badge></td>
                    <td><input className="input !w-32 !px-1 !py-0.5 !text-xs" placeholder="comment if edited"
                      value={p.comment ?? ''} onChange={(e) => patchProvisional(p.targetId, { comment: e.target.value })} /></td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            {draft.initFailures.length > 0 && (
              <div className="mt-2 space-y-1">
                {draft.initFailures.map((f, i) => (
                  <Callout key={i} tone="warning">{f.targetId}: {f.reason}</Callout>
                ))}
              </div>
            )}
          </Card>

          <Card title="Network preview">
            <NetworkView
              points={[
                ...draft.stations.map((s) => ({
                  id: s.id, e: s.approxE, n: s.approxN, role: 'station' as const,
                  tooltip: [`E ${fmtM(s.approxE)}  N ${fmtM(s.approxN)}  H ${fmtM(s.approxH)}`],
                })),
                ...(draft.refSets.find((r) => r.id === draft.selectedRefSetId)?.points ?? []).map((p) => ({
                  id: p.pointId, e: p.easting, n: p.northing, role: 'reference' as const,
                  tooltip: [`E ${fmtM(p.easting)}  N ${fmtM(p.northing)}  H ${fmtM(p.height)}`,
                    `constraints: E ${p.modeE} / N ${p.modeN} / H ${p.modeH}`],
                })),
                ...draft.provisional.map((p) => ({
                  id: p.targetId, e: p.easting, n: p.northing, role: 'monitoring' as const,
                  status: p.spreadHorizontalM > 0.01 ? 'warning' as const : 'ok' as const,
                  tooltip: [`E ${fmtM(p.easting)}  N ${fmtM(p.northing)}  H ${fmtM(p.height)}`,
                    `spread H ${fmtMm(p.spreadHorizontalM)} mm / V ${fmtMm(p.spreadVerticalM)} mm`,
                    `${p.nObservations} observation(s)`],
                })),
              ]}
              rays={draft.provisional.flatMap((p) => p.perStation.map((s) => ({ from: s.stationId, to: p.targetId })))}
            />
          </Card>
        </>
      )}
    </div>
  );
}

// ============================================================ Step 7 =======
export function StepAdjustment({ draft, set }: { draft: WizardDraft; set: (p: Partial<WizardDraft>) => void }) {
  const a = draft.adjustment;
  const patch = (p: Partial<AdjustmentTemplate>) => set({ adjustment: { ...a, ...p } });
  const [expertOpen, setExpertOpen] = useState(false);
  const [search, setSearch] = useState('');

  const show = (label: string) => !search || label.toLowerCase().includes(search.toLowerCase());

  return (
    <div className="space-y-4">
      <Card title="Step 7 - Adjustment configuration">
        <Callout tone="info">The template provides production-ready defaults. Review the quality thresholds below, then open Advanced options only when the site requires a specific weighting model.</Callout>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {show('dimension') && <Field label="Dimension"><Select value={a.dimension} onChange={(v) => patch({ dimension: v as '2D' | '3D' })}
            options={[{ value: '3D', label: '3D' }, { value: '2D', label: '2D (horizontal only)' }]} /></Field>}
          {show('linear units') && <Field label="Linear units"><TextInput value="metres" disabled /></Field>}
          {show('angular units') && <Field label="Angular units"><Select value={a.angularUnit} onChange={(v) => patch({ angularUnit: v as 'deg' | 'gon' })}
            options={[{ value: 'deg', label: 'degrees' }, { value: 'gon', label: 'gon' }]} /></Field>}
          {show('projection local grid') && <Field label="Local / grid"><Select value={a.projectionMode} onChange={(v) => patch({ projectionMode: v as 'local' | 'grid' })}
            options={[{ value: 'local', label: 'Local system' }, { value: 'grid', label: 'Grid (apply datum factor)' }]} /></Field>}
          {show('coordinate order') && <Field label="Coordinate order"><Select value={a.coordinateOrder} onChange={(v) => patch({ coordinateOrder: v as 'EN' | 'NE' })}
            options={[{ value: 'EN', label: 'Easting / Northing' }, { value: 'NE', label: 'Northing / Easting' }]} /></Field>}
          {show('convergence threshold') && <Field label="Convergence threshold" unit="m" inherited="0.00005">
            <NumberInput value={a.convergenceThresholdM} step={0.00001} onChange={(v) => patch({ convergenceThresholdM: v })} /></Field>}
          {show('max iterations') && <Field label="Max iterations" inherited="20">
            <NumberInput value={a.maxIterations} onChange={(v) => patch({ maxIterations: v })} /></Field>}
          {show('chi-square significance') && <Field label="Chi² significance" hint="Two-sided test level" inherited="0.05">
            <NumberInput value={a.chiSquareSignificance} step={0.01} onChange={(v) => patch({ chiSquareSignificance: v })} /></Field>}
          {show('confidence level') && <Field label="Confidence level" hint="For error ellipses" inherited="0.95">
            <NumberInput value={a.confidenceLevel} step={0.01} onChange={(v) => patch({ confidenceLevel: v })} /></Field>}
          {show('error propagation') && <Field label="Error propagation">
            <Toggle checked={a.errorPropagation} onChange={(v) => patch({ errorPropagation: v })}
              label={a.errorPropagation ? 'Covariance scaled by variance factor' : 'A-priori covariance'} /></Field>}
          {show('auto-correction') && <Field label="Auto-correction">
            <Toggle checked={a.autoCorrectionEnabled} onChange={(v) => patch({ autoCorrectionEnabled: v })}
              label={a.autoCorrectionEnabled ? 'Enabled' : 'Disabled'} /></Field>}
        </div>
      </Card>

      <Card title="Advanced options"
        actions={
          <div className="flex items-center gap-2">
            <TextInput placeholder="search parameter..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <Button size="xs" onClick={() => setExpertOpen(!expertOpen)}>{expertOpen ? 'Collapse' : 'Expand'}</Button>
          </div>
        }>
        {!expertOpen ? <p className="text-xs text-slate-500">Specialised weighting, centering, datum and auto-correction parameters are collapsed. Their current values come from the selected template.</p> : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {show('distance weighting') && <Field label="Distance weighting" hint="How constant and ppm parts combine" inherited="quadratic">
              <Select value={a.distanceWeighting} onChange={(v) => patch({ distanceWeighting: v as 'additive' | 'quadratic' })}
                options={[{ value: 'quadratic', label: 'Quadratic sqrt(c² + ppm²)' }, { value: 'additive', label: 'Additive c + ppm' }]} /></Field>}
            {show('centering errors') && <Field label="Centering errors">
              <Toggle checked={a.useCenteringErrors} onChange={(v) => patch({ useCenteringErrors: v })}
                label={a.useCenteringErrors ? 'Included in weights' : 'Ignored'} /></Field>}
            {show('refraction coefficient') && <Field label="Refraction coefficient" inherited="0.13">
              <NumberInput value={a.refractionCoefficient} step={0.01} onChange={(v) => patch({ refractionCoefficient: v })} /></Field>}
            {show('earth radius') && <Field label="Earth radius" unit="m" inherited="6371000">
              <NumberInput value={a.earthRadiusM} onChange={(v) => patch({ earthRadiusM: v })} /></Field>}
            {show('datum grid factor') && <Field label="Datum / grid factor" inherited="1.0">
              <NumberInput value={a.datumScaleFactor} step={0.000001} onChange={(v) => patch({ datumScaleFactor: v })} /></Field>}
            {show('standardized residual threshold') && <Field label="Std residual threshold" hint="Outlier rejection limit" inherited="3.5">
              <NumberInput value={a.stdResThreshold} step={0.1} onChange={(v) => patch({ stdResThreshold: v })} /></Field>}
            {show('removals per iteration') && <Field label="Removals per iteration" inherited="1">
              <NumberInput value={a.removalsPerIteration} onChange={(v) => patch({ removalsPerIteration: v })} /></Field>}
            {show('max auto-correction attempts') && <Field label="Max auto-correction attempts" inherited="5">
              <NumberInput value={a.maxAutoCorrectionAttempts} onChange={(v) => patch({ maxAutoCorrectionAttempts: v })} /></Field>}
            {show('max removed observations') && <Field label="Max removed observations" inherited="10">
              <NumberInput value={a.maxRemovedObservations} onChange={(v) => patch({ maxRemovedObservations: v })} /></Field>}
            {show('max removed ratio') && <Field label="Max removed ratio" hint="0..1" inherited="0.1">
              <NumberInput value={a.maxRemovedRatio} step={0.01} onChange={(v) => patch({ maxRemovedRatio: v })} /></Field>}
            {show('min degrees of freedom') && <Field label="Min degrees of freedom" inherited="5">
              <NumberInput value={a.minDegreesOfFreedom} onChange={(v) => patch({ minDegreesOfFreedom: v })} /></Field>}
            {show('max ellipse') && <Field label="Max ellipse semi-major" unit="mm" hint="Publication criterion" inherited="5">
              <NumberInput value={a.maxEllipseSemiMajorMm} step={0.5} onChange={(v) => patch({ maxEllipseSemiMajorMm: v })} /></Field>}
            {show('fixed constraint sigma') && <Field label="Fixed constraint sigma" unit="m" hint="Pseudo-observation sigma for Fixed components" inherited="0.0001">
              <NumberInput value={a.fixedConstraintSigmaM} step={0.0001} onChange={(v) => patch({ fixedConstraintSigmaM: v })} /></Field>}
          </div>
        )}
      </Card>
    </div>
  );
}

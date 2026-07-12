// ---------------------------------------------------------------------------
// Physical Point Mapping panel (shared by the wizard step 4 and the
// processing administration tab).
//
// Shows, per BTM prism: station, prism registration id, field name, role,
// linked physical point, state, source of the decision. Lets the user link
// prisms as one point, confirm them as distinct, attach to an existing
// point, or unlink - every action is explicit and traced. Suggestions
// (coordinate proximity) carry a confidence and a rationale and are never
// applied silently. "Link all identical names" lives in advanced options
// with a preview and an explicit confirmation, and is never a default.
// ---------------------------------------------------------------------------
import React, { useMemo, useState } from 'react';
import type {
  PhysicalPoint, ProvisionalCoordinate, Station, TargetMapping,
} from '../types/domain';
import {
  attachToPoint, confirmDistinct, linkAsSamePoint, networkConnectivity,
  perPrismCoordinates, resolveEngineName, suggestByProximity, unlinkPrism,
  validatePointMapping, type MappingState,
} from '../engine/pointIdentity';
import { Badge, Button, Callout, Card, Field, Modal, Select, TableWrap, TextInput, cls } from './ui';
import { fmtMm } from '../lib/format';

const STATE_TONE: Record<PhysicalPoint['state'], string> = {
  resolved: 'Success', shared: 'Ready', unresolved: 'Provisional',
  suggested: 'Provisional', inconsistent: 'Failed quality control',
};

export function PointIdentityPanel({
  stations, targets, physicalPoints, provisional, readOnly, user, onChange,
}: {
  stations: Station[];
  targets: TargetMapping[];
  physicalPoints: PhysicalPoint[];
  provisional: ProvisionalCoordinate[];
  readOnly?: boolean;
  user: string;
  onChange: (targets: TargetMapping[], physicalPoints: PhysicalPoint[], summary: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('all');
  const [rationale, setRationale] = useState('');
  const [attachTo, setAttachTo] = useState('');
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [linkAllPreview, setLinkAllPreview] = useState<{ rawName: string; ids: string[] }[] | null>(null);

  const state: MappingState = { targets, physicalPoints };
  const pointById = useMemo(() => new Map(physicalPoints.map((p) => [p.id, p])), [physicalPoints]);
  const provByEngine = useMemo(() => new Map(provisional.map((p) => [p.targetId, p])), [provisional]);
  const issues = useMemo(() => validatePointMapping({
    stations, targets, physicalPoints,
  } as never), [stations, targets, physicalPoints]);
  const connectivity = useMemo(() => networkConnectivity({
    stations, targets, physicalPoints,
  } as never), [stations, targets, physicalPoints]);

  const suggestions = useMemo(() => {
    const coords = perPrismCoordinates(state, provisional);
    return suggestByProximity({ stations, targets, physicalPoints } as never, coords)
      .filter((s) => !dismissed.has(s.btmPrismIds.join('+')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets, physicalPoints, provisional, dismissed, stations]);

  const apply = (next: MappingState, summary: string) => {
    onChange(next.targets, next.physicalPoints, summary);
    setSelected(new Set());
    setRationale('');
  };

  const rows = targets.filter((t) => {
    const pp = pointById.get(t.physicalPointId);
    if (filter === 'all') return true;
    if (filter === 'shared') return (pp?.btmPrismIds.length ?? 0) > 1;
    if (filter === 'unresolved') return pp?.state === 'unresolved' || pp?.state === 'suggested';
    if (filter === 'modified') return pp?.source === 'manual' || pp?.source === 'suggestion';
    if (filter === 'inconsistent') {
      const prov = pp ? provByEngine.get(pp.engineName) : undefined;
      return !!prov && prov.perStation.length > 1 && prov.spreadHorizontalM > 0.02;
    }
    return true;
  });

  const sharedPointsList = physicalPoints.filter((p) => p.btmPrismIds.length >= 1);

  // groups of identical field names across different stations, not yet linked
  const identicalNameGroups = useMemo(() => {
    const byRaw = new Map<string, TargetMapping[]>();
    for (const t of targets) {
      byRaw.set(t.rawName, [...(byRaw.get(t.rawName) ?? []), t]);
    }
    return [...byRaw.entries()]
      .filter(([, ts]) => new Set(ts.map((t) => t.stationIds[0])).size > 1
        && new Set(ts.map((t) => t.physicalPointId)).size > 1)
      .map(([rawName, ts]) => ({ rawName, ids: ts.map((t) => t.id) }));
  }, [targets]);

  return (
    <Card title="Point Identity (physical point mapping)"
      actions={
        <Select value={filter} onChange={setFilter} options={[
          { value: 'all', label: 'All prisms' },
          { value: 'shared', label: 'Shared points' },
          { value: 'unresolved', label: 'Not confirmed' },
          { value: 'modified', label: 'Manually decided' },
          { value: 'inconsistent', label: 'Inconsistent estimates' },
        ]} />
      }>
      <Callout tone="info">
        Two prisms from different stations are considered <strong>different points by default</strong> -
        an identical field name is never proof of identity. Linking them is an explicit, dated and
        versioned decision. The adjustment engine uses the physical point's identifier, so linked
        prisms produce one single adjusted coordinate while every observation and residual stays
        attached to its own station and prism.
      </Callout>

      {/* mapping issues */}
      <div className="mt-2 space-y-1">
        {issues.map((i, k) => (
          <Callout key={k} tone={i.level === 'blocking' ? 'error' : i.level === 'warning' ? 'warning' : 'info'}>
            {i.level === 'blocking' ? 'Blocking: ' : i.level === 'confirm' ? 'To confirm: ' : ''}{i.message}
          </Callout>
        ))}
      </div>

      {/* actions on selection */}
      {!readOnly && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md bg-slate-50 p-2 ring-1 ring-slate-200">
          <span className="text-2xs text-slate-500">{selected.size} prism(s) selected</span>
          <TextInput placeholder="reason / justification..." value={rationale}
            onChange={(e) => setRationale(e.target.value)} className="!w-64" />
          <Button size="xs" variant="primary" disabled={selected.size < 2 || !rationale.trim()}
            title="The selected prisms represent the SAME physical point"
            onClick={() => apply(
              linkAsSamePoint(state, [...selected], user, 'manual', rationale),
              `Linked ${selected.size} prisms as one physical point: ${rationale}`,
            )}>
            Link as same point
          </Button>
          <Button size="xs" disabled={selected.size === 0}
            title="Confirm the selected prisms are distinct points"
            onClick={() => apply(
              confirmDistinct(state, [...selected], user),
              `Confirmed ${selected.size} prism(s) as distinct physical points`,
            )}>
            Confirm as distinct
          </Button>
          <div className="flex items-end gap-1">
            <Select value={attachTo} onChange={setAttachTo}
              options={[{ value: '', label: 'Attach to existing point...' },
                ...sharedPointsList.map((p) => ({ value: p.id, label: `${p.label} (${p.btmPrismIds.length} prisms)` }))]} />
            <Button size="xs" disabled={!attachTo || selected.size === 0 || !rationale.trim()}
              onClick={() => apply(
                attachToPoint(state, [...selected], attachTo, user, rationale),
                `Attached ${selected.size} prism(s) to ${pointById.get(attachTo)?.label}: ${rationale}`,
              )}>
              Attach
            </Button>
          </div>
        </div>
      )}

      {/* prism table */}
      <div className="mt-3">
        <TableWrap maxH="max-h-80">
          <thead>
            <tr>
              {!readOnly && <th></th>}
              <th>Station</th><th>BTM prism id</th><th>Field name</th><th>Role</th>
              <th>Physical point</th><th>Engine id</th><th>Linked prisms</th><th>State</th>
              <th>Dispersion H/V (mm)</th><th>Decision source</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const pp = pointById.get(t.physicalPointId);
              const engineName = resolveEngineName(t, physicalPoints);
              const prov = provByEngine.get(engineName);
              const disp = prov && prov.perStation.length > 1
                ? { h: prov.spreadHorizontalM, v: prov.spreadVerticalM } : undefined;
              const inconsistent = disp && disp.h > 0.02;
              const sameNameElsewhere = targets.some((x) => x.id !== t.id
                && x.rawName === t.rawName && x.physicalPointId !== t.physicalPointId);
              return (
                <tr key={t.id} className={cls(inconsistent && 'bg-rose-50/60')}>
                  {!readOnly && (
                    <td><input type="checkbox" checked={selected.has(t.id)}
                      onChange={(e) => {
                        const n = new Set(selected);
                        if (e.target.checked) n.add(t.id); else n.delete(t.id);
                        setSelected(n);
                      }} /></td>
                  )}
                  <td className="font-medium">{t.stationIds.join(', ')}</td>
                  <td className="text-2xs">{t.btmPrismId}</td>
                  <td className="font-medium">{t.rawName}
                    {sameNameElsewhere && (
                      <span title="Same field name used elsewhere for a DIFFERENT physical point" className="ml-1 text-amber-600">≠</span>
                    )}
                  </td>
                  <td><Badge>{t.role}</Badge></td>
                  <td>{pp?.label ?? '-'}</td>
                  <td className="font-medium">{engineName}</td>
                  <td className="text-center">{pp?.btmPrismIds.length ?? 1}</td>
                  <td><Badge tone={STATE_TONE[pp?.state ?? 'unresolved']}>{inconsistent ? 'inconsistent' : pp?.state ?? '-'}</Badge></td>
                  <td className="text-right">{disp ? `${fmtMm(disp.h, 1)} / ${fmtMm(disp.v, 1)}` : '-'}</td>
                  <td className="max-w-[16rem] whitespace-normal text-2xs" title={pp?.rationale}>
                    {pp?.source ?? '-'}{pp?.decidedBy ? ` (${pp.decidedBy}${pp.decidedAt ? `, ${pp.decidedAt.slice(0, 10)}` : ''})` : ''}
                    {pp?.rationale ? <div className="text-slate-400">{pp.rationale}</div> : null}
                  </td>
                  <td>
                    {!readOnly && (pp?.btmPrismIds.length ?? 0) > 1 && (
                      <Button size="xs" variant="danger"
                        onClick={() => apply(
                          unlinkPrism(state, t.id, user, `Unlinked ${t.rawName} from ${pp?.label}`),
                          `Unlinked ${t.rawName} (${t.stationIds[0]}) from point ${pp?.label}`,
                        )}>
                        Unlink
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </div>

      {/* suggestions */}
      {suggestions.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-semibold text-slate-600">Link suggestions (never applied automatically)</div>
          <div className="space-y-1">
            {suggestions.map((sg) => {
              const ts = targets.filter((t) => sg.btmPrismIds.includes(t.btmPrismId));
              const key = sg.btmPrismIds.join('+');
              return (
                <div key={key} className="flex items-center justify-between gap-2 rounded-md bg-sky-50 px-3 py-2 text-xs ring-1 ring-sky-200">
                  <div>
                    <span className="font-medium">{ts.map((t) => `${t.stationIds[0]}/${t.rawName}`).join(' + ')}</span>
                    <span className="ml-2 text-sky-700">confidence {(sg.confidence * 100).toFixed(0)}%</span>
                    <div className="text-2xs text-slate-500">{sg.rationale}</div>
                  </div>
                  {!readOnly && (
                    <div className="flex gap-1">
                      <Button size="xs" variant="primary" onClick={() => apply(
                        linkAsSamePoint(state, ts.map((t) => t.id), user, 'suggestion', sg.rationale, sg.confidence),
                        `Accepted proximity suggestion: ${ts.map((t) => t.rawName).join(' = ')}`,
                      )}>Accept link</Button>
                      <Button size="xs" onClick={() => setDismissed(new Set([...dismissed, key]))}>Refuse</Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* connectivity */}
      {stations.length > 1 && (
        <div className="mt-3 text-xs">
          <span className="font-semibold text-slate-600">Station connectivity via shared points: </span>
          {connectivity.connected
            ? <Badge tone="Success">connected ({connectivity.sharedPoints.length} shared point(s))</Badge>
            : <Badge tone="FAIL">{connectivity.components.length} independent components: {connectivity.components.map((c) => c.join('+')).join(' | ')}</Badge>}
          {connectivity.sharedPoints.length > 0 && (
            <span className="ml-2 text-2xs text-slate-400">
              {connectivity.sharedPoints.map((s) => `${s.engineName} (${s.stationIds.join('↔')})`).join(' · ')}
            </span>
          )}
        </div>
      )}

      {/* advanced options */}
      {!readOnly && (
        <div className="mt-3 border-t border-slate-100 pt-2">
          <button className="text-2xs text-slate-400 hover:text-slate-600" onClick={() => setAdvancedOpen(!advancedOpen)}>
            {advancedOpen ? '▾' : '▸'} Advanced options
          </button>
          {advancedOpen && (
            <div className="mt-2">
              <Button size="xs" disabled={identicalNameGroups.length === 0}
                onClick={() => setLinkAllPreview(identicalNameGroups)}>
                Link all identical names... ({identicalNameGroups.length} group(s))
              </Button>
              <span className="ml-2 text-2xs text-amber-600">
                Never applied by default: in some projects the same name (e.g. MPO001) is reused for
                different prisms. A preview and explicit confirmation are required.
              </span>
            </div>
          )}
        </div>
      )}

      {linkAllPreview && (
        <Modal open onClose={() => setLinkAllPreview(null)} title="Link all identical names - preview & impacts"
          footer={
            <>
              <Button onClick={() => setLinkAllPreview(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => {
                let next: MappingState = state;
                for (const g of linkAllPreview) {
                  next = linkAsSamePoint(next, g.ids, user, 'manual',
                    `Bulk "link all identical names" on field name ${g.rawName} (explicitly confirmed)`);
                }
                onChange(next.targets, next.physicalPoints,
                  `Bulk-linked ${linkAllPreview.length} identical-name group(s) after explicit confirmation`);
                setLinkAllPreview(null);
              }}>I understand the risk - link {linkAllPreview.length} group(s)</Button>
            </>
          }>
          <Callout tone="warning">
            This will merge every group below into one physical point. If two stations reuse the same
            field name for different prisms (frequent on French sites), this creates a WRONG identity
            that degrades the network. Check the dispersion column first.
          </Callout>
          <TableWrap maxH="max-h-56">
            <thead><tr><th>Field name</th><th>Prisms</th><th>Independent estimates distance</th></tr></thead>
            <tbody>
              {linkAllPreview.map((g) => {
                const ts = targets.filter((t) => g.ids.includes(t.id));
                const coords = perPrismCoordinates(state, provisional);
                const cs = ts.map((t) => coords.get(t.btmPrismId)).filter((x): x is NonNullable<typeof x> => !!x);
                const d = cs.length === 2 ? Math.hypot(cs[0].e - cs[1].e, cs[0].n - cs[1].n, cs[0].h - cs[1].h) : undefined;
                return (
                  <tr key={g.rawName} className={d !== undefined && d > 0.05 ? 'bg-rose-50' : ''}>
                    <td className="font-medium">{g.rawName}</td>
                    <td>{ts.map((t) => `${t.stationIds[0]} (${t.btmPrismId})`).join(' + ')}</td>
                    <td>{d === undefined ? 'unknown (compute initial coordinates first)'
                      : d > 1 ? `${d.toFixed(1)} m - almost certainly DIFFERENT points` : `${fmtMm(d, 0)} mm`}</td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        </Modal>
      )}
    </Card>
  );
}

import React, { useMemo, useState } from 'react';
import type {
  PhysicalPoint, ProvisionalCoordinate, RawObservation, Station, StationPrismSetup, TargetMapping,
} from '../types/domain';
import {
  linkAsSamePoint, networkConnectivity, unlinkPrism, validatePointMapping, type MappingState,
} from '../engine/pointIdentity';
import { checkLocalGeometry, localPoints, type GeometryCheck, type SeedPair } from '../engine/localGeometry';
import { Badge, Button, Callout, Card, Field, NumberInput, Select, TableWrap } from './ui';
import { fmtMm } from '../lib/format';

export function PointIdentityPanel({
  stations, targets, physicalPoints, provisional, observations = [], setups = [], readOnly, user, onChange,
}: {
  stations: Station[];
  targets: TargetMapping[];
  physicalPoints: PhysicalPoint[];
  provisional: ProvisionalCoordinate[];
  observations?: RawObservation[];
  setups?: StationPrismSetup[];
  readOnly?: boolean;
  user: string;
  onChange: (targets: TargetMapping[], physicalPoints: PhysicalPoint[], summary: string) => void;
}) {
  const [stationA, setStationA] = useState(stations[0]?.id ?? '');
  const [stationB, setStationB] = useState(stations[1]?.id ?? '');
  const [seedA, setSeedA] = useState('');
  const [seedB, setSeedB] = useState('');
  const [seeds, setSeeds] = useState<SeedPair[]>([]);
  const [horizontalToleranceMm, setHorizontalToleranceMm] = useState(50);
  const [verticalToleranceMm, setVerticalToleranceMm] = useState(50);
  const [check, setCheck] = useState<GeometryCheck | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());

  const state: MappingState = { targets, physicalPoints };
  const targetById = useMemo(() => new Map(targets.map((target) => [target.id, target])), [targets]);
  const targetA = targets.filter((target) => target.stationIds.includes(stationA));
  const targetB = targets.filter((target) => target.stationIds.includes(stationB));
  const shared = physicalPoints.filter((point) => {
    const contributors = targets.filter((target) => point.btmPrismIds.includes(target.btmPrismId));
    return new Set(contributors.flatMap((target) => target.stationIds)).size > 1;
  });
  const connectivity = useMemo(() => networkConnectivity({ stations, targets, physicalPoints } as never), [stations, targets, physicalPoints]);
  const issues = useMemo(() => validatePointMapping({ stations, targets, physicalPoints } as never), [stations, targets, physicalPoints]);
  const addSeed = () => {
    if (!seedA || !seedB || seeds.some((seed) => seed.aTargetId === seedA || seed.bTargetId === seedB)) return;
    setSeeds([...seeds, { aTargetId: seedA, bTargetId: seedB }]);
    setSeedA(''); setSeedB(''); setCheck(null);
  };
  const runCheck = () => {
    const result = checkLocalGeometry(
      localPoints(stationA, observations, stations, targets, setups),
      localPoints(stationB, observations, stations, targets, setups),
      seeds, horizontalToleranceMm / 1000, verticalToleranceMm / 1000,
    );
    setCheck(result);
    setAccepted(new Set(result.candidates.map((candidate) => `${candidate.aTargetId}|${candidate.bTargetId}`)));
  };
  const confirmCandidates = () => {
    if (!check) return;
    let next: MappingState = state;
    let count = 0;
    for (const candidate of check.candidates) {
      const key = `${candidate.aTargetId}|${candidate.bTargetId}`;
      if (!accepted.has(key)) continue;
      next = linkAsSamePoint(next, [candidate.aTargetId, candidate.bTargetId], user, 'suggestion',
        `Validated from station-local geometry (${fmtMm(candidate.horizontalResidualM, 1)} H, ${fmtMm(candidate.verticalResidualM, 1)} V)`, candidate.confidence);
      count++;
    }
    onChange(next.targets, next.physicalPoints, `Confirmed ${count} common physical point(s) after geometric verification`);
    setSeeds([]); setCheck(null); setAccepted(new Set());
  };

  if (stations.length < 2) {
    return <Card title="Physical point identity"><Callout tone="info">Single-station processing: every BTM target remains a distinct physical point. No cross-station mapping is required.</Callout></Card>;
  }

  return (
    <Card title="Common physical points">
      <Callout tone="info">
        Same target names are never linked automatically. First identify at least <strong>two known common points</strong>
        between two stations, then let BTM compare the station-local geometry. Three well-spread points are recommended
        because two solve the relative frame without any redundancy.
      </Callout>

      {!readOnly && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="First station"><Select value={stationA} onChange={(value) => { setStationA(value); setSeeds([]); setCheck(null); }}
              options={stations.filter((station) => station.id !== stationB).map((station) => ({ value: station.id, label: station.name }))} /></Field>
            <Field label="Known point on first station"><Select value={seedA} onChange={setSeedA}
              options={[{ value: '', label: 'Select a target…' }, ...targetA.map((target) => ({ value: target.id, label: target.rawName }))]} /></Field>
            <Field label="Second station"><Select value={stationB} onChange={(value) => { setStationB(value); setSeeds([]); setCheck(null); }}
              options={stations.filter((station) => station.id !== stationA).map((station) => ({ value: station.id, label: station.name }))} /></Field>
            <Field label="Same point on second station"><Select value={seedB} onChange={setSeedB}
              options={[{ value: '', label: 'Select a target…' }, ...targetB.map((target) => ({ value: target.id, label: target.rawName }))]} /></Field>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="xs" disabled={!seedA || !seedB} onClick={addSeed}>Add known pair</Button>
            {seeds.map((seed, index) => (
              <span key={`${seed.aTargetId}|${seed.bTargetId}`} className="rounded-full bg-white px-2 py-1 text-2xs ring-1 ring-slate-200">
                {targetById.get(seed.aTargetId)?.rawName} = {targetById.get(seed.bTargetId)?.rawName}
                <button className="ml-2 text-rose-600" onClick={() => { setSeeds(seeds.filter((_, i) => i !== index)); setCheck(null); }}>×</button>
              </span>
            ))}
            <Badge tone={seeds.length >= 3 ? 'Success' : seeds.length === 2 ? 'Provisional' : 'Draft'}>
              {seeds.length < 2 ? `${2 - seeds.length} more required` : seeds.length === 2 ? 'Weak geometry' : 'Redundant geometry'}
            </Badge>
          </div>
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-slate-600">Matching tolerances</summary>
            <div className="mt-2 flex gap-3">
              <Field label="Horizontal" unit="mm"><NumberInput value={horizontalToleranceMm} onChange={(value) => setHorizontalToleranceMm(Math.max(1, value))} /></Field>
              <Field label="Vertical" unit="mm"><NumberInput value={verticalToleranceMm} onChange={(value) => setVerticalToleranceMm(Math.max(1, value))} /></Field>
            </div>
          </details>
          <div className="mt-3"><Button variant="primary" disabled={seeds.length < 2} onClick={runCheck}>Check geometry</Button></div>
        </div>
      )}

      {check && (
        <div className="mt-3">
          <Callout tone={check.status === 'ready' ? 'success' : check.status === 'weak' ? 'warning' : 'error'}>
            {check.message}{check.rmsM !== undefined ? ` RMS 3D: ${fmtMm(check.rmsM, 1)}.` : ''}
          </Callout>
          {check.candidates.length > 0 && <TableWrap maxH="max-h-72">
            <thead><tr><th>Use</th><th>{stationA}</th><th>{stationB}</th><th>H residual</th><th>V residual</th><th>Confidence</th><th>Evidence</th></tr></thead>
            <tbody>{check.candidates.map((candidate) => {
              const key = `${candidate.aTargetId}|${candidate.bTargetId}`;
              return <tr key={key}>
                <td><input type="checkbox" checked={accepted.has(key)} onChange={(event) => {
                  const next = new Set(accepted); event.target.checked ? next.add(key) : next.delete(key); setAccepted(next);
                }} /></td>
                <td className="font-medium">{targetById.get(candidate.aTargetId)?.rawName}</td>
                <td className="font-medium">{targetById.get(candidate.bTargetId)?.rawName}</td>
                <td>{fmtMm(candidate.horizontalResidualM, 1)}</td><td>{fmtMm(candidate.verticalResidualM, 1)}</td>
                <td>{Math.round(candidate.confidence * 100)}%</td><td>{candidate.seed ? 'Manual seed' : 'Geometry candidate'}</td>
              </tr>;
            })}</tbody>
          </TableWrap>}
          {!readOnly && <div className="mt-2"><Button variant="primary" disabled={accepted.size === 0} onClick={confirmCandidates}>Confirm selected common points</Button></div>}
        </div>
      )}

      <div className="mt-4 text-xs font-semibold text-slate-700">Confirmed shared points only</div>
      {shared.length === 0 ? <p className="mt-1 text-xs text-slate-500">No shared physical point confirmed yet. Individual targets stay visible in the target table above.</p> : (
        <TableWrap maxH="max-h-72"><thead><tr><th>Physical point</th><th>Engine ID</th><th>Contributors</th><th>Decision</th><th></th></tr></thead>
          <tbody>{shared.map((point) => {
            const contributors = targets.filter((target) => point.btmPrismIds.includes(target.btmPrismId));
            return <tr key={point.id}><td className="font-medium">{point.label}</td><td className="font-mono">{point.engineName}</td>
              <td>{contributors.map((target) => `${target.stationIds[0]}/${target.rawName}`).join(' · ')}</td>
              <td>{point.source}{point.rationale ? <div className="max-w-xl whitespace-normal text-2xs text-slate-500">{point.rationale}</div> : null}</td>
              <td>{!readOnly && contributors.map((target) => <span key={target.id} className="mr-1 inline-block"><Button size="xs" variant="danger"
                onClick={() => {
                  const next = unlinkPrism(state, target.id, user, `Removed ${target.rawName} from ${point.label}`);
                  onChange(next.targets, next.physicalPoints, `Unlinked ${target.stationIds[0]}/${target.rawName}`);
                }}>Unlink {target.stationIds[0]}</Button></span>)}</td></tr>;
          })}</tbody></TableWrap>
      )}

      <div className="mt-3 text-xs"><span className="font-semibold text-slate-600">Network connectivity: </span>
        {connectivity.connected ? <Badge tone="Success">Connected by {connectivity.sharedPoints.length} shared point(s)</Badge>
          : <Badge tone="FAIL">{connectivity.components.length} independent station groups</Badge>}
      </div>
      {issues.filter((issue) => issue.level === 'blocking').map((issue, index) => <Callout key={index} tone="error">{issue.message}</Callout>)}
    </Card>
  );
}

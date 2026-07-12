import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../store/AppStore';
import { Badge, Button, Card, StatusBadge, TableWrap } from '../components/ui';
import { fmtDateTime } from '../lib/format';

export function ProcessingsPage({ administration }: { administration?: boolean }) {
  const { state, actions } = useApp();
  const nav = useNavigate();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-800">
            {administration ? 'Administration' : 'Processings'}
          </h1>
          <p className="text-xs text-slate-500">
            {administration
              ? 'Open a processing to administer configurations, versions, runs and analysis.'
              : 'Topographic adjustment processings configured in BTM.'}
          </p>
        </div>
        <Button variant="primary" onClick={() => nav('/create')}>+ Create processing</Button>
      </div>

      <TableWrap>
        <thead>
          <tr>
            <th>Name</th><th>Type</th><th>Site / Network</th><th>Stations</th>
            <th>Active version</th><th>Status</th><th>Last run</th><th>Next run</th>
            <th>Last quality</th><th>Provisional</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {state.processings.map((p) => {
            const lastRun = state.runs.find((r) => r.id === p.lastRunId);
            const activeCfg = state.configVersions.find((c) => c.id === p.activeConfigurationVersionId);
            const provisionalCount = state.results.filter((r) => r.processingId === p.id && r.provisional && r.current).length;
            const nextRun = p.active && activeCfg
              ? activeCfg.runPolicy.triggerMode === 'manual' ? 'Manual only'
                : activeCfg.runPolicy.triggerMode === 'schedule'
                  ? `every ${activeCfg.runPolicy.scheduleEveryMinutes} min`
                  : 'on new data (event-driven)'
              : '-';
            return (
              <tr key={p.id}>
                <td>
                  <Link to={`/processings/${p.id}`} className="font-medium text-brand-700 hover:underline">{p.name}</Link>
                  <div className="text-2xs text-slate-400">{p.networkKind}</div>
                </td>
                <td>{p.type}</td>
                <td>{p.site}<div className="text-2xs text-slate-400">{p.network}</div></td>
                <td className="text-center">{activeCfg?.stations.length ?? '-'}</td>
                <td>{activeCfg ? <Badge tone={activeCfg.status}>{activeCfg.label}</Badge> : '-'}</td>
                <td><StatusBadge status={p.status} /></td>
                <td>
                  {lastRun ? (
                    <Link className="text-brand-700 hover:underline" to={`/runs/${lastRun.id}`}>
                      {fmtDateTime(lastRun.outputSlot)}
                    </Link>
                  ) : '-'}
                </td>
                <td className="text-2xs">{nextRun}</td>
                <td>{lastRun ? <StatusBadge status={lastRun.status} /> : '-'}</td>
                <td className="text-center">{provisionalCount || '-'}</td>
                <td>
                  <div className="flex gap-1">
                    <Button size="xs" onClick={() => nav(`/processings/${p.id}`)}>Open</Button>
                    <Button size="xs" variant="primary" disabled={p.status === 'Archived'}
                      onClick={async () => {
                        const run = await actions.executeRun(p.id, { trigger: 'manual' });
                        if (run) nav(`/runs/${run.id}`);
                      }}>
                      Run now
                    </Button>
                    <Button size="xs" disabled={p.status === 'Archived'}
                      onClick={() => actions.setProcessingActive(p.id, !p.active)}>
                      {p.active ? 'Deactivate' : 'Activate'}
                    </Button>
                    <Button size="xs" onClick={() => actions.duplicateProcessing(p.id)}>Duplicate</Button>
                    <Button size="xs" variant="danger" disabled={p.status === 'Archived'}
                      onClick={() => actions.archiveProcessing(p.id)}>Archive</Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>

      <Card title="Demo scenario helpers" className="max-w-3xl">
        <p className="mb-2 text-xs text-slate-500">
          The ATS34 project is pre-loaded from the BTM database (2026-07-08 → 2026-07-10).
          Scenario data (late station data, late environmental data, corrupted observation)
          can be driven from the <Link to="/dev/fixture" className="text-brand-700 hover:underline">developer data screen</Link>,
          which is not part of the product navigation.
        </p>
      </Card>
    </div>
  );
}

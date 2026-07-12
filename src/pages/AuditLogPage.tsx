import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../store/AppStore';
import { Badge, Select, TableWrap, TextInput } from '../components/ui';
import { fmtDateTime } from '../lib/format';

export function AuditLogPage() {
  const { state } = useApp();
  const [category, setCategory] = useState('all');
  const [processingId, setProcessingId] = useState('all');
  const [search, setSearch] = useState('');

  const events = state.audit.filter((e) =>
    (category === 'all' || e.category === category)
    && (processingId === 'all' || e.processingId === processingId)
    && (!search || `${e.action} ${e.details}`.toLowerCase().includes(search.toLowerCase())));

  const categories = [...new Set(state.audit.map((e) => e.category))];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Audit log</h1>
        <p className="text-xs text-slate-500">
          Full traceability: source data deliveries, corrections, configurations, runs, results,
          analysis sessions and template actions.
        </p>
      </div>
      <div className="flex gap-2">
        <Select value={category} onChange={setCategory}
          options={[{ value: 'all', label: 'All categories' },
            ...categories.map((c) => ({ value: c, label: c }))]} />
        <Select value={processingId} onChange={setProcessingId}
          options={[{ value: 'all', label: 'All processings' },
            ...state.processings.map((p) => ({ value: p.id, label: p.name }))]} />
        <TextInput placeholder="search..." value={search} onChange={(e) => setSearch(e.target.value)} className="!w-64" />
      </div>
      <TableWrap maxH="max-h-[36rem]">
        <thead><tr><th>Time</th><th>User</th><th>Category</th><th>Action</th><th>Processing</th><th>Details</th></tr></thead>
        <tbody>
          {events.map((e) => {
            const proc = state.processings.find((p) => p.id === e.processingId);
            return (
              <tr key={e.id}>
                <td className="text-2xs">{fmtDateTime(e.at)}</td>
                <td>{e.user}</td>
                <td><Badge>{e.category}</Badge></td>
                <td className="font-medium">{e.action}</td>
                <td>{proc ? <Link to={`/processings/${proc.id}`} className="text-brand-700 hover:underline">{proc.name}</Link> : '-'}</td>
                <td className="max-w-xl whitespace-normal text-2xs">{e.details}</td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>
    </div>
  );
}

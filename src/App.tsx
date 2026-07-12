import React from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { useApp } from './store/AppStore';
import { ProcessingsPage } from './pages/ProcessingsPage';
import { CreateProcessingWizard } from './pages/wizard/CreateProcessingWizard';
import { ProcessingAdminPage } from './pages/ProcessingAdminPage';
import { RunResultsPage } from './pages/RunResultsPage';
import { AnalysisLabPage } from './pages/AnalysisLabPage';
import { AnalysisSessionPage } from './pages/AnalysisSessionPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { ReprocessPage } from './pages/ReprocessPage';
import { ArchitecturePage } from './pages/ArchitecturePage';
import { DevDataPage } from './pages/DevDataPage';
import { cls } from './components/ui';

const NAV = [
  { to: '/', label: 'Processings', end: true },
  { to: '/create', label: 'Create processing' },
  { to: '/administration', label: 'Administration' },
  { to: '/analysis', label: 'Analysis Lab' },
  { to: '/templates', label: 'Templates' },
  { to: '/audit', label: 'Audit log' },
];

export default function App() {
  const { state } = useApp();
  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 z-30 flex w-52 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-4">
          <div className="text-sm font-bold text-brand-700">BlueTrust Monitoring</div>
          <div className="text-2xs text-slate-400">Topographic Adjustment Processing</div>
        </div>
        <nav className="flex-1 space-y-0.5 p-2">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => cls(
                'block rounded-md px-3 py-2 text-xs font-medium',
                isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50',
              )}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-1 border-t border-slate-100 p-3 text-2xs text-slate-400">
          <NavLink to="/architecture" className="block hover:text-brand-600">Target BTM architecture</NavLink>
          <div>Signed in as <span className="font-medium text-slate-500">{state.user}</span></div>
          <div className="text-slate-300">Mockup - local engine, IndexedDB persistence</div>
        </div>
      </aside>
      <main className="ml-52 flex-1 p-6">
        {state.busy && (
          <div className="fixed right-4 top-4 z-50 rounded-md bg-slate-900/90 px-4 py-2 text-xs text-white shadow-lg">
            <span className="mr-2 inline-block h-2 w-2 animate-ping rounded-full bg-emerald-400" />
            {state.busy}
          </div>
        )}
        {!state.booted ? (
          <div className="p-12 text-center text-sm text-slate-400">Loading BTM data...</div>
        ) : (
          <Routes>
            <Route path="/" element={<ProcessingsPage />} />
            <Route path="/create" element={<CreateProcessingWizard />} />
            <Route path="/administration" element={<ProcessingsPage administration />} />
            <Route path="/processings/:id" element={<ProcessingAdminPage />} />
            <Route path="/processings/:id/reprocess" element={<ReprocessPage />} />
            <Route path="/runs/:runId" element={<RunResultsPage />} />
            <Route path="/analysis" element={<AnalysisLabPage />} />
            <Route path="/analysis/:sessionId" element={<AnalysisSessionPage />} />
            <Route path="/templates" element={<TemplatesPage />} />
            <Route path="/audit" element={<AuditLogPage />} />
            <Route path="/architecture" element={<ArchitecturePage />} />
            <Route path="/dev/fixture" element={<DevDataPage />} />
            <Route path="*" element={<div className="text-sm text-slate-500">Page not found.</div>} />
          </Routes>
        )}
      </main>
    </div>
  );
}

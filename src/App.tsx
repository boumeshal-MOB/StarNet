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
  { to: '/', label: 'Processings', icon: 'P', end: true },
  { to: '/create', label: 'Create processing', icon: '+' },
  { to: '/administration', label: 'Administration', icon: 'A' },
  { to: '/analysis', label: 'Analysis Lab', icon: '∿' },
  { to: '/templates', label: 'Templates', icon: 'T' },
  { to: '/audit', label: 'Audit log', icon: 'L' },
];

export default function App() {
  const { state } = useApp();
  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="fixed inset-y-0 z-30 flex w-60 flex-col bg-slate-950 text-white shadow-xl">
        <div className="border-b border-white/10 px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 font-bold text-white shadow-lg shadow-brand-950/30">B</div>
            <div>
              <div className="text-sm font-bold tracking-tight">BlueTrust Monitoring</div>
              <div className="text-2xs text-slate-400">Topographic adjustment</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          <div className="px-3 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Workspace</div>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => cls(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium transition-colors',
                isActive ? 'bg-brand-500 text-white shadow-sm' : 'text-slate-300 hover:bg-white/5 hover:text-white',
              )}>
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-white/10 text-2xs font-bold">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-2 border-t border-white/10 p-4 text-2xs text-slate-400">
          <NavLink to="/architecture" className="block rounded-md px-2 py-1.5 hover:bg-white/5 hover:text-white">Target BTM architecture</NavLink>
          <div className="rounded-lg bg-white/5 p-3">
            <div>Signed in as <span className="font-medium text-slate-200">{state.user}</span></div>
            <div className="mt-1 text-slate-500">Prototype · local engine</div>
          </div>
        </div>
      </aside>
      <main className="ml-60 min-w-0 flex-1 p-7 xl:p-9">
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

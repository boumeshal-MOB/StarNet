import React from 'react';
import { Callout, Card, TableWrap } from '../components/ui';

const FLOW = [
  { id: 'db', label: 'BTM database / APIs', desc: 'observations, lookup, header, env. data', x: 20 },
  { id: 'builder', label: 'Input Builder (server)', desc: 'generates native .DAT + project config', x: 190 },
  { id: 'worker', label: 'Star*Net Ultimate worker', desc: 'isolated workspace, job queue, licence lock, health status', x: 360 },
  { id: 'parsers', label: 'Native output parsers', desc: '.PTS/.DMP, .LST, .ERR + engine return code', x: 530 },
  { id: 'store', label: 'BTM result store', desc: 'coordinates, residuals, QC, artifacts, statuses', x: 700 },
  { id: 'front', label: 'BTM front-end', desc: 'structured data via API only', x: 870 },
];

const LEGACY: [string, string][] = [
  ['Project Manager', 'Processing & version administration (this mockup)'],
  ['APSWin/TDEF pre-processing scripts', 'BTM ingestion & normalization pipeline (outside the adjustment processing) - REPLACED'],
  ['Local import folders', 'Observations live in the BTM database; no folder in the front-end - REMOVED'],
  ['Local output folders', 'Server-side artifact storage attached to each run; invisible to standard users - REPLACED'],
  ['SQL table NewData', 'Raw observations available and not yet consumed for an output slot - REPLACED'],
  ['SQL table Data', 'Immutable historical observations linked to runs; no destructive move - REPLACED'],
  ['Adjustment Timer', 'Event-driven / schedule / manual trigger - REPLACED'],
  ['Interval', 'Output-slot construction and temporal policy, distinct from the trigger - REPLACED'],
  ['Target/Lookup Table', 'Targets & Prisms tab: three names, constant, height, inclusion, publication - REPLACED'],
  ['Header Block', 'Versioned Reference Sets with per-component coordinates and sigmas - REPLACED'],
  ['New point auto-added unchecked', 'Target "To review", excluded by default - REPLACED'],
  ['Temperature/pressure exported as .SCALE', 'Prism then atmosphere applied to the EDM slope distance; horizontal datum scale kept separate - CORRECTED'],
  ['Prism constant added to Sd', 'Station-Prism Setup and audited differential correction - REPLACED'],
  ['.DAT generation', 'Input Builder (local engine in the mockup, server-side in target BTM) - REPLACED'],
  ['Local Star*Net call', 'Mockup: local weighted LSQ engine; production: Star*Net Ultimate worker - REPLACED'],
  ['Custom Argus/ChiSquare files', 'Structured results parsed from the engine\'s native outputs - REMOVED'],
  ['.LST/.ERR, coordinates, ellipses', 'Runs, Quality Control, Residuals, Network View and artifacts - REPLACED'],
  ['Reprocessing from database', 'Reprocess by date range with per-slot configuration versions - REPLACED'],
  ['Single lock around Star*Net', 'Server-side job queue, worker lock, licence and health status - REPLACED'],
  ['Cycle start timestamp', 'Explicit output grid (00/30) with preserved source timestamps - REPLACED'],
  ['Local log files', 'Audit log, technical status, engine log and BTM observability - REPLACED'],
];

export function ArchitecturePage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Target BTM architecture (server-side, future)</h1>
        <p className="text-xs text-slate-500">
          Out of the mockup's implementation scope: this view documents the production flow the mockup
          screens and statuses are designed for. The browser never manipulates computation files.
        </p>
      </div>

      <Card title="Production flow">
        <div className="overflow-x-auto">
          <svg viewBox="0 0 1040 190" className="min-w-[900px] w-full">
            <defs>
              <marker id="aarrow" viewBox="0 0 8 8" refX={7} refY={4} markerWidth={7} markerHeight={7} orient="auto">
                <path d="M0 0 L8 4 L0 8 z" fill="#64748b" />
              </marker>
            </defs>
            {FLOW.map((b, i) => (
              <g key={b.id}>
                <rect x={b.x} y={40} width={150} height={84} rx={8} fill="#eef6ff" stroke="#337ef7" strokeWidth={1.2} />
                <text x={b.x + 75} y={62} textAnchor="middle" fontSize={11} fontWeight={700} fill="#154ad9">
                  {b.label.split(' (')[0]}
                </text>
                {wrap(b.desc, 24).map((line, j) => (
                  <text key={j} x={b.x + 75} y={80 + j * 12} textAnchor="middle" fontSize={9} fill="#475569">{line}</text>
                ))}
                {i < FLOW.length - 1 && (
                  <line x1={b.x + 150} y1={82} x2={FLOW[i + 1].x} y2={82} stroke="#64748b" strokeWidth={1.4} markerEnd="url(#aarrow)" />
                )}
              </g>
            ))}
            <text x={20} y={160} fontSize={9.5} fill="#64748b">
              Archived per run for reproducibility: .DAT input, engine project/config, native outputs (.PTS/.DMP, .LST, .ERR), return code.
            </text>
            <text x={20} y={175} fontSize={9.5} fill="#64748b">
              The mockup implements the same objects, screens and statuses with a local weighted least-squares engine and IndexedDB.
            </text>
          </svg>
        </div>
      </Card>

      <Card title="Mockup vs target boundary">
        <div className="grid grid-cols-2 gap-4 text-xs">
          <Callout tone="info">
            <strong>Mockup (validated now):</strong> autonomous front-end · ATS34 data pre-loaded in a
            local repository simulating BTM APIs · no visible import · local weighted LSQ engine in a
            Web Worker · IndexedDB persistence · no Star*Net call.
          </Callout>
          <Callout tone="success">
            <strong>Target BTM:</strong> the user selects stations/prisms/references already stored in
            BTM · backend fetches observations · server Input Builder generates the native inputs ·
            Star*Net Ultimate runs on a licensed worker · parsers store structured results · the
            front-end receives API data only · no legacy .bat scripts, no custom Argus/ChiSquare files.
          </Callout>
        </div>
      </Card>

      <Card title="Explicit legacy StarAdjust coverage">
        <TableWrap maxH="max-h-[30rem]">
          <thead><tr><th>Legacy function</th><th>Mockup / target BTM equivalent</th></tr></thead>
          <tbody>
            {LEGACY.map(([a, b]) => (
              <tr key={a}><td className="font-medium">{a}</td><td className="whitespace-normal">{b}</td></tr>
            ))}
          </tbody>
        </TableWrap>
        <p className="mt-2 text-2xs text-slate-500">
          Every legacy function is explicitly REPLACED or REMOVED - none is silently forgotten.
          Legacy custom files may only be used to compare and validate the mockup's results.
        </p>
      </Card>
    </div>
  );
}

function wrap(s: string, n: number): string[] {
  const words = s.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > n) { lines.push(cur.trim()); cur = w; }
    else cur += ' ' + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}

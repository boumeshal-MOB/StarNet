// Developer-only screen (not in the product navigation): fixture provenance,
// workbook conversion checks and scenario drivers for the demo.
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../store/AppStore';
import { Badge, Button, Callout, Card, KV, TableWrap } from '../components/ui';
import { getFixture } from '../data/repository';
import { BAD_OBS_SLOT, ATS36_SILENT_FROM, ENV_GAP_FROM } from '../data/fixture';
import { fmtDateTime } from '../lib/format';

export function DevDataPage() {
  const { state, actions } = useApp();
  const nav = useNavigate();
  const fixture = getFixture();
  const [delivered, setDelivered] = useState<string | null>(null);
  const demoProc = state.processings.find((p) => p.id === 'proc-nte-ats34');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Developer data screen</h1>
        <p className="text-xs text-slate-500">
          Technical screen outside the product navigation. Shows the fixture provenance and drives
          the demo scenarios. BTM users never see this screen or any file import.
        </p>
      </div>

      <Card title="Fixture provenance">
        <KV items={[
          ['Source workbook (structure)', fixture.provenance.workbook],
          ['Generator', fixture.provenance.generator],
          ['Seed', String(fixture.provenance.seed)],
          ['Raw observations', String(fixture.rawObservations.length)],
          ['Late observations (scenario D bucket)', String(fixture.lateObservations.length)],
          ['Environmental records', String(fixture.environmental.length)],
          ['Late environmental (scenario G bucket)', String(fixture.lateEnvironmental.length)],
          ['Lookup rows', String(fixture.lookup.length)],
          ['Header rows', String(fixture.header.length)],
          ['Conversion script', 'scripts/convert-ats34.mjs (real workbook → src/data/ats34.generated.json)'],
        ]} />
      </Card>

      <Card title="Workbook conversion validation checks (prism constants)">
        <TableWrap maxH="max-h-40">
          <thead><tr><th>Check</th><th>Expected (m)</th><th>Computed (m)</th><th>Result</th></tr></thead>
          <tbody>
            {fixture.provenance.validationChecks.map((c, i) => (
              <tr key={i}>
                <td>{c.label}</td><td>{c.expected}</td><td>{c.computed}</td>
                <td><Badge tone={c.pass ? 'PASS' : 'FAIL'}>{c.pass ? 'PASS' : 'FAIL'}</Badge></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      <Card title="Demo scenario drivers">
        <div className="space-y-3 text-xs">
          <div className="rounded-md p-3 ring-1 ring-slate-200">
            <div className="font-semibold">Scenario B - corrupted observation</div>
            <p className="mt-1 text-slate-500">
              The observation ATS34 → MP04 at {fmtDateTime(new Date(BAD_OBS_SLOT).toISOString())} carries a +25″ / +4 mm blunder.
              Run the slot from the processing page or analyze it in the <Link className="text-brand-700 underline" to="/analysis">Analysis Lab</Link>:
              the Chi² fails, the standardized residual identifies the observation, auto-correction removes it
              and both attempts stay recorded.
            </p>
            {demoProc && (
              <Button size="xs" variant="primary" onClick={async () => {
                const run = await actions.executeRun(demoProc.id, {
                  trigger: 'manual', slotIso: new Date(BAD_OBS_SLOT).toISOString(),
                  reason: 'Scenario B - corrupted observation slot',
                });
                if (run) nav(`/runs/${run.id}`);
              }}>Run the corrupted slot now</Button>
            )}
          </div>

          <div className="rounded-md p-3 ring-1 ring-slate-200">
            <div className="font-semibold">Scenario D - missing station then catch-up</div>
            <p className="mt-1 text-slate-500">
              ATS36 stops emitting at {fmtDateTime(new Date(ATS36_SILENT_FROM).toISOString())}. Slot 09:00 reuses its last epoch
              (within 45 min) → Provisional result. Deliver the late data below, then use
              "Catch-up" on the slot (processing → Runs & Results) to create "Result V2 - Final after catch-up".
            </p>
            <div className="mt-2 flex gap-2">
              <Button size="xs" disabled={state.delivery.ats36LateDelivered} onClick={() => {
                const n = actions.deliverLateObservations();
                setDelivered(`${n} late ATS36 observations delivered`);
              }}>
                {state.delivery.ats36LateDelivered ? 'Late ATS36 data already delivered' : 'Deliver late ATS36 observations'}
              </Button>
              {demoProc && state.delivery.ats36LateDelivered && (
                <Button size="xs" variant="primary" onClick={async () => {
                  const run = await actions.catchUp(demoProc.id, new Date(ATS36_SILENT_FROM).toISOString(),
                    'Late ATS36 observations arrived - catch-up');
                  if (run) nav(`/runs/${run.id}`);
                }}>Trigger catch-up on slot 09:00</Button>
              )}
            </div>
          </div>

          <div className="rounded-md p-3 ring-1 ring-slate-200">
            <div className="font-semibold">Scenario G - late environmental data</div>
            <p className="mt-1 text-slate-500">
              ATS35 T/P records are missing between {fmtDateTime(new Date(ENV_GAP_FROM).toISOString())} and 09:00
              (policy: wait for late data → provisional). Deliver them below, then catch-up the affected slots
              to recompute with the true atmospheric factor.
            </p>
            <div className="mt-2 flex gap-2">
              <Button size="xs" disabled={state.delivery.ats35EnvDelivered} onClick={() => {
                const n = actions.deliverLateEnvironmental();
                setDelivered(`${n} late T/P records delivered`);
              }}>
                {state.delivery.ats35EnvDelivered ? 'Late T/P already delivered' : 'Deliver late ATS35 T/P'}
              </Button>
              {demoProc && state.delivery.ats35EnvDelivered && (
                <Button size="xs" variant="primary" onClick={async () => {
                  const run = await actions.catchUp(demoProc.id, new Date(ENV_GAP_FROM + 30 * 60000).toISOString(),
                    'Late environmental data arrived - catch-up');
                  if (run) nav(`/runs/${run.id}`);
                }}>Trigger catch-up on slot 08:30</Button>
              )}
            </div>
          </div>

          {delivered && <Callout tone="success">{delivered} (see audit log).</Callout>}
        </div>
      </Card>

      <Card title="Reset demo">
        <p className="mb-2 text-xs text-slate-500">
          Clears IndexedDB (processings, runs, results, sessions, audit) and reloads the seeded demo.
        </p>
        <Button variant="danger" onClick={() => {
          if (confirm('Reset all local demo data?')) void actions.resetDemo();
        }}>Reset demo data</Button>
      </Card>
    </div>
  );
}

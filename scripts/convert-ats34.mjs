#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Development-only converter: turns the real preparation workbook
// "ATS34 Raw Data, Lookup, Header (1).xlsx" into the local fixture JSON.
// This script is NEVER part of the product UI - the BTM user never uploads
// or maps a file. It exists so the synthetic demo fixture can be replaced by
// the real dataset when the workbook is available.
//
// Usage:
//   npm i -D xlsx                       # SheetJS, dev-dependency only
//   node scripts/convert-ats34.mjs "ATS34 Raw Data, Lookup, Header (1).xlsx"
//
// Output: src/data/ats34.generated.json with the shape
//   { rawObservations, lookup, header }
// To plug it in, load that JSON in src/data/repository.ts instead of the
// synthetic generator (see docs/context/02-data-model.md - "Real workbook").
// ---------------------------------------------------------------------------
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const wbPath = process.argv[2];
if (!wbPath) {
  console.error('Usage: node scripts/convert-ats34.mjs <workbook.xlsx>');
  process.exit(1);
}

let XLSX;
try {
  XLSX = await import('xlsx');
} catch {
  console.error('SheetJS is not installed. Run: npm i -D xlsx');
  process.exit(1);
}

const wb = XLSX.readFile(wbPath, { cellDates: true });
const sheet = (name) => {
  const found = wb.SheetNames.find((n) => n.toLowerCase().includes(name.toLowerCase()));
  if (!found) throw new Error(`Sheet "${name}" not found. Sheets: ${wb.SheetNames.join(', ')}`);
  return XLSX.utils.sheet_to_json(wb.Sheets[found], { defval: null });
};

// ------------------------------------------------------ Raw Observations ---
const rawRows = sheet('Raw');
const rawObservations = rawRows.map((r, i) => ({
  id: `obs-${r.RTS}-${r.Target}-${i}`,
  stationId: String(r.RTS),
  rawTargetName: String(r.Target),
  epoch: new Date(r.Timestamp).toISOString(),
  recordNumber: Number(r.RecordNumber ?? i),
  hzDeg: Number(r.Hz),                 // horizontal direction, decimal degrees
  vzDeg: Number(r.Vz),                 // zenith angle, decimal degrees
  sdM: Number(r.Sd),                   // slope distance, metres (as stored)
}));

// -------------------------------------------------------------- Lookup -----
const lookupRows = sheet('Lookup');
const lookup = lookupRows.map((r) => ({
  RTS: String(r.RTS),
  TargetName: String(r.TargetName),
  AdjustmentName: String(r.AdjustmentName),
  OutputName: String(r.OutputName),
  TargetHeight: Number(r.TargetHeight ?? 0),
  PrismConstant: Number(r.PrismConstant ?? 0),   // stored in metres
  PrismType: String(r.PrismType ?? ''),
  PrismGrade: String(r.PrismGrade ?? ''),
  AdjustmentEnabled: toBool(r.AdjustmentEnabled),
  GraphEnabled: toBool(r.GraphEnabled),
}));

// -------------------------------------------------------------- Header -----
const headerRows = sheet('Header');
const header = headerRows.map((r) => ({
  UsedFromCycle: new Date(r['Used from cycle']).toISOString(),
  Code: 'C',
  PointId: String(r['Point ID']),
  Easting: Number(r.Easting),
  Northing: Number(r.Northing),
  Height: Number(r.Height),
  StDevE: parseConstraint(r['StDev (E)']),
  StDevN: parseConstraint(r['StDev (N)']),
  StDevH: parseConstraint(r['StDev (H)']),
}));

function toBool(v) {
  return v === true || v === 1 || String(v).toLowerCase() === 'true' || String(v).toLowerCase() === 'yes';
}
// '*' = free component, '!' = fixed component, number = constraint sigma (m)
function parseConstraint(v) {
  if (v === '*' || v === '!') return v;
  return Number(v);
}

// ------------------------------------------------------ validation checks --
const checks = [
  { raw: 78.41, c: 0.0089, expected: 78.4189 },
  { raw: 193.582, c: 0.03, expected: 193.612 },
  { raw: 4.2138, c: 0.0089, expected: 4.2227 },
];
let pass = true;
for (const { raw, c, expected } of checks) {
  const got = Math.round((raw + c) * 1e4) / 1e4;
  const ok = Math.abs(got - expected) < 5e-5;
  pass &&= ok;
  console.log(`check: ${raw} m + ${(c * 1000).toFixed(1)} mm = ${got} (expected ${expected}) ${ok ? 'PASS' : 'FAIL'}`);
}
const constants = [...new Set(lookup.map((l) => Math.round(l.PrismConstant * 10000) / 10000))].sort();
console.log('prism constants found (m):', constants.join(', '));
console.log(`rows: ${rawObservations.length} observations, ${lookup.length} lookup, ${header.length} header`);

const out = resolve('src/data/ats34.generated.json');
writeFileSync(out, JSON.stringify({ rawObservations, lookup, header }, null, 1));
console.log(`written: ${out} ${pass ? '' : '(WARNING: validation checks failed)'}`);

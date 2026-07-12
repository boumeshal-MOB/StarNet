#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Development-only converter: turns the real preparation workbook
// "ATS34 Raw Data, Lookup, Header (1).xlsx" into the local fixture JSON.
// This script is NEVER part of the product UI - the BTM user never uploads
// or maps a file. It exists so the real dataset can back the mockup.
//
// Usage:
//   npm i -D xlsx
//   node scripts/convert-ats34.mjs "data-source/ATS34 Raw Data, Lookup, Header (1).xlsx"
//
// Output: src/data/ats34.generated.json consumed by src/data/realProject.ts
// ---------------------------------------------------------------------------
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const wbPath = process.argv[2] ?? 'data-source/ATS34 Raw Data, Lookup, Header (1).xlsx';

let XLSX;
try {
  XLSX = require('xlsx');
} catch {
  console.error('SheetJS is not installed. Run: npm i -D xlsx');
  process.exit(1);
}

const wb = XLSX.readFile(wbPath, { cellDates: true });
const sheet = (needle) => {
  const found = wb.SheetNames.find((n) => n.toLowerCase().includes(needle.toLowerCase()));
  if (!found) throw new Error(`Sheet "${needle}" not found. Sheets: ${wb.SheetNames.join(', ')}`);
  return XLSX.utils.sheet_to_json(wb.Sheets[found], { defval: null });
};

// tolerant column accessor (real header has trailing spaces: "StDev (E) ")
const get = (row, ...names) => {
  for (const n of names) {
    if (row[n] !== undefined) return row[n];
    const key = Object.keys(row).find((k) => k.trim().toLowerCase() === n.trim().toLowerCase());
    if (key) return row[key];
  }
  return null;
};

// "20241202_0200" -> ISO ; also accepts real Date / ISO strings
function parseCycle(v) {
  if (v instanceof Date) return v.toISOString();
  const s = String(v);
  const m = s.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])).toISOString();
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
}
function toBool(v) {
  return v === true || v === 1 || ['true', 'yes', '1'].includes(String(v).toLowerCase());
}
// '*' = free, '!' = fixed, number = constraint sigma (m). -1 / null -> unspecified.
function parseConstraint(v) {
  if (v === '*' || v === '!') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : '*';
}
function cleanType(v) {
  const n = Number(v);
  return v === null || v === '' || n === -1 ? '' : String(v);
}

// ------------------------------------------------------ Raw Observations ---
const rawRows = sheet('Raw');
const rawObservations = rawRows
  .filter((r) => get(r, 'RTS') && get(r, 'Target') && get(r, 'Sd') !== null)
  .map((r, i) => ({
    id: `obs-${get(r, 'RTS')}-${get(r, 'Target')}-${get(r, 'RecordNumber') ?? i}`,
    stationId: String(get(r, 'RTS')),
    rawTargetName: String(get(r, 'Target')),
    epoch: (get(r, 'Timestamp') instanceof Date
      ? get(r, 'Timestamp') : new Date(get(r, 'Timestamp'))).toISOString(),
    recordNumber: Number(get(r, 'RecordNumber') ?? i),
    hzDeg: Number(get(r, 'Hz')),
    vzDeg: Number(get(r, 'Vz')),
    sdM: Number(get(r, 'Sd')),
  }));

// -------------------------------------------------------------- Lookup -----
const lookup = sheet('Lookup')
  .filter((r) => get(r, 'TargetName'))
  .map((r) => ({
    RTS: String(get(r, 'RTS')),
    TargetName: String(get(r, 'TargetName')),
    AdjustmentName: String(get(r, 'AdjustmentName') ?? get(r, 'TargetName')),
    OutputName: String(get(r, 'OutputName') ?? get(r, 'TargetName')),
    TargetHeight: Number(get(r, 'TargetHeight') ?? 0),
    PrismConstant: Number(get(r, 'PrismConstant') ?? 0),
    PrismType: cleanType(get(r, 'PrismType')),
    PrismGrade: cleanType(get(r, 'PrismGrade')),
    AdjustmentEnabled: toBool(get(r, 'AdjustmentEnabled')),
    GraphEnabled: toBool(get(r, 'GraphEnabled')),
  }));

// -------------------------------------------------------------- Header -----
const header = sheet('Header')
  .filter((r) => get(r, 'Point ID'))
  .map((r) => ({
    UsedFromCycle: parseCycle(get(r, 'Used from cycle')),
    Code: 'C',
    PointId: String(get(r, 'Point ID')),
    Easting: Number(get(r, 'Easting')),
    Northing: Number(get(r, 'Northing')),
    Height: Number(get(r, 'Height')),
    StDevE: parseConstraint(get(r, 'StDev (E)')),
    StDevN: parseConstraint(get(r, 'StDev (N)')),
    StDevH: parseConstraint(get(r, 'StDev (H)')),
  }));

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
  console.log(`check: ${raw} + ${(c * 1000).toFixed(1)}mm = ${got} (expected ${expected}) ${ok ? 'PASS' : 'FAIL'}`);
}
const stations = [...new Set(rawObservations.map((o) => o.stationId))];
const refs = header.map((h) => h.PointId).filter((p) => lookup.some((l) => l.TargetName === p));
console.log('stations:', stations.join(', '));
console.log('prism constants (m):', [...new Set(lookup.map((l) => l.PrismConstant))].sort((a, b) => a - b).join(', '));
console.log(`rows: ${rawObservations.length} observations, ${lookup.length} lookup, ${header.length} header (${refs.length} references)`);

const out = resolve('src/data/ats34.generated.json');
writeFileSync(out, JSON.stringify({
  meta: {
    source: wbPath.split('/').pop(),
    convertedAt: new Date().toISOString(),
    stations, referenceCount: refs.length,
  },
  rawObservations, lookup, header,
}, null, 0));
console.log(`written: ${out} ${pass ? '' : '(WARNING: validation checks failed)'}`);

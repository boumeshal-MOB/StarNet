// ---------------------------------------------------------------------------
// ATS34 demonstration fixture.
//
// In the real BTM chain these records live in the BTM database and are served
// by APIs. In the mockup they are produced by this deterministic generator
// (seeded PRNG) which mirrors the structure of the preparation workbook
// "ATS34 Raw Data, Lookup, Header (1).xlsx":
//   - Raw Observations (Timestamp, RecordNumber, RTS, Target, Hz, Vz, Sd)
//   - Lookup Table     (RTS, TargetName, AdjustmentName, OutputName, ...)
//   - Header           (Used from cycle, C, Point ID, E, N, H, StDev E/N/H)
// The workbook itself NEVER appears in the product UI; scripts/convert-ats34
// can convert a real workbook into this exact structure (see docs).
//
// The generator embeds the mandatory demo scenarios:
//   B - one corrupted observation on 2026-07-09T10:25 (ATS34 -> MP04)
//   C - desynchronized stations (:25 / :26 / :32) around each :00/:30 slot
//   D - ATS36 silent from 2026-07-10T09:00; its late data is delivered
//       separately via `lateObservations` (catch-up demo)
//   E - REF01 coordinates change on 2026-07-10T00:00 (header v2)
//   G - ATS35 T/P missing on 2026-07-10T08:00-09:00; delivered late via
//       `lateEnvironmental`
// ---------------------------------------------------------------------------

import type {
  EnvironmentalObservation, InstrumentProfile, PrismProfile, RawObservation,
} from '../types/domain';
import { RAD2DEG, azimuth, wrapTwoPi } from '../engine/geometry';
import { atmosphericPpm } from '../engine/corrections';

// ------------------------------------------------------------ PRNG ---------
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rnd: () => number): number {
  const u = Math.max(rnd(), 1e-12);
  const v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ------------------------------------------------- true site geometry ------
export interface TruePoint { id: string; e: number; n: number; h: number; kind: 'station' | 'reference' | 'monitoring' }

export const TRUE_POINTS: TruePoint[] = [
  { id: 'ATS34', e: 1000.000, n: 2000.000, h: 100.000, kind: 'station' },
  { id: 'ATS35', e: 1180.000, n: 2035.000, h: 101.500, kind: 'station' },
  { id: 'ATS36', e: 1090.000, n: 1920.000, h: 98.500, kind: 'station' },
  { id: 'REF01', e: 950.000, n: 2110.000, h: 105.200, kind: 'reference' },
  { id: 'REF02', e: 1120.000, n: 2130.000, h: 107.800, kind: 'reference' },
  { id: 'REF03', e: 1185.000, n: 1943.000, h: 103.400, kind: 'reference' },
  { id: 'REF04', e: 1010.000, n: 1880.000, h: 97.600, kind: 'reference' },
  { id: 'REF05', e: 880.000, n: 1965.000, h: 99.900, kind: 'reference' },
  { id: 'MP01', e: 1024.500, n: 2074.200, h: 102.300, kind: 'monitoring' },
  { id: 'MP02', e: 1061.800, n: 2066.500, h: 101.900, kind: 'monitoring' },
  { id: 'MP03', e: 1049.300, n: 2062.100, h: 101.500, kind: 'monitoring' },
  { id: 'MP04', e: 1096.400, n: 2043.700, h: 101.100, kind: 'monitoring' },
  { id: 'MP05', e: 1122.700, n: 2013.900, h: 100.600, kind: 'monitoring' },
  { id: 'MP06', e: 1130.100, n: 1975.400, h: 100.100, kind: 'monitoring' },
  { id: 'MP07', e: 1115.000, n: 1946.800, h: 99.400, kind: 'monitoring' },
  { id: 'MP08', e: 1206.500, n: 1988.300, h: 100.900, kind: 'monitoring' },
];

/** visibility graph: which station observes which targets */
export const VISIBILITY: Record<string, string[]> = {
  ATS34: ['REF01', 'REF02', 'REF04', 'REF05', 'MP01', 'MP02', 'MP03', 'MP04', 'MP05'],
  ATS35: ['REF02', 'REF03', 'MP03', 'MP04', 'MP05', 'MP06', 'MP07', 'MP08'],
  ATS36: ['REF03', 'REF04', 'REF05', 'MP01', 'MP02', 'MP05', 'MP06', 'MP07'],
};

/** raw field names as recorded by each RTS (Lookup maps them) */
export function rawName(stationId: string, targetId: string): string {
  // Scenario "same field name, different physical points": two French-style
  // MPO names reused by different crews on different stations. ATS34 calls
  // MP03 "MPO001"; ATS36 calls MP07 "MPO001". Same name, distinct points.
  if (stationId === 'ATS34' && targetId === 'MP03') return 'MPO001';
  if (stationId === 'ATS36' && targetId === 'MP07') return 'MPO001';
  return `${targetId}_${stationId.slice(-2)}`; // e.g. MP01_34
}

// prism constants in metres - the known set: 0, 8.9, 26.5 and 30 mm
export const PRISM_CONSTANT_BY_TARGET: Record<string, number> = {
  REF01: 0.0089, REF02: 0.0089, REF03: 0.0300, REF04: 0.0089, REF05: 0.0265,
  MP01: 0.0089, MP02: 0.0089, MP03: 0.0089, MP04: 0.0089,
  MP05: 0.0265, MP06: 0.0265, MP07: 0.0000, MP08: 0.0000,
};

export const PRISM_TYPE_BY_TARGET: Record<string, string> = {
  REF01: 'Circular prism (+8.9 mm)', REF02: 'Circular prism (+8.9 mm)',
  REF03: 'Reflector tape (+30.0 mm)', REF04: 'Circular prism (+8.9 mm)',
  REF05: '360 deg prism (+26.5 mm)',
  MP01: 'Circular prism (+8.9 mm)', MP02: 'Circular prism (+8.9 mm)',
  MP03: 'Circular prism (+8.9 mm)', MP04: 'Circular prism (+8.9 mm)',
  MP05: '360 deg prism (+26.5 mm)', MP06: '360 deg prism (+26.5 mm)',
  MP07: 'Standard prism (0.0 mm)', MP08: 'Standard prism (0.0 mm)',
};

// station observation second-offsets inside each 30-min slot (scenario C)
const STATION_OFFSET_MIN: Record<string, number> = { ATS34: -5, ATS35: -4, ATS36: 2 };

export const FIXTURE_START = Date.UTC(2026, 6, 8, 0, 0, 0);   // 2026-07-08T00:00Z
export const FIXTURE_END = Date.UTC(2026, 6, 10, 12, 0, 0);   // 2026-07-10T12:00Z
export const SLOT_MIN = 30;

// scenario B: corrupted observation
export const BAD_OBS_SLOT = Date.UTC(2026, 6, 9, 10, 30, 0);  // slot 10:30, epoch 10:25
export const BAD_OBS_STATION = 'ATS34';
export const BAD_OBS_TARGET = 'MP04';

// scenario D: ATS36 silent from here; data delivered late
export const ATS36_SILENT_FROM = Date.UTC(2026, 6, 10, 9, 0, 0);

// scenario G: ATS35 environmental gap
export const ENV_GAP_FROM = Date.UTC(2026, 6, 10, 8, 0, 0);
export const ENV_GAP_TO = Date.UTC(2026, 6, 10, 9, 0, 0);

// scenario E: REF01 moves to new surveyed coordinates from this cycle
export const REF01_V2_FROM = Date.UTC(2026, 6, 10, 0, 0, 0);
export const REF01_V2_SHIFT = { e: 0.0020, n: -0.0012, h: 0.0008 };

export interface LookupRow {
  RTS: string; TargetName: string; AdjustmentName: string; OutputName: string;
  TargetHeight: number; PrismConstant: number; PrismType: string;
  PrismGrade: string; AdjustmentEnabled: boolean; GraphEnabled: boolean;
}

export interface HeaderRow {
  UsedFromCycle: string; Code: 'C'; PointId: string;
  Easting: number; Northing: number; Height: number;
  StDevE: number | '*' | '!'; StDevN: number | '*' | '!'; StDevH: number | '*' | '!';
}

export interface Ats34Fixture {
  network: string;
  project: string;
  site: string;
  rawObservations: RawObservation[];
  lateObservations: RawObservation[];       // scenario D late arrivals
  environmental: EnvironmentalObservation[];
  lateEnvironmental: EnvironmentalObservation[]; // scenario G late arrivals
  lookup: LookupRow[];
  header: HeaderRow[];
  instrumentProfiles: InstrumentProfile[];
  prismProfiles: PrismProfile[];
  truePoints: TruePoint[];
  provenance: {
    generator: string;
    seed: number;
    workbook: string;
    validationChecks: { label: string; expected: string; computed: string; pass: boolean }[];
  };
}

export function generateAts34Fixture(seed = 20260711): Ats34Fixture {
  const rnd = mulberry32(seed);
  const points = new Map(TRUE_POINTS.map((p) => [p.id, { ...p }]));

  const rawObservations: RawObservation[] = [];
  const lateObservations: RawObservation[] = [];
  const environmental: EnvironmentalObservation[] = [];
  const lateEnvironmental: EnvironmentalObservation[] = [];

  let record = 1000;

  for (let t = FIXTURE_START; t <= FIXTURE_END; t += SLOT_MIN * 60000) {
    const dayFrac = ((t / 3600000) % 24) / 24;
    for (const stationId of Object.keys(VISIBILITY)) {
      const st = points.get(stationId)!;
      const epochMs = t + STATION_OFFSET_MIN[stationId] * 60000 + Math.floor(rnd() * 40) * 1000;

      // environment record ~5 min before the observation cycle
      const temperatureC = 15 + 6 * Math.sin(2 * Math.PI * (dayFrac - 0.3)) + gauss(rnd) * 0.3;
      const pressureHPa = 1015 + 3 * Math.sin(2 * Math.PI * (dayFrac / 2 + 0.1)) + gauss(rnd) * 0.4;
      const envRec: EnvironmentalObservation = {
        id: `env-${stationId}-${t}`,
        stationId,
        epoch: new Date(epochMs - 5 * 60000).toISOString(),
        temperatureC: Math.round(temperatureC * 10) / 10,
        pressureHPa: Math.round(pressureHPa * 10) / 10,
      };
      const inEnvGap = stationId === 'ATS35' && t >= ENV_GAP_FROM && t < ENV_GAP_TO;
      (inEnvGap ? lateEnvironmental : environmental).push(envRec);

      const stationSilent = stationId === 'ATS36' && t >= ATS36_SILENT_FROM;

      for (const targetId of VISIBILITY[stationId]) {
        const tp = points.get(targetId)!;
        // slow real movement of some monitoring prisms (mm-level)
        const days = (t - FIXTURE_START) / 86400000;
        let te = tp.e; let tn = tp.n; let th = tp.h;
        if (targetId === 'MP01' || targetId === 'MP02' || targetId === 'MP03') {
          te += 0.0004 * days; th -= 0.0006 * days;   // ~0.4 mm/d E, -0.6 mm/d H
        }
        if (targetId === 'MP05') { tn -= 0.0003 * days; }
        // scenario E: REF01 physically moved at v2 cycle (new survey values)
        if (targetId === 'REF01' && t >= REF01_V2_FROM) {
          te += REF01_V2_SHIFT.e; tn += REF01_V2_SHIFT.n; th += REF01_V2_SHIFT.h;
        }

        const dE = te - st.e;
        const dN = tn - st.n;
        const dH = th - st.h; // instrument and target heights are 0 m in this dataset
        const hd = Math.hypot(dE, dN);
        const trueSlope = Math.hypot(hd, dH);
        const az = wrapTwoPi(Math.atan2(dE, dN));
        const vz = Math.atan2(hd, dH);

        // station orientation: each RTS zero direction points roughly at its first reference
        const oriRef = points.get(VISIBILITY[stationId].find((x) => x.startsWith('REF'))!)!;
        const orientation = azimuth({ e: st.e, n: st.n }, { e: oriRef.e, n: oriRef.n });
        const hz = wrapTwoPi(az - orientation);

        // the RTS measured with a 0 mm field constant and no atmospheric
        // correction: stored Sd = optical distance - prism constant + noise
        const ppm = atmosphericPpm(temperatureC, pressureHPa);
        const opticalSlope = trueSlope / (1 + ppm * 1e-6);
        const constant = PRISM_CONSTANT_BY_TARGET[targetId];
        const sdNoise = gauss(rnd) * Math.hypot(0.0006, 1e-6 * trueSlope);
        const angNoiseHz = gauss(rnd) * (2.4e-6);  // ~0.5 arcsec
        const angNoiseVz = gauss(rnd) * (2.4e-6);

        let hzDeg = wrapTwoPi(hz + angNoiseHz) * RAD2DEG;
        let sdM = opticalSlope - constant + sdNoise;
        const vzDeg = (vz + angNoiseVz) * RAD2DEG;

        // scenario B: one corrupted observation (+25 arcsec, +4 mm)
        if (stationId === BAD_OBS_STATION && targetId === BAD_OBS_TARGET
            && t === BAD_OBS_SLOT) {
          hzDeg = wrapTwoPi(hz + 25 * 4.8481e-6) * RAD2DEG; // +25 arcsec blunder
          sdM += 0.004; // +4 mm blunder
        }

        const obs: RawObservation = {
          id: `obs-${stationId}-${targetId}-${t}`,
          stationId,
          rawTargetName: rawName(stationId, targetId),
          epoch: new Date(epochMs).toISOString(),
          recordNumber: record++,
          hzDeg: round(hzDeg, 6),
          vzDeg: round(vzDeg, 6),
          sdM: round(sdM, 4),
        };
        (stationSilent ? lateObservations : rawObservations).push(obs);
      }
    }
  }

  // ------------------------------------------------------------- lookup ----
  const lookup: LookupRow[] = [];
  for (const stationId of Object.keys(VISIBILITY)) {
    for (const targetId of VISIBILITY[stationId]) {
      lookup.push({
        RTS: stationId,
        TargetName: rawName(stationId, targetId),
        AdjustmentName: targetId,
        OutputName: `NTE_ATS34_${targetId}`,
        TargetHeight: 0,
        PrismConstant: PRISM_CONSTANT_BY_TARGET[targetId],
        PrismType: PRISM_TYPE_BY_TARGET[targetId],
        PrismGrade: targetId.startsWith('REF') ? 'Precision' : 'Standard',
        AdjustmentEnabled: true,
        GraphEnabled: !targetId.startsWith('REF'),
      });
    }
  }

  // ------------------------------------------------------------- header ----
  const header: HeaderRow[] = [];
  const startIso = new Date(FIXTURE_START).toISOString();
  const v2Iso = new Date(REF01_V2_FROM).toISOString();
  const pushRef = (usedFrom: string, id: string, dE = 0, dN = 0, dH = 0) => {
    const p = TRUE_POINTS.find((x) => x.id === id)!;
    // REF05 height is free ('*'); REF04 is fully fixed ('!'); others weak 0.5 mm..1 mm
    let sE: number | '*' | '!' = 0.0005; let sN: number | '*' | '!' = 0.0005; let sH: number | '*' | '!' = 0.0008;
    if (id === 'REF03') { sE = 0.0010; sN = 0.0010; sH = 0.0015; }
    if (id === 'REF04') { sE = '!'; sN = '!'; sH = '!'; }
    if (id === 'REF05') { sH = '*'; }
    // the surveyed header coordinates carry the control-survey noise implied
    // by their sigmas (fixed components are treated as error-free datum)
    const noisy = (v: number, s: number | '*' | '!') =>
      typeof s === 'number' ? v + gauss(rnd) * s : v;
    header.push({
      UsedFromCycle: usedFrom, Code: 'C', PointId: id,
      Easting: round(noisy(p.e + dE, sE), 4),
      Northing: round(noisy(p.n + dN, sN), 4),
      Height: round(noisy(p.h + dH, sH), 4),
      StDevE: sE, StDevN: sN, StDevH: sH,
    });
  };
  for (const id of ['REF01', 'REF02', 'REF03', 'REF04', 'REF05']) pushRef(startIso, id);
  // v2: REF01 re-surveyed after physical movement (scenario E)
  pushRef(v2Iso, 'REF01', REF01_V2_SHIFT.e, REF01_V2_SHIFT.n, REF01_V2_SHIFT.h);

  // ---------------------------------------------------------- profiles -----
  const instrumentProfiles: InstrumentProfile[] = [
    {
      id: 'inst-topcon-ms05axii', manufacturer: 'Topcon', model: 'MS05AXII (0.5")', edmMode: 'Fine + Prism',
      version: 1, status: 'active', wavelengthNm: 0,
      distanceStdErrMm: 0.8, distancePpm: 1,
      directionStdErrArcSec: 0.5, hzAngleStdErrArcSec: 0.5, vzAngleStdErrArcSec: 0.5,
      azimuthStdErrArcSec: 0.5,
      instrumentCenteringErrMm: 0, targetCenteringErrMm: 0, verticalCenteringErrMm: 0,
      defaultInstrumentHeightM: 0,
      atmosphericModel: 'standard-ppm-v1', atmosphericModelVersion: 'BTM standard P/T formula v1',
      notes: 'Topcon MS AXII brochure: 0.5 arc-second angle accuracy and 0.8 mm + 1 ppm with one prism. Permanent monitoring defaults keep centering and instrument height at 0 until configured.',
    },
    {
      id: 'inst-topcon-ms1axii', manufacturer: 'Topcon', model: 'MS1AXII (1")', edmMode: 'Fine + Prism',
      version: 1, status: 'active', wavelengthNm: 0,
      distanceStdErrMm: 1, distancePpm: 1,
      directionStdErrArcSec: 1, hzAngleStdErrArcSec: 1, vzAngleStdErrArcSec: 1,
      azimuthStdErrArcSec: 1,
      instrumentCenteringErrMm: 0, targetCenteringErrMm: 0, verticalCenteringErrMm: 0,
      defaultInstrumentHeightM: 0,
      atmosphericModel: 'standard-ppm-v1', atmosphericModelVersion: 'BTM standard P/T formula v1',
      notes: 'Topcon MS AXII brochure: 1 arc-second angle accuracy and 1 mm + 1 ppm with one prism. Permanent monitoring defaults keep centering and instrument height at 0 until configured.',
    },
    {
      id: 'inst-tm50', manufacturer: 'Leica', model: 'TM50 I (0.5")', edmMode: 'Precise + Reflector',
      version: 1, status: 'active', wavelengthNm: 658,
      distanceStdErrMm: 0.6, distancePpm: 1,
      directionStdErrArcSec: 0.5, hzAngleStdErrArcSec: 0.5, vzAngleStdErrArcSec: 0.5,
      azimuthStdErrArcSec: 0.5,
      instrumentCenteringErrMm: 0.0, targetCenteringErrMm: 0.0, verticalCenteringErrMm: 0.0,
      defaultInstrumentHeightM: 0,
      atmosphericModel: 'standard-ppm-v1', atmosphericModelVersion: 'v1 (281.8 - 0.29065 P / (1 + T/273.15))',
      notes: 'Monitoring total station, pillar mounted, heights referenced to trunnion axis (0 m).',
    },
    {
      id: 'inst-ts16', manufacturer: 'Leica', model: 'TS16 (1")', edmMode: 'Standard + Reflector',
      version: 1, status: 'active', wavelengthNm: 658,
      distanceStdErrMm: 1, distancePpm: 1.5,
      directionStdErrArcSec: 1, hzAngleStdErrArcSec: 1, vzAngleStdErrArcSec: 1,
      azimuthStdErrArcSec: 1,
      instrumentCenteringErrMm: 0.5, targetCenteringErrMm: 0.5, verticalCenteringErrMm: 0.5,
      defaultInstrumentHeightM: 0,
      atmosphericModel: 'standard-ppm-v1', atmosphericModelVersion: 'v1 (281.8 - 0.29065 P / (1 + T/273.15))',
      notes: 'General purpose profile.',
    },
  ];
  const mkPrism = (
    id: string, name: string, cM: number, type: string,
    over: Partial<PrismProfile> = {},
  ): PrismProfile => ({
    id, name, instrumentProfileId: 'inst-tm50', edmMode: 'Precise + Reflector',
    manufacturer: 'Leica', model: type, prismType: type, grade: 'Standard', country: 'France',
    effectiveConstantM: cM, defaultTargetHeightM: 0, version: 1, status: 'active',
    notes: 'Effective constant for the instrument / EDM / reflector setup. Stored in metres, displayed in mm.',
    ...over,
  });
  const prismProfiles: PrismProfile[] = [
    mkPrism('prism-std0', 'Standard prism (0.0 mm)', 0, 'Standard prism'),
    mkPrism('prism-circ89', 'Circular prism (+8.9 mm)', 0.0089, 'Circular prism'),
    mkPrism('prism-360-265', '360 deg prism (+26.5 mm)', 0.0265, '360 deg prism'),
    mkPrism('prism-tape30', 'Reflector tape (+30.0 mm)', 0.0300, 'Reflector tape'),
    mkPrism('prism-mpo-fr', 'MPO FR (+25.5 mm)', 0.0255, 'MPO mini prism', {
      instrumentProfileId: 'inst-topcon-ms05axii', edmMode: 'Fine + Prism', manufacturer: 'Topcon',
    }),
    mkPrism('prism-pav-fr', 'PAV FR (0.0 mm)', 0, 'PAV prism', {
      instrumentProfileId: 'inst-topcon-ms05axii', edmMode: 'Fine + Prism', manufacturer: 'Topcon',
    }),
    mkPrism('prism-rob-0', 'Rob legacy · 0.0 mm', 0, 'Lookup reflector', {
      country: 'United Kingdom', instrumentProfileId: 'inst-topcon-ms05axii', edmMode: 'Fine + Prism', manufacturer: 'Topcon',
      notes: 'Constant from the Rob ATS34 lookup table; reflector model was not supplied.',
    }),
    mkPrism('prism-rob-89', 'Rob legacy · +8.9 mm', 0.0089, 'L-bar', {
      country: 'United Kingdom', instrumentProfileId: 'inst-topcon-ms05axii', edmMode: 'Fine + Prism', manufacturer: 'Topcon',
      notes: 'Constant documented by Rob for L-bar targets in the ATS34 lookup workbook.',
    }),
    mkPrism('prism-rob-265', 'Rob legacy · +26.5 mm', 0.0265, 'Micro prism', {
      country: 'United Kingdom', instrumentProfileId: 'inst-topcon-ms05axii', edmMode: 'Fine + Prism', manufacturer: 'Topcon',
      notes: 'Constant documented by Rob for Micro Prism targets in the ATS34 lookup workbook.',
    }),
    mkPrism('prism-rob-30', 'Rob legacy · +30.0 mm', 0.0300, '360 mini', {
      country: 'United Kingdom', instrumentProfileId: 'inst-topcon-ms05axii', edmMode: 'Fine + Prism', manufacturer: 'Topcon',
      notes: 'Constant documented by Rob for 360 mini targets in the ATS34 lookup workbook.',
    }),
  ];

  // ----------------------------------------------- provenance validation ---
  const checks = [
    { raw: 78.41, c: 0.0089, expected: 78.4189 },
    { raw: 193.582, c: 0.03, expected: 193.612 },
    { raw: 4.2138, c: 0.0089, expected: 4.2227 },
  ].map(({ raw, c, expected }) => {
    const computed = round(raw + c, 4);
    return {
      label: `Sd ${raw.toFixed(4)} m + constant ${(c * 1000).toFixed(1)} mm`,
      expected: expected.toFixed(4),
      computed: computed.toFixed(4),
      pass: Math.abs(computed - expected) < 5e-5,
    };
  });

  return {
    network: 'NTE_ATS34',
    project: 'Nantes Tunnel East',
    site: 'NTE - Portal East',
    rawObservations, lateObservations, environmental, lateEnvironmental,
    lookup, header, instrumentProfiles, prismProfiles,
    truePoints: TRUE_POINTS,
    provenance: {
      generator: 'deterministic synthetic generator (seeded), structure identical to the ATS34 workbook',
      seed,
      workbook: 'ATS34 Raw Data, Lookup, Header (1).xlsx (not shipped; see scripts/convert-ats34.mjs)',
      validationChecks: checks,
    },
  };
}

function round(x: number, d: number): number {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

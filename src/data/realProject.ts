// ---------------------------------------------------------------------------
// Real ATS34 project loaded from the converted workbook
// (src/data/ats34.generated.json, produced by scripts/convert-ats34.mjs).
//
// This is a single-station monitoring dataset (RTS "NTE_ATS34", March 2025):
// the station observes 9 known reference points (L34RE1100_*, tight header
// constraints) and ~33 monitoring prisms. The station itself is in the header
// with a loose E/N prior and a free height -> classic resection + radiation.
//
// If the JSON is absent (workbook not converted yet) the loader returns null
// and the app falls back to the synthetic multi-station demo only.
// ---------------------------------------------------------------------------

import type { EnvironmentalObservation, RawObservation } from '../types/domain';

// Vite inlines JSON imports. The file is optional at author time; a tiny
// placeholder is committed so the import always resolves.
import generated from './ats34.generated.json';

export interface HeaderRow {
  UsedFromCycle: string; Code: 'C'; PointId: string;
  Easting: number; Northing: number; Height: number;
  StDevE: number | '*' | '!'; StDevN: number | '*' | '!'; StDevH: number | '*' | '!';
}
export interface LookupRow {
  RTS: string; TargetName: string; AdjustmentName: string; OutputName: string;
  TargetHeight: number; PrismConstant: number; PrismType: string;
  PrismGrade: string; AdjustmentEnabled: boolean; GraphEnabled: boolean;
}

export interface RealProject {
  key: 'real';
  project: string;
  site: string;
  network: string;
  stationId: string;
  stationApprox: { e: number; n: number; h: number };
  rawObservations: RawObservation[];
  environmental: EnvironmentalObservation[];
  lookup: LookupRow[];
  header: HeaderRow[];
  referenceIds: string[];
  meta: { source: string; convertedAt: string; observationCount: number };
}

interface GeneratedShape {
  meta?: { source?: string; convertedAt?: string };
  rawObservations: RawObservation[];
  lookup: LookupRow[];
  header: (Omit<HeaderRow, 'StDevE' | 'StDevN' | 'StDevH'> & {
    StDevE: number | '*' | '!'; StDevN: number | '*' | '!'; StDevH: number | '*' | '!';
  })[];
}

let cached: RealProject | null | undefined;

export function getRealProject(): RealProject | null {
  if (cached !== undefined) return cached;
  const g = generated as unknown as GeneratedShape;
  if (!g || !Array.isArray(g.rawObservations) || g.rawObservations.length === 0) {
    cached = null;
    return null;
  }
  const stationId = g.rawObservations[0].stationId;
  const stationHeader = g.header.find((h) => h.PointId === stationId);
  const referenceIds = g.header.map((h) => h.PointId)
    .filter((p) => p !== stationId && g.lookup.some((l) => l.TargetName === p));
  cached = {
    key: 'real',
    project: 'NTE — Nantes (real data)',
    site: 'NTE ATS34 gallery',
    network: stationId,
    stationId,
    stationApprox: stationHeader
      ? { e: stationHeader.Easting, n: stationHeader.Northing, h: stationHeader.Height }
      : { e: 0, n: 0, h: 0 },
    rawObservations: g.rawObservations,
    environmental: [],
    lookup: g.lookup,
    header: g.header,
    referenceIds,
    meta: {
      source: g.meta?.source ?? 'ATS34 workbook',
      convertedAt: g.meta?.convertedAt ?? '',
      observationCount: g.rawObservations.length,
    },
  };
  return cached;
}

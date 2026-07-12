// ---------------------------------------------------------------------------
// Local repository simulating the BTM database / APIs.
// The product UI only ever talks to this repository - it never sees a file.
// Late-data buckets support the catch-up demo scenarios (D and G): the data
// exists in the fixture but is only "delivered to BTM" when injected.
// ---------------------------------------------------------------------------

import {
  ATS36_SILENT_FROM, ENV_GAP_FROM, FIXTURE_END, FIXTURE_START,
  generateAts34Fixture, type Ats34Fixture, type HeaderRow, type LookupRow,
} from './fixture';
import { getRealProject } from './realProject';
import type { EnvironmentalObservation, RawObservation, ReferencePoint, ReferenceSet } from '../types/domain';

export interface DeliveryState {
  ats36LateDelivered: boolean;   // scenario D late observations
  ats35EnvDelivered: boolean;    // scenario G late environmental data
}

let fixture: Ats34Fixture | null = null;
let delivery: DeliveryState = { ats36LateDelivered: false, ats35EnvDelivered: false };

export function getFixture(): Ats34Fixture {
  if (!fixture) fixture = generateAts34Fixture();
  return fixture;
}

export function getDeliveryState(): DeliveryState {
  return { ...delivery };
}

export function setDeliveryState(s: DeliveryState): void {
  delivery = { ...s };
}

export const repository = {
  project() {
    const f = getFixture();
    const real = getRealProject();
    const obs = this.observations();
    const epochs = obs.map((o) => o.epoch).sort();
    return {
      project: f.project,
      site: f.site,
      network: real ? `${f.network} + ${real.network}` : f.network,
      stations: this.stationSummaries().map((s) => s.id),
      observationCount: obs.length,
      firstEpoch: epochs[0],
      lastEpoch: epochs[epochs.length - 1],
      targetCount: new Set(obs.map((o) => o.rawTargetName)).size,
      variables: ['Hz', 'Vz', 'Sd', 'Temperature', 'Pressure'],
      coverage: { from: new Date(FIXTURE_START).toISOString(), to: new Date(FIXTURE_END).toISOString() },
    };
  },

  stationSummaries() {
    const f = getFixture();
    const real = getRealProject();
    const obs = this.observations();
    const env = this.environmental();
    const mk = (id: string, approx: { e: number; n: number; h: number }) => {
      const mine = obs.filter((o) => o.stationId === id);
      const epochs = mine.map((o) => o.epoch).sort();
      const targets = new Set(mine.map((o) => o.rawTargetName));
      const hasEnv = env.some((e) => e.stationId === id);
      // median gap between distinct cycles as estimated cadence
      let cycleMin = 30;
      if (mine.length > 1) {
        const times = [...new Set(epochs.map((e) => new Date(e).getTime()))].sort((a, b) => a - b);
        const gaps = [];
        for (let i = 1; i < times.length; i++) {
          const g = times[i] - times[i - 1];
          if (g > 15 * 60000) gaps.push(g);
        }
        if (gaps.length) {
          gaps.sort((a, b) => a - b);
          cycleMin = Math.round(gaps[Math.floor(gaps.length / 2)] / 60000);
        }
      }
      return {
        id,
        approxE: approx.e, approxN: approx.n, approxH: approx.h,
        lastObservation: epochs[epochs.length - 1],
        targetCount: targets.size,
        estimatedCycleMin: cycleMin,
        environmentalData: hasEnv,
        readiness: mine.length > 0 ? 'Ready' : 'Waiting for data',
      };
    };
    const list = f.truePoints.filter((p) => p.kind === 'station')
      .map((s) => mk(s.id, { e: s.e, n: s.n, h: s.h }));
    if (real) list.push(mk(real.stationId, real.stationApprox));
    return list;
  },

  /** all raw observations currently delivered to BTM (both networks) */
  observations(): RawObservation[] {
    const f = getFixture();
    const real = getRealProject();
    const synthetic = delivery.ats36LateDelivered
      ? [...f.rawObservations, ...f.lateObservations]
      : f.rawObservations;
    return real ? [...synthetic, ...real.rawObservations] : synthetic;
  },

  observationsInWindow(stationIds: string[], fromMs: number, toMs: number): RawObservation[] {
    return this.observations().filter((o) => {
      if (!stationIds.includes(o.stationId)) return false;
      const t = new Date(o.epoch).getTime();
      return t >= fromMs && t < toMs;
    });
  },

  environmental(): EnvironmentalObservation[] {
    const f = getFixture();
    return delivery.ats35EnvDelivered
      ? [...f.environmental, ...f.lateEnvironmental]
      : f.environmental;
  },

  lookup(): LookupRow[] {
    const real = getRealProject();
    return real ? [...getFixture().lookup, ...real.lookup] : getFixture().lookup;
  },
  header(): HeaderRow[] {
    const real = getRealProject();
    return real ? [...getFixture().header, ...real.header] : getFixture().header;
  },
  realProject() { return getRealProject(); },
  instrumentProfiles() { return getFixture().instrumentProfiles; },
  prismProfiles() { return getFixture().prismProfiles; },
  provenance() { return getFixture().provenance; },

  /** scenario helpers: deliver the late buckets to "BTM" */
  deliverAts36LateData(): number {
    delivery.ats36LateDelivered = true;
    return getFixture().lateObservations.length;
  },
  deliverAts35EnvData(): number {
    delivery.ats35EnvDelivered = true;
    return getFixture().lateEnvironmental.length;
  },
  scenarioMarkers() {
    return {
      ats36SilentFrom: new Date(ATS36_SILENT_FROM).toISOString(),
      envGapFrom: new Date(ENV_GAP_FROM).toISOString(),
    };
  },

  /**
   * Build reference sets from the header block (grouped by Used-from cycle).
   * `pointFilter` scopes the header rows to one project/network so cycles of
   * different projects never mix.
   */
  referenceSetsFromHeader(
    processingId: string, user: string, pointFilter?: (pointId: string) => boolean,
  ): ReferenceSet[] {
    const header = pointFilter ? this.header().filter((h) => pointFilter(h.PointId)) : this.header();
    const cycles = [...new Set(header.map((h) => h.UsedFromCycle))].sort();
    return cycles.map((cycle, i) => {
      // a cycle's set = latest row per point at that cycle
      const rows = header.filter((h) => h.UsedFromCycle <= cycle);
      const byPoint = new Map<string, typeof rows[number]>();
      for (const r of rows) byPoint.set(r.PointId, r);
      const points: ReferencePoint[] = [...byPoint.values()].map((r) => {
        const mode = (v: number | '*' | '!'): 'free' | 'fixed' | 'weak' =>
          (v === '*' ? 'free' : v === '!' ? 'fixed' : 'weak');
        const sig = (v: number | '*' | '!') => (typeof v === 'number' ? v : undefined);
        return {
          pointId: r.PointId,
          easting: r.Easting, northing: r.Northing, height: r.Height,
          sigmaE: sig(r.StDevE), sigmaN: sig(r.StDevN), sigmaH: sig(r.StDevH),
          modeE: mode(r.StDevE), modeN: mode(r.StDevN), modeH: mode(r.StDevH),
          source: 'BTM header block',
          comment: r.PointId === 'REF01' && i > 0 ? 'Re-surveyed coordinates (new campaign)' : '',
        };
      });
      return {
        id: `refset-${processingId}-v${i + 1}`,
        processingId,
        name: i === 0 ? 'Initial references' : `References update ${i + 1}`,
        version: i + 1,
        points,
        validFrom: cycle,
        validTo: cycles[i + 1],
        activeInVersion: true,
        usedByRun: false,
        createdAt: new Date().toISOString(),
        createdBy: user,
        comment: i === 0 ? 'Imported from BTM header block' : 'REF01 coordinates changed',
      };
    });
  },
};

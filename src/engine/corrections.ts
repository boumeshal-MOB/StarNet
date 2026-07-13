// ---------------------------------------------------------------------------
// Distance correction chain, applied explicitly and traced step by step:
//   distanceAfterPrism      = storedDistance + prismDelta
//   atmosphericScale        = atmosphericModel(T, P, instrumentProfile)
//   distanceAfterAtmosphere = distanceAfterPrism * atmosphericScale
// The prism and atmospheric corrections are physical EDM corrections and
// therefore act on the measured slope distance. A datum/grid scale is kept
// separate: STAR*NET applies it to horizontal distances (or to the horizontal
// component of a slope distance), not to the complete slope distance.
// ---------------------------------------------------------------------------

import type {
  CorrectionTrace, DistanceState, EnvironmentalObservation, InstrumentProfile,
  MissingEnvPolicy, RawObservation, Station, StationPrismSetup,
} from '../types/domain';

export const ATMO_FORMULA_VERSION = 'standard-ppm-v1';

/**
 * Demonstration atmospheric model (documented, configurable):
 * a simplified first-velocity-correction formula in ppm, referenced to
 * 12 degC / 1013.25 hPa (typical total-station reference atmosphere):
 *
 *   ppm = 281.8 - (0.29065 * P) / (1 + alpha * T)
 *   with alpha = 1/273.15, P in hPa, T in degC
 *
 * Positive ppm lengthens the measured distance (scale > 1).
 * The production BTM chain must use the model of the actual instrument
 * profile / EDM; this version string is recorded in every snapshot.
 */
export function atmosphericPpm(temperatureC: number, pressureHPa: number): number {
  const alpha = 1 / 273.15;
  return 281.8 - (0.29065 * pressureHPa) / (1 + alpha * temperatureC);
}

export function isValidEnvironment(temperatureC?: number, pressureHPa?: number): boolean {
  return temperatureC !== undefined && pressureHPa !== undefined
    && Number.isFinite(temperatureC) && Number.isFinite(pressureHPa)
    && temperatureC >= -80 && temperatureC <= 80
    && pressureHPa >= 300 && pressureHPa <= 1200;
}

export function prismDelta(setup: Pick<StationPrismSetup, 'effectiveConstantM' | 'constantAppliedByStationM' | 'measurementType'>): number {
  if (setup.measurementType === 'reflectorless') return 0;
  return setup.effectiveConstantM - setup.constantAppliedByStationM;
}

export interface EnvLookupResult {
  temperatureC?: number;
  pressureHPa?: number;
  source: 'measured' | 'defaults' | 'none' | 'station';
  ageMin?: number;
  warnings: string[];
}

/** Find the closest environmental record within the station tolerance. */
export function lookupEnvironment(
  station: Station,
  epoch: string,
  env: EnvironmentalObservation[],
): EnvLookupResult {
  const warnings: string[] = [];
  if (station.atmosphericMode === 'station-corrected') {
    return { source: 'station', warnings };
  }
  if (station.atmosphericMode === 'none') {
    return { source: 'none', warnings };
  }
  if (station.atmosphericMode === 'defaults') {
    if (!isValidEnvironment(station.defaultTemperatureC, station.defaultPressureHPa)) {
      return { source: 'none', warnings: [`Invalid fixed T/P configured for ${station.id}; no atmospheric correction applied`] };
    }
    return {
      temperatureC: station.defaultTemperatureC,
      pressureHPa: station.defaultPressureHPa,
      source: 'defaults',
      warnings,
    };
  }
  // automatic: nearest record within tolerance
  const t0 = new Date(epoch).getTime();
  let best: EnvironmentalObservation | undefined;
  let bestDt = Infinity;
  let invalidInWindow = false;
  for (const e of env) {
    if (e.stationId !== station.id) continue;
    const dt = Math.abs(new Date(e.epoch).getTime() - t0) / 60000;
    if (dt > station.envToleranceMin) continue;
    if (!isValidEnvironment(e.temperatureC, e.pressureHPa)) {
      invalidInWindow = true;
      continue;
    }
    if (dt < bestDt) { bestDt = dt; best = e; }
  }
  if (best && best.temperatureC !== undefined && best.pressureHPa !== undefined) {
    return {
      temperatureC: best.temperatureC,
      pressureHPa: best.pressureHPa,
      source: 'measured',
      ageMin: bestDt,
      warnings,
    };
  }
  if (invalidInWindow) warnings.push(`Invalid T/P value ignored for ${station.id}`);
  // missing data -> policy
  const policy: MissingEnvPolicy = station.missingEnvPolicy;
  switch (policy) {
    case 'use-defaults':
      if (!isValidEnvironment(station.defaultTemperatureC, station.defaultPressureHPa)) {
        warnings.push(`Invalid fixed T/P configured for ${station.id}; no atmospheric correction applied`);
        return { source: 'none', warnings };
      }
      warnings.push(`No T/P within ${station.envToleranceMin} min for ${station.id}; configured defaults used`);
      return {
        temperatureC: station.defaultTemperatureC,
        pressureHPa: station.defaultPressureHPa,
        source: 'defaults', warnings,
      };
    case 'assume-corrected':
      warnings.push(`No T/P for ${station.id}; distances assumed already corrected`);
      return { source: 'station', warnings };
    case 'raw-with-warning':
      warnings.push(`No T/P for ${station.id}; raw distance used without atmospheric correction`);
      return { source: 'none', warnings };
    case 'wait-for-late-data':
      warnings.push(`No T/P for ${station.id}; result provisional, waiting for late environmental data`);
      return { source: 'none', warnings };
    case 'fail-run':
      warnings.push(`FAIL: no T/P for ${station.id} and policy is fail-run`);
      return { source: 'none', warnings };
  }
}

export interface CorrectionInput {
  observation: RawObservation;
  station: Station;
  setup: Pick<StationPrismSetup, 'effectiveConstantM' | 'constantAppliedByStationM' | 'measurementType'>;
  instrument: InstrumentProfile;
  env: EnvLookupResult;
  datumScale: number;
  targetId: string;
}

/** Apply the full, traced correction chain to one observation. */
export function correctDistance(input: CorrectionInput): CorrectionTrace {
  const { observation, station, setup, instrument, env, datumScale, targetId } = input;
  const warnings = [...env.warnings];
  const state: DistanceState = station.distanceState;

  // 1. prism correction (differential: only what the station did NOT apply)
  let dPrism = 0;
  if (state === 'raw' || state === 'atmo-corrected' || state === 'unknown') {
    dPrism = prismDelta(setup);
  } else {
    // station already applied a prism constant; correct the difference only
    dPrism = prismDelta(setup);
    if (Math.abs(dPrism) > 1e-9 && (state === 'prism-corrected' || state === 'fully-corrected')) {
      warnings.push(
        `Station applied ${(setup.constantAppliedByStationM * 1000).toFixed(1)} mm; ` +
        `differential ${(dPrism * 1000).toFixed(1)} mm applied by BTM`,
      );
    }
  }
  if (state === 'unknown') {
    warnings.push('Distance state unknown: user assumption "raw" applied');
  }
  const afterPrism = observation.sdM + dPrism;

  // 2. atmospheric correction
  let ppm = 0;
  let scale = 1;
  // AtmosphericMode is the single source of truth. DistanceState is retained
  // only for backwards-compatible snapshots and must not silently override
  // the explicit atmospheric choice made in the Instrument step.
  const atmoAlreadyDone = env.source === 'station';
  if (instrument.atmosphericModel === 'none' && (env.source === 'measured' || env.source === 'defaults')) {
    warnings.push(`No atmospheric model configured for ${instrument.manufacturer} ${instrument.model}`);
  } else if (!atmoAlreadyDone && (env.source === 'measured' || env.source === 'defaults')
      && env.temperatureC !== undefined && env.pressureHPa !== undefined) {
    ppm = atmosphericPpm(env.temperatureC, env.pressureHPa);
    scale = 1 + ppm * 1e-6;
  }
  const afterAtmo = afterPrism * scale;

  // 3. A datum/grid scale is intentionally NOT multiplied into the slope
  // distance here. It belongs to the horizontal reduction performed by the
  // adjustment/export layer. Keeping it in the trace prevents it being
  // confused with the atmospheric EDM scale used above.
  const final = afterAtmo;

  return {
    observationId: observation.id,
    stationId: station.id,
    targetId,
    storedDistanceM: observation.sdM,
    prismDeltaM: dPrism,
    distanceAfterPrismM: afterPrism,
    temperatureC: env.temperatureC,
    pressureHPa: env.pressureHPa,
    atmosphericPpm: ppm,
    atmosphericScale: scale,
    distanceAfterAtmosphereM: afterAtmo,
    datumScale,
    finalDistanceM: final,
    formulaVersion: instrument.atmosphericModelVersion || ATMO_FORMULA_VERSION,
    envSource: env.source,
    warnings,
  };
}

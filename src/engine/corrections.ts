// ---------------------------------------------------------------------------
// Distance correction chain, applied explicitly and traced step by step:
//   distanceAfterPrism      = storedDistance + prismDelta
//   atmosphericScale        = atmosphericModel(T, P, instrumentProfile)
//   distanceAfterAtmosphere = distanceAfterPrism * atmosphericScale
//   finalDistance           = distanceAfterAtmosphere * datumScale
// The PPM sign convention and formula version belong to the instrument
// profile and are recorded in every run snapshot.
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

export function prismDelta(setup: Pick<StationPrismSetup, 'effectiveConstantM' | 'constantAppliedByStationM'>): number {
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
  for (const e of env) {
    if (e.stationId !== station.id) continue;
    const dt = Math.abs(new Date(e.epoch).getTime() - t0) / 60000;
    if (dt < bestDt) { bestDt = dt; best = e; }
  }
  if (best && bestDt <= station.envToleranceMin
      && best.temperatureC !== undefined && best.pressureHPa !== undefined) {
    return {
      temperatureC: best.temperatureC,
      pressureHPa: best.pressureHPa,
      source: 'measured',
      ageMin: bestDt,
      warnings,
    };
  }
  // missing data -> policy
  const policy: MissingEnvPolicy = station.missingEnvPolicy;
  switch (policy) {
    case 'use-defaults':
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
  setup: Pick<StationPrismSetup, 'effectiveConstantM' | 'constantAppliedByStationM'>;
  instrument: InstrumentProfile;
  env: EnvLookupResult;
  datumScale: number;
  targetId: string;
}

/** Apply the full, traced correction chain to one observation. */
export function correctDistance(input: CorrectionInput): CorrectionTrace {
  const { observation, station, setup, env, datumScale, targetId } = input;
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
  const atmoAlreadyDone = state === 'atmo-corrected' || state === 'fully-corrected'
    || env.source === 'station';
  if (!atmoAlreadyDone && (env.source === 'measured' || env.source === 'defaults')
      && env.temperatureC !== undefined && env.pressureHPa !== undefined) {
    ppm = atmosphericPpm(env.temperatureC, env.pressureHPa);
    scale = 1 + ppm * 1e-6;
  }
  const afterAtmo = afterPrism * scale;

  // 3. datum / grid scale factor (separate, explicit step)
  const final = afterAtmo * datumScale;

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
    formulaVersion: ATMO_FORMULA_VERSION,
    envSource: env.source,
    warnings,
  };
}

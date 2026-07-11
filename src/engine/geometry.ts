// ---------------------------------------------------------------------------
// Angular helpers and polar <-> cartesian conversions.
// Azimuths are counted from North, clockwise (surveying convention):
//   azimuth = atan2(dE, dN)
// ---------------------------------------------------------------------------

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const ARCSEC2RAD = Math.PI / (180 * 3600);

/** normalize an angle (radians) to [-pi, +pi] */
export function wrapPi(a: number): number {
  let x = a % (2 * Math.PI);
  if (x > Math.PI) x -= 2 * Math.PI;
  if (x < -Math.PI) x += 2 * Math.PI;
  return x;
}

/** normalize an angle (radians) to [0, 2pi) */
export function wrapTwoPi(a: number): number {
  let x = a % (2 * Math.PI);
  if (x < 0) x += 2 * Math.PI;
  return x;
}

/** weighted circular mean of angles (radians). Returns undefined for empty input. */
export function circularMean(angles: number[], weights?: number[]): number | undefined {
  if (angles.length === 0) return undefined;
  let s = 0; let c = 0;
  for (let i = 0; i < angles.length; i++) {
    const w = weights ? weights[i] : 1;
    s += w * Math.sin(angles[i]);
    c += w * Math.cos(angles[i]);
  }
  if (s === 0 && c === 0) return undefined;
  return Math.atan2(s, c);
}

/** circular spread (max angular deviation from the mean) in radians */
export function circularSpread(angles: number[], mean: number): number {
  let m = 0;
  for (const a of angles) m = Math.max(m, Math.abs(wrapPi(a - mean)));
  return m;
}

export interface Enh { e: number; n: number; h: number }

/**
 * Forward polar computation from a station:
 *   horizontalDistance = correctedSlopeDistance * sin(zenith)
 *   deltaHeightLOS     = correctedSlopeDistance * cos(zenith)
 *   azimuth            = horizontalDirection + stationOrientation
 *   E = Es + hd * sin(az) ; N = Ns + hd * cos(az)
 *   H = Hs + instrumentHeight + deltaHeightLOS - targetHeight
 */
export function polarToEnh(args: {
  station: Enh; instrumentHeightM: number; targetHeightM: number;
  slopeDistanceM: number; hzRad: number; vzRad: number; orientationRad: number;
}): Enh {
  const hd = args.slopeDistanceM * Math.sin(args.vzRad);
  const dh = args.slopeDistanceM * Math.cos(args.vzRad);
  const az = args.hzRad + args.orientationRad;
  return {
    e: args.station.e + hd * Math.sin(az),
    n: args.station.n + hd * Math.cos(az),
    h: args.station.h + args.instrumentHeightM + dh - args.targetHeightM,
  };
}

/** azimuth from station to target, from North clockwise, in radians [0,2pi) */
export function azimuth(from: { e: number; n: number }, to: { e: number; n: number }): number {
  return wrapTwoPi(Math.atan2(to.e - from.e, to.n - from.n));
}

export function horizontalDistance(a: { e: number; n: number }, b: { e: number; n: number }): number {
  return Math.hypot(b.e - a.e, b.n - a.n);
}

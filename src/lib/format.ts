export function fmtDateTime(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toISOString().replace('T', ' ').slice(0, 16) + 'Z';
}

export function fmtTime(iso?: string): string {
  if (!iso) return '-';
  return new Date(iso).toISOString().slice(11, 16);
}

export function fmtM(x?: number, digits = 4): string {
  return x === undefined || Number.isNaN(x) ? '-' : x.toFixed(digits);
}

export function fmtMm(x?: number, digits = 2): string {
  return x === undefined || Number.isNaN(x) ? '-' : (x * 1000).toFixed(digits);
}

export function fmtNum(x?: number, digits = 3): string {
  return x === undefined || Number.isNaN(x) || !Number.isFinite(x) ? '-' : x.toFixed(digits);
}

export function fmtArcSec(rad?: number, digits = 2): string {
  return rad === undefined || Number.isNaN(rad) ? '-' : (rad * 206264.806).toFixed(digits);
}

export function fmtDeg(deg?: number, digits = 5): string {
  return deg === undefined || Number.isNaN(deg) ? '-' : deg.toFixed(digits);
}

export function fmtPct(x?: number): string {
  return x === undefined || Number.isNaN(x) ? '-' : `${(x * 100).toFixed(0)}%`;
}

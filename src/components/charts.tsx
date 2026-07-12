// Compact SVG diagnostics: sorted standardized residuals, chi-square bounds
// indicator, residual histogram and per-trial evolution chart.
import React from 'react';

export function ResidualBars({ values, threshold, height = 120, labels }: {
  values: number[]; threshold: number; height?: number; labels?: string[];
}) {
  const sorted = values.map((v, i) => ({ v, l: labels?.[i] })).sort((a, b) => b.v - a.v).slice(0, 40);
  const max = Math.max(threshold * 1.2, ...sorted.map((x) => x.v), 1);
  const w = 640;
  const bw = Math.max(4, Math.min(18, w / Math.max(sorted.length, 1) - 2));
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full">
      <line x1={0} x2={w} y1={height - 16 - (threshold / max) * (height - 26)} y2={height - 16 - (threshold / max) * (height - 26)}
        stroke="#f43f5e" strokeDasharray="4 3" strokeWidth={1} />
      <text x={w - 4} y={height - 20 - (threshold / max) * (height - 26)} textAnchor="end" fontSize={9} fill="#f43f5e">
        threshold {threshold}
      </text>
      {sorted.map((x, i) => {
        const bh = (x.v / max) * (height - 26);
        return (
          <g key={i}>
            <rect x={i * (bw + 2) + 2} y={height - 16 - bh} width={bw} height={bh}
              fill={x.v > threshold ? '#fb7185' : '#60a5fa'} rx={1}>
              {x.l && <title>{x.l}: {x.v.toFixed(2)}</title>}
            </rect>
          </g>
        );
      })}
      <text x={2} y={height - 4} fontSize={9} fill="#94a3b8">sorted standardized residuals (top {sorted.length})</text>
    </svg>
  );
}

export function Chi2Gauge({ value, lower, upper, height = 64 }: {
  value: number; lower: number; upper: number; height?: number;
}) {
  const w = 640;
  if (!Number.isFinite(value) || !Number.isFinite(lower) || !Number.isFinite(upper)) {
    return <div className="rounded-md bg-slate-50 px-3 py-2 text-2xs text-slate-400 ring-1 ring-slate-200">
      Chi-square test not available (technical failure or zero degrees of freedom).</div>;
  }
  const span = Math.max(upper * 1.4, value * 1.1, 1);
  const x = (v: number) => (v / span) * (w - 20) + 10;
  const pass = value >= lower && value <= upper;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full">
      <rect x={10} y={26} width={w - 20} height={10} rx={5} fill="#f1f5f9" />
      <rect x={x(lower)} y={26} width={Math.max(2, x(upper) - x(lower))} height={10} rx={5} fill="#bbf7d0" />
      <line x1={x(lower)} x2={x(lower)} y1={20} y2={42} stroke="#059669" strokeWidth={1.2} />
      <line x1={x(upper)} x2={x(upper)} y1={20} y2={42} stroke="#059669" strokeWidth={1.2} />
      <text x={x(lower)} y={16} textAnchor="middle" fontSize={9} fill="#059669">{lower.toFixed(1)}</text>
      <text x={x(upper)} y={16} textAnchor="middle" fontSize={9} fill="#059669">{upper.toFixed(1)}</text>
      <circle cx={x(Math.min(value, span))} cy={31} r={6} fill={pass ? '#10b981' : '#f43f5e'} stroke="white" strokeWidth={2} />
      <text x={x(Math.min(value, span))} y={56} textAnchor="middle" fontSize={10} fontWeight={600}
        fill={pass ? '#059669' : '#e11d48'}>
        χ² = {Number.isFinite(value) ? value.toFixed(1) : 'n/a'} {pass ? '(inside bounds)' : '(outside bounds)'}
      </text>
    </svg>
  );
}

export function Histogram({ values, bins = 15, height = 100 }: {
  values: number[]; bins?: number; height?: number;
}) {
  if (values.length === 0) return null;
  const min = Math.min(...values); const max = Math.max(...values);
  const span = Math.max(max - min, 1e-9);
  const counts = new Array(bins).fill(0);
  for (const v of values) {
    const b = Math.min(bins - 1, Math.floor(((v - min) / span) * bins));
    counts[b]++;
  }
  const cMax = Math.max(...counts, 1);
  const w = 640;
  const bw = (w - 20) / bins;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full">
      {counts.map((c, i) => (
        <rect key={i} x={10 + i * bw + 1} y={height - 18 - (c / cMax) * (height - 28)}
          width={bw - 2} height={(c / cMax) * (height - 28)} fill="#93c5fd" rx={1} />
      ))}
      <text x={10} y={height - 4} fontSize={9} fill="#94a3b8">{min.toFixed(2)}</text>
      <text x={w - 10} y={height - 4} textAnchor="end" fontSize={9} fill="#94a3b8">{max.toFixed(2)}</text>
    </svg>
  );
}

export function TrendChart({ series, height = 130 }: {
  series: { label: string; color: string; points: { x: string; y: number }[] }[];
  height?: number;
}) {
  const all = series.flatMap((s) => s.points.map((p) => p.y)).filter((y) => Number.isFinite(y));
  if (all.length === 0) return null;
  const yMax = Math.max(...all, 1e-9) * 1.15;
  const n = Math.max(...series.map((s) => s.points.length), 2);
  const w = 640;
  const px = (i: number) => 30 + (i / (n - 1)) * (w - 50);
  const py = (y: number) => height - 22 - (y / yMax) * (height - 40);
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full">
      <line x1={30} x2={w - 20} y1={height - 22} y2={height - 22} stroke="#e2e8f0" />
      {series.map((s) => (
        <g key={s.label}>
          <polyline fill="none" stroke={s.color} strokeWidth={1.6}
            points={s.points.map((p, i) => `${px(i)},${py(p.y)}`).join(' ')} />
          {s.points.map((p, i) => (
            <circle key={i} cx={px(i)} cy={py(p.y)} r={2.6} fill={s.color}>
              <title>{s.label} @ {p.x}: {p.y.toFixed(3)}</title>
            </circle>
          ))}
        </g>
      ))}
      <g>
        {series.map((s, i) => (
          <text key={s.label} x={34 + i * 150} y={12} fontSize={9} fill={s.color} fontWeight={600}>— {s.label}</text>
        ))}
      </g>
      {series[0]?.points.map((p, i) => (
        <text key={i} x={px(i)} y={height - 8} textAnchor="middle" fontSize={8.5} fill="#94a3b8">{p.x}</text>
      ))}
    </svg>
  );
}

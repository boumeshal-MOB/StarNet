// ---------------------------------------------------------------------------
// Interactive local E/N network view (SVG, no basemap): stations, references,
// prisms, observation rays, displacement vectors and confidence ellipses.
// The exaggeration slider affects visualization only, never the computation.
// ---------------------------------------------------------------------------
import React, { useMemo, useState } from 'react';
import { cls } from './ui';

export interface NetPoint {
  id: string;
  e: number; n: number;
  role: 'station' | 'reference' | 'monitoring' | 'auxiliary';
  status?: 'ok' | 'warning' | 'error' | 'disabled';
  ellipse?: { semiMajorM: number; semiMinorM: number; orientationDeg: number };
  displacement?: { dE: number; dN: number };
  tooltip?: string[];
}

export interface NetRay {
  from: string; to: string;
  flag?: 'normal' | 'suspect' | 'excluded';
}

const ROLE_FILL: Record<NetPoint['role'], string> = {
  station: '#1d5fec',
  reference: '#0f766e',
  monitoring: '#9333ea',
  auxiliary: '#64748b',
};

export function NetworkView({ points, rays, selected, onSelect, height = 420 }: {
  points: NetPoint[];
  rays: NetRay[];
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  height?: number;
}) {
  const [exaggeration, setExaggeration] = useState(500);
  const [hover, setHover] = useState<string | null>(null);

  const { toX, toY, w, h } = useMemo(() => {
    const es = points.map((p) => p.e);
    const ns = points.map((p) => p.n);
    const minE = Math.min(...es), maxE = Math.max(...es);
    const minN = Math.min(...ns), maxN = Math.max(...ns);
    const w = 720, h = height;
    const pad = 46;
    const spanE = Math.max(maxE - minE, 1);
    const spanN = Math.max(maxN - minN, 1);
    const scale = Math.min((w - 2 * pad) / spanE, (h - 2 * pad) / spanN);
    return {
      w, h,
      toX: (e: number) => pad + (e - minE) * scale + ((w - 2 * pad) - spanE * scale) / 2,
      toY: (n: number) => h - pad - (n - minN) * scale - ((h - 2 * pad) - spanN * scale) / 2,
      scale,
    };
  }, [points, height]);

  const byId = useMemo(() => new Map(points.map((p) => [p.id, p])), [points]);
  const hovered = hover ? byId.get(hover) : null;
  const mScale = useMemo(() => {
    // metres->px for ellipses: reuse plot scale via two reference conversions
    if (points.length === 0) return 1;
    const p0 = points[0];
    return Math.abs(toX(p0.e + 1) - toX(p0.e));
  }, [points, toX]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-2xs text-slate-500">
          <LegendDot color={ROLE_FILL.station} label="Station" shape="triangle" />
          <LegendDot color={ROLE_FILL.reference} label="Reference" shape="square" />
          <LegendDot color={ROLE_FILL.monitoring} label="Monitoring prism" shape="circle" />
          <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-rose-400" /> suspect residual</span>
        </div>
        <label className="flex items-center gap-2 text-2xs text-slate-500">
          Ellipse / displacement exaggeration ×{exaggeration}
          <input type="range" min={50} max={5000} step={50} value={exaggeration}
            onChange={(e) => setExaggeration(Number(e.target.value))} />
          <span className="text-slate-400">(visualization only)</span>
        </label>
      </div>
      <div className="relative overflow-hidden rounded-md ring-1 ring-slate-200 bg-slate-50">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Network view"
          onClick={() => onSelect?.(null)}>
          {/* grid */}
          {Array.from({ length: 9 }, (_, i) => (
            <React.Fragment key={i}>
              <line x1={(w / 9) * i} y1={0} x2={(w / 9) * i} y2={h} stroke="#e2e8f0" strokeWidth={0.5} />
              <line x1={0} y1={(h / 9) * i} x2={w} y2={(h / 9) * i} stroke="#e2e8f0" strokeWidth={0.5} />
            </React.Fragment>
          ))}
          <text x={10} y={16} className="fill-slate-400" fontSize={10}>N ↑ / E →</text>
          {/* rays */}
          {rays.map((r, i) => {
            const a = byId.get(r.from); const b = byId.get(r.to);
            if (!a || !b) return null;
            const stroke = r.flag === 'suspect' ? '#fb7185' : r.flag === 'excluded' ? '#cbd5e1' : '#93c5fd';
            return (
              <line key={i} x1={toX(a.e)} y1={toY(a.n)} x2={toX(b.e)} y2={toY(b.n)}
                stroke={stroke} strokeWidth={r.flag === 'suspect' ? 1.8 : 0.8}
                strokeDasharray={r.flag === 'excluded' ? '3 3' : undefined} opacity={0.8} />
            );
          })}
          {/* displacement vectors */}
          {points.map((p) => p.displacement && (Math.abs(p.displacement.dE) + Math.abs(p.displacement.dN) > 1e-9) ? (
            <line key={`d-${p.id}`}
              x1={toX(p.e)} y1={toY(p.n)}
              x2={toX(p.e) + p.displacement.dE * exaggeration * mScale}
              y2={toY(p.n) - p.displacement.dN * exaggeration * mScale}
              stroke="#f59e0b" strokeWidth={1.6} markerEnd="url(#arrow)" />
          ) : null)}
          <defs>
            <marker id="arrow" viewBox="0 0 8 8" refX={7} refY={4} markerWidth={6} markerHeight={6} orient="auto">
              <path d="M0 0 L8 4 L0 8 z" fill="#f59e0b" />
            </marker>
          </defs>
          {/* ellipses */}
          {points.map((p) => p.ellipse && p.ellipse.semiMajorM > 0 ? (
            <ellipse key={`e-${p.id}`}
              cx={toX(p.e)} cy={toY(p.n)}
              rx={Math.max(2, p.ellipse.semiMajorM * exaggeration * mScale)}
              ry={Math.max(2, p.ellipse.semiMinorM * exaggeration * mScale)}
              transform={`rotate(${90 - p.ellipse.orientationDeg} ${toX(p.e)} ${toY(p.n)})`}
              fill="rgba(51,126,247,0.08)" stroke="#337ef7" strokeWidth={0.8} />
          ) : null)}
          {/* points */}
          {points.map((p) => {
            const x = toX(p.e); const y = toY(p.n);
            const color = p.status === 'error' ? '#e11d48'
              : p.status === 'warning' ? '#d97706'
                : p.status === 'disabled' ? '#94a3b8' : ROLE_FILL[p.role];
            const isSel = selected === p.id;
            return (
              <g key={p.id} className="cursor-pointer"
                onClick={(e) => { e.stopPropagation(); onSelect?.(p.id); }}
                onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(null)}>
                {isSel && <circle cx={x} cy={y} r={11} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="2 2" />}
                {p.role === 'station' ? (
                  <path d={`M${x} ${y - 6} L${x + 6} ${y + 5} L${x - 6} ${y + 5} Z`} fill={color} />
                ) : p.role === 'reference' ? (
                  <rect x={x - 4.5} y={y - 4.5} width={9} height={9} fill={color} />
                ) : (
                  <circle cx={x} cy={y} r={4.5} fill={color} />
                )}
                <text x={x + 8} y={y - 6} fontSize={9.5} className={cls('select-none', isSel ? 'fill-slate-900 font-semibold' : 'fill-slate-500')}>
                  {p.id}
                </text>
              </g>
            );
          })}
        </svg>
        {hovered && hovered.tooltip && (
          <div className="pointer-events-none absolute left-2 bottom-2 rounded-md bg-slate-900/90 px-3 py-2 text-2xs text-white shadow-lg">
            <div className="font-semibold">{hovered.id}</div>
            {hovered.tooltip.map((t, i) => <div key={i}>{t}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}

function LegendDot({ color, label, shape }: { color: string; label: string; shape: 'circle' | 'square' | 'triangle' }) {
  return (
    <span className="inline-flex items-center gap-1">
      {shape === 'circle' && <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />}
      {shape === 'square' && <span className="inline-block h-2.5 w-2.5" style={{ background: color }} />}
      {shape === 'triangle' && (
        <span className="inline-block h-0 w-0 border-x-[5px] border-b-[9px] border-x-transparent" style={{ borderBottomColor: color }} />
      )}
      {label}
    </span>
  );
}

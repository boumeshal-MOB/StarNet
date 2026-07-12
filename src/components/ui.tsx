import React, { useEffect } from 'react';
import type { ProcessingStatus } from '../types/domain';

export function cls(...xs: (string | false | undefined | null)[]): string {
  return xs.filter(Boolean).join(' ');
}

// ------------------------------------------------------------------ Badge --
const STATUS_COLORS: Record<string, string> = {
  'Draft': 'bg-slate-100 text-slate-600 ring-slate-300',
  'Waiting for data': 'bg-amber-50 text-amber-700 ring-amber-300',
  'Ready': 'bg-sky-50 text-sky-700 ring-sky-300',
  'Running': 'bg-indigo-50 text-indigo-700 ring-indigo-300 animate-pulse',
  'Success': 'bg-emerald-50 text-emerald-700 ring-emerald-300',
  'Success with warnings': 'bg-lime-50 text-lime-700 ring-lime-300',
  'Provisional': 'bg-amber-50 text-amber-700 ring-amber-300',
  'Failed quality control': 'bg-rose-50 text-rose-700 ring-rose-300',
  'Technical error': 'bg-red-50 text-red-700 ring-red-300',
  'Disabled': 'bg-slate-100 text-slate-500 ring-slate-300',
  'Archived': 'bg-slate-100 text-slate-400 ring-slate-200',
  'active': 'bg-emerald-50 text-emerald-700 ring-emerald-300',
  'inactive': 'bg-slate-100 text-slate-500 ring-slate-300',
  'draft': 'bg-slate-100 text-slate-600 ring-slate-300',
  'scheduled': 'bg-sky-50 text-sky-700 ring-sky-300',
  'archived': 'bg-slate-100 text-slate-400 ring-slate-200',
  'deprecated': 'bg-amber-50 text-amber-700 ring-amber-300',
  'open': 'bg-sky-50 text-sky-700 ring-sky-300',
  'completed': 'bg-emerald-50 text-emerald-700 ring-emerald-300',
  'abandoned': 'bg-slate-100 text-slate-500 ring-slate-300',
  'fresh': 'bg-emerald-50 text-emerald-700 ring-emerald-300',
  'reused': 'bg-amber-50 text-amber-700 ring-amber-300',
  'missing': 'bg-rose-50 text-rose-700 ring-rose-300',
  'PASS': 'bg-emerald-50 text-emerald-700 ring-emerald-300',
  'FAIL': 'bg-rose-50 text-rose-700 ring-rose-300',
};

export function Badge({ children, tone }: { children: React.ReactNode; tone?: string }) {
  const color = STATUS_COLORS[tone ?? String(children)] ?? 'bg-slate-100 text-slate-600 ring-slate-300';
  return (
    <span className={cls('inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium ring-1 ring-inset whitespace-nowrap', color)}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: ProcessingStatus | string }) {
  return <Badge tone={status}>{status}</Badge>;
}

// ----------------------------------------------------------------- Button --
export function Button({
  children, onClick, variant = 'secondary', size = 'sm', disabled, title, type,
}: {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'xs' | 'sm' | 'md';
  disabled?: boolean;
  title?: string;
  type?: 'button' | 'submit';
}) {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-50 disabled:cursor-not-allowed';
  const variants = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm hover:shadow',
    secondary: 'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 shadow-sm hover:ring-slate-400',
    danger: 'bg-white text-rose-600 ring-1 ring-inset ring-rose-200 hover:bg-rose-50 shadow-sm',
    ghost: 'text-brand-700 hover:bg-brand-50',
  };
  const sizes = { xs: 'px-2 py-0.5 text-2xs', sm: 'px-2.5 py-1.5 text-xs', md: 'px-3.5 py-2 text-sm' };
  return (
    <button type={type ?? 'button'} title={title} disabled={disabled} onClick={onClick}
      className={cls(base, variants[variant], sizes[size])}>
      {children}
    </button>
  );
}

// ------------------------------------------------------------------- Card --
export function Card({ title, children, actions, className }: {
  title?: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode; className?: string;
}) {
  return (
    <section className={cls('overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm', className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-3">
          <h3 className="text-sm font-semibold tracking-tight text-slate-800">{title}</h3>
          <div className="flex items-center gap-2">{actions}</div>
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

// ------------------------------------------------------------------- Tabs --
export function Tabs({ tabs, active, onChange }: {
  tabs: { id: string; label: React.ReactNode; badge?: React.ReactNode }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-slate-200" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={cls(
            'px-3 py-2 text-xs font-medium rounded-t-md border-b-2 -mb-px transition-colors',
            active === t.id
              ? 'border-brand-600 text-brand-700 bg-white'
              : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50',
          )}>
          <span className="inline-flex items-center gap-1.5">{t.label}{t.badge}</span>
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Field --
export function Field({ label, children, hint, unit, inherited }: {
  label: React.ReactNode; children: React.ReactNode; hint?: string; unit?: string;
  inherited?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline gap-1.5 text-xs font-medium text-slate-600">
        {label}
        {unit && <span className="text-2xs font-normal text-slate-400">({unit})</span>}
      </span>
      {children}
      {hint && <span className="mt-0.5 block text-2xs text-slate-400">{hint}</span>}
      {inherited && <span className="mt-0.5 block text-2xs text-sky-600">Template default: {inherited}</span>}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cls('input', props.className)} />;
}

export function NumberInput({ value, onChange, step, disabled, className }: {
  value: number | undefined; onChange: (v: number) => void; step?: number;
  disabled?: boolean; className?: string;
}) {
  return (
    <input type="number" step={step ?? 'any'} value={value ?? ''} disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className={cls('input', className)} />
  );
}

export function Select({ value, onChange, options, disabled }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; disabled?: boolean;
}) {
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="input">
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Toggle({ checked, onChange, label, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; disabled?: boolean;
}) {
  return (
    <label className={cls('inline-flex cursor-pointer items-center gap-2', disabled && 'opacity-50')}>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cls('relative h-5 w-9 rounded-full transition-colors',
          checked ? 'bg-brand-600' : 'bg-slate-300')}>
        <span className={cls('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5')} />
      </button>
      {label && <span className="text-xs text-slate-600">{label}</span>}
    </label>
  );
}

// ----------------------------------------------------------------- Drawer --
export function Drawer({ open, onClose, title, children, wide }: {
  open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div className={cls('absolute right-0 top-0 h-full overflow-y-auto bg-white shadow-xl',
        wide ? 'w-[46rem] max-w-full' : 'w-[30rem] max-w-full')}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <h3 className="text-sm font-semibold">{title}</h3>
          <Button variant="ghost" size="xs" onClick={onClose}>Close ✕</Button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Modal --
export function Modal({ open, onClose, title, children, footer }: {
  open: boolean; onClose: () => void; title: React.ReactNode;
  children: React.ReactNode; footer?: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold">{title}</h3>
          <Button variant="ghost" size="xs" onClick={onClose}>✕</Button>
        </div>
        <div className="p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Stepper --
export function Stepper({ steps, current, onGoto, maxReached }: {
  steps: string[]; current: number; onGoto: (i: number) => void; maxReached: number;
}) {
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5 xl:grid-cols-10">
      {steps.map((s, i) => (
        <li key={s}>
          <button onClick={() => i <= maxReached && onGoto(i)}
            disabled={i > maxReached}
            className={cls('flex h-full w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-2xs font-medium transition-all',
              i === current ? 'border-brand-600 bg-brand-600 text-white shadow-sm'
                : i <= maxReached ? 'border-brand-100 bg-white text-brand-700 hover:border-brand-300 hover:bg-brand-50'
                  : 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400')}>
            <span className={cls('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-2xs font-bold',
              i === current ? 'bg-white/20 text-white'
                : i < current ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
              {i < current ? '✓' : i + 1}
            </span>
            <span className="leading-tight">{s}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------- Callout --
export function Callout({ tone, children }: {
  tone: 'info' | 'warning' | 'error' | 'success'; children: React.ReactNode;
}) {
  const tones = {
    info: 'bg-sky-50 text-sky-800 ring-sky-200',
    warning: 'bg-amber-50 text-amber-800 ring-amber-200',
    error: 'bg-rose-50 text-rose-800 ring-rose-200',
    success: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  };
  return <div className={cls('rounded-md px-3 py-2 text-xs ring-1 ring-inset', tones[tone])}>{children}</div>;
}

// --------------------------------------------------------------------- KV --
export function KV({ items }: { items: [React.ReactNode, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
      {items.map(([k, v], i) => (
        <React.Fragment key={i}>
          <dt className="text-slate-500">{k}</dt>
          <dd className="font-medium text-slate-800">{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-slate-300 px-4 py-8 text-center text-xs text-slate-400">
      {children}
    </div>
  );
}

// scrollable dense table wrapper
export function TableWrap({ children, maxH }: { children: React.ReactNode; maxH?: string }) {
  return (
    <div className={cls('overflow-auto rounded-md ring-1 ring-slate-200', maxH ?? 'max-h-[32rem]')}>
      <table className="table-dense w-full border-collapse">{children}</table>
    </div>
  );
}

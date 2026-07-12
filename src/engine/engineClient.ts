// ---------------------------------------------------------------------------
// Engine client: prefers a Web Worker (validation computations run locally in
// the browser, off the main thread); falls back to a synchronous call when
// workers are unavailable (unit tests, SSR).
// ---------------------------------------------------------------------------
import { runAdjustment, type RunnerInput, type RunnerOutput } from './runner';

let worker: Worker | null = null;
let callSeq = 0;
const pending = new Map<number, { resolve: (r: RunnerOutput) => void; reject: (e: unknown) => void }>();

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ callId: number; ok: boolean; result?: RunnerOutput; error?: string }>) => {
      const p = pending.get(e.data.callId);
      if (!p) return;
      pending.delete(e.data.callId);
      if (e.data.ok && e.data.result) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error ?? 'engine worker failed'));
    };
    worker.onerror = () => {
      for (const [, p] of pending) p.reject(new Error('engine worker crashed'));
      pending.clear();
      worker = null;
    };
    return worker;
  } catch {
    worker = null;
    return null;
  }
}

export async function runAdjustmentAsync(input: RunnerInput): Promise<RunnerOutput> {
  const w = getWorker();
  if (!w) return runAdjustment(input);
  return new Promise<RunnerOutput>((resolve, reject) => {
    const callId = ++callSeq;
    pending.set(callId, { resolve, reject });
    try {
      w.postMessage({ callId, input });
    } catch (err) {
      pending.delete(callId);
      // non-cloneable payload or worker failure: run synchronously
      try { resolve(runAdjustment(input)); } catch (e) { reject(e); }
    }
  });
}

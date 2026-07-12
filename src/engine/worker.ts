// Web Worker entry: runs the adjustment off the main thread.
import { runAdjustment, type RunnerInput } from './runner';

self.onmessage = (e: MessageEvent<{ callId: number; input: RunnerInput }>) => {
  const { callId, input } = e.data;
  try {
    const result = runAdjustment(input);
    (self as unknown as Worker).postMessage({ callId, ok: true, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ callId, ok: false, error: String(err) });
  }
};

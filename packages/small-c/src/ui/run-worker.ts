// Runs a compiled program off the main thread, so a program that never ends
// can be stopped (the page terminates this worker).
import { runWithHostEngine } from '../lang/run';

self.onmessage = async (e: MessageEvent<Uint8Array>) => {
  const t0 = performance.now();
  try {
    const r = await runWithHostEngine(e.data);
    self.postMessage({ ...r, ms: performance.now() - t0 });
  } catch (err) {
    self.postMessage({ output: '', exitCode: null, trap: (err as Error).message, ms: performance.now() - t0 });
  }
};

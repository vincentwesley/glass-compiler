import { h } from '@glass/ui/dom';
import type { RunResult } from '../lang/run';
import type { Store } from './store';

/** Stage 4: the program runs on this browser's own WebAssembly engine, in a worker. */
export function mountRun(body: HTMLElement, meta: HTMLElement, store: Store, timeLimitMs = 4000) {
  const status = h('p', { class: 'run-status', role: 'status' });
  const output = h('pre', { class: 'run-output', tabindex: '0', 'aria-label': 'What the program printed' });
  const again = h('button', { type: 'button', class: 'btn btn-small' }, 'Run again');
  body.append(h('div', { class: 'run-bar' }, status, again), output);

  let worker: Worker | null = null;
  let timer: number | undefined;
  let runId = 0;

  const stop = () => {
    worker?.terminate();
    worker = null;
    window.clearTimeout(timer);
  };

  const start = () => {
    stop();
    const wasm = store.state.build.wasm;
    if (!wasm) {
      store.set({ run: null });
      return;
    }
    const id = ++runId;
    store.set({ run: { status: 'running', output: '', exitCode: null, trap: null, ms: 0 } });
    worker = new Worker(new URL('./run-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<RunResult & { ms: number }>) => {
      if (id !== runId) return;
      stop();
      const r = e.data;
      store.set({ run: { status: r.trap ? 'error' : 'done', output: r.output, exitCode: r.exitCode, trap: r.trap, ms: r.ms } });
    };
    timer = window.setTimeout(() => {
      if (id !== runId) return;
      stop();
      store.set({ run: { status: 'stopped', output: '', exitCode: null, trap: `still running after ${timeLimitMs / 1000} seconds, so it was stopped`, ms: timeLimitMs } });
    }, timeLimitMs);
    worker.postMessage(wasm.bytes);
  };
  again.addEventListener('click', start);

  const render = () => {
    const { run, build } = store.state;
    again.disabled = !build.wasm;
    if (!run) {
      status.replaceChildren(h('span', { class: 'badge badge-off' }, 'Not running'), ' ', build.diagnostics.length ? 'Fix the errors and it runs.' : '');
      output.textContent = '';
      meta.textContent = '';
      return;
    }
    if (run.status === 'running') {
      status.replaceChildren(h('span', { class: 'badge badge-run' }, 'Running'));
      return;
    }
    const ok = run.status === 'done' && run.exitCode === 0;
    status.replaceChildren(
      h('span', { class: `badge ${ok ? 'badge-done' : 'badge-err'}` }, run.status === 'done' ? 'Exited' : run.status === 'stopped' ? 'Stopped' : 'Trapped'),
      ' ',
      run.status === 'done' ? `exit status ${run.exitCode}` : run.trap ?? '',
    );
    output.textContent = run.output || '(nothing printed)';
    output.classList.toggle('is-empty', !run.output);
    meta.textContent = run.status === 'stopped' ? '' : `${run.ms < 1 ? '<1' : Math.round(run.ms)} ms · this browser's engine`;
  };

  store.subscribe((s, prev) => {
    if (s.build !== prev.build) start();
    if (s.run !== prev.run || s.build !== prev.build) render();
  });
  render();
  start();
}

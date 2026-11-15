import { formatValue, type Value } from '../lang';
import { h } from './dom';
import type { Store } from './store';

const SPEEDS: Record<string, number> = { slow: 700, normal: 260, fast: 60 };

const valueClass = (v: Value) =>
  v === null ? 'v-nil' : typeof v === 'object' ? 'v-fn' : typeof v === 'string' ? 'v-str' : typeof v === 'number' ? 'v-num' : 'v-bool';

const valueEl = (v: Value) => h('span', { class: `val ${valueClass(v)}` }, formatValue(v, true));

/** Stage 4: the virtual machine, stepping through the recorded trace. */
export function mountVm(body: HTMLElement, count: HTMLElement, store: Store) {
  let timer: number | undefined;

  const btn = (label: string, icon: string, onclick: () => void, extra: Record<string, string> = {}) =>
    h('button', { type: 'button', class: 'btn btn-step', 'aria-label': label, title: label, onclick, ...extra }, h('span', { 'aria-hidden': 'true' }, icon));

  const reset = btn('Back to the start', '⏮', () => store.set({ step: 0, playing: false }));
  const back = btn('Step back', '◀', () => store.set({ step: Math.max(0, store.state.step - 1), playing: false }), { 'data-testid': 'vm-back' });
  const fwd = btn('Step forward', '▶', () => store.set({ step: Math.min(store.lastStep(), store.state.step + 1), playing: false }), { 'data-testid': 'vm-step' });
  const play = h('button', { type: 'button', class: 'btn btn-play', 'aria-pressed': 'false', 'data-testid': 'vm-play', onclick: () => togglePlay() }, 'Play');
  const end = btn('Jump to the end', '⏭', () => store.set({ step: store.lastStep(), playing: false }));
  const speed = h(
    'select',
    { class: 'select', 'aria-label': 'Playback speed' },
    h('option', { value: 'slow' }, 'Slow'),
    h('option', { value: 'normal', selected: true }, 'Normal'),
    h('option', { value: 'fast' }, 'Fast'),
  );
  speed.addEventListener('change', () => {
    if (store.state.playing) startTimer();
  });
  const follow = h('input', { type: 'checkbox', id: 'vm-follow', checked: store.state.follow });
  follow.addEventListener('change', () => store.set({ follow: follow.checked }));

  const status = h('p', { class: 'vm-status', 'aria-live': 'polite' });
  const scrub = h('input', { type: 'range', class: 'scrub', min: '0', max: '0', value: '0', 'aria-label': 'VM step', 'data-testid': 'vm-scrub' });
  scrub.addEventListener('input', () => store.set({ step: Number(scrub.value), playing: false }));
  const ticks = h('svg', { class: 'ticks', 'aria-hidden': 'true', preserveAspectRatio: 'none', viewBox: '0 0 1000 10' });
  const tickPath = h('path', { class: 'tick-sel', d: '' });
  const tickPos = h('path', { class: 'tick-pos', d: '' });
  ticks.append(tickPath, tickPos);

  const stack = h('ol', { class: 'stack', 'aria-label': 'Value stack, top first', reversed: true });
  const frames = h('ol', { class: 'frames', 'aria-label': 'Call frames, innermost last' });
  const globals = h('div');
  const output = h('ol', { class: 'output', 'aria-label': 'Program output' });
  const errorBox = h('div', { class: 'vm-error', role: 'alert', hidden: true });

  body.append(
    h('div', { class: 'vm-controls', role: 'toolbar', 'aria-label': 'Virtual machine controls' }, reset, back, fwd, play, end, speed,
      h('label', { class: 'check', for: 'vm-follow' }, follow, h('span', null, 'Follow selection'))),
    status,
    h('div', { class: 'timeline' }, ticks, scrub),
    errorBox,
    h(
      'div',
      { class: 'vm-grid' },
      h('section', { class: 'vm-box vm-stack', 'aria-labelledby': 'vm-stack-h' }, h('h3', { id: 'vm-stack-h', class: 'pixel-label' }, 'Stack'), h('div', { class: 'scroll' }, stack)),
      h('section', { class: 'vm-box vm-frames', 'aria-labelledby': 'vm-frames-h' }, h('h3', { id: 'vm-frames-h', class: 'pixel-label' }, 'Frames & locals'), h('div', { class: 'scroll' }, frames)),
      h('section', { class: 'vm-box vm-globals', 'aria-labelledby': 'vm-globals-h' }, h('h3', { id: 'vm-globals-h', class: 'pixel-label' }, 'Globals'), h('div', { class: 'scroll' }, globals)),
      h('section', { class: 'vm-box vm-output', 'aria-labelledby': 'vm-output-h' }, h('h3', { id: 'vm-output-h', class: 'pixel-label' }, 'Output'), h('div', { class: 'scroll' }, output)),
    ),
  );

  output.addEventListener('click', (e) => {
    const li = (e.target as Element).closest<HTMLElement>('[data-step]');
    if (!li) return;
    const step = Number(li.dataset.step);
    const at = store.state.links.instrAtStep(step);
    store.set({ step, playing: false, selected: at?.instr.nodeId ?? null, origin: 'vm' });
  });
  status.addEventListener('click', (e) => {
    if (!(e.target as Element).closest('.status-instr')) return;
    const at = store.state.links.instrAtStep(store.state.step);
    if (at) store.select(at.instr.nodeId, 'vm');
  });

  function startTimer() {
    window.clearInterval(timer);
    timer = window.setInterval(() => {
      const s = store.state;
      if (s.step >= store.lastStep()) store.set({ playing: false });
      else store.set({ step: s.step + 1 });
    }, SPEEDS[speed.value] ?? 260);
  }

  function togglePlay() {
    const s = store.state;
    if (!s.build.trace) return;
    if (s.playing) store.set({ playing: false });
    else store.set({ playing: true, step: s.step >= store.lastStep() ? 0 : s.step });
  }

  const renderTicks = () => {
    const s = store.state;
    const last = store.lastStep();
    const x = (step: number) => (last === 0 ? 0 : (step / last) * 1000);
    const steps = s.selected !== null ? s.links.stepsForNode(s.selected) : [];
    tickPath.setAttribute('d', steps.map((st) => `M${x(st).toFixed(1)} 0V10`).join(''));
    tickPos.setAttribute('d', `M${x(s.step).toFixed(1)} 0V10`);
  };

  const render = () => {
    const s = store.state;
    const trace = s.build.trace;
    const last = store.lastStep();
    scrub.max = String(last);
    scrub.value = String(s.step);
    const disabled = !trace;
    for (const b of [reset, back, fwd, play, end]) b.disabled = disabled;
    scrub.disabled = disabled;
    back.disabled = disabled || s.step === 0;
    reset.disabled = back.disabled;
    fwd.disabled = disabled || s.step >= last;
    end.disabled = fwd.disabled;
    play.textContent = s.playing ? 'Pause' : 'Play';
    play.setAttribute('aria-pressed', String(s.playing));
    count.textContent = trace ? String(trace.snapshots.length - 1) : '0';

    if (!trace) {
      status.replaceChildren(h('span', { class: 'badge badge-off' }, 'Not running'), ' Fix the errors in the source and the program will run.');
      stack.replaceChildren();
      frames.replaceChildren();
      globals.replaceChildren();
      output.replaceChildren();
      errorBox.hidden = true;
      renderTicks();
      return;
    }

    const snap = trace.snapshots[s.step]!;
    const at = s.links.instrAtStep(s.step);
    const atEnd = s.step === last;
    const badge = !atEnd
      ? h('span', { class: 'badge badge-run' }, 'Running')
      : trace.status === 'finished'
        ? h('span', { class: 'badge badge-done' }, 'Finished')
        : h('span', { class: 'badge badge-err' }, trace.status === 'error' ? 'Runtime error' : 'Stopped');
    status.replaceChildren(
      badge,
      ` Step ${s.step} of ${last}`,
      ...(at
        ? [h('span', null, ' · next: ', h('button', { type: 'button', class: 'status-instr linkish', title: 'Select the node this instruction came from' },
            `${at.instr.op} (${s.build.compiled.chunks[at.chunk]!.name} ${String(at.ip).padStart(2, '0')})`))]
        : []),
    );

    errorBox.hidden = !(atEnd && trace.error);
    if (trace.error && atEnd) {
      errorBox.replaceChildren(
        h('strong', null, trace.status === 'error' ? 'Runtime error: ' : 'Stopped: '),
        trace.error.message,
        ' ',
        h('button', { type: 'button', class: 'linkish', onclick: () => store.select(trace.error!.nodeId ?? null, 'vm') }, 'Show where'),
      );
    }

    // Stack, top first, with each slot labelled by what it holds.
    const labels = new Map<number, string>();
    snap.frames.forEach((f, i) => {
      if (i > 0) labels.set(f.base - 1, `${f.name}()`);
      for (const l of f.locals) labels.set(f.base + l.slot, `${f.name === 'main' ? '' : f.name + '.'}${l.name}`);
    });
    const bases = new Set(snap.frames.slice(1).map((f) => f.base - 1));
    stack.replaceChildren(
      ...(snap.stack.length === 0
        ? [h('li', { class: 'empty' }, 'empty')]
        : snap.stack
            .map((v, i) =>
              h('li', { class: `slot${bases.has(i) ? ' slot-frame' : ''}${i === snap.stack.length - 1 ? ' slot-top' : ''}` },
                h('span', { class: 'slot-i', 'aria-hidden': 'true' }, String(i)),
                valueEl(v),
                h('span', { class: 'slot-label' }, labels.get(i) ?? 'temp')),
            )
            .reverse()),
    );

    frames.replaceChildren(
      ...snap.frames.map((f, i) =>
        h('li', { class: `frame${i === snap.frames.length - 1 ? ' frame-top' : ''}` },
          h('div', { class: 'frame-name' }, f.name === 'main' ? 'main' : `${f.name}()`, h('span', { class: 'frame-meta' }, ` base ${f.base}`)),
          f.locals.length === 0
            ? h('div', { class: 'muted small' }, 'no locals')
            : h('dl', { class: 'locals' }, ...f.locals.flatMap((l) => [h('dt', null, l.name), h('dd', null, valueEl(l.value))])),
        ),
      ),
    );

    globals.replaceChildren(
      snap.globals.length === 0
        ? h('p', { class: 'muted small' }, 'none yet')
        : h('dl', { class: 'globals' }, ...snap.globals.flatMap(([name, v]) => [h('dt', null, name), h('dd', null, valueEl(v))])),
    );

    const lines = trace.output.slice(0, snap.outputLength);
    output.replaceChildren(
      ...(lines.length === 0
        ? [h('li', { class: 'muted small' }, 'nothing printed yet')]
        : lines.map((l) => h('li', { 'data-step': l.step }, h('button', { type: 'button', class: 'out-line', title: `Printed at step ${l.step}` }, l.text)))),
    );
    output.parentElement!.scrollTop = output.parentElement!.scrollHeight;
    renderTicks();
  };

  store.subscribe((s, prev) => {
    if (s.playing !== prev.playing) {
      if (s.playing) startTimer();
      else window.clearInterval(timer);
    }
    if (s.build !== prev.build || s.step !== prev.step || s.playing !== prev.playing) render();
    else if (s.selected !== prev.selected) renderTicks();
  });
  render();
}

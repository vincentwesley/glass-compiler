import { h } from '@glass/ui/dom';
import { createStepper, type StepperChange, type StepperView } from '@glass/ui/stepper';
import { stepsFor, type MachineState, type WasmValue } from '../vm';
import { key, parseKey, type State, type WasmStore } from './state';

const valueEl = (v: WasmValue) =>
  h('span', { class: `val v-${v.type}`, title: `${v.type} ${v.bits}` }, h('span', { class: 'val-type' }, v.type), ' ', v.value);

/** Stage 2: the interpreter, stepping through the call. */
export function mountMachine(body: HTMLElement, count: HTMLElement, store: WasmStore, goto: (change: StepperChange) => void, select: (k: string | null) => void) {
  const follow = h('input', { type: 'checkbox', id: 'wasm-follow', checked: store.state.follow });
  follow.addEventListener('change', () => store.set({ follow: follow.checked }));
  const stepper = createStepper({
    label: 'Machine controls',
    scrubLabel: 'Machine step',
    testId: 'wasm',
    extra: [h('label', { class: 'check', for: 'wasm-follow' }, follow, h('span', null, 'Follow selection'))],
    onChange: goto,
  });
  const status = h('p', { class: 'vm-status', 'aria-live': 'polite' });
  const errorBox = h('div', { class: 'vm-error', role: 'alert', hidden: true });
  const stack = h('ol', { class: 'stack', 'aria-label': 'Value stack, top first', reversed: true });
  const frames = h('ol', { class: 'frames', 'aria-label': 'Call frames, innermost last' });
  const blocks = h('ol', { class: 'blocks', 'aria-label': 'Open blocks of the current function, innermost first' });
  const globals = h('div');
  const output = h('ol', { class: 'output', 'aria-label': 'Output printed by the host' });

  const box = (id: string, title: string, content: Element, cls: string) =>
    h('section', { class: `vm-box ${cls}`, 'aria-labelledby': id }, h('h3', { id, class: 'pixel-label' }, title), h('div', { class: 'scroll' }, content));

  body.append(
    stepper.toolbar,
    status,
    stepper.timeline,
    errorBox,
    h(
      'div',
      { class: 'vm-grid wasm-grid' },
      box('m-stack', 'Value stack', stack, 'vm-stack'),
      box('m-frames', 'Frames & locals', frames, 'vm-frames'),
      box('m-blocks', 'Open blocks', blocks, 'vm-blocks'),
      box('m-globals', 'Globals', globals, 'vm-globals'),
      box('m-output', 'Output', output, 'vm-output'),
    ),
  );

  status.addEventListener('click', (e) => {
    if ((e.target as Element).closest('.status-instr')) {
      const at = store.state.machine?.at;
      if (at) select(key(at.func, at.pc));
    }
  });

  const view = (s: State): StepperView => ({
    step: s.step,
    last: s.machine?.total ?? 0,
    playing: s.playing,
    enabled: !!s.machine,
    marks: s.selected ? stepsFor(s.trace, parseKey(s.selected).func, parseKey(s.selected).pc) : [],
  });

  const funcName = (s: State, func: number) => s.info?.funcs.find((f) => f.index === func)?.name ?? String(func);
  const instrText = (s: State, func: number, pc: number) => s.info?.funcs.find((f) => f.index === func)?.lines[pc]?.text ?? '?';

  const render = (s: State) => {
    stepper.render(view(s));
    const m: MachineState | null = s.machine;
    count.textContent = String(m?.total ?? 0);
    if (!m) {
      const why = s.loadError ? 'Fix the module and it will run.' : (s.callError ?? 'Choose a function to call.');
      status.replaceChildren(h('span', { class: 'badge badge-off' }, 'Not running'), ' ', why);
      for (const el of [stack, frames, blocks, output]) el.replaceChildren();
      globals.replaceChildren();
      errorBox.hidden = true;
      return;
    }
    const atEnd = m.step >= m.total;
    const badge = !atEnd
      ? h('span', { class: 'badge badge-run' }, 'Running')
      : m.finalStatus === 'finished'
        ? h('span', { class: 'badge badge-done' }, 'Finished')
        : h('span', { class: 'badge badge-err' }, m.finalStatus === 'trap' ? 'Trapped' : 'Stopped');
    const next = m.at
      ? [
          h('span', null, ' · next: ', h('button', { type: 'button', class: 'status-instr linkish', title: 'Select this instruction' }, `${instrText(s, m.at.func, m.at.pc)} (${funcName(s, m.at.func)} ${String(m.at.pc).padStart(2, '0')})`)),
        ]
      : [];
    const result = atEnd && m.finalStatus === 'finished' ? [' · result: ', ...(m.results.length ? m.results.flatMap((v, i) => [i ? ', ' : '', valueEl(v)]) : ['none'])] : [];
    status.replaceChildren(badge, ` Step ${m.step} of ${m.total}`, ...next, ...result);
    errorBox.hidden = !(atEnd && m.trap);
    if (atEnd && m.trap) errorBox.replaceChildren(h('strong', null, m.finalStatus === 'trap' ? 'Trap: ' : 'Stopped: '), m.trap);

    // Stack, top first. Each value belongs to the frame whose base it sits above.
    const bases = new Set(m.frames.map((f) => f.stackBase));
    stack.replaceChildren(
      ...(m.stack.length === 0
        ? [h('li', { class: 'empty' }, 'empty')]
        : m.stack
            .map((v, i) => {
              let owner = '';
              for (const f of m.frames) if (i >= f.stackBase) owner = f.name;
              return h(
                'li',
                { class: `slot${bases.has(i) ? ' slot-frame' : ''}${i === m.stack.length - 1 ? ' slot-top' : ''}` },
                h('span', { class: 'slot-i', 'aria-hidden': 'true' }, String(i)),
                valueEl(v),
                h('span', { class: 'slot-label' }, owner),
              );
            })
            .reverse()),
    );

    frames.replaceChildren(
      ...(m.frames.length === 0
        ? [h('li', { class: 'empty' }, m.finalStatus === 'finished' && atEnd ? 'returned' : 'no frames')]
        : m.frames.map((f, i) =>
            h(
              'li',
              { class: `frame${i === m.frames.length - 1 ? ' frame-top' : ''}` },
              h('div', { class: 'frame-name' }, f.name, h('span', { class: 'frame-meta' }, ` pc ${String(f.pc).padStart(2, '0')} · base ${f.stackBase}`)),
              f.locals.length === 0
                ? h('div', { class: 'muted small' }, 'no locals')
                : h('dl', { class: 'locals' }, ...f.locals.flatMap((l) => [h('dt', null, l.name, l.role === 'param' ? h('span', { class: 'role' }, ' param') : null), h('dd', null, valueEl(l.v))])),
            ),
          )),
    );

    // The innermost function's open blocks, innermost first: their depth is what `br` counts.
    const top = m.frames.length - 1;
    const open = m.labels.filter((l) => l.frame === top).reverse();
    blocks.replaceChildren(
      ...(open.length === 0
        ? [h('li', { class: 'empty' }, top < 0 ? 'none open' : `none open in ${m.frames[top]!.name}`)]
        : open.map((l, depth) =>
            h(
              'li',
              { class: 'block-row' },
              h('span', { class: 'block-depth' }, `br ${depth}`),
              ' ',
              h('span', { class: 'block-kind' }, l.kind),
              ` from pc ${String(l.start).padStart(2, '0')} · ${l.kind === 'loop' ? 'jumps back to its start' : `exits${l.arity ? ' with 1 value' : ''}`}`,
            ),
          )),
    );

    globals.replaceChildren(
      m.globals.length === 0
        ? h('p', { class: 'muted small' }, 'none')
        : h('dl', { class: 'globals' }, ...m.globals.flatMap((g, i) => [h('dt', null, `${i}${g.mutable ? ' (mut)' : ''}`), h('dd', null, valueEl(g.v))])),
    );
    output.replaceChildren(...(m.output.length === 0 ? [h('li', { class: 'muted small' }, 'nothing printed yet')] : m.output.map((o) => h('li', { class: 'out-text' }, o))));
  };

  store.subscribe((s, prev) => {
    if (s.machine !== prev.machine || s.playing !== prev.playing || s.loadError !== prev.loadError || s.callError !== prev.callError) render(s);
    else if (s.selected !== prev.selected || s.trace !== prev.trace) stepper.renderTicks(view(s));
  });
  render(store.state);
}

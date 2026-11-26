import { h, resetRoving, revealInPanel, roving } from '@glass/ui/dom';
import { encodeBytes } from '@glass/ui/share';
import type { Ins } from '../lang/wasm/encode';
import { compileToWasm, runWithHostEngine, type WasmOutput } from '../lang/wasm';
import { FALSE, FN, NIL, STR, TRUE } from '../lang/wasm/runtime';
import { formatValue } from '../lang';
import { NodeHighlighter } from './highlight';
import type { State, Store } from './store';

/** "i64.const 4611686018427387904" → "number 2", and the other boxed values. */
export function describeConst(bits: bigint, strings: (ptr: number) => string | undefined): string {
  const tag = bits >> 48n;
  if (bits === NIL) return 'nil';
  if (bits === TRUE) return 'true';
  if (bits === FALSE) return 'false';
  if (tag === STR >> 48n) return JSON.stringify(strings(Number(bits & 0xffffffffn)) ?? '?');
  if (tag === FN >> 48n) return `function, ${Number((bits >> 32n) & 0xffn)} param${((bits >> 32n) & 0xffn) === 1n ? '' : 's'}`;
  const dv = new DataView(new ArrayBuffer(8));
  dv.setBigUint64(0, BigInt.asUintN(64, bits));
  return `number ${formatValue(dv.getFloat64(0))}`;
}

/** One instruction as text-format, with a comment decoding boxed constants. */
export function insText(ins: Ins, strings: (ptr: number) => string | undefined): { text: string; note: string } {
  // i64 constants as signed decimal, as the text format (and Glass Wasm) shows them.
  const imm = (ins.imm ?? []).map((x) => (ins.op === 'i64.const' ? BigInt.asIntN(64, BigInt(x)).toString() : String(x))).join(' ');
  const text = imm ? `${ins.op} ${imm}` : ins.op;
  const note = ins.op === 'i64.const' ? describeConst(BigInt(ins.imm![0]!), strings) : '';
  return { text, note };
}

type Check = { kind: 'same' | 'different' | 'skipped' | 'pending'; detail: string };

/** Stage 5: the same program compiled to a real WebAssembly module. */
export function mountWasm(body: HTMLElement, meta: HTMLElement, actions: HTMLElement, store: Store) {
  const hl = new NodeHighlighter();
  const list = h('div', { class: 'wasm-funcs', role: 'group', 'aria-label': 'WebAssembly instructions. Use arrow keys to move.' });
  const runtime = h('details', { class: 'wasm-runtime' });
  const open = h('a', { class: 'btn btn-small btn-primary', href: 'wasm/', 'data-testid': 'open-in-glass-wasm' }, 'Open in Glass Wasm');
  const check = h('p', { class: 'wasm-check small', role: 'status' });
  actions.append(open, check);
  body.append(list, runtime);
  roving(list, '.winstr');
  let checkRun = 0;

  list.addEventListener('click', (e) => {
    const row = (e.target as Element).closest<HTMLElement>('.winstr');
    if (row?.dataset.node) store.select(Number(row.dataset.node), 'wasm');
  });

  const showCheck = (c: Check) => {
    check.className = `wasm-check small is-${c.kind}`;
    check.textContent = c.detail;
  };

  /** Runs the module on this browser's own WebAssembly and compares with the VM. */
  const verify = async (s: State, out: WasmOutput) => {
    const run = ++checkRun;
    const trace = s.build.trace;
    if (!trace || trace.status === 'step-limit') {
      showCheck({ kind: 'skipped', detail: "Not run here: the program didn't finish in the VM's step limit." });
      return;
    }
    showCheck({ kind: 'pending', detail: "Running it on this browser's WebAssembly…" });
    try {
      const r = await runWithHostEngine(out.bytes, out.memoryPages);
      if (run !== checkRun) return;
      const vmOut = trace.output.map((l) => l.text);
      const vmErr = trace.error?.message ?? null;
      const same = r.error === vmErr && r.output.length === vmOut.length && r.output.every((x, i) => x === vmOut[i]);
      showCheck(
        same
          ? { kind: 'same', detail: `Ran on this browser's own WebAssembly engine: same ${vmErr ? 'output and error' : 'output'} as the VM.` }
          : { kind: 'different', detail: `This browser's WebAssembly printed something different from the VM: ${JSON.stringify(r.output.slice(0, 3))}${r.error ? `, then "${r.error}"` : ''}.` },
      );
    } catch (e) {
      if (run === checkRun) showCheck({ kind: 'different', detail: `This browser couldn't run the module: ${(e as Error).message}` });
    }
  };

  const render = () => {
    const s = store.state;
    hl.reset();
    if (s.build.diagnostics.length > 0) {
      list.replaceChildren(h('p', { class: 'empty' }, 'Fix the errors in the source and the WebAssembly appears here.'));
      runtime.replaceChildren();
      meta.textContent = 'no module';
      open.setAttribute('aria-disabled', 'true');
      open.removeAttribute('href');
      showCheck({ kind: 'skipped', detail: '' });
      return;
    }
    let out: WasmOutput;
    try {
      out = compileToWasm(s.build.program, s.build.source);
    } catch (e) {
      list.replaceChildren(h('p', { class: 'note' }, `This program can't be compiled to WebAssembly: ${(e as Error).message}`));
      runtime.replaceChildren();
      meta.textContent = 'no module';
      open.setAttribute('aria-disabled', 'true');
      open.removeAttribute('href');
      showCheck({ kind: 'skipped', detail: '' });
      return;
    }
    const strings = (ptr: number) => out.strings.get(ptr);
    const pane = out.functions.filter((f) => f.kind === 'pane');
    const rt = out.functions.filter((f) => f.kind === 'runtime');
    let n = 0;
    list.replaceChildren(
      ...pane.map((f) => {
        let depth = 0;
        const section = h(
          'section',
          { class: 'chunk', 'aria-label': `WebAssembly function $${f.name}` },
          h('h3', { class: 'chunk-title' }, h('span', { class: 'pixel-label' }, 'func'), ` $${f.name}`, h('span', { class: 'wasm-sig' }, f.params.length ? ` (param ${f.params.map((p) => `$${p}`).join(' ')} i64)` : '', f.name === pane[0]!.name ? '' : ' (result i64)')),
        );
        f.body.forEach((ins, pc) => {
          if (ins.op === 'end' || ins.op === 'else') depth = Math.max(0, depth - 1);
          const { text, note } = insText(ins, strings);
          const row = h(
            'button',
            { type: 'button', class: `winstr d${Math.min(depth, 6)}`, 'data-node': ins.node ?? '', tabindex: '-1' },
            h('span', { class: 'addr' }, String(pc).padStart(2, '0')),
            ' ',
            h('span', { class: 'wop' }, text),
            note ? h('span', { class: 'wnote' }, ` ;; ${note}`) : null,
          );
          if (ins.node !== undefined) hl.add(ins.node, row);
          section.append(row);
          n++;
          if (ins.op === 'block' || ins.op === 'loop' || ins.op === 'if' || ins.op === 'else') depth++;
        });
        return section;
      }),
    );
    runtime.replaceChildren(
      h('summary', null, `Runtime library: ${rt.length} functions compiled into every module`),
      h(
        'p',
        { class: 'small muted' },
        "Pane's values (numbers, strings, booleans, nil, functions) and their rules live in these functions, written in WebAssembly too. Step into them in Glass Wasm.",
      ),
      h('p', { class: 'wasm-rt-names' }, rt.map((f) => `$${f.name}`).join('  ')),
    );
    meta.textContent = `${out.bytes.length.toLocaleString('en-GB')} bytes · ${n} instructions · back end`;
    open.removeAttribute('aria-disabled');
    open.setAttribute('href', `wasm/#wasm=${encodeBytes(out.bytes)}`);
    resetRoving(list, '.winstr');
    void verify(s, out);
  };

  store.subscribe((s, prev) => {
    if (s.build !== prev.build) render();
    if (s.build !== prev.build || s.selected !== prev.selected) {
      const first = hl.sync(s);
      if (s.selected !== prev.selected && s.origin !== 'wasm') revealInPanel(first);
    }
  });
  render();
  hl.sync(store.state);
}

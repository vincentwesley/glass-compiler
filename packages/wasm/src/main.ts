import '@glass/ui/fonts';
import '@glass/ui/styles/tokens.css';
import '@glass/ui/styles/base.css';
import '@glass/ui/styles/components.css';
import '@glass/ui/styles/panel.css';
import './wasm.css';
import '@glass/ui/styles/debugger.css';
import '@glass/ui/styles/credits.css';
import '@glass/ui/brand/logo.css';
import '@glass/ui/brand/logo-resize';
import '@glass/ui/credits';

import wasmUrl from '../generated/glass_wasm.wasm?url';
import { byId, h } from '@glass/ui/dom';
import { decodeBytes, encodeBytes, encodeSource, fragmentUrl, sourceFromFragment } from '@glass/ui/share';
import type { StepperChange } from '@glass/ui/stepper';
import { mountThemeToggle } from '@glass/ui/theme';
import { mountTour } from '@glass/ui/tour';
import { EXAMPLES } from './examples';
import { mountCode } from './ui/code-panel';
import { mountLineage } from './ui/lineage';
import { mountMachine } from './ui/machine-panel';
import { mountMemory } from './ui/memory-panel';
import { mountSpec } from './ui/spec-panel';
import { createStore, parseKey } from './ui/state';
import { GlassWasm, stepsFor, type ModuleInfo } from './vm';

const DRAFT_KEY = 'glass-wasm-draft';
const TOUR_KEY = 'glass-wasm-tour-done';
const OWN = 'own';
const COMPILED = 'compiled';

/** The series' compilers, by the language a module's glass.source names. */
const COMPILERS: Record<string, { language: string; compiler: string; href: string }> = {
  pane: { language: 'Pane', compiler: 'Glass Compiler', href: '../' },
  c: { language: 'C', compiler: 'Small C', href: '../small-c/' },
};

function loadDraft(): string | null {
  try {
    return window.localStorage.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
}
function saveDraft(text: string) {
  try {
    window.localStorage.setItem(DRAFT_KEY, text);
  } catch {
    // Storage blocked: drafts just aren't remembered.
  }
}

async function start() {
  document.documentElement.classList.add('js');
  mountThemeToggle(byId<HTMLButtonElement>('theme-toggle'));

  const sourceEl = byId<HTMLTextAreaElement>('source');
  const errorEl = byId('source-error');
  const statusEl = byId('source-status');
  const exportSel = byId<HTMLSelectElement>('run-export');
  const argsEl = byId('run-args');
  const select = byId<HTMLSelectElement>('examples');
  const blurb = byId('example-blurb');

  let vm: GlassWasm;
  try {
    vm = await GlassWasm.fromBytes(await (await fetch(wasmUrl)).arrayBuffer());
  } catch (e) {
    statusEl.textContent = 'The virtual machine could not start';
    errorEl.hidden = false;
    errorEl.textContent = `This browser could not load the WebAssembly machine (${(e as Error).message}).`;
    return;
  }

  /** A module shared in the address bar (#wat=…), which is then tidied away. */
  const takeShared = () => {
    const shared = sourceFromFragment(window.location.hash, 'wat');
    if (shared !== null) {
      window.history.replaceState(null, '', window.location.href.split('#')[0]);
      saveDraft(shared);
    }
    return shared;
  };
  /**
   * A compiled module (#wasm=…), e.g. from Glass Compiler's "Open in Glass Wasm".
   * The fragment stays in the address bar, so reloading keeps the module.
   */
  const takeCompiled = () => (window.location.hash.startsWith('#wasm=') ? decodeBytes(window.location.hash.slice(6)) : null);
  const shared = takeShared();
  const draft = loadDraft();
  const initial = shared ?? draft ?? EXAMPLES[0]!.source;

  const store = createStore({
    source: initial,
    info: null,
    loadError: null,
    call: null,
    callError: null,
    machine: null,
    trace: new Uint32Array(),
    step: 0,
    playing: false,
    follow: true,
    selected: null,
    origin: null,
  });

  // If the VM itself crashes it is restarted empty: load the module into it again.
  let seenCrashes = 0;
  const recoverFromCrash = () => {
    if (vm.crashes === seenCrashes) return;
    seenCrashes = vm.crashes;
    vm.load(compiled ?? store.state.source);
  };

  /** Moves the machine to a step (re-running the call deterministically from the start). */
  const goto = (change: StepperChange) => {
    const s = store.state;
    if (!s.call) return;
    const step = change.step ?? s.step;
    const r = vm.run(s.call.name, s.call.args, step);
    if (!r.ok) {
      recoverFromCrash();
      store.set({ machine: null, callError: r.error, playing: false });
      return;
    }
    store.set({ step: r.value.step, machine: r.value, playing: change.playing ?? s.playing });
  };

  const selectInstr = (k: string | null, origin: 'code' | 'machine' | 'lineage' | 'tour' = 'code') => {
    const s = store.state;
    store.set({ selected: k, origin });
    if (k && s.follow && origin === 'code') {
      const { func, pc } = parseKey(k);
      const steps = stepsFor(s.trace, func, pc);
      const next = steps.find((x) => x >= s.step) ?? steps[0];
      if (next !== undefined && next !== s.step) goto({ step: next, playing: false });
    }
  };

  /** Starts the chosen call from step 0. */
  const runCall = () => {
    const name = exportSel.value;
    const args = [...argsEl.querySelectorAll<HTMLInputElement>('input')].map((i) => i.value);
    if (!name) {
      store.set({ call: null, machine: null, callError: 'This module exports no functions to call.', trace: new Uint32Array() });
      return;
    }
    const r = vm.run(name, args, 0);
    if (!r.ok) {
      recoverFromCrash();
      store.set({ call: { name, args }, machine: null, callError: r.error, trace: new Uint32Array(), step: 0, playing: false });
      return;
    }
    store.set({ call: { name, args }, callError: null, machine: r.value, trace: vm.trace(), step: 0, playing: false, selected: null });
  };

  const renderRunBar = (info: ModuleInfo | null, preferred?: { export: string; args: string[] }) => {
    const funcs = info?.exports.filter((e) => e.kind === 'func') ?? [];
    const previous = exportSel.value;
    exportSel.replaceChildren(...funcs.map((e) => h('option', { value: e.name }, `"${e.name}"`)));
    const pick = funcs.find((e) => e.name === preferred?.export) ?? funcs.find((e) => e.name === previous) ?? funcs[0];
    if (pick) exportSel.value = pick.name;
    const renderArgs = () => {
      const e = funcs.find((x) => x.name === exportSel.value);
      argsEl.replaceChildren(
        ...(e?.params ?? []).map((t, i) =>
          h('label', { class: 'field arg-field' }, h('span', { class: 'pixel-label' }, `${t} arg ${i + 1}`), h('input', { type: 'text', class: 'arg', value: preferred && preferred.export === e?.name ? (preferred.args[i] ?? '0') : '0', spellcheck: 'false', inputmode: t.startsWith('i') ? 'numeric' : 'decimal' })),
        ),
      );
    };
    exportSel.onchange = renderArgs;
    renderArgs();
    byId<HTMLButtonElement>('run').disabled = funcs.length === 0;
  };

  // A binary module being debugged (compiled from Pane or C), or null when the textarea's text is.
  let compiled: Uint8Array | null = null;
  const paneView = byId('pane-view');
  const paneSource = byId('pane-source');
  const paneEdit = byId<HTMLAnchorElement>('pane-edit');
  const textMode = [sourceEl, byId('source-label')];

  const setCompiledMode = (on: boolean) => {
    paneView.hidden = !on;
    for (const el of textMode) el.hidden = on;
  };

  const loadCompiled = (bytes: Uint8Array) => {
    const r = vm.load(bytes);
    if (!r.ok) {
      compiled = null;
      setCompiledMode(false);
      errorEl.hidden = false;
      errorEl.textContent = `The linked module could not be loaded: ${r.error}`;
      return;
    }
    compiled = bytes;
    const src = r.value.source;
    setCompiledMode(true);
    paneSource.textContent = src?.text ?? '(no source in this module)';
    // Each compiler in the series links back to its own page.
    const from = src ? COMPILERS[src.language] : undefined;
    byId('pane-label').textContent = from ? `${from.language} source` : 'Source';
    paneEdit.hidden = !from;
    if (from && src) {
      paneEdit.href = `${from.href}#code=${encodeSource(src.text)}`;
      paneEdit.textContent = `Edit it in ${from.compiler}`;
    }
    select.value = COMPILED;
    blurb.textContent = from
      ? `Compiled from ${from.language} by ${from.compiler}. The code panel shows the WebAssembly; select an instruction to see the ${from.language} it came from.`
      : 'A binary module.';
    errorEl.hidden = true;
    statusEl.textContent = 'Valid · instantiated';
    statusEl.classList.remove('is-bad');
    store.set({ source: src?.text ?? '', info: r.value, loadError: null, selected: null });
    // A C program starts at _start (which calls main, then exit).
    const entry = r.value.exports.some((e) => e.name === '_start') ? '_start' : 'main';
    renderRunBar(r.value, { export: entry, args: [] });
    runCall();
  };

  const leaveCompiled = () => {
    compiled = null;
    setCompiledMode(false);
    if (window.location.hash.startsWith('#wasm=')) window.history.replaceState(null, '', window.location.href.split('#')[0]);
  };

  const loadModule = (source: string, preferred?: { export: string; args: string[] }) => {
    leaveCompiled();
    const r = vm.load(source);
    if (!r.ok) {
      store.set({ source, info: null, loadError: r.error, machine: null, call: null, trace: new Uint32Array(), selected: null });
      errorEl.hidden = false;
      errorEl.textContent = r.error;
      statusEl.textContent = 'Not valid';
      statusEl.classList.add('is-bad');
      renderRunBar(null);
      return;
    }
    errorEl.hidden = true;
    statusEl.textContent = 'Valid · instantiated';
    statusEl.classList.remove('is-bad');
    store.set({ source, info: r.value, loadError: null, selected: null });
    renderRunBar(r.value, preferred);
    runCall();
  };

  // Examples menu, with "Your module" for anything edited or shared.
  const exampleFor = (src: string) => EXAMPLES.find((e) => e.source === src);
  select.replaceChildren(
    ...EXAMPLES.map((e) => h('option', { value: e.id }, e.title)),
    h('option', { value: OWN }, 'Your module'),
    h('option', { value: COMPILED, disabled: true }, 'A compiled program'),
  );
  const describe = (src: string) => {
    const ex = exampleFor(src);
    select.value = ex ? ex.id : OWN;
    blurb.textContent = ex ? ex.blurb : 'Your own module. Edit freely: it is saved in this browser only.';
  };
  select.addEventListener('change', () => {
    if (select.value === OWN) {
      const own = loadDraft() ?? EXAMPLES[0]!.source;
      sourceEl.value = own;
      describe(own);
      loadModule(own);
      return;
    }
    const ex = EXAMPLES.find((e) => e.id === select.value);
    if (!ex) return;
    sourceEl.value = ex.source;
    saveDraft(ex.source);
    describe(ex.source);
    loadModule(ex.source, ex.run);
  });

  let pending: number | undefined;
  sourceEl.addEventListener('input', () => {
    window.clearTimeout(pending);
    pending = window.setTimeout(() => {
      saveDraft(sourceEl.value);
      describe(sourceEl.value);
      loadModule(sourceEl.value);
    }, 250);
  });

  byId<HTMLFormElement>('run-bar').addEventListener('submit', (e) => {
    e.preventDefault();
    runCall();
  });

  byId('pane-leave').addEventListener('click', () => {
    const own = loadDraft() ?? EXAMPLES[0]!.source;
    sourceEl.value = own;
    describe(own);
    loadModule(own);
    sourceEl.focus();
  });

  byId('share').addEventListener('click', async () => {
    const url = compiled ? `${window.location.href.split('#')[0]}#wasm=${encodeBytes(compiled)}` : fragmentUrl(window.location.href, 'wat', sourceEl.value);
    const field = byId<HTMLInputElement>('share-url');
    const status = byId('share-status');
    try {
      await navigator.clipboard.writeText(url);
      status.textContent = 'Link copied. It carries your module after the #, so nothing is uploaded.';
      field.hidden = true;
    } catch {
      field.hidden = false;
      field.value = url;
      field.select();
      status.textContent = 'Copy the link below.';
    }
  });

  // Values and constants read as Pane when the module came from Pane.
  const paneValues = () => {
    const info = store.state.info;
    return info?.source?.language === 'pane' ? { table: info.table, read: (o: number, l: number) => vm.memory(o, l) } : null;
  };
  mountCode(byId('code-body'), byId('code-count'), byId('code-help'), store, (k) => selectInstr(k, 'code'), paneValues);
  mountMachine(byId('machine-body'), byId('machine-count'), store, goto, (k) => selectInstr(k, 'machine'), paneValues);
  mountMemory(byId('memory-body'), byId('memory-meta'), store, vm);
  mountLineage(byId('lineage'), store, (k) => selectInstr(k, 'lineage'), (step) => goto({ step, playing: false }));
  mountSpec(vm);

  // A share link pasted into this tab while it is open.
  window.addEventListener('hashchange', () => {
    const bytes = takeCompiled();
    if (bytes) {
      loadCompiled(bytes);
      return;
    }
    const next = takeShared();
    if (next === null) return;
    sourceEl.value = next;
    describe(next);
    loadModule(next);
  });

  sourceEl.value = initial;
  describe(initial);
  const linked = takeCompiled();
  if (linked) loadCompiled(linked);
  else loadModule(initial, exampleFor(initial)?.run);

  const firstInstr = () => {
    const f = store.state.info?.funcs[0];
    return f ? `${f.index}:0` : null;
  };
  mountTour({
    startButton: byId<HTMLButtonElement>('tour-start'),
    doneKey: TOUR_KEY,
    steps: [
      { target: 'panel-source', title: 'A WebAssembly module', text: 'This is WebAssembly in its text format. Pick an example or write your own; it is parsed, validated and instantiated as you type.' },
      { target: 'panel-code', title: '1 · Code', text: 'Each function as the machine sees it: one instruction per row, indented inside blocks and loops. Peach marks the instruction that runs next.' },
      { target: 'panel-machine', title: '2 · Machine', text: 'Step forwards and backwards, or press Play. Watch values move on the stack, frames come and go, and locals change.' },
      { target: 'panel-memory', title: '3 · Memory', text: 'Linear memory, byte by byte. The last load is lavender, the last store is peach.' },
      {
        target: 'panel-code',
        title: 'Everything is linked',
        text: 'Selecting an instruction marks every step that runs it on the timeline, and the bar at the bottom shows the line of the module it came from.',
        before: () => selectInstr(firstInstr(), 'tour'),
      },
      { target: 'panel-spec', title: '4 · Graded for real', text: 'The same machine runs the official WebAssembly testsuite. The recorded results are here, and one button runs every file again in your browser.' },
    ],
  });
}

void start();

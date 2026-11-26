import '@glass/ui/fonts';
import '@glass/ui/styles/tokens.css';
import '@glass/ui/styles/base.css';
import '@glass/ui/styles/components.css';
import '@glass/ui/styles/panel.css';
import '@glass/ui/styles/debugger.css';
import '../styles/panels.css';
import '@glass/ui/styles/credits.css';
import '@glass/ui/brand/logo.css';
import '@glass/ui/brand/logo-resize';
import '@glass/ui/credits';

import { byId, h } from '@glass/ui/dom';
import { fragmentUrl, sourceFromFragment } from '@glass/ui/share';
import { mountThemeToggle } from '@glass/ui/theme';
import { mountTour } from '@glass/ui/tour';
import { compile } from '../lang/compile';
import { EXAMPLES } from '../examples';
import { createEditor } from './editor';
import { buildLinks } from './links';
import { mountRun } from './run-panel';
import { Store } from './store';
import { mountTestsuite } from './testsuite-panel';
import { mountTokens } from './tokens-panel';
import { TOUR_DONE_KEY, TOUR_STEPS } from './tour-steps';
import { mountTree } from './tree-panel';
import { mountWasm } from './wasm-panel';

const DRAFT_KEY = 'glass-small-c-draft';
const DEBOUNCE_MS = 200;

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

function takeShared(): string | null {
  const shared = sourceFromFragment(window.location.hash, 'code');
  if (shared !== null) window.history.replaceState(null, '', window.location.href.split('#')[0]);
  return shared;
}

function start() {
  document.documentElement.classList.add('js');
  const draft = loadDraft();
  const shared = takeShared();
  let backup: string | null = shared !== null && draft !== null && draft !== shared ? draft : null;
  const initial = shared ?? draft ?? EXAMPLES[0]!.source;
  if (shared !== null) saveDraft(shared);
  const first = compile(initial);
  const store = new Store({ build: first, links: buildLinks(first), selected: null, origin: null, run: null });

  const rebuild = (source: string) => {
    const b = compile(source);
    store.set({ build: b, links: buildLinks(b), selected: null, origin: null });
  };

  let pending: number | undefined;
  const editor = createEditor(
    byId('editor'),
    initial,
    (doc) => {
      window.clearTimeout(pending);
      pending = window.setTimeout(() => {
        rebuild(doc);
        saveDraft(doc);
        markEdited(doc);
      }, DEBOUNCE_MS);
    },
    store,
  );
  const loadProgram = (source: string) => {
    editor.setDoc(source);
    window.clearTimeout(pending);
    rebuild(source);
    saveDraft(source);
  };

  // Problems under the editor.
  const diagList = byId('diagnostics');
  const renderDiagnostics = () => {
    const b = store.state.build;
    diagList.replaceChildren(
      ...b.diagnostics.map((d) =>
        h(
          'li',
          null,
          h(
            'button',
            { type: 'button', class: 'diag', onclick: () => editor.focusAt(d.start) },
            h('span', { class: 'pixel-label diag-stage' }, d.file ? d.file : 'error'),
            h('span', { class: 'diag-pos' }, `line ${d.line}`),
            h('span', { class: 'diag-msg' }, d.message),
          ),
        ),
      ),
    );
    diagList.hidden = b.diagnostics.length === 0;
    const status = byId('source-status');
    status.textContent = b.diagnostics.length ? 'Does not compile' : `Compiles cleanly${b.includes.length ? ` · ${b.includes.map((x) => `<${x}>`).join(' ')}` : ''}`;
    status.classList.toggle('is-bad', b.diagnostics.length > 0);
  };
  store.subscribe((s, prev) => {
    if (s.build !== prev.build) renderDiagnostics();
  });
  renderDiagnostics();

  // Examples menu.
  const select = byId<HTMLSelectElement>('examples');
  const blurb = byId('example-blurb');
  const ownOption = h('option', { value: '' }, 'Your code');
  for (const ex of EXAMPLES) select.append(h('option', { value: ex.id }, ex.title));
  const showOwn = (text: string, restore = false) => {
    if (!ownOption.isConnected) select.prepend(ownOption);
    select.value = '';
    blurb.replaceChildren(text);
    if (restore && backup !== null) {
      const saved = backup;
      blurb.append(
        ' ',
        h('button', { type: 'button', class: 'linkish', onclick: () => ((backup = null), loadProgram(saved), showOwn('Your own program, restored.')) }, 'Restore my previous code'),
      );
    }
  };
  const showExample = (id: string) => {
    const ex = EXAMPLES.find((e) => e.id === id)!;
    ownOption.remove();
    select.value = ex.id;
    blurb.replaceChildren(ex.blurb);
  };
  const describeProgram = (source: string, isShared: boolean) => {
    const matching = EXAMPLES.find((e) => e.source === source);
    if (matching) showExample(matching.id);
    else if (isShared) showOwn('A program someone shared with you.', true);
    else showOwn('Your own program, restored from last time.');
  };
  function markEdited(doc: string) {
    const current = EXAMPLES.find((e) => e.id === select.value);
    if (current && current.source !== doc) showOwn('Your own program.');
  }
  describeProgram(initial, shared !== null);
  select.addEventListener('change', () => {
    const ex = EXAMPLES.find((e) => e.id === select.value);
    if (!ex) return;
    loadProgram(ex.source);
    showExample(ex.id);
  });
  window.addEventListener('hashchange', () => {
    const incoming = takeShared();
    if (incoming === null) return;
    const current = editor.getDoc();
    if (current !== incoming) backup = current;
    loadProgram(incoming);
    describeProgram(incoming, true);
  });

  // Share link: the program travels in the URL fragment, never to a server.
  const shareStatus = byId('share-status');
  const shareField = byId<HTMLInputElement>('share-url');
  byId('share').addEventListener('click', async () => {
    const url = fragmentUrl(window.location.href, 'code', editor.getDoc());
    shareField.value = url;
    try {
      await navigator.clipboard.writeText(url);
      shareField.hidden = true;
      shareStatus.textContent = 'Link copied.';
    } catch {
      shareField.hidden = false;
      shareField.select();
      shareStatus.textContent = 'Copy the link below.';
    }
  });

  mountTokens(byId('tokens-body'), byId('tokens-count'), store);
  mountTree(byId('tree-body'), byId('tree-count'), store);
  mountWasm(byId('wasm-body'), byId('wasm-meta'), byId('wasm-actions'), store);
  mountRun(byId('run-body'), byId('run-meta'), store);
  mountTestsuite(byId('grade-body'));
  mountThemeToggle(byId<HTMLButtonElement>('theme-toggle'));
  mountTour({ steps: TOUR_STEPS, startButton: byId<HTMLButtonElement>('tour-start'), doneKey: TOUR_DONE_KEY });

  Object.defineProperty(window, '__glass', { value: { get state() { return store.state; } } });
}

start();

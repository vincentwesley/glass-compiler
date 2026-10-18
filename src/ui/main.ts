import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/silkscreen/400.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/components.css';
import '../styles/panels.css';

import { build, lineCol } from '../lang';
import { EXAMPLES } from '../examples';
import { byId, h } from './dom';
import { createEditor } from './editor';
import { mountBytecode } from './bytecode-panel';
import { mountLineage } from './lineage';
import { buildLinks } from './links';
import { Store } from './store';
import { shareUrl, sourceFromHash } from './share';
import { mountThemeToggle } from './theme';
import { mountTokens } from './tokens-panel';
import { mountTour } from './tour';
import { mountTree } from './tree-panel';
import { mountVm } from './vm-panel';

const DRAFT_KEY = 'glass-draft';
const DEBOUNCE_MS = 160;

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

function start() {
  document.documentElement.classList.add('js');
  const shared = sourceFromHash(window.location.hash);
  if (shared !== null) {
    // Keep the shared program as the draft and tidy the address bar.
    saveDraft(shared);
    window.history.replaceState(null, '', window.location.href.split('#')[0]);
  }
  const initial = shared ?? loadDraft() ?? EXAMPLES[0]!.source;
  const first = build(initial);
  const store = new Store({ build: first, links: buildLinks(first), selected: null, origin: null, step: 0, playing: false, follow: true });

  const rebuild = (source: string) => {
    const b = build(source);
    store.set({ build: b, links: buildLinks(b), selected: null, origin: null, step: 0, playing: false });
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
      }, DEBOUNCE_MS);
    },
    store,
  );

  // Diagnostics under the editor.
  const diagList = byId('diagnostics');
  const renderDiagnostics = () => {
    const { build: b } = store.state;
    const items = b.diagnostics.map((d) => {
      const { line, col } = lineCol(b.source, d.span.start);
      return h(
        'li',
        null,
        h(
          'button',
          { type: 'button', class: 'diag', onclick: () => editor.focusAt(d.span.start) },
          h('span', { class: 'pixel-label diag-stage' }, d.stage),
          h('span', { class: 'diag-pos' }, `${line}:${col}`),
          h('span', { class: 'diag-msg' }, d.message),
        ),
      );
    });
    diagList.replaceChildren(...items);
    diagList.hidden = items.length === 0;
    byId('source-status').textContent =
      b.diagnostics.length === 0 ? 'Compiles cleanly' : `${b.diagnostics.length} problem${b.diagnostics.length === 1 ? '' : 's'}`;
    byId('source-status').classList.toggle('is-bad', b.diagnostics.length > 0);
  };
  store.subscribe((s, prev) => {
    if (s.build !== prev.build) renderDiagnostics();
  });
  renderDiagnostics();

  // Examples menu.
  const select = byId<HTMLSelectElement>('examples');
  for (const ex of EXAMPLES) select.append(h('option', { value: ex.id }, ex.title));
  const blurb = byId('example-blurb');
  const matching = EXAMPLES.find((e) => e.source === initial);
  if (matching) {
    select.value = matching.id;
    blurb.textContent = matching.blurb;
  } else {
    select.prepend(h('option', { value: '' }, 'Your code'));
    select.value = '';
    blurb.textContent = shared !== null ? 'A program someone shared with you.' : 'Your own program, restored from last time.';
  }
  select.addEventListener('change', () => {
    const ex = EXAMPLES.find((e) => e.id === select.value);
    if (!ex) return;
    blurb.textContent = ex.blurb;
    window.clearTimeout(pending);
    editor.setDoc(ex.source);
    window.clearTimeout(pending);
    rebuild(ex.source);
    saveDraft(ex.source);
  });

  // Share link: the program travels in the URL fragment, never to a server.
  const shareStatus = byId('share-status');
  const shareField = byId<HTMLInputElement>('share-url');
  byId('share').addEventListener('click', async () => {
    const url = shareUrl(window.location.href, editor.getDoc());
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
  mountTree(byId('tree-body'), byId('tree-count'), byId('tree-tools'), store);
  mountBytecode(byId('bytecode-body'), byId('bytecode-count'), byId('bytecode-help'), store);
  mountVm(byId('vm-body'), byId('vm-count'), store);
  mountLineage(byId('lineage'), store);
  mountThemeToggle(byId<HTMLButtonElement>('theme-toggle'));
  mountTour(store, byId<HTMLButtonElement>('tour-start'));

  // Exposed read-only for end-to-end tests and curious people in devtools.
  Object.defineProperty(window, '__glass', { value: { get state() { return store.state; } } });
}

start();

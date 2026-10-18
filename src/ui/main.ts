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
const MAX_LISTED_DIAGNOSTICS = 30;

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

/** Read a shared program from the address bar, then tidy the address bar. */
function takeSharedFromHash(): string | null {
  const shared = sourceFromHash(window.location.hash);
  if (shared !== null) window.history.replaceState(null, '', window.location.href.split('#')[0]);
  return shared;
}

function start() {
  document.documentElement.classList.add('js');
  const draft = loadDraft();
  const shared = takeSharedFromHash();
  // Opening a share link must not lose the visitor's own work: keep it aside.
  let backup: string | null = shared !== null && draft !== null && draft !== shared ? draft : null;
  const initial = shared ?? draft ?? EXAMPLES[0]!.source;
  if (shared !== null) saveDraft(shared);
  const first = build(initial);
  const store = new Store({ build: first, links: buildLinks(first), selected: null, origin: null, step: 0, playing: false, follow: true });

  const select = byId<HTMLSelectElement>('examples');
  const blurb = byId('example-blurb');

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
        markEdited(doc);
      }, DEBOUNCE_MS);
    },
    store,
  );

  /** Replace the whole program (example, share link or restore) in one undoable step. */
  const loadProgram = (source: string) => {
    editor.setDoc(source);
    window.clearTimeout(pending);
    rebuild(source);
    saveDraft(source);
  };

  // Diagnostics under the editor.
  const diagList = byId('diagnostics');
  const renderDiagnostics = () => {
    const { build: b } = store.state;
    // Identical messages (often one mistake echoed many times) collapse into one line.
    const groups = new Map<string, { d: (typeof b.diagnostics)[number]; count: number }>();
    for (const d of b.diagnostics) {
      const key = `${d.stage}\u0000${d.message}`;
      const g = groups.get(key);
      if (g) g.count++;
      else groups.set(key, { d, count: 1 });
    }
    const grouped = [...groups.values()];
    const items = grouped.slice(0, MAX_LISTED_DIAGNOSTICS).map(({ d, count }) => {
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
          count > 1 ? h('span', { class: 'diag-count' }, `×${count}`) : null,
        ),
      );
    });
    const hiddenCount = grouped.length - items.length;
    if (hiddenCount > 0) items.push(h('li', { class: 'diag-more small muted' }, `…and ${hiddenCount} more. Fix the first ones and the rest often disappear.`));
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

  // Examples menu, with a "Your code" entry whenever the editor holds anything else.
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
        h('button', {
          type: 'button',
          class: 'linkish',
          onclick: () => {
            backup = null;
            loadProgram(saved);
            showOwn('Your own program, restored.');
          },
        }, 'Restore my previous code'),
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
    if (!EXAMPLES.some((e) => e.id === select.value)) return;
    const id = select.value;
    loadProgram(EXAMPLES.find((e) => e.id === id)!.source);
    showExample(id);
  });

  // A share link pasted into an already-open tab only changes the fragment.
  window.addEventListener('hashchange', () => {
    const incoming = takeSharedFromHash();
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

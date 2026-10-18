import { EditorState, RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type DecorationSet,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { tokenCategory, type Span } from '../lang';
import type { Store } from './store';

const setTokenMarks = StateEffect.define<DecorationSet>();
const setLinkMarks = StateEffect.define<DecorationSet>();

const field = (effect: typeof setTokenMarks) =>
  StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, tr) {
      for (const e of tr.effects) if (e.is(effect)) return e.value;
      return value.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
  });

const tokenField = field(setTokenMarks);
const linkField = field(setLinkMarks);

/*
 * All editor styling lives here rather than in the page CSS: the editor is
 * mounted in a shadow root so CodeMirror's injected styles go through
 * constructable stylesheets, which the page's strict CSP (style-src 'self')
 * allows. CSS custom properties and @font-face still come from the page.
 */
const theme = EditorView.theme(
  {
    '&': { height: '100%', color: 'var(--ink)', backgroundColor: 'transparent', fontSize: '14px' },
    '&.cm-focused': { outline: '2px solid var(--peach)', outlineOffset: '-2px' },
    '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
    '.cm-content': { caretColor: 'var(--accent)', padding: '6px 0' },
    '.cm-gutters': { backgroundColor: 'var(--surface)', borderRight: '1px solid var(--line)', color: 'var(--ink-faint)' },
    '.cm-activeLine': { backgroundColor: 'rgba(127, 127, 127, 0.07)' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--surface-2)', color: 'var(--ink)' },
    '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--accent)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'rgba(169, 150, 224, 0.35)',
    },
    '.tok-keyword': { color: 'var(--c-keyword)', fontWeight: '700' },
    '.tok-literal': { color: 'var(--c-literal)' },
    '.tok-string': { color: 'var(--c-string)' },
    '.tok-name': { color: 'var(--c-name)' },
    '.tok-operator': { color: 'var(--c-operator)', fontWeight: '700' },
    '.tok-punct': { color: 'var(--c-punct)' },
    '.cm-sel-span': { backgroundColor: 'var(--lav-soft)' },
    '.cm-sel-token': { backgroundColor: 'var(--accent-soft)', outline: '1px solid var(--accent)' },
    '.cm-exec': { borderBottom: '3px solid var(--peach)' },
    '.cm-diag': { textDecoration: 'wavy underline var(--bad)', textDecorationSkipInk: 'none', textUnderlineOffset: '3px' },
  },
  { dark: true },
);

export interface EditorHandle {
  view: EditorView;
  setDoc(text: string): void;
  getDoc(): string;
  focusAt(offset: number): void;
}

/**
 * The source editor. Highlighting comes from Pane's own lexer (the same tokens
 * shown in the Tokens panel), plus marks for the current selection, the
 * executing instruction and errors.
 */
export function createEditor(parent: HTMLElement, initial: string, onChange: (doc: string) => void, store: Store): EditorHandle {
  let suppressCursor = false;

  const extensions: Extension[] = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    history(),
    drawSelection(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    tokenField,
    linkField,
    theme,
    EditorState.tabSize.of(2),
    EditorView.contentAttributes.of({ 'aria-label': 'Pane source code', tabindex: '0', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) onChange(u.state.doc.toString());
      else if (u.selectionSet && !suppressCursor && u.transactions.some((t) => t.isUserEvent('select'))) {
        // Moving the cursor onto a token selects the node that owns it.
        // Deferred: CodeMirror doesn't allow dispatching during an update.
        const head = u.state.selection.main.head;
        queueMicrotask(() => {
          const s = store.state;
          const tok = s.links.tokenAt(head);
          const owner = tok ? s.build.tokenOwner[tok.index] : undefined;
          store.select(owner !== undefined && owner >= 0 ? owner : null, 'editor');
        });
      }
    }),
  ];

  const shadow = parent.attachShadow({ mode: 'open' });
  const mount = document.createElement('div');
  mount.style.height = '100%';
  shadow.append(mount);
  const view = new EditorView({ parent: mount, root: shadow, state: EditorState.create({ doc: initial, extensions }) });

  const clamp = (span: Span) => {
    const len = view.state.doc.length;
    return { from: Math.min(span.start, len), to: Math.min(span.end, len) };
  };

  const paintTokens = () => {
    const s = store.state;
    const b = new RangeSetBuilder<Decoration>();
    for (const t of s.build.tokens) {
      if (t.kind === 'EOF' || t.span.start === t.span.end) continue;
      const { from, to } = clamp(t.span);
      if (from < to) b.add(from, to, Decoration.mark({ class: `tok tok-${tokenCategory(t.kind)}` }));
    }
    view.dispatch({ effects: setTokenMarks.of(b.finish()) });
  };

  const paintLinks = () => {
    const s = store.state;
    const marks: { from: number; to: number; deco: Decoration }[] = [];
    const add = (span: Span, cls: string) => {
      const { from, to } = clamp(span);
      if (from < to) marks.push({ from, to, deco: Decoration.mark({ class: cls }) });
      else if (from === to && from === view.state.doc.length && from > 0) {
        marks.push({ from: from - 1, to: from, deco: Decoration.mark({ class: cls }) });
      }
    };
    for (const d of s.build.diagnostics) add(d.span, 'cm-diag');
    const err = s.build.trace?.error;
    if (err) add(err.span, 'cm-diag');
    if (s.selected !== null) {
      const node = s.build.nodes.get(s.selected);
      if (node) add(node.span, 'cm-sel-span');
      for (const ti of s.links.tokensByNode.get(s.selected) ?? []) add(s.build.tokens[ti]!.span, 'cm-sel-token');
    }
    const exec = s.links.instrAtStep(s.step);
    if (exec) add(exec.instr.span, 'cm-exec');
    marks.sort((a, b) => a.from - b.from || a.to - b.to);
    const b = new RangeSetBuilder<Decoration>();
    for (const m of marks) b.add(m.from, m.to, m.deco);
    view.dispatch({ effects: setLinkMarks.of(b.finish()) });
  };

  store.subscribe((s, prev) => {
    if (s.build !== prev.build) paintTokens();
    if (s.build !== prev.build || s.selected !== prev.selected || s.step !== prev.step) paintLinks();
    if (s.selected !== prev.selected && s.selected !== null && s.origin !== 'editor') {
      const node = s.build.nodes.get(s.selected);
      if (node) view.dispatch({ effects: EditorView.scrollIntoView(clamp(node.span).from, { y: 'nearest' }) });
    }
  });

  paintTokens();
  paintLinks();

  return {
    view,
    setDoc(text) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: 0 } });
    },
    getDoc: () => view.state.doc.toString(),
    focusAt(offset) {
      suppressCursor = true;
      view.dispatch({ selection: { anchor: Math.min(offset, view.state.doc.length) }, scrollIntoView: true });
      suppressCursor = false;
      view.focus();
    },
  };
}

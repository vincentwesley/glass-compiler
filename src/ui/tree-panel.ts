import { OPERATOR_TABLE } from '../lang';
import { h, resetRoving, revealInPanel, roving } from './dom';
import { NodeHighlighter } from './highlight';
import type { Store } from './store';
import { BOX_HEIGHT, layoutTree } from './tree-layout';

const ZOOMS = [0.6, 0.8, 1, 1.25];
/** Roles worth labelling on edges; left/right of an operator are obvious from position. */
const SHOWN_ROLES = new Set(['cond', 'then', 'else', 'body', 'init', 'value', 'callee']);

/** Stage 2: the syntax tree, laid out as SVG. */
export function mountTree(body: HTMLElement, count: HTMLElement, tools: HTMLElement, store: Store) {
  const hl = new NodeHighlighter();
  let zoom = 2;
  let userZoomed = false;
  let size = { width: 0, height: 0 };

  const svg = h('svg', { class: 'tree-svg', role: 'group', 'aria-label': 'Syntax tree. Use arrow keys to move between nodes.' }) as unknown as SVGSVGElement;
  body.append(svg);
  roving(svg, '.tnode');

  const applyZoom = () => {
    const z = ZOOMS[zoom]!;
    svg.setAttribute('width', String(Math.round(size.width * z)));
    svg.setAttribute('height', String(Math.round(size.height * z)));
    zoomOut.disabled = zoom === 0;
    zoomIn.disabled = zoom === ZOOMS.length - 1;
    zoomLabel.textContent = `${Math.round(z * 100)}%`;
  };
  const zoomOut = h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': 'Zoom out', onclick: () => { userZoomed = true; zoom = Math.max(0, zoom - 1); applyZoom(); } }, '−');
  const zoomLabel = h('span', { class: 'zoom-label', 'aria-live': 'polite' }, '100%');
  const zoomIn = h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': 'Zoom in', onclick: () => { userZoomed = true; zoom = Math.min(ZOOMS.length - 1, zoom + 1); applyZoom(); } }, '+');

  const table = h(
    'details',
    { class: 'bp-table' },
    h('summary', null, 'Binding powers'),
    h(
      'div',
      { class: 'bp-body' },
      h('p', null, 'The Pratt parser keeps going while the next operator\'s left power is at least the current minimum. Higher numbers bind tighter.'),
      h(
        'table',
        null,
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Operators'), h('th', { scope: 'col' }, 'Left'), h('th', { scope: 'col' }, 'Right'), h('th', { scope: 'col' }, 'Kind'))),
        h(
          'tbody',
          null,
          ...OPERATOR_TABLE.map((o) =>
            h(
              'tr',
              null,
              h('td', null, h('code', null, o.ops.join('  '))),
              h('td', null, o.left ? String(o.left) : '–'),
              h('td', null, o.right ? String(o.right) : '–'),
              h('td', null, `${o.name}, ${o.assoc}`),
            ),
          ),
        ),
      ),
    ),
  );
  tools.append(h('div', { class: 'zoom' }, zoomOut, zoomLabel, zoomIn));
  body.before(table);

  svg.addEventListener('click', (e) => {
    const g = (e.target as Element).closest<SVGGElement>('.tnode');
    if (g) store.select(Number(g.dataset.node), 'tree');
  });
  svg.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const g = (e.target as Element).closest<SVGGElement>('.tnode');
    if (!g) return;
    e.preventDefault();
    store.select(Number(g.dataset.node), 'tree');
  });

  const render = () => {
    const { build } = store.state;
    hl.reset();
    const layout = layoutTree(build.program);
    size = { width: layout.width, height: layout.height };
    svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
    const edges = h('g', { class: 'tedges', 'aria-hidden': 'true' });
    const nodes = h('g', { class: 'tnodes' });
    for (const n of layout.nodes) {
      if (n.parent) {
        const x1 = n.parent.x;
        const y1 = n.parent.y + BOX_HEIGHT;
        const x2 = n.x;
        const y2 = n.y;
        const my = (y1 + y2) / 2;
        const edge = h('path', { class: 'tedge', d: `M${x1} ${y1} V${my} H${x2} V${y2}` });
        edges.append(edge);
        hl.add(n.node.id, edge);
        if (n.role && SHOWN_ROLES.has(n.role)) {
          edges.append(h('text', { class: 'trole', x: x2 + 4, y: y2 - 5 }, n.role));
        }
      }
      const label = n.detail ? `${n.kind} ${n.detail}` : n.kind;
      const g = h(
        'g',
        {
          class: `tnode tnode-${n.node.type}`,
          'data-node': n.node.id,
          transform: `translate(${n.x - n.width / 2} ${n.y})`,
          tabindex: '-1',
          role: 'button',
        },
        h('rect', { class: 'tbox', width: n.width, height: BOX_HEIGHT }),
        h('title', null, n.role ? `${label} (${n.role})` : label),
        h('text', { class: n.detail ? 'tkind' : 'tkind tkind-solo', x: n.width / 2, y: n.detail ? 15 : 25 }, n.kind),
        ' ',
        n.detail ? h('text', { class: 'tdetail', x: n.width / 2, y: 31 }, n.detail.length > 28 ? `${n.detail.slice(0, 27)}…` : n.detail) : null,
      );
      nodes.append(g);
      hl.add(n.node.id, g);
    }
    svg.replaceChildren(edges, nodes);
    count.textContent = String(layout.nodes.length);
    if (!userZoomed) {
      // Pick the largest zoom (up to 100%) that fits the panel's width.
      const available = body.clientWidth - 4;
      zoom = 0;
      for (let i = ZOOMS.indexOf(1); i >= 0; i--) {
        if (available <= 0 || layout.width * ZOOMS[i]! <= available) {
          zoom = i;
          break;
        }
      }
    }
    applyZoom();
    // Start with the root in view when the tree is wider than the panel.
    body.scrollLeft = Math.max(0, (body.scrollWidth - body.clientWidth) / 2);
    resetRoving(svg, '.tnode');
  };

  store.subscribe((s, prev) => {
    if (s.build !== prev.build) render();
    if (s.build !== prev.build || s.selected !== prev.selected || s.step !== prev.step) {
      const first = hl.apply(s);
      if (s.selected !== prev.selected && s.origin !== 'tree') revealInPanel(first);
    }
  });
  render();
  hl.apply(store.state);
}

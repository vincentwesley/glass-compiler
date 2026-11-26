import { h } from '@glass/ui/dom';
import type { GlassWasm } from '../vm';
import type { State, WasmStore } from './state';

const ROW = 16;
const ROWS = 16;
const WINDOW = ROW * ROWS;

const hex = (n: number, width: number) => n.toString(16).padStart(width, '0');

/** Where a window should start so `addr` sits a few rows from the top. */
export function windowStart(addr: number, size: number): number {
  const row = Math.floor(addr / ROW) * ROW;
  const start = Math.max(0, row - ROW * 4);
  return Math.max(0, Math.min(start, Math.max(0, size - WINDOW)));
}

/** Stage 3: linear memory as bytes, following the last load or store. */
export function mountMemory(body: HTMLElement, meta: HTMLElement, store: WasmStore, vm: GlassWasm) {
  let start = 0;
  let size = 0;
  const addr = h('input', { type: 'text', class: 'mem-addr', inputmode: 'text', spellcheck: 'false', 'aria-label': 'Go to address (hex or decimal)', value: '0x0000' });
  const followAccess = h('input', { type: 'checkbox', id: 'mem-follow', checked: true });
  const prev = h('button', { type: 'button', class: 'btn btn-small', onclick: () => move(-WINDOW) }, '◀ Earlier');
  const next = h('button', { type: 'button', class: 'btn btn-small', onclick: () => move(WINDOW) }, 'Later ▶');
  const grid = h('div', { class: 'mem-grid', 'aria-label': 'Memory bytes, 16 per row' });
  const note = h('p', { class: 'mem-note small', 'aria-live': 'polite' });
  const controls = h(
    'form',
    { class: 'mem-controls' },
    h('label', { class: 'field mem-field' }, h('span', { class: 'pixel-label' }, 'Address'), addr),
    prev,
    next,
    h('label', { class: 'check', for: 'mem-follow' }, followAccess, h('span', null, 'Follow loads and stores')),
  );
  controls.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = addr.value.trim();
    const n = /^0x[0-9a-f]+$/i.test(v) ? parseInt(v, 16) : /^\d+$/.test(v) ? parseInt(v, 10) : NaN;
    if (Number.isNaN(n)) {
      note.textContent = `"${v}" is not an address. Use hex like 0x10 or a number.`;
      return;
    }
    followAccess.checked = false;
    start = windowStart(n, size);
    render(store.state);
  });
  const empty = h('p', { class: 'empty' }, 'This module has no linear memory.');
  body.append(controls, grid, note, empty);

  function move(delta: number) {
    followAccess.checked = false;
    start = Math.max(0, Math.min(start + delta, Math.max(0, size - WINDOW)));
    render(store.state);
  }

  function render(s: State) {
    const mem = s.machine?.memory ?? null;
    const has = !!mem;
    controls.hidden = !has;
    grid.hidden = !has;
    empty.hidden = has;
    if (!mem) {
      meta.textContent = 'no memory';
      note.textContent = '';
      return;
    }
    size = mem.bytes;
    meta.textContent = `${mem.pages} page${mem.pages === 1 ? '' : 's'} · ${mem.bytes.toLocaleString('en-GB')} bytes`;
    const last = mem.last;
    if (followAccess.checked && last) start = windowStart(last.addr, size);
    start = Math.min(start, Math.max(0, size - WINDOW));
    addr.value = `0x${hex(start, 4)}`;
    prev.disabled = start === 0;
    next.disabled = start + WINDOW >= size;
    const bytes = vm.memory(start, WINDOW);
    const touched = (a: number) => !!last && a >= last.addr && a < last.addr + last.len;
    const rows: Element[] = [];
    for (let r = 0; r < bytes.length; r += ROW) {
      const cells: Element[] = [];
      let ascii = '';
      for (let c = 0; c < ROW; c++) {
        const a = start + r + c;
        const b = bytes[r + c];
        if (b === undefined) break;
        const cls = touched(a) ? (last!.write ? ' mem-write' : ' mem-read') : b === 0 ? ' mem-zero' : '';
        cells.push(h('span', { class: `mem-byte${cls}`, title: `0x${hex(a, 4)}: ${b}` }, hex(b, 2)));
        ascii += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '·';
      }
      rows.push(
        h('div', { class: 'mem-row' }, h('span', { class: 'mem-off' }, hex(start + r, 4)), h('span', { class: 'mem-bytes' }, ...cells), h('span', { class: 'mem-ascii' }, ascii)),
      );
    }
    grid.replaceChildren(...rows);
    note.textContent = last
      ? `Last step ${last.write ? 'wrote' : 'read'} ${last.len} byte${last.len === 1 ? '' : 's'} at 0x${hex(last.addr, 4)}${last.addr + last.len > size ? ' (out of bounds)' : ''}.`
      : 'The last step did not touch memory.';
  }

  store.subscribe((s, p) => {
    if (s.machine !== p.machine) render(s);
  });
  render(store.state);
}

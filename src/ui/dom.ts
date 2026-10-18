type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'g', 'rect', 'path', 'text', 'line', 'title', 'tspan']);

/** Tiny element builder: h('button', { class: 'btn', onclick: fn }, 'Label'). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K];
export function h(tag: string, attrs?: Attrs | null, ...children: Child[]): Element;
export function h(tag: string, attrs?: Attrs | null, ...children: Child[]): Element {
  const el = SVG_TAGS.has(tag) ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2), value);
      } else {
        el.setAttribute(key, value === true ? '' : String(value));
      }
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'number' ? String(c) : c);
  }
  return el;
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Scroll an element into view inside its scroll container without moving the whole page. */
export function revealInPanel(el: Element | null | undefined) {
  if (!el) return;
  const container = el.closest('.scroll');
  if (!container) return;
  const c = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';
  let top = container.scrollTop;
  let left = container.scrollLeft;
  if (r.top < c.top + 8) top += r.top - c.top - 24;
  else if (r.bottom > c.bottom - 8) top += r.bottom - c.bottom + 24;
  if (r.left < c.left + 8) left += r.left - c.left - 24;
  else if (r.right > c.right - 8) left += r.right - c.right + 24;
  if (top !== container.scrollTop || left !== container.scrollLeft) container.scrollTo({ top, left, behavior });
}

/**
 * Roving tabindex: the container is one tab stop; arrow keys, Home and End move
 * between items. Enter / Space are handled by the items themselves (buttons).
 */
export function roving(container: HTMLElement | SVGElement, selector: string) {
  container.addEventListener('keydown', (e) => {
    const ev = e as KeyboardEvent;
    const items = [...container.querySelectorAll<HTMLElement>(selector)];
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next: number;
    switch (ev.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = Math.min(items.length - 1, current + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = Math.max(0, current - 1);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      default:
        return;
    }
    ev.preventDefault();
    focusItem(items, next);
  });
  container.addEventListener('focusin', (e) => {
    const target = (e.target as Element).closest(selector);
    if (!target) return;
    for (const item of container.querySelectorAll(selector)) item.setAttribute('tabindex', item === target ? '0' : '-1');
  });
}

export function focusItem(items: Element[], index: number) {
  const item = items[index] as HTMLElement | undefined;
  if (!item) return;
  for (const other of items) other.setAttribute('tabindex', other === item ? '0' : '-1');
  item.focus();
}

/** Make the first item of a roving group tabbable (call after re-rendering). */
export function resetRoving(container: Element, selector: string) {
  const items = container.querySelectorAll(selector);
  items.forEach((item, i) => item.setAttribute('tabindex', i === 0 ? '0' : '-1'));
}

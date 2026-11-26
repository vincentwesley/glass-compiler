import { byId, h, prefersReducedMotion } from './dom';

export interface TourStep {
  /** id of the element the step points at */
  target: string;
  title: string;
  text: string;
  /** Runs before the step is shown (e.g. to select something to talk about). */
  before?: () => void;
}

export interface TourOptions {
  steps: TourStep[];
  /** The header button that (re)starts the tour; focus returns here on close. */
  startButton: HTMLButtonElement;
  /** localStorage key remembering that the tour was seen. */
  doneKey: string;
}

/**
 * A non-modal guided tour: one card at a time, pointing at a page region.
 * Shows itself on the first visit; Esc or "Skip tour" closes it.
 */
export function mountTour({ steps: STEPS, startButton, doneKey: DONE_KEY }: TourOptions) {
  let index = 0;
  let card: HTMLElement | null = null;
  let lastTarget: HTMLElement | null = null;

  const close = () => {
    lastTarget?.classList.remove('tour-target');
    card?.remove();
    card = null;
    try {
      window.localStorage.setItem(DONE_KEY, '1');
    } catch {
      // Storage blocked: the tour will offer itself again next time.
    }
    startButton.focus();
  };

  const show = () => {
    const step = STEPS[index]!;
    step.before?.();
    lastTarget?.classList.remove('tour-target');
    const target = byId(step.target);
    target.classList.add('tour-target');
    lastTarget = target;
    target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' });

    const titleId = 'tour-title';
    const isLast = index === STEPS.length - 1;
    const next = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => (isLast ? close() : go(index + 1)) }, isLast ? 'Done' : 'Next');
    const content = h(
      'div',
      { class: 'tour-inner' },
      h('p', { class: 'pixel-label tour-count' }, `Tour ${index + 1} / ${STEPS.length}`),
      h('h2', { id: titleId, class: 'tour-title' }, step.title),
      h('p', { class: 'tour-text' }, step.text),
      h(
        'div',
        { class: 'tour-actions' },
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: close }, 'Skip tour'),
        index > 0 ? h('button', { type: 'button', class: 'btn', onclick: () => go(index - 1) }, 'Back') : null,
        next,
      ),
    );
    if (!card) {
      card = h('div', { class: 'tour card', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': titleId, tabindex: '-1', 'data-testid': 'tour' });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
      });
      document.body.append(card);
    }
    card.replaceChildren(content);
    next.focus({ preventScroll: true });
  };

  const go = (i: number) => {
    index = i;
    show();
  };

  startButton.addEventListener('click', () => go(0));

  let done: boolean;
  try {
    done = window.localStorage.getItem(DONE_KEY) === '1';
  } catch {
    done = true;
  }
  if (!done) go(0);
}

import { h } from './dom';

/** What the stepper shows. `marks` are steps to tick on the timeline (e.g. when the selection ran). */
export interface StepperView {
  step: number;
  last: number;
  playing: boolean;
  /** False when there is nothing to step through (e.g. the program didn't build). */
  enabled: boolean;
  marks: readonly number[];
}

export interface StepperChange {
  step?: number;
  playing?: boolean;
}

export interface StepperOptions {
  /** Called for every user action and every playback tick; apply the patch and call render(). */
  onChange: (change: StepperChange) => void;
  /** Accessible name of the toolbar, e.g. "Virtual machine controls". */
  label: string;
  /** Accessible name of the scrubber, e.g. "VM step". */
  scrubLabel: string;
  /** Prefix for data-testid attributes (`<prefix>-step`, `-back`, `-play`, `-scrub`). */
  testId: string;
  /** Extra controls appended to the toolbar (a "follow selection" checkbox, say). */
  extra?: Node[];
}

export const SPEEDS: Readonly<Record<string, number>> = { slow: 700, normal: 260, fast: 60 };

/** What the next state is for each control, given the current view. Pure, so it is unit-tested. */
export const stepperActions = {
  reset: (): StepperChange => ({ step: 0, playing: false }),
  back: (v: StepperView): StepperChange => ({ step: Math.max(0, v.step - 1), playing: false }),
  forward: (v: StepperView): StepperChange => ({ step: Math.min(v.last, v.step + 1), playing: false }),
  end: (v: StepperView): StepperChange => ({ step: v.last, playing: false }),
  /** Play restarts from the beginning when already at the end. */
  togglePlay: (v: StepperView): StepperChange | null =>
    !v.enabled ? null : v.playing ? { playing: false } : { playing: true, step: v.step >= v.last ? 0 : v.step },
  tick: (v: StepperView): StepperChange => (v.step >= v.last ? { playing: false } : { step: v.step + 1 }),
  scrub: (value: number): StepperChange => ({ step: value, playing: false }),
};

/** SVG path for timeline ticks on a 0..1000 wide viewBox. */
export function tickPath(steps: readonly number[], last: number): string {
  const x = (step: number) => (last === 0 ? 0 : (step / last) * 1000);
  return steps.map((st) => `M${x(st).toFixed(1)} 0V10`).join('');
}

/**
 * Step controls (⏮ ◀ ▶ Play ⏭ + speed) and a timeline scrubber with tick marks.
 * Shared by every Glass debugger. The caller owns the state; the stepper owns
 * the playback timer and calls onChange.
 */
export function createStepper(opts: StepperOptions) {
  let view: StepperView = { step: 0, last: 0, playing: false, enabled: false, marks: [] };
  let timer: number | undefined;
  let wasPlaying = false;

  const act = (change: StepperChange | null) => {
    if (change) opts.onChange(change);
  };
  const btn = (label: string, icon: string, onclick: () => void, extra: Record<string, string> = {}) =>
    h('button', { type: 'button', class: 'btn btn-step', 'aria-label': label, title: label, onclick, ...extra }, h('span', { 'aria-hidden': 'true' }, icon));

  const reset = btn('Back to the start', '⏮', () => act(stepperActions.reset()));
  const back = btn('Step back', '◀', () => act(stepperActions.back(view)), { 'data-testid': `${opts.testId}-back` });
  const fwd = btn('Step forward', '▶', () => act(stepperActions.forward(view)), { 'data-testid': `${opts.testId}-step` });
  const play = h('button', { type: 'button', class: 'btn btn-play', 'aria-pressed': 'false', 'data-testid': `${opts.testId}-play`, onclick: () => act(stepperActions.togglePlay(view)) }, 'Play');
  const end = btn('Jump to the end', '⏭', () => act(stepperActions.end(view)));
  const speed = h(
    'select',
    { class: 'select', 'aria-label': 'Playback speed' },
    h('option', { value: 'slow' }, 'Slow'),
    h('option', { value: 'normal', selected: true }, 'Normal'),
    h('option', { value: 'fast' }, 'Fast'),
  );
  speed.addEventListener('change', () => {
    if (view.playing) startTimer();
  });

  const scrub = h('input', { type: 'range', class: 'scrub', min: '0', max: '0', value: '0', 'aria-label': opts.scrubLabel, 'data-testid': `${opts.testId}-scrub` });
  scrub.addEventListener('input', () => act(stepperActions.scrub(Number(scrub.value))));
  const ticks = h('svg', { class: 'ticks', 'aria-hidden': 'true', preserveAspectRatio: 'none', viewBox: '0 0 1000 10' });
  const tickSel = h('path', { class: 'tick-sel', d: '' });
  const tickPos = h('path', { class: 'tick-pos', d: '' });
  ticks.append(tickSel, tickPos);

  const toolbar = h('div', { class: 'vm-controls', role: 'toolbar', 'aria-label': opts.label }, reset, back, fwd, play, end, speed, ...(opts.extra ?? []));
  const timeline = h('div', { class: 'timeline' }, ticks, scrub);

  function startTimer() {
    window.clearInterval(timer);
    timer = window.setInterval(() => act(stepperActions.tick(view)), SPEEDS[speed.value] ?? 260);
  }

  function render(next: StepperView) {
    view = next;
    if (view.playing !== wasPlaying) {
      wasPlaying = view.playing;
      if (view.playing) startTimer();
      else window.clearInterval(timer);
    }
    scrub.max = String(view.last);
    scrub.value = String(view.step);
    const disabled = !view.enabled;
    for (const b of [reset, back, fwd, play, end]) b.disabled = disabled;
    scrub.disabled = disabled;
    back.disabled = disabled || view.step === 0;
    reset.disabled = back.disabled;
    fwd.disabled = disabled || view.step >= view.last;
    end.disabled = fwd.disabled;
    play.textContent = view.playing ? 'Pause' : 'Play';
    play.setAttribute('aria-pressed', String(view.playing));
    renderTicks(view);
  }

  function renderTicks(next: StepperView) {
    view = next;
    tickSel.setAttribute('d', tickPath(view.marks, view.last));
    tickPos.setAttribute('d', tickPath([view.step], view.last));
  }

  return { toolbar, timeline, render, renderTicks };
}

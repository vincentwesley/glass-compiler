import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Store } from '../src/store';
import { Highlighter } from '../src/highlight';
import { stepperActions, tickPath, type StepperView } from '../src/stepper';
import { PARTIALS, injectPartials } from '../vite/glass-pages';

describe('Store', () => {
  it('merges patches and tells listeners the new and previous state', () => {
    const s = new Store({ a: 1, b: 'x' });
    const seen: [number, number][] = [];
    s.subscribe((now, prev) => seen.push([now.a, prev.a]));
    s.set({ a: 2 });
    expect(s.state).toEqual({ a: 2, b: 'x' });
    expect(seen).toEqual([[2, 1]]);
  });

  it('stops calling a listener after it unsubscribes', () => {
    const s = new Store({ n: 0 });
    let calls = 0;
    const off = s.subscribe(() => calls++);
    s.set({ n: 1 });
    off();
    s.set({ n: 2 });
    expect(calls).toBe(1);
  });
});

/** Just enough of an Element for the highlighter: a class list. */
const fakeEl = () => {
  const classes = new Set<string>();
  return {
    classes,
    classList: { add: (...c: string[]) => c.forEach((x) => classes.add(x)), remove: (...c: string[]) => c.forEach((x) => classes.delete(x)) },
  } as unknown as Element & { classes: Set<string> };
};

describe('Highlighter', () => {
  it('marks selected, related and exec elements and returns the first selected one', () => {
    const hl = new Highlighter<number>();
    const [a1, a2, b, c] = [fakeEl(), fakeEl(), fakeEl(), fakeEl()];
    hl.add(1, a1);
    hl.add(1, a2);
    hl.add(2, b);
    hl.add(3, c);
    const first = hl.apply({ selected: 1, related: [1, 2], exec: [3] });
    expect(first).toBe(a1);
    expect([...(a1 as never as { classes: Set<string> }).classes]).toEqual(['is-selected']);
    expect([...(b as never as { classes: Set<string> }).classes]).toEqual(['is-related']);
    expect([...(c as never as { classes: Set<string> }).classes]).toEqual(['is-exec']);
  });

  it('clears the previous classes on the next apply', () => {
    const hl = new Highlighter<string>();
    const el = fakeEl();
    hl.add('pc', el);
    hl.apply({ selected: 'pc' });
    hl.apply({ selected: null });
    expect((el as never as { classes: Set<string> }).classes.size).toBe(0);
  });
});

describe('Stepper actions', () => {
  const v = (over: Partial<StepperView> = {}): StepperView => ({ step: 3, last: 5, playing: false, enabled: true, marks: [], ...over });

  it('moves and clamps, and every manual move pauses playback', () => {
    expect(stepperActions.back(v({ step: 0 }))).toEqual({ step: 0, playing: false });
    expect(stepperActions.forward(v({ step: 5 }))).toEqual({ step: 5, playing: false });
    expect(stepperActions.forward(v())).toEqual({ step: 4, playing: false });
    expect(stepperActions.end(v())).toEqual({ step: 5, playing: false });
    expect(stepperActions.reset()).toEqual({ step: 0, playing: false });
    expect(stepperActions.scrub(2)).toEqual({ step: 2, playing: false });
  });

  it('plays from the start when at the end, pauses when playing, and does nothing when disabled', () => {
    expect(stepperActions.togglePlay(v({ step: 5 }))).toEqual({ playing: true, step: 0 });
    expect(stepperActions.togglePlay(v())).toEqual({ playing: true, step: 3 });
    expect(stepperActions.togglePlay(v({ playing: true }))).toEqual({ playing: false });
    expect(stepperActions.togglePlay(v({ enabled: false }))).toBeNull();
  });

  it('ticks forward and stops at the end', () => {
    expect(stepperActions.tick(v())).toEqual({ step: 4 });
    expect(stepperActions.tick(v({ step: 5 }))).toEqual({ playing: false });
  });

  it('draws tick marks across a 1000-wide timeline', () => {
    expect(tickPath([0, 5, 10], 10)).toBe('M0.0 0V10M500.0 0V10M1000.0 0V10');
    expect(tickPath([0], 0)).toBe('M0.0 0V10');
  });
});

describe('Glass page partials', () => {
  const read = (name: string) => readFileSync(PARTIALS[name]!, 'utf8');

  it('injects the credits card with the project name, the sign-off and the logo credit', () => {
    const html = injectPartials('<footer><!-- glass:credits project="Glass Wasm" --></footer>', read);
    expect(html).toContain('Glass Wasm was designed and built by Vin.');
    expect(html).toContain("Copyright 2026 Vin's Atelier.");
    expect(html).toContain('Designed and built by Vin.');
    expect(html).toContain('@portus_workstation');
    expect(html).toContain('@wason25_pz');
    expect(html).not.toMatch(/glass:|\{\{/);
    // The card's static logo is replaced by the draggable sign-off (house UPGRADING step 6).
    expect(html.match(/class="brand-logo"/g)).toHaveLength(1);
  });

  it('escapes attribute values and rejects unknown markers or missing values', () => {
    expect(injectPartials('<!-- glass:credits project="A <b>" -->', read)).toContain('A &lt;b&gt; was designed');
    expect(() => injectPartials('<!-- glass:nope -->', read)).toThrow(/Unknown Glass partial/);
    expect(() => injectPartials('<!-- glass:credits -->', read)).toThrow(/needs project=/);
  });

  it('keeps the compiler mark and sign-off free of inline styles and scripts', () => {
    for (const name of Object.keys(PARTIALS)) {
      expect(read(name), name).not.toMatch(/\sstyle="|<script/);
    }
  });
});

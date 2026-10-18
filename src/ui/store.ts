import type { Build } from '../lang';
import type { Links } from './links';

export type Origin = 'editor' | 'tokens' | 'tree' | 'bytecode' | 'vm' | 'lineage' | 'tour';

export interface State {
  build: Build;
  links: Links;
  /** The selected syntax-tree node, or null. */
  selected: number | null;
  /** Which panel made the selection (that panel doesn't scroll itself). */
  origin: Origin | null;
  /** Index into build.trace.snapshots. */
  step: number;
  playing: boolean;
  /** When on, selecting something moves the VM to the next step that runs it. */
  follow: boolean;
}

type Listener = (state: State, prev: State) => void;

export class Store {
  private listeners: Listener[] = [];
  constructor(private current: State) {}

  get state(): State {
    return this.current;
  }

  set(patch: Partial<State>) {
    const prev = this.current;
    this.current = { ...prev, ...patch };
    for (const l of this.listeners) l(this.current, prev);
  }

  subscribe(listener: Listener) {
    this.listeners.push(listener);
  }

  /** Select a node; optionally move the VM to the next step that executes it. */
  select(nodeId: number | null, origin: Origin) {
    const s = this.current;
    const patch: Partial<State> = { selected: nodeId, origin };
    if (nodeId !== null && s.follow && origin !== 'vm' && origin !== 'editor') {
      const steps = s.links.stepsForNode(nodeId);
      if (steps.length > 0) {
        const next = steps.find((x) => x >= s.step) ?? steps[0]!;
        patch.step = next;
        patch.playing = false;
      }
    }
    this.set(patch);
  }

  lastStep(): number {
    return Math.max(0, (this.current.build.trace?.snapshots.length ?? 1) - 1);
  }

  setStep(step: number) {
    this.set({ step: Math.max(0, Math.min(this.lastStep(), step)) });
  }
}

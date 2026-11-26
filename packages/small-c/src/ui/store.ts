import { Store as BaseStore } from '@glass/ui/store';
import type { Build } from '../lang/compile';
import type { Links } from './links';

export type Origin = 'editor' | 'tokens' | 'tree' | 'wasm' | 'tour';

export interface RunState {
  status: 'running' | 'done' | 'stopped' | 'error';
  output: string;
  exitCode: number | null;
  trap: string | null;
  ms: number;
}

export interface State {
  build: Build;
  links: Links;
  /** The selected syntax-tree node, or null. */
  selected: number | null;
  origin: Origin | null;
  run: RunState | null;
}

export class Store extends BaseStore<State> {
  select(nodeId: number | null, origin: Origin) {
    this.set({ selected: nodeId, origin });
  }
}

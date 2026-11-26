import { Store } from '@glass/ui/store';
import type { MachineState, ModuleInfo } from '../vm';

export type Origin = 'code' | 'machine' | 'lineage' | 'tour' | null;

export interface State {
  source: string;
  info: ModuleInfo | null;
  loadError: string | null;
  /** The export being debugged and its arguments. */
  call: { name: string; args: string[] } | null;
  callError: string | null;
  /** The machine after `step` steps of the call. */
  machine: MachineState | null;
  /** (function index, pc) per step of the whole run. */
  trace: Uint32Array;
  step: number;
  playing: boolean;
  /** Selecting an instruction jumps to the next step that runs it. */
  follow: boolean;
  /** The selected instruction, as "func:pc". */
  selected: string | null;
  origin: Origin;
}

export const key = (func: number, pc: number) => `${func}:${pc}`;
export const parseKey = (k: string) => {
  const [f, p] = k.split(':').map(Number);
  return { func: f!, pc: p! };
};

export type WasmStore = Store<State>;
export const createStore = (s: State) => new Store<State>(s);

// Loads the Glass Wasm VM (Rust compiled to WebAssembly) and wraps its C-ABI
// exports in typed functions. No bindgen: strings go in as UTF-8 through
// gw_alloc, results come back through one output buffer.

export interface SpecFailure {
  line: number;
  command: string;
  message: string;
}
export interface SpecResult {
  passed: number;
  failed: number;
  failures: SpecFailure[];
}

export interface CodeLine {
  depth: number;
  text: string;
  /** byte offset of the instruction in the module text, or -1 */
  offset: number;
}
export interface FuncInfo {
  index: number;
  name: string;
  type: string;
  lines: CodeLine[];
}
export interface ExportInfo {
  name: string;
  kind: 'func' | 'table' | 'memory' | 'global';
  index: number;
  params: string[];
}
export interface ModuleInfo {
  funcs: FuncInfo[];
  exports: ExportInfo[];
  memories: number;
}

export interface WasmValue {
  type: 'i32' | 'i64' | 'f32' | 'f64';
  value: string;
  bits: string;
}
export interface FrameState {
  func: number;
  name: string;
  pc: number;
  stackBase: number;
  locals: { name: string; role: 'param' | 'local'; v: WasmValue }[];
}
export type RunStatus = 'paused' | 'finished' | 'trap' | 'limit';
export interface MachineState {
  status: RunStatus;
  finalStatus: RunStatus;
  step: number;
  total: number;
  trap: string | null;
  results: WasmValue[];
  at: { func: number; pc: number } | null;
  stack: WasmValue[];
  frames: FrameState[];
  /** Open blocks, loops and ifs; `frame` indexes `frames`, `start` is the pc that opened it. */
  labels: { frame: number; kind: 'block' | 'loop' | 'if'; start: number; height: number; arity: number }[];
  globals: { mutable: boolean; v: WasmValue }[];
  memory: { pages: number; bytes: number; last: { addr: number; len: number; write: boolean } | null } | null;
  output: string[];
}

interface Exports {
  memory: WebAssembly.Memory;
  gw_alloc(len: number): number;
  gw_free(ptr: number, len: number): void;
  gw_out_ptr(): number;
  gw_out_len(): number;
  gw_run_spec(ptr: number, len: number): number;
  gw_load(ptr: number, len: number, binary: number): number;
  gw_run(ptr: number, len: number, stopAt: number): number;
  gw_trace(): number;
  gw_memory(offset: number, len: number): number;
  gw_format_number(x: number): number;
}

/** The VM itself failed (not the program it was running) and was restarted. */
export class VmCrash extends Error {
  constructor(detail: string) {
    super(`The virtual machine crashed (${detail}) and was restarted. Please report this, with the module, as a bug.`);
    this.name = 'VmCrash';
  }
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const enc = new TextEncoder();
const dec = new TextDecoder();

export class GlassWasm {
  private x: Exports;

  private constructor(private module: WebAssembly.Module) {
    this.x = GlassWasm.fresh(module);
  }

  private static fresh(module: WebAssembly.Module): Exports {
    return new WebAssembly.Instance(module, {}).exports as unknown as Exports;
  }

  static async fromBytes(bytes: BufferSource): Promise<GlassWasm> {
    return new GlassWasm(await WebAssembly.compile(bytes));
  }

  /**
   * Runs a VM call. If the VM itself crashes (a Rust panic surfaces as a
   * WebAssembly trap), its instance can't be trusted any more: start a fresh one
   * and report the crash instead of leaving the page dead. The page reloads the
   * module afterwards, since the fresh instance has no session.
   */
  private guard<T>(f: () => T): T {
    try {
      return f();
    } catch (e) {
      this.x = GlassWasm.fresh(this.module);
      this.crashes++;
      throw new VmCrash((e as Error).message);
    }
  }

  /** How many times the VM had to be restarted. */
  crashes = 0;

  private out(): Uint8Array {
    return new Uint8Array(this.x.memory.buffer, this.x.gw_out_ptr(), this.x.gw_out_len()).slice();
  }

  private withInput<T>(data: Uint8Array, f: (ptr: number, len: number) => T): T {
    const ptr = this.x.gw_alloc(data.length);
    new Uint8Array(this.x.memory.buffer, ptr, data.length).set(data);
    try {
      return f(ptr, data.length);
    } finally {
      this.x.gw_free(ptr, data.length);
    }
  }

  /** Runs one .wast script with a fresh store. */
  runSpec(source: string): SpecResult {
    return this.guard(() => {
      this.withInput(enc.encode(source), (p, n) => this.x.gw_run_spec(p, n));
      return JSON.parse(dec.decode(this.out())) as SpecResult;
    });
  }

  /** Loads a module (text or binary) for debugging. */
  load(module: string | Uint8Array): Result<ModuleInfo> {
    const isBinary = typeof module !== 'string';
    const bytes = isBinary ? module : enc.encode(module);
    try {
      return this.guard(() => {
        const code = this.withInput(bytes, (p, n) => this.x.gw_load(p, n, isBinary ? 1 : 0));
        const text = dec.decode(this.out());
        return code === 0 ? { ok: true as const, value: JSON.parse(text) as ModuleInfo } : { ok: false as const, error: text };
      });
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  /** Runs an export from the start, stopping after `stopAt` steps (or at the end). */
  run(name: string, args: string[], stopAt?: number): Result<MachineState> {
    // The name goes first with its byte length, so a name may contain anything.
    const nameBytes = enc.encode(name);
    const input = enc.encode(`${nameBytes.length}:${name}${args.join('\n')}`);
    try {
      return this.guard(() => {
        const code = this.withInput(input, (p, n) => this.x.gw_run(p, n, stopAt ?? -1));
        const text = dec.decode(this.out());
        return code === 0 ? { ok: true as const, value: JSON.parse(text) as MachineState } : { ok: false as const, error: text };
      });
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  /** The last full run: for each step, the function index and pc it executed. */
  trace(): Uint32Array {
    const bytes = this.guard(() => {
      this.x.gw_trace();
      return this.out();
    });
    return new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
  }

  /** How Pane prints a number, computed by the VM's host (it must match JavaScript). */
  formatNumber(x: number): string {
    return this.guard(() => {
      this.x.gw_format_number(x);
      return dec.decode(this.out());
    });
  }

  /** Linear memory as the last run left it. */
  memory(offset: number, length: number): Uint8Array {
    return this.guard(() => {
      this.x.gw_memory(offset, length);
      return this.out();
    });
  }
}

/** Steps (indices into the trace) at which instruction (func, pc) ran. */
export function stepsFor(trace: Uint32Array, func: number, pc: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < trace.length; i += 2) {
    if (trace[i] === func && trace[i + 1] === pc) out.push(i / 2);
  }
  return out;
}

/** 1-based line and column of a byte offset in UTF-8 text. */
export function lineColAt(text: string, byteOffset: number): { line: number; col: number } {
  const bytes = enc.encode(text);
  const before = dec.decode(bytes.slice(0, Math.max(0, Math.min(byteOffset, bytes.length))));
  const lines = before.split('\n');
  return { line: lines.length, col: lines[lines.length - 1]!.length + 1 };
}

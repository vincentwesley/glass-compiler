// The `pane` host in JavaScript: the five imports a compiled Pane module needs
// (see packages/wasm/crate/src/pane_host.rs for the same host in Rust).

import { formatValue } from '../bytecode';

export class PaneRuntimeError extends Error {}

export interface PaneHost {
  imports: WebAssembly.Imports;
  memory: WebAssembly.Memory;
  output: string[];
}

export function createPaneHost(pages: { min: number; max: number }): PaneHost {
  const memory = new WebAssembly.Memory({ initial: pages.min, maximum: pages.max });
  const output: string[] = [];
  const text = (ptr: number, len: number) => new TextDecoder().decode(new Uint8Array(memory.buffer, ptr, len));
  return {
    memory,
    output,
    imports: {
      pane: {
        memory,
        print: (ptr: number, len: number) => void output.push(text(ptr, len)),
        error: (ptr: number, len: number) => {
          throw new PaneRuntimeError(text(ptr, len));
        },
        format_number: (x: number, dst: number) => {
          const bytes = new TextEncoder().encode(formatValue(x));
          new Uint8Array(memory.buffer, dst, bytes.length).set(bytes);
          return bytes.length;
        },
        rem: (a: number, b: number) => a % b,
      },
    },
  };
}

export interface WasmRunResult {
  output: string[];
  error: string | null;
}

/** Runs a compiled Pane module with this browser's (or Node's) own WebAssembly engine. */
export async function runWithHostEngine(bytes: Uint8Array, pages: { min: number; max: number }): Promise<WasmRunResult> {
  const host = createPaneHost(pages);
  const module = await WebAssembly.compile(bytes as BufferSource);
  const instance = await WebAssembly.instantiate(module, host.imports);
  try {
    (instance.exports.main as () => void)();
    return { output: host.output, error: null };
  } catch (e) {
    if (e instanceof PaneRuntimeError) return { output: host.output, error: e.message };
    throw e;
  }
}

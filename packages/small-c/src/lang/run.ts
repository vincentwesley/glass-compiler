// Running a compiled C program on this engine's own WebAssembly, with the `c`
// host (the same two imports as Glass Wasm's c_host.rs).

export class ExitSignal extends Error {
  constructor(public code: number) {
    super(`exit(${code})`);
  }
}

export interface RunResult {
  /** stdout and stderr, interleaved as written. */
  output: string;
  exitCode: number | null;
  /** A WebAssembly trap (or other engine error), if the program did not exit. */
  trap: string | null;
}

/** Runs a compiled program on this engine's own WebAssembly (the browser's, or Node's). */
export async function runWithHostEngine(bytes: Uint8Array): Promise<RunResult> {
  const mem: { memory?: WebAssembly.Memory } = {};
  const chunks: Uint8Array[] = [];
  const imports = {
    c: {
      write: (fd: number, ptr: number, len: number) => {
        if (fd === 1 || fd === 2) chunks.push(new Uint8Array(mem.memory!.buffer, ptr, len).slice());
        return len;
      },
      exit: (code: number) => {
        throw new ExitSignal(code);
      },
    },
  };
  const module = await WebAssembly.compile(bytes as BufferSource);
  const instance = await WebAssembly.instantiate(module, imports);
  mem.memory = instance.exports.memory as WebAssembly.Memory;
  const text = () => {
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const all = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) all.set(c, (at += c.length) - c.length);
    return new TextDecoder().decode(all);
  };
  try {
    (instance.exports._start as () => void)();
    return { output: text(), exitCode: 0, trap: null };
  } catch (e) {
    if (e instanceof ExitSignal) return { output: text(), exitCode: e.code, trap: null };
    return { output: text(), exitCode: null, trap: (e as Error).message };
  }
}

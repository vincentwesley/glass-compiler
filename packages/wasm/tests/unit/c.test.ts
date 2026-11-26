// The pipeline: C compiled to WebAssembly by Small C runs in Glass Wasm (this
// crate, built for the browser) with the same output as on Node's own engine.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { compile, runWithHostEngine } from '../../../small-c/src/lang/compile';
import { EXAMPLES } from '../../../small-c/src/examples';
import { GlassWasm } from '../../src/vm';

let vm: GlassWasm;
beforeAll(async () => {
  vm = await GlassWasm.fromBytes(readFileSync(new URL('../../generated/glass_wasm.wasm', import.meta.url)));
});

const bytesOf = (src: string) => {
  const b = compile(src);
  expect(b.diagnostics).toEqual([]);
  return b.wasm!.bytes;
};

describe('C programs in Glass Wasm', () => {
  it('runs every Small C example exactly as Node does', async () => {
    for (const ex of EXAMPLES) {
      const bytes = bytesOf(ex.source);
      const node = await runWithHostEngine(bytes);
      const r = vm.runProgram(bytes);
      if (!r.ok) throw new Error(r.error);
      expect({ output: r.value.output, exit: r.value.exit }, ex.id).toEqual({ output: node.output, exit: node.exitCode });
      expect(r.value.output, ex.id).toBe(ex.expected);
    }
  });

  it('debugs a C program: C source, exit status and printed lines', () => {
    const ex = EXAMPLES.find((e) => e.id === 'hello')!;
    const loaded = vm.load(bytesOf(ex.source));
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.value.source).toEqual({ language: 'c', text: ex.source });
    expect(loaded.value.exports.map((e) => e.name)).toContain('_start');
    const r = vm.run('_start', []);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.status).toBe('exited');
    expect(r.value.exit).toBe(0);
    expect(r.value.output).toEqual(ex.expected.trimEnd().split('\n'));
    // Stepping part-way shows only what was printed so far.
    const mid = vm.run('_start', [], 50);
    if (!mid.ok) throw new Error(mid.error);
    expect(mid.value.status).toBe('paused');
    expect(mid.value.output).toEqual([]);
  });

  it('reports traps and exit codes the same way', async () => {
    for (const src of ['int main(void) { int z = 0; return 5 / z; }', 'int main(void) { return 42; }', '#include <stdlib.h>\nint main(void) { abort(); }']) {
      const bytes = bytesOf(src);
      const node = await runWithHostEngine(bytes);
      const r = vm.runProgram(bytes);
      if (!r.ok) throw new Error(r.error);
      expect(r.value.exit).toBe(node.exitCode);
      expect(r.value.output).toBe(node.output);
      expect(r.value.trap === null).toBe(node.trap === null);
    }
  });
});

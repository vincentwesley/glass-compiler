import { describe, expect, it } from 'vitest';
import { asm, customBytes, encode, parseSig, sigText, type ModuleDef } from '../src/encode';

const base = (over: Partial<ModuleDef>): ModuleDef => ({ importFuncs: [], funcs: [], globals: [], table: [], exports: [], data: [], customs: [], ...over });

async function instance(def: ModuleDef, imports: WebAssembly.Imports = {}) {
  const { bytes } = encode(def);
  expect(WebAssembly.validate(bytes as BufferSource)).toBe(true);
  return (await WebAssembly.instantiate(bytes as BufferSource, imports)).instance;
}

describe('the encoder', () => {
  it('assembles named locals, labels and br_table', async () => {
    const i = await instance(
      base({
        funcs: [
          {
            name: 'pick',
            params: [{ name: 'k', type: 'i32' }],
            results: ['i32'],
            locals: [],
            body: asm(`
              block $c
                block $b
                  block $a
                    local.get $k
                    br_table $a $b $c
                  end
                  i32.const 10
                  return
                end
                i32.const 20
                return
              end
              i32.const 30`),
          },
        ],
        exports: [{ name: 'pick', func: 'pick' }],
      }),
    );
    const pick = i.exports.pick as (k: number) => number;
    expect([0, 1, 2, 9].map(pick)).toEqual([10, 20, 30, 30]);
  });

  it('encodes f32 and f64 constants, i64 constants and globals', async () => {
    const i = await instance(
      base({
        globals: [{ name: 'g', type: 'f32', mutable: false, init: 1.5 }],
        funcs: [
          { name: 'f', params: [], results: ['f32'], locals: [], body: [{ op: 'global.get', imm: ['$g'] }, { op: 'f32.const', imm: [0.25] }, { op: 'f32.add' }] },
          { name: 'd', params: [], results: ['f64'], locals: [], body: [{ op: 'f64.const', imm: [0.1] }] },
          { name: 'l', params: [], results: ['i64'], locals: [], body: [{ op: 'i64.const', imm: [-(2n ** 63n)] }] },
        ],
        exports: ['f', 'd', 'l'].map((n) => ({ name: n, func: n })),
      }),
    );
    expect((i.exports.f as () => number)()).toBe(1.75);
    expect((i.exports.d as () => number)()).toBe(0.1);
    expect((i.exports.l as () => bigint)()).toBe(-(2n ** 63n));
  });

  it('defines and exports its own memory, with data and memory offsets', async () => {
    const i = await instance(
      base({
        memory: { min: 1, max: 2 },
        data: [{ offset: 16, bytes: new Uint8Array([1, 2, 3, 4]) }],
        funcs: [{ name: 'peek', params: [], results: ['i32'], locals: [], body: asm('i32.const 0\ni32.load offset=16') }],
        exports: [{ name: 'peek', func: 'peek' }],
      }),
    );
    expect((i.exports.peek as () => number)()).toBe(0x04030201);
    expect((i.exports.memory as WebAssembly.Memory).buffer.byteLength).toBe(65536);
  });

  it('starts the table at tableBase, so index 0 is a null function pointer', async () => {
    const i = await instance(
      base({
        table: ['seven'],
        tableBase: 1,
        funcs: [
          { name: 'seven', params: [], results: ['i32'], locals: [], body: asm('i32.const 7') },
          { name: 'call', params: [{ name: 'i', type: 'i32' }], results: ['i32'], locals: [], body: [...asm('local.get $i'), { op: 'call_indirect', imm: ['>i32'] }] },
        ],
        exports: [{ name: 'call', func: 'call' }],
      }),
    );
    const call = i.exports.call as (i: number) => number;
    expect(call(1)).toBe(7);
    expect(() => call(0)).toThrow();
  });

  it('round-trips signatures and writes custom sections', () => {
    expect(sigText(parseSig('i32,f64>i64'))).toBe('i32,f64>i64');
    expect(parseSig('>')).toEqual({ params: [], results: [] });
    const c = customBytes((b) => (b.u32(300), b.str('é')));
    expect([...c]).toEqual([0xac, 0x02, 2, 0xc3, 0xa9]);
  });

  it('refuses unknown instructions and names (compiler bugs, caught early)', () => {
    expect(() => asm('i32.frobnicate')).toThrow(/unknown instruction/);
    expect(() => encode(base({ funcs: [{ name: 'f', params: [], results: [], locals: [], body: asm('call $nope') }] }))).toThrow(/unknown function/);
  });
});

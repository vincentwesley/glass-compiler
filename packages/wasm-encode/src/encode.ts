// A small WebAssembly 1.0 module builder and binary encoder, plus an assembler
// for flat text-format instruction lines. Glass Compiler uses it to emit Pane
// programs as real .wasm modules, and Small C to emit C programs; names are
// symbolic until encoding.

export type ValType = 'i32' | 'i64' | 'f32' | 'f64';
export interface Sig {
  params: ValType[];
  results: ValType[];
}

/** One instruction. Immediates may be symbolic: `$name` for functions, locals, globals and labels. */
export interface Ins {
  op: string;
  imm?: (number | bigint | string)[];
  /** The syntax-tree node this instruction came from, if any. */
  node?: number;
  /** Byte offset of that node in the program's source, if any. */
  offset?: number;
}

export interface FuncDef {
  name: string;
  params: { name: string; type: ValType }[];
  results: ValType[];
  locals: { name: string; type: ValType }[];
  body: Ins[];
}

export interface GlobalDef {
  name: string;
  type: ValType;
  mutable: boolean;
  init: bigint | number;
}

export interface ImportFunc {
  module: string;
  name: string;
  as: string;
  params: ValType[];
  results: ValType[];
}

export interface ModuleDef {
  importFuncs: ImportFunc[];
  /** A memory imported as (module, name) with these limits. */
  importMemory?: { module: string; name: string; min: number; max?: number };
  /** A memory the module defines itself (and exports as "memory"). */
  memory?: { min: number; max?: number };
  funcs: FuncDef[];
  globals: GlobalDef[];
  /** Function names placed in the table at index tableBase, tableBase + 1, … (for call_indirect). */
  table: string[];
  /** Where the table's functions start (default 0). Small C uses 1 so that a null function pointer traps. */
  tableBase?: number;
  exports: { name: string; func: string }[];
  /** Bytes copied into memory at instantiation. */
  data: { offset: number; bytes: Uint8Array }[];
  customs: { name: string; bytes: Uint8Array }[];
}

// ---------------------------------------------------------------- opcodes

const NUMERIC = `i32.eqz i32.eq i32.ne i32.lt_s i32.lt_u i32.gt_s i32.gt_u i32.le_s i32.le_u i32.ge_s i32.ge_u
i64.eqz i64.eq i64.ne i64.lt_s i64.lt_u i64.gt_s i64.gt_u i64.le_s i64.le_u i64.ge_s i64.ge_u
f32.eq f32.ne f32.lt f32.gt f32.le f32.ge f64.eq f64.ne f64.lt f64.gt f64.le f64.ge
i32.clz i32.ctz i32.popcnt i32.add i32.sub i32.mul i32.div_s i32.div_u i32.rem_s i32.rem_u i32.and i32.or i32.xor i32.shl i32.shr_s i32.shr_u i32.rotl i32.rotr
i64.clz i64.ctz i64.popcnt i64.add i64.sub i64.mul i64.div_s i64.div_u i64.rem_s i64.rem_u i64.and i64.or i64.xor i64.shl i64.shr_s i64.shr_u i64.rotl i64.rotr
f32.abs f32.neg f32.ceil f32.floor f32.trunc f32.nearest f32.sqrt f32.add f32.sub f32.mul f32.div f32.min f32.max f32.copysign
f64.abs f64.neg f64.ceil f64.floor f64.trunc f64.nearest f64.sqrt f64.add f64.sub f64.mul f64.div f64.min f64.max f64.copysign
i32.wrap_i64 i32.trunc_f32_s i32.trunc_f32_u i32.trunc_f64_s i32.trunc_f64_u i64.extend_i32_s i64.extend_i32_u
i64.trunc_f32_s i64.trunc_f32_u i64.trunc_f64_s i64.trunc_f64_u f32.convert_i32_s f32.convert_i32_u f32.convert_i64_s f32.convert_i64_u
f32.demote_f64 f64.convert_i32_s f64.convert_i32_u f64.convert_i64_s f64.convert_i64_u f64.promote_f32
i32.reinterpret_f32 i64.reinterpret_f64 f32.reinterpret_i32 f64.reinterpret_i64`.split(/\s+/);

const MEMORY = `i32.load i64.load f32.load f64.load i32.load8_s i32.load8_u i32.load16_s i32.load16_u i64.load8_s i64.load8_u
i64.load16_s i64.load16_u i64.load32_s i64.load32_u i32.store i64.store f32.store f64.store i32.store8 i32.store16 i64.store8 i64.store16 i64.store32`.split(/\s+/);
const MEMORY_WIDTH: Record<string, number> = {};
for (const name of MEMORY) {
  const m = /(8|16|32)(_[su])?$/.exec(name.split('.')[1]!);
  MEMORY_WIDTH[name] = m ? Number(m[1]) / 8 : name.startsWith('i32') || name.startsWith('f32') ? 4 : 8;
}

const OPCODE: Record<string, number> = {
  unreachable: 0x00,
  nop: 0x01,
  block: 0x02,
  loop: 0x03,
  if: 0x04,
  else: 0x05,
  end: 0x0b,
  br: 0x0c,
  br_if: 0x0d,
  br_table: 0x0e,
  return: 0x0f,
  call: 0x10,
  call_indirect: 0x11,
  drop: 0x1a,
  select: 0x1b,
  'local.get': 0x20,
  'local.set': 0x21,
  'local.tee': 0x22,
  'global.get': 0x23,
  'global.set': 0x24,
  'memory.size': 0x3f,
  'memory.grow': 0x40,
  'i32.const': 0x41,
  'i64.const': 0x42,
  'f32.const': 0x43,
  'f64.const': 0x44,
};
NUMERIC.forEach((n, i) => (OPCODE[n] = 0x45 + i));
MEMORY.forEach((n, i) => (OPCODE[n] = 0x28 + i));

export const isKnownOp = (op: string) => op in OPCODE;

const VALTYPE: Record<ValType, number> = { i32: 0x7f, i64: 0x7e, f32: 0x7d, f64: 0x7c };

// ---------------------------------------------------------------- bytes

class Bytes {
  private buf: number[] = [];
  byte(b: number) {
    this.buf.push(b & 0xff);
    return this;
  }
  bytes(b: ArrayLike<number>) {
    for (let i = 0; i < b.length; i++) this.buf.push(b[i]!);
    return this;
  }
  u32(v: number) {
    let x = v >>> 0;
    do {
      let b = x & 0x7f;
      x >>>= 7;
      if (x !== 0) b |= 0x80;
      this.buf.push(b);
    } while (x !== 0);
    return this;
  }
  s32(v: number) {
    return this.sleb(BigInt(v | 0));
  }
  sleb(value: bigint) {
    let v = BigInt.asIntN(64, value);
    for (;;) {
      const b = Number(v & 0x7fn);
      v >>= 7n;
      const done = (v === 0n && (b & 0x40) === 0) || (v === -1n && (b & 0x40) !== 0);
      this.buf.push(done ? b : b | 0x80);
      if (done) return this;
    }
  }
  f32(v: number) {
    const dv = new DataView(new ArrayBuffer(4));
    dv.setFloat32(0, v, true);
    return this.bytes(new Uint8Array(dv.buffer));
  }
  f64(v: number) {
    const dv = new DataView(new ArrayBuffer(8));
    dv.setFloat64(0, v, true);
    return this.bytes(new Uint8Array(dv.buffer));
  }
  name(s: string) {
    const b = new TextEncoder().encode(s);
    return this.u32(b.length).bytes(b);
  }
  vec<T>(items: T[], f: (b: Bytes, item: T) => void) {
    this.u32(items.length);
    for (const it of items) f(this, it);
    return this;
  }
  section(id: number, content: Bytes) {
    return this.byte(id).u32(content.length).bytes(content.buf);
  }
  get length() {
    return this.buf.length;
  }
  done(): Uint8Array {
    return Uint8Array.from(this.buf);
  }
}

// ---------------------------------------------------------------- assembler

/**
 * Parses flat text-format lines ("local.get $x", "block $done (result i64)",
 * "br_if $done") into instructions. `;;` starts a comment. No folded forms.
 */
export function asm(src: string): Ins[] {
  const out: Ins[] = [];
  for (const raw of src.split('\n')) {
    const line = raw.replace(/;;.*$/, '').trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const op = parts[0]!;
    if (!isKnownOp(op)) throw new Error(`asm: unknown instruction "${op}" in "${line}"`);
    const imm: (number | bigint | string)[] = [];
    for (const p of parts.slice(1)) {
      if (p.startsWith('$') || p.startsWith('(') || p.endsWith(')') || p.includes('=')) imm.push(p);
      else if (op === 'i64.const') imm.push(BigInt(p));
      else imm.push(Number(p));
    }
    out.push(imm.length ? { op, imm } : { op });
  }
  return out;
}

// ---------------------------------------------------------------- encoder

const sigKey = (s: Sig) => `${s.params.join(',')}>${s.results.join(',')}`;

/** Encodes a module. Throws on unresolved names (a compiler bug, not a user error). */
export function encode(def: ModuleDef): { bytes: Uint8Array; funcIndex: Map<string, number> } {
  const types: Sig[] = [];
  const typeIndex = (s: Sig) => {
    const k = sigKey(s);
    let i = types.findIndex((t) => sigKey(t) === k);
    if (i < 0) {
      types.push(s);
      i = types.length - 1;
    }
    return i;
  };
  const funcIndex = new Map<string, number>();
  def.importFuncs.forEach((f, i) => funcIndex.set(f.as, i));
  def.funcs.forEach((f, i) => funcIndex.set(f.name, def.importFuncs.length + i));
  const globalIndex = new Map(def.globals.map((g, i) => [g.name, i] as const));
  const sym = (map: Map<string, number>, v: number | bigint | string | undefined, what: string): number => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.startsWith('$')) {
      const i = map.get(v.slice(1));
      if (i === undefined) throw new Error(`encode: unknown ${what} ${v}`);
      return i;
    }
    throw new Error(`encode: bad ${what} ${String(v)}`);
  };

  const importTypes = def.importFuncs.map((f) => typeIndex({ params: f.params, results: f.results }));
  const funcTypes = def.funcs.map((f) => typeIndex({ params: f.params.map((p) => p.type), results: f.results }));

  const code = new Bytes();
  code.u32(def.funcs.length);
  for (const f of def.funcs) {
    const body = new Bytes();
    // Locals, grouped by consecutive type.
    const groups: [number, ValType][] = [];
    for (const l of f.locals) {
      const last = groups[groups.length - 1];
      if (last && last[1] === l.type) last[0]++;
      else groups.push([1, l.type]);
    }
    body.vec(groups, (b, [n, t]) => b.u32(n).byte(VALTYPE[t]));
    const locals = new Map<string, number>();
    [...f.params, ...f.locals].forEach((l, i) => locals.set(l.name, i));
    const labels: (string | null)[] = [];
    const label = (v: number | bigint | string | undefined) => {
      if (typeof v === 'number') return v;
      const i = labels.lastIndexOf(String(v).slice(1));
      if (i < 0) throw new Error(`encode: unknown label ${String(v)} in $${f.name}`);
      return labels.length - 1 - i;
    };
    const blockType = (imm: Ins['imm']) => {
      const t = imm?.map(String).join(' ').match(/\(result (i32|i64|f32|f64)\)/)?.[1] as ValType | undefined;
      return t ? VALTYPE[t] : 0x40;
    };
    for (const ins of [...f.body, { op: 'end' } as Ins]) {
      const op = OPCODE[ins.op];
      if (op === undefined) throw new Error(`encode: unknown op ${ins.op}`);
      body.byte(op);
      const imm = ins.imm ?? [];
      switch (ins.op) {
        case 'block':
        case 'loop':
        case 'if': {
          const name = imm.find((x) => typeof x === 'string' && x.startsWith('$')) as string | undefined;
          labels.push(name ? name.slice(1) : null);
          body.byte(blockType(imm));
          break;
        }
        case 'end':
          labels.pop();
          break;
        case 'br':
        case 'br_if':
          body.u32(label(imm[0]));
          break;
        case 'br_table': {
          // Every immediate is a label; the last one is the default.
          const targets = imm.map(label);
          body.vec(targets.slice(0, -1), (b, t) => b.u32(t)).u32(targets[targets.length - 1]!);
          break;
        }
        case 'call':
          body.u32(sym(funcIndex, imm[0], 'function'));
          break;
        case 'call_indirect':
          // The immediate is a signature like "i64,i64>i64".
          body.u32(typeIndex(parseSig(String(imm[0])))).byte(0);
          break;
        case 'local.get':
        case 'local.set':
        case 'local.tee':
          body.u32(sym(locals, imm[0], 'local'));
          break;
        case 'global.get':
        case 'global.set':
          body.u32(sym(globalIndex, imm[0], 'global'));
          break;
        case 'memory.size':
        case 'memory.grow':
          body.byte(0);
          break;
        case 'i32.const':
          body.s32(Number(imm[0]));
          break;
        case 'i64.const':
          body.sleb(BigInt(imm[0]!));
          break;
        case 'f32.const':
          body.f32(Number(imm[0]));
          break;
        case 'f64.const':
          body.f64(Number(imm[0]));
          break;
        default:
          if (ins.op in MEMORY_WIDTH) {
            const offset = Number(String(imm.find((x) => String(x).startsWith('offset=')) ?? 'offset=0').slice(7));
            body.u32(Math.log2(MEMORY_WIDTH[ins.op]!)).u32(offset);
          }
      }
    }
    code.u32(body.length).bytes(body.done());
  }

  const out = new Bytes().bytes([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  out.section(1, new Bytes().vec(types, (b, t) => b.byte(0x60).vec(t.params, (bb, p) => bb.byte(VALTYPE[p])).vec(t.results, (bb, r) => bb.byte(VALTYPE[r]))));
  const imports = new Bytes();
  const importCount = def.importFuncs.length + (def.importMemory ? 1 : 0);
  imports.u32(importCount);
  def.importFuncs.forEach((f, i) => imports.name(f.module).name(f.name).byte(0).u32(importTypes[i]!));
  if (def.importMemory) {
    const m = def.importMemory;
    imports.name(m.module).name(m.name).byte(2);
    if (m.max === undefined) imports.byte(0).u32(m.min);
    else imports.byte(1).u32(m.min).u32(m.max);
  }
  out.section(2, imports);
  out.section(3, new Bytes().vec(funcTypes, (b, t) => b.u32(t)));
  // Always a table (even empty): call_indirect needs one to validate.
  const tableBase = def.tableBase ?? 0;
  const tableSize = tableBase + def.table.length;
  out.section(4, new Bytes().u32(1).byte(0x70).byte(1).u32(tableSize).u32(tableSize));
  if (def.memory) {
    const m = def.memory;
    out.section(5, m.max === undefined ? new Bytes().u32(1).byte(0).u32(m.min) : new Bytes().u32(1).byte(1).u32(m.min).u32(m.max));
  }
  out.section(
    6,
    new Bytes().vec(def.globals, (b, g) => {
      b.byte(VALTYPE[g.type]).byte(g.mutable ? 1 : 0);
      if (g.type === 'i64') b.byte(0x42).sleb(BigInt(g.init));
      else if (g.type === 'i32') b.byte(0x41).s32(Number(g.init));
      else if (g.type === 'f32') b.byte(0x43).f32(Number(g.init));
      else b.byte(0x44).f64(Number(g.init));
      b.byte(0x0b);
    }),
  );
  const exports = new Bytes();
  exports.u32(def.exports.length + (def.memory ? 1 : 0));
  for (const e of def.exports) exports.name(e.name).byte(0).u32(sym(funcIndex, `$${e.func}`, 'function'));
  if (def.memory) exports.name('memory').byte(2).u32(0);
  out.section(7, exports);
  if (def.table.length) {
    out.section(9, new Bytes().u32(1).u32(0).byte(0x41).s32(tableBase).byte(0x0b).vec(def.table, (b, n) => b.u32(sym(funcIndex, `$${n}`, 'function'))));
  }
  out.section(10, code);
  if (def.data.length) {
    out.section(11, new Bytes().vec(def.data, (b, d) => b.u32(0).byte(0x41).s32(d.offset).byte(0x0b).u32(d.bytes.length).bytes(d.bytes)));
  }
  // Debug info: the standard name section (function and local names).
  const names = new Bytes();
  const fnNames = new Bytes().vec([...def.importFuncs.map((f) => f.as), ...def.funcs.map((f) => f.name)].map((n, i) => [i, n] as const), (b, [i, n]) => b.u32(i).name(n));
  names.byte(1).u32(fnNames.length).bytes(fnNames.done());
  const localNames = new Bytes().vec(
    def.funcs.map((f, i) => [def.importFuncs.length + i, [...f.params, ...f.locals]] as const),
    (b, [i, ls]) => b.u32(i).vec(ls.map((l, j) => [j, l.name] as const), (bb, [j, n]) => bb.u32(j).name(n)),
  );
  names.byte(2).u32(localNames.length).bytes(localNames.done());
  out.section(0, new Bytes().name('name').bytes(names.done()));
  for (const c of def.customs) out.section(0, new Bytes().name(c.name).bytes(c.bytes));
  return { bytes: out.done(), funcIndex };
}

/** Encodes values for a custom section: unsigned LEB128 numbers and length-prefixed strings. */
export function customBytes(build: (b: { u32(n: number): void; str(s: string): void }) => void): Uint8Array {
  const b = new Bytes();
  build({ u32: (n) => void b.u32(n), str: (s) => void b.name(s) });
  return b.done();
}

/** "i64,i64>i64" → { params: [i64, i64], results: [i64] }. */
export function parseSig(s: string): Sig {
  const [p, r] = s.split('>');
  const list = (x: string | undefined) => (x ? (x.split(',').filter(Boolean) as ValType[]) : []);
  return { params: list(p), results: list(r) };
}

export const sigText = (s: Sig) => `${s.params.join(',')}>${s.results.join(',')}`;

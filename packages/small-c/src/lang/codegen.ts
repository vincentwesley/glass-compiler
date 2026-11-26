// Code generation: the typed syntax tree → a WebAssembly 1.0 module.
//
// - Scalars whose address is never taken live in WebAssembly locals, named as in
//   the C source. Arrays, structs and address-taken variables live in a stack
//   frame in linear memory, addressed from `$fp`; `$sp` is the stack pointer.
// - Control flow is structured (block/loop/if) wherever C's is. A function with
//   goto, or with case labels below the top of its switch (Duff's device), is
//   compiled as numbered blocks under one dispatch loop: `$pc` holds the block to
//   run next, and `br_table` jumps to it.
// - Calls with `...` pass the extra arguments in a memory area (the last
//   parameter), structs are passed and returned through memory.
// See DECISIONS S17 to S19.

import type { Node, Obj } from './ast';
import { errorAt, type Token } from './tokenize';
import { alignTo, isFloat, isInteger, T, typeName, wasmType, type Member, type Type } from './types';
import { asm, customBytes, encode, sigText, type FuncDef, type Ins, type ModuleDef, type ValType } from '@glass/wasm-encode';

export interface WasmFunction {
  index: number;
  name: string;
  /** 'c' for the program's own functions, 'libc' for the C library, 'runtime' for the helpers. */
  kind: 'c' | 'libc' | 'runtime';
  body: Ins[];
  params: { name: string; type: ValType }[];
  results: ValType[];
  /** The C function this came from. */
  obj?: Obj;
}

export interface GlobalInfo {
  name: string;
  address: number;
  size: number;
  type: string;
  kind: 'c' | 'libc' | 'string';
}

export interface WasmOutput {
  bytes: Uint8Array;
  functions: WasmFunction[];
  globals: GlobalInfo[];
  layout: { dataStart: number; dataEnd: number; stackBottom: number; stackTop: number; heapStart: number; pages: number };
  /** Function names in table order (index 1 onwards). */
  table: string[];
}

export const DATA_START = 1024;
export const STACK_SIZE = 1 << 20;
/** Room below the stack limit for the overflow handler itself. */
const STACK_SLACK = 8192;
export const MAX_PAGES = 2048; // 128 MiB
export const HOST_IMPORTS = [
  { module: 'c', name: 'write', as: 'c.write', params: ['i32', 'i32', 'i32'] as ValType[], results: ['i32'] as ValType[] },
  { module: 'c', name: 'exit', as: 'c.exit', params: ['i32'] as ValType[], results: [] as ValType[] },
];

const RUNTIME: FuncDef[] = [
  {
    // Copies n bytes from src to dst (struct assignment and by-value arguments).
    name: 'rt.copy',
    params: [
      { name: 'dst', type: 'i32' },
      { name: 'src', type: 'i32' },
      { name: 'n', type: 'i32' },
    ],
    results: [],
    locals: [{ name: 'i', type: 'i32' }],
    body: asm(`
      block $done
        loop $next
          local.get $i
          local.get $n
          i32.ge_u
          br_if $done
          local.get $dst
          local.get $i
          i32.add
          local.get $src
          local.get $i
          i32.add
          i32.load8_u
          i32.store8
          local.get $i
          i32.const 1
          i32.add
          local.set $i
          br $next
        end
      end`),
  },
  {
    // Fills n bytes at dst with zero (initialisers).
    name: 'rt.zero',
    params: [
      { name: 'dst', type: 'i32' },
      { name: 'n', type: 'i32' },
    ],
    results: [],
    locals: [{ name: 'i', type: 'i32' }],
    body: asm(`
      block $done
        loop $next
          local.get $i
          local.get $n
          i32.ge_u
          br_if $done
          local.get $dst
          local.get $i
          i32.add
          i32.const 0
          i32.store8
          local.get $i
          i32.const 1
          i32.add
          local.set $i
          br $next
        end
      end`),
  },
];

/** For each UTF-16 index of `text` (and its end), the UTF-8 byte offset. */
export function utf8Offsets(text: string): number[] {
  const out = new Array<number>(text.length + 1);
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    out[i] = bytes;
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c < 0xdc00) {
      bytes += 4;
      out[++i] = bytes - 4;
    } else bytes += 3;
  }
  out[text.length] = bytes;
  return out;
}

const LOAD: Record<string, string> = {};
const STORE: Record<string, string> = {};
function loadOp(t: Type): string {
  switch (t.kind) {
    case 'bool':
      return 'i32.load8_u';
    case 'char':
      return t.unsigned ? 'i32.load8_u' : 'i32.load8_s';
    case 'short':
      return t.unsigned ? 'i32.load16_u' : 'i32.load16_s';
    case 'llong':
      return 'i64.load';
    case 'float':
      return 'f32.load';
    case 'double':
    case 'ldouble':
      return 'f64.load';
    default:
      return 'i32.load';
  }
}
function storeOp(t: Type): string {
  switch (t.kind) {
    case 'bool':
    case 'char':
      return 'i32.store8';
    case 'short':
      return 'i32.store16';
    case 'llong':
      return 'i64.store';
    case 'float':
      return 'f32.store';
    case 'double':
    case 'ldouble':
      return 'f64.store';
    default:
      return 'i32.store';
  }
}
void LOAD;
void STORE;

/** Bit-fields of bool, unsigned types and enums without negative values read back unsigned. */
const fieldUnsigned = (m: Member) => m.ty.unsigned || m.ty.kind === 'bool' || (m.ty.kind === 'enum' && !m.ty.hasNegative);

const isAgg = (t: Type) => t.kind === 'struct' || t.kind === 'union' || t.kind === 'array';

/** A place a value can be read from and written to. */
type Place = { kind: 'local'; name: string; ty: Type } | { kind: 'mem'; ty: Type; addr: string; offset: number } | { kind: 'bits'; ty: Type; member: Member; addr: string; offset: number };

export interface Program {
  /** The program's globals and functions, then the library's. */
  units: { globals: Obj[]; kind: 'c' | 'libc' }[];
  source: string;
}

export function generate(program: Program): WasmOutput {
  // ------------------------------------------------------------ linking
  const defs = new Map<string, Obj>(); // external name → definition
  const kindOf = new Map<Obj, 'c' | 'libc'>();
  for (const u of program.units) {
    for (const g of u.globals) {
      kindOf.set(g, u.kind);
      if (!g.isDefinition || g.isStatic) continue;
      const prev = defs.get(g.name);
      if (prev && kindOf.get(prev) === u.kind) {
        // Two tentative definitions merge; a real one wins.
        if (!prev.isFunction && !g.isFunction && (prev.tentative || g.tentative)) {
          if (prev.tentative && !g.tentative) defs.set(g.name, g);
          continue;
        }
        throw errorAt(g.tok, `${g.name} is defined twice`);
      }
      if (!prev) defs.set(g.name, g); // the program's own definitions come first and win
    }
  }
  const resolve = (o: Obj): Obj => {
    if (o.isLocal || o.isStatic || o.anonymous) return o.isDefinition || o.isLocal ? o : defs.get(o.name) ?? o;
    return defs.get(o.name) ?? o;
  };

  const main = defs.get('main');
  if (!main || !main.isFunction || kindOf.get(main) !== 'c') {
    const userUnit = program.units[0]!;
    const tok = userUnit.globals[0]?.tok;
    throw new LinkError('there is no main function: a C program starts at int main(void)', tok);
  }

  // Reachability from main (and the library's exit, which _start calls).
  const reachable = new Set<Obj>();
  const work: Obj[] = [];
  const reach = (o: Obj, from: Token) => {
    if (INTRINSICS[o.name] && o.isFunction && !o.isDefinition) return;
    const d = resolve(o);
    if (!d.isDefinition && !d.isLocal) {
      throw new LinkError(
        d.isFunction
          ? `${d.name} is declared but never defined${kindOf.get(o) === 'c' ? '' : ''}: Small C's library has no ${d.name}`
          : `${d.name} is declared extern but never defined`,
        from,
      );
    }
    if (d.isLocal || reachable.has(d)) return;
    reachable.add(d);
    work.push(d);
  };
  const walk = (n: Node | undefined): void => {
    if (!n) return;
    if (n.obj && !n.obj.isLocal) reach(n.obj, n.tok);
    walk(n.lhs);
    walk(n.rhs);
    walk(n.cond);
    walk(n.then);
    walk(n.els);
    walk(n.init);
    walk(n.inc);
    walk(n.body);
    n.stmts?.forEach(walk);
    n.args?.forEach(walk);
  };
  reach(main, main.tok);
  const exitFn = defs.get('exit');
  if (!exitFn) throw new Error('libc has no exit');
  reach(exitFn, main.tok);
  const overflow = defs.get('__stack_overflow')!;
  reach(overflow, main.tok);
  while (work.length) {
    const o = work.pop()!;
    if (o.isFunction) {
      walk(o.body);
      // Static locals referenced from the body are reached through walk.
    } else for (const r of o.relocs ?? []) reach(r.target, o.tok);
  }

  // ------------------------------------------------------------ memory layout
  const address = new Map<Obj, number>();
  const globals: GlobalInfo[] = [];
  let at = DATA_START;
  const dataObjs: Obj[] = [];
  for (const u of program.units)
    for (const g of u.globals) {
      if (g.isFunction || !reachable.has(g) || address.has(g)) continue;
      at = alignTo(at, Math.max(g.ty.align, g.ty.kind === 'array' && g.ty.size >= 16 ? 16 : 1));
      address.set(g, at);
      globals.push({ name: g.literal ?? g.name, address: at, size: g.ty.size, type: typeName(g.ty), kind: g.literal ? 'string' : u.kind });
      dataObjs.push(g);
      at += Math.max(g.ty.size, 0);
    }
  // argv for main: { "a.out", 0 }
  at = alignTo(at, 4);
  const argvAddr = at;
  const progName = at + 8;
  at += 8 + 6;
  const dataEnd = alignTo(at, 16);
  const stackBottom = dataEnd;
  const stackTop = stackBottom + STACK_SIZE;
  const heapStart = stackTop;
  const pages = Math.ceil((heapStart + 65536) / 65536);

  // ------------------------------------------------------------ functions
  const fnName = new Map<Obj, string>();
  const used = new Set<string>(['main', '_start', ...RUNTIME.map((f) => f.name), ...HOST_IMPORTS.map((h) => h.as)]);
  const fnObjs: Obj[] = [];
  for (const u of program.units)
    for (const g of u.globals)
      if (g.isFunction && reachable.has(g)) {
        let n = g.name === 'main' && g === main ? 'main' : g.name;
        if (g !== main) for (let i = 2; used.has(n); i++) n = `${g.name}.${i}`;
        used.add(n);
        fnName.set(g, n);
        fnObjs.push(g);
      }
  const table: string[] = [];
  const tableIndex = (o: Obj): number => {
    const name = fnName.get(resolve(o))!;
    let i = table.indexOf(name);
    if (i < 0) {
      table.push(name);
      i = table.length - 1;
    }
    return i + 1; // 0 is the null function pointer
  };

  // Data segments.
  const data: ModuleDef['data'] = [];
  for (const g of dataObjs) {
    if (!g.data) continue;
    const bytes = new Uint8Array(g.ty.size);
    bytes.set(g.data.subarray(0, g.ty.size));
    const dv = new DataView(bytes.buffer);
    for (const r of g.relocs ?? []) {
      const t = resolve(r.target);
      const v = t.isFunction ? tableIndex(t) + r.addend : address.get(t)! + r.addend;
      dv.setUint32(r.offset, v >>> 0, true);
    }
    if (bytes.some((b) => b !== 0)) data.push({ offset: address.get(g)!, bytes });
  }
  {
    const argv = new Uint8Array(14);
    const dv = new DataView(argv.buffer);
    dv.setUint32(0, progName, true);
    argv.set(new TextEncoder().encode('a.out'), 8);
    data.push({ offset: argvAddr, bytes: argv });
  }

  const offsets = utf8Offsets(program.source);
  const sigOf = (f: Type): { params: ValType[]; results: ValType[] } => {
    const params: ValType[] = [];
    if (f.ret!.kind === 'struct' || f.ret!.kind === 'union') params.push('i32');
    for (const p of f.params!) params.push(wasmType(p));
    if (f.variadic) params.push('i32');
    const results: ValType[] = f.ret!.kind === 'void' ? [] : [wasmType(f.ret!)];
    return { params, results };
  };

  const out: WasmFunction[] = [];
  const funcDefs: FuncDef[] = [];

  for (const f of fnObjs) {
    const g = FnGen(f, kindOf.get(f)!);
    funcDefs.push(g.def);
    out.push({ index: 0, name: g.def.name, kind: kindOf.get(f)!, body: g.def.body, params: g.def.params, results: g.def.results, obj: f });
  }

  // _start: argc/argv for main if it wants them, then exit(main(…)).
  {
    const body: Ins[] = [];
    const np = main.ty.params?.length ?? 0;
    if (np >= 1) body.push({ op: 'i32.const', imm: [1] });
    if (np >= 2) body.push({ op: 'i32.const', imm: [argvAddr] });
    for (let i = 2; i < np; i++) body.push({ op: 'i32.const', imm: [0] });
    body.push({ op: 'call', imm: ['$main'] });
    if (main.ty.ret!.kind === 'void') body.push({ op: 'i32.const', imm: [0] });
    else if (wasmType(main.ty.ret!) !== 'i32') throw new LinkError('main must return int', main.tok);
    body.push({ op: 'call', imm: [`$${fnName.get(exitFn)}`] });
    funcDefs.push({ name: '_start', params: [], results: [], locals: [], body });
    out.push({ index: 0, name: '_start', kind: 'runtime', body, params: [], results: [] });
  }
  for (const r of RUNTIME) {
    funcDefs.push(r);
    out.push({ index: 0, name: r.name, kind: 'runtime', body: r.body, params: r.params, results: r.results });
  }

  const userFuncs = out.filter((f) => f.kind === 'c');
  const module: ModuleDef = {
    importFuncs: HOST_IMPORTS,
    memory: { min: pages, max: MAX_PAGES },
    funcs: funcDefs,
    globals: [{ name: 'sp', type: 'i32', mutable: true, init: stackTop }],
    table,
    tableBase: 1,
    exports: [{ name: '_start', func: '_start' }],
    data,
    customs: [
      { name: 'glass.source', bytes: customBytes((b) => (b.str('c'), b.str(program.source))) },
      { name: 'glass.globals', bytes: customBytes((b) => (b.u32(1), b.u32(0), b.str('sp'))) },
      {
        name: 'glass.map',
        bytes: customBytes((b) => {
          b.u32(userFuncs.length);
          for (const f of userFuncs) {
            b.u32(HOST_IMPORTS.length + funcDefs.findIndex((d) => d.name === f.name));
            const ins = [...f.body, { op: 'end' } as Ins];
            b.u32(ins.length);
            for (const i of ins) b.u32(i.offset === undefined ? 0 : i.offset + 1);
          }
        }),
      },
    ],
  };
  const { bytes, funcIndex } = encode(module);
  for (const f of out) f.index = funcIndex.get(f.name)!;
  return { bytes, functions: out, globals, layout: { dataStart: DATA_START, dataEnd, stackBottom, stackTop, heapStart, pages }, table };

  // ============================================================ one function

  function FnGen(f: Obj, kind: 'c' | 'libc'): { def: FuncDef } {
    const body: Ins[] = [];
    let code: Ins[] = body;
    const locals: { name: string; type: ValType }[] = [];
    const names = new Set<string>();
    const localName = new Map<Obj, string>();
    const frameOffset = new Map<Obj, number>();
    let frameSize = 0;
    let usesFrame = false;
    let cur: Node | undefined;
    let labelCount = 0;
    const user = kind === 'c';
    const ret = f.ty.ret!;
    const structRet = ret.kind === 'struct' || ret.kind === 'union';

    const uniq = (base: string) => {
      let n = base;
      for (let i = 2; names.has(n); i++) n = `${base}.${i}`;
      names.add(n);
      return n;
    };
    const addLocal = (base: string, type: ValType) => {
      const n = uniq(base);
      locals.push({ name: n, type });
      return n;
    };
    const temp = (type: ValType) => addLocal(`tmp`, type);
    const label = (what: string) => `${what}${labelCount++}`;
    const allocFrame = (size: number, align: number) => {
      frameSize = alignTo(frameSize, Math.max(align, 1));
      const off = frameSize;
      frameSize += Math.max(size, 1);
      usesFrame = true;
      return off;
    };

    const emit = (op: string, ...imm: (number | bigint | string)[]) => {
      const ins: Ins = imm.length ? { op, imm } : { op };
      if (user && cur && cur.tok.file.user !== false && (cur.tok.origin ?? cur.tok).file.user) {
        ins.node = cur.id;
        ins.offset = offsets[cur.start] ?? 0;
      }
      code.push(ins);
    };
    const at = <R>(n: Node, fn: () => R): R => {
      const saved = cur;
      cur = n;
      try {
        return fn();
      } finally {
        cur = saved;
      }
    };

    // Parameters.
    const params: { name: string; type: ValType }[] = [];
    let retPtr = '';
    if (structRet) {
      retPtr = uniq('__ret');
      params.push({ name: retPtr, type: 'i32' });
    }
    const paramLocal = new Map<Obj, string>();
    for (const p of f.params!) {
      const n = uniq(p.name.startsWith('.') ? 'param' : p.name);
      params.push({ name: n, type: wasmType(p.ty) });
      paramLocal.set(p, n);
    }
    if (f.vaArea) {
      const n = uniq('__va_area');
      params.push({ name: n, type: 'i32' });
      paramLocal.set(f.vaArea, n);
    }
    // Where each local lives.
    for (const o of [...f.params!, ...(f.vaArea ? [f.vaArea] : []), ...f.locals!]) {
      if (o.isParam && (o.ty.kind === 'struct' || o.ty.kind === 'union')) continue; // addressed through the parameter
      if (o.inMemory) frameOffset.set(o, allocFrame(o.ty.size, o.ty.align));
      else if (paramLocal.has(o)) localName.set(o, paramLocal.get(o)!);
      else localName.set(o, addLocal(o.name.startsWith('.') ? 'tmp' : o.name, wasmType(o.ty)));
    }
    const rv = ret.kind === 'void' ? '' : addLocal('__result', wasmType(ret));
    const fp = uniq('__fp');
    const pc = f.needsDispatch ? addLocal('__pc', 'i32') : '';

    // ------------------------------------------------------------ helpers

    const constOf = (ty: Type, v: bigint | number) => {
      const w = wasmType(ty);
      if (w === 'i64') emit('i64.const', BigInt.asIntN(64, BigInt(v)));
      else if (w === 'i32') emit('i32.const', Number(BigInt.asIntN(32, BigInt(v))));
      else emit(`${w}.const`, Number(v));
    };

    /** Pushes the base address of a memory object and returns a constant offset to add. */
    const objAddr = (o: Obj): number => {
      if (o.isLocal) {
        if (o.isParam && (o.ty.kind === 'struct' || o.ty.kind === 'union')) {
          emit('local.get', `$${paramLocal.get(o)}`);
          return 0;
        }
        const off = frameOffset.get(o);
        if (off === undefined) throw new Error(`no frame slot for ${o.name}`);
        emit('local.get', `$${fp}`);
        return off;
      }
      const d = resolve(o);
      const a = address.get(d);
      if (a === undefined) throw new Error(`no address for ${d.name}`);
      emit('i32.const', a);
      return 0;
    };
    const addOffset = (k: number) => {
      if (k !== 0) {
        emit('i32.const', k);
        emit('i32.add');
      }
    };

    /** Pushes an lvalue's base address; returns a constant offset (folded into loads and stores). */
    const addr = (n: Node): number =>
      at(n, () => {
        switch (n.kind) {
          case 'var':
            if (n.obj!.isFunction) throw errorAt(n.tok, 'a function has no data address');
            return objAddr(n.obj!);
          case 'deref': {
            const p = n.lhs!;
            // *(p + constant) folds the constant into the access.
            if (p.kind === 'add' && p.rhs!.kind === 'num' && p.rhs!.val! >= 0n && p.rhs!.val! < 0x10000000n) {
              gen(p.lhs!);
              return Number(p.rhs!.val!);
            }
            gen(p);
            return 0;
          }
          case 'member': {
            const base = isAgg(n.lhs!.ty) ? addrOrValue(n.lhs!) : addr(n.lhs!);
            return base + n.member!.offset;
          }
          case 'comma':
            gen(n.lhs!, false);
            return addr(n.rhs!);
          case 'cond':
          case 'call':
          case 'stmtexpr':
          case 'assign':
          case 'vaarg':
            gen(n); // an aggregate's value is its address
            return 0;
          default:
            throw errorAt(n.tok, `cannot take the address of this expression (${n.kind})`);
        }
      });
    /** For aggregates, any expression's value is its address. */
    const addrOrValue = (n: Node): number => {
      if (n.kind === 'var' || n.kind === 'deref' || n.kind === 'member' || n.kind === 'comma') return addr(n);
      gen(n);
      return 0;
    };
    const fullAddr = (n: Node) => addOffset(addr(n));

    const place = (n: Node): Place => {
      if (n.kind === 'var' && localName.has(n.obj!)) return { kind: 'local', name: localName.get(n.obj!)!, ty: n.ty };
      const k = addr(n);
      const a = temp('i32');
      at(n, () => emit('local.set', `$${a}`));
      if (n.kind === 'member' && n.member!.bitWidth !== undefined) return { kind: 'bits', ty: n.ty, member: n.member!, addr: a, offset: k - n.member!.offset + n.member!.offset };
      return { kind: 'mem', ty: n.ty, addr: a, offset: k };
    };
    const memarg = (k: number) => (k ? [`offset=${k}`] : []);
    const load = (p: Place) => {
      if (p.kind === 'local') emit('local.get', `$${p.name}`);
      else if (p.kind === 'mem') {
        emit('local.get', `$${p.addr}`);
        emit(loadOp(p.ty), ...memarg(p.offset));
      } else loadBits(p.member, () => emit('local.get', `$${p.addr}`), p.offset);
    };
    /** Stores the value on top of the stack (computed by `value`) to the place; keeps a copy if `keep`. */
    const store = (p: Place, value: () => void, keep: boolean) => {
      if (p.kind === 'local') {
        value();
        emit(keep ? 'local.tee' : 'local.set', `$${p.name}`);
        return;
      }
      if (p.kind === 'mem') {
        emit('local.get', `$${p.addr}`);
        value();
        let t = '';
        if (keep) {
          t = temp(wasmType(p.ty));
          emit('local.tee', `$${t}`);
        }
        emit(storeOp(p.ty), ...memarg(p.offset));
        if (keep) emit('local.get', `$${t}`);
        return;
      }
      storeBits(p.member, () => emit('local.get', `$${p.addr}`), p.offset, value, keep);
    };

    // Bit-fields: the storage unit is the member's declared type.
    const unitType = (m: Member): Type => (m.ty.size === 8 ? T.ullong : m.ty.size === 2 ? T.ushort : m.ty.size === 1 ? T.uchar : T.uint);
    const loadBits = (m: Member, base: () => void, k: number) => {
      const w = wasmType(m.ty) === 'i64' ? 'i64' : 'i32';
      const bits = m.ty.size === 8 ? 64 : 32;
      base();
      emit(loadOp(unitType(m)), ...memarg(k));
      // Shift the field to the top, then back down (arithmetic for signed fields).
      const up = bits - m.bitWidth! - m.bitOffset! - (m.ty.size < 4 ? 0 : 0) - (bits - m.ty.size * 8 > 0 ? 0 : 0);
      const unitBits = m.ty.size * 8;
      const shl = bits - (m.bitOffset! + m.bitWidth!) - (bits - Math.max(unitBits, 32 === bits ? unitBits : unitBits));
      void up;
      void shl;
      const left = bits - m.bitOffset! - m.bitWidth!;
      if (left) {
        constOf(w === 'i64' ? T.llong : T.int, left);
        emit(`${w}.shl`);
      }
      constOf(w === 'i64' ? T.llong : T.int, bits - m.bitWidth!);
      emit(fieldUnsigned(m) ? `${w}.shr_u` : `${w}.shr_s`);
    };
    const storeBits = (m: Member, base: () => void, k: number, value: () => void, keep: boolean) => {
      const w = wasmType(m.ty) === 'i64' ? 'i64' : 'i32';
      const W = w === 'i64' ? T.llong : T.int;
      const mask = (1n << BigInt(m.bitWidth!)) - 1n;
      const v = temp(w);
      value();
      constOf(W, mask);
      emit(`${w}.and`);
      emit('local.set', `$${v}`);
      base();
      base();
      emit(loadOp(unitType(m)), ...memarg(k));
      constOf(W, ~(mask << BigInt(m.bitOffset!)));
      emit(`${w}.and`);
      emit('local.get', `$${v}`);
      if (m.bitOffset) {
        constOf(W, m.bitOffset);
        emit(`${w}.shl`);
      }
      emit(`${w}.or`);
      emit(storeOp(unitType(m)), ...memarg(k));
      if (keep) {
        // The value of the assignment is the stored field, read back with its sign.
        emit('local.get', `$${v}`);
        const bits = w === 'i64' ? 64 : 32;
        if (!fieldUnsigned(m)) {
          constOf(W, bits - m.bitWidth!);
          emit(`${w}.shl`);
          constOf(W, bits - m.bitWidth!);
          emit(`${w}.shr_s`);
        }
      }
    };

    // ------------------------------------------------------------ conversions

    const narrow = (to: Type) => {
      if (to.kind === 'bool') return;
      if (to.size === 1) {
        if (to.unsigned) {
          emit('i32.const', 255);
          emit('i32.and');
        } else {
          emit('i32.const', 24);
          emit('i32.shl');
          emit('i32.const', 24);
          emit('i32.shr_s');
        }
      } else if (to.size === 2) {
        if (to.unsigned) {
          emit('i32.const', 65535);
          emit('i32.and');
        } else {
          emit('i32.const', 16);
          emit('i32.shl');
          emit('i32.const', 16);
          emit('i32.shr_s');
        }
      }
    };
    const convert = (from: Type, to: Type) => {
      if (to.kind === 'void') {
        if (from.kind !== 'void') emit('drop');
        return;
      }
      const fw = wasmType(from);
      const tw = wasmType(to);
      if (to.kind === 'bool') {
        if (from.kind === 'bool') return;
        if (fw === 'i32') {
          emit('i32.const', 0);
          emit('i32.ne');
        } else if (fw === 'i64') {
          emit('i64.const', 0n);
          emit('i64.ne');
        } else {
          emit(`${fw}.const`, 0);
          emit(`${fw}.ne`);
        }
        return;
      }
      if (isFloat(to)) {
        if (isFloat(from)) {
          if (fw === 'f64' && tw === 'f32') emit('f32.demote_f64');
          else if (fw === 'f32' && tw === 'f64') emit('f64.promote_f32');
          return;
        }
        emit(`${tw}.convert_${fw}_${from.unsigned ? 'u' : 's'}`);
        return;
      }
      if (isFloat(from)) {
        const via = tw === 'i64' ? 'i64' : 'i32';
        const u = to.unsigned && to.size >= 4;
        emit(`${via}.trunc_${fw}_${u ? 'u' : 's'}`);
        if (to.size < 4) narrow(to);
        return;
      }
      // integer or pointer to integer or pointer
      if (fw === 'i64' && tw === 'i32') emit('i32.wrap_i64');
      else if (fw === 'i32' && tw === 'i64') emit(from.unsigned ? 'i64.extend_i32_u' : 'i64.extend_i32_s');
      if (to.size < 4) {
        const fits = from.kind !== 'llong' && ((from.size < to.size && (from.unsigned || !to.unsigned)) || (from.size === to.size && from.unsigned === to.unsigned));
        if (!fits) narrow(to);
      }
    };

    // ------------------------------------------------------------ expressions

    const OPS: Partial<Record<Node['kind'], [string, string?]>> = {
      add: ['add'],
      sub: ['sub'],
      mul: ['mul'],
      div: ['div_s', 'div_u'],
      mod: ['rem_s', 'rem_u'],
      band: ['and'],
      bor: ['or'],
      bxor: ['xor'],
      shl: ['shl'],
      shr: ['shr_s', 'shr_u'],
      eq: ['eq'],
      ne: ['ne'],
      lt: ['lt_s', 'lt_u'],
      le: ['le_s', 'le_u'],
    };
    const FLIP: Record<string, string> = { lt: 'gt', le: 'ge', eq: 'eq', ne: 'ne' };
    const arithOp = (kind: Node['kind'], ty: Type, flipped = false) => {
      const w = wasmType(ty);
      if (isFloat(ty)) {
        const name = { add: 'add', sub: 'sub', mul: 'mul', div: 'div', eq: 'eq', ne: 'ne', lt: 'lt', le: 'le' }[kind as string];
        if (!name) throw new Error(`no float op ${kind}`);
        emit(`${w}.${flipped ? FLIP[name] : name}`);
        return;
      }
      const o = OPS[kind]!;
      let name = ty.unsigned && o[1] ? o[1] : o[0];
      if (flipped) name = name.replace(/^lt/, 'gt').replace(/^le/, 'ge');
      emit(`${w}.${name}`);
    };

    /** Pushes 0 or 1 for a scalar condition. */
    const cond = (n: Node) => {
      // Comparisons and ! already give 0 or 1.
      gen(n);
      if (['eq', 'ne', 'lt', 'le', 'not', 'logand', 'logor'].includes(n.kind)) return;
      at(n, () => convert(n.ty, T.bool));
    };

    const gen = (n: Node, used = true): void =>
      at(n, () => {
        switch (n.kind) {
          case 'num':
            if (!used) return;
            if (n.fval !== undefined) emit(`${wasmType(n.ty)}.const`, n.fval);
            else constOf(n.ty, n.val!);
            return;
          case 'var': {
            const o = n.obj!;
            if (o.isFunction) {
              if (used) emit('i32.const', tableIndex(o));
              return;
            }
            if (isAgg(n.ty)) {
              if (used) fullAddr(n);
              return;
            }
            if (localName.has(o)) {
              if (used) emit('local.get', `$${localName.get(o)}`);
              return;
            }
            const k = addr(n);
            emit(loadOp(n.ty), ...memarg(k));
            if (!used) emit('drop');
            return;
          }
          case 'member':
          case 'deref': {
            if (n.ty.kind === 'func') {
              gen(n.lhs!, used);
              return;
            }
            if (isAgg(n.ty)) {
              fullAddr(n);
              if (!used) emit('drop');
              return;
            }
            if (n.kind === 'member' && n.member!.bitWidth !== undefined) {
              const k = addr(n);
              const b = temp('i32');
              emit('local.set', `$${b}`);
              loadBits(n.member!, () => emit('local.get', `$${b}`), k);
            } else {
              const k = addr(n);
              emit(loadOp(n.ty), ...memarg(k));
            }
            if (!used) emit('drop');
            return;
          }
          case 'addr': {
            const l = n.lhs!;
            if (l.ty.kind === 'func' && l.kind === 'var') {
              if (used) emit('i32.const', tableIndex(l.obj!));
              return;
            }
            fullAddr(l);
            if (!used) emit('drop');
            return;
          }
          case 'cast': {
            const l = n.lhs!;
            if (n.ty.kind === 'void') {
              gen(l, false);
              return;
            }
            gen(l, used);
            if (used) convert(l.ty, n.ty);
            return;
          }
          case 'neg':
            if (isFloat(n.ty)) {
              gen(n.lhs!, used);
              if (used) emit(`${wasmType(n.ty)}.neg`);
              return;
            }
            if (used) constOf(n.ty, 0);
            gen(n.lhs!, used);
            if (used) emit(`${wasmType(n.ty)}.sub`);
            return;
          case 'not':
            cond(n.lhs!);
            emit('i32.eqz');
            if (!used) emit('drop');
            return;
          case 'bitnot':
            gen(n.lhs!, used);
            if (used) {
              constOf(n.ty, -1);
              emit(`${wasmType(n.ty)}.xor`);
            }
            return;
          case 'add':
          case 'sub':
          case 'mul':
          case 'div':
          case 'mod':
          case 'band':
          case 'bor':
          case 'bxor':
          case 'shl':
          case 'shr':
            gen(n.lhs!);
            gen(n.rhs!);
            arithOp(n.kind, n.ty);
            if (!used) emit('drop');
            return;
          case 'eq':
          case 'ne':
          case 'lt':
          case 'le':
            // Built from > or >=: evaluate in source order and compare the other way round.
            if (n.implicit) {
              gen(n.rhs!);
              gen(n.lhs!);
              arithOp(n.kind, n.lhs!.ty, true);
            } else {
              gen(n.lhs!);
              gen(n.rhs!);
              arithOp(n.kind, n.lhs!.ty);
            }
            if (!used) emit('drop');
            return;
          case 'logand':
          case 'logor':
            cond(n.lhs!);
            if (!used) {
              emit('if');
              if (n.kind === 'logand') gen(n.rhs!, false);
              else {
                emit('else');
                gen(n.rhs!, false);
              }
              emit('end');
              return;
            }
            emit('if', '(result i32)');
            if (n.kind === 'logand') {
              cond(n.rhs!);
              emit('else');
              emit('i32.const', 0);
            } else {
              emit('i32.const', 1);
              emit('else');
              cond(n.rhs!);
            }
            emit('end');
            return;
          case 'cond': {
            cond(n.cond!);
            const t = n.ty.kind === 'void' || !used ? '' : `(result ${isAgg(n.ty) ? 'i32' : wasmType(n.ty)})`;
            if (t) emit('if', t);
            else emit('if');
            gen(n.then!, !!t);
            emit('else');
            gen(n.els!, !!t);
            emit('end');
            return;
          }
          case 'comma':
            gen(n.lhs!, false);
            gen(n.rhs!, used);
            return;
          case 'assign':
            return assign(n, used);
          case 'opassign': {
            const p = place(n.lhs!);
            const opTy = n.opTy!;
            store(
              p,
              () => {
                load(p);
                convert(n.lhs!.ty, opTy);
                gen(n.rhs!);
                arithOp(n.op!, opTy);
                convert(opTy, n.lhs!.ty);
              },
              used,
            );
            return;
          }
          case 'postinc': {
            const p = place(n.lhs!);
            const ty = n.ty;
            const w = wasmType(ty);
            let old = '';
            store(
              p,
              () => {
                load(p);
                if (used) {
                  old = temp(w);
                  emit('local.tee', `$${old}`);
                }
                if (isFloat(ty)) emit(`${w}.const`, n.delta!);
                else constOf(ty.kind === 'ptr' ? T.int : ty, n.delta!);
                emit(`${w}.add`);
                if (isInteger(ty)) convert(ty.size < 4 ? T.int : ty, ty);
              },
              false,
            );
            if (used) emit('local.get', `$${old}`);
            return;
          }
          case 'call':
            return call(n, used);
          case 'stmtexpr': {
            const stmts = n.stmts!;
            stmts.forEach((s, i) => {
              if (i === stmts.length - 1 && s.kind === 'exprstmt' && n.ty.kind !== 'void') {
                const e = s.lhs!;
                gen(e, used);
                if (used && (e.ty.kind === 'array' || e.ty.kind === 'func')) return;
              } else stmt(s);
            });
            return;
          }
          case 'memzero': {
            const k = objAddr(n.obj!);
            addOffset(k);
            emit('i32.const', n.obj!.ty.size);
            emit('call', '$rt.zero');
            return;
          }
          case 'vaarg': {
            // ap is a char*: align it, read the value there, step past it.
            const p = place(n.lhs!);
            const ty = n.ty;
            const agg = isAgg(ty);
            const align = agg ? Math.max(4, ty.align) : Math.max(4, ty.size);
            const size = alignTo(ty.size, 4);
            const a = temp('i32');
            load(p);
            if (align > 4) {
              emit('i32.const', align - 1);
              emit('i32.add');
              emit('i32.const', -align);
              emit('i32.and');
            }
            emit('local.tee', `$${a}`);
            emit('i32.const', size);
            emit('i32.add');
            const t = temp('i32');
            emit('local.set', `$${t}`);
            store(p, () => emit('local.get', `$${t}`), false);
            emit('local.get', `$${a}`);
            if (!agg) emit(loadOp(ty));
            if (!used) emit('drop');
            return;
          }
          case 'vastart':
            return;
          default:
            throw errorAt(n.tok, `cannot compile this expression (${n.kind})`);
        }
      });

    const assign = (n: Node, used: boolean) => {
      const l = n.lhs!;
      if (isAgg(l.ty)) {
        // Struct assignment: copy the bytes; the value is the destination.
        const d = temp('i32');
        fullAddr(l);
        emit('local.tee', `$${d}`);
        addOrGen(n.rhs!);
        emit('i32.const', l.ty.size);
        emit('call', '$rt.copy');
        if (used) emit('local.get', `$${d}`);
        return;
      }
      if (l.kind === 'var' && localName.has(l.obj!)) {
        gen(n.rhs!);
        emit(used ? 'local.tee' : 'local.set', `$${localName.get(l.obj!)}`);
        return;
      }
      if (l.kind === 'member' && l.member!.bitWidth !== undefined) {
        store(place(l), () => gen(n.rhs!), used);
        return;
      }
      const k = addr(l);
      gen(n.rhs!);
      let t = '';
      if (used) {
        t = temp(wasmType(l.ty));
        emit('local.tee', `$${t}`);
      }
      emit(storeOp(l.ty), ...memarg(k));
      if (used) emit('local.get', `$${t}`);
    };
    const addOrGen = (n: Node) => (isAgg(n.ty) ? addOffset(addrOrValue(n)) : gen(n));

    const call = (n: Node, used: boolean) => {
      const fty = n.fnTy!;
      const callee = n.lhs!;
      const direct = callee.kind === 'var' && callee.obj!.isFunction ? resolve(callee.obj!) : undefined;
      // The definition's own signature decides what is passed (it may be stricter than a `()` declaration).
      const def = direct && direct.isDefinition ? direct.ty : fty;
      const nParams = def.noProto ? n.args!.length : def.params!.length;
      if (direct && !def.noProto && !def.variadic && n.args!.length !== nParams) {
        throw errorAt(n.tok, `${direct.name} takes ${nParams} argument${nParams === 1 ? '' : 's'} but is called with ${n.args!.length}`);
      }
      const rty = def.ret!;
      const sret = rty.kind === 'struct' || rty.kind === 'union';
      let retSlot = 0;
      if (sret) {
        retSlot = allocFrame(rty.size, rty.align);
        emit('local.get', `$${fp}`);
        addOffset(retSlot);
      }
      const paramTypes: Type[] = [];
      n.args!.forEach((a, i) => {
        if (i >= nParams) return;
        const pty = def.noProto ? a.ty : def.params![i]!;
        paramTypes.push(pty);
        if (pty.kind === 'struct' || pty.kind === 'union') {
          // By value: the callee gets the address of a copy.
          const slot = allocFrame(pty.size, pty.align);
          emit('local.get', `$${fp}`);
          addOffset(slot);
          addOrGen(a);
          emit('i32.const', pty.size);
          emit('call', '$rt.copy');
          emit('local.get', `$${fp}`);
          addOffset(slot);
          return;
        }
        gen(a);
        if (!def.noProto) convert(a.ty, pty);
      });
      if (def.variadic) {
        // The extra arguments go into an area in the caller's frame.
        const extra = n.args!.slice(nParams);
        let size = 0;
        const placed = extra.map((a) => {
          const al = isAgg(a.ty) ? Math.max(4, a.ty.align) : Math.max(4, a.ty.size);
          size = alignTo(size, al);
          const off = size;
          size += alignTo(a.ty.size, 4);
          return off;
        });
        const area = allocFrame(Math.max(size, 4), 8);
        extra.forEach((a, i) => {
          if (isAgg(a.ty)) {
            emit('local.get', `$${fp}`);
            addOffset(area + placed[i]!);
            addOrGen(a);
            emit('i32.const', a.ty.size);
            emit('call', '$rt.copy');
            return;
          }
          emit('local.get', `$${fp}`);
          gen(a);
          emit(storeOp(a.ty), ...memarg(area + placed[i]!));
        });
        emit('local.get', `$${fp}`);
        addOffset(area);
      }
      const intrinsic = callee.kind === 'var' && !callee.obj!.isDefinition ? INTRINSICS[callee.obj!.name] : undefined;
      if (intrinsic && !(direct && direct.isDefinition)) {
        if (intrinsic === 'heap') emit('i32.const', heapStart);
        else if (intrinsic === 'alloca') {
          // Room on the stack, freed when the function returns (the epilogue resets $sp).
          const size = temp('i32');
          const p = temp('i32');
          usesFrame = true;
          emit('local.set', `$${size}`);
          emit('global.get', '$sp');
          emit('local.get', `$${size}`);
          emit('i32.sub');
          emit('i32.const', -16);
          emit('i32.and');
          emit('local.tee', `$${p}`);
          emit('global.set', '$sp');
          emit('local.get', `$${p}`);
        }
        else emit(...(intrinsic.split(' ') as [string, ...string[]]));
      } else if (direct) emit('call', `$${fnName.get(direct)}`);
      else {
        gen(callee.kind === 'deref' && callee.ty.kind === 'func' ? callee.lhs! : callee);
        const sig = sigOf(def.noProto ? { ...def, noProto: false, params: paramTypes } : def);
        emit('call_indirect', sigText(sig));
      }
      if (!used && rty.kind !== 'void') emit('drop');
    };

    // ------------------------------------------------------------ statements

    type Targets = { brk?: string; cont?: string };
    const targets: Targets[] = [];
    const findTarget = (k: 'brk' | 'cont') => {
      for (let i = targets.length - 1; i >= 0; i--) if (targets[i]![k]) return targets[i]![k]!;
      throw new Error(`no ${k} target`);
    };

    const doReturn = (n: Node) => {
      if (n.lhs) {
        const e = n.lhs;
        if (structRet) {
          emit('local.get', `$${retPtr}`);
          addOrGen(e);
          emit('i32.const', ret.size);
          emit('call', '$rt.copy');
          emit('local.get', `$${retPtr}`);
          emit('local.set', `$${rv}`);
        } else if (ret.kind === 'void') gen(e, false);
        else {
          gen(e);
          emit('local.set', `$${rv}`);
        }
      }
      emit('br', '$exit');
    };

    const stmt = (n: Node): void =>
      at(n, () => {
        switch (n.kind) {
          case 'block':
            n.stmts!.forEach(stmt);
            return;
          case 'exprstmt':
            gen(n.lhs!, false);
            return;
          case 'memzero':
            gen(n, false);
            return;
          case 'nop':
            return;
          case 'return':
            doReturn(n);
            return;
          case 'if':
            cond(n.cond!);
            emit('if');
            stmt(n.then!);
            if (n.els) {
              emit('else');
              stmt(n.els);
            }
            emit('end');
            return;
          case 'for': {
            if (n.init) stmt(n.init);
            const brk = label('break');
            const top = label('loop');
            const cont = label('continue');
            emit('block', `$${brk}`);
            emit('loop', `$${top}`);
            if (n.cond) {
              cond(n.cond);
              emit('i32.eqz');
              emit('br_if', `$${brk}`);
            }
            targets.push({ brk, cont });
            emit('block', `$${cont}`);
            stmt(n.body!);
            emit('end');
            targets.pop();
            if (n.inc) gen(n.inc, false);
            emit('br', `$${top}`);
            emit('end');
            emit('end');
            return;
          }
          case 'do': {
            const brk = label('break');
            const top = label('loop');
            const cont = label('continue');
            emit('block', `$${brk}`);
            emit('loop', `$${top}`);
            targets.push({ brk, cont });
            emit('block', `$${cont}`);
            stmt(n.body!);
            emit('end');
            targets.pop();
            cond(n.cond!);
            emit('br_if', `$${top}`);
            emit('end');
            emit('end');
            return;
          }
          case 'switch':
            return switchStmt(n);
          case 'break':
            emit('br', `$${findTarget('brk')}`);
            return;
          case 'continue':
            emit('br', `$${findTarget('cont')}`);
            return;
          case 'case':
          case 'label':
            stmt(n.body!);
            return;
          default:
            throw errorAt(n.tok, `cannot compile this statement (${n.kind})`);
        }
      });

    const switchStmt = (n: Node) => {
      const brk = label('break');
      const sel = temp(wasmType(n.cond!.ty));
      // Group the body into segments, each starting at one or more case labels.
      const segs: { labels: Node[]; stmts: Node[]; name: string }[] = [];
      const top = n.body!.kind === 'block' ? n.body!.stmts! : [n.body!];
      for (let s of top) {
        const labels: Node[] = [];
        while (s.kind === 'case') {
          labels.push(s);
          s = s.body!;
        }
        if (labels.length || !segs.length) segs.push({ labels, stmts: [], name: label('case') });
        segs[segs.length - 1]!.stmts.push(s);
      }
      emit('block', `$${brk}`);
      for (let i = segs.length - 1; i >= 0; i--) emit('block', `$${segs[i]!.name}`);
      gen(n.cond!);
      emit('local.set', `$${sel}`);
      const segOf = (c: Node) => segs.find((s) => s.labels.includes(c))!.name;
      const w = wasmType(n.cond!.ty);
      const cases = n.cases!;
      const vals = cases.map((c) => c.caseVal!);
      const min = vals.length ? vals.reduce((a, b) => (b < a ? b : a)) : 0n;
      const max = vals.length ? vals.reduce((a, b) => (b > a ? b : a)) : 0n;
      const fallback = n.deflt ? segOf(n.deflt) : brk;
      // Dense cases: one br_table jump; otherwise compare one by one.
      if (w === 'i32' && cases.length >= 4 && max - min < BigInt(cases.length * 3)) {
        const span = Number(max - min) + 1;
        const tableTargets: string[] = [];
        for (let i = 0; i < span; i++) {
          const c = cases.find((x) => x.caseVal === min + BigInt(i));
          tableTargets.push(`$${c ? segOf(c) : fallback}`);
        }
        emit('local.get', `$${sel}`);
        if (min !== 0n) {
          constOf(n.cond!.ty, min);
          emit('i32.sub');
        }
        emit('br_table', ...tableTargets, `$${fallback}`);
      } else {
        for (const c of cases) {
          at(c, () => {
            emit('local.get', `$${sel}`);
            constOf(n.cond!.ty, c.caseVal!);
            emit(`${w}.eq`);
            emit('br_if', `$${segOf(c)}`);
          });
        }
        emit('br', `$${fallback}`);
      }
      targets.push({ brk });
      segs.forEach((s, i) => {
        emit('end');
        // Code before the first case label can never run.
        if (i === 0 && s.labels.length === 0) return;
        s.stmts.forEach(stmt);
      });
      targets.pop();
      emit('end');
    };

    // ------------------------------------------------------------ dispatch mode (goto)

    const order: string[] = []; // block names in placement order
    const blockCode = new Map<string, Ins[]>();
    const labelBlock = new Map<string, string>();
    let blockNo = 0;
    const newBlock = () => `b${blockNo++}`;
    const placeBlock = (b: string) => {
      order.push(b);
      const c: Ins[] = [];
      blockCode.set(b, c);
      code = c;
    };
    const jump = (b: string) => {
      emit('i32.const', `@${b}`);
      emit('local.set', `$${pc}`);
      emit('br', '$dispatch');
    };
    const ifJump = (b: string) => {
      emit('if');
      jump(b);
      emit('end');
    };
    const labelOf = (name: string) => {
      let b = labelBlock.get(name);
      if (!b) labelBlock.set(name, (b = newBlock()));
      return b;
    };
    const caseBlocks = new Map<Node, string>();

    const stmtD = (n: Node): void =>
      at(n, () => {
        switch (n.kind) {
          case 'block':
            n.stmts!.forEach(stmtD);
            return;
          case 'if': {
            const els = newBlock();
            const end = newBlock();
            cond(n.cond!);
            emit('i32.eqz');
            ifJump(n.els ? els : end);
            stmtD(n.then!);
            if (n.els) {
              jump(end);
              placeBlock(els);
              stmtD(n.els);
            }
            placeBlock(end);
            return;
          }
          case 'for': {
            if (n.init) stmtD(n.init);
            const top = newBlock();
            const cont = newBlock();
            const brk = newBlock();
            placeBlock(top);
            if (n.cond) {
              cond(n.cond);
              emit('i32.eqz');
              ifJump(brk);
            }
            targets.push({ brk, cont });
            stmtD(n.body!);
            targets.pop();
            placeBlock(cont);
            if (n.inc) gen(n.inc, false);
            jump(top);
            placeBlock(brk);
            return;
          }
          case 'do': {
            const top = newBlock();
            const cont = newBlock();
            const brk = newBlock();
            placeBlock(top);
            targets.push({ brk, cont });
            stmtD(n.body!);
            targets.pop();
            placeBlock(cont);
            cond(n.cond!);
            ifJump(top);
            placeBlock(brk);
            return;
          }
          case 'switch': {
            const brk = newBlock();
            const sel = temp(wasmType(n.cond!.ty));
            const w = wasmType(n.cond!.ty);
            gen(n.cond!);
            emit('local.set', `$${sel}`);
            for (const c of n.cases!) {
              const b = newBlock();
              caseBlocks.set(c, b);
              at(c, () => {
                emit('local.get', `$${sel}`);
                constOf(n.cond!.ty, c.caseVal!);
                emit(`${w}.eq`);
                ifJump(b);
              });
            }
            if (n.deflt) caseBlocks.set(n.deflt, newBlock());
            jump(n.deflt ? caseBlocks.get(n.deflt)! : brk);
            targets.push({ brk });
            stmtD(n.body!);
            targets.pop();
            placeBlock(brk);
            return;
          }
          case 'case':
            placeBlock(caseBlocks.get(n)!);
            stmtD(n.body!);
            return;
          case 'label':
            placeBlock(labelOf(n.label!));
            stmtD(n.body!);
            return;
          case 'goto':
            jump(labelOf(n.label!));
            return;
          case 'break':
            jump(findTarget('brk'));
            return;
          case 'continue':
            jump(findTarget('cont'));
            return;
          default:
            stmt(n);
        }
      });

    // ------------------------------------------------------------ the function

    if (f.needsDispatch) {
      placeBlock(newBlock());
      stmtD(f.body!);
      code = body;
    } else {
      code = [];
      stmt(f.body!);
    }
    const bodyCode = code;
    code = body;
    cur = undefined;
    // Prologue: make the frame, copy address-taken parameters into it.
    if (usesFrame) {
      frameSize = alignTo(frameSize, 16);
      locals.unshift({ name: fp, type: 'i32' });
      emit('global.get', '$sp');
      emit('i32.const', frameSize);
      emit('i32.sub');
      emit('local.tee', `$${fp}`);
      emit('global.set', '$sp');
      if (f.name !== '__stack_overflow') {
        emit('local.get', `$${fp}`);
        emit('i32.const', stackBottom + STACK_SLACK);
        emit('i32.lt_u');
        emit('if');
        emit('call', `$${fnName.get(overflow)}`);
        emit('end');
      }
      for (const p of f.params!) {
        if (!p.inMemory || p.ty.kind === 'struct' || p.ty.kind === 'union') continue;
        emit('local.get', `$${fp}`);
        emit('local.get', `$${paramLocal.get(p)}`);
        emit(storeOp(p.ty), ...memarg(frameOffset.get(p)!));
      }
      if (f.vaArea?.inMemory) {
        emit('local.get', `$${fp}`);
        emit('local.get', `$${paramLocal.get(f.vaArea)}`);
        emit('i32.store', ...memarg(frameOffset.get(f.vaArea)!));
      }
    }
    emit('block', '$exit');
    if (f.needsDispatch) {
      emit('loop', '$dispatch');
      for (let i = order.length - 1; i >= 0; i--) emit('block', `$${order[i]}`);
      emit('local.get', `$${pc}`);
      emit('br_table', ...order.map((b) => `$${b}`), `$${order[order.length - 1]}`);
      const pos = new Map(order.map((b, i) => [b, i] as const));
      for (const b of order) {
        emit('end');
        for (const ins of blockCode.get(b)!) {
          if (ins.op === 'i32.const' && typeof ins.imm?.[0] === 'string' && ins.imm[0].startsWith('@')) {
            const target = pos.get(ins.imm[0].slice(1));
            if (target === undefined) throw errorAt(f.tok, `internal error: block ${ins.imm[0]} was never placed`);
            ins.imm = [target];
          }
          body.push(ins);
        }
      }
      emit('end');
    } else body.push(...bodyCode);
    emit('end');
    if (usesFrame) {
      emit('local.get', `$${fp}`);
      emit('i32.const', frameSize);
      emit('i32.add');
      emit('global.set', '$sp');
    }
    if (rv) emit('local.get', `$${rv}`);

    return { def: { name: fnName.get(f)!, params, results: ret.kind === 'void' ? [] : [wasmType(ret)], locals, body } };
  }
}

/** Functions the C library declares but WebAssembly or the host provides. */
const INTRINSICS: Record<string, string> = {
  __host_write: 'call $c.write',
  __host_exit: 'call $c.exit',
  __wasm_memory_grow: 'memory.grow',
  __wasm_memory_size: 'memory.size',
  __wasm_heap_start: 'heap',
  __wasm_f64_sqrt: 'f64.sqrt',
  __wasm_f64_floor: 'f64.floor',
  __wasm_f64_ceil: 'f64.ceil',
  __wasm_f64_trunc: 'f64.trunc',
  __wasm_f32_sqrt: 'f32.sqrt',
  __builtin_alloca: 'alloca',
  alloca: 'alloca',
};

export class LinkError extends Error {
  constructor(
    message: string,
    public tok?: Token,
  ) {
    super(message);
  }
}

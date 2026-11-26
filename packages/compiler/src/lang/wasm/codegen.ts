// Pane syntax tree → a WebAssembly 1.0 module. Mirrors compiler.ts (the bytecode
// compiler) statement for statement, so the two back ends agree on scoping and
// evaluation order; values and their rules live in runtime.ts.

import type { Expr, FnDecl, Node, Program, Stmt } from '../ast';
import { customBytes, encode, type FuncDef, type GlobalDef, type Ins, type ModuleDef } from './encode';
import { FN, HOST_IMPORTS, NIL, STATIC_BASE, STR, StringTable, UNSET, numberBits, runtimeFuncs, FALSE, TRUE } from './runtime';

export interface WasmFunction {
  /** Index in the module's function index space. */
  index: number;
  name: string;
  /** "pane" for code compiled from the program, "runtime" for the library. */
  kind: 'pane' | 'runtime';
  body: Ins[];
  params: string[];
}

export interface WasmOutput {
  bytes: Uint8Array;
  functions: WasmFunction[];
  /** Memory the host must provide, in 64 KiB pages. */
  memoryPages: { min: number; max: number };
  /** The module's static strings by address. */
  strings: Map<number, string>;
}

const OPS: Record<string, string> = {
  '+': 'rt.add',
  '-': 'rt.subtract',
  '*': 'rt.multiply',
  '/': 'rt.divide',
  '%': 'rt.remainder',
  '==': 'rt.eq',
  '!=': 'rt.ne',
  '<': 'rt.lt',
  '<=': 'rt.le',
  '>': 'rt.gt',
  '>=': 'rt.ge',
};

const MAX_PAGES = 256; // 16 MiB is plenty for a Pane program's strings.

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
      // A surrogate pair is one 4-byte character; its second half shares the offset.
      bytes += 4;
      out[++i] = bytes - 4;
    } else bytes += 3;
  }
  out[text.length] = bytes;
  return out;
}

const sigFor = (arity: number) => `${Array(arity).fill('i64').join(',')}>i64`;

/** Compiles a program that already compiled cleanly to bytecode (so scoping errors are ruled out). */
export function compileToWasm(program: Program, source: string): WasmOutput {
  const strings = new StringTable(STATIC_BASE);
  const S = (t: string) => strings.ptr(t);

  // Every top-level function, in order. Names may repeat in Pane (a later `fn` replaces the global).
  const fnDecls = program.body.filter((s): s is FnDecl => s.type === 'Fn');
  const used = new Set<string>();
  const wasmName = new Map<FnDecl, string>();
  const entry = fnDecls.some((f) => f.name === 'main') ? 'pane.main' : 'main';
  used.add(entry);
  for (const f of fnDecls) {
    let n = f.name;
    for (let i = 2; used.has(n); i++) n = `${f.name}#${i}`;
    used.add(n);
    wasmName.set(f, n);
  }
  const namesTable = strings.reserve(fnDecls.length);
  fnDecls.forEach((f, i) => strings.writeWord(namesTable + 4 * i, S(f.name)));
  const fnValue = (f: FnDecl) => FN | (BigInt(f.params.length) << 32n) | BigInt(fnDecls.indexOf(f));

  // Globals: one per name the top level reads, writes or declares.
  const globals = new Map<string, GlobalDef>();
  const globalOf = (name: string) => {
    let g = globals.get(name);
    if (!g) {
      g = { name: `g.${name}`, type: 'i64', mutable: true, init: UNSET };
      globals.set(name, g);
    }
    return g.name;
  };

  const funcs: FuncDef[] = [];

  /** Generates one function body: the program's top level or a Pane function. */
  const generate = (name: string, params: string[], body: Stmt[], isFunction: boolean): FuncDef => {
    const out: Ins[] = [];
    const locals: { name: string; type: 'i64' }[] = [];
    const scopes: { name: string; wasm: string; depth: number }[] = params.map((p) => ({ name: p, wasm: p, depth: 1 }));
    let depth = isFunction ? 1 : 0;
    let temps = 0;
    const local = (base: string) => {
      const n = `${base}${locals.some((l) => l.name === base) || params.includes(base) ? `#${locals.length}` : ''}`;
      locals.push({ name: n, type: 'i64' });
      return n;
    };
    const temp = () => local(`tmp.${temps++}`);
    const emit = (node: Node, op: string, ...imm: (number | bigint | string)[]) => {
      out.push({ op, ...(imm.length ? { imm } : {}), node: node.id, offset: node.span.start });
    };
    const resolve = (n: string) => {
      for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i]!.name === n) return scopes[i]!.wasm;
      return undefined;
    };

    const notDefined = (n: string) => S(`"${n}" has not been defined. Declare it first with "let ${n} = ...;".`);
    const cantAssign = (n: string) => S(`Can't assign to "${n}": it has not been declared. Use "let ${n} = ...;" first.`);

    function expr(e: Expr): void {
      switch (e.type) {
        case 'Literal':
          if (e.value === null) emit(e, 'i64.const', NIL);
          else if (e.value === true) emit(e, 'i64.const', TRUE);
          else if (e.value === false) emit(e, 'i64.const', FALSE);
          else if (typeof e.value === 'number') emit(e, 'i64.const', numberBits(e.value));
          else emit(e, 'i64.const', STR | BigInt(S(e.value)));
          return;
        case 'Variable': {
          const l = resolve(e.name);
          if (l) emit(e, 'local.get', `$${l}`);
          else {
            emit(e, 'global.get', `$${globalOf(e.name)}`);
            emit(e, 'i32.const', notDefined(e.name));
            emit(e, 'call', '$rt.check_defined');
          }
          return;
        }
        case 'Assign': {
          expr(e.value);
          const l = resolve(e.name);
          if (l) {
            emit(e, 'local.tee', `$${l}`);
            return;
          }
          const t = temp();
          const g = `$${globalOf(e.name)}`;
          emit(e, 'local.set', `$${t}`);
          emit(e, 'global.get', g);
          emit(e, 'i32.const', cantAssign(e.name));
          emit(e, 'call', '$rt.check_defined');
          emit(e, 'drop');
          emit(e, 'local.get', `$${t}`);
          emit(e, 'global.set', g);
          emit(e, 'local.get', `$${t}`);
          return;
        }
        case 'Group':
          expr(e.expr);
          return;
        case 'Unary':
          expr(e.operand);
          emit(e, 'call', e.op === '-' ? '$rt.negate' : '$rt.not');
          return;
        case 'Binary':
          expr(e.left);
          expr(e.right);
          emit(e, 'call', `$${OPS[e.op]!}`);
          return;
        case 'Logical': {
          const t = temp();
          expr(e.left);
          emit(e, 'local.tee', `$${t}`);
          emit(e, 'call', '$rt.truthy');
          emit(e, 'if', '(result', 'i64)');
          if (e.op === 'and') {
            expr(e.right);
            emit(e, 'else');
            emit(e, 'local.get', `$${t}`);
          } else {
            emit(e, 'local.get', `$${t}`);
            emit(e, 'else');
            expr(e.right);
          }
          emit(e, 'end');
          return;
        }
        case 'Call': {
          const callee = temp();
          expr(e.callee);
          emit(e, 'local.set', `$${callee}`);
          for (const a of e.args) expr(a);
          emit(e, 'local.get', `$${callee}`);
          emit(e, 'i32.const', e.args.length);
          emit(e, 'call', '$rt.call_target');
          emit(e, 'call_indirect', sigFor(e.args.length));
          emit(e, 'global.get', '$depth');
          emit(e, 'i32.const', 1);
          emit(e, 'i32.sub');
          emit(e, 'global.set', '$depth');
          return;
        }
      }
    }

    function stmt(s: Stmt): void {
      switch (s.type) {
        case 'Print':
          expr(s.expr);
          emit(s, 'call', '$rt.print');
          return;
        case 'ExprStmt':
          expr(s.expr);
          emit(s, 'drop');
          return;
        case 'Let':
          expr(s.init);
          if (depth === 0) emit(s, 'global.set', `$${globalOf(s.name)}`);
          else {
            const l = local(s.name);
            emit(s, 'local.set', `$${l}`);
            scopes.push({ name: s.name, wasm: l, depth });
          }
          return;
        case 'Block':
          depth++;
          for (const x of s.body) stmt(x);
          depth--;
          while (scopes.length > 0 && scopes[scopes.length - 1]!.depth > depth) scopes.pop();
          return;
        case 'If':
          expr(s.cond);
          emit(s, 'call', '$rt.truthy');
          emit(s, 'if');
          stmt(s.then);
          if (s.otherwise) {
            emit(s, 'else');
            stmt(s.otherwise);
          }
          emit(s, 'end');
          return;
        case 'While':
          emit(s, 'block', '$exit');
          emit(s, 'loop', '$again');
          expr(s.cond);
          emit(s, 'call', '$rt.truthy');
          emit(s, 'i32.eqz');
          emit(s, 'br_if', '$exit');
          stmt(s.body);
          emit(s, 'br', '$again');
          emit(s, 'end');
          emit(s, 'end');
          return;
        case 'Fn':
          emit(s, 'i64.const', fnValue(s));
          emit(s, 'global.set', `$${globalOf(s.name)}`);
          return;
        case 'Return':
          if (s.value) expr(s.value);
          else emit(s, 'i64.const', NIL);
          emit(s, 'return');
          return;
      }
    }

    for (const s of body) stmt(s);
    if (isFunction) {
      // Falling off the end returns nil.
      const last = body[body.length - 1];
      const at = last ?? program;
      out.push({ op: 'i64.const', imm: [NIL], node: at.id, offset: at.span.end });
    }
    return {
      name,
      params: params.map((p) => ({ name: p, type: 'i64' as const })),
      results: isFunction ? ['i64'] : [],
      locals,
      body: out,
    };
  };

  funcs.push(generate(entry, [], program.body, false));
  for (const f of fnDecls) funcs.push(generate(wasmName.get(f)!, f.params, f.body.body, true));
  const paneCount = funcs.length;

  const runtime = runtimeFuncs(S, namesTable);
  const heapStart = (strings.end + 7) & ~7;
  const pages = Math.max(1, Math.ceil((heapStart + 1) / 65536));

  const def: ModuleDef = {
    importFuncs: HOST_IMPORTS,
    importMemory: { module: 'pane', name: 'memory', min: pages, max: MAX_PAGES },
    funcs: [...funcs, ...runtime],
    globals: [
      { name: 'heap', type: 'i32', mutable: true, init: heapStart },
      { name: 'depth', type: 'i32', mutable: true, init: 1 },
      ...globals.values(),
    ],
    table: fnDecls.map((f) => wasmName.get(f)!),
    exports: [{ name: 'main', func: entry }],
    data: [{ offset: STATIC_BASE, bytes: strings.bytes() }],
    customs: [
      { name: 'glass.source', bytes: customBytes((b) => (b.str('pane'), b.str(source))) },
      {
        // Names for the globals (the 1.0 name section has none): Pane's own names for its variables.
        name: 'glass.globals',
        bytes: customBytes((b) => {
          const all = ['heap', 'depth', ...[...globals.keys()]];
          b.u32(all.length);
          all.forEach((n, i) => (b.u32(i), b.str(i < 2 ? `rt.${n}` : n)));
        }),
      },
      {
        name: 'glass.map',
        bytes: customBytes((b) => {
          b.u32(paneCount);
          // Source positions as UTF-8 byte offsets (Pane spans count UTF-16 code units).
          const byteAt = utf8Offsets(source);
          funcs.slice(0, paneCount).forEach((f, i) => {
            b.u32(HOST_IMPORTS.length + i);
            // One entry per instruction, the closing `end` included; offsets are stored plus one.
            b.u32(f.body.length + 1);
            for (const ins of f.body) b.u32(ins.offset === undefined ? 0 : byteAt[ins.offset]! + 1);
            b.u32(0);
          });
        }),
      },
    ],
  };
  const { bytes, funcIndex } = encode(def);
  const functions: WasmFunction[] = def.funcs.map((f, i) => ({
    index: funcIndex.get(f.name)!,
    name: f.name,
    kind: i < paneCount ? 'pane' : 'runtime',
    body: f.body,
    params: f.params.map((p) => p.name),
  }));
  return { bytes, functions, memoryPages: { min: pages, max: MAX_PAGES }, strings: strings.entries() };
}

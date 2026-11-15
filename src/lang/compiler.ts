import type { Block, Expr, FnDecl, Node, Program, Stmt } from './ast';
import type { Chunk, CompiledProgram, Instr, Op, Value } from './bytecode';
import type { Diagnostic } from './errors';

export interface CompileResult {
  program: CompiledProgram;
  errors: Diagnostic[];
}

interface LocalVar {
  name: string;
  depth: number;
  slot: number;
  from: number;
}

interface Ctx {
  chunk: Chunk;
  locals: LocalVar[];
  depth: number;
  isFunction: boolean;
}

const BINARY_OPS: Record<string, Op> = {
  '+': 'ADD',
  '-': 'SUB',
  '*': 'MUL',
  '/': 'DIV',
  '%': 'MOD',
  '==': 'EQ',
  '!=': 'NE',
  '<': 'LT',
  '<=': 'LE',
  '>': 'GT',
  '>=': 'GE',
};

/** Compile a syntax tree to bytecode: one chunk for the top level ("main") and one per function. */
export function compile(program: Program): CompileResult {
  const chunks: Chunk[] = [];
  const errors: Diagnostic[] = [];

  const newChunk = (name: string, nodeId: number, params: string[]): Chunk => {
    const chunk: Chunk = { index: chunks.length, name, nodeId, arity: params.length, params, code: [], constants: [], locals: [] };
    chunks.push(chunk);
    return chunk;
  };

  let ctx: Ctx = { chunk: newChunk('main', program.id, []), locals: [], depth: 0, isFunction: false };

  const error = (message: string, node: Node) => errors.push({ stage: 'compiler', message, span: node.span, nodeId: node.id });

  const emit = (op: Op, node: Node, arg?: number | string): number => {
    const instr: Instr = { op, nodeId: node.id, span: node.span };
    if (arg !== undefined) instr.arg = arg;
    ctx.chunk.code.push(instr);
    return ctx.chunk.code.length - 1;
  };
  const here = () => ctx.chunk.code.length;
  const patch = (addr: number) => {
    ctx.chunk.code[addr]!.arg = here();
  };
  const constant = (value: Value): number => {
    const existing = ctx.chunk.constants.findIndex((c) => c === value);
    if (existing >= 0) return existing;
    ctx.chunk.constants.push(value);
    return ctx.chunk.constants.length - 1;
  };

  const beginScope = () => {
    ctx.depth++;
  };
  const endScope = (node: Node) => {
    ctx.depth--;
    while (ctx.locals.length > 0 && ctx.locals[ctx.locals.length - 1]!.depth > ctx.depth) {
      const local = ctx.locals.pop()!;
      emit('POP', node);
      ctx.chunk.locals.push({ name: local.name, slot: local.slot, from: local.from, to: here() - 1 });
    }
  };

  const resolveLocal = (name: string): LocalVar | undefined => {
    for (let i = ctx.locals.length - 1; i >= 0; i--) {
      if (ctx.locals[i]!.name === name) return ctx.locals[i];
    }
    return undefined;
  };

  // ---------- statements ----------

  function statement(stmt: Stmt): void {
    switch (stmt.type) {
      case 'Print':
        expression(stmt.expr);
        emit('PRINT', stmt);
        return;
      case 'ExprStmt':
        expression(stmt.expr);
        emit('POP', stmt);
        return;
      case 'Let': {
        expression(stmt.init);
        if (ctx.depth === 0) {
          emit('DEF_GLOBAL', stmt, stmt.name);
          return;
        }
        if (ctx.locals.some((l) => l.depth === ctx.depth && l.name === stmt.name)) {
          error(`"${stmt.name}" is already declared in this block. Use "${stmt.name} = ..." to change it.`, stmt);
        }
        ctx.locals.push({ name: stmt.name, depth: ctx.depth, slot: ctx.locals.length, from: here() });
        return;
      }
      case 'Block':
        beginScope();
        for (const s of stmt.body) statement(s);
        endScope(stmt);
        return;
      case 'If': {
        expression(stmt.cond);
        const toElse = emit('JUMP_IF_FALSE', stmt, -1);
        statement(stmt.then);
        if (stmt.otherwise) {
          const toEnd = emit('JUMP', stmt, -1);
          patch(toElse);
          statement(stmt.otherwise);
          patch(toEnd);
        } else {
          patch(toElse);
        }
        return;
      }
      case 'While': {
        const start = here();
        expression(stmt.cond);
        const exit = emit('JUMP_IF_FALSE', stmt, -1);
        statement(stmt.body);
        emit('LOOP', stmt, start);
        patch(exit);
        return;
      }
      case 'Fn':
        fnDecl(stmt);
        return;
      case 'Return':
        if (!ctx.isFunction) {
          error('"return" can only be used inside a function.', stmt);
          return;
        }
        if (stmt.value) expression(stmt.value);
        else emit('NIL', stmt);
        emit('RETURN', stmt);
        return;
    }
  }

  function fnDecl(fn: FnDecl): void {
    if (ctx.isFunction || ctx.depth > 0) {
      error('Functions can only be declared at the top level of the program (Pane has no closures).', fn);
      return;
    }
    const outer = ctx;
    const chunk = newChunk(fn.name, fn.id, fn.params);
    ctx = {
      chunk,
      locals: fn.params.map((name, slot) => ({ name, depth: 1, slot, from: 0 })),
      depth: 1,
      isFunction: true,
    };
    body(fn.body);
    emit('NIL', fn.body);
    emit('RETURN', fn.body);
    for (const local of ctx.locals) chunk.locals.push({ name: local.name, slot: local.slot, from: local.from, to: here() - 1 });
    chunk.locals.sort((a, b) => a.slot - b.slot || a.from - b.from);
    ctx = outer;
    emit('CONST', fn, constant({ kind: 'function', name: fn.name, arity: fn.params.length, chunk: chunk.index }));
    emit('DEF_GLOBAL', fn, fn.name);
  }

  /** A function body shares its scope with the parameters. */
  function body(block: Block) {
    for (const s of block.body) statement(s);
  }

  // ---------- expressions ----------

  function expression(expr: Expr): void {
    switch (expr.type) {
      case 'Literal':
        if (expr.value === null) emit('NIL', expr);
        else if (expr.value === true) emit('TRUE', expr);
        else if (expr.value === false) emit('FALSE', expr);
        else emit('CONST', expr, constant(expr.value));
        return;
      case 'Variable': {
        const local = resolveLocal(expr.name);
        if (local) emit('GET_LOCAL', expr, local.slot);
        else emit('GET_GLOBAL', expr, expr.name);
        return;
      }
      case 'Assign': {
        expression(expr.value);
        const local = resolveLocal(expr.name);
        if (local) emit('SET_LOCAL', expr, local.slot);
        else emit('SET_GLOBAL', expr, expr.name);
        return;
      }
      case 'Group':
        expression(expr.expr);
        return;
      case 'Unary':
        expression(expr.operand);
        emit(expr.op === '-' ? 'NEG' : 'NOT', expr);
        return;
      case 'Binary':
        expression(expr.left);
        expression(expr.right);
        emit(BINARY_OPS[expr.op]!, expr);
        return;
      case 'Logical': {
        expression(expr.left);
        emit('DUP', expr);
        const skip = emit(expr.op === 'and' ? 'JUMP_IF_FALSE' : 'JUMP_IF_TRUE', expr, -1);
        emit('POP', expr);
        expression(expr.right);
        patch(skip);
        return;
      }
      case 'Call':
        expression(expr.callee);
        for (const a of expr.args) expression(a);
        emit('CALL', expr, expr.args.length);
        return;
    }
  }

  for (const s of program.body) statement(s);
  emit('HALT', program);
  chunks[0]!.locals.sort((a, b) => a.slot - b.slot || a.from - b.from);

  return { program: { chunks }, errors };
}

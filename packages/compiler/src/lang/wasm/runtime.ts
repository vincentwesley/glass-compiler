// The runtime library compiled into every Pane module: how Pane values live in
// WebAssembly, and the operations on them. It mirrors the bytecode VM in vm.ts
// rule for rule, including its error messages, so a program behaves the same in
// both. Written as text-format lines (see asm in encode.ts) and visible, like the
// rest of the module, in the Glass Wasm debugger.
//
// Every Pane value is one i64 ("NaN boxing"):
//   number   its f64 bits (NaN results are made canonical, so they never look boxed)
//   nil      0xFFF9 << 48         false  0xFFFA << 48         true 0xFFFB << 48
//   string   0xFFFC << 48 | ptr   (ptr → [len: i32][UTF-8 bytes] in linear memory)
//   function 0xFFFD << 48 | arity << 32 | table index
//   (unset)  0xFFFE << 48         a global that hasn't been declared yet

import { asm, type FuncDef, type ImportFunc, type ValType } from './encode';

export const NIL = 0xfff9n << 48n;
export const FALSE = 0xfffan << 48n;
export const TRUE = 0xfffbn << 48n;
export const STR = 0xfffcn << 48n;
export const FN = 0xfffdn << 48n;
export const UNSET = 0xfffen << 48n;
export const BOXED = 0xfff9n << 48n;
export const CANONICAL_NAN = 0x7ff8n << 48n;
export const MAX_FRAMES = 64;

/** Where number text is written by the host (32 bytes), then static strings, then the heap. */
export const NUMBER_BUF = 16;
export const STATIC_BASE = 64;

export const numberBits = (n: number) => {
  if (Number.isNaN(n)) return CANONICAL_NAN;
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, n);
  return dv.getBigUint64(0);
};

/** Static strings laid out in the data segment: [len][bytes], 4-byte aligned. */
export class StringTable {
  private at = new Map<string, number>();
  private chunks: Uint8Array[] = [];
  private size = 0;

  constructor(private base: number) {}

  /** The address of a static string (added on first use). */
  ptr(text: string): number {
    const existing = this.at.get(text);
    if (existing !== undefined) return existing;
    const bytes = new TextEncoder().encode(text);
    const addr = this.base + this.size;
    const record = new Uint8Array(4 + bytes.length + ((4 - ((4 + bytes.length) % 4)) % 4));
    new DataView(record.buffer).setUint32(0, bytes.length, true);
    record.set(bytes, 4);
    this.chunks.push(record);
    this.size += record.length;
    this.at.set(text, addr);
    return addr;
  }

  /** Every static string by address (for showing constants). */
  entries(): Map<number, string> {
    return new Map([...this.at].map(([text, addr]) => [addr, text] as const));
  }

  /** Reserves `words` 32-bit slots (for the function-name table). */
  reserve(words: number): number {
    const addr = this.base + this.size;
    const record = new Uint8Array(words * 4);
    this.chunks.push(record);
    this.size += record.length;
    return addr;
  }

  writeWord(addr: number, value: number) {
    let offset = this.base;
    for (const c of this.chunks) {
      if (addr >= offset && addr < offset + c.length) {
        new DataView(c.buffer).setUint32(addr - offset, value, true);
        return;
      }
      offset += c.length;
    }
    throw new Error('StringTable.writeWord: address outside the table');
  }

  bytes(): Uint8Array {
    const out = new Uint8Array(this.size);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }

  get end() {
    return this.base + this.size;
  }
}

export const HOST_IMPORTS: ImportFunc[] = [
  { module: 'pane', name: 'print', as: 'host.print', params: ['i32', 'i32'], results: [] },
  { module: 'pane', name: 'error', as: 'host.error', params: ['i32', 'i32'], results: [] },
  { module: 'pane', name: 'format_number', as: 'host.format_number', params: ['f64', 'i32'], results: ['i32'] },
  { module: 'pane', name: 'rem', as: 'host.rem', params: ['f64', 'f64'], results: ['f64'] },
];

type P = [string, ValType];
const fn = (name: string, params: P[], results: ValType[], locals: P[], body: string): FuncDef => ({
  name,
  params: params.map(([n, type]) => ({ name: n, type })),
  results,
  locals: locals.map(([n, type]) => ({ name: n, type })),
  body: asm(body),
});

/** The runtime functions, given the static string table and the function-name table's address. */
export function runtimeFuncs(S: (text: string) => number, namesTable: number): FuncDef[] {
  const v: P = ['v', 'i64'];
  const a: P = ['a', 'i64'];
  const b: P = ['b', 'i64'];
  // A two-operand failure: "<pre><describe a><mid><describe b><post>".
  const failPair = (pre: string, mid: string, post: string) => `
    i32.const ${S(pre)}
    local.get $a
    i32.const ${S(mid)}
    local.get $b
    i32.const ${S(post)}
    call $rt.fail_pair`;
  const numbers = (verb: string) => `
    local.get $a
    local.get $b
    call $rt.both_numbers
    i32.eqz
    if
      ${failPair(`Can't ${verb} `, ' and ', ': both must be numbers.')}
    end`;
  const f64s = `
    local.get $a
    f64.reinterpret_i64
    local.get $b
    f64.reinterpret_i64`;
  const compare = (name: string, symbol: string, numOp: string, strTest: string) =>
    fn(name, [a, b], ['i64'], [], `
      local.get $a
      local.get $b
      call $rt.both_numbers
      if
        ${f64s}
        ${numOp}
        call $rt.bool
        return
      end
      local.get $a
      call $rt.is_string
      local.get $b
      call $rt.is_string
      i32.and
      if
        local.get $a
        i32.wrap_i64
        local.get $b
        i32.wrap_i64
        call $rt.string_order
        i32.const 0
        ${strTest}
        call $rt.bool
        return
      end
      ${failPair("Can't compare ", ` ${symbol} `, ': both must be numbers or both strings.')}
      unreachable`);

  return [
    // ---------------- values
    fn('rt.is_number', [v], ['i32'], [], `
      local.get $v
      i64.const ${BOXED}
      i64.lt_u`),
    fn('rt.is_string', [v], ['i32'], [], `
      local.get $v
      i64.const 48
      i64.shr_u
      i64.const ${STR >> 48n}
      i64.eq`),
    fn('rt.is_function', [v], ['i32'], [], `
      local.get $v
      i64.const 48
      i64.shr_u
      i64.const ${FN >> 48n}
      i64.eq`),
    fn('rt.both_numbers', [a, b], ['i32'], [], `
      local.get $a
      call $rt.is_number
      local.get $b
      call $rt.is_number
      i32.and`),
    fn('rt.number', [['x', 'f64']], ['i64'], [], `
      local.get $x
      local.get $x
      f64.ne
      if (result i64)
        i64.const ${CANONICAL_NAN}
      else
        local.get $x
        i64.reinterpret_f64
      end`),
    fn('rt.bool', [['c', 'i32']], ['i64'], [], `
      local.get $c
      if (result i64)
        i64.const ${TRUE}
      else
        i64.const ${FALSE}
      end`),
    fn('rt.truthy', [v], ['i32'], [], `
      local.get $v
      i64.const ${NIL}
      i64.ne
      local.get $v
      i64.const ${FALSE}
      i64.ne
      i32.and`),
    fn('rt.string_value', [['s', 'i32']], ['i64'], [], `
      local.get $s
      i64.extend_i32_u
      i64.const ${STR}
      i64.or`),

    // ---------------- memory and strings
    fn('rt.alloc', [['n', 'i32']], ['i32'], [['p', 'i32'], ['top', 'i32']], `
      global.get $heap
      local.set $p
      local.get $p
      local.get $n
      i32.const 3
      i32.add
      i32.const -4
      i32.and
      i32.add
      local.set $top
      block $fits
        loop $grow
          local.get $top
          memory.size
          i32.const 16
          i32.shl
          i32.le_u
          br_if $fits
          i32.const 1
          memory.grow
          i32.const -1
          i32.eq
          if
            i32.const ${S('Out of memory: the program made too many strings.')}
            call $rt.fail
          end
          br $grow
        end
      end
      local.get $top
      global.set $heap
      local.get $p`),
    fn('rt.new_string', [['len', 'i32']], ['i32'], [['p', 'i32']], `
      local.get $len
      i32.const 4
      i32.add
      call $rt.alloc
      local.tee $p
      local.get $len
      i32.store
      local.get $p`),
    fn('rt.copy', [['dst', 'i32'], ['src', 'i32'], ['n', 'i32']], [], [], `
      block $done
        loop $next
          local.get $n
          i32.eqz
          br_if $done
          local.get $dst
          local.get $src
          i32.load8_u
          i32.store8
          local.get $dst
          i32.const 1
          i32.add
          local.set $dst
          local.get $src
          i32.const 1
          i32.add
          local.set $src
          local.get $n
          i32.const 1
          i32.sub
          local.set $n
          br $next
        end
      end`),
    fn('rt.concat', [['x', 'i32'], ['y', 'i32']], ['i32'], [['lx', 'i32'], ['ly', 'i32'], ['p', 'i32']], `
      local.get $x
      i32.load
      local.set $lx
      local.get $y
      i32.load
      local.set $ly
      local.get $lx
      local.get $ly
      i32.add
      call $rt.new_string
      local.set $p
      local.get $p
      i32.const 4
      i32.add
      local.get $x
      i32.const 4
      i32.add
      local.get $lx
      call $rt.copy
      local.get $p
      i32.const 4
      i32.add
      local.get $lx
      i32.add
      local.get $y
      i32.const 4
      i32.add
      local.get $ly
      call $rt.copy
      local.get $p`),
    fn('rt.string_equal', [['x', 'i32'], ['y', 'i32']], ['i32'], [['n', 'i32'], ['i', 'i32']], `
      local.get $x
      i32.load
      local.tee $n
      local.get $y
      i32.load
      i32.ne
      if
        i32.const 0
        return
      end
      block $done
        loop $next
          local.get $i
          local.get $n
          i32.ge_u
          br_if $done
          local.get $x
          local.get $i
          i32.add
          i32.load8_u offset=4
          local.get $y
          local.get $i
          i32.add
          i32.load8_u offset=4
          i32.ne
          if
            i32.const 0
            return
          end
          local.get $i
          i32.const 1
          i32.add
          local.set $i
          br $next
        end
      end
      i32.const 1`),
    // Byte order of UTF-8 is code-point order (see DECISIONS S16).
    fn('rt.string_order', [['x', 'i32'], ['y', 'i32']], ['i32'], [['lx', 'i32'], ['ly', 'i32'], ['i', 'i32'], ['cx', 'i32'], ['cy', 'i32']], `
      local.get $x
      i32.load
      local.set $lx
      local.get $y
      i32.load
      local.set $ly
      block $done
        loop $next
          local.get $i
          local.get $lx
          i32.ge_u
          local.get $i
          local.get $ly
          i32.ge_u
          i32.or
          br_if $done
          local.get $x
          local.get $i
          i32.add
          i32.load8_u offset=4
          local.set $cx
          local.get $y
          local.get $i
          i32.add
          i32.load8_u offset=4
          local.set $cy
          local.get $cx
          local.get $cy
          i32.ne
          if
            local.get $cx
            local.get $cy
            i32.sub
            return
          end
          local.get $i
          i32.const 1
          i32.add
          local.set $i
          br $next
        end
      end
      local.get $lx
      local.get $ly
      i32.sub`),

    // ---------------- text for values
    fn('rt.number_text', [['x', 'f64']], ['i32'], [['n', 'i32'], ['p', 'i32']], `
      local.get $x
      i32.const ${NUMBER_BUF}
      call $host.format_number
      local.tee $n
      call $rt.new_string
      local.set $p
      local.get $p
      i32.const 4
      i32.add
      i32.const ${NUMBER_BUF}
      local.get $n
      call $rt.copy
      local.get $p`),
    fn('rt.function_name', [v], ['i32'], [], `
      local.get $v
      i32.wrap_i64
      i32.const 4
      i32.mul
      i32.load offset=${namesTable}`),
    fn('rt.text', [v], ['i32'], [], `
      local.get $v
      call $rt.is_number
      if
        local.get $v
        f64.reinterpret_i64
        call $rt.number_text
        return
      end
      local.get $v
      call $rt.is_string
      if
        local.get $v
        i32.wrap_i64
        return
      end
      local.get $v
      call $rt.is_function
      if
        i32.const ${S('<fn ')}
        local.get $v
        call $rt.function_name
        call $rt.concat
        i32.const ${S('>')}
        call $rt.concat
        return
      end
      local.get $v
      i64.const ${NIL}
      i64.eq
      if
        i32.const ${S('nil')}
        return
      end
      local.get $v
      i64.const ${TRUE}
      i64.eq
      if (result i32)
        i32.const ${S('true')}
      else
        i32.const ${S('false')}
      end`),
    fn('rt.hex_digit', [['d', 'i32']], ['i32'], [], `
      local.get $d
      i32.const 10
      i32.lt_u
      if (result i32)
        local.get $d
        i32.const 48
        i32.add
      else
        local.get $d
        i32.const 87
        i32.add
      end`),
    // JSON.stringify's short escapes: \\b \\t \\n \\f \\r (0 when the byte has none).
    fn('rt.short_escape', [['c', 'i32']], ['i32'], [], `
      local.get $c
      i32.const 8
      i32.eq
      if
        i32.const 98
        return
      end
      local.get $c
      i32.const 9
      i32.eq
      if
        i32.const 116
        return
      end
      local.get $c
      i32.const 10
      i32.eq
      if
        i32.const 110
        return
      end
      local.get $c
      i32.const 12
      i32.eq
      if
        i32.const 102
        return
      end
      local.get $c
      i32.const 13
      i32.eq
      if
        i32.const 114
        return
      end
      i32.const 0`),
    fn('rt.escaped_length', [['c', 'i32']], ['i32'], [], `
      local.get $c
      i32.const 34
      i32.eq
      local.get $c
      i32.const 92
      i32.eq
      i32.or
      if
        i32.const 2
        return
      end
      local.get $c
      i32.const 32
      i32.lt_u
      if (result i32)
        local.get $c
        call $rt.short_escape
        if (result i32)
          i32.const 2
        else
          i32.const 6
        end
      else
        i32.const 1
      end`),
    fn('rt.write_escaped', [['o', 'i32'], ['c', 'i32']], ['i32'], [['e', 'i32']], `
      local.get $c
      i32.const 34
      i32.eq
      local.get $c
      i32.const 92
      i32.eq
      i32.or
      if
        local.get $o
        i32.const 92
        i32.store8
        local.get $o
        local.get $c
        i32.store8 offset=1
        local.get $o
        i32.const 2
        i32.add
        return
      end
      local.get $c
      i32.const 32
      i32.lt_u
      if
        local.get $c
        call $rt.short_escape
        local.tee $e
        if
          local.get $o
          i32.const 92
          i32.store8
          local.get $o
          local.get $e
          i32.store8 offset=1
          local.get $o
          i32.const 2
          i32.add
          return
        end
        local.get $o
        i32.const 92
        i32.store8
        local.get $o
        i32.const 117
        i32.store8 offset=1
        local.get $o
        i32.const 48
        i32.store8 offset=2
        local.get $o
        i32.const 48
        i32.store8 offset=3
        local.get $o
        local.get $c
        i32.const 4
        i32.shr_u
        call $rt.hex_digit
        i32.store8 offset=4
        local.get $o
        local.get $c
        i32.const 15
        i32.and
        call $rt.hex_digit
        i32.store8 offset=5
        local.get $o
        i32.const 6
        i32.add
        return
      end
      local.get $o
      local.get $c
      i32.store8
      local.get $o
      i32.const 1
      i32.add`),
    // A string in double quotes, escaped exactly as JSON.stringify does (the VM's error messages use it).
    fn('rt.quote', [['s', 'i32']], ['i32'], [['n', 'i32'], ['i', 'i32'], ['len', 'i32'], ['p', 'i32'], ['o', 'i32']], `
      local.get $s
      i32.load
      local.set $n
      i32.const 2
      local.set $len
      block $counted
        loop $count
          local.get $i
          local.get $n
          i32.ge_u
          br_if $counted
          local.get $len
          local.get $s
          local.get $i
          i32.add
          i32.load8_u offset=4
          call $rt.escaped_length
          i32.add
          local.set $len
          local.get $i
          i32.const 1
          i32.add
          local.set $i
          br $count
        end
      end
      local.get $len
      call $rt.new_string
      local.tee $p
      i32.const 34
      i32.store8 offset=4
      local.get $p
      i32.const 5
      i32.add
      local.set $o
      i32.const 0
      local.set $i
      block $written
        loop $write
          local.get $i
          local.get $n
          i32.ge_u
          br_if $written
          local.get $o
          local.get $s
          local.get $i
          i32.add
          i32.load8_u offset=4
          call $rt.write_escaped
          local.set $o
          local.get $i
          i32.const 1
          i32.add
          local.set $i
          br $write
        end
      end
      local.get $o
      i32.const 34
      i32.store8
      local.get $p`),
    // "a number (1)", "a string (\\"hi\\")", "nil (nil)", "<fn f>": how the VM describes values in errors.
    fn('rt.describe', [v], ['i32'], [], `
      local.get $v
      call $rt.is_function
      if
        local.get $v
        call $rt.text
        return
      end
      local.get $v
      call $rt.is_number
      if (result i32)
        i32.const ${S('a number')}
      else
        local.get $v
        call $rt.is_string
        if (result i32)
          i32.const ${S('a string')}
        else
          local.get $v
          i64.const ${NIL}
          i64.eq
          if (result i32)
            i32.const ${S('nil')}
          else
            i32.const ${S('a boolean')}
          end
        end
      end
      i32.const ${S(' (')}
      call $rt.concat
      local.get $v
      call $rt.is_string
      if (result i32)
        local.get $v
        i32.wrap_i64
        call $rt.quote
      else
        local.get $v
        call $rt.text
      end
      call $rt.concat
      i32.const ${S(')')}
      call $rt.concat`),

    // ---------------- errors
    fn('rt.fail', [['s', 'i32']], [], [], `
      local.get $s
      i32.const 4
      i32.add
      local.get $s
      i32.load
      call $host.error
      unreachable`),
    fn('rt.fail_pair', [['pre', 'i32'], a, ['mid', 'i32'], b, ['post', 'i32']], [], [], `
      local.get $pre
      local.get $a
      call $rt.describe
      call $rt.concat
      local.get $mid
      call $rt.concat
      local.get $b
      call $rt.describe
      call $rt.concat
      local.get $post
      call $rt.concat
      call $rt.fail`),

    // ---------------- operators
    fn('rt.add', [a, b], ['i64'], [], `
      local.get $a
      local.get $b
      call $rt.both_numbers
      if
        ${f64s}
        f64.add
        call $rt.number
        return
      end
      local.get $a
      call $rt.is_string
      local.get $b
      call $rt.is_string
      i32.or
      if
        local.get $a
        call $rt.text
        local.get $b
        call $rt.text
        call $rt.concat
        call $rt.string_value
        return
      end
      ${failPair("Can't add ", ' and ', '.')}
      unreachable`),
    fn('rt.subtract', [a, b], ['i64'], [], `${numbers('subtract')}
      ${f64s}
      f64.sub
      call $rt.number`),
    fn('rt.multiply', [a, b], ['i64'], [], `${numbers('multiply')}
      ${f64s}
      f64.mul
      call $rt.number`),
    fn('rt.divide', [a, b], ['i64'], [], `${numbers('divide')}
      local.get $b
      f64.reinterpret_i64
      f64.const 0
      f64.eq
      if
        i32.const ${S('Division by zero.')}
        call $rt.fail
      end
      ${f64s}
      f64.div
      call $rt.number`),
    fn('rt.remainder', [a, b], ['i64'], [], `${numbers('take the remainder of')}
      local.get $b
      f64.reinterpret_i64
      f64.const 0
      f64.eq
      if
        i32.const ${S('Remainder of division by zero.')}
        call $rt.fail
      end
      ${f64s}
      call $host.rem
      call $rt.number`),
    fn('rt.negate', [v], ['i64'], [], `
      local.get $v
      call $rt.is_number
      if
        local.get $v
        f64.reinterpret_i64
        f64.neg
        call $rt.number
        return
      end
      i32.const ${S("Can't negate ")}
      local.get $v
      call $rt.describe
      call $rt.concat
      i32.const ${S(': it must be a number.')}
      call $rt.concat
      call $rt.fail
      unreachable`),
    fn('rt.not', [v], ['i64'], [], `
      local.get $v
      call $rt.truthy
      i32.eqz
      call $rt.bool`),
    fn('rt.equal', [a, b], ['i32'], [], `
      local.get $a
      local.get $b
      call $rt.both_numbers
      if
        ${f64s}
        f64.eq
        return
      end
      local.get $a
      call $rt.is_string
      local.get $b
      call $rt.is_string
      i32.and
      if
        local.get $a
        i32.wrap_i64
        local.get $b
        i32.wrap_i64
        call $rt.string_equal
        return
      end
      local.get $a
      local.get $b
      i64.eq`),
    fn('rt.eq', [a, b], ['i64'], [], `
      local.get $a
      local.get $b
      call $rt.equal
      call $rt.bool`),
    fn('rt.ne', [a, b], ['i64'], [], `
      local.get $a
      local.get $b
      call $rt.equal
      i32.eqz
      call $rt.bool`),
    compare('rt.lt', '<', 'f64.lt', 'i32.lt_s'),
    compare('rt.le', '<=', 'f64.le', 'i32.le_s'),
    compare('rt.gt', '>', 'f64.gt', 'i32.gt_s'),
    compare('rt.ge', '>=', 'f64.ge', 'i32.ge_s'),

    // ---------------- variables, calls, print
    fn('rt.check_defined', [v, ['message', 'i32']], ['i64'], [], `
      local.get $v
      i64.const ${UNSET}
      i64.eq
      if
        local.get $message
        call $rt.fail
      end
      local.get $v`),
    // Checks a call can happen and returns the table index to call through.
    fn('rt.call_target', [['f', 'i64'], ['argc', 'i32']], ['i32'], [['arity', 'i32']], `
      local.get $f
      call $rt.is_function
      i32.eqz
      if
        i32.const ${S("Can't call ")}
        local.get $f
        call $rt.describe
        call $rt.concat
        i32.const ${S(': only functions can be called.')}
        call $rt.concat
        call $rt.fail
      end
      local.get $f
      i64.const 32
      i64.shr_u
      i32.wrap_i64
      i32.const 255
      i32.and
      local.tee $arity
      local.get $argc
      i32.ne
      if
        local.get $f
        call $rt.function_name
        i32.const ${S('() expects ')}
        call $rt.concat
        local.get $arity
        f64.convert_i32_u
        call $rt.number_text
        call $rt.concat
        i32.const ${S(' argument')}
        call $rt.concat
        local.get $arity
        i32.const 1
        i32.ne
        if (result i32)
          i32.const ${S('s')}
        else
          i32.const ${S('')}
        end
        call $rt.concat
        i32.const ${S(' but got ')}
        call $rt.concat
        local.get $argc
        f64.convert_i32_u
        call $rt.number_text
        call $rt.concat
        i32.const ${S('.')}
        call $rt.concat
        call $rt.fail
      end
      global.get $depth
      i32.const ${MAX_FRAMES}
      i32.ge_u
      if
        i32.const ${S(`Too many nested calls (more than ${MAX_FRAMES}). Does a function call itself forever?`)}
        call $rt.fail
      end
      global.get $depth
      i32.const 1
      i32.add
      global.set $depth
      local.get $f
      i32.wrap_i64`),
    fn('rt.print', [v], [], [['s', 'i32']], `
      local.get $v
      call $rt.text
      local.tee $s
      i32.const 4
      i32.add
      local.get $s
      i32.load
      call $host.print`),
  ];
}

// Built-in WebAssembly modules for the debugger. Each one runs an export with
// default arguments; `expect` is checked by the unit tests (a known answer).

export interface Example {
  id: string;
  title: string;
  blurb: string;
  source: string;
  run: { export: string; args: string[] };
  expect: { results?: string[]; trap?: string; output?: string[]; memory?: { at: number; text: string } };
}

export const EXAMPLES: Example[] = [
  {
    id: 'factorial',
    title: 'Factorial',
    blurb: 'Recursion: every call pushes a new frame with its own $n. Watch the frames stack up, then unwind.',
    source: `(module
  ;; n! computed recursively, with 64-bit integers
  (func $fac (export "fac") (param $n i64) (result i64)
    (if (result i64) (i64.eqz (local.get $n))
      (then (i64.const 1))
      (else
        (i64.mul
          (local.get $n)
          (call $fac (i64.sub (local.get $n) (i64.const 1))))))))
`,
    run: { export: 'fac', args: ['5'] },
    expect: { results: ['120'] },
  },
  {
    id: 'loop',
    title: 'Sum with a loop',
    blurb: 'A block and a loop: br_if leaves the block when the count reaches zero, br jumps back to the top of the loop.',
    source: `(module
  ;; 1 + 2 + ... + n
  (func (export "sum") (param $n i32) (result i32)
    (local $total i32)
    (block $done
      (loop $again
        (br_if $done (i32.eqz (local.get $n)))
        (local.set $total (i32.add (local.get $total) (local.get $n)))
        (local.set $n (i32.sub (local.get $n) (i32.const 1)))
        (br $again)))
    (local.get $total)))
`,
    run: { export: 'sum', args: ['10'] },
    expect: { results: ['55'] },
  },
  {
    id: 'memory',
    title: 'Reverse a word in memory',
    blurb: 'Linear memory: a data segment puts "glass" at address 16, then loads and stores swap the bytes in place.',
    source: `(module
  (memory (export "memory") 1)
  (data (i32.const 16) "glass")
  ;; Reverses len bytes starting at start, in place.
  (func (export "reverse") (param $start i32) (param $len i32)
    (local $end i32)
    (local $tmp i32)
    (local.set $end (i32.sub (i32.add (local.get $start) (local.get $len)) (i32.const 1)))
    (block $done
      (loop $swap
        (br_if $done (i32.ge_u (local.get $start) (local.get $end)))
        (local.set $tmp (i32.load8_u (local.get $start)))
        (i32.store8 (local.get $start) (i32.load8_u (local.get $end)))
        (i32.store8 (local.get $end) (local.get $tmp))
        (local.set $start (i32.add (local.get $start) (i32.const 1)))
        (local.set $end (i32.sub (local.get $end) (i32.const 1)))
        (br $swap)))))
`,
    run: { export: 'reverse', args: ['16', '5'] },
    expect: { results: [], memory: { at: 16, text: 'ssalg' } },
  },
  {
    id: 'print',
    title: 'Print squares',
    blurb: 'Calling the host: print_i32 is imported from "spectest", the host module every spec test can use. Its lines appear in Output.',
    source: `(module
  (import "spectest" "print_i32" (func $print (param i32)))
  (func (export "squares") (param $n i32)
    (local $i i32)
    (loop $next
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (call $print (i32.mul (local.get $i) (local.get $i)))
      (br_if $next (i32.lt_u (local.get $i) (local.get $n))))))
`,
    run: { export: 'squares', args: ['5'] },
    expect: { results: [], output: ['i32:1', 'i32:4', 'i32:9', 'i32:16', 'i32:25'] },
  },
  {
    id: 'switch',
    title: 'Jump table',
    blurb: 'br_table picks a branch by number: one instruction, many exits. Out-of-range values take the last (default) label.',
    source: `(module
  ;; 0 = sunday ... 6 = saturday; returns 1 on weekends, 0 on weekdays, -1 otherwise
  (func (export "weekend") (param $day i32) (result i32)
    (block $other
      (block $weekday
        (block $weekend
          (br_table $weekend $weekday $weekday $weekday $weekday $weekday $weekend $other
            (local.get $day)))
        (return (i32.const 1)))
      (return (i32.const 0)))
    (i32.const -1)))
`,
    run: { export: 'weekend', args: ['6'] },
    expect: { results: ['1'] },
  },
  {
    id: 'trap',
    title: 'A trap',
    blurb: 'Dividing by zero traps: the machine stops where it is, with the stack and frames left on show.',
    source: `(module
  (func $average (param $total i32) (param $count i32) (result i32)
    (i32.div_s (local.get $total) (local.get $count)))
  (func (export "average") (param $total i32) (param $count i32) (result i32)
    (call $average (local.get $total) (local.get $count))))
`,
    run: { export: 'average', args: ['10', '0'] },
    expect: { trap: 'integer divide by zero' },
  },
];

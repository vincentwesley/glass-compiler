// One-line explanations of instructions for the code panel and lineage bar.

const FAMILY: [RegExp, string][] = [
  [/^(i32|i64|f32|f64)\.const/, 'Pushes a constant onto the value stack.'],
  [/^local\.get/, 'Pushes the value of a local (or parameter) of the current frame.'],
  [/^local\.set/, 'Pops a value and stores it in a local.'],
  [/^local\.tee/, 'Stores the top of the stack in a local and leaves it on the stack.'],
  [/^global\.get/, 'Pushes the value of a global.'],
  [/^global\.set/, 'Pops a value into a mutable global.'],
  [/^block/, 'Opens a block. A branch to it jumps forwards, to its end.'],
  [/^loop/, 'Opens a loop. A branch to it jumps backwards, to its start.'],
  [/^if/, 'Pops a condition: non-zero runs the then-branch, zero runs the else-branch.'],
  [/^else/, 'End of the then-branch: skip the else-branch.'],
  [/^end/, 'Closes the innermost block, loop, if or the function.'],
  [/^br_table/, 'Pops an index and branches to that label, or to the last one when out of range.'],
  [/^br_if/, 'Pops a condition and branches to a label if it is non-zero.'],
  [/^br /, 'Branches to an enclosing label: forwards out of a block, backwards to a loop.'],
  [/^return/, 'Leaves the function, keeping its results.'],
  [/^call_indirect/, 'Pops a table index and calls the function stored there, checking its type.'],
  [/^call/, 'Calls a function: pops its arguments, pushes a new frame.'],
  [/^drop/, 'Pops a value and throws it away.'],
  [/^select/, 'Pops a condition and two values, and keeps the first if the condition is non-zero.'],
  [/\.load/, 'Pops an address and pushes the value read from linear memory there.'],
  [/\.store/, 'Pops a value and an address and writes the value to linear memory.'],
  [/^memory\.size/, 'Pushes the memory size in 64 KiB pages.'],
  [/^memory\.grow/, 'Pops a number of pages to add; pushes the old size, or -1 if memory can not grow.'],
  [/^unreachable/, 'Traps immediately.'],
  [/^nop/, 'Does nothing.'],
  [/\.(eqz|eq|ne|lt|gt|le|ge)/, 'Compares and pushes 1 (true) or 0 (false).'],
  [/\.(add|sub|mul|div|rem)/, 'Pops two numbers and pushes the result of the arithmetic.'],
  [/\.(and|or|xor|shl|shr|rot)/, 'Pops two integers and pushes the bitwise result.'],
  [/\.(wrap|extend|trunc_|convert|demote|promote|reinterpret)/, 'Converts the top of the stack to another type.'],
];

export function instrHelp(text: string): string {
  for (const [re, help] of FAMILY) if (re.test(text)) return help;
  return 'A numeric instruction: pops its operands and pushes the result.';
}

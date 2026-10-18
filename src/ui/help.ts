import type { Node } from '../lang';

/** One-sentence explanations of what each kind of tree node means and how it compiles. */
export function nodeHelp(node: Node): string {
  switch (node.type) {
    case 'Program':
      return 'The whole program. It ends with HALT, which stops the machine.';
    case 'Literal':
      return 'A value written directly in the code. It compiles to one instruction that pushes it.';
    case 'Variable':
      return 'Reading a variable: a local comes from a stack slot, a global from the globals table.';
    case 'Assign':
      return 'Assignment. The value is computed first, then stored; the value stays on the stack.';
    case 'Unary':
      return node.op === '-' ? 'Negation: compute the operand, then NEG flips its sign.' : '"not": compute the operand, then NOT flips its truthiness.';
    case 'Binary':
      return 'Both sides are compiled first (left, then right), then one instruction combines them. That is why the tree shape decides the order of operations.';
    case 'Logical':
      return node.op === 'and'
        ? '"and" short-circuits: if the left side is false or nil, the right side is jumped over.'
        : '"or" short-circuits: if the left side is truthy, the right side is jumped over.';
    case 'Call':
      return 'A call pushes the function, then each argument, then CALL starts a new frame.';
    case 'Group':
      return 'Brackets only change the shape of the tree. They compile to no instructions at all.';
    case 'Let':
      return 'A new variable. At the top level it becomes a global; inside a block it lives in a stack slot.';
    case 'Print':
      return 'Compute a value, then PRINT pops it and writes it to the output.';
    case 'ExprStmt':
      return 'An expression used as a statement. Its leftover value is thrown away with POP.';
    case 'Block':
      return 'A block opens a new scope. Locals declared inside are popped when it ends.';
    case 'If':
      return 'The condition is tested by JUMP_IF_FALSE, which skips the "then" block when it is false.';
    case 'While':
      return 'The condition is tested on every lap; LOOP jumps back to re-test it.';
    case 'Fn':
      return 'A function is compiled into its own chunk of bytecode, then stored in a global by name.';
    case 'Return':
      return 'RETURN hands a value back to the caller and removes this call frame.';
  }
}

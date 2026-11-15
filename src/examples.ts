export interface Example {
  id: string;
  title: string;
  blurb: string;
  source: string;
  /** What the program prints, checked by the unit tests. */
  expected: string[];
}

export const EXAMPLES: readonly Example[] = [
  {
    id: 'precedence',
    title: 'Precedence',
    blurb: 'Why 1 + 2 * 3 is 7: watch the tree nest * deeper than +.',
    source: `# Multiplication binds tighter than addition,
# so the parser builds 1 + (2 * 3).
print 1 + 2 * 3;

# Brackets change the shape of the tree,
# but they never become bytecode themselves.
print (1 + 2) * 3;

# Subtraction groups to the left: (10 - 4) - 3.
print 10 - 4 - 3;
`,
    expected: ['7', '9', '3'],
  },
  {
    id: 'variables',
    title: 'Variables & if',
    blurb: 'Globals, a block-scoped local and an if / else chain.',
    source: `let temperature = 18;
let feeling = "";

if temperature > 25 {
  feeling = "hot";
} else if temperature > 15 {
  # "spare" lives in a stack slot, not a global.
  let spare = temperature - 15;
  feeling = "mild, " + spare + " degrees above cool";
} else {
  feeling = "cold";
}

print feeling;
`,
    expected: ['mild, 3 degrees above cool'],
  },
  {
    id: 'countdown',
    title: 'Countdown loop',
    blurb: 'A while loop: see LOOP jump backwards in the bytecode.',
    source: `let n = 5;
while n > 0 {
  print n;
  n = n - 1;
}
print "lift off!";
`,
    expected: ['5', '4', '3', '2', '1', 'lift off!'],
  },
  {
    id: 'fizzbuzz',
    title: 'FizzBuzz',
    blurb: 'Remainders, and / or, and nested ifs.',
    source: `let i = 1;
while i <= 15 {
  let fizz = i % 3 == 0;
  let buzz = i % 5 == 0;
  if fizz and buzz {
    print "FizzBuzz";
  } else if fizz {
    print "Fizz";
  } else if buzz {
    print "Buzz";
  } else {
    print i;
  }
  i = i + 1;
}
`,
    expected: ['1', '2', 'Fizz', '4', 'Buzz', 'Fizz', '7', '8', 'Fizz', 'Buzz', '11', 'Fizz', '13', '14', 'FizzBuzz'],
  },
  {
    id: 'fibonacci',
    title: 'Fibonacci',
    blurb: 'Recursion: each call pushes a new frame onto the VM.',
    source: `fn fib(n) {
  if n < 2 {
    return n;
  }
  return fib(n - 1) + fib(n - 2);
}

let i = 0;
while i < 8 {
  print "fib(" + i + ") = " + fib(i);
  i = i + 1;
}
`,
    expected: ['fib(0) = 0', 'fib(1) = 1', 'fib(2) = 1', 'fib(3) = 2', 'fib(4) = 3', 'fib(5) = 5', 'fib(6) = 8', 'fib(7) = 13'],
  },
];

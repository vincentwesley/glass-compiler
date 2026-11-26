// Built-in example programs. Each has the exact output it must print; the unit
// tests run every one on Node's WebAssembly and on Glass Wasm.

export interface Example {
  id: string;
  title: string;
  blurb: string;
  source: string;
  expected: string;
}

export const EXAMPLES: Example[] = [
  {
    id: 'hello',
    title: 'Hello, C',
    blurb: 'printf is written in C too: it is compiled with your program and talks to the host through one write call.',
    source: `#include <stdio.h>

int main(void) {
  printf("Hello from Small C!\\n");
  for (int i = 1; i <= 3; i++)
    printf("%d squared is %d\\n", i, i * i);
  return 0;
}
`,
    expected: 'Hello from Small C!\n1 squared is 1\n2 squared is 4\n3 squared is 9\n',
  },
  {
    id: 'fib',
    title: 'Recursion',
    blurb: 'n stays in a WebAssembly local (its address is never taken), so each call is one Wasm call with no stack frame in memory.',
    source: `#include <stdio.h>

int fib(int n) {
  if (n < 2) return n;
  return fib(n - 1) + fib(n - 2);
}

int main(void) {
  for (int n = 0; n <= 10; n++)
    printf("%d ", fib(n));
  printf("\\n");
  return 0;
}
`,
    expected: '0 1 1 2 3 5 8 13 21 34 55 \n',
  },
  {
    id: 'list',
    title: 'Structs and malloc',
    blurb: 'A linked list on the heap. Struct members become loads and stores at fixed offsets; malloc grows linear memory with memory.grow.',
    source: `#include <stdio.h>
#include <stdlib.h>

struct node {
  int value;
  struct node *next;
};

struct node *push(struct node *head, int value) {
  struct node *n = malloc(sizeof *n);
  n->value = value;
  n->next = head;
  return n;
}

int main(void) {
  struct node *list = 0;
  for (int i = 1; i <= 5; i++) list = push(list, i * 10);
  int sum = 0;
  for (struct node *p = list; p; p = p->next) {
    printf("%d -> ", p->value);
    sum += p->value;
  }
  printf("end (sum %d)\\n", sum);
  return 0;
}
`,
    expected: '50 -> 40 -> 30 -> 20 -> 10 -> end (sum 150)\n',
  },
  {
    id: 'strings',
    title: 'Strings and pointers',
    blurb: 'A char array lives in the stack frame in linear memory; the pointers walk it byte by byte (i32.load8_s and i32.store8).',
    source: `#include <stdio.h>
#include <string.h>

void reverse(char *s) {
  char *end = s + strlen(s) - 1;
  while (s < end) {
    char t = *s;
    *s++ = *end;
    *end-- = t;
  }
}

int main(void) {
  char word[] = "glass";
  reverse(word);
  printf("%s has %d letters\\n", word, (int)strlen(word));
  return 0;
}
`,
    expected: 'ssalg has 5 letters\n',
  },
  {
    id: 'floats',
    title: 'Exact printf',
    blurb: "printf's %f, %e and %g expand the double's exact binary value into decimal digits, then round half to even, as glibc does.",
    source: `#include <stdio.h>

int main(void) {
  double third = 1.0 / 3;
  printf("%f %.10f\\n", third, 0.1);
  printf("%e %g %g\\n", 6.02214076e23, 0.0001, 123456789.0);
  printf("%.0f %.0f %.0f\\n", 0.5, 1.5, 2.5);
  printf("%.20f\\n", 0.1);
  return 0;
}
`,
    expected: '0.333333 0.1000000000\n6.022141e+23 0.0001 1.23457e+08\n0 2 2\n0.10000000000000000555\n',
  },
  {
    id: 'duff',
    title: "Duff's device (goto)",
    blurb: "Case labels inside a loop can't be structured WebAssembly, so this function becomes numbered blocks under one loop that jumps with br_table.",
    source: `#include <stdio.h>

void copy(char *to, const char *from, int count) {
  int n = (count + 3) / 4;
  switch (count % 4) {
  case 0: do { *to++ = *from++;
  case 3:      *to++ = *from++;
  case 2:      *to++ = *from++;
  case 1:      *to++ = *from++;
          } while (--n > 0);
  }
}

int main(void) {
  char out[16] = {0};
  copy(out, "see-through", 11);
  printf("%s\\n", out);
  return 0;
}
`,
    expected: 'see-through\n',
  },
  {
    id: 'qsort',
    title: 'Function pointers',
    blurb: 'A function pointer is an index into the module\'s table; calling through it is call_indirect, checked against the signature.',
    source: `#include <stdio.h>
#include <stdlib.h>

int ascending(const void *a, const void *b) {
  return *(const int *)a - *(const int *)b;
}

int main(void) {
  int xs[] = { 42, 7, 19, 3, 88, 1 };
  int n = sizeof xs / sizeof xs[0];
  qsort(xs, n, sizeof xs[0], ascending);
  for (int i = 0; i < n; i++) printf("%d%c", xs[i], i + 1 < n ? ' ' : '\\n');
  return 0;
}
`,
    expected: '1 3 7 19 42 88\n',
  },
];

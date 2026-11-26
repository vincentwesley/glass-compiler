// Small C's C library, written in C and compiled by Small C with every program
// (only the functions a program reaches are kept). It talks to the outside world
// through two host imports, `c.write` and `c.exit` (DECISIONS S19). printf's
// floating-point output is exact: the double's binary value is expanded to all
// of its decimal digits with big-number arithmetic, then rounded half to even,
// as glibc does.

export const LIBC_SOURCE = String.raw`
#include <stddef.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <errno.h>

/* Provided by the host and by WebAssembly itself (see codegen.ts). */
int __host_write(int fd, const void *p, int n);
void __host_exit(int code);
int __wasm_memory_grow(int pages);
int __wasm_memory_size(void);
char *__wasm_heap_start(void);

int errno;

/* A file: the standard streams (fd 0 to 2) go to the host; anything opened with
   fopen is a file in memory that lasts until the program ends. */
struct __memfile { char name[64]; char *data; size_t len, cap; };
struct __FILE { int fd; int error; struct __memfile *mem; size_t pos; int write; int eof; };
static struct __FILE __stdin = { 0, 0, 0, 0, 0, 0 };
static struct __FILE __stdout = { 1, 0, 0, 0, 1, 0 };
static struct __FILE __stderr = { 2, 0, 0, 0, 1, 0 };
FILE *stdin = &__stdin;
FILE *stdout = &__stdout;
FILE *stderr = &__stderr;

/* ------------------------------------------------------------ process */

static void (*__atexit_fns[32])(void);
static int __atexit_count;

int atexit(void (*f)(void)) {
  if (__atexit_count == 32) return -1;
  __atexit_fns[__atexit_count++] = f;
  return 0;
}

void exit(int code) {
  while (__atexit_count > 0) __atexit_fns[--__atexit_count]();
  __host_exit(code);
}

void abort(void) {
  fputs("Aborted\n", stderr);
  __host_exit(134);
}

void __stack_overflow(void) {
  __host_write(2, "stack overflow\n", 15);
  __host_exit(139);
}

void __assert_fail(const char *expr, const char *file, int line, const char *func) {
  fprintf(stderr, "%s:%d: %s: Assertion '%s' failed.\n", file, line, func, expr);
  abort();
}

/* ------------------------------------------------------------ memory */

/* A first-fit free list. Each block has a header with its size; the heap grows
   with memory.grow. */
struct __block { size_t size; struct __block *next; };
static struct __block *__free_list;
static char *__brk;
static char *__brk_end;

static void *__sbrk(size_t n) {
  if (!__brk) {
    __brk = __wasm_heap_start();
    __brk_end = (char *)(__wasm_memory_size() * 65536);
  }
  while ((size_t)(__brk_end - __brk) < n) {
    size_t pages = (n - (size_t)(__brk_end - __brk) + 65535) / 65536;
    if (__wasm_memory_grow((int)pages) < 0) return 0;
    __brk_end += pages * 65536;
  }
  char *p = __brk;
  __brk += n;
  return p;
}

void *malloc(size_t n) {
  if (n == 0) n = 1;
  n = (n + 7) & ~(size_t)7;
  struct __block **pp = &__free_list;
  while (*pp) {
    struct __block *b = *pp;
    if (b->size >= n) {
      *pp = b->next;
      return (char *)b + 8;
    }
    pp = &b->next;
  }
  struct __block *b = __sbrk(n + 8);
  if (!b) { errno = ENOMEM; return 0; }
  b->size = n;
  return (char *)b + 8;
}

void free(void *p) {
  if (!p) return;
  struct __block *b = (struct __block *)((char *)p - 8);
  b->next = __free_list;
  __free_list = b;
}

void *calloc(size_t n, size_t size) {
  size_t total = n * size;
  if (size && total / size != n) return 0;
  void *p = malloc(total);
  if (p) memset(p, 0, total);
  return p;
}

void *realloc(void *p, size_t n) {
  if (!p) return malloc(n);
  struct __block *b = (struct __block *)((char *)p - 8);
  if (b->size >= n) return p;
  void *q = malloc(n);
  if (q) { memcpy(q, p, b->size); free(p); }
  return q;
}

/* ------------------------------------------------------------ strings */

void *memcpy(void *dst, const void *src, size_t n) {
  char *d = dst; const char *s = src;
  while (n--) *d++ = *s++;
  return dst;
}
void *memmove(void *dst, const void *src, size_t n) {
  char *d = dst; const char *s = src;
  if (d < s) while (n--) *d++ = *s++;
  else { d += n; s += n; while (n--) *--d = *--s; }
  return dst;
}
void *memset(void *p, int c, size_t n) {
  unsigned char *d = p;
  while (n--) *d++ = (unsigned char)c;
  return p;
}
int memcmp(const void *a, const void *b, size_t n) {
  const unsigned char *x = a, *y = b;
  for (; n; n--, x++, y++) if (*x != *y) return *x - *y;
  return 0;
}
void *memchr(const void *p, int c, size_t n) {
  const unsigned char *s = p;
  for (; n; n--, s++) if (*s == (unsigned char)c) return (void *)s;
  return 0;
}
size_t strlen(const char *s) { const char *p = s; while (*p) p++; return p - s; }
char *strcpy(char *dst, const char *src) { char *d = dst; while ((*d++ = *src++)) ; return dst; }
char *strncpy(char *dst, const char *src, size_t n) {
  size_t i = 0;
  for (; i < n && src[i]; i++) dst[i] = src[i];
  for (; i < n; i++) dst[i] = 0;
  return dst;
}
char *strcat(char *dst, const char *src) { strcpy(dst + strlen(dst), src); return dst; }
char *strncat(char *dst, const char *src, size_t n) {
  char *d = dst + strlen(dst);
  while (n-- && *src) *d++ = *src++;
  *d = 0;
  return dst;
}
int strcmp(const char *a, const char *b) {
  while (*a && *a == *b) a++, b++;
  return (unsigned char)*a - (unsigned char)*b;
}
int strncmp(const char *a, const char *b, size_t n) {
  for (; n; n--, a++, b++) {
    if (*a != *b) return (unsigned char)*a - (unsigned char)*b;
    if (!*a) return 0;
  }
  return 0;
}
char *strchr(const char *s, int c) {
  for (;; s++) { if (*s == (char)c) return (char *)s; if (!*s) return 0; }
}
char *strrchr(const char *s, int c) {
  const char *r = 0;
  for (;; s++) { if (*s == (char)c) r = s; if (!*s) return (char *)r; }
}
char *strstr(const char *h, const char *n) {
  size_t k = strlen(n);
  for (; *h; h++) if (!strncmp(h, n, k)) return (char *)h;
  return k ? 0 : (char *)h;
}
char *strdup(const char *s) { char *p = malloc(strlen(s) + 1); if (p) strcpy(p, s); return p; }
size_t strspn(const char *s, const char *a) { size_t i = 0; while (s[i] && strchr(a, s[i])) i++; return i; }
size_t strcspn(const char *s, const char *r) { size_t i = 0; while (s[i] && !strchr(r, s[i])) i++; return i; }

int isdigit(int c) { return c >= '0' && c <= '9'; }
int islower(int c) { return c >= 'a' && c <= 'z'; }
int isupper(int c) { return c >= 'A' && c <= 'Z'; }
int isalpha(int c) { return islower(c) || isupper(c); }
int isalnum(int c) { return isalpha(c) || isdigit(c); }
int isxdigit(int c) { return isdigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'); }
int isspace(int c) { return c == ' ' || (c >= 9 && c <= 13); }
int isprint(int c) { return c >= 32 && c < 127; }
int isgraph(int c) { return c > 32 && c < 127; }
int iscntrl(int c) { return (c >= 0 && c < 32) || c == 127; }
int ispunct(int c) { return isgraph(c) && !isalnum(c); }
int tolower(int c) { return isupper(c) ? c + 32 : c; }
int toupper(int c) { return islower(c) ? c - 32 : c; }

int abs(int x) { return x < 0 ? -x : x; }
long labs(long x) { return x < 0 ? -x : x; }
long long llabs(long long x) { return x < 0 ? -x : x; }

unsigned long long strtoull(const char *s, char **end, int base) {
  const char *p = s;
  while (isspace(*p)) p++;
  int neg = 0;
  if (*p == '-' || *p == '+') neg = *p++ == '-';
  if ((base == 0 || base == 16) && p[0] == '0' && (p[1] == 'x' || p[1] == 'X') && isxdigit(p[2])) { p += 2; base = 16; }
  else if (base == 0 && p[0] == '0') base = 8;
  else if (base == 0) base = 10;
  unsigned long long v = 0;
  const char *start = p;
  for (;; p++) {
    int d = isdigit(*p) ? *p - '0' : islower(*p) ? *p - 'a' + 10 : isupper(*p) ? *p - 'A' + 10 : 99;
    if (d >= base) break;
    v = v * base + d;
  }
  if (end) *end = (char *)(p == start ? s : p);
  return neg ? -v : v;
}
long long strtoll(const char *s, char **end, int base) { return (long long)strtoull(s, end, base); }
long strtol(const char *s, char **end, int base) { return (long)strtoull(s, end, base); }
unsigned long strtoul(const char *s, char **end, int base) { return (unsigned long)strtoull(s, end, base); }
int atoi(const char *s) { return (int)strtol(s, 0, 10); }
long atol(const char *s) { return strtol(s, 0, 10); }
long long atoll(const char *s) { return strtoll(s, 0, 10); }

static unsigned long __rand_state = 1;
int rand(void) { __rand_state = __rand_state * 1103515245 + 12345; return (int)((__rand_state >> 1) & 0x7fffffff); }
void srand(unsigned seed) { __rand_state = seed; }

void qsort(void *base, size_t n, size_t size, int (*cmp)(const void *, const void *)) {
  /* Insertion sort: simple, stable, and fine for the sizes programs here sort. */
  char *a = base;
  char tmp[256];
  for (size_t i = 1; i < n; i++) {
    for (size_t j = i; j > 0 && cmp(a + (j - 1) * size, a + j * size) > 0; j--) {
      char *x = a + (j - 1) * size, *y = a + j * size;
      for (size_t k = 0; k < size; k += sizeof tmp) {
        size_t m = size - k < sizeof tmp ? size - k : sizeof tmp;
        memcpy(tmp, x + k, m); memcpy(x + k, y + k, m); memcpy(y + k, tmp, m);
      }
    }
  }
}
void *bsearch(const void *key, const void *base, size_t n, size_t size, int (*cmp)(const void *, const void *)) {
  size_t lo = 0, hi = n;
  while (lo < hi) {
    size_t mid = (lo + hi) / 2;
    const char *p = (const char *)base + mid * size;
    int c = cmp(key, p);
    if (c == 0) return (void *)p;
    if (c < 0) hi = mid; else lo = mid + 1;
  }
  return 0;
}

double fabs(double x) { return x < 0 ? -x : x; }
float fabsf(float x) { return x < 0 ? -x : x; }

/* ------------------------------------------------------------ output */

/* Where formatted output goes: a file (through a small buffer) or a string. */
struct __out {
  FILE *f;
  char *s;
  size_t cap;  /* string: room including the final NUL */
  size_t n;    /* characters produced so far */
  char buf[128];
  int len;
};

static size_t __fwrite_bytes(FILE *f, const char *p, size_t n);
static void __flush(struct __out *o) {
  if (o->f && o->len) { __fwrite_bytes(o->f, o->buf, o->len); o->len = 0; }
}
static void __put(struct __out *o, int c) {
  if (o->f) {
    o->buf[o->len++] = (char)c;
    if (o->len == (int)sizeof o->buf) __flush(o);
  } else if (o->n + 1 < o->cap) o->s[o->n] = (char)c;
  o->n++;
}
static void __puts(struct __out *o, const char *s, size_t n) { while (n--) __put(o, *s++); }
static void __pad(struct __out *o, int c, int n) { while (n-- > 0) __put(o, c); }

/* Exact decimal expansion of a finite double >= 0: its digits (no leading zeros,
   "" for zero) and how many of them come before the decimal point. */
static int __exact_digits(double x, char *out, int *point) {
  unsigned long long bits = *(unsigned long long *)&x;
  unsigned long long mant = bits & 0xfffffffffffffULL;
  int e = (int)((bits >> 52) & 0x7ff);
  if (e == 0) e = -1074; else { mant |= 1ULL << 52; e -= 1075; }
  if (mant == 0) { out[0] = 0; *point = 1; return 0; }
  unsigned int big[90];
  int n = 2, frac = 0;
  big[0] = (unsigned int)mant; big[1] = (unsigned int)(mant >> 32);
  /* value = mant * 2^e: for e < 0, mant * 5^-e with -e digits after the point. */
  int k = e;
  unsigned int mul;
  if (k < 0) { frac = -k; k = -k; }
  while (k > 0) {
    int step;
    if (e >= 0) { step = k > 31 ? 31 : k; mul = 1U << step; }
    else { step = k > 13 ? 13 : k; mul = 1; for (int i = 0; i < step; i++) mul *= 5; }
    unsigned long long carry = 0;
    for (int i = 0; i < n; i++) {
      unsigned long long v = (unsigned long long)big[i] * mul + carry;
      big[i] = (unsigned int)v; carry = v >> 32;
    }
    if (carry) big[n++] = (unsigned int)carry;
    k -= step;
  }
  /* To decimal, nine digits at a time. */
  char rev[900];
  int len = 0;
  while (n > 0) {
    unsigned long long rem = 0;
    for (int i = n - 1; i >= 0; i--) {
      unsigned long long cur = (rem << 32) | big[i];
      big[i] = (unsigned int)(cur / 1000000000);
      rem = cur % 1000000000;
    }
    while (n > 0 && big[n - 1] == 0) n--;
    for (int j = 0; j < 9; j++) { rev[len++] = (char)('0' + rem % 10); rem /= 10; }
  }
  while (len > 1 && rev[len - 1] == '0') len--;
  for (int i = 0; i < len; i++) out[i] = rev[len - 1 - i];
  out[len] = 0;
  *point = len - frac;
  /* Trailing zeros carry no information. */
  while (len > 0 && out[len - 1] == '0') out[--len] = 0;
  return len;
}

/* Rounds the digit string to keep digits (half to even), updating its length
   and decimal point. keep may be zero or negative. */
static int __round_digits(char *d, int len, int *point, int keep) {
  if (keep >= len) return len;
  if (keep < 0) { d[0] = 0; return 0; }
  int up;
  char next = d[keep];
  if (next > '5') up = 1;
  else if (next < '5') up = 0;
  else {
    up = 0;
    for (int i = keep + 1; i < len; i++) if (d[i] != '0') up = 1;
    if (!up) up = keep > 0 && (d[keep - 1] - '0') % 2 == 1;
  }
  len = keep;
  d[len] = 0;
  if (up) {
    int i = len - 1;
    while (i >= 0 && d[i] == '9') { d[i] = '0'; i--; }
    if (i >= 0) d[i]++;
    else { memmove(d + 1, d, len + 1); d[0] = '1'; len++; (*point)++; }
  }
  while (len > 0 && d[len - 1] == '0') d[--len] = 0;
  return len;
}

/* Formats the digits as %f (exp == 0 style) into s; returns its length. */
static int __fixed(char *s, const char *d, int len, int point, int prec, int alt) {
  int n = 0;
  if (point <= 0) s[n++] = '0';
  else for (int i = 0; i < point; i++) s[n++] = i < len ? d[i] : '0';
  if (prec > 0 || alt) s[n++] = '.';
  for (int i = 0; i < prec; i++) {
    int at = point + i;
    s[n++] = at >= 0 && at < len ? d[at] : '0';
  }
  return n;
}

static int __fmt_float(char *s, double x, char conv, int prec, int alt) {
  if (prec < 0) prec = 6;
  int upper = conv == 'F' || conv == 'E' || conv == 'G';
  if (x != x) { strcpy(s, upper ? "NAN" : "nan"); return 3; }
  if (x == 1.0 / 0.0 || x == -1.0 / 0.0) { strcpy(s, upper ? "INF" : "inf"); return 3; }
  static char d[800];
  int point;
  int len = __exact_digits(x, d, &point);
  char c = conv | 32;
  if (c == 'f') {
    len = __round_digits(d, len, &point, point + prec);
    return __fixed(s, d, len, point, prec, alt);
  }
  int strip = 0;
  if (c == 'g') {
    if (prec == 0) prec = 1;
    int p2 = point;
    char e[800];
    memcpy(e, d, len + 1);
    int l2 = len ? __round_digits(e, len, &p2, prec) : 0;
    int X = l2 ? p2 - 1 : 0;
    strip = !alt;
    if (prec > X && X >= -4) {
      len = __round_digits(d, len, &point, point + prec - 1 - X);
      int n = __fixed(s, d, len, point, prec - 1 - X, alt);
      if (strip && memchr(s, '.', n)) { while (s[n - 1] == '0') n--; if (s[n - 1] == '.') n--; }
      return n;
    }
    prec = prec - 1;
  }
  /* %e */
  len = len ? __round_digits(d, len, &point, prec + 1) : 0;
  int ex = len ? point - 1 : 0;
  int n = 0;
  s[n++] = len ? d[0] : '0';
  if (prec > 0 || alt) s[n++] = '.';
  for (int i = 1; i <= prec; i++) s[n++] = i < len ? d[i] : '0';
  if (strip && s[n - 1] != 'x') { int had = memchr(s, '.', n) != 0; if (had) { while (s[n - 1] == '0') n--; if (s[n - 1] == '.') n--; } }
  s[n++] = upper ? 'E' : 'e';
  s[n++] = ex < 0 ? '-' : '+';
  if (ex < 0) ex = -ex;
  if (ex >= 100) s[n++] = (char)('0' + ex / 100);
  s[n++] = (char)('0' + ex / 10 % 10);
  s[n++] = (char)('0' + ex % 10);
  return n;
}

static int __format(struct __out *o, const char *fmt, va_list ap) {
  for (; *fmt; fmt++) {
    if (*fmt != '%') { __put(o, *fmt); continue; }
    fmt++;
    int left = 0, plus = 0, space = 0, alt = 0, zero = 0;
    for (;; fmt++) {
      if (*fmt == '-') left = 1;
      else if (*fmt == '+') plus = 1;
      else if (*fmt == ' ') space = 1;
      else if (*fmt == '#') alt = 1;
      else if (*fmt == '0') zero = 1;
      else break;
    }
    int width = 0, prec = -1;
    if (*fmt == '*') { width = va_arg(ap, int); if (width < 0) { left = 1; width = -width; } fmt++; }
    else while (isdigit(*fmt)) width = width * 10 + *fmt++ - '0';
    if (*fmt == '.') {
      fmt++;
      prec = 0;
      if (*fmt == '*') { prec = va_arg(ap, int); fmt++; }
      else while (isdigit(*fmt)) prec = prec * 10 + *fmt++ - '0';
    }
    int size = 0; /* 0 int, 1 long, 2 long long, -1 short, -2 char */
    for (;; fmt++) {
      if (*fmt == 'l') size++;
      else if (*fmt == 'h') size--;
      else if (*fmt == 'z' || *fmt == 't') size = 1;
      else if (*fmt == 'j' || *fmt == 'q') size = 2;
      else if (*fmt == 'L') ;
      else break;
    }
    char conv = *fmt;
    char tmp[64];
    static char ftmp[1200];
    char *body = tmp;
    int blen = 0;
    const char *prefix = "";
    switch (conv) {
    case 'd': case 'i': case 'u': case 'x': case 'X': case 'o': case 'p': {
      unsigned long long v;
      int neg = 0;
      if (conv == 'p') { v = (unsigned long)va_arg(ap, void *); alt = 1; }
      else if (size >= 2) v = va_arg(ap, unsigned long long);
      else v = va_arg(ap, unsigned int);
      if (conv == 'd' || conv == 'i') {
        long long s;
        if (size >= 2) s = (long long)v;
        else if (size == -1) s = (short)v;
        else if (size <= -2) s = (signed char)v;
        else s = (int)v;
        if (s < 0) { neg = 1; v = -(unsigned long long)s; } else v = s;
      } else if (size == -1) v = (unsigned short)v;
      else if (size <= -2) v = (unsigned char)v;
      int base = conv == 'x' || conv == 'X' || conv == 'p' ? 16 : conv == 'o' ? 8 : 10;
      const char *digits = conv == 'X' ? "0123456789ABCDEF" : "0123456789abcdef";
      char *e = tmp + sizeof tmp;
      char *p = e;
      while (v) { *--p = digits[v % base]; v /= base; }
      int nd = e - p;
      int want = prec < 0 ? 1 : prec;
      if (conv == 'o' && alt && (nd == 0 || *p != '0') && want <= nd) want = nd + 1;
      while (nd < want) { *--p = '0'; nd++; }
      body = p; blen = nd;
      if (neg) prefix = "-";
      else if ((conv == 'd' || conv == 'i') && plus) prefix = "+";
      else if ((conv == 'd' || conv == 'i') && space) prefix = " ";
      else if (alt && (conv == 'x' || conv == 'p') && (e - p > 0 && !(e - p == 1 && *p == '0') || conv == 'p')) prefix = "0x";
      else if (alt && conv == 'X' && !(e - p == 1 && *p == '0')) prefix = "0X";
      if (prec >= 0) zero = 0;
      break;
    }
    case 'f': case 'F': case 'e': case 'E': case 'g': case 'G': {
      double x = va_arg(ap, double);
      int neg = x < 0 || (x == 0 && 1 / x < 0);
      if (neg) x = -x;
      blen = __fmt_float(ftmp, x, conv, prec, alt);
      body = ftmp;
      if (neg) prefix = "-"; else if (plus) prefix = "+"; else if (space) prefix = " ";
      if (x != x || x == 1.0 / 0.0) zero = 0;
      break;
    }
    case 'c':
      tmp[0] = (char)va_arg(ap, int);
      blen = 1;
      zero = 0;
      break;
    case 's': {
      const char *s = va_arg(ap, const char *);
      if (!s) s = "(null)";
      size_t n = 0;
      while ((prec < 0 || (int)n < prec) && s[n]) n++;
      body = (char *)s; blen = (int)n;
      zero = 0;
      break;
    }
    case 'n':
      *va_arg(ap, int *) = (int)o->n;
      continue;
    case '%':
      __put(o, '%');
      continue;
    default:
      /* Unknown conversion: print it as written. */
      __put(o, '%');
      if (conv) __put(o, conv); else fmt--;
      continue;
    }
    int plen = (int)strlen(prefix);
    int padn = width - plen - blen;
    if (!left && !zero) __pad(o, ' ', padn);
    __puts(o, prefix, plen);
    if (!left && zero) __pad(o, '0', padn);
    __puts(o, body, blen);
    if (left) __pad(o, ' ', padn);
  }
  return (int)o->n;
}

int vfprintf(FILE *f, const char *fmt, va_list ap) {
  struct __out o;
  o.f = f; o.s = 0; o.cap = 0; o.n = 0; o.len = 0;
  int n = __format(&o, fmt, ap);
  __flush(&o);
  return n;
}
int vprintf(const char *fmt, va_list ap) { return vfprintf(stdout, fmt, ap); }
int vsnprintf(char *buf, size_t cap, const char *fmt, va_list ap) {
  struct __out o;
  o.f = 0; o.s = buf; o.cap = cap; o.n = 0; o.len = 0;
  int n = __format(&o, fmt, ap);
  if (cap) buf[o.n < cap ? o.n : cap - 1] = 0;
  return n;
}
int vsprintf(char *buf, const char *fmt, va_list ap) { return vsnprintf(buf, (size_t)-1 >> 1, fmt, ap); }
int printf(const char *fmt, ...) { va_list ap; va_start(ap, fmt); int n = vfprintf(stdout, fmt, ap); va_end(ap); return n; }
int fprintf(FILE *f, const char *fmt, ...) { va_list ap; va_start(ap, fmt); int n = vfprintf(f, fmt, ap); va_end(ap); return n; }
int sprintf(char *buf, const char *fmt, ...) { va_list ap; va_start(ap, fmt); int n = vsprintf(buf, fmt, ap); va_end(ap); return n; }
int snprintf(char *buf, size_t cap, const char *fmt, ...) { va_list ap; va_start(ap, fmt); int n = vsnprintf(buf, cap, fmt, ap); va_end(ap); return n; }

static struct __memfile __files[16];
static int __nfiles;

static size_t __fwrite_bytes(FILE *f, const char *p, size_t n) {
  if (!f->mem) { __host_write(f->fd, p, (int)n); return n; }
  if (!f->write) { f->error = 1; return 0; }
  struct __memfile *m = f->mem;
  if (f->pos + n > m->cap) {
    size_t cap = m->cap ? m->cap : 64;
    while (cap < f->pos + n) cap *= 2;
    char *d = realloc(m->data, cap);
    if (!d) { f->error = 1; return 0; }
    m->data = d; m->cap = cap;
  }
  if (f->pos > m->len) memset(m->data + m->len, 0, f->pos - m->len);
  memcpy(m->data + f->pos, p, n);
  f->pos += n;
  if (f->pos > m->len) m->len = f->pos;
  return n;
}

int fputc(int c, FILE *f) { char ch = (char)c; __fwrite_bytes(f, &ch, 1); return (unsigned char)c; }
int putc(int c, FILE *f) { return fputc(c, f); }
int putchar(int c) { return fputc(c, stdout); }
int fputs(const char *s, FILE *f) { __fwrite_bytes(f, s, strlen(s)); return 0; }
int puts(const char *s) { fputs(s, stdout); putchar('\n'); return 0; }
size_t fwrite(const void *p, size_t size, size_t n, FILE *f) { return size ? __fwrite_bytes(f, p, size * n) / size : 0; }
int fflush(FILE *f) { (void)f; return 0; }
void perror(const char *s) { if (s && *s) fprintf(stderr, "%s: ", s); fprintf(stderr, "error %d\n", errno); }

FILE *fopen(const char *path, const char *mode) {
  struct __memfile *m = 0;
  for (int i = 0; i < __nfiles; i++) if (!strcmp(__files[i].name, path)) m = &__files[i];
  int w = mode[0] == 'w' || mode[0] == 'a' || strchr(mode, '+') != 0;
  if (!m) {
    if (mode[0] == 'r' || __nfiles == 16 || strlen(path) >= sizeof m->name) { errno = ENOENT; return 0; }
    m = &__files[__nfiles++];
    strcpy(m->name, path);
    m->data = 0; m->len = 0; m->cap = 0;
  }
  if (mode[0] == 'w') m->len = 0;
  FILE *f = malloc(sizeof *f);
  if (!f) return 0;
  f->fd = -1; f->error = 0; f->mem = m; f->write = w; f->eof = 0;
  f->pos = mode[0] == 'a' ? m->len : 0;
  return f;
}
int fclose(FILE *f) { if (f && f->mem) free(f); return 0; }
int feof(FILE *f) { return f->eof; }
int ferror(FILE *f) { return f->error; }

int fgetc(FILE *f) {
  if (!f->mem || f->pos >= f->mem->len) { f->eof = 1; return EOF; }
  return (unsigned char)f->mem->data[f->pos++];
}
int getc(FILE *f) { return fgetc(f); }
int getchar(void) { return fgetc(stdin); }
size_t fread(void *p, size_t size, size_t n, FILE *f) {
  char *d = p;
  size_t total = size * n, i = 0;
  for (; i < total; i++) { int c = fgetc(f); if (c == EOF) break; d[i] = (char)c; }
  return size ? i / size : 0;
}
char *fgets(char *s, int n, FILE *f) {
  int i = 0;
  while (i < n - 1) {
    int c = fgetc(f);
    if (c == EOF) break;
    s[i++] = (char)c;
    if (c == '\n') break;
  }
  if (i == 0) return 0;
  s[i] = 0;
  return s;
}
int ungetc(int c, FILE *f) { if (c == EOF || !f->mem || f->pos == 0) return EOF; f->pos--; f->eof = 0; return c; }
int fseek(FILE *f, long off, int whence) {
  if (!f->mem) return -1;
  long base = whence == 0 ? 0 : whence == 1 ? (long)f->pos : (long)f->mem->len;
  if (base + off < 0) return -1;
  f->pos = (size_t)(base + off); f->eof = 0;
  return 0;
}
long ftell(FILE *f) { return f->mem ? (long)f->pos : -1; }
void rewind(FILE *f) { fseek(f, 0, 0); }
int remove(const char *path) {
  for (int i = 0; i < __nfiles; i++) if (!strcmp(__files[i].name, path)) { __files[i].name[0] = 0; return 0; }
  return -1;
}

/* ------------------------------------------------------------ maths
   After fdlibm (Sun Microsystems, freely distributable): the same polynomial
   kernels, with simpler argument reduction (exact for |x| below about 1e9). */

double __wasm_f64_sqrt(double x);
double __wasm_f64_floor(double x);
double __wasm_f64_ceil(double x);
double __wasm_f64_trunc(double x);
float __wasm_f32_sqrt(float x);

double sqrt(double x) { return __wasm_f64_sqrt(x); }
float sqrtf(float x) { return __wasm_f32_sqrt(x); }
double floor(double x) { return __wasm_f64_floor(x); }
double ceil(double x) { return __wasm_f64_ceil(x); }
double trunc(double x) { return __wasm_f64_trunc(x); }
double round(double x) {
  double t = trunc(x);
  if (fabs(x - t) >= 0.5) t += x < 0 ? -1.0 : 1.0;
  return t;
}
double fmod(double x, double y) {
  if (y == 0 || x != x || y != y || x - x != 0) return 0.0 / 0.0;
  double ax = fabs(x), ay = fabs(y);
  while (ax >= ay) {
    double t = ay;
    while (t * 2 <= ax) t *= 2;
    ax -= t;
  }
  return x < 0 ? -ax : ax;
}
double ldexp(double x, int e) {
  while (e > 1000) { x *= 0x1p1000; e -= 1000; }
  while (e < -1000) { x *= 0x1p-1000; e += 1000; }
  unsigned long long b = (unsigned long long)(e + 1023) << 52;
  return x * *(double *)&b;
}

static double __sin_kernel(double x) {
  double z = x * x;
  return x + x * z * (-1.66666666666666324348e-01 + z * (8.33333333332248946124e-03 + z * (-1.98412698298579493134e-04
    + z * (2.75573137070700676789e-06 + z * (-2.50507602534068634195e-08 + z * 1.58969099521155010221e-10)))));
}
static double __cos_kernel(double x) {
  double z = x * x;
  return 1.0 - 0.5 * z + z * z * (4.16666666666666019037e-02 + z * (-1.38888888888741095749e-03 + z * (2.48015872894767294178e-05
    + z * (-2.75573143513906633035e-07 + z * (2.08757232129817482790e-09 + z * -1.13596475577881948265e-11)))));
}
/* x = n * pi/2 + r, |r| <= pi/4; returns n mod 4. */
static int __reduce(double x, double *r) {
  double n = round(x * 6.36619772367581382433e-01);
  *r = (x - n * 1.57079632673412561417e+00) - n * 6.07710050650619224932e-11;
  return (int)((long long)n & 3);
}
double sin(double x) {
  double r;
  if (x - x != 0) return 0.0 / 0.0;
  switch (__reduce(x, &r)) {
  case 0: return __sin_kernel(r);
  case 1: return __cos_kernel(r);
  case 2: return -__sin_kernel(r);
  default: return -__cos_kernel(r);
  }
}
double cos(double x) {
  double r;
  if (x - x != 0) return 0.0 / 0.0;
  switch (__reduce(x, &r)) {
  case 0: return __cos_kernel(r);
  case 1: return -__sin_kernel(r);
  case 2: return -__cos_kernel(r);
  default: return __sin_kernel(r);
  }
}
double tan(double x) { return sin(x) / cos(x); }

double exp(double x) {
  if (x != x) return x;
  if (x > 709.782712893384) return 1.0 / 0.0;
  if (x < -745.1332191019411) return 0;
  double k = round(x * 1.44269504088896338700e+00);
  double hi = x - k * 6.93147180369123816490e-01, lo = k * 1.90821492927058770002e-10;
  double r = hi - lo, z = r * r;
  double c = r - z * (1.66666666666666019037e-01 + z * (-2.77777777770155933842e-03 + z * (6.61375632143793436117e-05
    + z * (-1.65339022054652515390e-06 + z * 4.13813679705723846039e-08))));
  double y = 1.0 - ((lo - (r * c) / (2.0 - c)) - hi);
  return ldexp(y, (int)k);
}
double log(double x) {
  if (x != x || x < 0) return 0.0 / 0.0;
  if (x == 0) return -1.0 / 0.0;
  if (x - x != 0) return x;
  int k = 0;
  while (x < 0x1p-1000) { x *= 0x1p1000; k -= 1000; }
  unsigned long long b = *(unsigned long long *)&x;
  k += (int)((b >> 52) & 0x7ff) - 1023;
  b = (b & 0xfffffffffffffULL) | 0x3ff0000000000000ULL;
  double m = *(double *)&b;
  if (m > 1.41421356237309504880) { m *= 0.5; k++; }
  double f = m - 1.0, s = f / (2.0 + f), z = s * s;
  double R = z * (6.666666666666735130e-01 + z * (3.999999999940941908e-01 + z * (2.857142874366239149e-01
    + z * (2.222219843214978396e-01 + z * (1.818357216161805012e-01 + z * (1.531383769920937332e-01 + z * 1.479819860511658591e-01))))));
  double hfsq = 0.5 * f * f;
  return k * 6.93147180369123816490e-01 - ((hfsq - (s * (hfsq + R) + k * 1.90821492927058770002e-10)) - f);
}
double log10(double x) { return log(x) / 2.30258509299404568402; }
double log2(double x) { return log(x) / 6.93147180559945309417e-01; }
double pow(double x, double y) {
  if (y == 0) return 1;
  if (y == trunc(y) && fabs(y) < 1e9) {
    double r = 1, b = x;
    long long n = (long long)fabs(y);
    while (n) { if (n & 1) r *= b; b *= b; n >>= 1; }
    return y < 0 ? 1 / r : r;
  }
  if (x < 0) return 0.0 / 0.0;
  return exp(y * log(x));
}
double atan(double x) {
  if (x != x) return x;
  int neg = x < 0, inv = 0, shift = 0;
  if (neg) x = -x;
  if (x > 1) { x = 1 / x; inv = 1; }
  if (x > 0.26794919243112270) { x = (x * 1.73205080756887729353 - 1) / (1.73205080756887729353 + x); shift = 1; }
  double z = x * x, t = x, r = 0;
  for (int i = 1; i < 40; i += 2) { r += (((i / 2) & 1) ? -t : t) / i; t *= z; }
  if (shift) r += 0.52359877559829887308;
  if (inv) r = 1.57079632679489661923 - r;
  return neg ? -r : r;
}
double atan2(double y, double x) {
  if (x > 0) return atan(y / x);
  if (x < 0) return y >= 0 ? atan(y / x) + 3.14159265358979323846 : atan(y / x) - 3.14159265358979323846;
  return y > 0 ? 1.57079632679489661923 : y < 0 ? -1.57079632679489661923 : 0;
}
double asin(double x) { return atan2(x, sqrt(1 - x * x)); }
double acos(double x) { return atan2(sqrt(1 - x * x), x); }
double sinh(double x) { double e = exp(x); return (e - 1 / e) / 2; }
double cosh(double x) { double e = exp(x); return (e + 1 / e) / 2; }
double tanh(double x) { if (x > 20) return 1; if (x < -20) return -1; double e = exp(2 * x); return (e - 1) / (e + 1); }
double hypot(double x, double y) { return sqrt(x * x + y * y); }
float sinf(float x) { return (float)sin(x); }
float cosf(float x) { return (float)cos(x); }
float expf(float x) { return (float)exp(x); }
float logf(float x) { return (float)log(x); }
float powf(float x, float y) { return (float)pow(x, y); }
size_t wcslen(const wchar_t *s) { const wchar_t *p = s; while (*p) p++; return p - s; }
`;

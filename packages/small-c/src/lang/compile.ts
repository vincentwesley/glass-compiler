// The whole compiler: C source → tokens → preprocessed tokens → syntax tree →
// WebAssembly. The C library is compiled from its own source once and linked in.

import type { TranslationUnit } from './ast';
import { generate, LinkError, type WasmOutput } from './codegen';
import { LIBC_SOURCE } from './libc';
import { parse } from './parse';
import { preprocess } from './preprocess';
import { CompileError, lineOf, tokenize, type SourceFile, type Token } from './tokenize';

export interface Diagnostic {
  message: string;
  /** UTF-16 offsets in the program's source, when the error is in it. */
  start: number;
  end: number;
  line: number;
  /** The file the error is in, when it is not the program (a header or the library). */
  file?: string;
}

export interface Build {
  source: string;
  /** The program's own tokens, before preprocessing (what the page lists). */
  tokens: Token[];
  /** Headers the program included. */
  includes: string[];
  unit?: TranslationUnit;
  wasm?: WasmOutput;
  diagnostics: Diagnostic[];
}

let libcUnit: TranslationUnit | undefined;

function libc(): TranslationUnit {
  if (!libcUnit) {
    const file: SourceFile = { name: 'libc.c', text: LIBC_SOURCE, user: false };
    libcUnit = parse(preprocess(file).tokens, file);
  }
  return libcUnit;
}

const diag = (e: unknown, source: string): Diagnostic => {
  if (e instanceof CompileError) {
    if (e.file.user) return { message: e.message, start: e.offset, end: e.end, line: e.line };
    return { message: e.message, start: 0, end: 0, line: lineOf(e.file.text, e.offset), file: e.file.name };
  }
  if (e instanceof LinkError) {
    const t = e.tok ? (e.tok.origin ?? e.tok) : undefined;
    if (t && t.file.user) return { message: e.message, start: t.offset, end: t.end, line: lineOf(source, t.offset) };
    return { message: e.message, start: 0, end: 0, line: 1 };
  }
  throw e;
};

export function compile(source: string, name = 'main.c'): Build {
  const file: SourceFile = { name, text: source, user: true };
  const build: Build = { source, tokens: [], includes: [], diagnostics: [] };
  try {
    build.tokens = tokenize(file);
    const pp = preprocess(file);
    build.includes = pp.includes;
    build.unit = parse(pp.tokens, file);
    build.wasm = generate({
      source,
      units: [
        { globals: build.unit.globals, kind: 'c' },
        { globals: libc().globals, kind: 'libc' },
      ],
    });
  } catch (e) {
    build.diagnostics.push(diag(e, source));
  }
  return build;
}

export { ExitSignal, runWithHostEngine, type RunResult } from './run';

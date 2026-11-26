// Pane values inside a module compiled by Glass Compiler are NaN-boxed i64s
// (packages/compiler/src/lang/wasm/runtime.ts). When the module says it came
// from Pane, the debugger shows them as Pane would print them.

import type { WasmValue } from '../vm';

export interface PaneView {
  /** Function names in table order. */
  table: string[];
  /** Reads linear memory (for strings). */
  read: (offset: number, length: number) => Uint8Array;
}

const TAG = { NIL: 0xfff9n, FALSE: 0xfffan, TRUE: 0xfffbn, STR: 0xfffcn, FN: 0xfffdn, UNSET: 0xfffen };

/** Pane's number formatting (Glass Compiler's formatValue). */
export const paneNumber = (x: number) => (Number.isInteger(x) ? String(x) : String(Number(x.toPrecision(12))));

/** A Pane value as text, or null when `v` isn't a Pane value. */
export function decodePane(v: WasmValue, view: PaneView): { text: string; kind: string } | null {
  if (v.type !== 'i64') return null;
  const bits = BigInt.asUintN(64, BigInt(v.value));
  const tag = bits >> 48n;
  if (tag < TAG.NIL) {
    const dv = new DataView(new ArrayBuffer(8));
    dv.setBigUint64(0, bits);
    return { text: paneNumber(dv.getFloat64(0)), kind: 'number' };
  }
  switch (tag) {
    case TAG.NIL:
      return { text: 'nil', kind: 'nil' };
    case TAG.FALSE:
      return { text: 'false', kind: 'bool' };
    case TAG.TRUE:
      return { text: 'true', kind: 'bool' };
    case TAG.STR: {
      const ptr = Number(bits & 0xffffffffn);
      const head = view.read(ptr, 4);
      if (head.length < 4) return { text: '(string out of bounds)', kind: 'string' };
      const len = new DataView(head.buffer, head.byteOffset).getUint32(0, true);
      const body = view.read(ptr + 4, Math.min(len, 200));
      const text = new TextDecoder().decode(body);
      return { text: JSON.stringify(len > 200 ? `${text}…` : text), kind: 'string' };
    }
    case TAG.FN: {
      const name = view.table[Number(bits & 0xffffffffn)] ?? '?';
      return { text: `<fn ${name.replace(/^\$/, '')}>`, kind: 'fn' };
    }
    case TAG.UNSET:
      return { text: 'not declared yet', kind: 'unset' };
    default:
      return null;
  }
}

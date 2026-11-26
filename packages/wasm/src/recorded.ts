// The recorded spec results (results.json, written by scripts/record-results.mjs
// from the CLI run) rendered as static HTML. Shared by the build (so the table
// shows without JavaScript) and its unit tests.

export interface FileRecord {
  file: string;
  passed: number;
  failed: number;
  failures: { line: number; command: string; message: string }[];
}
export interface SpecRecord {
  member: string;
  testsuite: string;
  suites: { name: string; passed: number; failed: number; skipped: number; total: number }[];
  files: FileRecord[];
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!);
const fmt = (n: number) => n.toLocaleString('en-GB');

/** A stable id for a file's row, e.g. "spec-br_table". */
export const rowId = (file: string) => `spec-${file.replace(/\.wast$/, '').replace(/[^a-z0-9_-]/gi, '_')}`;

export function recordedTable(rec: SpecRecord | null): string {
  if (!rec) return '<p class="muted">No recorded results yet. Run <code>node scripts/record-results.mjs wasm</code>.</p>';
  const passed = rec.files.reduce((a, f) => a + f.passed, 0);
  const total = rec.files.reduce((a, f) => a + f.passed + f.failed, 0);
  const clean = rec.files.filter((f) => f.failed === 0).length;
  const rows = rec.files
    .map((f) => {
      const t = f.passed + f.failed;
      const ok = f.failed === 0;
      return `<tr id="${rowId(f.file)}" data-file="${esc(f.file)}" data-passed="${f.passed}" data-failed="${f.failed}"><th scope="row"><code>${esc(f.file)}</code></th><td class="num">${fmt(t)}</td><td class="num rec ${ok ? 'is-pass' : 'is-fail'}">${fmt(f.passed)}${ok ? '' : ` <span class="small">(${f.failed} failing)</span>`}</td><td class="num live" data-label="Here">–</td></tr>`;
    })
    .join('\n');
  return `<p class="spec-summary"><strong class="spec-big">${fmt(passed)} / ${fmt(total)}</strong> commands pass, in <strong>${clean} of ${rec.files.length}</strong> files. <span class="muted">Recorded from ${esc(rec.testsuite)}.</span></p>
<div class="table-wrap" role="region" aria-label="Spec testsuite results per file" tabindex="0">
<table class="spec-table">
<thead><tr><th scope="col">File</th><th scope="col" class="num">Commands</th><th scope="col" class="num">Recorded pass</th><th scope="col" class="num">In your browser</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>`;
}

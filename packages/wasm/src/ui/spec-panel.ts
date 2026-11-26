import { byId } from '@glass/ui/dom';
import { rowId } from '../recorded';
import type { GlassWasm } from '../vm';

// Every .wast file of the pinned testsuite, bundled as a same-origin asset.
const FILES = import.meta.glob<string>('../../spec/test/core/*.wast', { query: '?url', import: 'default', eager: true });

/** Runs the bundled testsuite in the browser and fills the "In your browser" column. */
export function mountSpec(vm: GlassWasm) {
  const button = byId<HTMLButtonElement>('spec-run');
  const progress = byId<HTMLProgressElement>('spec-progress');
  const status = byId('spec-status');
  const files = Object.entries(FILES)
    .map(([path, url]) => ({ name: path.split('/').pop()!, url }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  button.disabled = files.length === 0;
  button.textContent = `Run all ${files.length} files in your browser`;

  button.addEventListener('click', async () => {
    button.disabled = true;
    progress.hidden = false;
    progress.max = files.length;
    progress.value = 0;
    let passed = 0;
    let total = 0;
    let clean = 0;
    let differ = 0;
    const t0 = performance.now();
    try {
      for (const [i, f] of files.entries()) {
        status.textContent = `Running ${f.name} (${i + 1} of ${files.length})…`;
        const response = await fetch(f.url);
        if (!response.ok) throw new Error(`could not fetch ${f.name} (HTTP ${response.status})`);
        const r = vm.runSpec(await response.text());
        passed += r.passed;
        total += r.passed + r.failed;
        if (r.failed === 0) clean++;
        const row = document.getElementById(rowId(f.name));
        // Same as recorded means the same passes and the same failures.
        const same = !!row && Number(row.dataset.passed) === r.passed && Number(row.dataset.failed) === r.failed;
        if (!same) differ++;
        const cell = row?.querySelector<HTMLElement>('.live');
        if (cell) {
          cell.textContent = r.passed.toLocaleString('en-GB') + (r.failed ? ` (${r.failed} failing)` : '');
          cell.className = `num live ${r.failed === 0 ? 'is-pass' : 'is-fail'}`;
          if (r.failures.length) cell.title = r.failures.slice(0, 5).map((x) => `line ${x.line} ${x.command}: ${x.message}`).join('\n');
        }
        progress.value = i + 1;
        // Let the page paint between files.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const ms = Math.round(performance.now() - t0);
      status.textContent =
        `${passed.toLocaleString('en-GB')} of ${total.toLocaleString('en-GB')} commands passed in ${clean} of ${files.length} files, in ${(ms / 1000).toFixed(1)} s` +
        (differ === 0 ? '. Same as recorded.' : `. ${differ} file${differ === 1 ? '' : 's'} differ from the recorded run.`);
      button.textContent = 'Run them again';
    } catch (e) {
      status.textContent = `The run stopped: ${(e as Error).message}`;
    } finally {
      progress.hidden = true;
      button.disabled = false;
    }
  });
}

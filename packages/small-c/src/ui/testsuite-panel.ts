import { h } from '@glass/ui/dom';
import results from '../../results.json';

/** The grade: c-testsuite's pass counts (recorded by scripts/record-results.mjs) and every test that doesn't pass. */
export function mountTestsuite(body: HTMLElement) {
  const rows = results.suites.map((s) =>
    h(
      'tr',
      null,
      h('th', { scope: 'row' }, s.name),
      h('td', { class: 'num' }, `${s.passed} / ${s.total}`),
      h('td', null, h('span', { class: `badge ${s.passed === s.total ? 'badge-done' : 'badge-err'}` }, s.passed === s.total ? 'all pass' : `${s.total - s.passed} not passing`)),
    ),
  );
  const failing = results.notPassing as { name: string; outcome: string; reason: string }[];
  body.append(
    h('table', { class: 'grade-table' }, h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Suite'), h('th', { scope: 'col' }, 'Passed'), h('th', { scope: 'col' }, 'Status'))), h('tbody', null, ...rows)),
    failing.length
      ? h(
          'div',
          null,
          h('h3', { class: 'pixel-label' }, 'Not passing, with the reason'),
          h('ul', { class: 'grade-fails' }, ...failing.map((f) => h('li', null, h('code', null, f.name), ` ${f.outcome}: ${f.reason}`))),
        )
      : h('p', { class: 'grade-none', 'data-testid': 'grade-none' }, 'Every test passes, so nothing is skipped and there is nothing to explain.'),
    h(
      'p',
      { class: 'small muted' },
      `${results.testsuite}. Each test is compiled by Small C, run, and its output (stdout and stderr) compared with the test's .expected file; it must also exit with status 0. The same WebAssembly is run on Node's engine and on Glass Wasm, and the two must agree.`,
    ),
  );
}

// Renders the hub's data-driven parts (member cards, pipeline, grades) to static
// HTML at build time. Pure string functions, so they are unit-tested and the hub
// works with JavaScript off.
import { HUB_PATH, MEMBERS, SITE, appPath, hubPagePath, type Member } from '../../../site.config.mjs';

export interface Suite {
  name: string;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}
export interface Results {
  member: string;
  suites: Suite[];
}
export type ResultsFor = (member: Member) => Results | null;

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!);

const sourceUrl = (m: Member) => `${SITE.repo}/tree/main/${m.pkg}`;
const num = (i: number) => String(i + 1).padStart(2, '0');

/** "167 of 167 unit tests pass", or the failures first when there are any. */
export function gradeLine(s: Suite): string {
  const lead = s.failed > 0 ? `${s.failed} failing, ${s.passed} of ${s.total} pass` : `${s.passed} of ${s.total} pass`;
  return s.skipped > 0 ? `${lead} (${s.skipped} skipped)` : lead;
}

function gradeSummary(r: Results | null): string {
  if (!r || r.suites.length === 0) return '';
  return `<ul class="member-grade">${r.suites
    .map((s) => `<li><strong class="${s.failed > 0 ? 'is-failing' : 'is-passing'}">${esc(gradeLine(s))}</strong> <span>${esc(s.name)}</span></li>`)
    .join('')}</ul>`;
}

export function memberCard(m: Member, index: number, results: Results | null): string {
  const id = `m-${m.slug}`;
  if (m.status !== 'live') {
    return `<li class="member member-planned">
  <article class="member-tile" aria-labelledby="${id}">
    <p class="pixel-label member-status">${num(index)} · Planned · ${esc(m.milestone)}</p>
    <h3 id="${id}">${esc(m.name)}</h3>
    <p>${esc(m.summary)}</p>
    <p class="member-graded"><span class="pixel-label">Graded by</span> ${esc(m.gradedBy)}</p>
  </article>
</li>`;
  }
  return `<li class="member member-live">
  <article class="card member-card" aria-labelledby="${id}">
    <p class="pixel-label member-status"><span class="status-dot" aria-hidden="true"></span>${num(index)} · Live</p>
    <h3 id="${id}"><a href="${hubPagePath(m)}">${esc(m.name)}</a></h3>
    <p>${esc(m.summary)}</p>
    ${gradeSummary(results)}
    <p class="member-graded"><span class="pixel-label">Graded by</span> ${esc(m.gradedBy)}</p>
    <p class="member-actions"><a class="btn btn-primary" href="${appPath(m)}">Open ${esc(m.name)}</a><a class="btn" href="${sourceUrl(m)}">Source</a></p>
  </article>
</li>`;
}

export function membersList(resultsFor: ResultsFor, members: readonly Member[] = MEMBERS): string {
  return `<ol class="members" role="list">\n${members.map((m, i) => memberCard(m, i, resultsFor(m))).join('\n')}\n</ol>`;
}

/** One stop on the pipeline: a link when the member is live, plain text when planned. */
function stop(slug: string, members: readonly Member[]): string {
  const m = members.find((x) => x.slug === slug);
  if (!m) throw new Error(`Unknown member ${slug}`);
  const label = `${esc(m.name)} <span class="pipe-status">${m.status === 'live' ? 'live' : 'planned'}</span>`;
  return m.status === 'live'
    ? `<li class="pipe-stop pipe-live"><a href="${hubPagePath(m)}">${label}</a></li>`
    : `<li class="pipe-stop pipe-planned"><span class="pipe-box">${label}</span></li>`;
}
const artefact = (text: string) => `<li class="pipe-artefact">${esc(text)}</li>`;

export function pipeline(members: readonly Member[] = MEMBERS): string {
  return `<div class="pipeline">
  <ol class="pipe-row" aria-label="Pane programs">${[artefact('Pane source'), stop('compiler', members), artefact('Wasm module'), stop('wasm', members), stop('kernel', members)].join('')}</ol>
  <ol class="pipe-row" aria-label="C programs">${[artefact('C source'), stop('small-c', members), artefact('Wasm module'), stop('wasm', members), stop('kernel', members)].join('')}</ol>
</div>`;
}

/** The grade table on a member's own page. */
export function gradeTable(results: Results | null): string {
  if (!results || results.suites.length === 0) return '<p class="muted">No recorded results yet.</p>';
  const rows = results.suites
    .map(
      (s) =>
        `<tr><th scope="row">${esc(s.name)}</th><td data-label="Pass">${s.passed}</td><td data-label="Fail">${s.failed}</td><td data-label="Skipped">${s.skipped}</td><td data-label="Total">${s.total}</td></tr>`,
    )
    .join('');
  return `<div class="table-wrap" role="region" aria-label="Test results" tabindex="0"><table class="grade-table"><thead><tr><th scope="col">Suite</th><th scope="col">Pass</th><th scope="col">Fail</th><th scope="col">Skipped</th><th scope="col">Total</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export const HUB_BASE = `${SITE.base}${HUB_PATH}`;

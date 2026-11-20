// Renders test-report/data.json (+ coverage/coverage-files.json when present) into:
//   index.html         the full capability report (also the source of the PDF)
//   overview.md        short markdown summary for the job summary / PR comment
//   summary.json       counts per capability (machine-readable)
//   traceability.json  capability → tests → code, for reviewers and LLM PR review
//
// CLI: node tests/reporting/render.mjs [--data test-report/data.json] [--out test-report]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry, REPO_ROOT } from './lib/registry.mjs';

const STATUS_LABEL = {
  passed: 'Passed',
  failed: 'Failed',
  known: 'Known issue',
  'unexpected-pass': 'Passed unexpectedly',
  flaky: 'Flaky',
  skipped: 'Skipped',
};
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const code = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
const pct = (c, t) => (t ? (100 * c) / t : null);
const fmtPct = (p) => (p == null ? '–' : `${p >= 99.95 ? 100 : p.toFixed(1)}%`);
const n = (x) => Number(x || 0).toLocaleString('en-US');
const fmtDur = (ms) => {
  const s = Math.round((ms || 0) / 1000);
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
};

function emptyCounts() {
  return { total: 0, passed: 0, failed: 0, known: 0, 'unexpected-pass': 0, flaky: 0, skipped: 0, new: 0, modified: 0 };
}

export function loadCoverage(dir = process.env.MMGIS_COVERAGE_DIR || path.join(REPO_ROOT, 'coverage')) {
  const f = path.join(dir, 'coverage-files.json');
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

/** Builds the report model shared by every output. */
export function buildModel(data, registry, coverage) {
  const caps = new Map(
    registry.list.map((c) => [c.id, { ...c, counts: emptyCounts(), tests: [], scenarioTests: new Map(c.scenarios.map((s) => [s, []])) }]),
  );
  const unmapped = [];
  const unknownTags = [];
  const totals = emptyCounts();

  for (const t of data.tests) {
    const bump = (counts) => {
      counts.total++;
      counts[t.status]++;
      if (t.history?.change === 'new') counts.new++;
      if (t.history?.change === 'modified') counts.modified++;
    };
    bump(totals);
    if (!t.capability) {
      (t.declaredCapability ? unknownTags : unmapped).push(t);
      continue;
    }
    const cap = caps.get(t.capability);
    cap.tests.push(t);
    bump(cap.counts);
    if (cap.parent) bump(caps.get(cap.parent).counts);
    for (const s of t.scenarios) {
      // A scenario may be claimed from the capability or its parent.
      for (const c of [cap, cap.parent && caps.get(cap.parent)].filter(Boolean)) {
        if (c.scenarioTests.has(s)) c.scenarioTests.get(s).push(t.id);
      }
    }
  }

  // Coverage per capability: files owned by the capability's code globs (parents: union).
  if (coverage) {
    const owned = new Map([...caps.keys()].map((id) => [id, new Set()]));
    for (const file of Object.keys(coverage.files)) {
      for (const id of registry.forCode(file)) {
        owned.get(id).add(file);
        const p = caps.get(id).parent;
        if (p) owned.get(p).add(file);
      }
    }
    for (const [id, files] of owned) {
      const agg = { files: files.size, lines: { total: 0, covered: 0 }, branches: { total: 0, covered: 0 }, functions: { total: 0, covered: 0 } };
      for (const f of files) for (const k of ['lines', 'branches', 'functions']) {
        agg[k].total += coverage.files[f][k]?.total || 0;
        agg[k].covered += coverage.files[f][k]?.covered || 0;
      }
      caps.get(id).coverage = files.size ? agg : null;
    }
  }

  const failures = data.tests.filter((t) => t.status === 'failed' || t.status === 'unexpected-pass');
  const known = data.tests.filter((t) => t.status === 'known');
  const changed = data.tests.filter((t) => t.history?.change);
  const plannedScenarios = [...caps.values()].flatMap((c) =>
    [...c.scenarioTests].filter(([, ids]) => ids.length === 0).map(([s]) => ({ capability: c.id, scenario: s })),
  );
  const emptyCaps = [...caps.values()].filter((c) => c.parent && c.counts.total === 0);
  return { data, caps, totals, unmapped, unknownTags, failures, known, changed, plannedScenarios, emptyCaps, coverage };
}

// ───────────────────────────────────────────────────────────────── HTML
const CSS = `
:root{--bg:#fff;--fg:#1d2330;--muted:#5d6675;--line:#dfe3ea;--soft:#f4f6f9;--accent:#1f5fae;
--ok:#1a7f37;--ok-bg:#e6f4ea;--bad:#c62828;--bad-bg:#fdecea;--warn:#9a6700;--warn-bg:#fff4d6;--skip:#5d6675;--skip-bg:#eef0f3;
--new:#1f5fae;--new-bg:#e3eefb;--mod:#6f42c1;--mod-bg:#f0e9fb;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#14171c;--fg:#e4e7ec;--muted:#9aa3b2;--line:#2c323c;--soft:#1b1f26;--accent:#7fb0f0;
--ok:#5cc27a;--ok-bg:#163222;--bad:#ff8a80;--bad-bg:#3a1a1a;--warn:#e3b341;--warn-bg:#352a10;--skip:#9aa3b2;--skip-bg:#242a33;--new:#7fb0f0;--new-bg:#16283f;--mod:#b392f0;--mod-bg:#2a2140;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:1180px;margin:0 auto;padding:24px 16px 64px}h1{font-size:26px;margin:0 0 4px}h2{font-size:20px;margin:36px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
h3{font-size:16px;margin:22px 0 6px}h4{font-size:14px;margin:14px 0 4px}a{color:var(--accent)}code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--soft);padding:1px 4px;border-radius:4px}
table.proc{table-layout:fixed}table.proc td{overflow-wrap:anywhere}table.proc td.nw{white-space:normal}.nw{white-space:nowrap}.muted{color:var(--muted)}.meta{display:flex;flex-wrap:wrap;gap:4px 18px;color:var(--muted);font-size:13px;margin:6px 0 16px}
.banner{padding:12px 16px;border-radius:8px;font-weight:600;margin:12px 0}.banner.ok{background:var(--ok-bg);color:var(--ok)}.banner.bad{background:var(--bad-bg);color:var(--bad)}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:5px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{background:var(--soft);font-weight:600;white-space:nowrap}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
tr.top td{font-weight:600;background:var(--soft)}tr.child td:first-child{padding-left:22px}tr.total td{font-weight:700;border-top:2px solid var(--fg)}
.pill{display:inline-block;padding:0 7px;border-radius:10px;font-size:11.5px;font-weight:600;white-space:nowrap}
.s-passed{background:var(--ok-bg);color:var(--ok)}.s-failed,.s-unexpected-pass{background:var(--bad-bg);color:var(--bad)}.s-known,.s-flaky{background:var(--warn-bg);color:var(--warn)}
.s-skipped{background:var(--skip-bg);color:var(--skip)}.c-new{background:var(--new-bg);color:var(--new)}.c-modified{background:var(--mod-bg);color:var(--mod)}
.bar{display:inline-block;width:60px;height:7px;background:var(--line);border-radius:4px;vertical-align:middle;margin-right:6px;overflow:hidden}.bar i{display:block;height:100%;background:var(--ok)}
.bar.low i{background:var(--bad)}.bar.mid i{background:var(--warn)}
details{margin:6px 0 12px}summary{cursor:pointer;color:var(--accent);font-weight:600}.cap{border:1px solid var(--line);border-radius:8px;padding:4px 14px 8px;margin:12px 0}
.kv{font-size:12.5px;color:var(--muted);margin:2px 0}.note{font-size:12px;color:var(--muted)}.err{font:12px ui-monospace,Menlo,monospace;color:var(--bad);white-space:pre-wrap;overflow-wrap:anywhere}
ul.sc{margin:4px 0 8px;padding-left:20px;font-size:13px}ul.sc li.done::marker{content:"✓ ";color:var(--ok)}ul.sc li.todo::marker{content:"○ ";color:var(--muted)}
nav.toc{columns:2;font-size:13px}nav.toc a{text-decoration:none}.legend{font-size:12px;color:var(--muted)}
@media (max-width:640px){nav.toc{columns:1}h1{font-size:22px}}
@media print{main{max-width:none;padding:0}.scroll{overflow:visible}tr,li,.cap h3{break-inside:avoid}h2{break-after:avoid}}
`;

function bar(p) {
  if (p == null) return '–';
  const cls = p < 40 ? 'low' : p < 70 ? 'mid' : '';
  return `<span class="bar ${cls}"><i style="width:${Math.min(100, p).toFixed(1)}%"></i></span>${fmtPct(p)}`;
}
const pill = (status) => `<span class="pill s-${status}">${STATUS_LABEL[status]}</span>`;
const changePill = (t) =>
  t.history?.change ? `<span class="pill c-${t.history.change}">${t.history.change === 'new' ? 'New' : 'Modified'}</span>` : '';

function srcLink(meta, file, line) {
  const ref = meta.commit || 'development';
  return `https://github.com/${meta.repository}/blob/${ref}/${file}${line ? `#L${line}` : ''}`;
}

function countsRow(label, c, cls, cov, href) {
  const name = href ? `<a href="${href}">${esc(label)}</a>` : esc(label);
  return `<tr class="${cls}"><td>${name}</td><td class="num">${n(c.total)}</td><td class="num">${n(c.passed + c.flaky)}</td>
<td class="num">${c.failed + c['unexpected-pass'] ? `<b style="color:var(--bad)">${n(c.failed + c['unexpected-pass'])}</b>` : 0}</td>
<td class="num">${n(c.known)}</td><td class="num">${n(c.skipped)}</td><td class="num">${n(c.new)}</td><td class="num">${n(c.modified)}</td>
<td class="num">${cov ? bar(pct(cov.lines.covered, cov.lines.total)) : '–'}</td></tr>`;
}

function renderHtml(model) {
  const { data, caps, totals, failures, known, changed, unmapped, unknownTags, plannedScenarios, emptyCaps, coverage } = model;
  const m = data.meta;
  const ok = failures.length === 0 && unmapped.length === 0 && unknownTags.length === 0;
  const base = m.baseline ? `${m.baseline.tag} (${m.baseline.date})` : 'none';
  const tops = [...caps.values()].filter((c) => !c.parent);
  const parts = [];

  parts.push(`<header><h1>${esc(m.title)}</h1>
<div class="meta"><span><b>Tier:</b> ${esc(m.tier)}</span><span><b>Generated:</b> ${esc(m.generated.replace('T', ' ').slice(0, 16))} UTC</span>
<span><b>Duration:</b> ${fmtDur(m.durationMs)}</span>${m.branch ? `<span><b>Branch:</b> ${esc(m.branch)}</span>` : ''}
${m.commit ? `<span><b>Commit:</b> <a href="https://github.com/${esc(m.repository)}/commit/${esc(m.commit)}">${esc(m.commit.slice(0, 10))}</a></span>` : ''}
${m.pr ? `<span><b>PR:</b> <a href="https://github.com/${esc(m.repository)}/pull/${esc(m.pr)}">#${esc(m.pr)}</a></span>` : ''}
${m.runUrl ? `<span><a href="${esc(m.runUrl)}">CI run</a></span>` : ''}<span><b>Baseline release:</b> ${esc(base)}</span>
<span><b>Configurations:</b> ${esc(m.runs.join(', '))}</span></div></header>`);

  parts.push(`<div class="banner ${ok ? 'ok' : 'bad'}">${ok ? '✔ Passed' : '✘ Needs attention'} — ${n(totals.total)} tests:
${n(totals.passed + totals.flaky)} passed, ${n(totals.failed + totals['unexpected-pass'])} failed, ${n(totals.known)} known issues, ${n(totals.skipped)} skipped.
${n(totals.new)} new and ${n(totals.modified)} modified since ${esc(m.baseline?.tag || 'the last release')}.</div>`);

  parts.push(`<nav class="toc"><a href="#summary">1. Summary by capability</a><br><a href="#coverage">2. Code coverage</a><br>
<a href="#failures">3. Failures (${failures.length})</a><br><a href="#changes">4. New &amp; modified tests (${changed.length})</a><br>
<a href="#capabilities">5. Capabilities and test procedures</a><br><a href="#known">6. Known issues (${known.length})</a><br>
<a href="#gaps">7. Traceability gaps</a><br><a href="#runs">8. Test configurations</a></nav>`);

  // 1. Summary
  const head = `<tr><th>Capability</th><th class="num">Tests</th><th class="num">Passed</th><th class="num">Failed</th><th class="num">Known</th><th class="num">Skipped</th><th class="num">New</th><th class="num">Modified</th><th class="num">Line coverage</th></tr>`;
  let rows = '';
  for (const t of tops) {
    rows += countsRow(t.name, t.counts, 'top', t.coverage, `#cap-${t.id}`);
    for (const cid of t.children) {
      const c = caps.get(cid);
      rows += countsRow(c.name + (c.status !== 'active' ? ` (${c.status})` : ''), c.counts, 'child', c.coverage, `#cap-${c.id}`);
    }
  }
  if (unmapped.length + unknownTags.length) rows += countsRow('Not mapped to a capability', { ...emptyCounts(), total: unmapped.length + unknownTags.length }, 'child');
  const totalCov = coverage ? coverage.totals : null;
  rows += countsRow('Total', totals, 'total', totalCov);
  parts.push(`<h2 id="summary">1. Summary by capability</h2>
<p class="legend">Counts are per test. A test run in several configurations (see §8) counts once, with its worst result. “New” and “Modified” come from git history
compared with release ${esc(m.baseline?.tag || '–')}${m.historyAvailable ? '' : ' (history unavailable in this checkout)'}.
Line coverage is the share of lines, in the code each capability owns, that the whole suite executed.</p>
<div class="scroll"><table>${head}${rows}</table></div>`);

  // 2. Coverage
  parts.push(`<h2 id="coverage">2. Code coverage</h2>`);
  if (!coverage) {
    parts.push(`<p class="muted">No coverage was collected for this run. Run with <code>npm run test:coverage</code> (CI collects it on the full tier).</p>`);
  } else {
    const areaRows = Object.entries(coverage.byArea || {})
      .map(
        ([area, a]) => `<tr><td>${esc(area)}</td><td class="num">${n(a.files)}</td><td class="num">${bar(pct(a.lines.covered, a.lines.total))}</td>
<td class="num">${bar(pct(a.branches.covered, a.branches.total))}</td><td class="num">${bar(pct(a.functions.covered, a.functions.total))}</td></tr>`,
      )
      .join('');
    const t = coverage.totals;
    parts.push(`<p class="legend">Measured while the tests ran: Node.js code through V8 coverage of the unit-test workers and the test server, and browser code through
Chromium JS coverage mapped back to <code>src/</code> and <code>plugins/</code> with source maps. ${esc(coverage.note || '')}</p>
<div class="scroll"><table><tr><th>Area</th><th class="num">Files</th><th class="num">Lines</th><th class="num">Branches</th><th class="num">Functions</th></tr>${areaRows}
<tr class="total"><td>All</td><td class="num">${n(t.files)}</td><td class="num">${bar(pct(t.lines.covered, t.lines.total))}</td><td class="num">${bar(pct(t.branches.covered, t.branches.total))}</td>
<td class="num">${bar(pct(t.functions.covered, t.functions.total))}</td></tr></table></div>`);
    const capRows = [...caps.values()]
      .filter((c) => c.parent && c.coverage)
      .sort((a, b) => pct(a.coverage.lines.covered, a.coverage.lines.total) - pct(b.coverage.lines.covered, b.coverage.lines.total))
      .map(
        (c) => `<tr><td><a href="#cap-${c.id}">${esc(c.name)}</a> <span class="note">${esc(c.id)}</span></td><td class="num">${n(c.coverage.files)}</td>
<td class="num">${n(c.coverage.lines.covered)} / ${n(c.coverage.lines.total)}</td><td class="num">${bar(pct(c.coverage.lines.covered, c.coverage.lines.total))}</td>
<td class="num">${bar(pct(c.coverage.branches.covered, c.coverage.branches.total))}</td></tr>`,
      )
      .join('');
    parts.push(`<h3>By capability (lowest first)</h3><div class="scroll"><table><tr><th>Capability</th><th class="num">Files</th><th class="num">Lines covered</th><th class="num">Lines</th><th class="num">Branches</th></tr>${capRows}</table></div>`);
    const big = Object.entries(coverage.files)
      .filter(([, f]) => f.lines.total >= 80)
      .map(([file, f]) => ({ file, f, p: pct(f.lines.covered, f.lines.total) }))
      .sort((a, b) => a.p - b.p)
      .slice(0, 25);
    parts.push(`<details><summary>Least-covered files (≥ 80 lines)</summary><div class="scroll"><table><tr><th>File</th><th>Capability</th><th class="num">Lines</th><th class="num">Coverage</th></tr>
${big.map(({ file, f, p }) => `<tr><td><code>${esc(file)}</code></td><td>${esc(model.registryForCode(file).join(', ') || '—')}</td><td class="num">${n(f.lines.total)}</td><td class="num">${bar(p)}</td></tr>`).join('')}
</table></div></details>`);
    const orphan = Object.keys(coverage.files).filter((f) => model.registryForCode(f).length === 0);
    if (orphan.length)
      parts.push(`<details><summary>Measured files no capability owns (${orphan.length})</summary><p class="note">Add them to a capability's <code>code:</code> globs.</p>
<ul class="note">${orphan.slice(0, 300).map((f) => `<li><code>${esc(f)}</code></li>`).join('')}</ul></details>`);
  }

  // 3. Failures
  parts.push(`<h2 id="failures">3. Failures</h2>`);
  if (!failures.length) parts.push('<p class="muted">No failures.</p>');
  else
    parts.push(`<div class="scroll"><table><tr><th>Capability</th><th>Test</th><th>Result</th><th>Configuration</th><th>Error</th></tr>
${failures
  .map((t) => {
    const bad = t.executions.filter((x) => x.status === 'failed' || x.status === 'unexpected-pass');
    const msg =
      t.status === 'unexpected-pass'
        ? `Expected to fail (${t.issues.join('; ')}) but passed: the behaviour changed. Check it, remove knownFailure() and keep the test with issue().`
        : bad.map((x) => x.error).filter(Boolean)[0] || '';
    return `<tr><td>${esc(t.capability || '—')}</td><td><a href="#t-${t.id}">${esc(t.title)}</a><div class="note"><a href="${srcLink(m, t.file, t.line)}">${esc(t.file)}:${t.line}</a></div>
${t.needsReview.map((r) => `<div class="note">⚑ Needs review — ${code(r)}</div>`).join('')}</td><td>${pill(t.status)}</td>
<td class="note">${esc(bad.map((x) => x.run + (x.project !== 'chromium' ? `/${x.project}` : '')).join(', '))}</td><td class="err">${esc(msg)}</td></tr>`;
  })
  .join('')}</table></div>`);

  // 4. Changes
  parts.push(`<h2 id="changes">4. New &amp; modified tests since ${esc(m.baseline?.tag || 'the last release')}</h2>`);
  if (!changed.length) parts.push(`<p class="muted">${m.historyAvailable ? 'None.' : 'Git history was not available (shallow checkout).'}</p>`);
  else {
    const byCap = new Map();
    for (const t of changed) {
      const k = t.capability || '—';
      if (!byCap.has(k)) byCap.set(k, []);
      byCap.get(k).push(t);
    }
    parts.push(`<div class="scroll"><table><tr><th>Capability</th><th class="num">New</th><th class="num">Modified</th><th>Tests</th></tr>
${[...byCap]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(
    ([k, ts]) => `<tr><td>${caps.get(k) ? `<a href="#cap-${k}">${esc(caps.get(k).name)}</a>` : esc(k)}</td><td class="num">${ts.filter((t) => t.history.change === 'new').length}</td>
<td class="num">${ts.filter((t) => t.history.change === 'modified').length}</td><td><details><summary>${ts.length} tests</summary>
${ts.map((t) => `<div>${changePill(t)} <a href="#t-${t.id}">${esc(t.title)}</a> <span class="note">${esc(t.history.modified || t.history.added || '')}</span></div>`).join('')}</details></td></tr>`,
  )
  .join('')}</table></div>`);
  }

  // 5. Capabilities
  parts.push(`<h2 id="capabilities">5. Capabilities and test procedures</h2>
<p class="legend">Each capability lists the code it owns, its planned behaviours (✓ automated by a test that claims it with <code>scenario()</code>, ○ not yet automated)
and its tests. Open a table to see every test, its result in each configuration, and when it was added or last changed.</p>`);
  for (const top of tops) {
    parts.push(`<h2 id="cap-${top.id}" style="font-size:18px">${esc(top.name)} <span class="note">${esc(top.id)}</span></h2><p>${code(top.description)}</p>
${top.specs.length ? `<p class="kv">Specs: ${top.specs.map((s) => `<a href="https://github.com/${esc(m.repository)}/tree/development/${esc(s)}">${esc(s)}</a>`).join(', ')}</p>` : ''}`);
    for (const cid of top.children) parts.push(renderCap(caps.get(cid), m));
  }

  // 6. Known issues
  parts.push(`<h2 id="known">6. Known issues</h2>`);
  if (!known.length) parts.push('<p class="muted">No known failures. Known failures are tests marked <code>knownFailure(ticket, why)</code>.</p>');
  else {
    const byIssue = new Map();
    for (const t of known) for (const i of t.issues.length ? t.issues : ['(no ticket)']) {
      const k = i.split(':')[0];
      if (!byIssue.has(k)) byIssue.set(k, []);
      byIssue.get(k).push({ t, i });
    }
    parts.push(
      [...byIssue]
        .map(([k, list]) => `<h4>${esc(k)}</h4><ul>${list.map(({ t, i }) => `<li><a href="#t-${t.id}">${esc(t.title)}</a> — <span class="note">${code(i)}</span></li>`).join('')}</ul>`)
        .join(''),
    );
  }

  // 7. Gaps
  parts.push(`<h2 id="gaps">7. Traceability gaps</h2>`);
  const gap = [];
  if (unmapped.length)
    gap.push(`<h4>Tests not mapped to a capability (${unmapped.length})</h4><p class="note">Add the spec file to a capability's <code>tests:</code> globs or tag the test <code>@cap:&lt;id&gt;</code>.</p>
<ul>${unmapped.map((t) => `<li><code>${esc(t.file)}:${t.line}</code> ${esc(t.title)}</li>`).join('')}</ul>`);
  if (unknownTags.length)
    gap.push(`<h4>Tests tagged with an unknown capability (${unknownTags.length})</h4><ul>${unknownTags.map((t) => `<li><code>@cap:${esc(t.declaredCapability)}</code> — <code>${esc(t.file)}:${t.line}</code> ${esc(t.title)}</li>`).join('')}</ul>`);
  if (emptyCaps.length) gap.push(`<h4>Capabilities with no tests in this run (${emptyCaps.length})</h4><ul>${emptyCaps.map((c) => `<li><a href="#cap-${c.id}">${esc(c.name)}</a> <span class="note">${esc(c.id)} · ${esc(c.status)}</span></li>`).join('')}</ul>`);
  if (plannedScenarios.length)
    gap.push(`<h4>Planned behaviours not yet automated (${plannedScenarios.length})</h4><ul>${plannedScenarios.map((p) => `<li>${esc(p.scenario)} <span class="note">— ${esc(p.capability)}</span></li>`).join('')}</ul>`);
  parts.push(gap.join('') || '<p class="muted">None.</p>');

  // 8. Runs
  const runRows = m.runs
    .map((r) => {
      const ex = data.tests.flatMap((t) => t.executions.filter((x) => x.run === r));
      const c = (s) => ex.filter((x) => x.status === s).length;
      return `<tr><td>${esc(r)}</td><td class="num">${n(ex.length)}</td><td class="num">${n(c('passed') + c('flaky'))}</td><td class="num">${n(c('failed') + c('unexpected-pass'))}</td><td class="num">${n(c('known'))}</td><td class="num">${n(c('skipped'))}</td><td class="num">${n(c('flaky'))}</td></tr>`;
    })
    .join('');
  parts.push(`<h2 id="runs">8. Test configurations</h2><p class="legend">Each configuration is one CI job or step (site access mode, login provider, browser, tier shard).</p>
<div class="scroll"><table><tr><th>Configuration</th><th class="num">Executions</th><th class="num">Passed</th><th class="num">Failed</th><th class="num">Known</th><th class="num">Skipped</th><th class="num">Flaky</th></tr>${runRows}</table></div>`);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MMGIS Test Report</title><style>${CSS}</style></head><body><main>${parts.join('\n')}</main></body></html>`;
}

function renderCap(c, m) {
  const cov = c.coverage ? ` · line coverage ${fmtPct(pct(c.coverage.lines.covered, c.coverage.lines.total))} of ${n(c.coverage.files)} files` : '';
  const scen = [...c.scenarioTests];
  const rows = c.tests
    .slice()
    .sort((a, b) => (a.file + a.line).localeCompare(b.file + b.line, undefined, { numeric: true }))
    .map((t) => {
      const runs = t.executions
        .map((x) => `<span class="pill s-${x.status}" title="${esc(STATUS_LABEL[x.status])}">${esc(x.run + (x.project && x.project !== 'chromium' ? '/' + x.project : ''))}</span>`)
        .join(' ');
      const notes = [
        ...t.about.map((a) => code(a)),
        ...t.issues.map((i) => `Issue: ${code(i)}`),
        ...t.needsReview.map((i) => `⚑ Needs review: ${code(i)}`),
        ...t.skipReasons.map((s) => `Skipped: ${esc(s)}`),
        ...t.scenarios.map((s) => `Scenario: ${esc(s)}`),
      ];
      const hist = t.history?.added ? `added ${t.history.added}${t.history.modified ? `, changed ${t.history.modified}` : ''}` : '';
      return `<tr id="t-${t.id}"><td>${t.describe ? `<span class="note">${esc(t.describe)} ›</span> ` : ''}${esc(t.title)}${notes.length ? `<div class="note">${notes.join('<br>')}</div>` : ''}</td>
<td class="note nw"><a href="${srcLink(m, t.file, t.line)}">${esc(t.file.split("/").pop())}:${t.line}</a></td><td class="nw">${pill(t.status)}</td><td>${runs}</td>
<td class="nw">${changePill(t)}<div class="note">${esc(hist)}</div></td></tr>`;
    })
    .join('');
  return `<section class="cap"><h3 id="cap-${c.id}">${esc(c.name)} <span class="note">${esc(c.id)}${c.status !== 'active' ? ' · ' + esc(c.status) : ''}</span></h3>
<p>${code(c.description)}${c.reason ? ` <i>(${esc(c.reason)})</i>` : ''}</p>
<p class="kv">${n(c.counts.total)} tests: ${n(c.counts.passed + c.counts.flaky)} passed, ${n(c.counts.failed + c.counts['unexpected-pass'])} failed, ${n(c.counts.known)} known, ${n(c.counts.skipped)} skipped · ${n(c.counts.new)} new, ${n(c.counts.modified)} modified${cov}</p>
${c.code.length ? `<p class="kv">Code: ${c.code.map((g) => `<code>${esc(g)}</code>`).join(' ')}</p>` : ''}
${scen.length ? `<h4>Planned behaviours</h4><ul class="sc">${scen.map(([s, ids]) => `<li class="${ids.length ? 'done' : 'todo'}">${esc(s)}${ids.length ? ` — ${ids.map((id) => `<a href="#t-${id}">test</a>`).join(', ')}` : ''}</li>`).join('')}</ul>` : ''}
${c.tests.length ? `<details><summary>${n(c.tests.length)} tests</summary><div class="scroll"><table class="proc"><colgroup><col style="width:47%"><col style="width:19%"><col style="width:10%"><col style="width:12%"><col style="width:12%"></colgroup><tr><th>Test</th><th>Source</th><th>Result</th><th>Configurations</th><th>Change</th></tr>${rows}</table></div></details>` : '<p class="muted">No tests yet.</p>'}
</section>`;
}

// ───────────────────────────────────────────────────────────── Markdown
function renderMarkdown(model) {
  const { data, caps, totals, failures, unmapped, unknownTags, coverage, changed } = model;
  const m = data.meta;
  const ok = failures.length === 0 && unmapped.length === 0 && unknownTags.length === 0;
  const L = [];
  L.push(`### ${ok ? '✅' : '❌'} MMGIS tests — ${m.tier} tier`);
  L.push('');
  L.push(
    `**${n(totals.total)}** tests · **${n(totals.passed + totals.flaky)}** passed · **${n(totals.failed + totals['unexpected-pass'])}** failed · ${n(totals.known)} known issues · ${n(totals.skipped)} skipped · ` +
      `**${n(totals.new)}** new / ${n(totals.modified)} modified since ${m.baseline?.tag || 'last release'}` +
      (coverage ? ` · line coverage **${fmtPct(pct(coverage.totals.lines.covered, coverage.totals.lines.total))}**` : ''),
  );
  L.push('');
  L.push('| Capability | Tests | Passed | Failed | Known | Skipped | New | Coverage |');
  L.push('|---|--:|--:|--:|--:|--:|--:|--:|');
  for (const c of caps.values()) {
    if (c.parent) continue;
    const k = c.counts;
    L.push(
      `| ${c.name} | ${k.total} | ${k.passed + k.flaky} | ${k.failed + k['unexpected-pass'] ? `**${k.failed + k['unexpected-pass']}**` : 0} | ${k.known} | ${k.skipped} | ${k.new} | ${c.coverage ? fmtPct(pct(c.coverage.lines.covered, c.coverage.lines.total)) : '–'} |`,
    );
  }
  if (failures.length) {
    L.push('', `<details open><summary><b>Failures (${failures.length})</b></summary>`, '');
    for (const t of failures.slice(0, 30)) {
      const err = t.status === 'unexpected-pass' ? `expected to fail (${t.issues.join('; ')}) but passed` : t.executions.find((x) => x.error)?.error || '';
      L.push(`- \`${t.capability || 'unmapped'}\` **${t.title}** — \`${t.file}:${t.line}\`${err ? ` — ${err.slice(0, 200)}` : ''}`);
    }
    if (failures.length > 30) L.push(`- …and ${failures.length - 30} more (see the report).`);
    L.push('', '</details>');
  }
  if (changed.length) {
    const byCap = {};
    for (const t of changed) byCap[t.capability || 'unmapped'] = (byCap[t.capability || 'unmapped'] || 0) + 1;
    L.push('', `<details><summary>New/modified tests by capability (${changed.length})</summary>`, '');
    for (const [k, v] of Object.entries(byCap).sort()) L.push(`- \`${k}\`: ${v}`);
    L.push('', '</details>');
  }
  if (unmapped.length || unknownTags.length) {
    L.push('', `**Not mapped to a capability:** ${unmapped.length + unknownTags.length} tests — see §7 of the report.`);
  }
  return L.join('\n') + '\n';
}

// ─────────────────────────────────────────────────────────────── JSON
function renderTraceability(model) {
  const { data, caps, unmapped, unknownTags } = model;
  const slim = (t) => ({
    id: t.id,
    title: t.title,
    describe: t.describe,
    file: t.file,
    line: t.line,
    status: t.status,
    change: t.history?.change || null,
    added: t.history?.added || null,
    modified: t.history?.modified || null,
    via: t.via,
    scenarios: t.scenarios,
    issues: t.issues,
  });
  return {
    schema: 1,
    meta: data.meta,
    capabilities: [...caps.values()].map((c) => ({
      id: c.id,
      name: c.name,
      parent: c.parent,
      status: c.status,
      description: c.description,
      code: c.code,
      specs: c.specs,
      counts: c.counts,
      coverage: c.coverage || null,
      scenarios: [...c.scenarioTests].map(([text, tests]) => ({ text, tests })),
      tests: c.tests.map(slim),
    })),
    unmapped: unmapped.map(slim),
    unknownCapabilityTags: unknownTags.map((t) => ({ ...slim(t), declared: t.declaredCapability })),
  };
}

function renderSummary(model) {
  const { data, caps, totals, coverage } = model;
  return {
    schema: 1,
    meta: data.meta,
    totals,
    coverage: coverage ? coverage.totals : null,
    capabilities: Object.fromEntries([...caps.values()].map((c) => [c.id, { name: c.name, parent: c.parent, counts: c.counts, coverage: c.coverage || null }])),
  };
}

export function render({ data, registry = loadRegistry(), outputDir, coverage = loadCoverage() }) {
  const model = buildModel(data, registry, coverage);
  model.registryForCode = (f) => registry.forCode(f);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'index.html'), renderHtml(model));
  fs.writeFileSync(path.join(outputDir, 'overview.md'), renderMarkdown(model));
  fs.writeFileSync(path.join(outputDir, 'traceability.json'), JSON.stringify(renderTraceability(model), null, 1));
  fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(renderSummary(model), null, 1));
  return model;
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => {
    const i = process.argv.indexOf(k);
    return i > 0 ? process.argv[i + 1] : d;
  };
  const out = path.resolve(arg('--out', 'test-report'));
  const data = JSON.parse(fs.readFileSync(path.resolve(arg('--data', path.join(out, 'data.json'))), 'utf8'));
  const model = render({ data, outputDir: out });
  console.log(`[render] ${model.totals.total} tests → ${path.join(out, 'index.html')}`);
}

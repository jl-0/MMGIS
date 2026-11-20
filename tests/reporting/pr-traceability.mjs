// PR traceability: what does this change do to tests, per capability?
//
//   node tests/reporting/pr-traceability.mjs --base origin/development [--out test-report] [--strict]
//
// Compares HEAD with its merge-base with --base and writes
//   pr-traceability.json  machine-readable (for Devin / any LLM reviewer)
//   pr-traceability.md    the same as a PR-comment section
//
// Findings (advisory unless --strict, which exits 1 on any "error"):
//   error    a spec file that maps to no capability; a test tagged with an unknown @cap:
//   warning  product code changed in a capability with no new/changed test in that capability
//            (or its parent/children); tests removed; changed code no capability owns
//   info     tests added / changed per capability
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadRegistry, listSpecFiles, REPO_ROOT, CAP_TAG_PREFIX } from './lib/registry.mjs';
import { parseTests } from './lib/spec-ast.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const base = arg('--base', process.env.MMGIS_PR_BASE || 'origin/development');
const outDir = path.resolve(arg('--out', 'test-report'));
const strict = process.argv.includes('--strict');
const git = (...a) => execFileSync('git', a, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

let mergeBase;
try {
  mergeBase = git('merge-base', base, 'HEAD').trim();
} catch {
  console.error(`[pr-traceability] cannot find merge-base with ${base} (fetch it first, e.g. git fetch origin development)`);
  process.exit(2);
}

const registry = loadRegistry();
const specSet = new Set(listSpecFiles());
const isSpec = (f) => specSet.has(f) || /(^tests\/.*|\/tests\/[^/]*)\.spec\.js$/.test(f);
const changed = git('diff', '--name-status', '-M', `${mergeBase}`, 'HEAD')
  .split('\n')
  .filter(Boolean)
  .map((l) => {
    const [st, a, b] = l.split('\t');
    return { status: st[0], file: b || a, from: b ? a : null };
  });
const showBase = (f) => {
  try {
    return git('show', `${mergeBase}:${f}`);
  } catch {
    return '';
  }
};
const readHead = (f) => {
  try {
    return fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
  } catch {
    return '';
  }
};

const findings = [];
const capTests = new Map(); // capability → { added: [], modified: [], removed: [] }
const bucket = (id) => {
  if (!capTests.has(id)) capTests.set(id, { added: [], modified: [], removed: [] });
  return capTests.get(id);
};

// ── tests
for (const c of changed.filter((x) => isSpec(x.file) || (x.from && isSpec(x.from)))) {
  const headSrc = c.status === 'D' ? '' : readHead(c.file);
  const baseSrc = c.status === 'A' ? '' : showBase(c.from || c.file);
  const headTests = parseTests(headSrc);
  const baseTests = new Map(parseTests(baseSrc).map((t) => [t.key, t]));
  const fileCap = registry.forFile(c.file);
  const tagsOf = (src) => [...src.matchAll(new RegExp(`${CAP_TAG_PREFIX}([A-Za-z0-9_.-]+)`, 'g'))].map((m) => m[1]);
  for (const id of tagsOf(headSrc)) {
    if (!registry.get(id)) findings.push({ level: 'error', file: c.file, message: `unknown capability in tag ${CAP_TAG_PREFIX}${id}` });
  }
  if (c.status !== 'D' && !fileCap && !tagsOf(headSrc).length) {
    findings.push({
      level: 'error',
      file: c.file,
      message: 'spec file maps to no capability — add it to a `tests:` list in tests/capabilities/capabilities.yml or tag its describe with @cap:<id>',
    });
  }
  // Tests are attributed to the file's capability; a test-level @cap: tag is resolved
  // by the full report, this check stays file-level to remain fast and static.
  const cap = fileCap || 'unmapped';
  for (const t of headTests) {
    const old = baseTests.get(t.key);
    const ref = { file: c.file, line: t.start, title: t.key };
    if (!old) bucket(cap).added.push(ref);
    else if (old.body !== t.body) bucket(cap).modified.push(ref);
    baseTests.delete(t.key);
  }
  for (const t of baseTests.values()) bucket(cap).removed.push({ file: c.from || c.file, line: t.start, title: t.key });
}

// ── product code
const codeCaps = new Map(); // capability → files
const unowned = [];
const NOT_PRODUCT = /^(tests\/|docs\/|specs\/|\.knowledge\/|\.specify\/|\.claude\/|\.devin\/|blueprints\/.*\.md$|.*\.md$|package-lock\.json$|\.github\/(?!workflows\/))/;
for (const c of changed) {
  if (isSpec(c.file) || NOT_PRODUCT.test(c.file) || c.file.includes('/tests/')) continue;
  const ids = registry.forCode(c.file);
  if (!ids.length) {
    if (/\.(m?js|jsx|ts|tsx|py|pug|json|css)$/.test(c.file)) unowned.push(c.file);
    continue;
  }
  for (const id of ids) {
    if (!codeCaps.has(id)) codeCaps.set(id, []);
    codeCaps.get(id).push(c.file);
  }
}
const related = (id) => {
  const c = registry.get(id);
  return [id, c?.parent, ...(c?.children || [])].filter(Boolean);
};
for (const [id, files] of codeCaps) {
  const touched = related(id).some((r) => capTests.has(r) && (capTests.get(r).added.length || capTests.get(r).modified.length));
  if (!touched) {
    findings.push({
      level: 'warning',
      capability: id,
      message: `product code changed in \`${id}\` (${files.length} file${files.length > 1 ? 's' : ''}) with no new or changed test in that capability`,
      files,
    });
  }
}
for (const [id, t] of capTests) {
  if (t.removed.length) findings.push({ level: 'warning', capability: id, message: `${t.removed.length} test(s) removed from \`${id}\` — confirm the behaviour is still covered elsewhere`, tests: t.removed });
}
if (unowned.length) findings.push({ level: 'warning', message: `${unowned.length} changed file(s) owned by no capability — add them to a \`code:\` glob`, files: unowned });

// ── output
const report = {
  schema: 1,
  base,
  mergeBase,
  head: git('rev-parse', 'HEAD').trim(),
  capabilities: [...new Set([...capTests.keys(), ...codeCaps.keys()])].sort().map((id) => ({
    id,
    name: registry.get(id)?.name || id,
    codeChanged: codeCaps.get(id) || [],
    testsAdded: capTests.get(id)?.added || [],
    testsModified: capTests.get(id)?.modified || [],
    testsRemoved: capTests.get(id)?.removed || [],
  })),
  findings,
  guidance:
    'Each behaviour change should come with tests in the capability that owns the changed code. New spec files must map to a capability ' +
    '(tests/capabilities/capabilities.yml). See docs/pages/Contributing/Testing/Testing.md.',
};

const L = ['#### Capability traceability', ''];
L.push(`Compared with \`${base}\` (merge-base \`${mergeBase.slice(0, 10)}\`).`, '');
if (report.capabilities.length) {
  L.push('| Capability | Code files changed | Tests added | Tests changed | Tests removed |', '|---|--:|--:|--:|--:|');
  for (const c of report.capabilities) {
    L.push(`| \`${c.id}\` ${c.name} | ${c.codeChanged.length} | ${c.testsAdded.length} | ${c.testsModified.length} | ${c.testsRemoved.length} |`);
  }
} else L.push('_No product code or tests changed._');
const icon = { error: '❌', warning: '⚠️', info: 'ℹ️' };
if (findings.length) {
  L.push('');
  for (const f of findings) {
    L.push(`- ${icon[f.level]} ${f.file ? `\`${f.file}\`: ` : ''}${f.message}`);
    for (const x of (f.files || []).slice(0, 8)) L.push(`  - \`${x}\``);
    if ((f.files || []).length > 8) L.push(`  - …and ${f.files.length - 8} more`);
  }
}
const added = report.capabilities.flatMap((c) => c.testsAdded.map((t) => ({ ...t, cap: c.id })));
if (added.length) {
  L.push('', `<details><summary>Tests added (${added.length})</summary>`, '');
  for (const t of added.slice(0, 80)) L.push(`- \`${t.cap}\` ${t.title} — \`${t.file}:${t.line}\``);
  if (added.length > 80) L.push(`- …and ${added.length - 80} more`);
  L.push('', '</details>');
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'pr-traceability.json'), JSON.stringify(report, null, 1));
fs.writeFileSync(path.join(outDir, 'pr-traceability.md'), L.join('\n') + '\n');
console.log(L.join('\n'));
if (strict && findings.some((f) => f.level === 'error')) process.exit(1);

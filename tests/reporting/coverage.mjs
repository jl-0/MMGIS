// Turns the raw coverage written during a test run into reports.
//
// Sources (all optional; whatever exists is used):
//   coverage/node-v8/     NODE_V8_COVERAGE output: unit-test workers and the e2e test server
//   coverage/browser-v8/  Chromium JS coverage written by tests/helpers/test.js
//   --merge <dir>...      `raw` reports from other CI jobs (see below)
//
// Outputs (in coverage/ unless --out):
//   raw/                  mergeable raw data — CI uploads this from every job
//   lcov.info             for SonarQube / editors
//   index.html            monocart coverage browser (per-file, source view)
//   coverage-files.json   per-file line/branch/function totals; the capability report
//                         (tests/reporting/render.mjs) aggregates it per capability
//
// Usage:
//   node tests/reporting/coverage.mjs                      # one job: raw + reports
//   node tests/reporting/coverage.mjs --raw-only           # one CI job: raw only
//   node tests/reporting/coverage.mjs --merge a/raw b/raw  # report job: merge everything
import fs from 'node:fs';
import path from 'node:path';
import { CoverageReport } from 'monocart-coverage-reports';
import { REPO_ROOT } from './lib/registry.mjs';

const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const listArg = (k) => {
  const i = args.indexOf(k);
  if (i < 0) return [];
  const out = [];
  for (let j = i + 1; j < args.length && !args[j].startsWith('--'); j++) out.push(path.resolve(args[j]));
  return out;
};
const outDir = path.resolve(listArg('--out')[0] || process.env.MMGIS_COVERAGE_DIR || path.join(REPO_ROOT, 'coverage'));
const nodeDir = path.join(outDir, 'node-v8');
const browserDir = path.join(outDir, 'browser-v8');
const mergeDirs = listArg('--merge').filter((d) => fs.existsSync(d));
const rawOnly = flag('--raw-only');

// Product code only: no tests, fixtures, scaffolds, vendored or built files.
const EXCLUDE = [
  /(^|\/)node_modules\//,
  /(^|\/)tests?\//,
  /\.spec\.js$/,
  /\.test\.js$/,
  /^plugin-cli\/scaffolds\//,
  /^build\//,
  /^configure\/build\//,
  /^public\//,
  /\.min\.js$/,
  /^docs\//,
  /^Missions\//,
];
const INCLUDE = /^(API|scripts|src|plugins\/core|configure\/src|adjacent-servers|spice|private)\/.*\.(m?js|jsx)$/;
const keepSource = (p) => INCLUDE.test(p) && !EXCLUDE.some((re) => re.test(p));

/** Normalises every source path to a repo-relative path. */
function normalise(filePath) {
  let p = filePath.replace(/\\/g, '/');
  p = p.replace(/^file:\/\//, '');
  if (p.startsWith(REPO_ROOT + '/')) p = p.slice(REPO_ROOT.length + 1);
  // CRA (configure/): webpack://configure/./src/x.js
  let m = p.match(/^webpack:\/\/configure\/\.?\/?(.*)$/);
  if (m) return 'configure/' + m[1].replace(/^\.\//, '');
  m = p.match(/^webpack:\/\/[^/]*\/\.?\/?(.*)$/);
  if (m) p = m[1];
  // MMGIS production build: paths relative to src/ (devtoolModuleFilenameTemplate)
  if (!/^(API|scripts|src|plugins|configure|adjacent-servers|spice|private|node_modules)\//.test(p)) {
    p = path.posix.normalize('src/' + p);
  }
  return p.replace(/^(\.\.\/)+/, '');
}

const area = (p) =>
  /^configure\//.test(p)
    ? 'Configure (browser)'
    : /^src\//.test(p) || /^plugins\/core\/(tools|components|interactions|layertypes|layerattachments)\//.test(p)
      ? 'Mission viewer (browser)'
      : 'Server (Node.js)';

/** Reads Chromium coverage written by tests/helpers/test.js and attaches sources + source maps. */
function* browserEntries() {
  if (!fs.existsSync(browserDir)) return;
  const sources = new Map();
  const mapFor = (url, source) => {
    const m = source.match(/\/\/[#@] sourceMappingURL=([^\s'"]+)\s*$/m);
    if (!m || m[1].startsWith('data:')) return undefined;
    const u = new URL(m[1], url);
    // /build/... → build/..., /configure/build/... → configure/build/...
    const local = path.join(REPO_ROOT, decodeURIComponent(u.pathname.replace(/^\/+/, '')));
    try {
      return JSON.parse(fs.readFileSync(local, 'utf8'));
    } catch {
      return undefined;
    }
  };
  for (const f of fs.readdirSync(browserDir)) {
    if (!f.startsWith('coverage-')) continue;
    const list = JSON.parse(fs.readFileSync(path.join(browserDir, f), 'utf8'));
    const out = [];
    for (const e of list) {
      if (!e.sourceHash) continue;
      if (!sources.has(e.sourceHash)) {
        const source = fs.readFileSync(path.join(browserDir, `source-${e.sourceHash}.txt`), 'utf8');
        sources.set(e.sourceHash, { source, sourceMap: mapFor(e.url, source) });
      }
      const { source, sourceMap } = sources.get(e.sourceHash);
      if (!sourceMap) continue; // without a map we cannot attribute bundle code to files
      out.push({ url: e.url, scriptId: e.scriptId, functions: e.functions, source, sourceMap });
    }
    if (out.length) yield out;
  }
}

const options = {
  name: 'MMGIS coverage',
  outputDir: outDir,
  clean: false,
  baseDir: REPO_ROOT,
  inputDir: mergeDirs.length ? mergeDirs : undefined,
  entryFilter: (entry) => {
    const url = entry.url || '';
    if (url.startsWith('file://')) return keepSource(normalise(url));
    return /^https?:\/\//.test(url); // browser bundles: filtered per source below
  },
  sourceFilter: (p) => keepSource(normalise(p)),
  sourcePath: (p) => normalise(p),
  reports: rawOnly
    ? [['raw', { outputDir: 'raw' }]]
    : [
        ['raw', { outputDir: 'raw' }],
        ['lcovonly', { file: 'lcov.info' }],
        ['v8', { outputFile: 'index.html' }],
        ['console-summary'],
      ],
  // Count files that no test loaded at all (0%), so coverage is not flattered.
  all: rawOnly
    ? undefined
    : {
        dir: ['API', 'scripts', 'plugins/core'],
        filter: (p) => keepSource(normalise(p)) && !/^plugins\/core\/(tools|components|interactions|layertypes|layerattachments)\//.test(normalise(p)),
      },
  onEnd: (results) => {
    if (rawOnly || !results) return;
    const files = {};
    for (const f of results.files || []) {
      const rel = normalise(f.sourcePath);
      if (!keepSource(rel)) continue;
      const s = f.summary;
      files[rel] = {
        area: area(rel),
        lines: { total: s.lines.total, covered: s.lines.covered },
        branches: { total: s.branches.total, covered: s.branches.covered },
        functions: { total: s.functions.total, covered: s.functions.covered },
      };
    }
    const sum = (list) => {
      const t = { files: list.length, lines: { total: 0, covered: 0 }, branches: { total: 0, covered: 0 }, functions: { total: 0, covered: 0 } };
      for (const f of list) for (const k of ['lines', 'branches', 'functions']) {
        t[k].total += f[k].total;
        t[k].covered += f[k].covered;
      }
      return t;
    };
    const byArea = {};
    for (const f of Object.values(files)) (byArea[f.area] ||= []).push(f);
    const doc = {
      generated: new Date().toISOString(),
      note: process.env.MMGIS_COVERAGE_NOTE || '',
      totals: sum(Object.values(files)),
      byArea: Object.fromEntries(Object.entries(byArea).sort().map(([k, v]) => [k, sum(v)])),
      files,
    };
    fs.writeFileSync(path.join(outDir, 'coverage-files.json'), JSON.stringify(doc, null, 1));
  },
};

const mcr = new CoverageReport(options);
if (fs.existsSync(nodeDir) && fs.readdirSync(nodeDir).length) await mcr.addFromDir(nodeDir);
for (const batch of browserEntries()) await mcr.add(batch);
await mcr.generate();
console.log(`[coverage] ${rawOnly ? 'raw data' : 'reports'} written to ${path.relative(process.cwd(), outDir) || '.'}`);

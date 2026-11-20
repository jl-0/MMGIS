// Playwright reporter: collects every test with its capability, outcome, annotations
// and git history into test-report/data.json, then renders the report.
//
// Works on a live run and on `playwright merge-reports` (CI merges the blob reports of
// every job — unit, e2e auth modes, proxy, full-tier shards, firefox — into one report).
// Each job sets MMGIS_RUN_TAG, which playwright.config.js turns into a `@run:<name>`
// tag, so the same test executed under several configurations is one test with several runs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadRegistry, relToRepo } from './lib/registry.mjs';
import { createHistory } from './lib/history.mjs';
import { render } from './render.mjs';

const RANK = { failed: 6, 'unexpected-pass': 5, known: 4, flaky: 3, passed: 2, skipped: 1 };

function execStatus(test) {
  const outcome = test.outcome();
  const last = test.results[test.results.length - 1];
  if (outcome === 'skipped') return 'skipped';
  if (outcome === 'flaky') return 'flaky';
  if (outcome === 'expected') return test.expectedStatus === 'failed' ? 'known' : 'passed';
  // unexpected
  if (test.expectedStatus === 'failed' && last && last.status === 'passed') return 'unexpected-pass';
  return 'failed';
}

const firstLine = (s) => (s || '').replace(/\u001b\[[0-9;]*m/g, '').split('\n').find((l) => l.trim()) || '';

export default class CapabilityReporter {
  constructor(options = {}) {
    this.outputDir = path.resolve(options.outputFolder || process.env.MMGIS_REPORT_DIR || 'test-report');
    this.render = options.render !== false;
  }

  printsToStdio() {
    return false;
  }

  onBegin(config, suite) {
    this.config = config;
    this.suite = suite;
    this.start = Date.now();
  }

  async onEnd(result) {
    const registry = loadRegistry();
    const history = createHistory();
    const tests = new Map();

    for (const t of this.suite.allTests()) {
      const file = relToRepo(t.location.file);
      const titles = t.titlePath().slice(3); // ['', project, file, ...describes, title]
      const key = `${file} › ${titles.join(' › ')}`;
      const project = t.parent.project()?.name || '';
      const runTag = t.tags.find((x) => x.startsWith('@run:'));
      const run = runTag ? runTag.slice(5) : process.env.MMGIS_RUN_TAG || 'local';
      const last = t.results[t.results.length - 1];
      const annotations = [...(t.annotations || []), ...((last && last.annotations) || [])];
      const status = execStatus(t);

      let entry = tests.get(key);
      if (!entry) {
        const cap = registry.forTest({ file, tags: t.tags });
        entry = {
          id: crypto.createHash('sha1').update(key).digest('hex').slice(0, 12),
          key,
          file,
          line: t.location.line,
          title: t.title,
          describe: titles.slice(0, -1).join(' › '),
          capability: cap.id && registry.get(cap.id) ? cap.id : null,
          declaredCapability: cap.id,
          via: cap.via,
          tags: t.tags.filter((x) => !x.startsWith('@run:') && !x.startsWith('@cap:')),
          status,
          executions: [],
          issues: [],
          needsReview: [],
          scenarios: [],
          about: [],
          skipReasons: [],
          history: history.forTest(file, t.location.line),
        };
        tests.set(key, entry);
      }
      if (RANK[status] > RANK[entry.status]) entry.status = status;
      entry.executions.push({
        run,
        project,
        status,
        durationMs: t.results.reduce((s, r) => s + (r.duration || 0), 0),
        retries: Math.max(0, t.results.length - 1),
        error: status === 'failed' || status === 'unexpected-pass' ? firstLine(last?.error?.message || last?.errors?.[0]?.message) : undefined,
      });
      const add = (arr, v) => v && !arr.includes(v) && arr.push(v);
      for (const a of annotations) {
        if (a.type === 'issue') add(entry.issues, a.description);
        else if (a.type === 'needs review') add(entry.needsReview, a.description);
        else if (a.type === 'scenario') add(entry.scenarios, a.description);
        else if (a.type === 'what it checks') add(entry.about, a.description);
        else if ((a.type === 'skip' || a.type === 'fixme') && status === 'skipped') add(entry.skipReasons, a.description || a.type);
      }
    }

    // A test that passed in one configuration and was skipped in another is "passed".
    for (const e of tests.values()) {
      const statuses = new Set(e.executions.map((x) => x.status));
      if (e.status === 'skipped' && statuses.size > 1) e.status = 'passed';
    }

    const env = process.env;
    const runUrl = env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null;
    const data = {
      schema: 1,
      meta: {
        title: 'MMGIS Test Report',
        tier: env.MMGIS_TEST_TIER || 'local',
        generated: new Date().toISOString(),
        status: result.status,
        durationMs: result.duration ?? Date.now() - this.start,
        commit: env.MMGIS_SOURCE_SHA || env.GITHUB_SHA || null,
        branch: env.MMGIS_SOURCE_BRANCH || env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || null,
        pr: env.MMGIS_PR_NUMBER || null,
        repository: env.GITHUB_REPOSITORY || 'NASA-AMMOS/MMGIS',
        runUrl,
        baseline: history.baseline,
        historyAvailable: !history.shallow,
        runs: [...new Set([...tests.values()].flatMap((e) => e.executions.map((x) => x.run)))].sort(),
      },
      tests: [...tests.values()].sort((a, b) => a.key.localeCompare(b.key)),
    };

    fs.mkdirSync(this.outputDir, { recursive: true });
    fs.writeFileSync(path.join(this.outputDir, 'data.json'), JSON.stringify(data, null, 1));
    if (this.render) {
      try {
        render({ data, registry, outputDir: this.outputDir });
      } catch (err) {
        console.error('[capability-reporter] render failed:', err);
      }
    }
  }
}

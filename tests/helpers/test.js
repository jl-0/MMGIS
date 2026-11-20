/**
 * MMGIS test entry point — import `test`/`expect` from here instead of '@playwright/test'.
 *
 *   import { test, expect, knownFailure, scenario } from '../helpers/test.js';
 *
 * It re-exports everything from @playwright/test, and adds:
 *  - browser JS coverage (Chromium, when MMGIS_COVERAGE=1) for every page the test opens,
 *    including pages in contexts created with `browser.newContext()`;
 *  - traceability annotations used by the capability report (tests/reporting/).
 *
 * See docs/pages/Contributing/Testing/Testing.md.
 */
import { test as base } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export * from '@playwright/test';

const COVERAGE = process.env.MMGIS_COVERAGE === '1' || process.env.MMGIS_COVERAGE === 'true';
const COVERAGE_DIR = path.resolve(process.env.MMGIS_COVERAGE_DIR || 'coverage');
const BROWSER_RAW = path.join(COVERAGE_DIR, 'browser-v8');

// ───────────────────────────────────────────── browser coverage plumbing
const instrumented = new WeakSet();

function writeCoverage(entries) {
  // Keep only scripts served by MMGIS itself (not CDNs, not inline eval).
  const base = process.env.TEST_BASE_URL || 'http://localhost:18888';
  const origin = new URL(base).origin;
  const keep = entries.filter((e) => e.url && e.url.startsWith(origin) && !e.url.includes('/node_modules/'));
  if (!keep.length) return;
  fs.mkdirSync(BROWSER_RAW, { recursive: true });
  // The script source is large and identical across pages: store it once per hash.
  const out = keep.map((e) => {
    if (e.source) {
      const h = crypto.createHash('sha1').update(e.source).digest('hex');
      const srcFile = path.join(BROWSER_RAW, `source-${h}.txt`);
      if (!fs.existsSync(srcFile)) fs.writeFileSync(srcFile, e.source);
      return { url: e.url, scriptId: e.scriptId, functions: e.functions, sourceHash: h };
    }
    return e;
  });
  fs.writeFileSync(path.join(BROWSER_RAW, `coverage-${crypto.randomUUID()}.json`), JSON.stringify(out));
}

async function stopPage(page) {
  if (!page.__mmgisCoverage) return;
  page.__mmgisCoverage = false;
  try {
    writeCoverage(await page.coverage.stopJSCoverage());
  } catch {
    /* page already gone */
  }
}

function startPage(page) {
  if (!page.coverage || page.__mmgisCoverage !== undefined) return;
  page.__mmgisCoverage = true;
  page.coverage.startJSCoverage({ resetOnNavigation: false, reportAnonymousScripts: false }).catch(() => {
    page.__mmgisCoverage = false;
  });
  const close = page.close.bind(page);
  page.close = async (...args) => {
    await stopPage(page);
    return close(...args);
  };
}

function instrumentContext(context) {
  if (!COVERAGE || instrumented.has(context)) return context;
  instrumented.add(context);
  context.pages().forEach(startPage);
  context.on('page', startPage);
  const close = context.close.bind(context);
  context.close = async (...args) => {
    await Promise.all(context.pages().map(stopPage));
    return close(...args);
  };
  return context;
}

// ───────────────────────────────────────────── fixtures
export const test = base.extend({
  // Contexts created by hand (`browser.newContext()`) are covered too.
  browser: [
    async ({ browser, browserName }, use) => {
      if (COVERAGE && browserName === 'chromium' && !browser.__mmgisPatched) {
        browser.__mmgisPatched = true;
        const newContext = browser.newContext.bind(browser);
        browser.newContext = async (...args) => instrumentContext(await newContext(...args));
        const newPage = browser.newPage.bind(browser);
        browser.newPage = async (...args) => {
          const page = await newPage(...args);
          instrumentContext(page.context());
          return page;
        };
      }
      await use(browser);
    },
    { scope: 'worker' },
  ],
  context: async ({ context, browserName }, use) => {
    if (COVERAGE && browserName === 'chromium') instrumentContext(context);
    await use(context);
    if (COVERAGE && browserName === 'chromium') await Promise.all(context.pages().map(stopPage));
  },
});

// ───────────────────────────────────────────── traceability helpers
const annotate = (type, description) => test.info().annotations.push({ type, description });

/**
 * A known product bug, tracked by a ticket. The test is expected to fail: the run stays
 * green while it fails, and turns red ("passed unexpectedly") once the bug is fixed —
 * then delete the knownFailure() call and keep the test as a regression test.
 * Never use this without a ticket; use needsReview() for a failure nobody has triaged yet.
 */
export function knownFailure(ticket, why) {
  annotate('issue', `${ticket}: ${why}`);
  test.fail(true, `${ticket}: ${why}`);
}

/**
 * A failure that has been seen but not yet triaged into a ticket. The test still fails
 * normally (the run is red); the note tells reviewers what is already known.
 */
export function needsReview(id, why) {
  annotate('needs review', `${id}: ${why}`);
}

/** Links a regression test to the ticket/PR of the bug it guards against. */
export function issue(ticket, what = '') {
  annotate('issue', what ? `${ticket}: ${what}` : ticket);
}

/**
 * Claims a planned behaviour from tests/capabilities/capabilities.yml (`scenarios:`),
 * so the report shows it as automated. Text must match the registry entry exactly.
 */
export function scenario(text) {
  annotate('scenario', text);
}

/** Plain-language statement of what the test checks (shown in the test procedures). */
export function about(text) {
  annotate('what it checks', text);
}

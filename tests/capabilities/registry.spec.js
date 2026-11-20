// Keeps tests/capabilities/capabilities.yml honest. Runs in the PR tier (unit tests).
// If this fails, the message says what to add or fix in the registry.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import picomatch from 'picomatch';
import { test, expect } from '../helpers/test.js';
// The registry library is ESM (.mjs); specs are compiled to CommonJS, so load it dynamically.
let registry, specs, tracked, REPO_ROOT, CAP_TAG_PREFIX;
const read = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');

test.describe('Capability registry', { tag: '@cap:platform.ci' }, () => {
  test.beforeAll(async () => {
    const lib = await import('../reporting/lib/registry.mjs');
    ({ REPO_ROOT, CAP_TAG_PREFIX } = lib);
    registry = lib.loadRegistry();
    specs = lib.listSpecFiles();
    tracked = lib.trackedFiles(execSync);
  });

  test('registry entries are well formed', () => {
    expect(registry.validateShape()).toEqual([]);
  });

  test('every spec file belongs to a capability', () => {
    const unmapped = specs.filter((f) => !registry.forFile(f));
    expect(unmapped, 'add these spec files to a capability `tests:` list in tests/capabilities/capabilities.yml').toEqual([]);
  });

  test('every `tests:` entry matches at least one spec file', () => {
    const stale = registry.list.flatMap((c) =>
      c.tests.filter((g) => !specs.some((f) => picomatch(g, { dot: true })(f))).map((g) => `${c.id}: ${g}`),
    );
    expect(stale, 'these `tests:` globs match no spec file (renamed or deleted?)').toEqual([]);
  });

  test('every `code:` entry matches at least one tracked file', () => {
    test.skip(!tracked.length, 'git ls-files unavailable');
    const stale = registry.list.flatMap((c) =>
      c.code.filter((g) => !tracked.some((f) => picomatch(g, { dot: true })(f))).map((g) => `${c.id}: ${g}`),
    );
    expect(stale, 'these `code:` globs match no file in the repository').toEqual([]);
  });

  test('`@cap:` tags in specs name a known capability', () => {
    const bad = [];
    for (const f of specs) {
      for (const m of read(f).matchAll(new RegExp(`${CAP_TAG_PREFIX}([A-Za-z0-9_.-]+)`, 'g'))) {
        if (!registry.get(m[1])) bad.push(`${f}: ${m[0]}`);
      }
    }
    expect(bad, 'unknown capability ids in @cap: tags').toEqual([]);
  });

  test('scenario() claims match a planned behaviour in the registry', () => {
    const known = new Set(registry.list.flatMap((c) => c.scenarios));
    const bad = [];
    for (const f of specs) {
      for (const m of read(f).matchAll(/\bscenario\(\s*(['"`])((?:(?!\1).)+)\1\s*\)/g)) {
        if (!known.has(m[2])) bad.push(`${f}: scenario(${m[1]}${m[2]}${m[1]})`);
      }
    }
    expect(bad, 'scenario text must match a `scenarios:` entry exactly').toEqual([]);
  });

  test('`specs:` entries point at existing spec-kit folders', () => {
    const missing = registry.list.flatMap((c) => c.specs.filter((s) => !fs.existsSync(path.join(REPO_ROOT, s))).map((s) => `${c.id}: ${s}`));
    expect(missing).toEqual([]);
  });

  test('spec files import test from tests/helpers/test.js', () => {
    // Needed for browser coverage and the traceability helpers (knownFailure, scenario, ...).
    const direct = specs.filter((f) => /from\s+['"]@playwright\/test['"]|require\(['"]@playwright\/test['"]\)/.test(read(f)));
    expect(direct, "import { test, expect } from 'tests/helpers/test.js' instead of '@playwright/test'").toEqual([]);
  });
});

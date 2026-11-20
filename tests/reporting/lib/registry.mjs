// Loads tests/capabilities/capabilities.yml and answers "which capability does this
// test / file belong to?". Used by the reporter, the traceability scripts and the
// registry check (tests/capabilities/registry.spec.js).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import picomatch from 'picomatch';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../../..');
export const REGISTRY_PATH = path.join(REPO_ROOT, 'tests/capabilities/capabilities.yml');
export const CAP_TAG_PREFIX = '@cap:';
const ID_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)?$/;

const toPosix = (p) => p.split(path.sep).join('/');
export const relToRepo = (file) => toPosix(path.isAbsolute(file) ? path.relative(REPO_ROOT, file) : file);
const isGlob = (g) => /[*?[\]{}]/.test(g);

/**
 * @typedef {{ id: string, name: string, description?: string, status: string, reason?: string,
 *   parent: string|null, depth: number, code: string[], tests: string[], specs: string[],
 *   scenarios: string[], children: string[] }} Capability
 */

export function loadRegistry(file = REGISTRY_PATH) {
  const doc = YAML.parse(fs.readFileSync(file, 'utf8')) || {};
  /** @type {Capability[]} */
  const list = [];
  const walk = (entries, parent, depth) => {
    for (const e of entries || []) {
      const cap = {
        id: e.id,
        name: e.name || e.id,
        description: (e.description || '').trim(),
        status: e.status || 'active',
        reason: e.reason,
        parent: parent ? parent.id : null,
        depth,
        code: e.code || [],
        tests: e.tests || [],
        specs: e.specs || [],
        scenarios: e.scenarios || [],
        children: [],
      };
      list.push(cap);
      if (parent) parent.children.push(cap.id);
      walk(e.children, cap, depth + 1);
    }
  };
  walk(doc.capabilities, null, 0);
  return new Registry(list);
}

export class Registry {
  /** @param {Capability[]} list */
  constructor(list) {
    this.list = list;
    this.byId = new Map(list.map((c) => [c.id, c]));
    // Pre-compile matchers. Exact paths beat globs; globs keep file order.
    this._exact = new Map();
    this._globs = [];
    for (const c of list) {
      for (const g of c.tests) {
        if (isGlob(g)) this._globs.push({ id: c.id, glob: g, re: picomatch(g, { dot: true }) });
        else if (!this._exact.has(g)) this._exact.set(g, c.id);
      }
    }
    this._code = list.flatMap((c) =>
      c.code.map((g) => ({ id: c.id, glob: g, exact: !isGlob(g), re: picomatch(g, { dot: true }) })),
    );
  }

  get(id) {
    return this.byId.get(id);
  }

  top() {
    return this.list.filter((c) => !c.parent);
  }

  /** Top-level capability id for any id. */
  root(id) {
    let c = this.byId.get(id);
    while (c && c.parent) c = this.byId.get(c.parent);
    return c ? c.id : null;
  }

  /** Capability for a spec file from the `tests:` globs (null when unmapped). */
  forFile(file) {
    const rel = relToRepo(file);
    if (this._exact.has(rel)) return this._exact.get(rel);
    const hit = this._globs.find((g) => g.re(rel));
    return hit ? hit.id : null;
  }

  /** Capability for a test: explicit `@cap:` tag first, then the spec file. */
  forTest({ file, tags = [] }) {
    const tag = [...tags].reverse().find((t) => t.startsWith(CAP_TAG_PREFIX));
    if (tag) return { id: tag.slice(CAP_TAG_PREFIX.length), via: 'tag' };
    const id = this.forFile(file);
    return { id, via: id ? 'file' : null };
  }

  /**
   * Capabilities whose `code:` globs own a source file. An exact path wins over globs;
   * otherwise every matching capability is returned (shared code belongs to several).
   */
  forCode(file) {
    const rel = relToRepo(file);
    const exact = this._code.filter((c) => c.exact && c.glob === rel).map((c) => c.id);
    if (exact.length) return [...new Set(exact)];
    return [...new Set(this._code.filter((c) => c.re(rel)).map((c) => c.id))];
  }

  /** Static problems with the registry itself (no file system checks). */
  validateShape() {
    const errors = [];
    const seen = new Set();
    for (const c of this.list) {
      if (!ID_RE.test(c.id)) errors.push(`${c.id}: id must be kebab-case, at most two levels (parent.child)`);
      if (seen.has(c.id)) errors.push(`${c.id}: duplicate id`);
      seen.add(c.id);
      if (c.parent && !c.id.startsWith(c.parent + '.')) errors.push(`${c.id}: child ids must start with "${c.parent}."`);
      if (!['active', 'planned', 'excluded'].includes(c.status)) errors.push(`${c.id}: unknown status "${c.status}"`);
      if (c.status === 'excluded' && !c.reason) errors.push(`${c.id}: excluded capabilities need a reason`);
      if (!c.description) errors.push(`${c.id}: missing description`);
      if (c.parent && c.status === 'active' && c.tests.length === 0) errors.push(`${c.id}: active capability lists no tests (mark it planned?)`);
    }
    return errors;
  }
}

/** Every spec file Playwright would run (mirrors playwright.config.js testMatch/testIgnore). */
export function listSpecFiles(root = REPO_ROOT) {
  const out = [];
  const skip = new Set(['node_modules', '.git', 'build', 'playwright-report', 'test-results', 'test-report', 'coverage']);
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith('.spec.js')) out.push(relToRepo(full));
    }
  };
  for (const top of ['tests', 'plugins']) if (fs.existsSync(path.join(root, top))) walk(path.join(root, top));
  const isTest = picomatch(['tests/**/*.spec.js', 'plugins/**/tests/*.spec.js']);
  const ignored = picomatch('**/plugin-cli/scaffolds/**');
  // External plugin containers are gitignored and not part of the core suite.
  return out.filter((f) => isTest(f) && !ignored(f) && (!f.startsWith('plugins/') || f.startsWith('plugins/core/'))).sort();
}

/** Repo files tracked by git (for code-glob checks). */
export function trackedFiles(execSync) {
  try {
    return execSync('git ls-files', { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

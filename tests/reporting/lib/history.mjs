// Test history from git: when was each test added / last modified, and is that
// after the last release? No hand-written dates — everything comes from `git blame`.
//
//   added    = commit date of the line holding the test's `test(` call and title
//              (renaming a test therefore makes it a new test)
//   modified = newest commit date over every line of the test's body
//   new      = the title line's commit is not contained in the baseline release
//   modified = not new, but some body line's commit is not in the baseline release
//
// Baseline release (first that applies):
//   MMGIS_BASELINE_RELEASE=<tag> | none     explicit override
//   latest tag matching MMGIS_RELEASE_TAG_PATTERN (default ^\d+\.\d+\.\d+$, so "5.2.24-a"
//   and backup/* tags are ignored) by semantic version.
// With a shallow clone (no blame history) the dates are reported as unknown.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseTests } from './spec-ast.mjs';
import { REPO_ROOT, relToRepo } from './registry.mjs';

const git = (args, opts = {}) =>
  execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], ...opts });

const semverKey = (t) => t.split(/[.-]/).map((n) => (/^\d+$/.test(n) ? n.padStart(8, '0') : n)).join('.');

export function resolveBaseline() {
  const env = process.env.MMGIS_BASELINE_RELEASE;
  if (env === 'none') return null;
  let tag = env;
  if (!tag) {
    const re = new RegExp(process.env.MMGIS_RELEASE_TAG_PATTERN || '^\\d+\\.\\d+\\.\\d+$');
    let tags = [];
    try {
      // Only tags that are ancestors of HEAD can be "the last release" for this code.
      tags = git(['tag', '--merged', 'HEAD']).split('\n').filter((t) => re.test(t));
    } catch {
      return null;
    }
    tags.sort((a, b) => (semverKey(a) < semverKey(b) ? 1 : -1));
    tag = tags[0];
  }
  if (!tag) return null;
  try {
    const sha = git(['rev-list', '-n', '1', tag]).trim();
    const date = git(['log', '-1', '--format=%cs', sha]).trim();
    return { tag, sha, date };
  } catch {
    return { tag, sha: null, date: null };
  }
}

export function isShallow() {
  try {
    return git(['rev-parse', '--is-shallow-repository']).trim() === 'true';
  } catch {
    return true;
  }
}

/** Commits reachable from HEAD but not from the baseline: everything "since the release". */
function commitsSince(baseline) {
  if (!baseline || !baseline.sha) return null;
  try {
    return new Set(git(['rev-list', `${baseline.sha}..HEAD`]).split('\n').filter(Boolean));
  } catch {
    return null;
  }
}

/** Per-line {sha, date} for a file, via `git blame --line-porcelain` (whitespace ignored). */
function blameFile(rel) {
  const args = ['blame', '-w', '--line-porcelain'];
  if (fs.existsSync(path.join(REPO_ROOT, '.git-blame-ignore-revs'))) args.push('--ignore-revs-file', '.git-blame-ignore-revs');
  args.push('--', rel);
  let out;
  try {
    out = git(args);
  } catch {
    return null; // untracked or new file
  }
  const lines = [];
  let cur = null;
  const meta = new Map();
  for (const l of out.split('\n')) {
    if (/^[0-9a-f]{40} /.test(l)) {
      const sha = l.slice(0, 40);
      cur = meta.get(sha) || { sha, time: 0 };
      meta.set(sha, cur);
    } else if (l.startsWith('committer-time ')) {
      cur.time = Number(l.slice(15));
    } else if (l.startsWith('\t')) {
      lines.push(cur);
    }
  }
  return lines.map((m) => ({
    sha: m.sha,
    date: m.sha.startsWith('0000000') ? null : new Date(m.time * 1000).toISOString().slice(0, 10),
    uncommitted: m.sha.startsWith('0000000'),
  }));
}

/** Map of start line → end line for every test() call in a file. */
function testRanges(rel) {
  const ranges = new Map();
  let src;
  try {
    src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
  } catch {
    return ranges;
  }
  for (const t of parseTests(src)) ranges.set(t.start, Math.max(ranges.get(t.start) || 0, t.end));
  return ranges;
}

/**
 * History lookup with per-file caching.
 * `history.forTest(file, line)` → { added, modified, change: 'new'|'modified'|null, known: bool }
 */
export function createHistory() {
  const baseline = resolveBaseline();
  const shallow = isShallow();
  const since = shallow ? null : commitsSince(baseline);
  const cache = new Map();
  const fileInfo = (rel) => {
    if (!cache.has(rel)) cache.set(rel, shallow ? null : { blame: blameFile(rel), ranges: testRanges(rel) });
    return cache.get(rel);
  };
  const inRelease = (entry) => {
    if (entry.uncommitted) return false;
    if (since) return !since.has(entry.sha);
    if (baseline && baseline.date && entry.date) return entry.date <= baseline.date;
    return true;
  };

  return {
    baseline,
    shallow,
    forTest(file, line) {
      const rel = relToRepo(file);
      const info = fileInfo(rel);
      if (!info || !info.blame || !line) return { added: null, modified: null, change: null, known: false };
      const { blame, ranges } = info;
      // Playwright's location line is the `test(` call; find the range that starts there
      // (or the closest one starting at/before it, for wrapped calls).
      let end = ranges.get(line);
      if (!end) {
        const starts = [...ranges.keys()].filter((s) => s <= line && ranges.get(s) >= line);
        end = starts.length ? ranges.get(Math.max(...starts)) : line;
      }
      const title = blame[line - 1];
      if (!title) return { added: null, modified: null, change: null, known: false };
      const body = blame.slice(line - 1, end);
      const dates = body.map((b) => b.date).filter(Boolean).sort();
      const added = title.date;
      const modified = dates.length ? dates[dates.length - 1] : added;
      let change = null;
      if (baseline) {
        if (!inRelease(title)) change = 'new';
        else if (body.some((b) => !inRelease(b))) change = 'modified';
      }
      return { added, modified: modified !== added ? modified : null, change, known: true };
    },
  };
}

// Finds the Playwright tests in a spec file's source: title, enclosing describe
// titles, line range and normalised body. Shared by the git history (lib/history.mjs)
// and the PR traceability check (pr-traceability.mjs).
import { parse } from '@babel/parser';

const TEST_NAMES = new Set(['test', 'it']);
const DESCRIBE_NAMES = new Set(['describe']);

function calleeKind(callee) {
  // test(...) / it(...)
  if (callee.type === 'Identifier') {
    if (TEST_NAMES.has(callee.name)) return 'test';
    if (DESCRIBE_NAMES.has(callee.name)) return 'describe';
    return null;
  }
  if (callee.type !== 'MemberExpression') return null;
  // test.only / test.skip / test.fixme / test.fail / test.slow (with a title + body)
  // test.describe / test.describe.serial / test.describe.only / describe.skip ...
  const chain = [];
  let c = callee;
  while (c.type === 'MemberExpression') {
    chain.unshift(c.property.name || c.property.value);
    c = c.object;
  }
  if (c.type !== 'Identifier') return null;
  if (TEST_NAMES.has(c.name) && chain[0] === 'describe') return 'describe';
  if (DESCRIBE_NAMES.has(c.name)) return 'describe';
  if (TEST_NAMES.has(c.name) && ['only', 'skip', 'fixme', 'fail', 'slow'].includes(chain[0]) && chain.length === 1) return 'test';
  return null;
}

function titleText(node, src) {
  if (!node) return null;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'TemplateLiteral') return src.slice(node.start + 1, node.end - 1);
  return src.slice(node.start, node.end); // a variable or expression — keep its source
}

/**
 * @returns {{ title: string, describe: string[], key: string, start: number, end: number, body: string }[]}
 */
export function parseTests(src) {
  let ast;
  try {
    ast = parse(src, { sourceType: 'unambiguous', plugins: ['jsx', 'typescript', 'topLevelAwait'], errorRecovery: true });
  } catch {
    return [];
  }
  const out = [];
  const visit = (node, stack) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'CallExpression') {
      const kind = calleeKind(node.callee);
      const fnArg = node.arguments.find((a) => a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression');
      if (kind && fnArg && node.arguments.length >= 2) {
        const title = titleText(node.arguments[0], src);
        if (kind === 'test') {
          out.push({
            title,
            describe: stack,
            key: [...stack, title].join(' › '),
            start: node.loc.start.line,
            end: node.loc.end.line,
            body: src.slice(fnArg.start, fnArg.end).replace(/\s+/g, ' ').trim(),
          });
          return;
        }
        if (kind === 'describe') {
          for (const a of node.arguments) visit(a, [...stack, title]);
          return;
        }
      }
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'extra') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach((x) => visit(x, stack));
      else if (v && typeof v.type === 'string') visit(v, stack);
    }
  };
  visit(ast.program, []);
  return out;
}

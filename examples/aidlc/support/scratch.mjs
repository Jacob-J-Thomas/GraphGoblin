// First run: make an independent physical Git fixture inside this worktree.
// Historical local fixture/input builder. --remote is retired; owner setup already exists.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../.tmp/aidlc-scratch');
const repository = 'Jacob-J-Thomas/gg-aidlc-scratch';
// Baseline publication was a one-off owner setup. Delivery helpers never push a base ref.
if (process.argv.includes('--remote')) throw new Error('BASE_PUBLICATION_FORBIDDEN');
const run = (program, args, options = {}) => {
  const result = spawnSync(program, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
    ...options,
  });
  if (result.status !== 0 || result.error)
    throw new Error(
      `${program} ${args.slice(0, 3).join(' ')}: ${result.stderr ?? result.error.message}`,
    );
  return result.stdout.trim();
};
const checklist = [
  {
    id: 'aidlc-in-range',
    system: 'clamp',
    scenario: 'Preserve a value inside the range',
    polarity: 'positive',
    steps: ['Call clamp(5, 0, 10) and assert 5'],
    expected: '5',
  },
  {
    id: 'aidlc-bounds',
    system: 'clamp',
    scenario: 'Clamp values below and above bounds',
    polarity: 'positive',
    steps: ['Call clamp(-2, 0, 10) and assert 0; call clamp(12, 0, 10) and assert 10'],
    expected: '0 and 10',
  },
  {
    id: 'aidlc-reversed',
    system: 'clamp',
    scenario: 'Reject a reversed interval',
    polarity: 'negative',
    steps: ['Assert clamp(5, 10, 0) throws RangeError'],
    expected: 'RangeError',
  },
];
if (!fs.existsSync(root)) {
  fs.mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(
      { name: 'aidlc-scratch', private: true, type: 'module', scripts: { test: 'node --test' } },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(root, 'clamp.js'),
    'export function clamp(value, min, max) {\n  return Math.min(max, Math.max(min, value));\n}\n',
  );
  fs.writeFileSync(
    path.join(root, 'clamp.test.js'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { clamp } from './clamp.js';\ntest('aidlc- inside', () => assert.equal(clamp(5, 0, 10), 5));\ntest('aidlc- bounds', () => { assert.equal(clamp(-2, 0, 10), 0); assert.equal(clamp(12, 0, 10), 10); });\n",
  );
  fs.writeFileSync(
    path.join(root, 'aidlc-checklist.lock.json'),
    JSON.stringify(checklist, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(root, 'AGENTS.md'),
    '# aidlc- scratch worker boundary\nWork alone in this physical scratch repository. No subagents or MCP. Do not read other repositories, credentials or private instance data. No network or Git mutations. Scripts own Git and GitHub side effects. Never alter this file, the locked checklist, .github/, or .gitignore. Do not create links. Run node --test for checks. Proof is provided by the surrounding scripts.\n',
  );
  fs.writeFileSync(path.join(root, '.gitignore'), '.aidlc-proof/\n');
  fs.writeFileSync(
    path.join(root, '.github/workflows/aidlc-ci.yml'),
    'name: aidlc-ci\non: [push, pull_request]\njobs:\n  aidlc-test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n      - run: node --test\n',
  );
  run('git', ['init', '-b', 'main']);
  run('git', ['config', 'user.name', 'Jacob-J-Thomas']);
  run('git', ['config', 'user.email', '92639671+Jacob-J-Thomas@users.noreply.github.com']);
  run('git', ['remote', 'add', '--', 'origin', `https://github.com/${repository}.git`]);
  run('git', ['add', '--', '.']);
  run('git', ['commit', '-m', 'aidlc- scratch baseline']);
  fs.chmodSync(path.join(root, 'aidlc-checklist.lock.json'), 0o444);
}
const payload = {
  message:
    'Add reversed-interval validation to clamp: when min > max throw RangeError. Preserve normal clamping, add a regression test, and satisfy every locked criterion. One small task; no unrelated changes.',
  repository,
  workspacePath: root,
  issueNumber: 1,
  checklist,
  bounds: { maxTasks: 1, reviewCycles: 3, qaReworks: 1 },
  policy: { allowMerge: true, allowClose: true },
};
const destination = path.resolve(here, '../../../.tmp/aidlc-control/aidlc-positive-input.json');
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, JSON.stringify(payload, null, 2));
console.log(
  JSON.stringify({
    workspacePath: root,
    baselineSha: run('git', ['rev-parse', 'main']),
    inputFile: destination,
    remote: process.argv.includes('--remote'),
  }),
);

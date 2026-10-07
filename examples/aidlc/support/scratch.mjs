// First run: make an independent physical Git fixture inside this worktree.
// --remote: create private GitHub repository (if absent), push baseline and create one issue.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../.tmp/aidlc-scratch');
const repository = 'Jacob-J-Thomas/gg-aidlc-scratch';
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
  run('git', ['remote', 'add', 'origin', `https://github.com/${repository}.git`]);
  run('git', ['add', '.']);
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
if (process.argv.includes('--remote')) {
  const identity = JSON.parse(run('gh', ['api', 'user']));
  if (identity.login !== 'Jacob-J-Thomas') throw new Error('Wrong GitHub identity');
  const existing = spawnSync('gh', ['api', `repos/${repository}`], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (existing.status !== 0) {
    if (!existing.stderr.includes('404')) throw new Error(existing.stderr);
    run('gh', ['api', 'user/repos', '--method', 'POST', '--input', '-'], {
      input: JSON.stringify({
        name: 'gg-aidlc-scratch',
        private: true,
        description: 'aidlc- GraphGoblin bounded template scratch tests',
      }),
    });
  } else if (!JSON.parse(existing.stdout).private)
    throw new Error('Scratch repository must be private');
  run('git', ['push', '-u', 'origin', 'main']);
  const settings = JSON.parse(fs.readFileSync(path.join(here, '../full-v1.settings.json'), 'utf8'));
  const labels = JSON.parse(run('gh', ['api', `repos/${repository}/labels?per_page=100`]));
  for (const name of Object.values(settings.labels)) {
    if (!labels.some((x) => x.name === name))
      run('gh', ['api', `repos/${repository}/labels`, '--method', 'POST', '--input', '-'], {
        input: JSON.stringify({
          name,
          color: '5319e7',
          description: 'aidlc- scratch lifecycle setting',
        }),
      });
  }
  const issues = JSON.parse(
    run('gh', ['api', `repos/${repository}/issues?state=all&per_page=100`]),
  );
  const found = issues.filter((x) => x.title === 'aidlc- reject reversed clamp intervals');
  if (found.length > 1) throw new Error('Ambiguous baseline issue');
  const issue =
    found[0] ??
    JSON.parse(
      run('gh', ['api', `repos/${repository}/issues`, '--method', 'POST', '--input', '-'], {
        input: JSON.stringify({
          title: 'aidlc- reject reversed clamp intervals',
          body: `aidlc- tiny task\n\n${payload.message}\n\nAcceptance criteria:\n- [ ] Reversed intervals throw RangeError\n- [ ] Existing clamping remains correct\n- [ ] Regression test and saved QA proof\n\nLocked checklist: aidlc-checklist.lock.json. Keep open until post-merge QA passes.`,
          labels: [settings.labels.trigger],
        }),
      }),
    );
  payload.issueNumber = issue.number;
}
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

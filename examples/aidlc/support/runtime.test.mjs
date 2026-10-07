// Exercise real helper admission and plan validation against the local physical fixture.
// No Codex/Jev calls, Git mutations, or remote GitHub operations.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const here = path.dirname(fileURLToPath(import.meta.url));
const worktree = path.resolve(here, '../../..');
const fixture = path.join(worktree, '.tmp/aidlc-scratch');
const input = JSON.parse(
  fs.readFileSync(path.join(worktree, '.tmp/aidlc-control/aidlc-positive-input.json'), 'utf8'),
);
const exported = JSON.parse(fs.readFileSync(path.join(here, '../planning.loop.json'), 'utf8'));
const environment = exported.loop.nodes.find((x) => x.id === 'init').config.env;
const lockedBefore = fs.readFileSync(path.join(fixture, 'aidlc-checklist.lock.json'));
const call = (action, payload = input, lastOutput, env = environment) =>
  spawnSync(process.execPath, [path.join(here, 'runtime.mjs'), action], {
    cwd: fixture,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, ...env },
    input: JSON.stringify({
      run: { id: '00000000000000000000000001', loopId: '00000000000000000000000002' },
      invocation: { trigger: { payload } },
      vars: {},
      outputs: {},
      counters: { nodeVisits: {} },
      ...(lastOutput ? { lastOutput: { nodeId: 'aidlc-fixture', value: lastOutput } } : {}),
    }),
  });
test('actual helper admits only the authorized physical scratch and its locked checklist', () => {
  const good = call('init');
  assert.equal(good.status, 0, good.stderr);
  assert.equal(
    JSON.parse(good.stdout).find((x) => x.path === '/vars/request').value.workspacePath,
    fixture,
  );
  const wrongRepo = call('init', { ...input, repository: 'Jacob-J-Thomas/GraphGoblin' });
  assert.equal(wrongRepo.status, 1);
  assert.match(wrongRepo.stderr, /REPOSITORY_NOT_AUTHORIZED/);
  const wrongChecklist = call('init', { ...input, checklist: [] });
  assert.equal(wrongChecklist.status, 1);
  assert.match(wrongChecklist.stderr, /LOCKED_CHECKLIST_CHANGED/);
  assert.deepEqual(fs.readFileSync(path.join(fixture, 'aidlc-checklist.lock.json')), lockedBefore);
});
test('actual helper refuses settings or support changed since publication', () => {
  const result = call('init', input, null, { ...environment, AIDLC_SUPPORT_HASH: 'wrong' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SUPPORT_CHANGED_REINSTANTIATE/);
});
test('actual planning helper preserves ready, needs-input and blocked status', () => {
  const plan = {
    schemaVersion: 1,
    status: 'ready',
    planningSlot: 'plannerB',
    summary: 'Fixture',
    tasks: [
      {
        id: 'aidlc-task',
        description: 'Task',
        userVisibleUI: false,
        acceptanceCriteria: ['Locked acceptance'],
        dependsOn: [],
      },
    ],
    checklist: input.checklist,
    risks: [],
    questions: [],
  };
  const ready = call('plan', input, plan);
  assert.equal(ready.status, 0, ready.stderr);
  const changed = call('plan', input, { ...plan, checklist: [] });
  assert.equal(changed.status, 1);
  assert.match(changed.stderr, /CHECKLIST_CHANGED/);
  const needsInput = call('plan', input, {
    ...plan,
    status: 'needs-input',
    tasks: [],
    questions: ['Clarify'],
  });
  assert.equal(needsInput.status, 0, needsInput.stderr);
});

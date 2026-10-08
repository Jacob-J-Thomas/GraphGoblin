/* Synchronous fake ports retain async signatures to turn fixture failures into rejected promises. */
/* eslint-disable @typescript-eslint/require-await */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ImplementationTemplateSettingsSchema, JsonValueSchema } from '@graphgoblin/contracts';
import { fakeUlid, FIXTURE_TS } from '@graphgoblin/contracts/testing';
import { createInitialThread } from '@graphgoblin/engine';
import {
  ImplementationSupport,
  closingIssue,
  type ImplementationSupportDeps,
} from './implementation.js';
import { ImplementationRepository } from './repository.js';
import {
  DiskSupportStorage,
  JournalSchema,
  contained,
  type Journal,
  type SupportStorage,
} from './storage.js';
import { SupportEnvelopeSchema, SupportFailure, type SupportEnvelope } from './protocol.js';
import type { CommandRequest, CommandResult, CommandRunner } from './process.js';
import type { GithubIssue, GithubPort, GithubPullRequest } from './client.js';
import { implementationSupportClosure } from './support-closure.js';
import { ImplementationAuthority } from './authority-source.js';
import type { TemplateInstances } from '../instances.js';
import { TemplateBindingSchema } from '../binding.js';

const base = 'a'.repeat(40),
  tree = 'b'.repeat(40);
const settings = ImplementationTemplateSettingsSchema.parse({
  kind: 'implementation',
  repository: {
    path: join(tmpdir(), 'gg-inert-support-repo'),
    owner: 'Example',
    name: 'Repo',
    baseBranch: 'main',
  },
  supportReadKey: 'support-reader',
  roles: { implementer: { harness: 'codex', model: 'gpt-6-sol', effort: 'high' } },
});
const runId = fakeUlid('support-run');
function envelope(): SupportEnvelope {
  const loopId = fakeUlid('support-loop'),
    versionId = fakeUlid('support-version');
  return SupportEnvelopeSchema.parse({
    settings,
    credential: 'private-token-never-recorded',
    visit: 1,
    identity: {
      kind: 'node',
      ownerId: 'local',
      loopId,
      versionId,
      nodeId: 'prepare',
      runId,
      startedSeq: 1,
    },
    subject: {
      role: 'parent',
      kind: 'implementation',
      instanceId: fakeUlid('support-instance'),
      templateVersion: '1.0.0',
      repository: 'example/repo',
      issue: 42,
      attempt: 1,
      source: { kind: 'implementation', runId },
    },
    claim: { type: 'ClaimRecord', repository: 'example/repo', issue: 42, attempt: 1 },
    input: createInitialThread({
      runId,
      loopId,
      versionId,
      invocation: {
        id: fakeUlid('support-invocation'),
        source: 'manual.api',
        trigger: {
          nodeId: 'start',
          kind: 'manual',
          payload: { issue: 42 },
          receivedAt: FIXTURE_TS,
        },
      },
    }),
  });
}
class MemoryStorage implements SupportStorage {
  files = new Map<string, string>();
  paths = new Set([
    resolve(settings.repository.path),
    join(resolve(settings.repository.path), '.git'),
  ]);
  async canonical(path: string) {
    if (!this.paths.has(resolve(path))) throw new Error('missing inert directory ' + path);
    return resolve(path);
  }
  async directory(_root: string, path: string) {
    this.paths.add(resolve(path));
  }
  async exists(path: string) {
    return this.paths.has(resolve(path)) || this.files.has(path);
  }
  async load(path: string) {
    const text = this.files.get(path);
    return text ? JournalSchema.parse(JSON.parse(text)) : undefined;
  }
  async save(path: string, state: Journal) {
    this.files.set(path, JSON.stringify(JournalSchema.parse(state)));
  }
  async text(_root: string, path: string, content: string) {
    this.files.set(path, content);
  }
}
type Worktree = {
  branch: string;
  head: string;
  parent: string;
  tree: string;
  message: string;
  dirty: boolean;
  parents: string[];
};
class GitFixture implements CommandRunner {
  calls: CommandRequest[] = [];
  worktrees = new Map<string, Worktree>();
  branches = new Map<string, string>();
  remote = new Map([['main', base]]);
  gates: CommandResult[] = [];
  serial = 10;
  origin = 'https://github.com/Example/Repo.git';
  commonOverride: string | undefined;
  indexOverride: string | undefined;
  commitCorrupt = false;
  gateThrow = false;
  gateMovesHead = false;
  gateDirtiesTree = false;
  dirtyRoot = false;
  constructor(readonly storage: MemoryStorage) {}
  nextSha() {
    return (++this.serial).toString(16).padStart(40, '0');
  }
  async run(request: CommandRequest): Promise<CommandResult> {
    this.calls.push(structuredClone(request));
    const good = (stdout = ''): CommandResult => ({
      exitCode: 0,
      stdout,
      stderr: '',
      timedOut: false,
      overflow: false,
      termination: 'confirmed',
    });
    if (request.program === 'gate-native') {
      if (this.gateThrow) throw new SupportFailure('GATE_PROCESS_LOST');
      const work = this.worktrees.get(request.cwd);
      if (work && this.gateMovesHead) work.head = this.nextSha();
      if (work && this.gateDirtiesTree) work.dirty = true;
      return this.gates.shift() ?? good();
    }
    if (request.program !== 'git-native') throw new Error('unexpected inert executable');
    const args = request.args.slice(7),
      command = args[0],
      cwd = request.cwd;
    const work = this.worktrees.get(cwd);
    if (command === 'remote') return good(this.origin);
    if (command === 'rev-parse') {
      if (args[1] === '--show-toplevel') return good(cwd);
      if (args[1] === '--git-common-dir')
        return good(this.commonOverride ?? join(settings.repository.path, '.git'));
      if (args[1] === '--abbrev-ref') return good(work?.branch ?? 'main');
      if (args[1] === '--verify') {
        const sha = this.branches.get(String(args[2]).replace('refs/heads/', ''));
        return sha ? good(sha) : { ...good(), exitCode: 1 };
      }
      if (args[1] === 'HEAD^') return good(work!.parent);
      if (args[1] === 'HEAD^{tree}') return good(work!.tree);
      return good(work?.head ?? base);
    }
    if (command === 'ls-remote') {
      const branch = String(args[3]).replace('refs/heads/', '');
      const sha = this.remote.get(branch);
      return good(sha ? sha + '\trefs/heads/' + branch : '');
    }
    if (command === 'fetch') return good();
    if (command === 'worktree') {
      const branch = args[2] === '-b' ? String(args[3]) : String(args[3]);
      const path = args[2] === '-b' ? String(args[4]) : String(args[2]);
      const start = args[2] === '-b' ? String(args[5]) : this.branches.get(branch)!;
      this.storage.paths.add(resolve(path));
      this.branches.set(branch, start);
      this.worktrees.set(path, {
        branch,
        head: start,
        parent: start,
        tree,
        message: '',
        dirty: false,
        parents: [],
      });
      return good();
    }
    if (command === 'status') return good(work?.dirty ? ' M source.ts' : '');
    if (command === 'add') return good();
    if (command === 'write-tree') return good(this.indexOverride ?? work!.tree);
    if (command === 'commit') {
      work!.parent = work!.head;
      work!.head = this.nextSha();
      work!.message = String(args[3]);
      if (this.commitCorrupt) work!.tree = 'c'.repeat(40);
      work!.dirty = false;
      this.branches.set(work!.branch, work!.head);
      return good('Committed');
    }
    if (command === 'merge') {
      const source = String(args[args.length - 1]);
      work!.parents = [work!.head, source];
      work!.parent = work!.head;
      work!.head = this.nextSha();
      this.branches.set(work!.branch, work!.head);
      return good('Merged');
    }
    if (command === 'show')
      return good(args.includes('--format=%P') ? work!.parents.join(' ') : work!.message);
    if (command === 'push') {
      const [head, ref] = String(args[2]).split(':');
      this.remote.set(ref!.replace('refs/heads/', ''), head!);
      return good();
    }
    throw new Error('Unexpected inert git operation ' + args.join(' '));
  }
}
class GithubFixture implements GithubPort {
  current: GithubIssue = {
    number: 42,
    title: 'Implement behavior',
    body: 'Acceptance: behavior works.',
    state: 'open',
    html_url: 'https://github.com/example/repo/issues/42',
    labels: [{ name: settings.labels.trigger }],
  };
  prs: GithubPullRequest[] = [];
  commentRows: { body: string }[] = [];
  labelsAvailable = Object.values(settings.labels);
  authFailure = false;
  createLocalFailure = false;
  effects: string[] = [];
  constructor(readonly storage: MemoryStorage) {}
  async authenticate() {
    if (this.authFailure) throw new Error('unsafe private-token-never-recorded');
  }
  async issue() {
    return structuredClone(this.current);
  }
  async candidates() {
    return [structuredClone(this.current)];
  }
  async labels() {
    return this.labelsAvailable;
  }
  async comments() {
    return this.commentRows;
  }
  async post(_repository: string, _issue: number, body: string) {
    this.effects.push('post');
    this.commentRows.push({ body });
  }
  async comment(repository: string, issue: number, path: string) {
    await this.post(repository, issue, this.storage.files.get(path)!);
  }
  async label(
    _repository: string,
    _issue: number,
    add: readonly string[],
    remove: readonly string[],
  ) {
    this.effects.push('label');
    const names = new Set(this.current.labels.map((label) => label.name));
    for (const name of remove) names.delete(name);
    for (const name of add) names.add(name);
    this.current.labels = [...names].map((name) => ({ name }));
  }
  async pullRequests() {
    return this.prs;
  }
  async create(
    repository: string,
    branch: string,
    baseBranch: string,
    title: string,
    bodyFile: string,
  ) {
    this.effects.push('create');
    const journal = [...this.storage.files.values()]
      .map((text) => {
        try {
          return JournalSchema.parse(JSON.parse(text));
        } catch {
          return undefined;
        }
      })
      .find((state) => state?.intent);
    this.prs.push({
      number: 7,
      state: 'open',
      title,
      head: { sha: journal!.intent!.head, ref: branch, repo: { full_name: repository } },
      base: { ref: baseBranch, repo: { full_name: repository } },
      body: this.storage.files.get(bodyFile)!,
    });
    if (this.createLocalFailure) throw new Error('remote committed but local response lost');
  }
}
function fixture() {
  const storage = new MemoryStorage(),
    commands = new GitFixture(storage),
    github = new GithubFixture(storage);
  const deps: ImplementationSupportDeps = {
    storage,
    commands,
    github,
    git: 'git-native',
    gate: async (_program, args) => ({ program: 'gate-native', args: [...args] }),
  };
  const env = envelope();
  let support = new ImplementationSupport(deps),
    visit = 1;
  const repo = new ImplementationRepository(settings, commands, storage, 'git-native');
  async function action(name: string, proposal?: unknown, reuse?: number) {
    if (env.identity.kind !== 'node') throw new Error('fixture node');
    env.identity.nodeId = name;
    env.visit = reuse ?? visit++;
    env.identity.startedSeq = env.visit;
    if (proposal !== undefined && env.input)
      env.input.lastOutput = {
        nodeId: 'model',
        value: JsonValueSchema.parse(proposal),
        at: FIXTURE_TS,
      };
    return support.execute(name, env);
  }
  const state = () => storage.load(repo.journal(runId));
  async function prepare() {
    expect(await action('prepare')).toMatchObject({ type: 'ImplementationWorkspace' });
  }
  async function tasks(split = false) {
    await prepare();
    expect(
      await action(
        'plan',
        split
          ? {
              mode: 'split',
              tasks: [
                { id: 'first', title: 'First change', instructions: 'Implement first.' },
                { id: 'second', title: 'Second change', instructions: 'Implement second.' },
              ],
            }
          : { mode: 'direct', instructions: 'Implement behavior.' },
      ),
    ).toMatchObject({ type: 'ImplementationPlan' });
    for (let index = 0; index < (split ? 2 : 1); index++) {
      const task = (await action('task-prepare')) as { cwd: string };
      commands.worktrees.get(task.cwd)!.dirty = true;
      env.input!.vars['workerResult'] = { summary: 'Changed and verified behavior.' };
      expect(await action('task-complete')).toMatchObject({
        type: 'TaskComplete',
        taskIndex: index + 1,
        remaining: split && index === 0,
      });
    }
  }
  async function intent() {
    await tasks();
    expect(await action('gate')).toMatchObject({ passed: true, fixes: 0 });
    expect(
      await action('pr-intent', {
        title: 'Implement behavior',
        summary: 'Completed behavior.',
        changes: ['Implemented behavior.'],
        tests: ['Tests passed.'],
        risks: ['None identified.'],
      }),
    ).toMatchObject({ type: 'PrIntent' });
  }
  return {
    storage,
    commands,
    github,
    deps,
    env,
    repo,
    action,
    state,
    prepare,
    tasks,
    intent,
    restart() {
      support = new ImplementationSupport(deps);
    },
  };
}

describe('implementation deterministic support', () => {
  it('publishes a direct change with exact closing issue, a persisted intent and one PR across restart', async () => {
    const f = fixture();
    await f.intent();
    expect(await f.action('pr-created')).toMatchObject({
      type: 'PrCreated',
      issue: 42,
      attempt: 1,
      pullRequest: 7,
    });
    f.restart();
    expect(await f.action('pr-created', undefined)).toMatchObject({ pullRequest: 7 });
    expect(await f.action('complete')).toMatchObject({
      type: 'ImplementationComplete',
      pullRequest: 7,
    });
    expect(f.github.effects.filter((effect) => effect === 'create')).toHaveLength(1);
    expect(f.github.prs[0]!.body).toContain('Closes #42');
    expect(await f.state()).toMatchObject({ intent: { pushed: true, pullRequest: 7 } });
    expect(
      JSON.stringify([...f.storage.files.values(), f.commands.calls, f.github.effects]),
    ).not.toContain(f.env.credential);
  });
  it('runs two sequential task worktrees and commits/merges before the final gate', async () => {
    const f = fixture();
    await f.tasks(true);
    const trees = [...f.commands.worktrees.entries()].filter(([, work]) =>
      work.branch.includes('-task-'),
    );
    expect(trees).toHaveLength(2);
    expect(trees[0]![1].head).not.toBe(base);
    expect(trees[1]![1].parent).not.toBe(base);
    expect(f.commands.calls.filter((call) => call.args[7] === 'merge')).toHaveLength(2);
    expect(await f.action('gate')).toMatchObject({ passed: true, fixes: 0 });
  });
  it('reconciles gh remote success/local failure before blocking and never falsely claims no PR', async () => {
    const f = fixture();
    await f.intent();
    f.github.createLocalFailure = true;
    expect(await f.action('pr-created')).toMatchObject({ type: 'SupportBlocked' });
    expect(await f.action('block')).toMatchObject({ code: 'PR_COMPLETION_UNCERTAIN' });
    expect(f.github.commentRows.at(-1)!.body).toContain('after pull request #7');
    expect(f.github.commentRows.at(-1)!.body).not.toContain('No pull request');
    f.github.createLocalFailure = false;
    f.restart();
    expect(await f.action('pr-created')).toMatchObject({ pullRequest: 7 });
    expect(f.github.effects.filter((effect) => effect === 'create')).toHaveLength(1);
  });
  it.each(['closed', 'title', 'head', 'body', 'base', 'repository', 'duplicates'] as const)(
    'refuses conflicting existing PR %s',
    async (field) => {
      const f = fixture();
      await f.intent();
      await f.action('pr-created');
      const pr = f.github.prs[0]!;
      if (field === 'closed') pr.state = 'closed';
      if (field === 'title') pr.title = 'Changed';
      if (field === 'head') pr.head.sha = 'd'.repeat(40);
      if (field === 'body') pr.body = 'Closes #99';
      if (field === 'base') pr.base.ref = 'other';
      if (field === 'repository') pr.head.repo.full_name = 'other/repo';
      if (field === 'duplicates') f.github.prs.push(structuredClone(pr));
      expect(await f.action('pr-created')).toMatchObject({
        type: 'SupportBlocked',
        code: 'PR_RECONCILIATION_CONFLICT',
      });
      expect(await f.action('complete')).toMatchObject({
        type: 'SupportBlocked',
        code: 'PR_RECONCILIATION_CONFLICT',
      });
      expect(f.github.effects.filter((effect) => effect === 'create')).toHaveLength(1);
    },
  );
  it('rejects an externally changed pushed ref and never force pushes', async () => {
    const f = fixture();
    await f.intent();
    const state = (await f.state())!;
    f.commands.remote.set(state.branch, 'd'.repeat(40));
    expect(await f.action('pr-created')).toMatchObject({ code: 'REMOTE_HEAD_CHANGED' });
    expect(f.commands.calls.some((call) => call.args[7] === 'push')).toBe(false);
    expect(f.github.prs).toHaveLength(0);
  });
  it('keeps bounded gate fixes and commit identities across repeated failure', async () => {
    const f = fixture();
    await f.tasks();
    const failure: CommandResult = {
      exitCode: 1,
      stdout: 'unsafe ' + f.env.credential,
      stderr: 'unsafe',
      timedOut: false,
      overflow: false,
      termination: 'confirmed',
    };
    f.commands.gates = [failure, failure, failure];
    for (let fixes = 0; fixes <= 2; fixes++) {
      const result = await f.action('gate');
      expect(result).toMatchObject({ passed: false, fixes, canFix: fixes < 2 });
      expect(JSON.stringify(result)).not.toContain(f.env.credential);
    }
    expect(await f.action('gate')).toMatchObject({ code: 'GATE_FIX_LIMIT' });
    expect(f.commands.calls.filter((call) => call.program === 'gate-native')).toHaveLength(3);
    expect(await f.action('block')).toMatchObject({ type: 'ImplementationBlocked' });
    expect(f.github.prs).toHaveLength(0);
  });
  it.each(['unconfirmed', 'crash'] as const)(
    'persists gate count and quarantine before %s completion',
    async (mode) => {
      const f = fixture();
      await f.tasks();
      if (mode === 'crash') f.commands.gateThrow = true;
      else
        f.commands.gates = [
          {
            exitCode: -1,
            stdout: '',
            stderr: '',
            timedOut: true,
            overflow: false,
            termination: 'unconfirmed',
          },
        ];
      expect(await f.action('gate')).toMatchObject({ type: 'SupportBlocked' });
      expect(await f.state()).toMatchObject({
        quarantined: true,
        gate: { calls: 1, passed: false },
      });
      f.restart();
      f.commands.gateThrow = false;
      expect(await f.action('gate')).toMatchObject({ code: 'WORKSPACE_QUARANTINED' });
      expect(f.commands.calls.filter((call) => call.program === 'gate-native')).toHaveLength(1);
    },
  );
  it('returns the original visit result without repeating effects after a recovered started sequence', async () => {
    const f = fixture();
    const first = await f.action('prepare', undefined, 2);
    const count = f.github.effects.length;
    f.restart();
    expect(await f.action('prepare', undefined, 2)).toEqual(first);
    expect(f.github.effects).toHaveLength(count);
  });
  it('reconciles completion after the prOpen label succeeded before its final journal save', async () => {
    const f = fixture();
    await f.intent();
    await f.action('pr-created');
    await f.github.label(
      'example/repo',
      42,
      [settings.labels.prOpen],
      [settings.labels.inProgress],
    );
    expect(await f.action('complete')).toMatchObject({ type: 'ImplementationComplete' });
  });
  it.each(['label', 'body', 'state', 'auth', 'claim', 'role'] as const)(
    'fails closed before workspace effects for missing %s',
    async (mode) => {
      const f = fixture();
      if (mode === 'label') f.github.current.labels = [];
      if (mode === 'body') f.github.current.body = '';
      if (mode === 'state') f.github.current.state = 'closed';
      if (mode === 'auth') f.github.authFailure = true;
      if (mode === 'claim') f.env.claim = null;
      if (mode === 'role')
        f.env.subject = {
          ...f.env.subject!,
          role: 'worker',
          parentRunId: runId,
          nodeId: 'worker',
          visit: 1,
        };
      expect(await f.action('prepare')).toMatchObject({ type: 'SupportBlocked' });
      expect(f.github.effects).toHaveLength(0);
      expect(f.commands.worktrees.size).toBe(0);
    },
  );
  it('rechecks label removal mid-run before committing worker changes', async () => {
    const f = fixture();
    await f.prepare();
    await f.action('plan', { mode: 'direct', instructions: 'Work' });
    await f.action('task-prepare');
    f.github.current.labels = [];
    expect(await f.action('task-complete')).toMatchObject({ code: 'TRIGGER_LABEL_REMOVED' });
    expect(f.commands.calls.some((call) => call.args[7] === 'commit')).toBe(false);
  });
  it('enforces authored task limit and refuses malformed/duplicate plan or forged worker result', async () => {
    const f = fixture();
    await f.prepare();
    for (const proposal of [
      { mode: 'split', tasks: [{ id: 'one', title: 'One', instructions: 'One' }] },
      { mode: 'direct', instructions: ' ', extra: true },
    ])
      expect(await f.action('plan', proposal)).toMatchObject({ type: 'SupportBlocked' });
    const tasks = Array.from({ length: 9 }, (_, index) => ({
      id: 'task-' + index,
      title: 'Task',
      instructions: 'Implement',
    }));
    expect(await f.action('plan', { mode: 'split', tasks })).toMatchObject({
      code: 'PLAN_LIMIT_OR_CONFLICT',
    });
    await f.action('plan', { mode: 'direct', instructions: 'Work' });
    await f.action('task-prepare');
    f.env.input!.vars['workerResult'] = { summary: 'Work', authority: true };
    expect(await f.action('task-complete')).toMatchObject({ type: 'SupportBlocked' });
    expect(await f.action('plan', { mode: 'direct', instructions: 'Work' })).toMatchObject({
      code: 'PLAN_LIMIT_OR_CONFLICT',
    });
  });
  it.each([
    'Closes #99',
    'Fixes Other/Repo#42',
    'Resolves https://github.com/other/repo/issues/42',
  ])('refuses model-injected closing linkage %s', async (link) => {
    const f = fixture();
    await f.tasks();
    await f.action('gate');
    expect(
      await f.action('pr-intent', {
        title: 'Implement',
        summary: link,
        changes: ['Work'],
        tests: ['Passed'],
        risks: ['None'],
      }),
    ).toMatchObject({ code: 'PR_CLOSING_LINK_REFUSED' });
  });
  it.each(['head', 'tree'] as const)(
    'does not certify an exit-zero gate that changes %s during its launch',
    async (change) => {
      const f = fixture();
      await f.tasks();
      f.commands.gateMovesHead = change === 'head';
      f.commands.gateDirtiesTree = change === 'tree';
      const result = await f.action('gate');
      expect(result).toMatchObject(
        change === 'head'
          ? { type: 'SupportBlocked', code: 'GATE_HEAD_CHANGED' }
          : { passed: false },
      );
      expect(
        await f.action('pr-intent', {
          title: 'Implement',
          summary: 'Work',
          changes: ['Work'],
          tests: ['Passed'],
          risks: ['None'],
        }),
      ).toMatchObject({ type: 'SupportBlocked' });
      expect(await f.action('pr-created')).toMatchObject({ type: 'SupportBlocked' });
      expect(f.github.prs).toHaveLength(0);
      expect(f.commands.calls.some((call) => call.args[7] === 'push')).toBe(false);
    },
  );
  it('refuses gates on changed head or a dirty worktree before recording a PR intent', async () => {
    const f = fixture();
    await f.tasks();
    await f.action('gate');
    const state = (await f.state())!;
    f.commands.worktrees.get(state.cwd)!.dirty = true;
    expect(
      await f.action('pr-intent', {
        title: 'Implement',
        summary: 'Work',
        changes: ['Work'],
        tests: ['Passed'],
        risks: ['None'],
      }),
    ).toMatchObject({ code: 'GATES_OR_HEAD_CHANGED' });
    expect(await f.action('pr-created')).toMatchObject({ code: 'PR_INTENT_REQUIRED' });
  });
  it('claims only the current admitted parent and polls only curated eligible items', async () => {
    const f = fixture();
    f.env.claim = null;
    expect(await f.action('claim')).toMatchObject({ type: 'ClaimRecord', issue: 42, attempt: 1 });
    const env = {
      ...f.env,
      identity: {
        kind: 'poll',
        ownerId: 'local',
        loopId: fakeUlid('poll'),
        versionId: fakeUlid('poll-version'),
        nodeId: 'start',
      },
      input: null,
      subject: null,
      claim: null,
      visit: null,
    };
    const support = new ImplementationSupport(f.deps);
    expect(await support.execute('poll', env)).toEqual({
      items: [{ id: 42, payload: { issue: 42 } }],
    });
    f.github.labelsAvailable = [];
    expect(await support.execute('poll', env)).toMatchObject({ code: 'REQUIRED_LABEL_MISSING' });
    expect(await support.execute('poll', f.env)).toMatchObject({ code: 'POLL_IDENTITY_REFUSED' });
    expect(await support.execute('claim', env)).toMatchObject({ code: 'RUN_IDENTITY_REFUSED' });
  });
  it('does not repeat a blocked comment/label and refuses new workflow actions after blocking', async () => {
    const f = fixture();
    await f.prepare();
    await f.action('block');
    const effects = f.github.effects.length;
    await f.action('block');
    expect(f.github.effects).toHaveLength(effects + 1); // label reconciliation is idempotent.
    expect(f.github.commentRows.filter((row) => row.body.includes('No pull request'))).toHaveLength(
      1,
    );
    expect(await f.action('plan', { mode: 'direct', instructions: 'Work' })).toMatchObject({
      code: 'ATTEMPT_BLOCKED',
    });
  });
  it('rejects conflicting durable identities and a missing original workspace', async () => {
    const f = fixture();
    await f.prepare();
    const state = (await f.state())!;
    state.issue = 99;
    await f.storage.save(f.repo.journal(runId), state);
    expect(await f.action('plan', { mode: 'direct', instructions: 'Work' })).toMatchObject({
      code: 'JOURNAL_IDENTITY_CONFLICT',
    });
    const other = fixture();
    expect(await other.action('plan', { mode: 'direct', instructions: 'Work' })).toMatchObject({
      code: 'WORKSPACE_REQUIRED',
    });
  });
  it.each(['branch', 'cwd', 'task'] as const)(
    'refuses locally swapped %s identity before Git effects',
    async (field) => {
      const f = fixture();
      await f.prepare();
      const state = (await f.state())!;
      if (field === 'branch') state.branch = 'main';
      if (field === 'cwd') state.cwd = join(tmpdir(), 'other');
      if (field === 'task')
        state.task = { index: 0, id: 'forged', branch: 'main', cwd: state.cwd, start: base };
      await f.storage.save(f.repo.journal(runId), state);
      const effects = f.commands.calls.length;
      expect(await f.action('plan', { mode: 'direct', instructions: 'Work' })).toMatchObject({
        type: 'SupportBlocked',
      });
      expect(
        f.commands.calls
          .slice(effects)
          .every((call) => ['rev-parse', 'remote'].includes(String(call.args[7]))),
      ).toBe(true);
    },
  );
  it('rejects duplicate report markers and comment overflow without a second post', async () => {
    const f = fixture();
    await f.prepare();
    const claimed = f.github.commentRows[0]!;
    f.github.commentRows = [claimed, claimed];
    const fresh = await f.state();
    fresh!.results = {};
    await f.storage.save(f.repo.journal(runId), fresh!);
    expect(await f.action('prepare')).toMatchObject({ code: 'COMMENT_RECONCILIATION_CONFLICT' });
    f.github.commentRows = Array.from({ length: 100 }, () => ({ body: 'other' }));
    expect(await f.action('block')).toMatchObject({ code: 'COMMENT_DISCOVERY_BOUND' });
  });
});

describe('support-owned Git identity and commit recovery', () => {
  it('rejects changed origin/common root and outside workspaces before any effect', async () => {
    const f = fixture();
    f.commands.origin = 'https://github.com/Other/Repo.git';
    await expect(f.repo.assert()).rejects.toMatchObject({ code: 'REPOSITORY_IDENTITY_CHANGED' });
    f.commands.origin = 'https://github.com/Example/Repo.git';
    f.commands.commonOverride = join(settings.repository.path, 'other');
    await expect(f.repo.assert()).rejects.toMatchObject({ code: 'REPOSITORY_IDENTITY_CHANGED' });
    f.commands.commonOverride = undefined;
    await expect(
      f.repo.git(['commit', '-m', 'bad'], join(tmpdir(), 'outside')),
    ).rejects.toMatchObject({ code: 'WORKSPACE_OUTSIDE_ROOT' });
  });
  it('rejects a mutated index at a saved commit intent and retains that intent', async () => {
    const f = fixture();
    await f.tasks();
    const state = (await f.state())!;
    const head = await f.repo.head(state.cwd);
    state.commit = { cwd: state.cwd, parent: head, tree, message: 'Planned commit' };
    f.commands.indexOverride = 'd'.repeat(40);
    await expect(
      f.repo.commit(state, state.cwd, 'Planned commit', async () => {}),
    ).rejects.toMatchObject({ code: 'COMMIT_INDEX_CHANGED' });
    expect(state.commit).toBeDefined();
  });
  it('verifies post-commit parent/tree/message before clearing an intent', async () => {
    const f = fixture();
    await f.prepare();
    const state = (await f.state())!;
    f.commands.worktrees.get(state.cwd)!.dirty = true;
    f.commands.commitCorrupt = true;
    await expect(
      f.repo.commit(state, state.cwd, 'Planned commit', async () => {}),
    ).rejects.toMatchObject({ code: 'COMMIT_RECONCILIATION_REFUSED' });
    expect(state.commit).toBeDefined();
  });
  it('accepts only an exact previously committed parent/tree/message after a crash', async () => {
    const f = fixture();
    await f.prepare();
    const state = (await f.state())!;
    const work = f.commands.worktrees.get(state.cwd)!;
    state.commit = { cwd: state.cwd, parent: work.head, tree, message: 'Planned commit' };
    work.parent = work.head;
    work.head = 'e'.repeat(40);
    work.message = 'Planned commit';
    expect(await f.repo.commit(state, state.cwd, 'Planned commit', async () => {})).toBe(work.head);
    expect(state.commit).toBeUndefined();
    state.commit = { cwd: state.cwd, parent: base, tree, message: 'Different' };
    await expect(
      f.repo.commit(state, state.cwd, 'Different', async () => {}),
    ).rejects.toMatchObject({ code: 'COMMIT_RECONCILIATION_REFUSED' });
  });
  it('refuses a preexisting conflicting branch rather than attaching unrelated work', async () => {
    const f = fixture();
    await f.repo.initialize();
    f.commands.branches.set('graphgoblin/issue-42-attempt-1', 'd'.repeat(40));
    await expect(
      f.repo.ensureWorkspace('graphgoblin/issue-42-attempt-1', f.repo.workspace(runId), base),
    ).rejects.toMatchObject({ code: 'LOCAL_BRANCH_CONFLICT' });
    expect(f.commands.worktrees.size).toBe(0);
  });
});
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function temp() {
  const path = await mkdtemp(join(tmpdir(), 'gg-support-storage-'));
  dirs.push(path);
  return path;
}
describe('canonical disk journal and packaged closure', () => {
  it('writes durable validated journals and text only inside an explicit canonical root', async () => {
    const root = await temp(),
      storage = new DiskSupportStorage('fixture-journal-key', {
        ownerId: 'local',
        runId,
        repository: 'example/repo',
        issue: 42,
        attempt: 1,
      });
    expect(await storage.canonical(root)).toBe(root);
    expect(await storage.load(join(root, 'missing.json'))).toBeUndefined();
    const state = JournalSchema.parse({
      version: 1,
      runId,
      repository: 'example/repo',
      issue: 42,
      attempt: 1,
      branch: 'branch',
      cwd: root,
      base,
      title: 'Title',
      body: 'Body',
      taskIndex: 0,
    });
    await storage.save(join(root, 'journal.json'), state);
    expect(await storage.load(join(root, 'journal.json'))).toEqual(state);
    await storage.text(root, join(root, 'nested', 'body.md'), 'safe body');
    expect(await readFile(join(root, 'nested', 'body.md'), 'utf8')).toBe('safe body');
    await expect(storage.text(root, join(root, '..', 'outside.md'), 'wrong')).rejects.toMatchObject(
      { code: 'JOURNAL_INVALID' },
    );
    await expect(storage.directory(root, join(root, '..', 'outside'))).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_ROOT',
    });
    await writeFile(join(root, 'oversized.json'), ' '.repeat(1048577));
    await expect(storage.load(join(root, 'oversized.json'))).rejects.toMatchObject({
      code: 'JOURNAL_INVALID',
    });
    expect(contained(root, root)).toBe(true);
    expect(contained(root, root + '-sibling')).toBe(false);
  });
  it('authenticates deterministic owner/run/repository/attempt bytes and refuses edits, rotation, unsigned data and secret persistence', async () => {
    const root = await temp(),
      identity = { ownerId: 'local', runId, repository: 'example/repo', issue: 42, attempt: 1 };
    const storage = new DiskSupportStorage('fixture-private-key', identity),
      path = join(root, 'signed.json');
    const state = JournalSchema.parse({
      version: 1,
      runId,
      repository: 'example/repo',
      issue: 42,
      attempt: 1,
      branch: 'fixed',
      cwd: root,
      base,
      title: 'Title',
      body: 'Body',
      taskIndex: 0,
    });
    await storage.save(path, state);
    const original = await readFile(path, 'utf8');
    expect(original).not.toContain('fixture-private-key');
    expect(await storage.load(path)).toEqual(state);
    await storage.save(path, state);
    expect(await readFile(path, 'utf8')).toBe(original);
    await expect(new DiskSupportStorage('rotated-key', identity).load(path)).rejects.toMatchObject({
      code: 'JOURNAL_AUTHENTICATION_REFUSED',
    });
    await expect(
      new DiskSupportStorage('fixture-private-key', { ...identity, ownerId: 'other' }).load(path),
    ).rejects.toMatchObject({ code: 'JOURNAL_IDENTITY_CONFLICT' });
    await writeFile(path, original.replace('fixed', 'attacker-ref'));
    await expect(storage.load(path)).rejects.toMatchObject({
      code: 'JOURNAL_AUTHENTICATION_REFUSED',
    });
    await writeFile(path, JSON.stringify(state));
    await expect(storage.load(path)).rejects.toBeDefined();
    await expect(new DiskSupportStorage().save(path, state)).rejects.toMatchObject({
      code: 'JOURNAL_CREDENTIAL_REQUIRED',
    });
    await expect(
      storage.save(path, { ...state, body: 'fixture-private-key' }),
    ).rejects.toMatchObject({ code: 'JOURNAL_SECRET_REFUSED' });
    await expect(
      storage.text(root, join(root, 'secret.md'), 'fixture-private-key'),
    ).rejects.toMatchObject({ code: 'JOURNAL_SECRET_REFUSED' });
  });
  it('refuses an interior directory link and never writes through it', async () => {
    const root = await temp(),
      outside = await temp(),
      storage = new DiskSupportStorage();
    await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(
      storage.text(root, join(root, 'linked', 'body.md'), 'wrong'),
    ).rejects.toMatchObject({ code: 'PATH_LINK_REFUSED' });
    expect(await storage.exists(join(outside, 'body.md'))).toBe(false);
    await expect(storage.canonical(join(root, 'linked'))).rejects.toMatchObject({
      code: 'PATH_LINK_REFUSED',
    });
  });
  it('hashes all deterministic source delegates and refuses build fallback/mismatched version', async () => {
    const root = await temp();
    const modules = [
      'authority',
      'binding',
      'errors',
      'subjects',
      'github/client',
      'github/entry',
      'github/implementation',
      'github/process',
      'github/protocol',
      'github/repository',
      'github/storage',
      'github/support-input',
    ];
    for (const module of modules) {
      const path = join(root, 'src', 'templates', module + '.ts');
      await mkdir(resolve(path, '..'), { recursive: true });
      await writeFile(path, module);
    }
    const before = await implementationSupportClosure(root, '1.0.0', true);
    expect(before.path).toBe(join(root, 'src', 'templates', 'github', 'entry.ts'));
    await writeFile(join(root, 'src', 'templates', 'github', 'repository.ts'), 'changed delegate');
    expect((await implementationSupportClosure(root, '1.0.0', true)).hash).not.toBe(before.hash);
    await expect(implementationSupportClosure(root, '1.0.0', false)).rejects.toBeDefined();
    await expect(implementationSupportClosure(root, '9.0.0', true)).rejects.toMatchObject({
      code: 'TEMPLATE_PACKAGE_INVALID',
    });
    for (const module of modules) {
      const path = join(root, 'dist', 'templates', module + '.js');
      await mkdir(resolve(path, '..'), { recursive: true });
      await writeFile(path, module);
    }
    expect((await implementationSupportClosure(root, '1.0.0', false)).path).toBe(
      join(root, 'dist', 'templates', 'github', 'entry.js'),
    );
  });
});
describe('trusted implementation selection', () => {
  it('accepts only issue selectors and refuses authored attempts/provenance/foreign kinds', async () => {
    const f = fixture();
    const binding = TemplateBindingSchema.parse({
      instanceId: fakeUlid('instance'),
      ownerId: 'local',
      manifest: {
        id: 'implementation',
        version: '1.0.0',
        kind: 'implementation',
        title: 'Implement',
        description: 'Implement',
        tags: [],
        roles: [],
        prerequisites: [],
        requiredSecrets: [],
        parentKey: 'parent',
        loops: [{ key: 'parent', file: 'parent.json' }],
      },
      settings,
      loops: [],
    });
    const authority = new ImplementationAuthority({} as TemplateInstances, async () => f.deps);
    expect(await authority.resolve(binding, { issue: 42 })).toEqual({
      kind: 'implementation',
      repository: 'example/repo',
      issue: 42,
    });
    expect(
      await authority.resolve(binding, { id: 'example/repo#42@1', payload: { issue: 42 } }),
    ).toMatchObject({ issue: 42 });
    for (const payload of [
      { issue: 42, attempt: 2 },
      { id: 9, payload: { issue: 42 } },
      { issue: 42, repository: 'other/repo' },
      null,
    ])
      await expect(authority.resolve(binding, payload)).rejects.toMatchObject({
        code: 'TEMPLATE_AUTHORITY_REFUSED',
      });
    f.github.current.body = '';
    await expect(authority.resolve(binding, { issue: 42 })).rejects.toMatchObject({
      code: 'TEMPLATE_AUTHORITY_REFUSED',
    });
    binding.manifest.kind = 'review';
    await expect(authority.resolve(binding, { issue: 42 })).rejects.toMatchObject({
      code: 'TEMPLATE_AUTHORITY_UNAVAILABLE',
    });
  });
  it.each([
    'Closes #42',
    'Closes Example/Repo#42',
    'Fixes https://github.com/example/repo/issues/42',
  ])('recognizes one exact closing reference %s', (body) => {
    expect(closingIssue(body, 'example/repo', 42)).toBe(true);
    expect(closingIssue(body + '\nCloses #42', 'example/repo', 42)).toBe(false);
  });
});

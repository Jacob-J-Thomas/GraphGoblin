/* Inert asynchronous ports keep the production signatures; no executable is launched. */
/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonValueSchema, ReviewTemplateSettingsSchema } from '@graphgoblin/contracts';
import { fakeUlid, FIXTURE_TS } from '@graphgoblin/contracts/testing';
import { createInitialThread } from '@graphgoblin/engine';
import { ReviewSupport, type ReviewDependencies } from './review.js';
import { ReviewEnvelopeSchema, type ReviewEnvelope } from './review-protocol.js';
import { SignedReviewJournal, type ArtifactFiles } from './review-storage.js';
import { ImplementationRepository } from './repository.js';
import { ReviewPullRequestSchema, type ReviewGithubPort, type CheckFact } from './review-client.js';
import type { CommandRequest, CommandResult, CommandRunner } from './process.js';
const original = 'a'.repeat(40),
  tree = 'b'.repeat(40),
  runId = fakeUlid('review-run');
const approved = { verdict: 'approved', summary: 'Exact-head review passed.', findings: [] };
const changes = {
  verdict: 'changes',
  summary: 'Repair bounds.',
  findings: [
    {
      id: 'bounds',
      path: 'src/a.ts',
      line: 2,
      severity: 'blocking',
      message: 'Reject negative values.',
    },
  ],
};
const good = (stdout = ''): CommandResult => ({
  exitCode: 0,
  stdout,
  stderr: '',
  timedOut: false,
  overflow: false,
  termination: 'confirmed',
});
function fixture(human = false, issue: number | null = 42) {
  const settings = ReviewTemplateSettingsSchema.parse({
    kind: 'review',
    repository: {
      path: join(tmpdir(), 'gg-review-inert'),
      owner: 'Example',
      name: 'Repo',
      baseBranch: 'main',
    },
    supportReadKey: 'reader',
    roles: {
      reviewer: { harness: 'codex', model: 'gpt-6-sol', effort: 'high' },
      fixer: { harness: 'codex', model: 'gpt-6-luna', effort: 'low' },
    },
    requireHumanBeforeMerge: human,
    limits: { ciWaitMinutes: 1 },
  });
  const filesMap = new Map<string, string>(),
    paths = new Set([
      resolve(settings.repository.path),
      join(resolve(settings.repository.path), '.git'),
    ]);
  const files: ArtifactFiles = {
    canonical: async (path) => {
      if (!paths.has(resolve(path))) throw new Error('inert path missing');
      return resolve(path);
    },
    directory: async (_root, path) => {
      paths.add(resolve(path));
    },
    exists: async (path) => paths.has(resolve(path)) || filesMap.has(path),
    read: async (path) => filesMap.get(path),
    text: async (_root, path, value) => {
      filesMap.set(path, value);
    },
  };
  const pr = ReviewPullRequestSchema.parse({
    number: 7,
    title: 'Bounded correction',
    body: 'Closes #42',
    state: 'open',
    draft: false,
    merged: false,
    merge_commit_sha: null,
    head: { ref: 'topic', sha: original, repo: { full_name: 'example/repo' } },
    base: { ref: 'main', repo: { full_name: 'example/repo' } },
    user: { login: 'Writer' },
  });
  const effects: string[] = [],
    comments = new Map<number, { body: string }[]>(),
    gates: CommandResult[] = [];
  const work = { head: original, parent: original, tree, message: '', dirty: false, branch: '' };
  let fetched = original,
    serial = 1;
  let moveGate = false,
    dirtyGate = false,
    throwGate = false,
    pushGap = false,
    commitGap = false,
    mergeGap = false,
    closeGap = false,
    postGap = false;
  let permission = 'write',
    checks: CheckFact[] = [
      { name: 'Gates', head: original, appId: 9, passed: true, pending: false },
    ],
    ready = true,
    reviewsSatisfied = true,
    auth = true,
    links = issue === null ? [] : [{ repository: 'example/repo', number: issue }];
  const commands: CommandRunner = {
    run: async (request) => {
      calls.push(structuredClone(request));
      if (request.program === 'gate') {
        effects.push('gate');
        if (throwGate) throw new Error('private-review-token');
        if (moveGate) work.head = 'd'.repeat(40);
        if (dirtyGate) work.dirty = true;
        return gates.shift() ?? good();
      }
      if (request.program !== 'git') throw new Error('unexpected inert program');
      const args = request.args.slice(7),
        cmd = args[0];
      if (cmd === 'remote') return good('https://github.com/example/repo.git');
      if (cmd === 'rev-parse') {
        if (args[1] === '--show-toplevel') return good(request.cwd);
        if (args[1] === '--git-common-dir') return good(join(settings.repository.path, '.git'));
        if (args[1] === '--abbrev-ref') return good(work.branch || 'main');
        if (args[1] === '--verify') return { ...good(), exitCode: 1 };
        if (args[1] === 'FETCH_HEAD') return good(fetched);
        if (args[1] === 'HEAD^') return good(work.parent);
        if (args[1] === 'HEAD^{tree}') return good(work.tree);
        return good(work.head);
      }
      if (cmd === 'fetch') {
        fetched = pr.head.sha;
        return good();
      }
      if (cmd === 'worktree') {
        const path = String(args[4]);
        paths.add(resolve(path));
        work.branch = String(args[3]);
        work.head = String(args[5]);
        return good();
      }
      if (cmd === 'status') return good(work.dirty ? ' M a.ts' : '');
      if (cmd === 'add') return good();
      if (cmd === 'write-tree') return good(work.tree);
      if (cmd === 'commit') {
        effects.push('commit');
        work.parent = work.head;
        work.head = (++serial).toString(16).padStart(40, '0');
        work.message = String(args[3]);
        work.dirty = false;
        if (commitGap) {
          commitGap = false;
          throw new Error('commit response lost');
        }
        return good();
      }
      if (cmd === 'show') return good(work.message);
      if (cmd === 'ls-remote')
        return good(pr.head.sha + '\\trefs/heads/topic'.replace('\\t', '\t'));
      if (cmd === 'push') {
        effects.push('push');
        pr.head.sha = String(args[2]).split(':')[0]!;
        checks = checks.map((check) => ({ ...check, head: pr.head.sha }));
        if (pushGap) {
          pushGap = false;
          throw new Error('push response lost');
        }
        return good();
      }
      throw new Error('unexpected inert operation ' + args.join(' '));
    },
  };
  const calls: CommandRequest[] = [];
  const github: ReviewGithubPort = {
    authenticate: async () => {
      if (!auth) throw new Error('private-review-token');
    },
    pullRequest: async () => structuredClone(pr),
    reviewCandidates: async () => [structuredClone(pr)],
    permission: async () => permission,
    linkedIssues: async () => links,
    issue: async () => ({
      number: issue!,
      title: 'Original',
      body: 'Acceptance',
      state: 'open',
      labels: [],
      html_url: 'https://github.com/example/repo/issues/' + issue,
    }),
    requiredChecks: async () => [{ name: 'Gates', appId: 9 }],
    checks: async () => checks,
    readiness: async () => ({
      head: pr.head.sha,
      mergeable: ready,
      clean: ready,
      reviewsSatisfied: ready && reviewsSatisfied,
    }),
    comments: async (_repo, number) => comments.get(number) ?? [],
    post: async (_repo, number, body) => {
      effects.push('post');
      comments.set(number, [...(comments.get(number) ?? []), { body }]);
      if (postGap) {
        postGap = false;
        throw new Error('post response lost');
      }
    },
    label: async () => {
      effects.push('label');
    },
    merge: async (_repo, _number, head) => {
      effects.push('merge');
      if (pr.head.sha !== head) throw new Error('moved head');
      pr.merged = true;
      pr.state = 'closed';
      pr.merge_commit_sha = 'c'.repeat(40);
      if (mergeGap) {
        mergeGap = false;
        throw new Error('merge response lost');
      }
    },
    close: async () => {
      effects.push('close');
      pr.state = 'closed';
      if (closeGap) {
        closeGap = false;
        throw new Error('close response lost');
      }
    },
  };
  let time = 0;
  const deps: ReviewDependencies = {
    github,
    commands,
    files,
    git: 'git',
    gate: async () => ({ program: 'gate', args: [] }),
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
  };
  const loopId = fakeUlid('review-loop'),
    versionId = fakeUlid('review-version');
  const env = ReviewEnvelopeSchema.parse({
    settings,
    credential: 'private-review-token',
    visit: 1,
    identity: {
      kind: 'node',
      ownerId: 'local',
      runId,
      loopId,
      versionId,
      nodeId: 'prepare',
      startedSeq: 1,
    },
    subject: {
      role: 'parent',
      kind: 'review',
      instanceId: fakeUlid('review-instance'),
      templateVersion: '1.0.0',
      repository: 'example/repo',
      issue,
      attempt: issue === null ? null : 1,
      source: { kind: 'external' },
      pullRequest: 7,
      head: original,
    },
    claim: {
      type: 'ClaimRecord',
      repository: 'example/repo',
      issue,
      attempt: issue === null ? null : 1,
    },
    wake: null,
    input: createInitialThread({
      runId,
      loopId,
      versionId,
      invocation: {
        id: fakeUlid('review-invocation'),
        source: 'manual.api',
        trigger: {
          nodeId: 'start',
          kind: 'manual',
          payload: { pullRequest: 7 },
          receivedAt: FIXTURE_TS,
        },
      },
    }),
  });
  const repo = new ImplementationRepository(settings, commands, files, 'git', 'review');
  let support = new ReviewSupport(deps),
    visit = 1;
  const journal = () =>
    new SignedReviewJournal(files, env.credential, {
      ownerId: 'local',
      runId,
      repository: 'example/repo',
      pullRequest: 7,
      originalHead: original,
      issue,
      attempt: issue === null ? null : 1,
    });
  async function act(action: string, value?: unknown, reuse?: number) {
    if (env.identity.kind !== 'node') throw new Error('node required');
    env.identity.nodeId = action;
    env.visit = reuse ?? visit++;
    env.identity.startedSeq = env.visit;
    if (value !== undefined)
      env.input!.lastOutput = {
        nodeId: 'model',
        value: JsonValueSchema.parse(value),
        at: FIXTURE_TS,
      };
    return support.execute(action, env);
  }
  const wake = (decision: 'merge' | 'close' | 'another-cycle', seq = 1000, capped = false) => {
    env.wake = {
      reason: 'input',
      nodeId: capped ? 'human-wait-capped' : 'human-wait',
      startedSeq: seq - 2,
      inputSeq: seq - 1,
      seq,
      payload: { decision },
    };
  };
  const timeout = (seq = 1000) => {
    env.wake = { reason: 'timeout', nodeId: 'human-wait', startedSeq: seq - 2, seq };
  };
  async function prepare() {
    expect(await act('prepare')).toMatchObject({ type: 'ReviewWorkspace', head: original });
  }
  async function gate() {
    expect(await act('gate')).toMatchObject({ type: 'ReviewGate', passed: true });
  }
  const state = () => journal().load(repo.journal(runId));
  return {
    settings,
    env,
    deps,
    filesMap,
    paths,
    repo,
    pr,
    effects,
    comments,
    work,
    calls,
    gates,
    act,
    prepare,
    gate,
    state,
    journal,
    wake,
    timeout,
    restart: () => {
      support = new ReviewSupport(deps);
    },
    set: (options: {
      moveGate?: boolean;
      dirtyGate?: boolean;
      throwGate?: boolean;
      pushGap?: boolean;
      commitGap?: boolean;
      mergeGap?: boolean;
      closeGap?: boolean;
      postGap?: boolean;
      permission?: string;
      checks?: CheckFact[];
      ready?: boolean;
      reviewsSatisfied?: boolean;
      auth?: boolean;
      links?: typeof links;
    }) => {
      if (options.moveGate !== undefined) moveGate = options.moveGate;
      if (options.dirtyGate !== undefined) dirtyGate = options.dirtyGate;
      if (options.throwGate !== undefined) throwGate = options.throwGate;
      if (options.pushGap !== undefined) pushGap = options.pushGap;
      if (options.commitGap !== undefined) commitGap = options.commitGap;
      if (options.mergeGap !== undefined) mergeGap = options.mergeGap;
      if (options.closeGap !== undefined) closeGap = options.closeGap;
      if (options.postGap !== undefined) postGap = options.postGap;
      if (options.permission !== undefined) permission = options.permission;
      if (options.checks !== undefined) checks = options.checks;
      if (options.ready !== undefined) ready = options.ready;
      if (options.reviewsSatisfied !== undefined) reviewsSatisfied = options.reviewsSatisfied;
      if (options.auth !== undefined) auth = options.auth;
      if (options.links !== undefined) links = options.links;
    },
  };
}
describe('authenticated review support state machine', () => {
  it.each(['😀'.repeat(20000), '\\n'.repeat(33000)])(
    'bounds the exact serialized workspace output before journal or worktree effects',
    async (body) => {
      const f = fixture();
      f.pr.body = body;
      const pathsBefore = [...f.paths];
      expect(await f.act('prepare')).toMatchObject({
        type: 'SupportBlocked',
        code: 'SUPPORT_OUTPUT_TOO_LARGE',
      });
      expect([...f.paths]).toEqual(pathsBefore);
      expect(f.filesMap.size).toBe(0);
      expect(
        f.calls.some(
          (call) => call.args.slice(7)[0] === 'worktree' || call.args.slice(7)[0] === 'fetch',
        ),
      ).toBe(false);
      expect(f.effects).toEqual([]);
    },
  );
  it('approves and merges exact gated head, with standalone nullable issue and restart-safe merge intent', async () => {
    const f = fixture(false, null);
    await f.prepare();
    await f.gate();
    expect(await f.act('verdict', approved)).toMatchObject({ route: 'merge', automaticCycles: 1 });
    f.set({ mergeGap: true });
    expect(await f.act('merge', undefined, 20)).toMatchObject({ type: 'SupportBlocked' });
    f.restart();
    expect(await f.act('merge', undefined, 20)).toEqual({
      type: 'ReviewMerged',
      pullRequest: 7,
      head: original,
    });
    expect(f.effects.filter((value) => value === 'merge')).toHaveLength(1);
    expect(f.effects).not.toContain('label');
    expect([...f.comments.keys()]).toEqual([7]);
    expect(JSON.stringify([...f.filesMap.values()])).not.toContain(f.env.credential);
  });
  it('runs three automatic fresh-head reviews then permits exactly three human extra cycles, each returning to wait', async () => {
    const f = fixture();
    await f.prepare();
    for (let index = 0; index < 3; index++) {
      await f.gate();
      expect(await f.act('verdict', changes)).toMatchObject({
        route: index === 2 ? 'wait' : 'fix',
        automaticCycles: index + 1,
      });
      if (index < 2) {
        expect(await f.act('fix-prepare')).toMatchObject({ type: 'ReviewFix' });
        f.work.dirty = true;
        expect(await f.act('fixer-head', { summary: 'Applied bounds.' })).toMatchObject({
          type: 'FixerHead',
        });
      }
    }
    for (let index = 0; index < 3; index++) {
      f.wake('another-cycle', 1000 + index * 10);
      expect(await f.act('human')).toMatchObject({ route: 'fix', extraCycles: index + 1 });
      await f.act('fix-prepare');
      f.work.dirty = true;
      await f.act('fixer-head', { summary: 'Applied extra correction.' });
      await f.gate();
      expect(await f.act('verdict', approved)).toMatchObject({
        route: 'wait',
        extraCycles: index + 1,
      });
    }
    f.wake('another-cycle', 1100);
    expect(await f.act('human')).toMatchObject({ code: 'EXTRA_CYCLE_LIMIT' });
    expect(f.effects.filter((value) => value === 'gate')).toHaveLength(6);
    expect(f.effects).not.toContain('merge');
  });
  it('human requirement prevents automatic approval and authenticated close remains unmerged with idempotent remote recovery', async () => {
    const f = fixture(true);
    await f.prepare();
    await f.gate();
    expect(await f.act('verdict', approved)).toMatchObject({ route: 'wait' });
    expect(await f.act('merge')).toMatchObject({ code: 'MERGE_NOT_AUTHORIZED' });
    f.wake('close');
    await f.act('human');
    f.set({ closeGap: true });
    expect(await f.act('close', undefined, 20)).toMatchObject({ type: 'SupportBlocked' });
    f.restart();
    expect(await f.act('close', undefined, 20)).toMatchObject({ type: 'ReviewClosed', issue: 42 });
    expect(f.pr.merged).toBe(false);
    expect(f.effects.filter((value) => value === 'close')).toHaveLength(1);
  });
  it('accepts a human merge only on current passing gates and refuses later stale head or protection', async () => {
    const f = fixture(true);
    await f.prepare();
    await f.gate();
    await f.act('verdict', approved);
    await f.act('summary');
    f.wake('merge');
    expect(await f.act('human')).toMatchObject({ route: 'merge' });
    f.set({ ready: false });
    expect(await f.act('merge')).toMatchObject({ code: 'MERGE_PROTECTION_UNAVAILABLE' });
    expect(f.effects).not.toContain('merge');
    f.pr.head.sha = 'e'.repeat(40);
    expect(await f.act('merge')).toMatchObject({ code: 'PR_HEAD_CHANGED' });
  });
  it('reviews approval-required heads before native approval, then rechecks that approval at human merge', async () => {
    const f = fixture(true);
    f.set({ reviewsSatisfied: false });
    await f.prepare();
    await f.gate();
    expect(await f.act('verdict', approved)).toMatchObject({ route: 'wait', automaticCycles: 1 });
    await f.act('summary');
    f.wake('merge');
    expect(await f.act('human')).toMatchObject({ route: 'merge' });
    expect(await f.act('merge', undefined, 30)).toMatchObject({
      code: 'MERGE_PROTECTION_UNAVAILABLE',
    });
    expect(f.effects).not.toContain('merge');
    f.restart();
    f.set({ reviewsSatisfied: true });
    expect(await f.act('merge', undefined, 30)).toMatchObject({
      type: 'ReviewMerged',
      head: original,
    });
    expect(f.effects.filter((effect) => effect === 'merge')).toHaveLength(1);
  });
  it('does not require native mergeability or a clean GitHub readiness snapshot before AI review', async () => {
    const f = fixture();
    f.set({ ready: false });
    await f.prepare();
    await f.gate();
    expect(await f.act('verdict', approved)).toMatchObject({ route: 'merge' });
    expect(await f.act('merge')).toMatchObject({ code: 'MERGE_PROTECTION_UNAVAILABLE' });
    expect(f.effects).not.toContain('merge');
  });
  it('permits genuine human merge after timed-out CI becomes ready without another gate or model cycle', async () => {
    const f = fixture(true);
    await f.prepare();
    f.set({ checks: [{ name: 'Gates', head: original, appId: 9, passed: false, pending: true }] });
    expect(await f.act('gate')).toMatchObject({ passed: false });
    expect((await f.state())?.gate).toMatchObject({ passed: true, checks: false, head: original });
    expect(await f.act('verdict', approved)).toMatchObject({ code: 'GATES_REQUIRED' });
    expect(await f.act('summary')).toMatchObject({ mergeAllowed: true });
    f.wake('merge');
    expect(await f.act('human')).toMatchObject({ route: 'merge' });
    f.restart();
    f.set({ checks: [{ name: 'Gates', head: original, appId: 9, passed: true, pending: false }] });
    expect(await f.act('merge')).toMatchObject({ type: 'ReviewMerged' });
    expect(f.effects.filter((effect) => effect === 'gate')).toHaveLength(1);
    expect((await f.state())?.automaticCycles).toBe(0);
  });
  it.each(['ci', 'local', 'head'] as const)(
    'refuses authentic human merge when the current %s invariant is unsatisfied',
    async (mode) => {
      const f = fixture(true);
      await f.prepare();
      f.set({
        checks: [{ name: 'Gates', head: original, appId: 9, passed: false, pending: true }],
      });
      if (mode === 'local') f.gates.push({ ...good(), exitCode: 1 });
      expect(await f.act('gate')).toMatchObject({ passed: false });
      await f.act('summary');
      f.wake('merge');
      await f.act('human');
      f.restart();
      if (mode !== 'ci')
        f.set({
          checks: [{ name: 'Gates', head: original, appId: 9, passed: true, pending: false }],
        });
      if (mode === 'head') f.pr.head.sha = 'e'.repeat(40);
      expect(await f.act('merge')).toMatchObject({
        type: 'SupportBlocked',
        code:
          mode === 'ci'
            ? 'MERGE_PROTECTION_UNAVAILABLE'
            : mode === 'local'
              ? 'MERGE_NOT_AUTHORIZED'
              : 'PR_HEAD_CHANGED',
      });
      expect(f.effects).not.toContain('merge');
    },
  );
  it('records reminders before effects, never merges on timeout and retains exactly the finite bound across restart', async () => {
    const f = fixture(true);
    await f.prepare();
    await f.gate();
    await f.act('verdict', approved);
    for (let index = 0; index < 3; index++) {
      f.timeout(1000 + 10 * index);
      const visit = 20 + index;
      expect(await f.act('reminder', undefined, visit)).toMatchObject({
        route: index === 2 ? 'timeout' : 'wait',
        reminders: index + 1,
      });
      f.restart();
      expect(await f.act('reminder', undefined, visit)).toMatchObject({ reminders: index + 1 });
    }
    expect(await f.act('timeout')).toMatchObject({
      type: 'ReviewTimedOut',
      reason: 'HUMAN_REVIEW_TIMEOUT',
    });
    expect(f.pr.state).toBe('open');
    expect(f.effects).not.toContain('merge');
    expect((await f.state())?.reminders).toBe(3);
  });
  it('rejects missing or consumed human authority, capped extra cycle, reviewer-shaped input and merge-shaped timeout', async () => {
    const f = fixture(true);
    await f.prepare();
    await f.gate();
    await f.act('verdict', approved);
    expect(await f.act('human', approved)).toMatchObject({ code: 'HUMAN_INPUT_REQUIRED' });
    f.wake('another-cycle', 1000, true);
    expect(await f.act('human')).toMatchObject({ code: 'EXTRA_CYCLE_LIMIT' });
    f.wake('merge', 1010);
    await f.act('human');
    expect(await f.act('human')).toMatchObject({ code: 'HUMAN_INPUT_REQUIRED' });
    expect(await f.act('reminder')).toMatchObject({ code: 'HUMAN_TIMEOUT_REQUIRED' });
    f.timeout(1020);
    expect(await f.act('human')).toMatchObject({ code: 'HUMAN_INPUT_REQUIRED' });
  });
  it.each(['head', 'dirty', 'uncertain', 'throw'] as const)(
    'quarantines or rejects gate effects on %s and never fabricates approval',
    async (mode) => {
      const f = fixture();
      await f.prepare();
      if (mode === 'head') f.set({ moveGate: true });
      if (mode === 'dirty') f.set({ dirtyGate: true });
      if (mode === 'throw') f.set({ throwGate: true });
      if (mode === 'uncertain') f.gates.push({ ...good(), termination: 'unconfirmed' });
      const result = await f.act('gate', undefined, 10);
      expect(result).toMatchObject(
        mode === 'dirty' ? { type: 'ReviewGate', passed: false } : { type: 'SupportBlocked' },
      );
      if (mode !== 'dirty') {
        f.restart();
        expect(await f.act('gate', undefined, 10)).toMatchObject({ code: 'WORKSPACE_QUARANTINED' });
        expect(f.effects.filter((value) => value === 'gate')).toHaveLength(1);
      }
      expect(await f.act('verdict', approved)).toMatchObject({ type: 'SupportBlocked' });
      expect(f.effects).not.toContain('merge');
    },
  );
  it.each(['missing', 'pending', 'wrong-app', 'wrong-sha'] as const)(
    'cannot approve or merge %s checks',
    async (mode) => {
      const f = fixture();
      await f.prepare();
      const check = { name: 'Gates', head: original, appId: 9, passed: true, pending: false };
      f.set({
        checks:
          mode === 'missing'
            ? []
            : [
                {
                  ...check,
                  ...(mode === 'pending'
                    ? { passed: false, pending: true }
                    : mode === 'wrong-app'
                      ? { appId: 10 }
                      : { head: 'e'.repeat(40) }),
                },
              ],
      });
      expect(await f.act('gate')).toMatchObject({ type: 'ReviewGate', passed: false });
      expect(await f.act('verdict', approved)).toMatchObject({ code: 'GATES_REQUIRED' });
      expect(f.effects).not.toContain('merge');
    },
  );
  it.each(['commitGap', 'pushGap'] as const)(
    'reconciles %s on the original fixer visit without a second effect',
    async (gap) => {
      const f = fixture();
      await f.prepare();
      await f.gate();
      await f.act('verdict', changes);
      await f.act('fix-prepare');
      f.work.dirty = true;
      f.set({ [gap]: true });
      expect(await f.act('fixer-head', { summary: 'Fixed' }, 20)).toMatchObject({
        type: 'SupportBlocked',
      });
      f.restart();
      expect(await f.act('fixer-head', { summary: 'Fixed' }, 20)).toMatchObject({
        type: 'FixerHead',
        head: f.work.head,
      });
      expect(f.effects.filter((value) => value === 'commit')).toHaveLength(1);
      expect(f.effects.filter((value) => value === 'push')).toHaveLength(1);
      expect(
        f.calls
          .filter((call) => call.args.includes('push'))
          .every((call) => !call.args.some((arg) => arg.includes('force'))),
      ).toBe(true);
    },
  );
  it('reconciles response-lost comments before returning a cached verdict and refuses conflicting markers', async () => {
    const f = fixture();
    await f.prepare();
    await f.gate();
    f.set({ postGap: true });
    expect(await f.act('verdict', approved, 20)).toMatchObject({ type: 'SupportBlocked' });
    f.restart();
    expect(await f.act('verdict', approved, 20)).toMatchObject({ route: 'merge' });
    expect(f.comments.get(7)).toHaveLength(1);
    const row = f.comments.get(7)![0]!;
    row.body += 'forged';
    const state = (await f.state())!;
    state.notices['verdict:20']!.prDone = false;
    await f.journal().save(f.repo.journal(runId), state);
    expect(await f.act('verdict', approved, 20)).toMatchObject({
      code: 'COMMENT_RECONCILIATION_REFUSED',
    });
  });
  it.each(['fork', 'author', 'links', 'auth'] as const)(
    'refuses %s before workspace or gate effects',
    async (mode) => {
      const f = fixture();
      if (mode === 'fork') f.pr.head.repo.full_name = 'foreign/repo';
      if (mode === 'author') f.set({ permission: 'read' });
      if (mode === 'links')
        f.set({
          links: [
            { repository: 'example/repo', number: 42 },
            { repository: 'example/repo', number: 43 },
          ],
        });
      if (mode === 'auth') f.set({ auth: false });
      expect(await f.act('prepare')).toMatchObject({ type: 'SupportBlocked' });
      expect(f.effects).toEqual([]);
      expect(f.filesMap.size).toBe(0);
    },
  );
  it('poll emits curated PR/head and claim retains nullable linkage, while forged strict proposal is blocked', async () => {
    const f = fixture(false, null);
    const poll: ReviewEnvelope = ReviewEnvelopeSchema.parse({
      ...f.env,
      input: null,
      visit: null,
      subject: null,
      claim: null,
      wake: null,
      identity: {
        kind: 'poll',
        ownerId: 'local',
        loopId: fakeUlid('poll-loop'),
        versionId: fakeUlid('poll-version'),
        nodeId: 'poll',
      },
    });
    expect(await new ReviewSupport(f.deps).execute('poll', poll)).toEqual({
      items: [{ id: 7, payload: { pullRequest: 7, head: original } }],
    });
    expect(await f.act('claim')).toMatchObject({ type: 'ClaimRecord', issue: null, attempt: null });
    await f.prepare();
    await f.gate();
    expect(await f.act('verdict', { ...approved, findings: changes.findings })).toMatchObject({
      type: 'SupportBlocked',
    });
    expect(await f.act('verdict', { ...approved, authority: true })).toMatchObject({
      type: 'SupportBlocked',
    });
    expect(f.effects).not.toContain('merge');
  });
  it('permits a single human repair after initial gate failure and produces fixed blocked reporting', async () => {
    const f = fixture(true);
    await f.prepare();
    f.gates.push({ ...good(), exitCode: 1 });
    expect(await f.act('gate')).toMatchObject({ passed: false });
    expect(await f.act('summary')).toMatchObject({ mergeAllowed: false });
    f.wake('another-cycle');
    await f.act('human');
    expect(await f.act('fix-prepare')).toMatchObject({ type: 'ReviewFix' });
    f.work.dirty = true;
    await f.act('fixer-head', { summary: 'Repaired gates' });
    await f.gate();
    expect(await f.act('verdict', approved)).toMatchObject({ route: 'wait' });
    expect(await f.act('block')).toMatchObject({ type: 'ReviewBlocked' });
    expect(f.comments.get(42)?.some((row) => row.body.includes('Manual recovery'))).toBe(true);
  });
});

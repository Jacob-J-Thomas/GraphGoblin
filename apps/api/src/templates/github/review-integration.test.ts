/* Every command, GitHub effect, and model turn below is injected and inert. */
/* eslint-disable @typescript-eslint/require-await */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ReviewTemplateSettingsSchema,
  type RunRecord,
  type TemplateInstantiateResponse,
} from '@graphgoblin/contracts';
import { fakeUlid } from '@graphgoblin/contracts/testing';
import type { ScriptPort } from '@graphgoblin/engine';
import {
  CapturingLogger,
  FakeClock,
  FakeClassifierRegistry,
  FakeDecider,
  FakeHarness,
  FakeStructured,
} from '@graphgoblin/engine/testing';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createContainer, type Container } from '../../container.js';
import type { ApiInstance } from '../../types.js';
import { TemplateBindingSchema } from '../binding.js';
import { readAuthority, checkedEvents } from '../authority.js';
import { ReviewSupport, type ReviewDependencies } from './review.js';
import { ReviewEnvelopeSchema, type ReviewEnvelope } from './review-protocol.js';
import { ReviewPullRequestSchema, type ReviewGithubPort } from './review-client.js';
import type { ArtifactFiles } from './review-storage.js';
import type { CommandResult } from './process.js';

const original = 'a'.repeat(40);
const approved = { verdict: 'approved', summary: 'The exact head passed review.', findings: [] };
const good = (stdout = ''): CommandResult => ({
  exitCode: 0,
  stdout,
  stderr: '',
  timedOut: false,
  overflow: false,
  termination: 'confirmed',
});
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});
async function fixture(capped = false) {
  const dataDir = await mkdtemp(join(tmpdir(), 'gg-review-composed-'));
  const repository = join(dataDir, 'inert-repository');
  const clock = new FakeClock(),
    logger = new CapturingLogger(),
    harness = new FakeHarness();
  const settings = ReviewTemplateSettingsSchema.parse({
    kind: 'review',
    repository: { path: repository, owner: 'Example', name: 'Repo', baseBranch: 'main' },
    supportReadKey: 'reader',
    roles: {
      reviewer: { harness: 'codex', model: 'gpt-6-sol', effort: 'high' },
      fixer: { harness: 'codex', model: 'gpt-6-luna', effort: 'low' },
    },
    requireHumanBeforeMerge: true,
    limits: { extraCycles: capped ? 0 : 3, waitHours: 1, reminders: 1 },
  });
  const pr = ReviewPullRequestSchema.parse({
    number: 7,
    title: 'Bounded review',
    body: 'Original PR',
    state: 'open',
    draft: false,
    merged: false,
    merge_commit_sha: null,
    user: { login: 'Writer' },
    head: { ref: 'topic', sha: original, repo: { full_name: 'example/repo' } },
    base: { ref: 'main', repo: { full_name: 'example/repo' } },
  });
  const paths = new Set([resolve(repository), join(resolve(repository), '.git')]),
    rows = new Map<string, string>(),
    comments = new Map<number, { body: string }[]>();
  const effects: string[] = [],
    envelopes: ReviewEnvelope[] = [];
  const work = { head: original, branch: '' };
  let claimMoves = false,
    serial = 0;
  const files: ArtifactFiles = {
    canonical: async (path) => resolve(path),
    directory: async (_root, path) => {
      paths.add(resolve(path));
    },
    exists: async (path) => paths.has(resolve(path)),
    read: async (path) => rows.get(path),
    text: async (_root, path, text) => {
      rows.set(path, text);
    },
  };
  const github: ReviewGithubPort = {
    authenticate: async () => {},
    pullRequest: async () => structuredClone(pr),
    reviewCandidates: async () => (pr.state === 'open' ? [structuredClone(pr)] : []),
    permission: async () => 'write',
    linkedIssues: async () => [],
    issue: async () => {
      throw new Error('No linked issue must mean no issue calls.');
    },
    requiredChecks: async () => [],
    checks: async () => [],
    readiness: async () => ({
      head: pr.head.sha,
      mergeable: true,
      clean: true,
      reviewsSatisfied: true,
    }),
    comments: async (_repo, n) => comments.get(n) ?? [],
    post: async (_repo, n, body) => {
      effects.push('comment');
      comments.set(n, [...(comments.get(n) ?? []), { body }]);
    },
    label: async () => {
      throw new Error('No linked issue must mean no issue labels.');
    },
    merge: async (_repo, _pr, head) => {
      expect(head).toBe(pr.head.sha);
      effects.push('merge');
      pr.state = 'closed';
      pr.merged = true;
      pr.merge_commit_sha = 'c'.repeat(40);
    },
    close: async () => {
      effects.push('close');
      pr.state = 'closed';
    },
  };
  const deps: ReviewDependencies = {
    files,
    github,
    git: 'inert-git',
    gate: async () => ({ program: 'inert-gate', args: [] }),
    now: () => clock.now().getTime(),
    sleep: async (ms) => {
      clock.advance(ms);
    },
    commands: {
      run: async (request) => {
        if (request.program === 'inert-gate') {
          effects.push('gate');
          return good();
        }
        expect(request.program).toBe('inert-git');
        const args = request.args.slice(7);
        if (args[0] === 'remote') return good('https://github.com/example/repo.git');
        if (args[0] === 'rev-parse') {
          if (args[1] === '--show-toplevel') return good(request.cwd);
          if (args[1] === '--git-common-dir') return good(join(repository, '.git'));
          if (args[1] === '--verify') return { ...good(), exitCode: 1 };
          if (args[1] === '--abbrev-ref') return good(work.branch);
          if (args[1] === 'FETCH_HEAD') return good(pr.head.sha);
          return good(work.head);
        }
        if (args[0] === 'fetch') return good();
        if (args[0] === 'worktree') {
          paths.add(resolve(String(args[4])));
          work.branch = String(args[3]);
          work.head = String(args[5]);
          return good();
        }
        if (args[0] === 'status') return good();
        if (args[0] === 'ls-remote') return good(pr.head.sha + '\trefs/heads/topic');
        throw new Error('Unexpected inert Git operation ' + args[0]);
      },
    },
  };
  const support = new ReviewSupport(deps);
  const raw: ScriptPort = {
    run: async (request) => {
      if (request.command === 'git')
        return {
          exitCode: 0,
          stdout: request.args[0] === 'remote' ? 'https://github.com/example/repo.git' : repository,
          stderr: '',
          timedOut: false,
        };
      if (request.command === 'gh')
        return {
          exitCode: 0,
          stdout:
            request.args[0] === 'repo' ? JSON.stringify({ nameWithOwner: 'example/repo' }) : '',
          stderr: '',
          timedOut: false,
        };
      const envelope = ReviewEnvelopeSchema.parse(JSON.parse(request.stdin!));
      envelopes.push(envelope);
      expect(request.cwd).toBe(repository);
      expect(request.env).not.toHaveProperty('reader');
      const action = request.args.at(-1)!;
      if (action === 'claim' && claimMoves) pr.head.sha = 'b'.repeat(40);
      const value = await support.execute(action, envelope);
      return {
        exitCode: 0,
        stdout: JSON.stringify(value) + '\n',
        stderr: '',
        timedOut: false,
        stdoutOverflow: false,
        stderrOverflow: false,
      };
    },
  };
  const config = loadConfig({
    GG_DATA_DIR: dataDir,
    GG_DB_URL: pathToFileURL(join(dataDir, 'review.db')).href,
    GG_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
    GG_REQUIRE_API_KEY: 'true',
    GG_SWAGGER_UI: 'false',
    GG_WEB_DIST: '',
  });
  let container!: Container;
  let app!: ApiInstance;
  async function boot() {
    container = await createContainer(config, {
      harnesses: { codex: harness },
      deciders: [new FakeDecider('codex')],
      classifiers: new FakeClassifierRegistry(),
      structured: new FakeStructured(),
      clock,
      logger,
      ids: { next: () => fakeUlid(dataDir + ':' + ++serial) },
      scripts: raw,
      reviewDependencies: async () => deps,
      startTimers: false,
    });
    await container.start();
    app = await buildApp(container, { logger: false });
    await app.ready();
  }
  await boot();
  cleanups.push(async () => {
    await app.close();
    await container.stop();
    await rm(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(
      (error: unknown) => {
        if (!(error instanceof Error && 'code' in error && error.code === 'EBUSY')) throw error;
      },
    );
  });
  const key = await container.repos.apiKeys.create('local', 'operator', [
    'loops:write',
    'runs:write',
  ]);
  const readKey = await container.repos.apiKeys.create('local', 'read only', ['runs:read']);
  const foreign = await container.repos.apiKeys.create('foreign', 'foreign input', ['runs:write']);
  await container.repos.secretsFor('local').set('reader', readKey.token);
  const headers = { authorization: 'Bearer ' + key.token };
  const created = await app.inject({
    method: 'POST',
    url: '/templates/review/instantiate',
    headers,
    payload: { settings },
  });
  expect(created.statusCode, created.body).toBe(201);
  const instance = created.json<TemplateInstantiateResponse>().instance;
  const published = await app.inject({
    method: 'POST',
    url: '/loops/' + instance.parentLoopId + '/publish',
    headers,
    payload: {},
  });
  expect(published.statusCode, published.body).toBe(200);
  const view = async (runId: string) => {
    const response = await app.inject({ method: 'GET', url: '/runs/' + runId, headers });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<RunRecord>();
  };
  const idle = () => container.manager.waitForIdle();
  const answer = async (runId: string, input: unknown, auth = headers) =>
    app.inject({
      method: 'POST',
      url: '/runs/' + runId + '/input',
      headers: auth,
      payload: { input },
    });
  async function start() {
    harness.script([{ finalText: JSON.stringify(approved), structured: approved }]);
    const response = await app.inject({
      method: 'POST',
      url: '/loops/' + instance.parentLoopId + '/runs',
      headers,
      payload: { input: { pullRequest: 7 } },
    });
    expect(response.statusCode, response.body).toBe(202);
    const run = response.json<{ run: RunRecord }>().run;
    await idle();
    return view(run.id);
  }
  async function restart() {
    await app.close();
    await container.stop();
    await boot();
    await idle();
  }
  return {
    settings,
    pr,
    paths,
    effects,
    envelopes,
    harness,
    logger,
    readKey,
    foreign,
    instance,
    view,
    idle,
    answer,
    start,
    restart,
    container: () => container,
    app: () => app,
    headers,
    moveClaim: () => {
      claimMoves = true;
    },
    async poll() {
      clock.advance(61000);
      const result = await container.polls.poll();
      await idle();
      return result;
    },
    async timeout() {
      clock.advance(3600001);
      await container.timers.poll();
      await idle();
    },
  };
}
describe('composed review runs, polls and API human authority', () => {
  it.each([false, true])(
    'persists the %s capped wait through restart and authorizes close from the actual mapped input pair',
    async (capped) => {
      const f = await fixture(capped),
        run = await f.start();
      expect(run.status, JSON.stringify(run.failure)).toBe('waiting');
      expect(run.waiting?.nodeId).toBe(capped ? 'human-wait-capped' : 'human-wait');
      expect(run.waiting?.prompt).toContain('No linked issue');
      expect(f.harness.resumed).toEqual([]);
      await f.restart();
      expect((await f.view(run.id)).waiting).toEqual(run.waiting);
      expect(
        (
          await f.answer(
            run.id,
            { decision: 'close' },
            { authorization: 'Bearer ' + f.readKey.token },
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await f.answer(
            run.id,
            { decision: 'close' },
            { authorization: 'Bearer ' + f.foreign.token },
          )
        ).statusCode,
      ).toBe(404);
      expect((await f.answer(run.id, { decision: 'bogus' })).statusCode).toBe(400);
      if (capped)
        expect((await f.answer(run.id, { decision: 'another-cycle' })).statusCode).toBe(400);
      expect(f.effects).not.toContain('close');
      expect((await f.answer(run.id, { decision: 'close' })).statusCode).toBe(200);
      await f.idle();
      expect((await f.view(run.id)).status).toBe('succeeded');
      expect(f.effects.filter((effect) => effect === 'close')).toHaveLength(1);
      expect(f.effects).not.toContain('merge');
      const events = checkedEvents(await f.container().templates.store.events(run.id));
      const received = events.find((event) => event.type === 'input.received');
      expect(received?.type).toBe('input.received');
      const wake = events.find((event) => event.seq === received!.seq + 1);
      expect(wake).toMatchObject({
        type: 'run.woken',
        nodeId: run.waiting!.nodeId,
        reason: 'input',
        payload: { decision: 'close' },
      });
      const human = f.envelopes.find(
        (envelope) => envelope.identity.kind === 'node' && envelope.identity.nodeId === 'human',
      );
      expect(human?.wake).toMatchObject({
        reason: 'input',
        inputSeq: received!.seq,
        seq: wake!.seq,
        nodeId: run.waiting!.nodeId,
        payload: { decision: 'close' },
      });
      expect(JSON.stringify(await f.container().manager.getThread(run.id))).not.toContain(
        f.readKey.token,
      );
    },
  );
  it('never converts an actual timeout into human merge authority', async () => {
    const f = await fixture(),
      run = await f.start();
    await f.restart();
    await f.timeout();
    const terminal = await f.view(run.id);
    expect(terminal.status, JSON.stringify(terminal.failure)).toBe('failed');
    expect(terminal.outcome).toBe('failure');
    expect(terminal.result).toMatchObject({
      type: 'ReviewTimedOut',
      reason: 'HUMAN_REVIEW_TIMEOUT',
    });
    const events = checkedEvents(await f.container().templates.store.events(run.id));
    expect(events.some((event) => event.type === 'run.woken' && event.reason === 'timeout')).toBe(
      true,
    );
    expect(events.some((event) => event.type === 'input.received')).toBe(false);
    expect(f.effects).not.toContain('merge');
    expect(f.effects).not.toContain('close');
    expect(f.pr.state).toBe('open');
  });
  it('refuses a moved head after actual API input without merging or closing it', async () => {
    const f = await fixture(),
      run = await f.start();
    f.pr.head.sha = 'b'.repeat(40);
    expect((await f.answer(run.id, { decision: 'merge' })).statusCode).toBe(200);
    await f.idle();
    expect((await f.view(run.id)).status).toBe('failed');
    expect(f.effects).not.toContain('merge');
    expect(f.effects).not.toContain('close');
    expect(
      f.envelopes.some(
        (envelope) => envelope.identity.kind === 'node' && envelope.identity.nodeId === 'human',
      ),
    ).toBe(false);
    const events = checkedEvents(await f.container().templates.store.events(run.id));
    const wake = events.find((event) => event.type === 'run.woken' && event.reason === 'input');
    expect(wake).toMatchObject({ payload: { decision: 'merge' } });
  });
  it('preserves a strict claim refusal through private stdin, SQLite history, terminal reporting and the next poll', async () => {
    const f = await fixture();
    f.moveClaim();
    const run = await f.start();
    expect(run.status).toBe('failed');
    expect(run.result).toMatchObject({
      type: 'SupportBlocked',
      code: 'PR_HEAD_CHANGED',
      message: 'Support stopped safely; inspect the recorded support code.',
    });
    const row = await f.container().templates.store.bindingForLoop('local', run.loopId);
    const history = await readAuthority(
      f.container().templates.store,
      TemplateBindingSchema.parse(row!.binding),
      run.id,
    );
    expect(history.facts).toEqual([]);
    expect(
      history.events.filter((event) => event.type === 'node.started' && event.nodeId === 'block'),
    ).toEqual([]);
    expect(f.effects).not.toContain('merge');
    expect(f.effects).not.toContain('close');
    expect(f.effects).toContain('comment');
    await f.restart();
    expect(await f.poll()).toBeDefined();
    expect(
      f.logger.lines.filter((entry) => JSON.stringify(entry).includes('AUTHORITY_CONFLICT')),
    ).toEqual([]);
  });
  it('dedupes PR plus exact head through actual PollTriggers, RunManager and restart', async () => {
    const f = await fixture();
    f.harness.script([{ finalText: JSON.stringify(approved), structured: approved }]);
    await f.poll();
    const first = (
      await f.container().repos.runs.list({ ownerId: 'local', loopId: f.instance.parentLoopId })
    )[0]!;
    expect(first.status, JSON.stringify(first.failure)).toBe('waiting');
    expect(first.invocationId).toBeTruthy();
    expect(f.envelopes.find((env) => env.identity.kind === 'node')?.subject).toMatchObject({
      head: original,
      pullRequest: 7,
    });
    await f.restart();
    await f.poll();
    expect(
      await f.container().repos.runs.list({ ownerId: 'local', loopId: f.instance.parentLoopId }),
    ).toHaveLength(1);
    expect((await f.answer(first.id, { decision: 'close' })).statusCode).toBe(200);
    await f.idle();
    f.pr.state = 'open';
    f.pr.head.sha = 'b'.repeat(40);
    f.harness.script([{ finalText: JSON.stringify(approved), structured: approved }]);
    await f.poll();
    const runs = await f
      .container()
      .repos.runs.list({ ownerId: 'local', loopId: f.instance.parentLoopId });
    expect(runs).toHaveLength(2);
    expect(runs.filter((run) => run.status === 'waiting')).toHaveLength(1);
    await f.restart();
    await f.poll();
    expect(
      await f.container().repos.runs.list({ ownerId: 'local', loopId: f.instance.parentLoopId }),
    ).toHaveLength(2);
    expect(f.effects).not.toContain('merge');
  });
});

/* Injected asynchronous boundaries never invoke native processes or network. */
/* eslint-disable @typescript-eslint/require-await */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  JsonValueSchema,
  QaTemplateSettingsSchema,
  TemplateInstanceSchema,
  TemplateSettingsSchemas,
  type JsonValue,
  type RunRecord,
} from '@graphgoblin/contracts';
import { FIXTURE_TS, fakeUlid } from '@graphgoblin/contracts/testing';
import { prepareTemplateBundle, stableHash } from '@graphgoblin/domain';
import {
  createInitialThread,
  RunManager,
  type RunAdmission,
  type ScriptRunRequest,
} from '@graphgoblin/engine';
import {
  createFakePorts,
  DEFAULT_TEST_SETTINGS,
  InMemorySecrets,
} from '@graphgoblin/engine/testing';
import {
  openMemoryDatabase,
  SqliteTemplateInstances,
  SqliteEventStore,
  SqliteRunRepository,
  SqliteTriggerAdmission,
  SqliteApiKeys,
  SqliteLoopRepository,
  type DatabaseHandle,
} from '@graphgoblin/infrastructure/sqlite';
import { TemplateCatalog } from '../catalog.js';
import { TemplateInstances } from '../instances.js';
import { TemplatePrerequisites } from '../prerequisites.js';
import { TemplateBindingSchema, bindingJson, executionHash } from '../binding.js';
import { TemplateRuntime, templateAdmission } from '../runtime.js';
import { ParentSubjectSchema, subjectJson, type ParentSubject } from '../subjects.js';
import { PrivateTemplateScripts } from '../scripts.js';
import { QaAuthority, qaPollKeys } from './qa-authority.js';
import { QaHistory, admittedQaIdentity } from './qa-history.js';
import { QaReporter } from './qa-reporter.js';
import { NativeQaDiscovery, nativeQaMetadata, type QaMetadataDependencies } from './qa-native.js';
import { QaPrivateEnvelopeSchema } from './qa-envelope.js';
import { QaStateSchema, encodeQaState, qaIdentityKey } from './qa-journal.js';
import { qaEntry, qaCli } from './qa-entry.js';
import { qaSupportClosure, QA_SUPPORT_MODULES } from './qa-closure.js';
import { CliQaGithub, trustedQaPr } from './qa-client.js';
import { installImplementationFinalization } from './reporter.js';
import { readAuthority, assertPinnedBundle } from '../authority.js';
import type { CommandRequest } from './process.js';
import * as nativeProcess from './process.js';

const handles: DatabaseHandle[] = [],
  dirs: string[] = [],
  managers: RunManager[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const manager of managers.splice(0)) manager.stop();
  for (const handle of handles.splice(0)) handle.close();
  for (const root of dirs.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('authenticated prior QA consumption and uncertainty', () => {
  it.each(['external', 'contradictory-external', 'missing-implementation-fact'] as const)(
    'checks the original source of %s prior QA without confusing later implementation attempts',
    async (mode) => {
      const f = await fixture();
      const original =
        mode === 'external'
          ? undefined
          : await historical(
              f,
              'implementation',
              1,
              undefined,
              mode === 'contradictory-external'
                ? [
                    {
                      type: 'PrCreated',
                      repository: 'example/repo',
                      issue: 7,
                      attempt: 1,
                      pullRequest: 11,
                      head,
                    },
                  ]
                : [],
            );
      await historical(
        f,
        'qa',
        1,
        mode === 'missing-implementation-fact' ? original!.run.id : undefined,
        [
          {
            type: 'ReworkRequest',
            repository: 'example/repo',
            issue: 7,
            attempt: 1,
            pullRequest: 11,
            mergeSha: 'd'.repeat(40),
            request: 1,
          },
        ],
        11,
      );
      await historical(f, 'implementation', 2, undefined, [
        {
          type: 'PrCreated',
          repository: 'example/repo',
          issue: 7,
          attempt: 2,
          pullRequest: 12,
          head,
        },
      ]);
      const current = await f.admitted();
      await f.runs.update(current.run.id, { status: 'running' });
      const result = f.history.snapshot(f.binding, current.run.id);
      if (mode === 'external')
        await expect(result).resolves.toMatchObject({ requests: 1, attempts: 2 });
      else await expect(result).rejects.toThrow();
    },
  );
  async function pair(mode: 'fact' | 'signed' | 'empty' = 'fact') {
    const f = await fixture();
    const prior = await historicalPreviousQa(
      f,
      mode === 'fact'
        ? [
            {
              type: 'ReworkRequest',
              repository: 'example/repo',
              issue: 7,
              attempt: 1,
              pullRequest: 12,
              mergeSha: 'd'.repeat(40),
              request: 1,
            },
          ]
        : [],
    );
    await historical(f, 'implementation', 2, undefined, [
      {
        type: 'PrCreated',
        repository: 'example/repo',
        issue: 7,
        attempt: 2,
        pullRequest: 12,
        head,
      },
    ]);
    const current = await f.admitted();
    await f.runs.update(current.run.id, { status: 'running' });
    return { f, prior, current };
  }
  async function state(
    f: Fixture,
    prior: Awaited<ReturnType<typeof historical>>,
    reservation?: { request: number | null; reopen: 'none' | 'intent' | 'complete' },
  ) {
    const visit = await prior.started('qa-rework'),
      identity = admittedQaIdentity(prior.binding, prior.run.id, prior.subject);
    const value = QaStateSchema.parse({
      identity,
      ...(reservation
        ? {
            reservation: {
              key: 'qa-rework:' + visit,
              request: reservation.request,
              requiresReopen: reservation.reopen !== 'none',
              reopen: reservation.reopen,
              relabel: 'none',
            },
          }
        : {}),
    });
    f.files.set(
      join(f.root, '.git', 'graphgoblin', 'qa', qaIdentityKey(identity) + '.qa.json'),
      encodeQaState(identity, value, f.key.token),
    );
  }
  it.each(['none', 'complete'] as const)(
    'retains signed request across commit/link gap and %s reopen state',
    async (reopen) => {
      const { f, prior, current } = await pair('signed');
      await state(f, prior, { request: 1, reopen });
      expect(await f.history.snapshot(f.binding, current.run.id)).toMatchObject({
        requests: 1,
        reopenings: reopen === 'complete' ? 1 : 0,
        attempts: 2,
      });
    },
  );
  it.each(['missing-request', 'null-request', 'wrong-request'] as const)(
    'refuses %s signed history instead of replenishing attempts',
    async (mode) => {
      const { f, prior, current } = await pair('empty');
      await state(
        f,
        prior,
        mode === 'missing-request'
          ? undefined
          : { request: mode === 'null-request' ? null : 2, reopen: 'none' },
      );
      await expect(f.history.snapshot(f.binding, current.run.id)).rejects.toThrow();
    },
  );
  it('permits a no-turn prior run without its own journal even when another signed journal root exists', async () => {
    const { f, current } = await pair();
    f.files.set(join(f.root, '.git', 'graphgoblin', 'qa', 'unrelated.qa.json'), 'Unrelated file');
    expect(await f.history.snapshot(f.binding, current.run.id)).toMatchObject({
      requests: 1,
      reopenings: 0,
    });
  });
  it('refuses missing prepared journal with an existing root', async () => {
    const { f, prior, current } = await pair();
    await prior.started('prepare');
    f.files.set(join(f.root, '.git', 'graphgoblin', 'qa', 'unrelated.qa.json'), 'Unrelated file');
    await expect(f.history.snapshot(f.binding, current.run.id)).rejects.toThrow();
  });
  it.each(['duplicate', 'wrong-request', 'wrong-pr', 'wrong-merge', 'reopen-only'] as const)(
    'refuses %s authoritative prior fact',
    async (mode) => {
      const f = await fixture();
      const fact = {
        type: mode === 'reopen-only' ? 'IssueReopened' : 'ReworkRequest',
        repository: 'example/repo',
        issue: 7,
        attempt: 1,
        pullRequest: mode === 'wrong-pr' ? 13 : 12,
        mergeSha: mode === 'wrong-merge' ? 'c'.repeat(40) : 'd'.repeat(40),
        request: mode === 'wrong-request' ? 2 : 1,
      };
      await historicalPreviousQa(f, mode === 'duplicate' ? [fact, fact] : [fact]);
      await historical(f, 'implementation', 2, undefined, [
        {
          type: 'PrCreated',
          repository: 'example/repo',
          issue: 7,
          attempt: 2,
          pullRequest: 12,
          head,
        },
      ]);
      const current = await f.admitted();
      await f.runs.update(current.run.id, { status: 'running' });
      await expect(f.history.snapshot(f.binding, current.run.id)).rejects.toThrow();
    },
  );
  it.each(['overflow', 'missing-binding', 'future-attempt', 'worker-role', 'missing-own'] as const)(
    'refuses %s owner history snapshot',
    async (mode) => {
      const f = await fixture();
      await historical(f, 'implementation', 1, undefined, [
        {
          type: 'PrCreated',
          repository: 'example/repo',
          issue: 7,
          attempt: 1,
          pullRequest: 12,
          head,
        },
      ]);
      const current = await f.admitted();
      await f.runs.update(current.run.id, { status: 'running' });
      if (mode === 'overflow')
        vi.spyOn(f.store, 'subjectRuns').mockResolvedValue(
          Array(65).fill({ run: {}, subject: null }),
        );
      if (mode === 'missing-own') {
        const rows = await f.store.subjectRuns({
          ownerId: 'local',
          repository: 'example/repo',
          issue: 7,
          limit: 65,
        });
        vi.spyOn(f.store, 'subjectRuns').mockResolvedValue(
          rows.filter((row) => row.run.id !== current.run.id),
        );
      }
      if (mode === 'missing-binding' || mode === 'future-attempt' || mode === 'worker-role') {
        const future = await historical(f, 'implementation', 2);
        if (mode === 'missing-binding') {
          const original = f.store.bindingForLoop.bind(f.store);
          vi.spyOn(f.store, 'bindingForLoop').mockImplementation((owner, loop) =>
            loop === future.run.loopId ? Promise.resolve(undefined) : original(owner, loop),
          );
        }
        if (mode === 'worker-role')
          await f.store.setSubject(
            future.run.id,
            JsonValueSchema.parse({
              ...future.subject,
              role: 'worker',
              parentRunId: current.run.id,
              nodeId: 'unknown',
              visit: 1,
            }),
          );
      }
      await expect(f.history.snapshot(f.binding, current.run.id)).rejects.toThrow();
    },
  );
});

describe('bounded QA entry transport without native effects', () => {
  it('does not consume stdin for version and strictly bounds UTF-8 bytes', async () => {
    const writes: string[] = [];
    let consumed = false;
    async function* input() {
      consumed = true;
      throw new Error('Do not consume');
      yield '';
    }
    await qaCli(['--version'], input(), (text) => {
      writes.push(text);
    });
    expect(consumed).toBe(false);
    expect(JSON.parse(writes[0]!)).toMatchObject({ version: '1.0.0' });
    async function* overflow() {
      yield 'é'.repeat(524289);
    }
    await qaCli(['poll'], overflow(), (text) => {
      writes.push(text);
    });
    expect(JSON.parse(writes[1]!)).toMatchObject({
      type: 'SupportBlocked',
      code: 'QA_SUPPORT_UNAVAILABLE',
    });
    async function* bad() {
      yield '{}';
    }
    await qaCli(['poll'], bad(), (text) => {
      writes.push(text);
    });
    expect(JSON.parse(writes[2]!)).toMatchObject({ code: 'QA_SUPPORT_UNAVAILABLE' });
  });
  it('constructs native metadata boundaries lazily without invoking commands, and has no positive node factory', async () => {
    const f = await fixture();
    const resolver = vi.spyOn(nativeProcess, 'nativeExecutable').mockResolvedValue('inert-program');
    const deps = await nativeQaMetadata(f.settings);
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(deps.github).toBeInstanceOf(CliQaGithub);
    const current = await f.admitted();
    await f.runs.update(current.run.id, { status: 'running' });
    const envelope = {
      settings: f.settings,
      credential: f.key.token,
      identity: {
        kind: 'node',
        ownerId: 'local',
        loopId: f.parent.loopId,
        versionId: f.parent.id,
        nodeId: 'claim',
        runId: current.run.id,
        startedSeq: 2,
      },
      input: current.input.initialThread,
      subject: current.subject,
      claim: null,
      visit: 2,
      history: await f.history.snapshot(f.binding, current.run.id),
    };
    expect(await qaEntry(['claim'], JSON.stringify(envelope))).toMatchObject({
      code: 'TEMPLATE_ISOLATION_UNAVAILABLE',
    });
    expect(resolver).toHaveBeenCalledTimes(2);
  });
  it('does not act for non-QA bindings, corrupt source rows, missing immutable bindings or changed recheck subjects', async () => {
    const f = await fixture();
    await expect(
      f.authority.resolve(
        { ...f.binding, manifest: { ...f.binding.manifest, id: 'other' } },
        { pullRequest: 12 },
      ),
    ).rejects.toMatchObject({ code: 'TEMPLATE_AUTHORITY_UNAVAILABLE' });
    const source = await historical(f, 'implementation', 1, undefined, [
      {
        type: 'PrCreated',
        repository: 'example/repo',
        issue: 7,
        attempt: 1,
        pullRequest: 12,
        head,
      },
    ]);
    const original = f.store.bindingForLoop.bind(f.store);
    vi.spyOn(f.store, 'bindingForLoop').mockImplementation((owner, loop) =>
      loop === source.run.loopId ? Promise.resolve(undefined) : original(owner, loop),
    );
    await expect(f.authority.resolve(f.binding, { pullRequest: 12 })).rejects.toMatchObject({
      code: 'TEMPLATE_AUTHORITY_REFUSED',
    });
    vi.restoreAllMocks();
    const item = await f.admitted();
    await expect(
      f.authority.recheck(f.binding, { ...item.subject, kind: 'review' }),
    ).rejects.toThrow();
    await expect(f.authority.recheck(f.binding, { ...item.subject, attempt: 2 })).rejects.toThrow();
    const rawRows = await f.store.prFactCandidates('local', 'example/repo', 12, 65);
    vi.spyOn(f.store, 'prFactCandidates').mockResolvedValue(
      rawRows.map((row) => ({ ...row, subject: null })),
    );
    await expect(f.authority.resolve(f.binding, { pullRequest: 12 })).rejects.toThrow();
  });
});
const apiRoot = fileURLToPath(new URL('../../../', import.meta.url));
const sha = 'a'.repeat(40),
  head = 'b'.repeat(40);
const role = { harness: 'codex', model: 'gpt-6-sol', effort: 'high' } as const;
async function fixture() {
  const handle = await openMemoryDatabase();
  handles.push(handle);
  const ports = createFakePorts(),
    store = new SqliteTemplateInstances(handle.db),
    events = new SqliteEventStore(handle.db, ports.clock);
  const root = resolve(join(tmpdir(), 'gg-qa-inert-repository'));
  const settings = QaTemplateSettingsSchema.parse({
    kind: 'qa',
    repository: { path: root, owner: 'Example', name: 'Repo', baseBranch: 'main' },
    supportReadKey: 'reader',
    roles: { qa: role, adversary: role },
  });
  const catalog = new TemplateCatalog(join(apiRoot, 'templates'), apiRoot);
  const apiKeys = new SqliteApiKeys(handle.db, ports.clock, ports.ids),
    key = await apiKeys.create('local', 'QA reader', ['runs:read']);
  const secrets = new InMemorySecrets({ reader: key.token });
  const requests: ScriptRunRequest[] = [],
    commands: CommandRequest[] = [],
    comments: { body: string }[] = [];
  const raw = {
    run: async (request: ScriptRunRequest) => {
      requests.push(request);
      const stdout =
        request.command === 'git'
          ? request.args[0] === 'remote'
            ? 'https://github.com/example/repo.git'
            : root
          : request.command === 'gh'
            ? JSON.stringify({ nameWithOwner: 'Example/Repo' })
            : JSON.stringify({ items: [{ id: sha, payload: { pullRequest: 12, mergeSha: sha } }] });
      return {
        exitCode: 0,
        stdout,
        stderr: '',
        timedOut: false,
        stdoutOverflow: false,
        stderrOverflow: false,
      };
    },
  };
  const prerequisites = new TemplatePrerequisites({
    catalog: ports.modelCatalog,
    harnesses: ports.harnesses,
    scripts: raw,
    apiKeys,
    secretsFor: () => secrets,
    supportAvailable: async () => true,
  });
  const instances = new TemplateInstances(catalog, prerequisites, store, ports.ids, ports.clock);
  const created = await instances.instantiate('local', 'qa', { settings });
  const stored = await store.get('local', created.instance.id);
  if (!stored) throw new Error('missing QA fixture');
  const binding = TemplateBindingSchema.parse(stored.binding),
    loops = await Promise.all(created.instance.loops.map((loop) => store.version(loop.versionId)));
  for (const loop of loops)
    if (loop) {
      const { publishedAt, ...record } = loop;
      ports.loops.add({ ...record, ...(publishedAt === null ? {} : { publishedAt }) });
    }
  const parent = loops.find((loop) => loop?.loopId === created.instance.parentLoopId)!;
  const pr = {
    number: 12,
    state: 'closed' as 'closed' | 'open',
    title: 'Authored change',
    body: 'Closes #7',
    head: { sha: head, ref: 'feature', repo: { full_name: 'example/repo' } },
    base: { ref: 'main', repo: { full_name: 'example/repo' } },
    draft: false,
    merged: true,
    merge_commit_sha: sha as string | null,
    user: { login: 'example' },
  };
  const issue = {
    number: 7,
    title: 'Acceptance',
    body: 'Required behavior',
    state: 'closed' as 'closed' | 'open',
    labels: [] as { name: string }[],
    html_url: 'https://github.com/example/repo/issues/7',
  };
  let links = [{ repository: 'example/repo', number: 7 }],
    candidates = [{ pullRequest: 12, mergeSha: sha }],
    readFailure = false,
    postFailure = false;
  const files = new Map<string, string>();
  const deps: QaMetadataDependencies = {
    git: 'inert-git',
    files: {
      canonical: async (path) => resolve(path),
      directory: async () => {
        throw new Error('No repository writes');
      },
      exists: async (path) =>
        path === join(root, '.git', 'graphgoblin', 'qa') ? files.size > 0 : true,
      read: async (path) => files.get(path),
      text: async () => {
        throw new Error('No repository writes');
      },
    },
    commands: {
      run: async (request) => {
        commands.push(request);
        const args = request.args.slice(7);
        return {
          exitCode: 0,
          stdout:
            args[0] === 'remote'
              ? 'https://github.com/example/repo.git'
              : args[1] === '--git-common-dir'
                ? join(root, '.git')
                : request.cwd,
          stderr: '',
          timedOut: false,
          overflow: false,
          termination: 'confirmed',
        };
      },
    },
    github: {
      authenticate: async () => {
        if (readFailure) throw new Error(key.token);
      },
      pullRequest: async () => structuredClone(pr),
      linkedIssues: async () => links,
      issue: async () => structuredClone(issue),
      comments: async () => comments,
      post: async (_repo, _issue, body) => {
        comments.push({ body });
        if (postFailure) throw new Error(key.token);
      },
      mergedCandidates: async () => candidates,
    },
  };
  const metadata = async () => deps,
    authority = new QaAuthority(instances, metadata),
    reporter = new QaReporter(instances, authority, metadata),
    history = new QaHistory(instances, async () => key.token, metadata);
  const runtime = new TemplateRuntime(instances, authority, reporter),
    runs = new SqliteRunRepository(handle.db, (tx, run, changes) =>
      runtime.beforeTransition(tx, run, changes),
    );
  const admission = templateAdmission(
    new SqliteTriggerAdmission(handle.db, events, (tx, input, poll) =>
      runtime.afterRunStaged(tx, input, poll),
    ),
    runtime,
  );
  let serial = 0;
  function intent(poll = false): RunAdmission {
    const run: RunRecord = {
      id: fakeUlid('qa-intent-' + ++serial + stored!.instance.id),
      ownerId: 'local',
      loopId: parent.loopId,
      versionId: parent.id,
      invocationId: fakeUlid('qa-invocation-' + serial),
      status: 'queued',
      iteration: 1,
      createdAt: FIXTURE_TS,
      lastEventSeq: 0,
    };
    const thread = createInitialThread({
      runId: run.id,
      loopId: run.loopId,
      versionId: run.versionId,
      invocation: {
        id: run.invocationId,
        source: poll ? 'poll' : 'manual.api',
        trigger: {
          nodeId: 'start',
          kind: poll ? 'poll' : 'manual',
          payload: poll
            ? { id: sha, payload: { pullRequest: 12, mergeSha: sha } }
            : { pullRequest: 12 },
          receivedAt: FIXTURE_TS,
          ...(poll ? { dedupeKey: sha } : {}),
        },
      },
    });
    return {
      run,
      initialThread: thread,
      queued: { type: 'run.queued', initialThread: thread },
      pinnedLoopIds: loops.map((loop) => loop!.loopId),
    };
  }
  const scripts = new PrivateTemplateScripts({
    instances,
    raw,
    apiKeys,
    secretsFor: () => secrets,
    qaAuthority: authority,
    qaHistory: history,
    environment: { PATH: 'safe', GH_TOKEN: 'forbidden', GG_API_KEY: key.token },
  });
  async function admitted() {
    const input = intent();
    const run = await admission.create(input);
    const row = await store.run(run.id);
    return { input, run, subject: ParentSubjectSchema.parse(row!.subject) };
  }
  return {
    handle,
    ports,
    store,
    events,
    runs,
    instances,
    prerequisites,
    binding,
    parent,
    loops,
    settings,
    root,
    raw,
    requests,
    commands,
    comments,
    pr,
    issue,
    files,
    deps,
    metadata,
    authority,
    reporter,
    history,
    runtime,
    admission,
    intent,
    admitted,
    scripts,
    key,
    apiKeys,
    links: (value: typeof links) => {
      links = value;
    },
    candidates: (value: typeof candidates) => {
      candidates = value;
    },
    failRead: () => {
      readFailure = true;
    },
    failPost: () => {
      postFailure = true;
    },
  };
}

describe('bounded merged QA metadata', () => {
  it('uses literal bounded GET and excludes unmerged, foreign, draft and wrong-base candidates', async () => {
    const f = await fixture(),
      requests: CommandRequest[] = [];
    const candidate = { ...f.pr, merged_at: FIXTURE_TS };
    const runner = {
      run: async (request: CommandRequest) => {
        requests.push(request);
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            candidate,
            { ...candidate, merged_at: null },
            { ...candidate, draft: true },
            { ...candidate, state: 'open' },
            { ...candidate, merge_commit_sha: null },
            { ...candidate, head: { ...candidate.head, repo: { full_name: 'foreign/repo' } } },
            { ...candidate, base: { ...candidate.base, ref: 'other' } },
            { ...candidate, base: { ...candidate.base, repo: { full_name: 'foreign/repo' } } },
          ]),
          stderr: '',
          timedOut: false,
          overflow: false,
          termination: 'confirmed' as const,
        };
      },
    };
    expect(await new CliQaGithub(runner, 'inert-gh', f.root).mergedCandidates(f.settings)).toEqual([
      { pullRequest: 12, mergeSha: sha },
    ]);
    expect(requests[0]?.args).toEqual([
      'api',
      '--method',
      'GET',
      'repos/example/repo/pulls',
      '-f',
      'state=closed',
      '-f',
      'base=main',
      '-f',
      'per_page=100',
    ]);
    expect(requests[0]).toMatchObject({ timeoutMs: 20000, maxBytes: 524288 });
  });
  it.each(['page', 'malformed', 'failure'] as const)(
    'refuses incomplete %s discovery',
    async (mode) => {
      const f = await fixture();
      const client = new CliQaGithub(
        {
          run: async () => ({
            exitCode: mode === 'failure' ? 1 : 0,
            stdout:
              mode === 'page'
                ? JSON.stringify(Array(100).fill({ ...f.pr, merged_at: FIXTURE_TS }))
                : '{}',
            stderr: '',
            timedOut: false,
            overflow: false,
            termination: 'confirmed',
          }),
        },
        'inert-gh',
        f.root,
      );
      await expect(client.mergedCandidates(f.settings)).rejects.toThrow();
    },
  );
  it.each([
    'number',
    'open',
    'not-merged',
    'draft',
    'sha',
    'base',
    'base-repo',
    'head-repo',
    'links',
    'foreign-link',
    'issue',
    'issue-url',
  ] as const)('refuses actual %s metadata mismatch', async (kind) => {
    const f = await fixture();
    if (kind === 'number') f.pr.number = 13;
    if (kind === 'open') f.pr.state = 'open';
    if (kind === 'not-merged') f.pr.merged = false;
    if (kind === 'draft') f.pr.draft = true;
    if (kind === 'sha') f.pr.merge_commit_sha = null;
    if (kind === 'base') f.pr.base.ref = 'other';
    if (kind === 'base-repo') f.pr.base.repo.full_name = 'foreign/repo';
    if (kind === 'head-repo') f.pr.head.repo.full_name = 'foreign/repo';
    if (kind === 'links') f.links([]);
    if (kind === 'foreign-link') f.links([{ repository: 'foreign/repo', number: 7 }]);
    if (kind === 'issue') f.issue.number = 8;
    if (kind === 'issue-url') f.issue.html_url = 'https://github.com/foreign/repo/issues/7';
    await expect(trustedQaPr(f.deps.github, f.settings, 12)).rejects.toThrow();
    expect(f.comments).toEqual([]);
  });
});

type Fixture = Awaited<ReturnType<typeof fixture>>;
/** The previous implementation produced PR11; the next implementation produces PR12. */
async function historicalPreviousQa(f: Fixture, facts: readonly JsonValue[]) {
  const original = await historical(f, 'implementation', 1, undefined, [
    { type: 'PrCreated', repository: 'example/repo', issue: 7, attempt: 1, pullRequest: 11, head },
  ]);
  const previousFacts = facts.map((fact) =>
    fact !== null && typeof fact === 'object' && !Array.isArray(fact) && fact['pullRequest'] === 12
      ? { ...fact, pullRequest: 11 }
      : fact,
  );
  return historical(f, 'qa', 1, original.run.id, previousFacts, 11);
}
async function historical(
  f: Fixture,
  kind: 'implementation' | 'qa',
  attempt: number,
  original?: string,
  recorded: readonly JsonValue[] = [],
  pullRequest = 12,
) {
  const installed = await f.instances.catalog.get(kind),
    bundle = installed.bundle;
  const settings = TemplateSettingsSchemas[kind].parse(
    kind === 'qa'
      ? f.settings
      : {
          kind,
          repository: f.settings.repository,
          supportReadKey: f.settings.supportReadKey,
          roles: { implementer: role },
        },
  );
  const allocated = Object.fromEntries(
    bundle.manifest.loops.map((loop) => [
      loop.key,
      { loopId: f.ports.ids.next(), versionId: f.ports.ids.next(), version: 1, name: loop.key },
    ]),
  );
  const prepared = prepareTemplateBundle(bundle, settings, allocated),
    id = f.ports.ids.next();
  const instance = TemplateInstanceSchema.parse({
    id,
    ownerId: 'local',
    templateId: kind,
    templateVersion: bundle.manifest.version,
    parentLoopId: prepared.parentLoopId,
    settings,
    createdAt: FIXTURE_TS,
    loops: prepared.loops.map(({ key, loopId, versionId, version, status }) => ({
      key,
      loopId,
      versionId,
      version,
      status,
    })),
  });
  const binding = TemplateBindingSchema.parse({
    instanceId: id,
    ownerId: 'local',
    manifest: bundle.manifest,
    settings,
    loops: prepared.loops.map((loop) => ({
      key: loop.key,
      loopId: loop.loopId,
      versionId: loop.versionId,
      hash: executionHash(loop.definition),
      nodes: Object.fromEntries(
        loop.definition.nodes.map((node) => [
          node.id,
          { kind: node.kind, configHash: stableHash(node.config) },
        ]),
      ),
    })),
    support: installed.support,
  });
  await f.store.create(instance, bindingJson(binding), prepared.loops);
  const parent = prepared.loops.find((loop) => loop.key === 'parent')!;
  const run: RunRecord = {
    id: f.ports.ids.next(),
    ownerId: 'local',
    loopId: parent.loopId,
    versionId: parent.versionId,
    invocationId: f.ports.ids.next(),
    status: 'queued',
    iteration: 1,
    createdAt: FIXTURE_TS,
    lastEventSeq: 0,
  };
  const subject: ParentSubject = {
    role: 'parent',
    kind,
    instanceId: id,
    templateVersion: bundle.manifest.version,
    repository: 'example/repo',
    issue: 7,
    attempt,
    source:
      kind === 'implementation'
        ? { kind: 'implementation', runId: run.id }
        : original
          ? { kind: 'implementation', runId: original }
          : { kind: 'external' },
    ...(kind === 'qa' ? { pullRequest, mergeSha: attempt === 1 ? 'd'.repeat(40) : sha } : {}),
  };
  const initialThread = createInitialThread({
    runId: run.id,
    loopId: run.loopId,
    versionId: run.versionId,
    invocation: {
      id: run.invocationId,
      source: 'manual.api',
      trigger: { nodeId: 'start', kind: 'manual', payload: null, receivedAt: FIXTURE_TS },
    },
  });
  await new SqliteTriggerAdmission(f.handle.db, f.events).create({
    run,
    initialThread,
    queued: { type: 'run.queued', initialThread },
    pinnedLoopIds: prepared.loops.map((loop) => loop.loopId),
  });
  await f.store.setSubject(run.id, subjectJson(subject));
  async function started(action: string) {
    const node = parent.definition.nodes.find(
      (node) => node.kind === 'script' && node.config.args[0] === action,
    )!;
    return (
      await f.events.append(run.id, [
        {
          type: 'node.started',
          nodeId: node.id,
          kind: 'script',
          attempt: 1,
          configHash: stableHash(node.config),
        },
      ])
    )[0]!.seq;
  }
  for (const fact of recorded) {
    const type =
      fact !== null && typeof fact === 'object' && !Array.isArray(fact) ? fact['type'] : undefined;
    const action =
      type === 'PrCreated'
        ? 'pr-created'
        : type === 'ReworkRequest'
          ? 'qa-rework'
          : 'issue-reopened';
    const node = parent.definition.nodes.find(
      (node) => node.kind === 'script' && node.config.args[0] === action,
    )!;
    await started(action);
    await f.events.append(run.id, [
      {
        type: 'node.finished',
        nodeId: node.id,
        durationMs: 0,
        patch: [
          {
            op: 'add',
            path: '/outputs/' + node.id,
            value: { nodeId: node.id, at: FIXTURE_TS, value: fact },
          },
        ],
      },
    ]);
  }
  await f.runs.update(run.id, { status: 'failed' });
  return { run, subject, binding, started };
}

describe('immutable QA lineage and private history', () => {
  it('selects an external original at attempt one, with no authority accepted from selectors', async () => {
    const f = await fixture();
    expect(await f.authority.resolve(f.binding, { pullRequest: 12 })).toMatchObject({
      kind: 'qa',
      attempt: 1,
      source: { kind: 'external' },
      mergeSha: sha,
      issue: 7,
    });
    await f.authority.recheck(f.binding, {
      role: 'parent',
      instanceId: f.binding.instanceId,
      templateVersion: '1.0.0',
      kind: 'qa',
      repository: 'example/repo',
      issue: 7,
      attempt: 1,
      source: { kind: 'external' },
      pullRequest: 12,
      mergeSha: sha,
    });
  });
  it.each([1, 2, 3])('retains authenticated PrCreated attempt %i', async (attempt) => {
    const f = await fixture();
    const prior = await historical(f, 'implementation', attempt, undefined, [
      { type: 'PrCreated', repository: 'example/repo', issue: 7, attempt, pullRequest: 12, head },
    ]);
    expect(await f.authority.resolve(f.binding, { pullRequest: 12, mergeSha: sha })).toMatchObject({
      attempt,
      source: { kind: 'implementation', runId: prior.run.id },
    });
  });
  it.each([
    'authority',
    'wrong-key',
    'changed-sha',
    'missing-fact',
    'conflicting-facts',
    'wrong-issue',
    'overflow',
    'wrong-owner',
  ] as const)('refuses %s lineage', async (mode) => {
    const f = await fixture();
    if (mode === 'missing-fact') await historical(f, 'implementation', 1);
    if (mode === 'wrong-issue') {
      await historical(f, 'implementation', 1, undefined, [
        {
          type: 'PrCreated',
          repository: 'example/repo',
          issue: 7,
          attempt: 1,
          pullRequest: 12,
          head,
        },
      ]);
      f.links([{ repository: 'example/repo', number: 8 }]);
      f.issue.number = 8;
      f.issue.html_url = 'https://github.com/example/repo/issues/8';
    }
    if (mode === 'conflicting-facts')
      await historical(
        f,
        'implementation',
        1,
        undefined,
        Array(2).fill({
          type: 'PrCreated',
          repository: 'example/repo',
          issue: 7,
          attempt: 1,
          pullRequest: 12,
          head,
        }),
      );
    if (mode === 'overflow')
      vi.spyOn(f.store, 'prFactCandidates').mockResolvedValue(
        Array(65).fill({ run: {}, subject: null }),
      );
    if (mode === 'wrong-owner')
      await historical(f, 'implementation', 1, undefined, [
        {
          type: 'PrCreated',
          repository: 'example/repo',
          issue: 7,
          attempt: 1,
          pullRequest: 12,
          head,
        },
      ]);
    const payload =
      mode === 'authority'
        ? { pullRequest: 12, attempt: 2, issue: 7, repository: 'example/repo' }
        : mode === 'wrong-key'
          ? { id: 'c'.repeat(40), payload: { pullRequest: 12, mergeSha: sha } }
          : { pullRequest: 12, ...(mode === 'changed-sha' ? { mergeSha: 'c'.repeat(40) } : {}) };
    if (mode === 'wrong-owner')
      expect(
        await f.authority.resolve({ ...f.binding, ownerId: 'foreign' }, payload),
      ).toMatchObject({ attempt: 1, source: { kind: 'external' } });
    else
      await expect(f.authority.resolve(f.binding, payload)).rejects.toMatchObject({
        code: 'TEMPLATE_AUTHORITY_REFUSED',
      });
  });
  it('provides a verified current owner snapshot independently of authored thread vars', async () => {
    const f = await fixture(),
      item = await f.admitted();
    await f.runs.update(item.run.id, { status: 'running' });
    expect(await f.history.snapshot(f.binding, item.run.id)).toMatchObject({
      identity: { runId: item.run.id, issue: 7, attempt: 1 },
      requests: 0,
      reopenings: 0,
      attempts: 1,
    });
    await expect(
      f.history.snapshot({ ...f.binding, ownerId: 'foreign' }, item.run.id),
    ).rejects.toThrow();
    await f.runs.update(item.run.id, { status: 'failed' });
    await expect(f.history.snapshot(f.binding, item.run.id)).rejects.toThrow();
    expect(() =>
      admittedQaIdentity(f.binding, item.run.id, { ...item.subject, kind: 'review' }),
    ).toThrow();
  });
  it('counts authentic prior rework and preserves a smaller reopen cap without requiring an already-open transition', async () => {
    const f = await fixture();
    await historicalPreviousQa(f, [
      {
        type: 'ReworkRequest',
        repository: 'example/repo',
        issue: 7,
        attempt: 1,
        pullRequest: 12,
        mergeSha: 'd'.repeat(40),
        request: 1,
      },
    ]);
    const impl2 = await historical(f, 'implementation', 2, undefined, [
      {
        type: 'PrCreated',
        repository: 'example/repo',
        issue: 7,
        attempt: 2,
        pullRequest: 12,
        head,
      },
    ]);
    const item = await f.admitted();
    await f.runs.update(item.run.id, { status: 'running' });
    expect(item.subject.source).toEqual({ kind: 'implementation', runId: impl2.run.id });
    expect(await f.history.snapshot(f.binding, item.run.id)).toMatchObject({
      requests: 1,
      reopenings: 0,
      attempts: 2,
    });
  });
  it.each(['intent', 'tamper', 'key-rotation', 'missing', 'wrong-visit'] as const)(
    'refuses prior prepared QA %s uncertainty',
    async (mode) => {
      const f = await fixture(),
        prior = await historicalPreviousQa(f, [
          {
            type: 'ReworkRequest',
            repository: 'example/repo',
            issue: 7,
            attempt: 1,
            pullRequest: 12,
            mergeSha: 'd'.repeat(40),
            request: 1,
          },
        ]);
      await prior.started('prepare');
      const visit = await prior.started('qa-rework');
      const identity = admittedQaIdentity(prior.binding, prior.run.id, prior.subject),
        state = QaStateSchema.parse({
          identity,
          reservation: {
            key: 'qa-rework:' + (mode === 'wrong-visit' ? visit + 1 : visit),
            request: 1,
            requiresReopen: true,
            reopen: mode === 'intent' ? 'intent' : 'complete',
            relabel: 'none',
          },
        });
      if (mode !== 'missing')
        f.files.set(
          join(f.root, '.git', 'graphgoblin', 'qa', qaIdentityKey(identity) + '.qa.json'),
          mode === 'tamper'
            ? '{}'
            : encodeQaState(identity, state, mode === 'key-rotation' ? 'rotated-key' : f.key.token),
        );
      await historical(f, 'implementation', 2, undefined, [
        {
          type: 'PrCreated',
          repository: 'example/repo',
          issue: 7,
          attempt: 2,
          pullRequest: 12,
          head,
        },
      ]);
      const current = await f.admitted();
      await f.runs.update(current.run.id, { status: 'running' });
      await expect(f.history.snapshot(f.binding, current.run.id)).rejects.toThrow();
    },
  );
});

describe('observable unavailable QA admission', () => {
  it('records a real failed no-turn run and one explanation; restart cannot replenish merge or issue-attempt admission', async () => {
    const f = await fixture();
    const prerequisite = await f.prerequisites.check('local', f.binding.manifest, f.settings);
    expect(prerequisite).toMatchObject({ canInstantiate: true, canRun: false });
    installImplementationFinalization(f.runs, f.reporter);
    const manager = new RunManager(
      { ...f.ports, runs: f.runs, events: f.events, admission: f.admission, scripts: f.scripts },
      { ...DEFAULT_TEST_SETTINGS, ...f.runtime.hooks },
    );
    managers.push(manager);
    await manager.start();
    const run = await manager.startRun({
      ownerId: 'local',
      loopId: f.parent.loopId,
      versionId: f.parent.id,
      allowDraft: true,
      source: 'manual.api',
      triggerNodeId: 'start',
      payload: { pullRequest: 12 },
    });
    await manager.waitForIdle();
    expect(await f.runs.get(run.id)).toMatchObject({
      status: 'failed',
      failure: { code: 'TEMPLATE_ISOLATION_UNAVAILABLE', resumable: false },
    });
    const events = await f.events.read(run.id);
    expect(events.some((event) => event.type === 'run.failed')).toBe(true);
    expect(events.some((event) => event.type === 'node.started')).toBe(false);
    expect(f.ports.harness.started).toEqual([]);
    expect(
      f.requests.every((request) => request.command === 'git' || request.command === 'gh'),
    ).toBe(true);
    expect(f.commands.every((request) => ['rev-parse', 'remote'].includes(request.args[7]!))).toBe(
      true,
    );
    expect(f.comments).toHaveLength(1);
    expect(f.comments[0]?.body).toContain('No QA or adversary turn');
    await expect(manager.resume(run.id, { kind: 'user', id: 'owner' })).rejects.toThrow();
    await f.reporter.terminal((await f.runs.get(run.id))!);
    expect(f.comments).toHaveLength(1);
    await expect(f.admission.create(f.intent())).rejects.toThrow();
    f.pr.merge_commit_sha = 'c'.repeat(40);
    await expect(f.admission.create(f.intent())).rejects.toThrow();
    expect(f.comments).toHaveLength(1);
  });
  it('reconciles a lost explanatory response with the exact marker after terminal failure', async () => {
    const f = await fixture(),
      item = await f.admitted();
    f.failPost();
    await expect(
      f.reporter.report(f.binding, item.run, item.subject, 'TEMPLATE_ISOLATION_UNAVAILABLE'),
    ).rejects.toMatchObject({ code: 'TEMPLATE_REPORT_UNAVAILABLE' });
    await f.events.append(item.run.id, [
      {
        type: 'run.failed',
        failure: { code: 'TEMPLATE_REPORT_UNAVAILABLE', message: 'Fixed', resumable: false },
      },
    ]);
    const failed = await f.runs.update(item.run.id, { status: 'failed' });
    await f.reporter.terminal(failed);
    expect(f.comments).toHaveLength(1);
  });
  it.each([
    'code',
    'owner',
    'metadata',
    'conflicting-comment',
    'duplicate-comment',
    'bounded-comments',
    'progressed',
  ] as const)('refuses %s explanation without an unrelated effect', async (mode) => {
    const f = await fixture(),
      item = await f.admitted();
    if (mode === 'metadata') f.failRead();
    if (mode === 'conflicting-comment' || mode === 'duplicate-comment') {
      await f.reporter.report(f.binding, item.run, item.subject, 'TEMPLATE_ISOLATION_UNAVAILABLE');
      if (mode === 'conflicting-comment') f.comments[0]!.body += ' edited';
      else f.comments.push({ ...f.comments[0]! });
    }
    if (mode === 'bounded-comments')
      f.comments.push(...Array.from({ length: 100 }, () => ({ body: 'Unrelated' })));
    if (mode === 'progressed')
      await f.events.append(item.run.id, [
        {
          type: 'node.started',
          nodeId: 'claim',
          kind: 'script',
          attempt: 1,
          configHash: f.binding.loops.find((loop) => loop.key === 'parent')!.nodes['claim']!
            .configHash,
        },
      ]);
    const before = f.comments.length;
    await expect(
      f.reporter.report(
        mode === 'owner' ? { ...f.binding, ownerId: 'foreign' } : f.binding,
        item.run,
        item.subject,
        mode === 'code' ? 'INVENTED' : 'TEMPLATE_ISOLATION_UNAVAILABLE',
      ),
    ).rejects.toMatchObject({ code: 'TEMPLATE_REPORT_UNAVAILABLE' });
    expect(f.comments).toHaveLength(before);
  });
});

describe('immutable fixed child versions at the API boundary', () => {
  it('accepts actual empty dynamic pins for numeric children and independently verifies a fixed child run', async () => {
    const f = await fixture(),
      item = await f.admitted(),
      rows = await f.events.read(item.run.id);
    expect(rows[0]).not.toHaveProperty('subloopVersions');
    await expect(readAuthority(f.store, f.binding, item.run.id)).resolves.toMatchObject({
      subject: { kind: 'qa' },
    });
    const child = f.loops.find((loop) => loop?.loopId !== f.parent.loopId)!;
    await expect(
      assertPinnedBundle(f.store, f.binding, child.loopId, [{ ...rows[0]!, type: 'run.queued' }]),
    ).resolves.toBeUndefined();
  });
  it.each([
    'missing-child',
    'wrong-loop',
    'wrong-number',
    'child-draft',
    'hash',
    'foreign-ref',
    'tampered-pin',
    'extra-pin',
    'missing-root',
    'no-queued',
  ] as const)('refuses %s without a fabricated pin', async (mode) => {
    const f = await fixture(),
      item = await f.admitted(),
      rows = await f.events.read(item.run.id),
      child = f.loops.find((loop) => loop?.loopId !== f.parent.loopId)!;
    const binding = structuredClone(f.binding),
      parent = structuredClone(f.parent);
    if (mode === 'foreign-ref') {
      const node = parent.definition.nodes.find((node) => node.kind === 'subloop')!;
      if (node.kind === 'subloop') node.config.loopRef.loopId = fakeUlid('foreign-child');
      binding.loops.find((loop) => loop.key === 'parent')!.hash = executionHash(parent.definition);
    }
    if (mode === 'hash') binding.loops.find((loop) => loop.key === 'adversary')!.hash = 'changed';
    const store = {
      version: async (id: string) => {
        if (id === child.id) {
          if (mode === 'missing-child') return undefined;
          return {
            ...child,
            ...(mode === 'wrong-loop' ? { loopId: fakeUlid('wrong-child') } : {}),
            ...(mode === 'wrong-number' ? { version: 999 } : {}),
            ...(mode === 'child-draft' ? { status: 'draft' as const } : {}),
          };
        }
        if (id === parent.id) return parent;
        return f.store.version(id);
      },
    };
    const queued = rows[0]!;
    if (queued.type !== 'run.queued') throw new Error('Expected queued event');
    const events =
      mode === 'no-queued'
        ? []
        : [
            {
              ...queued,
              ...(mode === 'tampered-pin'
                ? { subloopVersions: { [child.loopId]: fakeUlid('wrong-version') } }
                : {}),
              ...(mode === 'extra-pin'
                ? { subloopVersions: { [fakeUlid('unrelated')]: child.id } }
                : {}),
            },
          ];
    await expect(
      assertPinnedBundle(
        store,
        binding,
        mode === 'missing-root' ? fakeUlid('missing') : f.parent.loopId,
        events,
      ),
    ).rejects.toThrow();
  });
});

describe('strict QA private transport and shipped closure', () => {
  function pollEnvelope(f: Fixture) {
    return {
      settings: f.settings,
      credential: f.key.token,
      identity: {
        kind: 'poll' as const,
        ownerId: 'local',
        loopId: f.parent.loopId,
        versionId: f.parent.id,
        nodeId: 'start',
      },
      input: null,
      subject: null,
      claim: null,
      visit: null,
      history: null,
    };
  }
  it('runs metadata poll even while native isolation is unavailable, but never constructs metadata ports for a node effect', async () => {
    const f = await fixture(),
      discovery = new NativeQaDiscovery(f.metadata),
      poll = pollEnvelope(f);
    expect(await discovery.execute('poll', QaPrivateEnvelopeSchema.parse(poll))).toEqual({
      items: [{ id: sha, payload: { pullRequest: 12, mergeSha: sha } }],
    });
    const item = await f.admitted();
    await f.runs.update(item.run.id, { status: 'running' });
    const factory = vi.fn(f.metadata),
      identity = {
        kind: 'node' as const,
        ownerId: 'local',
        loopId: f.parent.loopId,
        versionId: f.parent.id,
        nodeId: 'claim',
        runId: item.run.id,
        startedSeq: 2,
      };
    const envelope = QaPrivateEnvelopeSchema.parse({
      ...poll,
      identity,
      input: item.input.initialThread,
      subject: item.subject,
      visit: 2,
      history: await f.history.snapshot(f.binding, item.run.id),
    });
    expect(await new NativeQaDiscovery(factory).execute('claim', envelope)).toMatchObject({
      type: 'SupportBlocked',
      code: 'TEMPLATE_ISOLATION_UNAVAILABLE',
    });
    expect(factory).not.toHaveBeenCalled();
    expect(await new NativeQaDiscovery(factory).execute('poll', envelope)).toMatchObject({
      code: 'QA_POLL_IDENTITY_REFUSED',
    });
    expect(factory).not.toHaveBeenCalled();
  });
  it('does not hide valid candidates behind unavailable isolation; rechecks stale identities and filters only ineligible metadata', async () => {
    const f = await fixture(),
      discovery = new NativeQaDiscovery(f.metadata),
      poll = QaPrivateEnvelopeSchema.parse(pollEnvelope(f));
    f.candidates([{ pullRequest: 12, mergeSha: 'c'.repeat(40) }]);
    expect(await discovery.execute('poll', poll)).toEqual({ items: [] });
    f.candidates([{ pullRequest: 12, mergeSha: sha }]);
    f.links([]);
    expect(await discovery.execute('poll', poll)).toEqual({ items: [] });
    f.failRead();
    await expect(discovery.execute('poll', poll)).rejects.toThrow();
  });
  it.each(['input', 'subject', 'claim', 'visit', 'history', 'unknown'] as const)(
    'refuses poll %s authority fields',
    async (field) => {
      const f = await fixture(),
        item = await f.admitted(),
        base = pollEnvelope(f);
      const extra: Record<string, unknown> = {
        input: item.input.initialThread,
        subject: item.subject,
        claim: { type: 'ClaimRecord', repository: 'example/repo', issue: 7, attempt: 1 },
        visit: 2,
        history: {
          identity: admittedQaIdentity(f.binding, item.run.id, item.subject),
          requests: 0,
          reopenings: 0,
          attempts: 1,
        },
        unknown: true,
      };
      expect(QaPrivateEnvelopeSchema.safeParse({ ...base, [field]: extra[field] }).success).toBe(
        false,
      );
    },
  );
  it('binds a private node envelope to exact current run, repository, source and factual counters', async () => {
    const f = await fixture(),
      item = await f.admitted();
    await f.runs.update(item.run.id, { status: 'running' });
    const base = {
      ...pollEnvelope(f),
      identity: {
        kind: 'node' as const,
        ownerId: 'local',
        loopId: f.parent.loopId,
        versionId: f.parent.id,
        nodeId: 'claim',
        runId: item.run.id,
        startedSeq: 2,
      },
      input: item.input.initialThread,
      subject: item.subject,
      visit: 2,
      history: await f.history.snapshot(f.binding, item.run.id),
    };
    expect(QaPrivateEnvelopeSchema.safeParse(base).success).toBe(true);
    for (const patch of [
      { history: null },
      { visit: null },
      { input: null },
      { subject: null },
      { subject: { ...item.subject, role: 'worker' } },
      {
        history: {
          ...base.history,
          identity: {
            ...base.history.identity,
            source: { kind: 'implementation', runId: fakeUlid('fake') },
          },
        },
      },
      { input: { ...base.input, run: { ...base.input.run, loopId: fakeUlid('foreign') } } },
      { input: { ...base.input, run: { ...base.input.run, versionId: fakeUlid('foreign') } } },
      { claim: { type: 'ClaimRecord', repository: 'foreign/repo', issue: 7, attempt: 1 } },
    ])
      expect(QaPrivateEnvelopeSchema.safeParse({ ...base, ...patch }).success).toBe(false);
  });
  it('keeps --version effect-free, refuses unknown/oversized input, and contains factory errors', async () => {
    const factory = vi.fn(() => {
      throw new Error('Never construct for version');
    });
    expect(await qaEntry(['--version'], '', factory)).toEqual({
      name: 'graphgoblin-qa-support',
      version: '1.0.0',
    });
    expect(factory).not.toHaveBeenCalled();
    expect(await qaEntry([], '', factory)).toMatchObject({ code: 'QA_INVALID_INPUT' });
    expect(await qaEntry(['poll'], 'x'.repeat(1048577), factory)).toMatchObject({
      code: 'QA_INVALID_INPUT',
    });
    expect(await qaEntry(['poll'], '{}', factory)).toMatchObject({
      code: 'QA_SUPPORT_UNAVAILABLE',
    });
    const f = await fixture();
    expect(
      await qaEntry(
        ['poll'],
        JSON.stringify(pollEnvelope(f)),
        () => new NativeQaDiscovery(f.metadata),
      ),
    ).toMatchObject({ items: [{ id: sha }] });
    expect(
      await qaEntry(
        ['unknown'],
        JSON.stringify(pollEnvelope(f)),
        () => new NativeQaDiscovery(f.metadata),
      ),
    ).toMatchObject({ code: 'QA_SUPPORT_UNAVAILABLE' });
  });
  it('recomputes exact merge-SHA keys through private scripts before any generic poll dedupe or progress', async () => {
    const f = await fixture();
    await f.apiKeys.authenticate(f.key.token);
    const request: ScriptRunRequest = {
      command: 'graphgoblin-template-support',
      args: ['poll'],
      cwd: f.root,
      env: {},
      signal: new AbortController().signal,
      executionIdentity: {
        kind: 'poll',
        ownerId: 'local',
        loopId: f.parent.loopId,
        versionId: f.parent.id,
        nodeId: 'start',
      },
    };
    // Published parent probe has no run authority. Published content remains the immutable binding.
    await new SqliteLoopRepository(f.handle.db, f.ports.clock, f.ports.ids).publish(
      f.parent.loopId,
    );
    const output = await f.scripts.run(request);
    expect(JSON.parse(output.stdout)).toEqual({
      items: [{ id: sha, payload: { pullRequest: 12, mergeSha: sha } }],
    });
    const raw = f.requests.at(-1)!;
    const envelope = QaPrivateEnvelopeSchema.parse(JSON.parse(raw.stdin!));
    expect(envelope).toMatchObject({
      input: null,
      subject: null,
      history: null,
      claim: null,
      visit: null,
    });
    expect(raw.env).not.toHaveProperty('GH_TOKEN');
    expect(raw.env).not.toHaveProperty('GG_API_KEY');
    expect(raw.args).not.toContain(f.key.token);
    expect(output.stdout).not.toContain(f.key.token);
    f.pr.merge_commit_sha = 'c'.repeat(40);
    await expect(f.scripts.run(request)).rejects.toMatchObject({
      code: 'TEMPLATE_AUTHORITY_REFUSED',
    });
  });
  it.each(['duplicate', 'changed', 'unknown', 'authority'] as const)(
    'refuses %s raw poll result',
    async (mode) => {
      const f = await fixture(),
        item = { id: sha, payload: { pullRequest: 12, mergeSha: sha } };
      if (mode === 'changed') f.pr.merge_commit_sha = 'c'.repeat(40);
      const input =
        mode === 'unknown'
          ? { items: [item], extra: true }
          : mode === 'authority'
            ? { items: [{ ...item, payload: { ...item.payload, attempt: 3 } }] }
            : { items: mode === 'duplicate' ? [item, item] : [item] };
      await expect(
        qaPollKeys(f.binding, JsonValueSchema.parse(input), f.authority),
      ).rejects.toThrow();
    },
  );
  it('hashes every shipped local delegate; changed schemas change the immutable support hash', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gg-qa-closure-'));
    dirs.push(root);
    for (const module of QA_SUPPORT_MODULES) {
      const path = join(root, 'src', 'templates', module + '.ts');
      await mkdir(resolve(path, '..'), { recursive: true });
      await writeFile(path, 'export const value = 1;');
    }
    const first = await qaSupportClosure(root, '1.0.0', true);
    expect(first.path).toBe(join(root, 'src', 'templates', 'github', 'qa-entry.ts'));
    await writeFile(
      join(root, 'src', 'templates', 'github', 'qa-envelope.ts'),
      'export const value = 2;',
    );
    expect((await qaSupportClosure(root, '1.0.0', true)).hash).not.toBe(first.hash);
    await expect(qaSupportClosure(root, 'other', true)).rejects.toThrow();
    await expect(qaSupportClosure(root, '1.0.0', false)).rejects.toThrow();
    await writeFile(join(root, 'src', 'templates', 'authority.ts'), 'x'.repeat(1048576));
    await writeFile(join(root, 'src', 'templates', 'binding.ts'), 'x'.repeat(1048576));
    await expect(qaSupportClosure(root, '1.0.0', true)).rejects.toThrow();
    const installed = await new TemplateCatalog(join(apiRoot, 'templates'), apiRoot).get('qa');
    expect(installed.support?.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      installed.bundle.manifest.prerequisites.find((item) => item.kind === 'github')?.label,
    ).toBe('Authenticated configured repository');
  });
});

/* Inert async ports preserve production signatures without native effects. */
/* eslint-disable @typescript-eslint/require-await */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LoopExportSchema,
  ReviewTemplateSettingsSchema,
  ImplementationTemplateSettingsSchema,
  TemplateManifestSchema,
  TemplateInstanceSchema,
  type JsonValue,
  type RunRecord,
} from '@graphgoblin/contracts';
import { fakeUlid, FIXTURE_TS } from '@graphgoblin/contracts/testing';
import { stableHash, prepareTemplateBundle } from '@graphgoblin/domain';
import { createInitialThread, type ScriptRunRequest } from '@graphgoblin/engine';
import {
  FakeClock,
  InMemorySecrets,
  FakeModelCatalog,
  FakeHarness,
  FakeScripts,
} from '@graphgoblin/engine/testing';
import {
  openMemoryDatabase,
  SqliteTemplateInstances,
  SqliteEventStore,
  SqliteTriggerAdmission,
  SqliteRunRepository,
  SqliteApiKeys,
  type DatabaseHandle,
} from '@graphgoblin/infrastructure/sqlite';
import { bindingJson, executionHash, TemplateBindingSchema } from '../binding.js';
import { subjectJson, type ParentSubject } from '../subjects.js';
import { checkedEvents, assertSubjectSource } from '../authority.js';
import { TemplateRuntime, templateAdmission } from '../runtime.js';
import { TemplateInstances } from '../instances.js';
import { TemplatePrerequisites } from '../prerequisites.js';
import { PrivateTemplateScripts } from '../scripts.js';
import { TemplateCatalog } from '../catalog.js';
import { ReviewAuthority } from './review-authority.js';
import { ReviewReporter } from './review-reporter.js';
import { readReviewWake } from './review-wake.js';
import { ReviewEnvelopeSchema } from './review-protocol.js';
import { SignedReviewJournal, ReviewJournalSchema, type ArtifactFiles } from './review-storage.js';
import { ImplementationRepository } from './repository.js';
import { ReviewPullRequestSchema, type ReviewGithubPort } from './review-client.js';
import type { ReviewDependencies } from './review.js';
const handles: DatabaseHandle[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});
const original = 'a'.repeat(40),
  next = 'b'.repeat(40);
async function fixture(issue: number | null = 42) {
  const handle = await openMemoryDatabase();
  handles.push(handle);
  const clock = new FakeClock(),
    store = new SqliteTemplateInstances(handle.db),
    events = new SqliteEventStore(handle.db, clock),
    runs = new SqliteRunRepository(handle.db);
  let serial = 0;
  const ids = { next: () => fakeUlid('review-service-' + ++serial) };
  const settings = ReviewTemplateSettingsSchema.parse({
    kind: 'review',
    repository: {
      path: join(tmpdir(), 'gg-review-service-inert'),
      owner: 'Example',
      name: 'Repo',
      baseBranch: 'main',
    },
    supportReadKey: 'reader',
    roles: {
      reviewer: { harness: 'codex', model: 'gpt-6-sol', effort: 'high' },
      fixer: { harness: 'codex', model: 'gpt-6-luna', effort: 'low' },
    },
  });
  const directory = new URL('../../../templates/review/', import.meta.url);
  const asset = async (name: string): Promise<unknown> =>
    JSON.parse(await readFile(new URL(name, directory), 'utf8'));
  const manifest = TemplateManifestSchema.parse(await asset('manifest.json')),
    definition = LoopExportSchema.parse(await asset('parent.json')).loop;
  const prepared = prepareTemplateBundle({ manifest, loops: { parent: definition } }, settings, {
    parent: { loopId: ids.next(), versionId: ids.next(), version: 1, name: 'Review' },
  });
  const parent = prepared.loops[0]!;
  const instance = TemplateInstanceSchema.parse({
    id: ids.next(),
    ownerId: 'local',
    templateId: manifest.id,
    templateVersion: manifest.version,
    parentLoopId: parent.loopId,
    createdAt: FIXTURE_TS,
    settings,
    loops: prepared.loops.map(({ key, loopId, versionId, version, status }) => ({
      key,
      loopId,
      versionId,
      version,
      status,
    })),
  });
  const binding = TemplateBindingSchema.parse({
    ownerId: 'local',
    instanceId: instance.id,
    manifest,
    settings,
    support: { path: join(settings.repository.path, 'review-entry.js'), hash: 'verified-review' },
    loops: [
      {
        key: 'parent',
        loopId: parent.loopId,
        versionId: parent.versionId,
        hash: executionHash(parent.definition),
        nodes: Object.fromEntries(
          parent.definition.nodes.map((node) => [
            node.id,
            { kind: node.kind, configHash: stableHash(node.config) },
          ]),
        ),
      },
    ],
  });
  await store.create(instance, bindingJson(binding), prepared.loops);
  const run: RunRecord = {
    id: ids.next(),
    ownerId: 'local',
    loopId: parent.loopId,
    versionId: parent.versionId,
    invocationId: ids.next(),
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
      source: 'manual.api',
      trigger: {
        nodeId: 'start',
        kind: 'manual',
        payload: { pullRequest: 7 },
        receivedAt: FIXTURE_TS,
      },
    },
  });
  await new SqliteTriggerAdmission(handle.db, events).create({
    run,
    initialThread: thread,
    queued: { type: 'run.queued', initialThread: thread, subloopVersions: {} },
    pinnedLoopIds: [parent.loopId],
  });
  const subject: ParentSubject = {
    role: 'parent',
    kind: 'review',
    repository: 'example/repo',
    instanceId: instance.id,
    templateVersion: manifest.version,
    issue,
    attempt: issue === null ? null : 1,
    source: { kind: 'external' },
    pullRequest: 7,
    head: original,
  };
  await store.setSubject(run.id, subjectJson(subject));
  const pr = ReviewPullRequestSchema.parse({
    number: 7,
    title: 'Review',
    body: 'Original',
    state: 'open',
    draft: false,
    merged: false,
    merge_commit_sha: null,
    user: { login: 'Writer' },
    head: { ref: 'topic', sha: original, repo: { full_name: 'example/repo' } },
    base: { ref: 'main', repo: { full_name: 'example/repo' } },
  });
  const fileRows = new Map<string, string>(),
    comments = new Map<number, { body: string }[]>(),
    effects: string[] = [];
  const files: ArtifactFiles = {
    canonical: async (path) => resolve(path),
    directory: async () => {},
    exists: async () => true,
    read: async (path) => fileRows.get(path),
    text: async (_root, path, text) => {
      fileRows.set(path, text);
    },
  };
  const github: ReviewGithubPort = {
    authenticate: async () => {},
    pullRequest: async () => structuredClone(pr),
    reviewCandidates: async () => [pr],
    permission: async () => 'write',
    linkedIssues: async () =>
      issue === null ? [] : [{ repository: 'example/repo', number: issue }],
    issue: async () => ({
      number: issue!,
      state: 'open',
      title: 'Original',
      body: 'Acceptance',
      labels: [],
      html_url: 'https://github.com/example/repo/issues/' + issue,
    }),
    requiredChecks: async () => [],
    checks: async () => [],
    readiness: async () => ({
      head: pr.head.sha,
      mergeable: true,
      clean: true,
      reviewsSatisfied: true,
    }),
    comments: async (_repo, number) => comments.get(number) ?? [],
    post: async (_repo, number, body) => {
      effects.push('post');
      comments.set(number, [...(comments.get(number) ?? []), { body }]);
    },
    label: async () => {
      effects.push('label');
    },
    merge: async () => {
      throw new Error('not permitted');
    },
    close: async () => {
      throw new Error('not permitted');
    },
  };
  let local = original,
    dirty = false;
  const deps: ReviewDependencies = {
    files,
    github,
    git: 'inert-git',
    gate: async () => {
      throw new Error('not permitted');
    },
    now: () => 0,
    sleep: async () => {},
    commands: {
      run: async (request) => {
        const args = request.args.slice(7);
        return {
          exitCode: 0,
          stdout:
            args[0] === 'remote'
              ? 'https://github.com/example/repo.git'
              : args[0] === 'ls-remote'
                ? pr.head.sha + '\trefs/heads/topic'
                : args[0] === 'status'
                  ? dirty
                    ? ' M a.ts'
                    : ''
                  : args[1] === '--git-common-dir'
                    ? join(settings.repository.path, '.git')
                    : args[1] === 'HEAD'
                      ? local
                      : request.cwd,
          stderr: '',
          timedOut: false,
          overflow: false,
          termination: 'confirmed',
        };
      },
    },
  };
  const authority = new ReviewAuthority(
      { store },
      async () => deps,
      async () => 'service-private-key',
    ),
    reporter = new ReviewReporter({ store }, async () => deps);
  const repo = new ImplementationRepository(settings, deps.commands, files, deps.git, 'review');
  const identity = {
    ownerId: 'local',
    runId: run.id,
    repository: 'example/repo',
    pullRequest: 7,
    originalHead: original,
    issue,
    attempt: subject.attempt,
  };
  const journal = new SignedReviewJournal(files, 'service-private-key', identity);
  async function started(nodeId: string) {
    const node = parent.definition.nodes.find((node) => node.id === nodeId)!;
    return (
      await events.append(run.id, [
        {
          type: 'node.started',
          nodeId,
          kind: node.kind,
          attempt: 1,
          configHash: stableHash(node.config),
        },
      ])
    )[0]!.seq;
  }
  async function output(nodeId: string, value: JsonValue) {
    await started(nodeId);
    await events.append(run.id, [
      {
        type: 'node.finished',
        nodeId,
        durationMs: 0,
        patch: [
          { op: 'add', path: '/outputs/' + nodeId, value: { nodeId, at: FIXTURE_TS, value } },
        ],
      },
    ]);
  }
  const claim = () =>
    output('claim', {
      type: 'ClaimRecord',
      repository: subject.repository,
      issue,
      attempt: subject.attempt,
    });
  async function parked(
    nodeId = 'human-wait',
    reason: 'input' | 'timeout' = 'input',
    payload: JsonValue = { decision: 'merge' },
  ) {
    const seq = await started(nodeId);
    await events.append(run.id, [
      { type: 'run.waiting', nodeId, wait: { nodeId, kind: 'input', startedSeq: seq } },
      ...(reason === 'input' ? [{ type: 'input.received' as const, nodeId, payload }] : []),
      { type: 'run.woken', nodeId, reason, ...(reason === 'input' ? { payload } : {}) },
    ]);
    return started(reason === 'input' ? 'human' : 'reminder');
  }
  async function privateScripts() {
    const apiKeys = new SqliteApiKeys(handle.db, clock, ids),
      key = await apiKeys.create('local', 'review reader', ['runs:read']),
      secrets = new InMemorySecrets({ reader: key.token }),
      requests: ScriptRunRequest[] = [];
    const catalog = new TemplateCatalog('.', '.');
    catalog.get = async () => ({
      bundle: { manifest, loops: { parent: parent.definition } },
      support: binding.support!,
    });
    const scripts = new PrivateTemplateScripts({
      instances: { store, catalog },
      apiKeys,
      secretsFor: () => secrets,
      environment: { PATH: 'safe', GH_TOKEN: key.token },
      raw: {
        run: async (request) => {
          requests.push(request);
          return {
            exitCode: 0,
            stdout: '{}',
            stderr: '',
            timedOut: false,
            stdoutOverflow: false,
            stderrOverflow: false,
          };
        },
      },
    });
    async function request(nodeId: string, seq: number) {
      await runs.update(run.id, { status: 'running', currentNodeId: nodeId });
      return {
        command: 'graphgoblin-template-support',
        args: [nodeId],
        cwd: '.',
        env: {},
        stdin: JSON.stringify(thread),
        signal: new AbortController().signal,
        executionIdentity: {
          kind: 'node' as const,
          ownerId: 'local',
          loopId: run.loopId,
          versionId: run.versionId,
          runId: run.id,
          nodeId,
          startedSeq: seq,
        },
      };
    }
    return { scripts, key, requests, request, apiKeys };
  }
  async function saveState(overrides: Partial<ReturnType<typeof ReviewJournalSchema.parse>> = {}) {
    const state = ReviewJournalSchema.parse({
      version: 1,
      head: original,
      cwd: repo.workspace(run.id),
      branch: 'graphgoblin/review-7-' + run.id,
      ref: 'topic',
      humanRequired: false,
      ...overrides,
    });
    await journal.save(repo.journal(run.id), state);
    return state;
  }
  return {
    handle,
    clock,
    ids,
    store,
    events,
    runs,
    settings,
    parent,
    instance,
    binding,
    run,
    thread,
    subject,
    pr,
    files,
    fileRows,
    deps,
    authority,
    reporter,
    effects,
    comments,
    started,
    output,
    claim,
    parked,
    privateScripts,
    saveState,
    repo,
    journal,
    setLocal: (head: string, isDirty = false) => {
      local = head;
      dirty = isDirty;
    },
  };
}
async function admissionFixture(f: Awaited<ReturnType<typeof fixture>>, authority = f.authority) {
  const catalog = new TemplateCatalog('.', '.');
  catalog.get = async () => ({
    bundle: { manifest: f.binding.manifest, loops: { parent: f.parent.definition } },
    support: f.binding.support!,
  });
  const prerequisites = new TemplatePrerequisites({
    catalog: new FakeModelCatalog(),
    harnesses: { codex: new FakeHarness() },
    scripts: new FakeScripts(),
    apiKeys: new SqliteApiKeys(f.handle.db, f.clock, f.ids),
    secretsFor: () => new InMemorySecrets(),
    supportAvailable: async () => true,
  });
  // This slice tests authenticated admission history; composed tests exercise real prerequisite resolution separately.
  prerequisites.check = async () => ({ checks: [], canInstantiate: true, canRun: true });
  const instances = new TemplateInstances(catalog, prerequisites, f.store, f.ids, f.clock);
  const runtime = new TemplateRuntime(instances, authority);
  const admission = templateAdmission(
    new SqliteTriggerAdmission(f.handle.db, f.events, (store, input, poll) =>
      runtime.afterRunStaged(store, input, poll),
    ),
    runtime,
  );
  return async (head: string, poll = false) => {
    const run: RunRecord = {
      ...f.run,
      id: f.ids.next(),
      invocationId: f.ids.next(),
      lastEventSeq: 0,
      status: 'queued',
    };
    const initialThread = createInitialThread({
      runId: run.id,
      loopId: run.loopId,
      versionId: run.versionId,
      invocation: {
        id: run.invocationId,
        source: poll ? 'poll' : 'manual.api',
        trigger: {
          nodeId: 'start',
          kind: poll ? 'poll' : 'manual',
          receivedAt: FIXTURE_TS,
          payload: poll ? { id: 7, payload: { pullRequest: 7, head } } : { pullRequest: 7, head },
          ...(poll ? { dedupeKey: '7:' + head } : {}),
        },
      },
    });
    const input = {
      run,
      initialThread,
      queued: { type: 'run.queued' as const, initialThread, subloopVersions: {} },
      pinnedLoopIds: [run.loopId],
    };
    const result = poll ? await admission.createPollItem(input) : await admission.create(input);
    return { result, run };
  };
}
async function implementationSource(
  f: Awaited<ReturnType<typeof fixture>>,
  attempt: 2 | 3,
  wrongHash = false,
) {
  const directory = new URL('../../../templates/implementation/', import.meta.url);
  const asset = async (name: string): Promise<unknown> =>
    JSON.parse(await readFile(new URL(name, directory), 'utf8'));
  const manifest = TemplateManifestSchema.parse(await asset('manifest.json'));
  const loops = Object.fromEntries(
    await Promise.all(
      manifest.loops.map(async (row) => [
        row.key,
        LoopExportSchema.parse(await asset(row.file)).loop,
      ]),
    ),
  );
  const settings = ImplementationTemplateSettingsSchema.parse({
    kind: 'implementation',
    repository: f.settings.repository,
    supportReadKey: 'reader',
    roles: { implementer: f.settings.roles.reviewer },
  });
  const prepared = prepareTemplateBundle(
    { manifest, loops },
    settings,
    Object.fromEntries(
      manifest.loops.map((row) => [
        row.key,
        {
          loopId: f.ids.next(),
          versionId: f.ids.next(),
          version: 1,
          name: 'Source ' + row.key + ' ' + attempt,
        },
      ]),
    ),
  );
  const instance = TemplateInstanceSchema.parse({
    id: f.ids.next(),
    ownerId: 'local',
    templateId: manifest.id,
    templateVersion: manifest.version,
    parentLoopId: prepared.parentLoopId,
    createdAt: FIXTURE_TS,
    settings,
    loops: prepared.loops.map(({ key, loopId, versionId, version, status }) => ({
      key,
      loopId,
      versionId,
      version,
      status,
    })),
  });
  const binding = TemplateBindingSchema.parse({
    ownerId: 'local',
    instanceId: instance.id,
    manifest,
    settings,
    support: {
      path: join(settings.repository.path, 'implementation-entry.js'),
      hash: 'verified-implementation',
    },
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
  });
  await f.store.create(instance, bindingJson(binding), prepared.loops);
  const parent = prepared.loops.find((row) => row.key === manifest.parentKey)!;
  const run: RunRecord = {
    ...f.run,
    id: f.ids.next(),
    invocationId: f.ids.next(),
    loopId: parent.loopId,
    versionId: parent.versionId,
    status: 'queued',
    lastEventSeq: 0,
  };
  const initialThread = createInitialThread({
    runId: run.id,
    loopId: run.loopId,
    versionId: run.versionId,
    invocation: {
      id: run.invocationId,
      source: 'manual.api',
      trigger: { nodeId: 'start', kind: 'manual', payload: { issue: 42 }, receivedAt: FIXTURE_TS },
    },
  });
  await new SqliteTriggerAdmission(f.handle.db, f.events).create({
    run,
    initialThread,
    queued: { type: 'run.queued', initialThread, subloopVersions: {} },
    pinnedLoopIds: prepared.loops.map((row) => row.loopId),
  });
  const subject: ParentSubject = {
    role: 'parent',
    kind: 'implementation',
    repository: 'example/repo',
    instanceId: instance.id,
    templateVersion: manifest.version,
    issue: 42,
    attempt,
    source: { kind: 'implementation', runId: run.id },
  };
  await f.store.setSubject(run.id, subjectJson(subject));
  for (const [nodeId, value] of [
    ['claim', { type: 'ClaimRecord', repository: subject.repository, issue: 42, attempt }],
    [
      'pr-created',
      {
        type: 'PrCreated',
        repository: subject.repository,
        issue: 42,
        attempt,
        pullRequest: 7,
        head: original,
      },
    ],
  ] as const) {
    const node = parent.definition.nodes.find((node) => node.id === nodeId)!;
    await f.events.append(run.id, [
      {
        type: 'node.started',
        nodeId,
        kind: 'script',
        attempt: 1,
        configHash: wrongHash && nodeId === 'pr-created' ? 'forged' : stableHash(node.config),
      },
      {
        type: 'node.finished',
        nodeId,
        durationMs: 0,
        patch: [
          { op: 'add', path: '/outputs/' + nodeId, value: { nodeId, at: FIXTURE_TS, value } },
        ],
      },
    ]);
  }
  await f.runs.update(run.id, { status: 'succeeded', outcome: 'success' });
  return { run, binding };
}
describe('permanent signed pushed-head consumption', () => {
  it.each(['failed', 'cancelled'] as const)(
    'consumes a pushed head after terminal %s before node.finished and after restart',
    async (status) => {
      const f = await fixture();
      await f.claim();
      const visit = await f.started('fixer-head');
      await f.saveState({ push: { parent: original, head: next, ref: 'topic', visit } });
      await f.runs.update(f.run.id, { status });
      f.pr.head.sha = next;
      const restart = new ReviewAuthority(
        { store: f.store },
        async () => f.deps,
        async () => 'service-private-key',
      );
      const admit = await admissionFixture(f, restart);
      await expect(admit(next)).rejects.toMatchObject({ code: 'TEMPLATE_SUBJECT_CONSUMED' });
      expect((await admit(next, true)).result).toBeUndefined();
      expect(
        await f.store.subjectRuns({
          ownerId: 'local',
          repository: 'example/repo',
          pullRequest: 7,
          limit: 65,
        }),
      ).toHaveLength(1);
      expect(f.effects).toEqual([]);
    },
  );
  it('consumes a signed saved result without node.finished and permits a genuinely external different head', async () => {
    const f = await fixture();
    await f.claim();
    const visit = await f.started('fixer-head');
    await f.saveState({
      head: next,
      results: {
        ['fixer-head:' + visit]: {
          type: 'FixerHead',
          repository: f.subject.repository,
          issue: 42,
          attempt: 1,
          pullRequest: 7,
          head: next,
        },
      },
    });
    await f.runs.update(f.run.id, { status: 'failed' });
    f.pr.head.sha = next;
    const admit = await admissionFixture(f);
    await expect(admit(next)).rejects.toMatchObject({ code: 'TEMPLATE_SUBJECT_CONSUMED' });
    f.pr.head.sha = 'c'.repeat(40);
    expect((await admit(f.pr.head.sha)).result).toMatchObject({ status: 'queued' });
  });
  it.each([
    'missing',
    'tampered',
    'visit',
    'ref',
    'parent',
    'identity',
    'result-key',
    'result-fact',
    'lost-head',
  ] as const)('refuses required %s proof rather than resetting the budget', async (mode) => {
    const f = await fixture();
    await f.claim();
    const visit = await f.started('fixer-head');
    await f.saveState({ push: { parent: original, head: next, ref: 'topic', visit } });
    const path = f.repo.journal(f.run.id);
    if (mode === 'missing') f.fileRows.delete(path);
    if (mode === 'tampered')
      f.fileRows.set(path, f.fileRows.get(path)!.replace(next, 'd'.repeat(40)));
    if (mode === 'identity') {
      const value = JSON.parse(f.fileRows.get(path)!) as { identity: { runId: string } };
      value.identity.runId = f.ids.next();
      f.fileRows.set(path, JSON.stringify(value));
    }
    if (mode === 'visit')
      await f.saveState({ push: { parent: original, head: next, ref: 'topic', visit: visit + 1 } });
    if (mode === 'ref')
      await f.saveState({ push: { parent: original, head: next, ref: 'other', visit } });
    if (mode === 'parent')
      await f.saveState({ push: { parent: next, head: next, ref: 'topic', visit } });
    if (mode === 'lost-head') await f.saveState({ head: next });
    if (mode === 'result-key' || mode === 'result-fact')
      await f.saveState({
        head: next,
        results: {
          ['fixer-head:' + (mode === 'result-key' ? visit + 1 : visit)]: {
            type: 'FixerHead',
            repository: mode === 'result-fact' ? 'foreign/repo' : f.subject.repository,
            issue: 42,
            attempt: 1,
            pullRequest: 7,
            head: next,
          },
        },
      });
    await f.runs.update(f.run.id, { status: 'failed' });
    f.pr.head.sha = next;
    await expect((await admissionFixture(f))(next)).rejects.toMatchObject({
      code: 'TEMPLATE_AUTHORITY_REFUSED',
    });
    expect(f.effects).toEqual([]);
  });
  it('refuses revoked private credentials and does not require a journal when no fixer started', async () => {
    const f = await fixture();
    await f.claim();
    await f.runs.update(f.run.id, { status: 'failed' });
    f.pr.head.sha = next;
    expect((await (await admissionFixture(f))(next)).result).toMatchObject({ status: 'queued' });
    const g = await fixture();
    await g.claim();
    const visit = await g.started('fixer-head');
    await g.saveState({ push: { parent: original, head: next, ref: 'topic', visit } });
    await g.runs.update(g.run.id, { status: 'failed' });
    g.pr.head.sha = next;
    const revoked = new ReviewAuthority(
      { store: g.store },
      async () => g.deps,
      async () => 'revoked',
    );
    await expect((await admissionFixture(g, revoked))(next)).rejects.toMatchObject({
      code: 'TEMPLATE_AUTHORITY_REFUSED',
    });
  });
});
describe('authenticated implementation review lineage', () => {
  it.each([2, 3] as const)(
    'derives attempt %s from exact frozen SQLite PrCreated and carries it through private stdin',
    async (attempt) => {
      const f = await fixture(),
        source = await implementationSource(f, attempt);
      const selected = await f.authority.resolve(f.binding, { pullRequest: 7 });
      expect(selected).toMatchObject({
        attempt,
        issue: 42,
        source: { kind: 'implementation', runId: source.run.id },
      });
      f.subject.attempt = attempt;
      f.subject.source = { kind: 'implementation', runId: source.run.id };
      await f.store.setSubject(f.run.id, subjectJson(f.subject));
      await assertSubjectSource(f.store, f.binding, f.subject);
      const p = await f.privateScripts(),
        seq = await f.started('claim');
      await p.scripts.run(await p.request('claim', seq));
      const envelope = ReviewEnvelopeSchema.parse(JSON.parse(p.requests[0]!.stdin!));
      expect(envelope.subject).toMatchObject({
        attempt,
        source: { kind: 'implementation', runId: source.run.id },
      });
      await expect(
        assertSubjectSource(f.store, f.binding, { ...f.subject, source: { kind: 'external' } }),
      ).rejects.toThrow();
      await expect(
        assertSubjectSource(f.store, f.binding, {
          ...f.subject,
          source: { kind: 'implementation', runId: f.ids.next() },
        }),
      ).rejects.toThrow();
      await expect(
        assertSubjectSource(f.store, f.binding, { ...f.subject, issue: 43 }),
      ).rejects.toThrow();
      await expect(
        f.authority.resolve(f.binding, { pullRequest: 7, attempt }),
      ).rejects.toMatchObject({ code: 'TEMPLATE_AUTHORITY_REFUSED' });
    },
  );
  it('refuses conflicting authentic PrCreated sources and forged mapped events', async () => {
    const f = await fixture();
    await implementationSource(f, 2);
    await implementationSource(f, 3);
    await expect(f.authority.resolve(f.binding, { pullRequest: 7 })).rejects.toMatchObject({
      code: 'TEMPLATE_AUTHORITY_REFUSED',
    });
    const g = await fixture();
    await implementationSource(g, 2, true);
    const selected = await g.authority.resolve(g.binding, { pullRequest: 7 });
    expect(selected.source).toEqual({ kind: 'external' });
    await expect(
      assertSubjectSource(g.store, g.binding, {
        ...g.subject,
        ...selected,
        role: 'parent',
        instanceId: g.instance.id,
        templateVersion: g.binding.manifest.version,
      }),
    ).rejects.toMatchObject({ code: 'AUTHORITY_CONFLICT' });
  });
});
describe('persisted review input authority', () => {
  it.each(['human-wait', 'human-wait-capped'])(
    'passes only the exact paired input received on %s through private stdin',
    async (nodeId) => {
      const f = await fixture();
      await f.claim();
      const seq = await f.parked(nodeId),
        p = await f.privateScripts();
      f.thread.lastOutput = { nodeId: 'model', at: FIXTURE_TS, value: { decision: 'close' } };
      f.thread.vars['wake'] = { decision: 'close' };
      await p.scripts.run(await p.request('human', seq));
      const envelope = ReviewEnvelopeSchema.parse(JSON.parse(p.requests[0]!.stdin!));
      expect(envelope.wake).toMatchObject({
        reason: 'input',
        nodeId,
        payload: { decision: 'merge' },
      });
      expect(JSON.stringify({ ...p.requests[0], stdin: undefined })).not.toContain(p.key.token);
      expect(JSON.stringify(f.thread)).not.toContain(p.key.token);
      expect(p.requests[0]!.env).toEqual({ PATH: 'safe' });
    },
  );
  it('represents timeout separately with no human payload authority', async () => {
    const f = await fixture();
    await f.claim();
    const seq = await f.parked('human-wait', 'timeout'),
      p = await f.privateScripts();
    await p.scripts.run(await p.request('reminder', seq));
    expect(ReviewEnvelopeSchema.parse(JSON.parse(p.requests[0]!.stdin!)).wake).toMatchObject({
      reason: 'timeout',
      nodeId: 'human-wait',
    });
  });
  it.each(['hash', 'kind', 'unpaired', 'payload', 'parked', 'schema'] as const)(
    'refuses corrupted %s wait evidence',
    async (corruption) => {
      const f = await fixture();
      const seq = await f.parked(),
        rows = checkedEvents(await f.store.events(f.run.id));
      const start = rows.find(
        (event) => event.type === 'node.started' && event.nodeId === 'human-wait',
      );
      const wake = rows.find((event) => event.type === 'run.woken');
      const input = rows.find((event) => event.type === 'input.received');
      const parked = rows.find((event) => event.type === 'run.waiting');
      if (
        start?.type !== 'node.started' ||
        wake?.type !== 'run.woken' ||
        input?.type !== 'input.received' ||
        parked?.type !== 'run.waiting'
      )
        throw new Error('fixture');
      if (corruption === 'hash') start.configHash = 'forged';
      if (corruption === 'kind') start.kind = 'inference';
      if (corruption === 'unpaired') input.seq++;
      if (corruption === 'payload') wake.payload = { decision: 'close' };
      if (corruption === 'parked') parked.wait.startedSeq = 999;
      if (corruption === 'schema') {
        input.payload = { decision: 'launch-provider' };
        wake.payload = input.payload;
      }
      expect(() =>
        readReviewWake(f.binding, f.run.loopId, f.parent.definition, rows, seq),
      ).toThrow();
    },
  );
  it('does not create human authority without a persisted wake or on an unrelated mapped node', async () => {
    const f = await fixture();
    const seq = await f.started('human');
    expect(
      readReviewWake(
        f.binding,
        f.run.loopId,
        f.parent.definition,
        checkedEvents(await f.store.events(f.run.id)),
        seq,
      ),
    ).toBeNull();
    const changed = {
      ...f.binding,
      manifest: { ...f.binding.manifest, kind: 'implementation' as const },
    };
    expect(readReviewWake(changed, f.run.loopId, f.parent.definition, [], seq)).toBeNull();
  });
});
describe('trusted review discovery and same-run recovery', () => {
  it.each([null, 42])(
    'discovers external PR with linkage %s and rejects authored lineage/attempt/foreign keys',
    async (issue) => {
      const f = await fixture(issue);
      expect(await f.authority.resolve(f.binding, { pullRequest: 7 })).toMatchObject({
        kind: 'review',
        issue,
        attempt: issue === null ? null : 1,
        source: { kind: 'external' },
        head: original,
      });
      expect(
        await f.authority.resolve(f.binding, {
          id: 7,
          payload: { pullRequest: 7, head: original },
        }),
      ).toMatchObject({ pullRequest: 7 });
      for (const payload of [
        { pullRequest: 7, attempt: 2 },
        { pullRequest: 7, source: { kind: 'external' } },
        { id: 8, payload: { pullRequest: 7, head: original } },
        { pullRequest: 7, head: next },
        null,
      ])
        await expect(f.authority.resolve(f.binding, payload)).rejects.toMatchObject({
          code: 'TEMPLATE_AUTHORITY_REFUSED',
        });
      await expect(f.authority.recheck(f.binding, f.subject)).resolves.toBeUndefined();
    },
  );
  it('accepts recorded exact FixerHead after restart but refuses journal tampering, key rotation and remote head mismatch', async () => {
    const f = await fixture();
    await f.claim();
    await f.output('fixer-head', {
      type: 'FixerHead',
      repository: 'example/repo',
      issue: 42,
      attempt: 1,
      pullRequest: 7,
      head: next,
    });
    await f.saveState({ head: next });
    f.pr.head.sha = next;
    await expect(f.authority.recheck(f.binding, f.subject)).resolves.toBeUndefined();
    const path = f.repo.journal(f.run.id),
      content = f.fileRows.get(path)!;
    f.fileRows.set(path, content.replace(next, 'c'.repeat(40)));
    await expect(f.authority.recheck(f.binding, f.subject)).rejects.toThrow();
    f.fileRows.set(path, content);
    const rotated = new ReviewAuthority(
      { store: f.store },
      async () => f.deps,
      async () => 'revoked-key',
    );
    await expect(rotated.recheck(f.binding, f.subject)).rejects.toThrow();
    f.pr.head.sha = 'c'.repeat(40);
    await expect(f.authority.recheck(f.binding, f.subject)).rejects.toMatchObject({
      code: 'TEMPLATE_AUTHORITY_REFUSED',
    });
  });
  it('reconciles push commit/event gap only with authenticated intent and installed started action', async () => {
    const f = await fixture();
    await f.claim();
    await f.saveState({ push: { parent: original, head: next, ref: 'topic', visit: 4 } });
    f.pr.head.sha = next;
    f.setLocal(next);
    await expect(f.authority.recheck(f.binding, f.subject)).rejects.toMatchObject({
      code: 'TEMPLATE_AUTHORITY_REFUSED',
    });
    await f.started('fixer-head');
    await expect(f.authority.recheck(f.binding, f.subject)).resolves.toBeUndefined();
    f.setLocal(next, true);
    await expect(f.authority.recheck(f.binding, f.subject)).rejects.toMatchObject({
      code: 'TEMPLATE_AUTHORITY_REFUSED',
    });
  });
  it.each(['merge', 'close'] as const)(
    'reconciles response-lost terminal %s only on mapped signed intent',
    async (action) => {
      const f = await fixture();
      await f.saveState(
        action === 'merge'
          ? { merge: { head: original, method: 'squash' } }
          : { close: { head: original } },
      );
      f.pr.state = 'closed';
      f.pr.merged = action === 'merge';
      f.pr.merge_commit_sha = action === 'merge' ? next : null;
      await expect(f.authority.recheck(f.binding, f.subject)).rejects.toMatchObject({
        code: 'TEMPLATE_AUTHORITY_REFUSED',
      });
      await f.started(action);
      await expect(f.authority.recheck(f.binding, f.subject)).resolves.toBeUndefined();
      f.pr.head.sha = next;
      await expect(f.authority.recheck(f.binding, f.subject)).rejects.toMatchObject({
        code: 'TEMPLATE_AUTHORITY_REFUSED',
      });
    },
  );
  it('requires exact saved result plus installed fixer action in the journal/node-finished gap', async () => {
    const f = await fixture();
    await f.claim();
    await f.started('fixer-head');
    await f.saveState({
      head: next,
      results: {
        'fixer-head:4': {
          type: 'FixerHead',
          repository: 'example/repo',
          issue: 42,
          attempt: 1,
          pullRequest: 7,
          head: next,
        },
      },
    });
    f.pr.head.sha = next;
    await expect(f.authority.recheck(f.binding, f.subject)).resolves.toBeUndefined();
    await f.saveState({
      head: next,
      results: {
        'fixer-head:4': {
          type: 'FixerHead',
          repository: 'foreign/repo',
          issue: 42,
          attempt: 1,
          pullRequest: 7,
          head: next,
        },
      },
    });
    await expect(f.authority.recheck(f.binding, f.subject)).rejects.toMatchObject({
      code: 'TEMPLATE_AUTHORITY_REFUSED',
    });
  });
  it('refuses external close, changed linkage and unsupported template selection', async () => {
    const f = await fixture();
    f.pr.state = 'closed';
    await expect(f.authority.recheck(f.binding, f.subject)).rejects.toThrow();
    f.pr.state = 'open';
    const wrong = { ...f.subject, issue: 43 };
    await expect(f.authority.recheck(f.binding, wrong)).rejects.toThrow();
    await expect(
      f.authority.resolve(
        { ...f.binding, manifest: { ...f.binding.manifest, kind: 'qa' } },
        { pullRequest: 7 },
      ),
    ).rejects.toMatchObject({ code: 'TEMPLATE_AUTHORITY_UNAVAILABLE' });
  });
});
describe('review failure reporting', () => {
  it.each([null, 42])(
    'reconciles progressed cancellation for linkage %s with honest permanent consumption',
    async (issue) => {
      const f = await fixture(issue);
      await f.claim();
      await f.started('reviewer');
      await f.runs.update(f.run.id, { status: 'cancelled' });
      const run = (await f.runs.get(f.run.id))!;
      await f.reporter.terminal(run);
      await f.reporter.terminal(run);
      expect(f.comments.get(7)).toHaveLength(1);
      expect(f.comments.get(7)![0]!.body).toContain('Earlier effects may have occurred');
      expect(f.comments.get(7)![0]!.body).toContain('permanently consumed');
      expect(f.effects.filter((effect) => effect === 'label')).toHaveLength(issue === null ? 0 : 2);
    },
  );
  it.each([null, 42])(
    'reconciles no-turn and progressed reports for linkage %s without claiming no prior effects',
    async (issue) => {
      const f = await fixture(issue);
      await f.reporter.report(f.binding, f.run, f.subject, 'TEMPLATE_PREREQUISITE_UNAVAILABLE');
      await f.reporter.report(f.binding, f.run, f.subject, 'TEMPLATE_PREREQUISITE_UNAVAILABLE');
      expect(f.comments.get(7)).toHaveLength(1);
      expect(f.effects).not.toContain('label');
      await f.started('reviewer');
      const failed = {
        ...f.run,
        status: 'failed' as const,
        failure: { code: 'HARNESS_TURN_FAILED' as const, message: 'fixed', resumable: false },
      };
      await f.reporter.terminal(failed);
      await f.reporter.terminal(failed);
      expect(f.comments.get(7)).toHaveLength(2);
      expect(f.comments.get(7)?.[1]?.body).toContain('Earlier effects may have occurred');
      if (issue === null) {
        expect(f.effects).not.toContain('label');
        expect(f.comments.get(7)?.[1]?.body).toContain('No linked issue');
      } else expect(f.effects).toContain('label');
    },
  );
  it('refuses forged identity, unsupported fixed code and conflicting marker instead of losing the durable report', async () => {
    const f = await fixture();
    await expect(
      f.reporter.report(
        f.binding,
        f.run,
        { ...f.subject, head: next },
        'TEMPLATE_PREREQUISITE_UNAVAILABLE',
      ),
    ).rejects.toThrow();
    await expect(f.reporter.report(f.binding, f.run, f.subject, 'authored-code')).rejects.toThrow();
    await f.reporter.report(f.binding, f.run, f.subject, 'TEMPLATE_PREREQUISITE_UNAVAILABLE');
    f.comments.get(7)![0]!.body += 'forged';
    await expect(
      f.reporter.report(f.binding, f.run, f.subject, 'TEMPLATE_PREREQUISITE_UNAVAILABLE'),
    ).rejects.toMatchObject({ code: 'TEMPLATE_REPORT_UNAVAILABLE' });
  });
});

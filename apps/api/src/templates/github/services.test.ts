/* Synchronous fake ports retain async signatures to turn fixture failures into rejected promises. */
/* eslint-disable @typescript-eslint/require-await */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ImplementationTemplateSettingsSchema,
  JsonValueSchema,
  QaTemplateSettingsSchema,
  LoopDefinitionSchema,
  LoopExportSchema,
  TemplateManifestSchema,
  TemplateInstanceSchema,
  type RunRecord,
  type JsonValue,
} from '@graphgoblin/contracts';
import { fakeUlid, FIXTURE_TS } from '@graphgoblin/contracts/testing';
import { prepareTemplateBundle, stableHash } from '@graphgoblin/domain';
import {
  createInitialThread,
  type ScriptRunRequest,
  type StartRunInput,
} from '@graphgoblin/engine';
import {
  FakeClock,
  CapturingLogger,
  FakeModelCatalog,
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
import { bindingJson, executionHash, TemplateBindingSchema } from '../binding.js';
import { TemplateCatalog } from '../catalog.js';
import { subjectJson, type ParentSubject } from '../subjects.js';
import { PrivateTemplateScripts } from '../scripts.js';
import { TemplateRuntime, templateAdmission } from '../runtime.js';
import { TemplateInstances } from '../instances.js';
import { TemplatePrerequisites } from '../prerequisites.js';
import { PollTriggers } from '../../triggers/poll.js';
import { ImplementationAuthority } from './authority-source.js';
import { checkedEvents, readAuthority } from '../authority.js';
import { implementationPollKeys } from './poll.js';
import { ImplementationSupport } from './implementation.js';
import { assertIssueOutput } from './support-output.js';
import { blocked } from './protocol.js';
import { readImplementationIntent } from './intent.js';
import { ImplementationReporter, installImplementationFinalization } from './reporter.js';
import { JournalSchema, type Journal, type SupportStorage } from './storage.js';
import { ImplementationRepository } from './repository.js';
import { SupportEnvelopeSchema } from './protocol.js';
import type { ImplementationSupportDeps } from './implementation.js';
import type { GithubIssue, GithubPort, GithubPullRequest } from './client.js';
import type { CommandRequest } from './process.js';

const handles: DatabaseHandle[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});
async function fixture(initial = true) {
  const handle = await openMemoryDatabase();
  handles.push(handle);
  const clock = new FakeClock(),
    store = new SqliteTemplateInstances(handle.db),
    events = new SqliteEventStore(handle.db, clock);
  let serial = 0;
  const ids = { next: () => fakeUlid('service-' + ++serial) };
  const settings = ImplementationTemplateSettingsSchema.parse({
    kind: 'implementation',
    repository: {
      path: join(tmpdir(), 'gg-service-inert-repo'),
      owner: 'Example',
      name: 'Repo',
      baseBranch: 'main',
    },
    supportReadKey: 'support-reader',
    roles: { implementer: { harness: 'codex', model: 'gpt-6-sol', effort: 'high' } },
  });
  const directory = new URL('../../../templates/implementation/', import.meta.url);
  const json = async (name: string): Promise<unknown> =>
    JSON.parse(await readFile(new URL(name, directory), 'utf8'));
  const manifest = TemplateManifestSchema.parse(await json('manifest.json'));
  const loops = Object.fromEntries(
    await Promise.all(
      manifest.loops.map(async (loop) => [
        loop.key,
        LoopExportSchema.parse(await json(loop.file)).loop,
      ]),
    ),
  );
  const prepared = prepareTemplateBundle(
    { manifest, loops },
    settings,
    Object.fromEntries(
      manifest.loops.map((loop) => [
        loop.key,
        { loopId: ids.next(), versionId: ids.next(), version: 1, name: loop.key },
      ]),
    ),
  );
  const instance = TemplateInstanceSchema.parse({
    id: ids.next(),
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
    instanceId: instance.id,
    ownerId: 'local',
    manifest,
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
    support: {
      path: join(settings.repository.path, 'installed-entry.js'),
      hash: 'verified-support',
    },
  });
  await store.create(instance, bindingJson(binding), prepared.loops);
  const parent = prepared.loops.find((loop) => loop.key === 'parent')!;
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
      trigger: { nodeId: 'start', kind: 'manual', payload: { issue: 42 }, receivedAt: FIXTURE_TS },
    },
  });
  const admission = new SqliteTriggerAdmission(handle.db, events);
  if (initial)
    await admission.create({
      run,
      initialThread: thread,
      queued: {
        type: 'run.queued',
        initialThread: thread,
        subloopVersions: Object.fromEntries(
          prepared.loops
            .filter((loop) => loop.key !== 'parent')
            .map((loop) => [loop.loopId, loop.versionId]),
        ),
      },
      pinnedLoopIds: prepared.loops.map((loop) => loop.loopId),
    });
  const subject: ParentSubject = {
    role: 'parent',
    kind: 'implementation',
    instanceId: instance.id,
    templateVersion: manifest.version,
    repository: 'example/repo',
    issue: 42,
    attempt: 1,
    source: { kind: 'implementation', runId: run.id },
  };
  if (initial) await store.setSubject(run.id, subjectJson(subject));
  const runs = new SqliteRunRepository(handle.db);
  const current: GithubIssue = {
    number: 42,
    title: 'Implement behavior',
    body: 'Required behavior.',
    state: 'open',
    labels: [{ name: settings.labels.trigger }],
    html_url: 'https://github.com/example/repo/issues/42',
  };
  let prs: GithubPullRequest[] = [],
    comments: { body: string }[] = [],
    state: Journal | undefined,
    authError = false,
    postError = false;
  const effects: string[] = [],
    commands: CommandRequest[] = [];
  const github: GithubPort = {
    authenticate: async () => {
      if (authError) throw new Error('private-unsafe-auth-error');
    },
    issue: async () => structuredClone(current),
    candidates: async () => [current],
    labels: async () => Object.values(settings.labels),
    comments: async () => comments,
    post: async (_repo, _issue, body) => {
      if (postError) throw new Error('private-unsafe-post-error');
      effects.push('post');
      comments.push({ body });
    },
    comment: async () => {
      throw new Error('not used by reporter');
    },
    label: async (_repo, _issue, add, remove) => {
      effects.push('label');
      const names = new Set(current.labels.map((label) => label.name));
      for (const name of remove) names.delete(name);
      for (const name of add) names.add(name);
      current.labels = [...names].map((name) => ({ name }));
    },
    pullRequests: async () => prs,
    create: async () => {
      throw new Error('never create in reporter');
    },
  };
  const storage: SupportStorage = {
    canonical: async (path) => resolve(path),
    directory: async () => {},
    exists: async () => true,
    load: async () => state,
    save: async (_path, value) => {
      state = structuredClone(value);
    },
    text: async () => {},
  };
  const deps: ImplementationSupportDeps = {
    github,
    storage,
    git: 'inert-git',
    gate: async () => ({ program: 'inert-gate', args: [] }),
    commands: {
      run: async (request) => {
        commands.push(request);
        const args = request.args.slice(7);
        const stdout =
          args[0] === 'ls-remote'
            ? 'a'.repeat(40) + '\t' + String(args[3])
            : args[0] === 'remote'
              ? 'https://github.com/example/repo.git'
              : args[1] === '--git-common-dir'
                ? join(settings.repository.path, '.git')
                : args[1] === '--abbrev-ref'
                  ? (state?.branch ?? 'main')
                  : args[1] === 'HEAD'
                    ? (state?.intent?.head ?? 'a'.repeat(40))
                    : request.cwd;
        return {
          exitCode: 0,
          stdout,
          stderr: '',
          timedOut: false,
          overflow: false,
          termination: 'confirmed',
        };
      },
    },
  };
  const instances = { store };
  const authority = new ImplementationAuthority(instances, async () => deps),
    reporter = new ImplementationReporter(instances, async () => deps);
  async function claim() {
    const node = parent.definition.nodes.find((node) => node.id === 'claim')!;
    await events.append(run.id, [
      {
        type: 'node.started',
        nodeId: 'claim',
        kind: 'script',
        attempt: 1,
        configHash: stableHash(node.config),
      },
      {
        type: 'node.finished',
        nodeId: 'claim',
        durationMs: 0,
        patch: [
          {
            op: 'add',
            path: '/outputs/claim',
            value: {
              nodeId: 'claim',
              at: FIXTURE_TS,
              value: {
                type: 'ClaimRecord',
                repository: subject.repository,
                issue: subject.issue,
                attempt: subject.attempt,
              },
            },
          },
        ],
      },
    ]);
  }
  async function started(nodeId = 'prepare', attempt = 1) {
    const node = parent.definition.nodes.find((node) => node.id === nodeId)!;
    return (
      await events.append(run.id, [
        {
          type: 'node.started',
          nodeId,
          kind: node.kind,
          attempt,
          configHash: stableHash(node.config),
        },
      ])
    )[0]!.seq;
  }
  async function failure() {
    await events.append(run.id, [
      {
        type: 'run.failed',
        failure: { code: 'HARNESS_TURN_FAILED', message: 'fixed failure', resumable: false },
      },
    ]);
    return runs.update(run.id, {
      status: 'failed',
      failure: { code: 'HARNESS_TURN_FAILED', message: 'fixed failure', resumable: false },
    });
  }
  async function intent() {
    state = JournalSchema.parse({
      version: 1,
      runId: run.id,
      repository: 'example/repo',
      issue: 42,
      attempt: 1,
      branch: 'graphgoblin/issue-42-attempt-1',
      cwd: settings.repository.path,
      base: 'a'.repeat(40),
      title: 'Issue',
      body: 'Body',
      taskIndex: 0,
      intent: {
        head: 'b'.repeat(40),
        branch: 'graphgoblin/issue-42-attempt-1',
        title: 'Implement',
        body: 'Closes #42',
        pushed: true,
      },
    });
    const node = parent.definition.nodes.find((node) => node.id === 'pr-intent')!;
    await events.append(run.id, [
      {
        type: 'node.started',
        nodeId: 'pr-intent',
        kind: 'script',
        attempt: 1,
        configHash: stableHash(node.config),
      },
      {
        type: 'node.finished',
        nodeId: 'pr-intent',
        durationMs: 0,
        patch: [
          {
            op: 'add',
            path: '/outputs/pr-intent',
            value: {
              nodeId: 'pr-intent',
              at: FIXTURE_TS,
              value: {
                type: 'PrIntent',
                head: state.intent!.head,
                branch: state.intent!.branch,
                title: state.intent!.title,
                body: state.intent!.body,
              },
            },
          },
        ],
      },
    ]);
    prs = [
      {
        number: 7,
        state: 'open',
        title: 'Implement',
        head: {
          sha: 'b'.repeat(40),
          ref: state.intent!.branch,
          repo: { full_name: 'example/repo' },
        },
        base: { ref: 'main', repo: { full_name: 'example/repo' } },
        body: 'Closes #42',
      },
    ];
  }
  return {
    handle,
    store,
    events,
    runs,
    clock,
    ids,
    settings,
    instance,
    binding,
    parent,
    run,
    thread,
    subject,
    current,
    deps,
    instances,
    authority,
    reporter,
    commands,
    effects,
    claim,
    started,
    failure,
    intent,
    get prs() {
      return prs;
    },
    get comments() {
      return comments;
    },
    setComments(value: { body: string }[]) {
      comments = value;
    },
    setState(value: Journal | undefined) {
      state = value;
    },
    getState() {
      return state;
    },
    setAuthError(value: boolean) {
      authError = value;
    },
    setPostError(value: boolean) {
      postError = value;
    },
  };
}

describe('trusted implementation authority and failure reports', () => {
  it('rechecks eligibility from the authenticated original claim across restart', async () => {
    const f = await fixture();
    expect(
      await f.authority.resolve(f.binding, { id: 'example/repo#42@1', payload: { issue: 42 } }),
    ).toMatchObject({ issue: 42 });
    await f.authority.recheck(f.binding, f.subject);
    await f.claim();
    f.current.labels = [{ name: f.settings.labels.inProgress }];
    await new ImplementationAuthority(f.instances, async () => f.deps).recheck(
      f.binding,
      f.subject,
    );
    f.current.labels = [];
    await expect(f.authority.recheck(f.binding, f.subject)).rejects.toMatchObject({
      code: 'TRIGGER_LABEL_REMOVED',
    });
    expect(f.effects).toHaveLength(0);
    expect(
      f.commands.every((request) =>
        ['rev-parse', 'remote', 'ls-remote'].includes(String(request.args[7])),
      ),
    ).toBe(true);
  });
  it('refuses foreign kind/lineage and duplicate authenticated claims', async () => {
    const f = await fixture();
    const review = { ...f.binding, manifest: { ...f.binding.manifest, kind: 'review' as const } };
    await expect(f.authority.recheck(review, f.subject)).rejects.toMatchObject({
      code: 'TEMPLATE_AUTHORITY_UNAVAILABLE',
    });
    await expect(
      f.authority.recheck(f.binding, { ...f.subject, source: { kind: 'external' } }),
    ).rejects.toMatchObject({ code: 'TEMPLATE_AUTHORITY_REFUSED' });
    await f.claim();
    await f.claim();
    await expect(f.authority.recheck(f.binding, f.subject)).rejects.toMatchObject({
      code: 'AUTHORITY_CONFLICT',
    });
  });
  it('records a no-turn prerequisite explanation without labels and reconciles its marker', async () => {
    const f = await fixture();
    await f.runs.update(f.run.id, { status: 'running' });
    await f.reporter.report(f.binding, f.run, f.subject, 'TEMPLATE_PREREQUISITE_UNAVAILABLE');
    await new ImplementationReporter(f.instances, async () => f.deps).report(
      f.binding,
      f.run,
      f.subject,
      'TEMPLATE_PREREQUISITE_UNAVAILABLE',
    );
    expect(f.effects).toEqual(['post']);
    expect(f.comments[0]!.body).toContain('did not begin workflow execution');
    await expect(
      f.reporter.report(f.binding, f.run, f.subject, 'UNTRUSTED_TEXT'),
    ).rejects.toMatchObject({ code: 'TEMPLATE_REPORT_UNAVAILABLE' });
  });
  it('never advertises same-run retry/no effects after execution has started', async () => {
    const f = await fixture();
    await f.claim();
    await f.started();
    await f.reporter.report(f.binding, f.run, f.subject, 'TEMPLATE_PREREQUISITE_UNAVAILABLE');
    expect(f.comments[0]!.body).toContain('after workflow progress');
    expect(f.comments[0]!.body).not.toContain('did not begin');
    expect(f.comments[0]!.body).toContain('not eligible');
    expect(f.effects).toEqual(['post']);
  });
  it.each(['claim', 'progress', 'uncertain'] as const)(
    'finalizes cancelled %s attempt with one reconciled fixed report across restart',
    async (stage) => {
      const f = await fixture();
      if (stage === 'claim') await f.started('claim');
      else {
        await f.claim();
        await f.started();
        f.current.labels = [{ name: f.settings.labels.inProgress }];
      }
      if (stage === 'uncertain') {
        await f.intent();
        await f.started('pr-created');
        f.prs.splice(0);
      }
      await f.events.append(f.run.id, [{ type: 'run.cancelled' }]);
      const cancelled = await f.runs.update(f.run.id, { status: 'cancelled' });
      installImplementationFinalization(f.runs, f.reporter);
      await f.runs.markFinalized(cancelled.id);
      const restarted = new ImplementationReporter(f.instances, async () => f.deps);
      await restarted.terminal(cancelled);
      expect(f.comments).toHaveLength(1);
      if (stage === 'uncertain') {
        expect(f.comments[0]?.body).toContain('not established completion');
        expect(f.comments[0]?.body).not.toContain('No pull request');
      } else expect(f.comments[0]?.body).toContain('No pull request was created');
      expect(f.current.labels.some((label) => label.name === f.settings.labels.blocked)).toBe(true);
      expect(f.current.labels.some((label) => label.name === f.settings.labels.inProgress)).toBe(
        false,
      );
      expect((await f.runs.listUnfinalized()).some((row) => row.id === cancelled.id)).toBe(false);
    },
  );
  it('explains a progressed terminal failure and applies the blocked label without creating a PR', async () => {
    const f = await fixture();
    await f.claim();
    await f.started();
    const run = await f.failure();
    await f.reporter.terminal(run);
    await f.reporter.terminal(run);
    expect(f.comments).toHaveLength(1);
    expect(f.comments[0]!.body).toContain('No pull request was created');
    expect(f.effects).toEqual(['post', 'label', 'label']);
  });
  it('reconciles a cancelled attempt after remote PR creation and clears the in-progress label', async () => {
    const f = await fixture();
    await f.claim();
    await f.intent();
    await f.started('pr-created');
    f.current.labels = [{ name: f.settings.labels.inProgress }];
    await f.events.append(f.run.id, [{ type: 'run.cancelled' }]);
    const run = await f.runs.update(f.run.id, { status: 'cancelled' });
    await f.reporter.terminal(run);
    await f.reporter.terminal(run);
    expect(f.comments).toHaveLength(1);
    expect(f.comments[0]?.body).toContain('after pull request #7');
    expect(f.comments[0]?.body).not.toContain('No pull request');
    expect(f.current.labels.map((label) => label.name)).toEqual([f.settings.labels.prOpen]);
  });
  it('reconciles the remote PR from a stored intent when gh create response was lost', async () => {
    const f = await fixture();
    await f.claim();
    await f.started();
    await f.intent();
    const run = await f.failure();
    await f.reporter.terminal(run);
    expect(f.comments[0]!.body).toContain('after pull request #7');
    expect(f.comments[0]!.body).not.toContain('No pull request');
    expect(f.effects).toEqual(['post', 'label']);
  });
  it.each(['head', 'body', 'title', 'repo', 'duplicates'] as const)(
    'refuses conflicting remote completion %s rather than asserting no PR',
    async (field) => {
      const f = await fixture();
      await f.claim();
      await f.started();
      await f.intent();
      const run = await f.failure();
      if (field === 'head') f.prs[0]!.head.sha = 'd'.repeat(40);
      if (field === 'body') f.prs[0]!.body = 'Closes #99';
      if (field === 'title') f.prs[0]!.title = 'Other';
      if (field === 'repo') f.prs[0]!.base.repo.full_name = 'other/repo';
      if (field === 'duplicates') f.prs.push(structuredClone(f.prs[0]!));
      await expect(f.reporter.terminal(run)).rejects.toMatchObject({
        code: 'TEMPLATE_REPORT_UNAVAILABLE',
      });
      expect(f.effects).toHaveLength(0);
    },
  );
  it('leaves failed reports unfinalized for bounded reconciled recovery and finalizes only after success', async () => {
    const f = await fixture();
    await f.claim();
    await f.started();
    const run = await f.failure();
    installImplementationFinalization(f.runs, f.reporter);
    f.setPostError(true);
    await expect(f.runs.markFinalized(run.id)).rejects.toMatchObject({
      code: 'TEMPLATE_REPORT_UNAVAILABLE',
      message: 'The trusted terminal report could not be reconciled.',
    });
    expect((await f.runs.listUnfinalized()).some((row) => row.id === run.id)).toBe(true);
    f.setPostError(false);
    await f.runs.markFinalized(run.id);
    expect((await f.runs.listUnfinalized()).some((row) => row.id === run.id)).toBe(false);
    expect(f.comments).toHaveLength(1);
  });
  it('skips labels at a no-turn terminal failure and ignores nonterminal/non-template runs', async () => {
    const f = await fixture();
    await f.reporter.terminal(f.run);
    expect(f.effects).toHaveLength(0);
    const failed = await f.failure();
    await f.reporter.terminal(failed);
    expect(f.effects).toHaveLength(0);
    await f.reporter.terminal({
      ...failed,
      id: fakeUlid('unbound'),
      loopId: fakeUlid('unbound-loop'),
    });
    expect(f.effects).toHaveLength(0);
  });
  it('refuses wrong owner/source and bounded/colliding report history', async () => {
    const f = await fixture();
    await f.started();
    await expect(
      f.reporter.report(
        f.binding,
        f.run,
        { ...f.subject, issue: 9 },
        'TEMPLATE_PREREQUISITE_UNAVAILABLE',
      ),
    ).rejects.toMatchObject({ code: 'TEMPLATE_REPORT_UNAVAILABLE' });
    f.setComments(Array.from({ length: 100 }, () => ({ body: 'old' })));
    await expect(
      f.reporter.report(f.binding, f.run, f.subject, 'TEMPLATE_PREREQUISITE_UNAVAILABLE'),
    ).rejects.toMatchObject({ code: 'TEMPLATE_REPORT_UNAVAILABLE' });
    f.setComments([]);
    await f.reporter.report(f.binding, f.run, f.subject, 'TEMPLATE_PREREQUISITE_UNAVAILABLE');
    const comment = f.comments[0]!;
    f.setComments([comment, comment]);
    await expect(
      f.reporter.report(f.binding, f.run, f.subject, 'TEMPLATE_PREREQUISITE_UNAVAILABLE'),
    ).rejects.toMatchObject({ code: 'TEMPLATE_REPORT_UNAVAILABLE' });
  });
});

describe('paired immutable PR intent provenance', () => {
  it.each(['unpaired', 'kind', 'hash', 'slot', 'node', 'duplicate'] as const)(
    'refuses %s intent history before remote reconciliation',
    async (caseName) => {
      const f = await fixture();
      await f.intent();
      const events = checkedEvents(await f.store.events(f.run.id));
      const start = events.find(
        (event) => event.type === 'node.started' && event.nodeId === 'pr-intent',
      );
      const finish = events.find(
        (event) => event.type === 'node.finished' && event.nodeId === 'pr-intent',
      );
      if (start?.type !== 'node.started' || finish?.type !== 'node.finished')
        throw new Error('intent fixture');
      if (caseName === 'unpaired') events.splice(events.indexOf(start), 1);
      if (caseName === 'kind') start.kind = 'inference';
      if (caseName === 'hash') start.configHash = 'model-authored-hash';
      if (caseName === 'slot') finish.patch = [];
      if (caseName === 'node')
        finish.patch = [
          {
            op: 'add',
            path: '/outputs/pr-intent',
            value: {
              nodeId: 'planner',
              at: FIXTURE_TS,
              value: {
                type: 'PrIntent',
                head: 'b'.repeat(40),
                branch: 'graphgoblin/issue-42-attempt-1',
                title: 'Implement',
                body: 'Closes #42',
              },
            },
          },
        ];
      if (caseName === 'duplicate')
        events.push({ ...start, seq: finish.seq + 1 }, { ...finish, seq: finish.seq + 2 });
      expect(() =>
        readImplementationIntent(f.binding, f.parent.loopId, f.parent.definition, events),
      ).toThrow();
      expect(f.effects).toEqual([]);
    },
  );
  it.each([
    null,
    [],
    'model text',
    {},
    { type: 'PrIntent', head: 'not-a-sha' },
    { type: 'PrIntent', authority: true },
  ])('refuses malformed intent %j', async (value) => {
    const f = await fixture();
    await f.intent();
    const events = checkedEvents(await f.store.events(f.run.id));
    const finish = events.find(
      (event) => event.type === 'node.finished' && event.nodeId === 'pr-intent',
    );
    if (finish?.type !== 'node.finished') throw new Error('intent fixture');
    finish.patch = [
      {
        op: 'replace',
        path: '/outputs/pr-intent',
        value: { nodeId: 'pr-intent', at: FIXTURE_TS, value },
      },
    ];
    expect(() =>
      readImplementationIntent(f.binding, f.parent.loopId, f.parent.definition, events),
    ).toThrow();
    expect(f.effects).toEqual([]);
  });
  it('retains a refused intent as no remote-effect authority and ignores ordinary support outputs', async () => {
    const f = await fixture();
    await f.intent();
    const events = checkedEvents(await f.store.events(f.run.id));
    const finish = events.find(
      (event) => event.type === 'node.finished' && event.nodeId === 'pr-intent',
    );
    if (finish?.type !== 'node.finished') throw new Error('intent fixture');
    finish.patch = [
      {
        op: 'add',
        path: '/outputs/pr-intent',
        value: {
          nodeId: 'pr-intent',
          at: FIXTURE_TS,
          value: {
            type: 'SupportBlocked',
            code: 'PR_CLOSING_LINK_REFUSED',
            message: 'Support stopped safely; inspect the recorded support code.',
          },
        },
      },
    ];
    expect(
      readImplementationIntent(f.binding, f.parent.loopId, f.parent.definition, events),
    ).toBeUndefined();
    const start = events.find(
      (event) => event.type === 'node.started' && event.nodeId === 'pr-intent',
    );
    if (start?.type !== 'node.started') throw new Error('intent fixture');
    start.nodeId = 'prepare';
    finish.nodeId = 'prepare';
    expect(
      readImplementationIntent(f.binding, f.parent.loopId, f.parent.definition, events),
    ).toBeUndefined();
  });
  it('refuses foreign poll selectors and unavailable authority without side effects', async () => {
    const f = await fixture();
    expect(await f.authority.resolve(f.binding, { issue: 42 })).toMatchObject({ issue: 42 });
    await expect(
      f.authority.resolve(f.binding, { id: 'foreign/repo#42@1', payload: { issue: 42 } }),
    ).rejects.toMatchObject({ code: 'TEMPLATE_AUTHORITY_REFUSED' });
    await expect(
      f.authority.resolve(
        { ...f.binding, manifest: { ...f.binding.manifest, kind: 'review' } },
        { issue: 42 },
      ),
    ).rejects.toMatchObject({ code: 'TEMPLATE_AUTHORITY_UNAVAILABLE' });
    f.setAuthError(true);
    await expect(f.authority.resolve(f.binding, { issue: 42 })).rejects.toMatchObject({
      code: 'TEMPLATE_AUTHORITY_REFUSED',
      message: 'Implementation repository discovery is unavailable.',
    });
    expect(f.effects).toEqual([]);
  });
  it('redacts failed prerequisite reporting and never claims a success', async () => {
    const f = await fixture();
    f.setPostError(true);
    await expect(
      f.reporter.report(f.binding, f.run, f.subject, 'TEMPLATE_PREREQUISITE_UNAVAILABLE'),
    ).rejects.toMatchObject({
      code: 'TEMPLATE_REPORT_UNAVAILABLE',
      message: 'The trusted prerequisite report could not be reconciled.',
    });
    expect(f.comments).toEqual([]);
    expect(f.effects).toEqual([]);
  });
});

describe('private execution snapshot', () => {
  async function privateFixture() {
    const f = await fixture(),
      apiKeys = new SqliteApiKeys(f.handle.db, f.clock, f.ids);
    const key = await apiKeys.create('local', 'private support', ['runs:read']);
    const secrets = new InMemorySecrets({ 'support-reader': key.token }),
      requests: ScriptRunRequest[] = [];
    const catalog = new TemplateCatalog('.', '.');
    catalog.get = async () => ({
      bundle: { manifest: f.binding.manifest, loops: {} },
      support: f.binding.support!,
    });
    let useController = false;
    const textFiles = new Map<string, string>();
    const wireOutputs: string[] = [];
    const raw = {
      run: async (request: ScriptRunRequest) => {
        requests.push(request);
        const stdout = useController
          ? JSON.stringify(
              await new ImplementationSupport(f.deps).execute(
                request.args.at(-1),
                JSON.parse(request.stdin!),
              ),
            ) + '\n'
          : '{}';
        wireOutputs.push(stdout);
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
    const scripts = new PrivateTemplateScripts({
      instances: { store: f.store, catalog },
      raw,
      apiKeys,
      secretsFor: () => secrets,
      environment: {
        PATH: 'safe',
        GH_TOKEN: 'absent',
        GG_API_KEY: key.token,
        SSH_AUTH_SOCK: '/inert/agent',
        DBUS_SESSION_BUS_ADDRESS: 'unix:path=/inert/bus',
        XDG_RUNTIME_DIR: '/inert/runtime',
        XDG_CONFIG_HOME: '/inert/config',
        GH_CONFIG_DIR: '/inert/gh',
      },
    });
    async function request(nodeId = 'prepare', startedSeq?: number) {
      const seq = startedSeq ?? (await f.started(nodeId));
      await f.runs.update(f.run.id, { status: 'running', currentNodeId: nodeId });
      return {
        command: 'graphgoblin-template-support',
        args: [nodeId],
        cwd: '.',
        env: {},
        stdin: JSON.stringify(f.thread),
        signal: new AbortController().signal,
        executionIdentity: {
          kind: 'node' as const,
          ownerId: 'local',
          loopId: f.run.loopId,
          versionId: f.run.versionId,
          nodeId,
          runId: f.run.id,
          startedSeq: seq,
        },
      };
    }
    return {
      ...f,
      scripts,
      requests,
      wireOutputs,
      request,
      catalog,
      secrets,
      key,
      controller: () => {
        useController = true;
        f.deps.storage.text = async (_root, path, text) => {
          textFiles.set(path, text);
        };
        f.deps.github.comment = async (repo, issue, path) =>
          f.deps.github.post(repo, issue, textFiles.get(path)!);
      },
    };
  }
  it('accepts exact delimiter-inclusive private transport boundary and refuses one-byte overflow before effects', async () => {
    const f = await privateFixture();
    f.controller();
    await f.claim();
    let low = 1,
      high = 65536;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      try {
        assertIssueOutput(f.settings, { ...f.current, body: 'x'.repeat(middle) });
        low = middle;
      } catch {
        high = middle - 1;
      }
    }
    f.current.body = 'x'.repeat(low + 1);
    const refused = await f.scripts.run(await f.request('prepare'));
    expect(JSON.parse(refused.stdout)).toMatchObject({ code: 'SUPPORT_OUTPUT_TOO_LARGE' });
    expect(f.effects).toEqual([]);
    expect(f.getState()).toBeUndefined();
    f.current.body = 'x'.repeat(low);
    const accepted = await f.scripts.run(await f.request('prepare'));
    expect(JSON.parse(accepted.stdout)).toMatchObject({
      type: 'ImplementationWorkspace',
      body: f.current.body,
    });
    expect(Buffer.byteLength(f.wireOutputs.at(-1)!)).toBe(65536);
    expect(f.wireOutputs.at(-1)!.endsWith('\n')).toBe(true);
    expect(Buffer.byteLength(accepted.stdout)).toBe(65535);
    expect(f.effects).toContain('label');
  });
  it('keeps an actual private claim refusal readable, finalizable and pollable without inventing a claim', async () => {
    const f = await privateFixture();
    f.controller();
    f.setAuthError(true);
    const request = await f.request('claim'),
      result = await f.scripts.run(request);
    const value = JsonValueSchema.parse(JSON.parse(result.stdout));
    expect(value).toMatchObject({ type: 'SupportBlocked' });
    await f.events.append(f.run.id, [
      {
        type: 'node.finished',
        nodeId: 'claim',
        durationMs: 0,
        patch: [
          { op: 'add', path: '/outputs/claim', value: { nodeId: 'claim', at: FIXTURE_TS, value } },
        ],
      },
    ]);
    expect((await readAuthority(f.store, f.binding, f.run.id)).facts).toEqual([]);
    f.setAuthError(false);
    await expect(f.scripts.run(await f.request('prepare'))).rejects.toMatchObject({
      code: 'TEMPLATE_AUTHORITY_REFUSED',
    });
    const run = await f.failure();
    installImplementationFinalization(f.runs, f.reporter);
    await f.runs.markFinalized(run.id);
    await f.runs.markFinalized(run.id);
    expect((await f.runs.listUnfinalized()).some((row) => row.id === run.id)).toBe(false);
    expect(f.comments).toHaveLength(1);
    expect(
      await implementationPollKeys(f.store, f.binding, {
        items: [{ id: 42, payload: { issue: 42 } }],
      }),
    ).toEqual({
      items: [{ id: 'example/repo#42@1', payload: { issue: 42 } }],
    });
    expect(
      await f.store.subjectRuns({
        ownerId: 'local',
        repository: 'example/repo',
        issue: 42,
        limit: 65,
      }),
    ).toHaveLength(1);
  });
  it('allows the real private pr-created refusal to reach block, reconcile its existing remote PR, report and poll', async () => {
    const f = await privateFixture();
    f.controller();
    await f.claim();
    await f.intent();
    const state = f.getState()!;
    state.cwd = new ImplementationRepository(
      f.settings,
      f.deps.commands,
      f.deps.storage,
      f.deps.git,
    ).workspace(f.run.id);
    state.gate = {
      calls: 1,
      passed: true,
      head: state.intent!.head,
      summary: 'Exact-head gates passed.',
    };
    f.setState(state);
    f.current.labels = [{ name: f.settings.labels.inProgress }];
    const result = await f.scripts.run(await f.request('pr-created')),
      value = JsonValueSchema.parse(JSON.parse(result.stdout));
    expect(value).toMatchObject({ type: 'SupportBlocked', code: 'REMOTE_HEAD_CHANGED' });
    await f.events.append(f.run.id, [
      {
        type: 'node.finished',
        nodeId: 'pr-created',
        durationMs: 0,
        patch: [
          {
            op: 'add',
            path: '/outputs/pr-created',
            value: { nodeId: 'pr-created', at: FIXTURE_TS, value },
          },
        ],
      },
    ]);
    expect(
      (await readAuthority(f.store, f.binding, f.run.id)).facts.map((fact) => fact.type),
    ).toEqual(['ClaimRecord']);
    const blockedResult = await f.scripts.run(await f.request('block'));
    expect(JSON.parse(blockedResult.stdout)).toMatchObject({
      type: 'ImplementationBlocked',
      code: 'PR_COMPLETION_UNCERTAIN',
    });
    const run = await f.failure();
    await f.reporter.terminal(run);
    await f.reporter.terminal(run);
    expect(f.comments.every((row) => !row.body.includes('No pull request'))).toBe(true);
    expect(f.comments.some((row) => row.body.includes('pull request #7'))).toBe(true);
    await expect(
      implementationPollKeys(f.store, f.binding, { items: [{ id: 42, payload: { issue: 42 } }] }),
    ).resolves.toMatchObject({ items: [{ id: 'example/repo#42@1' }] });
  });
  it.each([
    { type: 'SupportBlocked', code: 'GITHUB_UNAVAILABLE', message: 'forged' },
    { ...blocked('GITHUB_UNAVAILABLE'), attempt: 3 },
    {
      type: 'SupportBlocked',
      code: 'bad-code',
      message: 'Support stopped safely; inspect the recorded support code.',
    },
    {
      type: 'PrCreated',
      repository: 'example/repo',
      issue: 99,
      attempt: 1,
      pullRequest: 7,
      head: 'a'.repeat(40),
    },
  ])('rejects malformed or forged authority-action output %j', async (value) => {
    const f = await privateFixture();
    await f.started('claim');
    await f.events.append(f.run.id, [
      {
        type: 'node.finished',
        nodeId: 'claim',
        durationMs: 0,
        patch: [
          { op: 'add', path: '/outputs/claim', value: { nodeId: 'claim', at: FIXTURE_TS, value } },
        ],
      },
    ]);
    await expect(readAuthority(f.store, f.binding, f.run.id)).rejects.toMatchObject({
      code: 'AUTHORITY_CONFLICT',
    });
  });
  it('preserves only bounded credential location context in private stdin process environment, never the bearer', async () => {
    const f = await privateFixture();
    await f.claim();
    // The normal request environment remains empty; private composition owns location context.
    const request = await f.request('prepare');
    await f.scripts.run(request);
    expect(f.requests[0]!.env).toEqual({
      PATH: 'safe',
      SSH_AUTH_SOCK: '/inert/agent',
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/inert/bus',
      XDG_RUNTIME_DIR: '/inert/runtime',
      XDG_CONFIG_HOME: '/inert/config',
      GH_CONFIG_DIR: '/inert/gh',
    });
    expect(f.requests[0]!.env).not.toHaveProperty('GH_TOKEN');
    expect(JSON.stringify({ ...f.requests[0], stdin: undefined })).not.toContain(f.key.token);
  });
  it('supplies original unfinished visit, immutable subject and authenticated claim rather than thread claims', async () => {
    const f = await privateFixture();
    await f.claim();
    const visit = await f.started('prepare'),
      latest = await f.started('prepare', 2);
    f.thread.vars['subject'] = { issue: 99, attempt: 3 };
    f.thread.vars['claim'] = { issue: 99 };
    const request = await f.request('prepare', latest);
    expect(await f.scripts.run(request)).toMatchObject({ exitCode: 0 });
    const envelope = SupportEnvelopeSchema.parse(JSON.parse(f.requests[0]!.stdin!));
    expect(envelope.visit).toBe(visit);
    expect(envelope.identity).toMatchObject({ startedSeq: latest });
    expect(envelope.subject).toMatchObject({ issue: 42, attempt: 1 });
    expect(envelope.claim).toEqual({
      type: 'ClaimRecord',
      repository: 'example/repo',
      issue: 42,
      attempt: 1,
    });
    expect(JSON.stringify({ ...f.requests[0], stdin: undefined })).not.toContain(f.key.token);
    expect(JSON.stringify(f.thread)).not.toContain(f.key.token);
  });
  it('permits the exact claim action before a claim fact and refuses later actions without one', async () => {
    const f = await privateFixture();
    await f.scripts.run(await f.request('claim'));
    expect(SupportEnvelopeSchema.parse(JSON.parse(f.requests[0]!.stdin!)).claim).toBeNull();
    await expect(f.scripts.run(await f.request('prepare'))).rejects.toMatchObject({
      code: 'TEMPLATE_AUTHORITY_REFUSED',
    });
    expect(f.requests).toHaveLength(1);
  });
  it('rejects changed support closure before launching and a duplicate authenticated claim', async () => {
    const f = await privateFixture();
    await f.claim();
    f.catalog.get = async () => ({
      bundle: { manifest: f.binding.manifest, loops: {} },
      support: { path: f.binding.support!.path, hash: 'changed-delegate' },
    });
    await expect(f.scripts.run(await f.request())).rejects.toMatchObject({
      code: 'TEMPLATE_AUTHORITY_REFUSED',
    });
    expect(f.requests).toHaveLength(0);
    f.catalog.get = async () => ({
      bundle: { manifest: f.binding.manifest, loops: {} },
      support: f.binding.support!,
    });
    await f.claim();
    await expect(f.scripts.run(await f.request())).rejects.toMatchObject({
      code: 'TEMPLATE_AUTHORITY_REFUSED',
    });
    expect(f.requests).toHaveLength(0);
  });
});

describe('implementation attempt-aware PollTriggers admission', () => {
  async function pollFixture() {
    const f = await fixture(false),
      apiKeys = new SqliteApiKeys(f.handle.db, f.clock, f.ids);
    const key = await apiKeys.create('local', 'private support', ['runs:read']);
    const secrets = new InMemorySecrets({ 'support-reader': key.token }),
      catalog = new TemplateCatalog('.', '.');
    catalog.get = async () => ({
      bundle: { manifest: f.binding.manifest, loops: {} },
      support: f.binding.support!,
    });
    const raw = {
      run: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({ items: [{ id: 42, payload: { issue: 42 } }] }),
        stderr: '',
        timedOut: false,
        stdoutOverflow: false,
        stderrOverflow: false,
      }),
    };
    const scripts = new PrivateTemplateScripts({
      instances: { store: f.store, catalog },
      raw,
      apiKeys,
      secretsFor: () => secrets,
      environment: {},
    });
    const prerequisites = new TemplatePrerequisites({
      catalog: new FakeModelCatalog(),
      harnesses: {},
      scripts: raw,
      apiKeys,
      secretsFor: () => secrets,
      supportAvailable: async () => true,
    });
    const instances = new TemplateInstances(catalog, prerequisites, f.store, f.ids, f.clock);
    const loops = new SqliteLoopRepository(f.handle.db, f.clock, f.ids);
    const published = await loops.publish(f.parent.loopId),
      record = await loops.getLoop(f.parent.loopId);
    if (!published || !record) throw new Error('fixture publish');
    const version = published,
      loop = record;
    let runtime = new TemplateRuntime(instances, f.authority),
      requests = 0;
    async function start(input: StartRunInput) {
      requests++;
      const run: RunRecord = {
        ...f.run,
        id: f.ids.next(),
        invocationId: f.ids.next(),
        createdAt: f.clock.now().toISOString(),
      };
      const thread = createInitialThread({
        runId: run.id,
        loopId: run.loopId,
        versionId: run.versionId,
        invocation: {
          id: run.invocationId,
          source: 'poll',
          caller: input.caller,
          trigger: {
            nodeId: input.triggerNodeId!,
            kind: 'poll',
            payload: input.payload ?? null,
            dedupeKey: input.dedupeKey!,
            receivedAt: f.clock.now().toISOString(),
          },
        },
      });
      const admission = templateAdmission(
        new SqliteTriggerAdmission(f.handle.db, f.events, (store, intent, poll) =>
          runtime.afterRunStaged(store, intent, poll),
        ),
        runtime,
      );
      return admission.createPollItem({
        run,
        initialThread: thread,
        queued: {
          type: 'run.queued',
          initialThread: thread,
          subloopVersions: Object.fromEntries(
            f.binding.loops
              .filter((row) => row.key !== 'parent')
              .map((row) => [row.loopId, row.versionId]),
          ),
        },
        pinnedLoopIds: f.binding.loops.map((row) => row.loopId),
      });
    }
    const logger = new CapturingLogger();
    const buildPoll = () => {
      const poll = new PollTriggers({
        scripts,
        probes: { fetch: () => Promise.reject(new Error('no HTTP probes')) },
        manager: { startPollItem: start, startRun: () => Promise.reject(new Error('items only')) },
        hasDedupe: (loop, node, key) => f.runs.hasTriggerDedupe(loop, node, key),
        findSeen: (loop, node, keys) => f.runs.findTriggerDedupeKeys(loop, node, keys),
        clock: f.clock,
        logger,
        scriptCwd: '.',
      });
      poll.arm(loop, version);
      return poll;
    };
    let poll = buildPoll();
    async function tick() {
      f.clock.advance(61000);
      return poll.poll();
    }
    function restart() {
      poll.stop();
      runtime = new TemplateRuntime(
        instances,
        new ImplementationAuthority(f.instances, async () => f.deps),
      );
      poll = buildPoll();
    }
    async function fact(run: RunRecord, nodeId: string, value: JsonValue, wrong = false) {
      const node = version.definition.nodes.find((node) => node.id === nodeId)!;
      await f.events.append(run.id, [
        {
          type: 'node.started',
          nodeId,
          kind: 'script',
          attempt: 1,
          configHash: wrong ? 'wrong' : stableHash(node.config),
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
    async function rework(first: RunRecord, forged = false) {
      await fact(first, 'claim', {
        type: 'ClaimRecord',
        repository: 'example/repo',
        issue: 42,
        attempt: 1,
      });
      await fact(first, 'pr-created', {
        type: 'PrCreated',
        repository: 'example/repo',
        issue: 42,
        attempt: 1,
        pullRequest: 7,
        head: 'b'.repeat(40),
      });
      await f.runs.update(first.id, { status: 'succeeded', outcome: 'success' });
      const sourceNodes = version.definition.nodes;
      const reworkNode = sourceNodes.find((node) => node.id === 'pr-created')!;
      if (reworkNode.kind !== 'script') throw new Error('fixture support node');
      const qaDefinition = LoopDefinitionSchema.parse({
        ...version.definition,
        name: 'Synthetic authenticated QA',
        settings: { workingDirectory: { kind: 'temp' } },
        nodes: [
          { ...sourceNodes.find((node) => node.id === 'start')!, config: { subtype: 'manual' } },
          sourceNodes.find((node) => node.id === 'settings')!,
          { ...sourceNodes.find((node) => node.id === 'planner')!, id: 'qa' },
          { ...sourceNodes.find((node) => node.id === 'planner')!, id: 'adversary' },
          { ...reworkNode, id: 'qa-rework', config: { ...reworkNode.config, args: ['qa-rework'] } },
          { id: 'done', kind: 'exit', label: 'Done', config: { criteria: [], default: 'success' } },
        ],
        edges: [
          {
            id: 'qa-start',
            from: { node: 'start', port: 'out' },
            to: { node: 'settings', port: 'in' },
          },
          {
            id: 'qa-setting',
            from: { node: 'settings', port: 'out' },
            to: { node: 'qa', port: 'in' },
          },
          {
            id: 'qa-role',
            from: { node: 'qa', port: 'out' },
            to: { node: 'adversary', port: 'in' },
          },
          {
            id: 'qa-adversary',
            from: { node: 'adversary', port: 'out' },
            to: { node: 'qa-rework', port: 'in' },
          },
          {
            id: 'qa-done',
            from: { node: 'qa-rework', port: 'out' },
            to: { node: 'done', port: 'in' },
          },
        ],
      });
      const manifest = TemplateManifestSchema.parse({
        ...f.binding.manifest,
        id: 'synthetic-qa',
        kind: 'qa',
        roles: [
          { id: 'qa', label: 'QA', access: 'read-only' },
          { id: 'adversary', label: 'Adversary', access: 'read-only' },
        ],
        prerequisites: [],
        loops: [
          {
            key: 'parent',
            file: 'parent.json',
            settingsNodes: ['settings'],
            roleNodes: [
              { role: 'qa', nodeId: 'qa' },
              { role: 'adversary', nodeId: 'adversary' },
            ],
          },
        ],
      });
      const role = f.settings.roles.implementer;
      const settings = QaTemplateSettingsSchema.parse({
        kind: 'qa',
        repository: f.settings.repository,
        supportReadKey: f.settings.supportReadKey,
        roles: { qa: role, adversary: role },
      });
      const prepared = prepareTemplateBundle(
        { manifest, loops: { parent: qaDefinition } },
        settings,
        {
          parent: {
            loopId: f.ids.next(),
            versionId: f.ids.next(),
            version: 1,
            name: 'Synthetic QA',
          },
        },
      );
      const qaParent = prepared.loops[0]!;
      const instance = TemplateInstanceSchema.parse({
        id: f.ids.next(),
        ownerId: 'local',
        templateId: manifest.id,
        templateVersion: manifest.version,
        createdAt: FIXTURE_TS,
        parentLoopId: qaParent.loopId,
        settings,
        loops: [
          {
            key: 'parent',
            loopId: qaParent.loopId,
            versionId: qaParent.versionId,
            version: 1,
            status: 'draft',
          },
        ],
      });
      const binding = TemplateBindingSchema.parse({
        instanceId: instance.id,
        ownerId: 'local',
        manifest,
        settings,
        support: f.binding.support,
        loops: [
          {
            key: 'parent',
            loopId: qaParent.loopId,
            versionId: qaParent.versionId,
            hash: executionHash(qaParent.definition),
            nodes: Object.fromEntries(
              qaParent.definition.nodes.map((node) => [
                node.id,
                { kind: node.kind, configHash: stableHash(node.config) },
              ]),
            ),
          },
        ],
      });
      await f.store.create(instance, bindingJson(binding), prepared.loops);
      const run: RunRecord = {
        ...first,
        id: f.ids.next(),
        loopId: qaParent.loopId,
        versionId: qaParent.versionId,
        invocationId: f.ids.next(),
        status: 'queued',
        lastEventSeq: 0,
      };
      const thread = createInitialThread({
        runId: run.id,
        loopId: run.loopId,
        versionId: run.versionId,
        invocation: {
          id: run.invocationId,
          source: 'manual.api',
          trigger: { nodeId: 'start', kind: 'manual', payload: {}, receivedAt: FIXTURE_TS },
        },
      });
      await new SqliteTriggerAdmission(f.handle.db, f.events).create({
        run,
        initialThread: thread,
        queued: { type: 'run.queued', initialThread: thread },
        pinnedLoopIds: [run.loopId],
      });
      await f.store.setSubject(
        run.id,
        subjectJson({
          ...f.subject,
          kind: 'qa',
          instanceId: instance.id,
          pullRequest: 7,
          mergeSha: 'c'.repeat(40),
          source: { kind: 'implementation', runId: first.id },
        }),
      );
      const node = qaParent.definition.nodes.find((node) => node.id === 'qa-rework')!;
      await f.events.append(run.id, [
        {
          type: 'node.started',
          nodeId: 'qa-rework',
          kind: 'script',
          attempt: 1,
          configHash: forged ? 'forged-thread-output' : stableHash(node.config),
        },
        {
          type: 'node.finished',
          nodeId: 'qa-rework',
          durationMs: 0,
          patch: [
            {
              op: 'add',
              path: '/outputs/qa-rework',
              value: {
                nodeId: 'qa-rework',
                at: FIXTURE_TS,
                value: {
                  type: 'ReworkRequest',
                  repository: 'example/repo',
                  issue: 42,
                  attempt: 1,
                  pullRequest: 7,
                  mergeSha: 'c'.repeat(40),
                  request: 1,
                },
              },
            },
          ],
        },
      ]);
      await f.runs.update(run.id, { status: 'succeeded', outcome: 'success' });
    }
    return {
      ...f,
      tick,
      restart,
      rework,
      start,
      logger,
      get requests() {
        return requests;
      },
    };
  }
  it('a persisted refused claim never poisons the real private poll path or grants a new attempt after restart', async () => {
    const f = await pollFixture(),
      first = (await f.tick())[0]!;
    const node = f.parent.definition.nodes.find((node) => node.id === 'claim')!;
    await f.events.append(first.id, [
      {
        type: 'node.started',
        nodeId: 'claim',
        kind: 'script',
        attempt: 1,
        configHash: stableHash(node.config),
      },
      {
        type: 'node.finished',
        nodeId: 'claim',
        durationMs: 0,
        patch: [
          {
            op: 'add',
            path: '/outputs/claim',
            value: { nodeId: 'claim', at: FIXTURE_TS, value: blocked('GITHUB_UNAVAILABLE') },
          },
        ],
      },
    ]);
    await f.runs.update(first.id, {
      status: 'failed',
      failure: { code: 'TEMPLATE_AUTHORITY_REFUSED', message: 'fixed', resumable: false },
    });
    f.restart();
    expect(await f.tick()).toEqual([]);
    expect(await f.tick()).toEqual([]);
    expect(f.requests).toBe(1);
    expect(f.logger.lines).toEqual([]);
    expect(f.effects).toEqual([]);
    expect(
      (
        await f.store.subjectRuns({
          ownerId: 'local',
          repository: 'example/repo',
          issue: 42,
          limit: 65,
        })
      ).filter(
        (row) =>
          row.subject &&
          typeof row.subject === 'object' &&
          !Array.isArray(row.subject) &&
          row.subject['kind'] === 'implementation',
      ),
    ).toHaveLength(1);
  });
  it('admits authenticated QA attempt two after restart, while relabels and duplicate keys stay consumed', async () => {
    const f = await pollFixture();
    const first = (await f.tick())[0]!;
    expect(first).toBeDefined();
    expect((await f.runs.getInitialThread(first.id))?.invocation.trigger.dedupeKey).toBe(
      'example/repo#42@1',
    );
    expect(await f.tick()).toEqual([]);
    expect(f.requests).toBe(1);
    f.current.labels = [{ name: f.settings.labels.trigger }];
    f.restart();
    expect(await f.tick()).toEqual([]);
    expect(f.requests).toBe(1);
    await f.rework(first);
    f.restart();
    const second = (await f.tick())[0]!;
    expect(second).toBeDefined();
    expect((await f.store.run(second.id))?.subject).toMatchObject({
      kind: 'implementation',
      attempt: 2,
      source: { runId: second.id },
    });
    expect((await f.runs.getInitialThread(second.id))?.invocation.trigger.dedupeKey).toBe(
      'example/repo#42@2',
    );
    expect(await f.tick()).toEqual([]);
    expect(f.requests).toBe(2);
    expect(f.logger.lines).toEqual([]);
    expect(f.effects).toEqual([]);
  });
  it('does not advance from forged rework and rolls back a caller-forged attempt key', async () => {
    const f = await pollFixture();
    const first = (await f.tick())[0]!;
    await f.rework(first, true);
    f.restart();
    expect(await f.tick()).toEqual([]);
    expect(f.requests).toBe(1);
    await expect(
      f.start({
        ownerId: 'local',
        loopId: f.parent.loopId,
        versionId: f.parent.versionId,
        triggerNodeId: 'start',
        triggerKind: 'poll',
        source: 'poll',
        caller: { kind: 'system', id: 'synthetic' },
        dedupeKey: 'example/repo#42@2',
        payload: { id: 'example/repo#42@2', payload: { issue: 42 } },
      }),
    ).rejects.toMatchObject({ code: 'TEMPLATE_AUTHORITY_REFUSED' });
    expect(await f.runs.hasTriggerDedupe(f.parent.loopId, 'start', 'example/repo#42@2')).toBe(
      false,
    );
    expect(
      (
        await f.store.subjectRuns({
          ownerId: 'local',
          repository: 'example/repo',
          issue: 42,
          limit: 65,
        })
      ).filter(
        (row) =>
          row.subject &&
          typeof row.subject === 'object' &&
          !Array.isArray(row.subject) &&
          row.subject['kind'] === 'implementation',
      ),
    ).toHaveLength(1);
    expect(f.effects).toEqual([]);
  });
});

import { afterEach, expect, it, vi } from 'vitest';
import { writeFile, lstat, mkdtemp, rm, readFile, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { DeletionPreview, RunRecord, StorageStatus } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { singleNodeLoop, FakeClock, CapturingLogger } from '@graphgoblin/engine/testing';
import { HistoryCleanup } from './history-cleanup.js';
import { buildApp } from './app.js';
import { freePort } from './testing/api-subprocess.js';
import { createTestApp, type TestApp } from './testing/test-app.js';

let app: TestApp | undefined;
const extraDirectories: string[] = [];
afterEach(async () => {
  await app?.close();
  app = undefined;
  globalThis.gc?.();
  for (const path of extraDirectories.splice(0))
    await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  vi.useRealTimers();
});

it('exposes measured storage state without granting deletion consent', async () => {
  app = await createTestApp({ tempPrefix: 'gg-wp-e3-' });
  const response = await app.app.inject('/system/storage');
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ state: 'adequate', deletedRuns: 0, removedFileBytes: 0 });
});

it('timestamps an unavailable capacity attempt and clears the preceding volumes', async () => {
  let unavailable = false;
  app = await createTestApp({
    tempPrefix: 'gg-wp-e3-',
    storageCapacity: {
      read: () =>
        unavailable
          ? Promise.reject(new Error('unavailable'))
          : Promise.resolve({ totalBytes: 100 * 1024 ** 3, availableBytes: 50 * 1024 ** 3 }),
    },
  });
  expect(app.container.historyCleanup.status().volumes).not.toHaveLength(0);
  app.clock.advance(60_000);
  unavailable = true;
  await app.container.historyCleanup.poll();
  expect(app.container.historyCleanup.status()).toMatchObject({
    state: 'unavailable',
    checkedAt: app.clock.now().toISOString(),
    volumes: [],
  });
});

it('returns from startup measurement before background reclamation finishes', async () => {
  let release!: () => void;
  const blocked = new Promise<number>((resolve) => {
    release = () => resolve(0);
  });
  const cleanup = new HistoryCleanup(
    { read: () => Promise.resolve({ totalBytes: 100 * 1024 ** 3, availableBytes: 0 }) },
    {
      prepareBatch: () => blocked,
      reapBatch: () => Promise.resolve({ bytes: 0, pending: 0, preserved: 0, remaining: false }),
      reusableBytes: () => Promise.resolve(0),
      hasApprovedCandidates: () => Promise.resolve(false),
      pendingResources: () => Promise.resolve(0),
    },
    [{ name: 'data', path: 'unused' }],
    new FakeClock(),
    new CapturingLogger(),
  );
  let returned = false;
  const starting = cleanup.start(false).then(() => {
    returned = true;
  });
  try {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(returned).toBe(true);
  } finally {
    release();
    await starting;
    await cleanup.stop();
  }
});

it('requires system read permission to observe storage and exposes no deletion command', async () => {
  app = await createTestApp({ tempPrefix: 'gg-wp-e3-', requireApiKey: true });
  const reader = await app.container.repos.apiKeys.create('local', 'storage reader', [
    'system:read',
  ]);
  const runsOnly = await app.container.repos.apiKeys.create('local', 'runs reader', ['runs:read']);
  expect((await app.app.inject('/system/storage')).statusCode).toBe(401);
  expect(
    (
      await app.app.inject({
        url: '/system/storage',
        headers: { authorization: `Bearer ${runsOnly.token}` },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.app.inject({
        url: '/system/storage',
        headers: { authorization: `Bearer ${reader.token}` },
      })
    ).statusCode,
  ).toBe(200);
});

const GiB = 1024 ** 3;
async function controlled(free = 50 * GiB) {
  let available = free;
  const read = vi.fn(() => Promise.resolve({ totalBytes: 100 * GiB, availableBytes: available }));
  app = await createTestApp({ tempPrefix: 'gg-wp-e3-', storageCapacity: { read } });
  const current = app;
  return {
    api: current,
    read,
    poll: async (bytes: number, ms = 60_000) => {
      available = bytes;
      current.clock.advance(ms);
      await current.container.historyCleanup.poll();
    },
  };
}
async function complete(t: TestApp, artifact = false) {
  const definition = artifact
    ? singleNodeLoop('Owned outputs', {
        id: 'infer',
        kind: 'inference',
        label: 'Infer',
        config: { prompt: { template: 'Hello' }, output: { captureTranscript: 'artifact' } },
      })
    : minimalLoop();
  const loop = await t.publishLoop(definition);
  const started = await t.app.inject({ method: 'POST', url: `/loops/${loop}/runs`, payload: {} });
  expect(started.statusCode).toBe(202);
  const run = started.json<{ run: RunRecord }>().run;
  await t.idle();
  return run;
}
async function mark(t: TestApp, runIds: string[]) {
  const preview = await t.app.inject({
    method: 'POST',
    url: '/runs/deletion-eligibility/preview',
    payload: { runIds },
  });
  const result = await t.app.inject({
    method: 'POST',
    url: '/runs/deletion-eligibility',
    payload: {
      runIds,
      action: 'mark',
      confirmed: true,
      token: preview.json<DeletionPreview>().token,
    },
  });
  expect(result.statusCode).toBe(200);
}

it('leaves approvals and files alone with adequate storage, measures at most once per minute and uses hysteresis', async () => {
  const { api, poll, read } = await controlled();
  const run = await complete(api);
  await mark(api, [run.id]);
  await poll(50 * GiB);
  expect((await api.container.repos.runs.get(run.id))?.deletionApproval).toBeDefined();
  const calls = read.mock.calls.length;
  for (let i = 0; i < 5; i++) await api.app.inject('/system/storage');
  await poll(0, 59_999);
  expect(read).toHaveBeenCalledTimes(calls);
  await poll(0, 1);
  expect(api.container.historyCleanup.status()).toMatchObject({
    state: 'pressure',
    deletedRuns: 1,
  });
  await poll(1.5 * GiB);
  expect(api.container.historyCleanup.status().state).toBe('no-eligible');
  await poll(2 * GiB);
  expect(api.container.historyCleanup.status().state).toBe('adequate');
});

it('warns with no eligible history and treats successful and failed retained runs identically', async () => {
  const { api, poll } = await controlled();
  const success = await complete(api),
    failed = await complete(api);
  await api.container.repos.runs.update(failed.id, { status: 'failed' });
  await poll(0);
  const status = (await api.app.inject('/system/storage')).json<StorageStatus>();
  expect(status).toMatchObject({ state: 'no-eligible', deletedRuns: 0, removedFileBytes: 0 });
  for (const run of [success, failed])
    expect((await api.app.inject(`/runs/${run.id}`)).statusCode).toBe(200);
  expect(api.logger.lines).toContainEqual(
    expect.objectContaining({
      level: 'warn',
      msg: 'Storage pressure: cleanup is limited to confirmed eligible history',
    }),
  );
});

it('cleans an older run approved between pressure passes without a false no-eligible status', async () => {
  const { api, poll } = await controlled();
  const pair = [await complete(api), await complete(api)].sort((a, b) => a.id.localeCompare(b.id));
  const older = pair[0]!,
    newer = pair[1]!;
  await mark(api, [newer.id]);
  await poll(0);
  expect((await api.app.inject(`/runs/${newer.id}`)).statusCode).toBe(404);
  await mark(api, [older.id]);
  await poll(0);
  expect(api.container.historyCleanup.status()).toMatchObject({
    state: 'pressure',
    deletedRuns: 1,
  });
  expect((await api.app.inject(`/runs/${older.id}`)).statusCode).toBe(404);
});

it('refuses noncanonical artifact references before retained input can depend on them', async () => {
  const { api, poll } = await controlled();
  const owner = await complete(api, true);
  const artifact = (await api.container.manager.getThread(owner.id))!.artifacts[0]!;
  const [kind, hash] = artifact.ref.slice('artifact:'.length).split('/');
  const spellings = [
    artifact.ref.toUpperCase(),
    `artifact:${kind!.toUpperCase()}/${hash}`,
    `artifact:${kind}/${hash!.toUpperCase()}`,
    artifact.ref + '\n',
    artifact.ref.replace('/', '\\'),
    artifact.ref.replace('/', '//'),
    artifact.ref.replace('/', '/./'),
    artifact.ref.replace(':', ':/'),
  ];
  for (const ref of spellings)
    expect(await api.container.ports.artifacts.get(ref), ref).toBeUndefined();
  const loop = await api.publishLoop(minimalLoop());
  const response = await api.app.inject({
    method: 'POST',
    url: `/loops/${loop}/runs`,
    payload: { input: { refs: spellings, canonical: artifact.ref } },
  });
  expect(response.statusCode).toBe(202);
  const retained = response.json<{ run: RunRecord }>().run;
  await api.idle();
  await mark(api, [owner.id]);
  await poll(0);
  expect((await api.app.inject(`/runs/${retained.id}`)).statusCode).toBe(200);
  expect(await api.container.ports.artifacts.get(artifact.ref)).toBeDefined();
  for (const ref of spellings) expect(await api.container.ports.artifacts.get(ref)).toBeUndefined();
});

it.each(['direct', 'missing-descendant', 'containing'] as const)(
  'protects a waiting run workspace configured through a %s junction',
  async (mode) => {
    const { api, poll } = await controlled();
    const owner = await complete(api, true);
    const workspace = api.harness.started[0]!.workingDirectory;
    await writeFile(join(workspace, 'retain.txt'), 'retained input bytes');
    const alias = join(api.dataDir, 'configured-alias');
    await symlink(
      mode === 'containing' ? join(api.dataDir, 'workspaces') : workspace,
      alias,
      'junction',
    );
    const path = mode === 'missing-descendant' ? join(alias, 'missing', 'child') : alias;
    const definition = singleNodeLoop('Retained waiting work', {
      id: 'wait',
      kind: 'wait',
      label: 'Wait',
      config: { mode: 'duration', seconds: 3600 },
    });
    definition.settings = { workingDirectory: { kind: 'fixed', path } };
    const loop = await api.publishLoop(definition);
    const started = await api.app.inject({
      method: 'POST',
      url: `/loops/${loop}/runs`,
      payload: {},
    });
    expect(started.statusCode).toBe(202);
    const retained = started.json<{ run: RunRecord }>().run;
    await api.idle();
    const before = (await api.app.inject(`/runs/${retained.id}`)).json<RunRecord>();
    expect(before.status).toBe('waiting');
    await mark(api, [owner.id]);
    await poll(0);
    expect(await readFile(join(workspace, 'retain.txt'), 'utf8')).toBe('retained input bytes');
    expect((await api.app.inject(`/runs/${retained.id}`)).json()).toEqual(before);
  },
);

it('deletes disposable owned outputs and approved rows while retained shared artifacts remain retrievable', async () => {
  const { api, poll } = await controlled();
  api.harness.script([
    { finalText: 'same bytes', items: [] },
    { finalText: 'same bytes', items: [] },
  ]);
  const removed = await complete(api, true),
    retained = await complete(api, true);
  const workspace = api.harness.started[0]!.workingDirectory;
  await writeFile(join(workspace, 'owned.txt'), 'owned output');
  const artifact = (await api.container.manager.getThread(retained.id))!.artifacts[0]!;
  const url = `/runs/${retained.id}/artifacts/${artifact.id}`;
  const before = await api.app.inject(url);
  expect(before.statusCode).toBe(200);
  await mark(api, [removed.id]);
  await poll(0);
  expect((await api.app.inject(`/runs/${removed.id}`)).statusCode).toBe(404);
  expect((await api.app.inject(url)).rawPayload).toEqual(before.rawPayload);
  await expect(lstat(workspace)).rejects.toMatchObject({ code: 'ENOENT' });
  const status = api.container.historyCleanup.status();
  expect(status).toMatchObject({
    deletedRuns: 1,
    removedFileBytes: 12,
    preservedResources: 1,
    pendingResources: 1,
  });
  expect(status.reusableDatabaseBytes).toBeGreaterThanOrEqual(0);
  await poll(0);
  expect(api.container.historyCleanup.status()).toMatchObject({
    state: 'no-eligible',
    deletedRuns: 0,
  });
  expect((await api.app.inject(url)).statusCode).toBe(200);
});

it.each(['error', 'invalid'] as const)('fails closed when capacity is %s', async (scenario) => {
  app = await createTestApp({
    tempPrefix: 'gg-wp-e3-',
    storageCapacity: {
      read: () =>
        scenario === 'error'
          ? Promise.reject(new Error('unavailable'))
          : Promise.resolve({ totalBytes: 0, availableBytes: -1 }),
    },
  });
  expect((await app.app.inject('/system/storage')).json()).toMatchObject({
    state: 'unavailable',
    deletedRuns: 0,
  });
});

it('starts no deletion after stop', async () => {
  const { api, poll } = await controlled();
  const run = await complete(api);
  await mark(api, [run.id]);
  await api.container.historyCleanup.stop();
  await poll(0);
  expect((await api.container.repos.runs.get(run.id))?.deletionApproval).toBeDefined();
});

it('awaits an in-flight capacity dependency on stop and deletes nothing after it settles', async () => {
  let hold = false;
  let release: ((value: { totalBytes: number; availableBytes: number }) => void) | undefined;
  app = await createTestApp({
    tempPrefix: 'gg-wp-e3-',
    storageCapacity: {
      read: () =>
        hold
          ? new Promise((resolve) => {
              release = resolve;
            })
          : Promise.resolve({ totalBytes: 100 * GiB, availableBytes: 50 * GiB }),
    },
  });
  const run = await complete(app);
  await mark(app, [run.id]);
  hold = true;
  app.clock.advance(60_000);
  const poll = app.container.historyCleanup.poll();
  expect(release).toBeDefined();
  let stopped = false;
  const stop = app.container.historyCleanup.stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(stopped).toBe(false);
  release!({ totalBytes: 100 * GiB, availableBytes: 0 });
  await Promise.all([poll, stop]);
  expect((await app.container.repos.runs.get(run.id))?.deletionApproval).toBeDefined();
});

it('schedules one pass per minute and cancels its timer on stop', async () => {
  vi.useFakeTimers();
  const clock = new FakeClock();
  const read = vi.fn(() => Promise.resolve({ totalBytes: 100 * GiB, availableBytes: 50 * GiB }));
  const store = {
    prepareBatch: vi.fn(() => Promise.resolve(0)),
    reapBatch: vi.fn(() =>
      Promise.resolve({ bytes: 0, preserved: 0, pending: 0, remaining: false }),
    ),
    reusableBytes: vi.fn(() => Promise.resolve(0)),
    hasApprovedCandidates: vi.fn(() => Promise.resolve(false)),
    pendingResources: vi.fn(() => Promise.resolve(0)),
  };
  const cleanup = new HistoryCleanup(
    { read },
    store,
    [{ name: 'data', path: 'unused' }],
    clock,
    new CapturingLogger(),
  );
  await cleanup.start(true);
  cleanup.afterListen();
  await cleanup.poll();
  expect(read).toHaveBeenCalledTimes(1);
  clock.advance(60_000);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(read).toHaveBeenCalledTimes(2);
  expect(store.prepareBatch).not.toHaveBeenCalled();
  await cleanup.stop();
  clock.advance(60_000);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(read).toHaveBeenCalledTimes(2);
});

it('keeps a pressure status when a bounded pass leaves approved candidates unexamined', async () => {
  const cleanup = new HistoryCleanup(
    { read: () => Promise.resolve({ totalBytes: 100 * GiB, availableBytes: 0 }) },
    {
      prepareBatch: () => Promise.resolve(0),
      reapBatch: () => Promise.resolve({ bytes: 0, preserved: 0, pending: 0, remaining: false }),
      reusableBytes: () => Promise.resolve(0),
      hasApprovedCandidates: () => Promise.resolve(true),
      pendingResources: () => Promise.resolve(0),
    },
    [{ name: 'data', path: 'unused' }],
    new FakeClock(),
    new CapturingLogger(),
  );
  await cleanup.start(false);
  expect(cleanup.status()).toMatchObject({ state: 'pressure', deletedRuns: 0 });
  await cleanup.stop();
});

it('observes an external SQLite volume through the public capacity port without exposing its path', async () => {
  const external = await mkdtemp(join(tmpdir(), 'gg-wp-e3-'));
  extraDirectories.push(external);
  const read = vi.fn((path: string) =>
    Promise.resolve({
      totalBytes: 100 * GiB,
      availableBytes: resolve(path) === resolve(external) ? 0 : 50 * GiB,
    }),
  );
  app = await createTestApp({
    tempPrefix: 'gg-wp-e3-',
    env: { GG_DB_URL: `file:${join(external, 'history.db')}` },
    storageCapacity: { read },
  });
  const response = await app.app.inject('/system/storage');
  expect(response.json()).toMatchObject({
    state: 'no-eligible',
    volumes: [
      { name: 'data', availableBytes: 50 * GiB },
      { name: 'database', availableBytes: 0 },
    ],
  });
  expect(response.body).not.toContain(external);
  expect(read).toHaveBeenCalledTimes(2);
});

it('keeps immutable Event delivery provenance while removing approved run links', async () => {
  const { api, poll } = await controlled();
  const loopId = await api.publishLoop({
    schemaVersion: 4,
    name: 'Event cleanup',
    nodes: [
      {
        id: 'start',
        kind: 'trigger',
        label: 'Start',
        config: { type: 'event', eventType: 'ready' },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'trigger.payload' } },
    ],
    edges: [{ id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
  });
  expect(
    (await api.app.inject({ method: 'POST', url: '/events', payload: { loopId, type: 'ready' } }))
      .statusCode,
  ).toBe(202);
  await api.container.manager.waitForWebhookRecovery();
  await api.idle();
  const [run] = await api.container.repos.runs.list({ loopId });
  await mark(api, [run!.id]);
  await poll(0);
  const events = (await api.app.inject('/events')).json<{
    items: { runIds: string[]; delivery: { state: string } }[];
  }>();
  expect(events.items).toHaveLength(1);
  expect(events.items[0]).toMatchObject({ runIds: [], delivery: { state: 'admitted' } });
  expect((await api.app.inject(`/runs/${run!.id}`)).statusCode).toBe(404);
});

it('serves HTTP requests while a startup cleanup pass is still reclaiming', async () => {
  app = await createTestApp({ tempPrefix: 'gg-wp-e3-' });
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const hold = new Promise<number>((resolve) => {
    release = () => resolve(0);
  });
  const cleanup = new HistoryCleanup(
    { read: () => Promise.resolve({ totalBytes: 100 * GiB, availableBytes: 0 }) },
    {
      prepareBatch: () => {
        enter();
        return hold;
      },
      reapBatch: () => Promise.resolve({ bytes: 0, pending: 0, preserved: 0, remaining: false }),
      reusableBytes: () => Promise.resolve(0),
      hasApprovedCandidates: () => Promise.resolve(false),
      pendingResources: () => Promise.resolve(0),
    },
    [{ name: 'data', path: 'unused' }],
    app.clock,
    app.logger,
  );
  await cleanup.start(false);
  const server = await buildApp({ ...app.container, historyCleanup: cleanup });
  try {
    // Dedicated test port in the assigned API pool; no owner listener is probed.
    const url = await server.listen({
      port: await freePort(
        Number(process.env['GG_TEST_PORT_START'] ?? 5600),
        Number(process.env['GG_TEST_PORT_COUNT'] ?? 100),
      ),
      host: '127.0.0.1',
    });
    await entered;
    expect(cleanup.status().cleaning).toBe(true);
    expect((await fetch(url + '/runs?limit=1')).status).toBe(200);
    expect(cleanup.status().cleaning).toBe(true);
  } finally {
    release();
    await cleanup.stop();
    await server.close();
  }
});

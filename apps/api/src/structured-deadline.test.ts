import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { RunRecord } from '@graphgoblin/contracts';
import {
  CapturingLogger,
  FakeClock,
  FakeHarness,
  singleNodeLoop,
} from '@graphgoblin/engine/testing';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createContainer, type Container } from './container.js';
import type { ApiInstance } from './types.js';

let container: Container | undefined;
let app: ApiInstance | undefined;
let dataDir: string | undefined;
let release: (() => void) | undefined;
afterEach(async () => {
  container?.manager.stop();
  if (container) {
    for (const row of await container.repos.runs.listRecoveryCandidates()) {
      const run = await container.repos.runs.get(row.id);
      if (run && ['running', 'queued', 'waiting', 'paused'].includes(run.status))
        await container.manager.cancel(run.id);
    }
  }
  release?.();
  await app?.close();
  await container?.stop();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

it('API reports a stalled structured node as timed out and releases its run slot', async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'gg-wp-f3-270-'));
  const clock = new FakeClock();
  let signal: AbortSignal | undefined;
  let reached!: () => void;
  const requested = new Promise<void>((resolve) => {
    reached = resolve;
  });
  container = await createContainer(
    loadConfig({
      GG_DATA_DIR: dataDir,
      GG_DB_URL: ':memory:',
      GG_MAX_CONCURRENT_RUNS: '1',
      GG_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
    }),
    {
      clock,
      logger: new CapturingLogger(),
      startTimers: false,
      harnesses: { codex: new FakeHarness() },
      structured: {
        complete: (_request, supplied) => {
          signal = supplied;
          reached();
          return new Promise((resolve) => {
            release = () => resolve({ value: 1 });
          });
        },
      },
    },
  );
  await container.start();
  app = await buildApp(container, { logger: false });
  const definition = singleNodeLoop('API structured deadline', {
    id: 'repair',
    kind: 'mutate',
    label: 'Repair',
    config: {
      operations: [
        {
          op: 'coerce',
          source: '/vars/value',
          target: '/vars/value',
          jsonSchema: { type: 'number' },
          repair: { enabled: true, maxAttempts: 1 },
        },
      ],
    },
  });
  definition.settings = { runDeadlineSeconds: 1 };
  const created = await app.inject({ method: 'POST', url: '/loops', payload: { definition } });
  expect(created.statusCode).toBe(201);
  const id = created.json<{ loop: { id: string } }>().loop.id;
  expect((await app.inject({ method: 'POST', url: `/loops/${id}/publish` })).statusCode).toBe(200);
  const started = await app.inject({ method: 'POST', url: `/loops/${id}/runs`, payload: {} });
  const runId = started.json<{ run: RunRecord }>().run.id;
  expect(
    await Promise.race([
      requested.then(() => 'requested'),
      container.manager.waitForIdle().then(() => 'idle'),
    ]),
  ).toBe('requested');
  const firstSignal = signal;
  const queued = await app.inject({ method: 'POST', url: `/loops/${id}/runs`, payload: {} });
  const queuedId = queued.json<{ run: RunRecord }>().run.id;
  expect((await container.repos.runs.get(queuedId))?.status).toBe('queued');
  clock.advance(1001);
  const read = async () =>
    (await app!.inject({ method: 'GET', url: `/runs/${runId}` })).json<RunRecord>();
  await expect.poll(async () => (await read()).status, { timeout: 2000 }).toBe('failed');
  expect((await read()).failure).toMatchObject({ code: 'RUN_DEADLINE_EXCEEDED', nodeId: 'repair' });
  expect(firstSignal?.aborted).toBe(true);
  await expect
    .poll(async () => (await container!.repos.runs.get(queuedId))?.status)
    .toBe('running');
});

it.each([
  ['repair', 'fast'],
  ['repair', 'late'],
  ['repair', 'cancel'],
  ['route', 'fast'],
  ['route', 'late'],
  ['route', 'cancel'],
] as const)(
  'API %s completion handles %s with the configured completion deadline',
  async (kind, mode) => {
    dataDir = await mkdtemp(join(tmpdir(), 'gg-wp-f3-270-'));
    let signal: AbortSignal | undefined;
    let reached!: () => void;
    const requested = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const logger = new CapturingLogger();
    const value = kind === 'repair' ? 7 : { route: 'yes', confidence: 1, reasoning: 'Safe route' };
    container = await createContainer(
      loadConfig({
        GG_DATA_DIR: dataDir,
        GG_DB_URL: ':memory:',
        GG_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
      }),
      {
        logger,
        startTimers: false,
        harnesses: { codex: new FakeHarness() },
        structured: {
          complete: (_request, supplied) => {
            signal = supplied;
            reached();
            return mode === 'fast'
              ? Promise.resolve({ value })
              : new Promise((resolve, reject) => {
                  // CodexDecider turns a late value into an abort acknowledgement. Exercise
                  // its non-abort late rejection here so the warning is a positive barrier;
                  // repair/API and public-engine route cases cover late fulfillment.
                  release = () =>
                    kind === 'route'
                      ? reject(new Error('late route provider failure'))
                      : resolve({ value });
                });
          },
        },
      },
    );
    await container.start();
    app = await buildApp(container, { logger: false });
    const definition = singleNodeLoop(
      'API completion boundary',
      kind === 'repair'
        ? {
            id: 'work',
            kind: 'mutate',
            label: 'Repair',
            config: {
              operations: [
                {
                  op: 'coerce',
                  source: '/vars/value',
                  target: '/vars/value',
                  jsonSchema: { type: 'number' },
                  repair: { enabled: true, maxAttempts: 1 },
                },
              ],
            },
          }
        : {
            id: 'work',
            kind: 'decision',
            label: 'Route',
            config: {
              kind: 'llm',
              harness: 'codex',
              model: { mode: 'inherit' },
              effort: { mode: 'inherit' },
              instructions: 'Choose',
              routes: [
                { id: 'yes', label: 'Yes' },
                { id: 'no', label: 'No' },
              ],
            },
          },
    );
    definition.settings = {
      structuredTimeoutMs: mode === 'cancel' ? null : mode === 'fast' ? 1000 : 100,
    };
    if (kind === 'route')
      definition.edges.push(
        ...['yes', 'no'].map((port) => ({
          id: port,
          from: { node: 'work', port },
          to: { node: 'done' },
        })),
      );
    const created = await app.inject({ method: 'POST', url: '/loops', payload: { definition } });
    expect(created.statusCode).toBe(201);
    const loopId = created.json<{ loop: { id: string } }>().loop.id;
    expect((await app.inject({ method: 'POST', url: `/loops/${loopId}/publish` })).statusCode).toBe(
      200,
    );
    const started = await app.inject({ method: 'POST', url: `/loops/${loopId}/runs`, payload: {} });
    expect(started.statusCode).toBe(202);
    const id = started.json<{ run: RunRecord }>().run.id;
    expect(
      await Promise.race([
        requested.then(() => 'requested'),
        container.manager.waitForIdle().then(() => 'idle'),
      ]),
    ).toBe('requested');
    if (mode === 'cancel')
      expect(
        (await app.inject({ method: 'POST', url: `/runs/${id}/cancel`, payload: {} })).statusCode,
      ).toBe(200);
    await container.manager.waitForIdle();
    const read = async () =>
      (await app!.inject({ method: 'GET', url: `/runs/${id}` })).json<RunRecord>();
    expect((await read()).status).toBe(
      mode === 'fast' ? 'succeeded' : mode === 'cancel' ? 'cancelled' : 'failed',
    );
    if (mode === 'late')
      expect((await read()).failure).toMatchObject({
        code: 'STRUCTURED_COMPLETION_TIMEOUT',
        details: { timeoutMs: 100 },
        nodeId: 'work',
      });
    else expect((await read()).failure).toBeUndefined();
    const before = await container.manager.getThread(id);
    release?.();
    if (mode !== 'fast')
      await expect
        .poll(
          () =>
            logger.lines.filter((line) => line.msg === 'late structured completion discarded')
              .length,
        )
        .toBe(1);
    expect(await container.manager.getThread(id)).toEqual(before);
    expect(signal?.aborted).toBe(mode !== 'fast');
    const events = await container.ports.events.read(id);
    expect(
      events.filter((event) =>
        ['run.failed', 'run.finished', 'run.cancelled'].includes(event.type),
      ),
    ).toHaveLength(1);
  },
);

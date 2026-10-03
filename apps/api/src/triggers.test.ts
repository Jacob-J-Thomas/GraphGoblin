import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LoopDefinitionSchema,
  type LoopDefinitionInput,
  type RunRecord,
} from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import {
  CapturingLogger,
  FakeClock,
  FakeHarness,
  FakeProbes,
  FakeScripts,
} from '@graphgoblin/engine/testing';
import { signPayload } from '@graphgoblin/infrastructure/http';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createContainer, type Container } from './container.js';
import { createTestApp, type TestApp } from './testing/test-app.js';
import { FixedWindowRateLimiter } from './triggers/rate-limit.js';
import { MAX_EVENT_CHAIN } from './triggers/trigger-service.js';

let t: TestApp;

beforeEach(async () => {
  t = await createTestApp();
});

afterEach(async () => {
  await t.close();
});

type TriggerConfig = Record<string, unknown> & { subtype: string };

function triggerLoop(
  name: string,
  trigger: TriggerConfig,
  options: { emit?: string; triggerId?: string; manual?: boolean } = {},
): LoopDefinitionInput {
  const triggerId = options.triggerId ?? 'trig';
  return {
    schemaVersion: 1,
    name,
    nodes: [
      { id: triggerId, kind: 'trigger', label: 'T', config: trigger as never },
      ...(options.manual
        ? [
            {
              id: 'manual',
              kind: 'trigger' as const,
              label: 'M',
              config: { subtype: 'manual' as const },
            },
          ]
        : []),
      {
        id: 'done',
        kind: 'exit',
        label: 'D',
        config: {
          return: {
            mapping: '"done"',
            channels: options.emit
              ? [{ kind: 'event', eventType: options.emit }]
              : [{ kind: 'log' }],
          },
        },
      },
    ],
    edges: [
      { id: 'e1', from: { node: triggerId, port: 'out' }, to: { node: 'done' } },
      ...(options.manual
        ? [{ id: 'e2', from: { node: 'manual', port: 'out' }, to: { node: 'done' } }]
        : []),
    ],
  };
}

const hookTrigger = (extra: Record<string, unknown> = {}): TriggerConfig => ({
  subtype: 'webhook',
  signature: { scheme: 'hmac-sha256', secretRef: 'hook-secret' },
  ...extra,
});

interface TriggerList {
  schedules: {
    id: string;
    versionId: string;
    triggerNodeId: string;
    enabled: boolean;
    nextFireAt?: string;
  }[];
  webhooks: { id: string; versionId: string; path: string; enabled: boolean }[];
}

async function triggersOf(app: TestApp, loopId: string): Promise<TriggerList> {
  return (await app.app.inject(`/loops/${loopId}/triggers`)).json<TriggerList>();
}

async function setSecret(value = 'shh'): Promise<void> {
  await t.app.inject({ method: 'PUT', url: '/secrets/hook-secret', payload: { value } });
}

async function deliver(
  path: string,
  body: string,
  options: {
    secret?: string;
    timestamp?: string;
    signature?: string;
    header?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const timestamp = options.timestamp ?? t.clock.now().toISOString();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-graphgoblin-timestamp': timestamp,
    [options.header ?? 'x-graphgoblin-signature']:
      options.signature ?? signPayload(options.secret ?? 'shh', timestamp, body),
    ...options.headers,
  };
  return t.app.inject({ method: 'POST', url: path, payload: body, headers });
}

async function runsOf(loopId: string): Promise<RunRecord[]> {
  return t.container.repos.runs.list({ loopId });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await t.idle();
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('arming on publish', () => {
  it('creates schedules and endpoints, keeps webhook paths, and disables old versions', async () => {
    const loop = triggerLoop('armed', { subtype: 'cron', expression: '0 * * * *' });
    loop.nodes.push(
      { id: 'hook', kind: 'trigger', label: 'H', config: hookTrigger() as never },
      {
        id: 'off',
        kind: 'trigger',
        label: 'Off',
        config: { subtype: 'cron', expression: '0 0 * * *', enabled: false },
      },
    );
    loop.edges.push(
      { id: 'e-hook', from: { node: 'hook', port: 'out' }, to: { node: 'done' } },
      { id: 'e-off', from: { node: 'off', port: 'out' }, to: { node: 'done' } },
    );
    const id = await t.publishLoop(loop);
    const first = await triggersOf(t, id);
    expect(first.schedules.map((s) => [s.triggerNodeId, s.enabled, s.nextFireAt])).toEqual(
      expect.arrayContaining([
        ['trig', true, '2026-10-02T13:00:00.000Z'],
        ['off', false, undefined],
      ]),
    );
    expect(first.webhooks).toHaveLength(1);
    const path = first.webhooks[0]!.path;
    expect(path).toMatch(/^\/hooks\/[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(first)).not.toContain('"token"');

    await t.app.inject({ method: 'PUT', url: `/loops/${id}/draft`, payload: { definition: loop } });
    await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` });
    const second = await triggersOf(t, id);
    const current = (await t.container.repos.loops.getLoop(id))!.currentVersionId;
    expect(second.schedules.filter((s) => s.enabled).map((s) => s.versionId)).toEqual([current]);
    expect(second.schedules.filter((s) => s.versionId !== current).every((s) => !s.enabled)).toBe(
      true,
    );
    expect(second.webhooks.find((w) => w.enabled)).toMatchObject({ versionId: current, path });
    expect(second.webhooks.filter((w) => !w.enabled)).toHaveLength(1);

    // Removing the webhook node retires its path.
    await t.app.inject({
      method: 'PUT',
      url: `/loops/${id}/draft`,
      payload: { definition: triggerLoop('armed', { subtype: 'manual' }) },
    });
    await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` });
    await setSecret();
    expect((await deliver(path, '{}')).statusCode).toBe(404);

    expect((await t.app.inject({ method: 'DELETE', url: `/loops/${id}` })).statusCode).toBe(204);
    expect(await t.container.repos.schedules.listEnabled()).toEqual([]);
    expect((await t.app.inject(`/loops/${id}/triggers`)).statusCode).toBe(404);
  });

  it('refuses to publish a cron trigger that does not parse', async () => {
    const created = await t.app.inject({
      method: 'POST',
      url: '/loops',
      payload: {
        definition: triggerLoop('bad-cron', {
          subtype: 'cron',
          expression: 'every tuesday',
          timezone: 'Mars/Olympus',
        }),
      },
    });
    const id = created.json<{ loop: { id: string } }>().loop.id;
    const published = await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` });
    expect(published.statusCode).toBe(422);
    expect(published.json()).toMatchObject({
      code: 'LOOP_INVALID',
      errors: [expect.objectContaining({ code: 'CRON_INVALID', nodeId: 'trig' })],
    });
  });

  it('arms a stored cron node that no longer parses as disabled and logs it', async () => {
    const id = await t.publishLoop(minimalLoop());
    const loop = (await t.container.repos.loops.getLoop(id))!;
    const version = (await t.container.repos.loops.getVersion(loop.currentVersionId!))!;
    const definition = LoopDefinitionSchema.parse(
      triggerLoop('broken', { subtype: 'cron', expression: 'nope' }),
    );
    const armed = await t.container.triggers.armVersion(loop, { ...version, definition });
    expect(armed.schedules).toEqual([expect.objectContaining({ enabled: false })]);
    expect(t.logger.lines.some((l) => l.msg === 'cron trigger not armed')).toBe(true);
  });
});

describe('cron triggers', () => {
  it('starts a run when a schedule comes due', async () => {
    const id = await t.publishLoop(
      triggerLoop('hourly', { subtype: 'cron', expression: '0 * * * *' }),
    );
    expect(await t.container.cron.poll()).toBe(0);
    t.clock.set('2026-10-02T13:00:05.000Z');
    expect(await t.container.cron.poll()).toBe(1);
    await settle();
    const [run] = await runsOf(id);
    expect(run?.status).toBe('succeeded');
    const thread = await t.container.repos.runs.getInitialThread(run!.id);
    expect(thread?.invocation).toMatchObject({
      source: 'cron',
      trigger: {
        nodeId: 'trig',
        kind: 'cron',
        payload: { scheduledFor: '2026-10-02T13:00:00.000Z', catchUp: false },
      },
    });
  });

  it('applies the missed-fire policy after an outage', async () => {
    const each = await t.publishLoop(
      triggerLoop('each', {
        subtype: 'cron',
        expression: '0 * * * *',
        missedFirePolicy: 'run-each',
      }),
    );
    const once = await t.publishLoop(
      triggerLoop('once', {
        subtype: 'cron',
        expression: '0 * * * *',
        missedFirePolicy: 'run-once',
      }),
    );
    const skip = await t.publishLoop(
      triggerLoop('skip', { subtype: 'cron', expression: '0 * * * *' }),
    );
    t.clock.set('2026-10-02T15:30:00.000Z');
    expect(await t.container.cron.recover()).toBe(4);
    await settle();
    expect(await runsOf(each)).toHaveLength(3);
    expect(await runsOf(once)).toHaveLength(1);
    expect(await runsOf(skip)).toHaveLength(0);
    const next = (await triggersOf(t, skip)).schedules[0]?.nextFireAt;
    expect(next).toBe('2026-10-02T16:00:00.000Z');
  });

  it('logs a fire whose loop is gone', async () => {
    const result = await t.container.triggers.onCronFire({
      schedule: {
        id: 'sched',
        ownerId: 'local',
        loopId: 'missing',
        versionId: 'missing',
        triggerNodeId: 'trig',
        expression: '* * * * *',
        timezone: 'UTC',
        missedFirePolicy: 'skip',
        enabled: true,
        createdAt: '2026-10-02T12:00:00.000Z',
      },
      scheduledFor: '2026-10-02T12:00:00.000Z',
      catchUp: false,
    });
    expect(result).toBeUndefined();
    expect(t.logger.lines.some((l) => l.msg === 'cron run failed to start')).toBe(true);
  });
});

describe('boot', () => {
  let dataDir: string;
  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'gg-boot-'));
  });
  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
  });

  async function boot(clock: FakeClock, startTimers = false): Promise<Container> {
    const config = loadConfig({
      GG_DATA_DIR: dataDir,
      GG_DB_URL: `file:${join(dataDir, 'gg.db').replace(/\\/g, '/')}`,
      GG_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
    });
    const container = await createContainer(config, {
      clock,
      harnesses: { codex: new FakeHarness() },
      startTimers,
    });
    await container.start();
    return container;
  }

  it('re-arms every published loop and catches up on missed fires', async () => {
    const clock = new FakeClock();
    const first = await boot(clock);
    const app = await buildApp(first, { logger: false });
    const created = await app.inject({
      method: 'POST',
      url: '/loops',
      payload: {
        definition: triggerLoop('boot', {
          subtype: 'cron',
          expression: '0 * * * *',
          missedFirePolicy: 'run-once',
        }),
      },
    });
    const id = created.json<{ loop: { id: string } }>().loop.id;
    await app.inject({ method: 'POST', url: `/loops/${id}/publish` });
    await app.close();
    await first.stop();

    // A restored database without trigger rows: boot regenerates them.
    clock.set('2026-10-02T12:30:00.000Z');
    const restored = await boot(clock);
    await restored.handle.client.execute('delete from schedules');
    await restored.stop();
    const rearmed = await boot(clock);
    const schedules = await rearmed.repos.schedules.listForLoop(id);
    expect(schedules).toEqual([
      expect.objectContaining({ enabled: true, nextFireAt: '2026-10-02T13:00:00.000Z' }),
    ]);
    await rearmed.stop();

    // Down across two slots; booting with live timers applies run-once.
    clock.set('2026-10-02T15:10:00.000Z');
    const live = await boot(clock, true);
    await live.manager.waitForIdle();
    const runs = await live.repos.runs.list({ loopId: id });
    expect(runs).toHaveLength(1);
    const [row] = await live.repos.schedules.listForLoop(id);
    expect(row).toMatchObject({
      lastFiredAt: '2026-10-02T15:00:00.000Z',
      nextFireAt: '2026-10-02T16:00:00.000Z',
    });
    await live.stop();
  });

  it('logs and continues when a loop cannot be re-armed', async () => {
    const id = await t.publishLoop(minimalLoop());
    const spy = vi
      .spyOn(t.container.repos.loops, 'getVersion')
      .mockRejectedValueOnce(new Error('disk gone'))
      .mockResolvedValueOnce(undefined);
    expect(await t.container.triggers.armAll()).toBe(0);
    expect(await t.container.triggers.armAll()).toBe(0);
    expect(
      t.logger.lines.some((l) => l.msg === 'trigger arm failed' && l.obj['loopId'] === id),
    ).toBe(true);
    spy.mockRestore();
    expect(await t.container.triggers.armAll()).toBe(1);
  });
});

describe('webhooks', () => {
  async function hookPath(
    extra: Record<string, unknown> = {},
  ): Promise<{ id: string; path: string }> {
    const id = await t.publishLoop(triggerLoop(`hook-${Math.random()}`, hookTrigger(extra)));
    return { id, path: (await triggersOf(t, id)).webhooks[0]!.path };
  }

  it('starts a run for a correctly signed delivery', async () => {
    await setSecret();
    const { id, path } = await hookPath();
    const body = JSON.stringify({ action: 'opened', number: 7 });
    const response = await deliver(path, body);
    expect(response.statusCode).toBe(202);
    const json = response.json<{ runId: string; filtered: boolean; event: { runIds: string[] } }>();
    expect(json.filtered).toBe(false);
    expect(json.event.runIds).toEqual([json.runId]);
    await settle();
    const [run] = await runsOf(id);
    expect(run?.id).toBe(json.runId);
    const thread = await t.container.repos.runs.getInitialThread(json.runId);
    expect(thread?.invocation).toMatchObject({
      source: 'webhook',
      trigger: { nodeId: 'trig', kind: 'webhook', payload: { action: 'opened', number: 7 } },
    });
    const events = (await t.app.inject('/events')).json<{
      items: { type: string; source: string }[];
    }>();
    expect(events.items[0]).toMatchObject({
      type: 'webhook',
      source: expect.stringMatching(/^webhook:/),
    });
  });

  it('rejects bad signatures, stale or missing timestamps, unknown tokens, and replays', async () => {
    await setSecret();
    const { path } = await hookPath();
    expect((await deliver(path, '{"a":1}', { secret: 'wrong' })).json()).toMatchObject({
      status: 401,
      code: 'SIGNATURE_INVALID',
    });
    expect((await deliver(path, '{"a":1}', { signature: 'sha256=00' })).statusCode).toBe(401);
    const stale = await deliver(path, '{"a":1}', { timestamp: '2026-10-02T11:50:00.000Z' });
    expect(stale.json()).toMatchObject({ status: 401, code: 'TIMESTAMP_OUT_OF_WINDOW' });
    const noTimestamp = await t.app.inject({ method: 'POST', url: path, payload: '{}' });
    expect(noTimestamp.json()).toMatchObject({ status: 401, code: 'TIMESTAMP_MISSING' });
    const garbled = await deliver(path, '{}', { timestamp: 'yesterday' });
    expect(garbled.json()).toMatchObject({ code: 'TIMESTAMP_MISSING' });
    expect((await deliver('/hooks/not-a-token', '{}')).json()).toMatchObject({
      status: 404,
      code: 'HOOK_NOT_FOUND',
    });

    const timestamp = t.clock.now().toISOString();
    expect((await deliver(path, '{"a":2}', { timestamp })).statusCode).toBe(202);
    const replay = await deliver(path, '{"a":2}', { timestamp });
    expect(replay.json()).toMatchObject({ status: 409, code: 'REPLAYED' });
  });

  it('accepts Unix-second timestamps, empty bodies, and a custom signature header', async () => {
    await setSecret();
    const { path } = await hookPath({
      signature: { scheme: 'hmac-sha256', secretRef: 'hook-secret', header: 'X-Hub-Signature-256' },
    });
    const seconds = String(Math.floor(t.clock.now().getTime() / 1000));
    const response = await deliver(path, '', { timestamp: seconds, header: 'x-hub-signature-256' });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ event: { payload: null } });
  });

  it('records filtered deliveries without starting a run', async () => {
    await setSecret();
    const { id, path } = await hookPath({ filter: "action = 'opened'" });
    const response = await deliver(path, JSON.stringify({ action: 'closed' }));
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ filtered: true, event: { runIds: [] } });
    expect(response.json<{ runId?: string }>().runId).toBeUndefined();
    expect(await runsOf(id)).toEqual([]);
    expect((await deliver(path, JSON.stringify({ action: 'opened' }))).json()).toMatchObject({
      filtered: false,
    });
  });

  it('dedupes on the dedupeKey expression within the replay window', async () => {
    await setSecret();
    const { id, path } = await hookPath({
      dedupeKey: '$headers."x-delivery" & ":" & id',
      replayWindowSeconds: 60,
    });
    const first = await deliver(path, '{"id":1}', { headers: { 'x-delivery': 'd' } });
    expect(first.json()).toMatchObject({ event: { dedupeKey: 'd:1' } });
    t.clock.advance(5_000);
    expect((await deliver(path, '{"id":1}', { headers: { 'x-delivery': 'd' } })).statusCode).toBe(
      409,
    );
    t.clock.advance(60_000);
    expect((await deliver(path, '{"id":1}', { headers: { 'x-delivery': 'd' } })).statusCode).toBe(
      202,
    );
    await settle();
    expect(await runsOf(id)).toHaveLength(2);
  });

  it('reports invalid JSON, failing expressions, missing secrets, and oversized bodies', async () => {
    const { path } = await hookPath({ filter: '$error("nope")' });
    expect((await deliver(path, '{}')).json()).toMatchObject({
      status: 503,
      code: 'HOOK_NOT_READY',
    });
    await setSecret();
    expect((await deliver(path, '{not json')).json()).toMatchObject({
      status: 400,
      code: 'BODY_INVALID',
    });
    expect((await deliver(path, '{}')).json()).toMatchObject({
      status: 422,
      code: 'EXPRESSION_FAILED',
    });
    const big = JSON.stringify({ blob: 'x'.repeat(1024 * 1024) });
    expect((await deliver(path, big)).statusCode).toBe(413);
  });

  it('rate limits each endpoint', async () => {
    await t.close();
    t = await createTestApp({ env: { GG_HOOK_RATE_LIMIT: '2' } });
    await setSecret();
    const { path } = await hookPath();
    expect((await deliver(path, '{"n":1}')).statusCode).toBe(202);
    expect((await deliver(path, '{"n":2}')).statusCode).toBe(202);
    const limited = await deliver(path, '{"n":3}');
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('60');
    t.clock.advance(60_000);
    expect((await deliver(path, '{"n":4}')).statusCode).toBe(202);
  });
});

describe('FixedWindowRateLimiter', () => {
  it('counts per key, resets per window, and sweeps idle keys', () => {
    const clock = new FakeClock();
    const limiter = new FixedWindowRateLimiter(clock, 1, 1000);
    expect(limiter.hit('a')).toEqual({ allowed: true, retryAfterSeconds: 1 });
    expect(limiter.hit('a').allowed).toBe(false);
    expect(limiter.hit('b').allowed).toBe(true);
    clock.advance(1000);
    expect(limiter.hit('a').allowed).toBe(true);
    for (let i = 0; i < 10_002; i += 1) limiter.hit(`k${i}`);
    clock.advance(1000);
    expect(limiter.hit('fresh').allowed).toBe(true);
  });
});

describe('event triggers', () => {
  it('fires matching event triggers with filters and dedupe, and lists events', async () => {
    const plain = await t.publishLoop(
      triggerLoop('plain', { subtype: 'event', eventType: 'issue-ready' }),
    );
    const filtered = await t.publishLoop(
      triggerLoop('filtered', {
        subtype: 'event',
        eventType: 'issue-ready',
        filter: 'priority > 2',
      }),
    );
    const keyed = await t.publishLoop(
      triggerLoop('keyed', { subtype: 'event', eventType: 'issue-ready', dedupeKey: 'issue' }),
    );
    await t.publishLoop(triggerLoop('other', { subtype: 'event', eventType: 'other-type' }));

    const first = await t.app.inject({
      method: 'POST',
      url: '/events',
      payload: { type: 'issue-ready', payload: { issue: 1, priority: 1 } },
    });
    expect(first.statusCode).toBe(202);
    expect(first.json<{ runIds: string[]; duplicate: boolean }>()).toMatchObject({
      duplicate: false,
      source: 'api',
    });
    expect(first.json<{ runIds: string[] }>().runIds).toHaveLength(2);
    await settle();
    expect(await runsOf(plain)).toHaveLength(1);
    expect(await runsOf(filtered)).toHaveLength(0);
    expect(await runsOf(keyed)).toHaveLength(1);

    // Same issue again: the keyed trigger dedupes; the high priority passes the filter.
    const second = await t.app.inject({
      method: 'POST',
      url: '/events',
      payload: { type: 'issue-ready', payload: { issue: 1, priority: 5 }, dedupeKey: 'evt-2' },
    });
    expect(second.json<{ runIds: string[] }>().runIds).toHaveLength(2);
    await settle();
    expect(await runsOf(keyed)).toHaveLength(1);
    expect(await runsOf(filtered)).toHaveLength(1);
    const thread = await t.container.repos.runs.getInitialThread((await runsOf(filtered))[0]!.id);
    expect(thread?.invocation).toMatchObject({
      source: 'event',
      caller: { kind: 'system' },
      trigger: { kind: 'event', dedupeKey: 'evt-2' },
    });

    const duplicate = await t.app.inject({
      method: 'POST',
      url: '/events',
      payload: { type: 'issue-ready', payload: { issue: 9, priority: 9 }, dedupeKey: 'evt-2' },
    });
    expect(duplicate.json()).toMatchObject({
      duplicate: true,
      runIds: second.json<{ runIds: string[] }>().runIds,
    });

    const listed = (await t.app.inject('/events?limit=2')).json<{ items: { id: string }[] }>();
    expect(listed.items).toHaveLength(2);
    expect(listed.items[0]?.id).toBe(second.json<{ id: string }>().id);
    const typed = (await t.app.inject('/events?type=nothing')).json<{ items: unknown[] }>();
    expect(typed.items).toEqual([]);
    const before = (
      await t.app.inject(`/events?before=${encodeURIComponent('2000-01-01T00:00:00.000Z')}`)
    ).json<{ items: unknown[] }>();
    expect(before.items).toEqual([]);
  });

  it('logs trigger failures and bus events that cannot be stored', async () => {
    await t.publishLoop(
      triggerLoop('broken', { subtype: 'event', eventType: 'boom', filter: '$error("bad")' }),
    );
    const result = await t.app.inject({
      method: 'POST',
      url: '/events',
      payload: { type: 'boom' },
    });
    expect(result.json()).toMatchObject({ runIds: [] });
    expect(t.logger.lines.some((l) => l.msg === 'event trigger failed')).toBe(true);

    const spy = vi
      .spyOn(t.container.repos.inbound, 'insertUnlessDuplicate')
      .mockRejectedValueOnce(new Error('db down'));
    await t.container.bus.publish({
      id: 'x',
      ownerId: 'local',
      type: 'boom',
      payload: [1, 2],
      receivedAt: t.clock.now().toISOString(),
    });
    expect(t.logger.lines.some((l) => l.msg === 'event ingest failed')).toBe(true);
    spy.mockRestore();

    await t.container.bus.publish({
      id: 'y',
      ownerId: 'local',
      type: 'quiet',
      payload: 'text',
      dedupeKey: 'q',
      receivedAt: t.clock.now().toISOString(),
    });
    const [event] = (await t.container.repos.inbound.list('local', { type: 'quiet' })) ?? [];
    expect(event).toMatchObject({ source: 'bus', dedupeKey: 'q' });
  });

  it('chains loops through exit events and refuses to re-enter a loop in the chain', async () => {
    const a = await t.publishLoop(
      triggerLoop(
        'loop-a',
        { subtype: 'event', eventType: 'b-done' },
        { emit: 'a-done', manual: true },
      ),
    );
    const b = await t.publishLoop(
      triggerLoop('loop-b', { subtype: 'event', eventType: 'a-done' }, { emit: 'b-done' }),
    );
    const self = await t.publishLoop(
      triggerLoop('loop-self', { subtype: 'event', eventType: 'ping' }, { emit: 'ping' }),
    );

    const started = await t.app.inject({
      method: 'POST',
      url: `/loops/${a}/runs`,
      payload: { triggerNodeId: 'manual' },
    });
    expect(started.statusCode).toBe(202);
    await settle();
    expect(await runsOf(a)).toHaveLength(1);
    const [bRun] = await runsOf(b);
    expect(bRun?.status).toBe('succeeded');
    const bThread = await t.container.repos.runs.getInitialThread(bRun!.id);
    expect(bThread?.invocation).toMatchObject({
      source: 'event',
      caller: { kind: 'run', id: started.json<{ run: RunRecord }>().run.id },
      trigger: { kind: 'event', payload: expect.objectContaining({ outcome: 'success' }) },
    });
    const events = (await t.app.inject('/events')).json<{
      items: { type: string; source: string; runIds: string[] }[];
    }>();
    expect(events.items.map((e) => [e.type, e.runIds.length])).toEqual([
      ['b-done', 0],
      ['a-done', 1],
    ]);
    expect(events.items[0]?.source).toBe(`run:${bRun!.id}`);

    await t.app.inject({ method: 'POST', url: '/events', payload: { type: 'ping' } });
    await settle();
    expect(await runsOf(self)).toHaveLength(1);
    expect(
      t.logger.lines.filter((l) => l.msg === 'event trigger skipped: loop is already in the chain'),
    ).toHaveLength(2);
  });

  it('stops a chain of distinct loops at the hop limit', async () => {
    const ids: string[] = [];
    for (let i = 0; i <= MAX_EVENT_CHAIN; i += 1) {
      ids.push(
        await t.publishLoop(
          triggerLoop(`hop-${i}`, { subtype: 'event', eventType: `e${i}` }, { emit: `e${i + 1}` }),
        ),
      );
    }
    await t.app.inject({ method: 'POST', url: '/events', payload: { type: 'e0' } });
    await settle();
    const counts = await Promise.all(ids.map(async (id) => (await runsOf(id)).length));
    expect(counts).toEqual([...Array(MAX_EVENT_CHAIN).fill(1), 0]);
    expect(t.logger.lines.some((l) => l.msg === 'event trigger skipped: chain limit reached')).toBe(
      true,
    );
  });
});

describe('poll triggers', () => {
  async function pollContainer() {
    const probes = new FakeProbes();
    const scripts = new FakeScripts();
    const clock = new FakeClock();
    const logger = new CapturingLogger();
    const config = loadConfig({
      // This is a second, independent in-memory store, so it needs its own directory owner.
      GG_DATA_DIR: join(t.dataDir, 'poll-store'),
      GG_DB_URL: ':memory:',
      GG_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
    });
    const container = await createContainer(config, {
      clock,
      probes,
      scripts,
      logger,
      harnesses: { codex: new FakeHarness() },
      startTimers: false,
    });
    await container.start();
    const publish = async (definition: LoopDefinitionInput): Promise<string> => {
      const { loop } = await container.repos.loops.create(
        'local',
        LoopDefinitionSchema.parse(definition),
      );
      const version = await container.repos.loops.publish(loop.id);
      await container.triggers.armVersion(loop, version!);
      return loop.id;
    };
    return { container, probes, scripts, clock, logger, publish };
  }

  it('probes over HTTP and fires once per new dedupe key', async () => {
    const { container, probes, clock, publish } = await pollContainer();
    const id = await publish(
      triggerLoop('poll-http', {
        subtype: 'poll',
        intervalSeconds: 60,
        probe: {
          kind: 'http',
          method: 'POST',
          url: 'https://ci.example/status?at={{ now }}',
          headers: { 'x-check': 'poll-{{ now }}' },
          body: '{"since":"{{ now }}"}',
        },
        fireWhen: 'probe.json.ready = true',
        dedupeKey: 'probe.json.id',
      }),
    );
    expect((await container.triggers.listForLoop(id)).polls).toEqual([
      expect.objectContaining({ triggerNodeId: 'trig', nextPollAt: '2026-10-02T12:01:00.000Z' }),
    ]);
    let reply: { ready: boolean; id: number } = { ready: false, id: 1 };
    probes.respondWith(() => ({ status: 200, headers: {}, body: JSON.stringify(reply) }));
    expect(await container.polls.poll()).toEqual([]);
    expect(probes.requests).toHaveLength(0);

    clock.advance(60_000);
    expect(await container.polls.poll()).toEqual([]);
    expect(probes.requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://ci.example/status?at=2026-10-02T12:01:00.000Z',
      headers: { 'x-check': 'poll-2026-10-02T12:01:00.000Z' },
      body: '{"since":"2026-10-02T12:01:00.000Z"}',
    });

    reply = { ready: true, id: 1 };
    clock.advance(60_000);
    const [run] = await container.polls.poll();
    expect(run?.loopId).toBe(id);
    const thread = await container.repos.runs.getInitialThread(run!.id);
    expect(thread?.invocation.source).toBe('poll');
    expect(thread?.invocation.trigger).toMatchObject({
      kind: 'poll',
      dedupeKey: '1',
      payload: { status: 200, json: { ready: true, id: 1 } },
    });

    clock.advance(60_000);
    expect(await container.polls.poll()).toEqual([]);
    reply = { ready: true, id: 2 };
    probes.respondWith(() => ({ status: 200, headers: {}, body: '', json: reply }));
    clock.advance(60_000);
    expect(await container.polls.poll()).toHaveLength(1);
    await container.stop();
  });

  it('probes with scripts, fires without a dedupe key, and logs failures', async () => {
    const { container, scripts, clock, logger, publish } = await pollContainer();
    await publish(
      triggerLoop('poll-script', {
        subtype: 'poll',
        intervalSeconds: 5,
        probe: { kind: 'script', command: 'check', args: ['--at', '{{ now }}'] },
        fireWhen: 'probe.exitCode = 0',
      }),
    );
    await publish(
      triggerLoop('poll-none', {
        subtype: 'poll',
        intervalSeconds: 5,
        probe: { kind: 'none' },
        fireWhen: '$error("broken")',
      }),
    );
    await publish(
      triggerLoop('poll-off', {
        subtype: 'poll',
        intervalSeconds: 5,
        probe: { kind: 'none' },
        fireWhen: 'true',
        enabled: false,
      }),
    );
    scripts.respondWith(() => ({ exitCode: 0, stdout: 'all good', stderr: '', timedOut: false }));
    clock.advance(5_000);
    const first = await container.polls.poll();
    expect(first).toHaveLength(1);
    expect(scripts.calls[0]).toMatchObject({
      command: 'check',
      args: ['--at', '2026-10-02T12:00:05.000Z'],
    });
    const thread = await container.repos.runs.getInitialThread(first[0]!.id);
    expect(thread?.invocation.trigger.payload).toMatchObject({ json: 'all good', exitCode: 0 });
    expect(thread?.invocation.trigger.dedupeKey).toBeUndefined();
    expect(logger.lines.some((l) => l.msg === 'poll trigger failed')).toBe(true);

    scripts.respondWith(() => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }));
    clock.advance(5_000);
    expect(await container.polls.poll()).toHaveLength(1);
    await container.stop();
  });

  it('skips overlapping polls, polls on an interval, and disarms with the loop', async () => {
    const { container, probes, clock, publish } = await pollContainer();
    const id = await publish(
      triggerLoop('poll-tick', {
        subtype: 'poll',
        intervalSeconds: 5,
        probe: { kind: 'http', url: 'https://example/' },
        fireWhen: 'probe.status = 200',
      }),
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fetch = probes.fetch.bind(probes);
    probes.fetch = async (request, signal) => {
      await gate;
      return fetch(request, signal);
    };
    clock.advance(5_000);
    const first = container.polls.poll();
    expect(await container.polls.poll()).toEqual([]);
    release();
    expect(await first).toHaveLength(1);

    container.polls.start();
    container.polls.start();
    clock.advance(5_000);
    await new Promise((r) => setTimeout(r, 1_200));
    container.polls.stop();
    container.polls.stop();
    expect(probes.requests.length).toBeGreaterThanOrEqual(2);

    await container.triggers.disarmLoop(id);
    expect((await container.triggers.listForLoop(id)).polls).toEqual([]);
    await container.stop();
  });
});

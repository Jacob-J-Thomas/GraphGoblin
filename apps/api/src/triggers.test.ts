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
import { RunManager } from '@graphgoblin/engine';
import { signPayload, signRawBody } from '@graphgoblin/infrastructure/http';
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
    schemaVersion: 2,
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

  it('keeps body business and content receipts durable after a stopped database restart', async () => {
    const clock = new FakeClock();
    const first = await boot(clock);
    const app = await buildApp(first, { logger: false });
    const created = await app.inject({
      method: 'POST',
      url: '/loops',
      payload: {
        definition: triggerLoop(
          'restart-body-key',
          hookTrigger({
            signature: { scheme: 'hmac-sha256-body', secretRef: 'hook-secret' },
            dedupeKey: '$string(number)',
          }),
        ),
      },
    });
    const id = created.json<{ loop: { id: string } }>().loop.id;
    await app.inject({ method: 'PUT', url: '/secrets/hook-secret', payload: { value: 'shh' } });
    expect((await app.inject({ method: 'POST', url: `/loops/${id}/publish` })).statusCode).toBe(
      200,
    );
    const path = (await app.inject(`/loops/${id}/triggers`)).json<TriggerList>().webhooks[0]!.path;
    const send = (body: string) => ({
      method: 'POST' as const,
      url: path,
      payload: body,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signRawBody('shh', Buffer.from(body)),
      },
    });
    expect((await app.inject(send('{"number":7,"updated_at":"first"}'))).statusCode).toBe(202);
    await first.manager.waitForIdle();
    await app.close();
    await first.stop();
    const second = await boot(clock);
    const restarted = await buildApp(second, { logger: false });
    try {
      expect(
        (await restarted.inject(send('{"number":7,"updated_at":"second"}'))).json(),
      ).toMatchObject({ code: 'DUPLICATE_KEY' });
      expect(
        (await restarted.inject(send('{"number":7,"updated_at":"second"}'))).json(),
      ).toMatchObject({ code: 'REPLAYED' });
      expect(await second.repos.runs.list({ loopId: id })).toHaveLength(1);
      expect((await restarted.inject('/events')).json()).toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({ delivery: { state: 'deduplicated', attempts: 0 }, runIds: [] }),
        ]),
      });
    } finally {
      await restarted.close();
      await second.stop();
    }
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

  it('authenticates Buffer request bytes and never persists the presented timestamp signature', async () => {
    await setSecret();
    const { path } = await hookPath();
    const body = '{"title":"Ã©","action":"opened"}\n';
    const timestamp = t.clock.now().toISOString();
    const signature = signPayload('shh', timestamp, body);
    const response = await t.app.inject({
      method: 'POST',
      url: path,
      payload: Buffer.from(body),
      headers: {
        'content-type': 'application/json',
        'x-graphgoblin-timestamp': timestamp,
        'x-graphgoblin-signature': signature,
      },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      event: {
        payload: { title: 'Ã©', action: 'opened' },
        dedupeKey: expect.stringMatching(/^sig-hash:[a-f0-9]{64}$/),
      },
    });
    expect(response.body).not.toContain(signature);
    expect(JSON.stringify(await t.container.repos.inbound.list('local'))).not.toContain(signature);
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: path,
          payload: body.trimEnd(),
          headers: {
            'content-type': 'application/json',
            'x-graphgoblin-timestamp': timestamp,
            'x-graphgoblin-signature': signature,
          },
        })
      ).statusCode,
    ).toBe(401);
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

describe('body signing and durable admission', () => {
  const bodyHook = (extra: Record<string, unknown> = {}) =>
    hookTrigger({ signature: { scheme: 'hmac-sha256-body', secretRef: 'hook-secret' }, ...extra });
  async function bodyDelivery(
    path: string,
    body: string,
    extra: Record<string, string> = {},
    secret = 'shh',
  ) {
    return t.app.inject({
      method: 'POST',
      url: path,
      payload: body,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signRawBody(secret, Buffer.from(body)),
        ...extra,
      },
    });
  }
  it.each(
    (['hmac-sha256', 'hmac-sha256-body'] as const).flatMap((scheme) =>
      ['X-Hub-Signature-256', 'X-Custom-Signature'].flatMap((configuredHeader) =>
        [configuredHeader.toLowerCase(), configuredHeader].map((presentedHeader) => ({
          scheme,
          configuredHeader,
          presentedHeader,
        })),
      ),
    ),
  )(
    'excludes the $scheme credential header $presentedHeader before authoring dedupe keys',
    async ({ scheme, configuredHeader, presentedHeader }) => {
      await setSecret();
      const id = await t.publishLoop(
        triggerLoop(
          'credential-binding',
          hookTrigger({
            signature: { scheme, header: configuredHeader, secretRef: 'hook-secret' },
            dedupeKey: '$lookup($headers, ' + JSON.stringify(presentedHeader) + ')',
          }),
        ),
      );
      const path = (await triggersOf(t, id)).webhooks[0]!.path;
      const body = '{"id":1,"headerLikePayload":"authored application data"}';
      const timestamp = t.clock.now().toISOString();
      const signature =
        scheme === 'hmac-sha256-body'
          ? signRawBody('shh', Buffer.from(body))
          : signPayload('shh', timestamp, body);
      const result = await t.container.triggers.handleWebhook(
        path.slice('/hooks/'.length),
        Buffer.from(body),
        {
          [presentedHeader]: signature,
          'x-graphgoblin-timestamp': timestamp,
          'x-github-delivery': 'delivery-1',
        },
      );
      expect(result).toMatchObject({
        kind: 'accepted',
        filtered: false,
        event: { dedupeKey: expect.stringMatching(/^sig-hash:[a-f0-9]{64}$/) },
      });
      if (result.kind !== 'accepted' || !result.runId)
        throw new Error('expected admitted delivery');
      await t.idle();
      const initialThread = await t.container.repos.runs.getInitialThread(result.runId);
      expect(initialThread?.invocation.trigger.payload).toEqual(JSON.parse(body));
      const persisted = JSON.stringify({
        receipts: (await t.container.handle.client.execute('SELECT * FROM webhook_receipts')).rows,
        inbound: await t.container.repos.inbound.list('local'),
        initialThread,
        snapshot: await t.container.repos.runs.getThread(result.runId),
        events: await t.container.repos.events.read(result.runId),
        listedEvents: (await t.app.inject('/events')).json(),
        response: result,
        diagnostics: t.logger.lines,
      });
      expect(persisted).not.toContain(signature);
      expect(persisted).not.toContain(signature.slice(7));
    },
  );
  it.each(['hmac-sha256', 'hmac-sha256-body'] as const)(
    'shares credential-free $headers with the %s filter and retains delivery/timestamp metadata',
    async (scheme) => {
      await setSecret();
      const id = await t.publishLoop(
        triggerLoop(
          'filter-credential-binding',
          hookTrigger({
            signature: { scheme, header: 'X-Custom-Signature', secretRef: 'hook-secret' },
            dedupeKey: '$string($headers)',
            filter:
              '$not($exists($headers."x-custom-signature")) and $not($exists($headers."X-Custom-Signature")) and $headers."x-github-delivery" = "delivery-1" and $exists($headers."x-graphgoblin-timestamp")',
          }),
        ),
      );
      const path = (await triggersOf(t, id)).webhooks[0]!.path;
      const body = '{"id":1}';
      const timestamp = t.clock.now().toISOString();
      const signature =
        scheme === 'hmac-sha256-body'
          ? signRawBody('shh', Buffer.from(body))
          : signPayload('shh', timestamp, body);
      const headers = {
        'X-Custom-Signature': signature,
        'x-graphgoblin-timestamp': timestamp,
        'x-github-delivery': 'delivery-1',
        'x-ordinary-list': ['first', 'second'],
        'x-nonstring': 1,
      };
      const result = await t.container.triggers.handleWebhook(
        path.slice('/hooks/'.length),
        Buffer.from(body),
        headers,
      );
      expect(result).toMatchObject({ kind: 'accepted', filtered: false });
      if (result.kind !== 'accepted' || !result.runId)
        throw new Error('expected admitted delivery');
      expect(JSON.parse(result.event.dedupeKey!)).toEqual({
        'x-graphgoblin-timestamp': timestamp,
        'x-github-delivery': 'delivery-1',
        'x-ordinary-list': 'first',
      });
      await t.idle();
      const evidence = JSON.stringify({
        result,
        receipts: (await t.container.handle.client.execute('SELECT * FROM webhook_receipts')).rows,
        thread: await t.container.repos.runs.getThread(result.runId),
        events: await t.container.repos.events.read(result.runId),
        diagnostics: t.logger.lines,
      });
      expect(evidence).not.toContain(signature);
      expect(evidence).not.toContain(signature.slice(7));
      expect(
        (
          await t.app.inject({
            method: 'PUT',
            url: '/loops/' + id + '/draft',
            payload: {
              definition: triggerLoop(
                'filter-credential-binding',
                hookTrigger({
                  signature: { scheme, header: 'X-Custom-Signature', secretRef: 'hook-secret' },
                  filter: '$error($string($headers))',
                }),
              ),
            },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (await t.app.inject({ method: 'POST', url: '/loops/' + id + '/publish' })).statusCode,
      ).toBe(200);
      const errorResult = await t.container.triggers.handleWebhook(
        path.slice('/hooks/'.length),
        Buffer.from(body),
        headers,
      );
      expect(errorResult).toMatchObject({ kind: 'error', status: 422, code: 'EXPRESSION_FAILED' });
      expect(JSON.stringify({ errorResult, diagnostics: t.logger.lines })).not.toContain(signature);
    },
  );
  it('rejects overlong body business keys before consuming content, preserves exact boundary keys and legacy timestamp truncation', async () => {
    await setSecret();
    const id = await t.publishLoop(triggerLoop('body-key-length', bodyHook({ dedupeKey: 'key' })));
    const path = (await triggersOf(t, id)).webhooks[0]!.path;
    const prefix = 'k'.repeat(512);
    const bodies = ['one', 'two'].map((suffix) => JSON.stringify({ key: prefix + suffix }));
    for (const body of bodies)
      expect((await bodyDelivery(path, body)).json()).toMatchObject({
        status: 422,
        code: 'EXPRESSION_FAILED',
      });
    expect(
      (await t.container.handle.client.execute('SELECT * FROM webhook_receipts')).rows,
    ).toEqual([]);
    expect((await t.container.handle.client.execute('SELECT * FROM inbound_events')).rows).toEqual(
      [],
    );
    expect(await runsOf(id)).toEqual([]);
    expect((await bodyDelivery(path, JSON.stringify({ key: prefix }))).statusCode).toBe(202);
    await t.idle();
    expect(
      (await t.container.repos.runs.getInitialThread((await runsOf(id))[0]!.id))?.invocation.trigger
        .dedupeKey,
    ).toBe(prefix);
    const legacy = await t.publishLoop(
      triggerLoop('timestamp-key-length', hookTrigger({ dedupeKey: 'key' })),
    );
    const legacyPath = (await triggersOf(t, legacy)).webhooks[0]!.path;
    expect((await deliver(legacyPath, bodies[0]!)).statusCode).toBe(202);
    await t.idle();
    expect(
      (await t.container.repos.runs.getInitialThread((await runsOf(legacy))[0]!.id))?.invocation
        .trigger.dedupeKey,
    ).toBe(prefix);
  });
  it.each(['hmac-sha256', 'hmac-sha256-body'] as const)(
    'logs safe operational context for a missing %s secret',
    async (scheme) => {
      const id = await t.publishLoop(
        triggerLoop(
          'missing-secret-' + scheme,
          hookTrigger({ signature: { scheme, secretRef: 'hook-secret' } }),
        ),
      );
      const endpoint = (await triggersOf(t, id)).webhooks[0]!;
      const response =
        scheme === 'hmac-sha256-body'
          ? await bodyDelivery(endpoint.path, '{}')
          : await deliver(endpoint.path, '{}');
      expect(response.json()).toMatchObject({ status: 503, code: 'HOOK_NOT_READY' });
      expect(t.logger.lines).toContainEqual({
        level: 'warn',
        obj: { endpointId: endpoint.id, secretRef: 'hook-secret' },
        msg: 'webhook secret is not set',
      });
      expect(JSON.stringify(t.logger.lines)).not.toContain(signRawBody('shh', Buffer.from('{}')));
    },
  );
  it.each(['{}', 'not-json'])(
    'isolates a corrupt pending intent (%s) during real SQLite boot recovery and admits other due receipts',
    async (corruptIntent) => {
      await setSecret();
      const id = await t.publishLoop(triggerLoop('malformed-pending', bodyHook()));
      const path = (await triggersOf(t, id)).webhooks[0]!.path;
      vi.spyOn(t.container.ports.admission, 'create')
        .mockRejectedValueOnce(new Error('retry'))
        .mockRejectedValueOnce(new Error('retry'));
      expect((await bodyDelivery(path, '{"id":1}')).statusCode).toBe(503);
      expect((await bodyDelivery(path, '{"id":2}')).statusCode).toBe(503);
      const rows = (
        await t.container.handle.client.execute(
          'SELECT id,intent FROM webhook_receipts ORDER BY id',
        )
      ).rows;
      const badId = rows[0]!.id;
      if (typeof badId !== 'string') throw new Error('receipt ID missing');
      await t.container.handle.client.execute({
        sql: 'UPDATE webhook_receipts SET intent=? WHERE id=?',
        args: [corruptIntent, badId],
      });
      t.container.manager.stop();
      t.clock.advance(5000);
      const restarted = new RunManager(t.container.ports, t.container.settings);
      try {
        await expect(restarted.start()).resolves.toBeUndefined();
        await restarted.waitForIdle();
        expect(
          (
            await t.container.handle.client.execute({
              sql: 'SELECT status,failure_code FROM webhook_receipts WHERE id=?',
              args: [badId],
            })
          ).rows[0],
        ).toMatchObject({ status: 'failed', failure_code: 'WEBHOOK_INTENT_CONFLICT' });
        expect(
          (
            await t.container.handle.client.execute(
              "SELECT * FROM webhook_receipts WHERE status='admitted'",
            )
          ).rows,
        ).toHaveLength(1);
        expect(await runsOf(id)).toHaveLength(1);
        expect(await restarted.loopInUse(id)).toBe(false);
        await restarted.retryPendingWebhooks();
        expect(await runsOf(id)).toHaveLength(1);
      } finally {
        restarted.stop();
        await restarted.waitForWebhookRecovery();
      }
    },
  );
  it('verifies raw body without timestamp and consumes content across headers, rotation and republish', async () => {
    await setSecret();
    const id = await t.publishLoop(
      triggerLoop('github-body', bodyHook({ dedupeKey: '$headers."x-github-delivery"' })),
    );
    const path = (await triggersOf(t, id)).webhooks[0]!.path;
    const body = ' {"action":"opened","id":1} ';
    expect((await bodyDelivery(path, body, { 'x-github-delivery': 'first' })).statusCode).toBe(202);
    await t.idle();
    const signature = signRawBody('shh', Buffer.from(body));
    expect(
      (
        await bodyDelivery(path, body, {
          'x-github-delivery': 'second',
          'x-hub-signature-256': 'sha256=' + signature.slice(7).toUpperCase(),
        })
      ).statusCode,
    ).toBe(409);
    await setSecret('rotated');
    await t.app.inject({
      method: 'PUT',
      url: `/loops/${id}/draft`,
      payload: { definition: triggerLoop('github-body', bodyHook({ dedupeKey: '"changed"' })) },
    });
    await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` });
    expect((await bodyDelivery(path, body, {}, 'rotated')).statusCode).toBe(409);
    t.clock.advance(86400_000);
    expect((await bodyDelivery(path, body, {}, 'rotated')).statusCode).toBe(409);
    expect(await runsOf(id)).toHaveLength(1);
    const records = (await t.app.inject('/events')).json<{ items: unknown[] }>();
    expect(JSON.stringify(records)).not.toContain(signature);
    expect(records.items).toEqual([
      expect.objectContaining({ delivery: { state: 'admitted', attempts: 0 } }),
    ]);
  });
  it('consumes distinct bodies with the same authored business key without another run', async () => {
    await setSecret();
    const id = await t.publishLoop(
      triggerLoop('body-business-key', bodyHook({ dedupeKey: '$string(number)' })),
    );
    const path = (await triggersOf(t, id)).webhooks[0]!.path;
    expect((await bodyDelivery(path, '{"number":7,"updated_at":"first"}')).statusCode).toBe(202);
    const second = await bodyDelivery(path, '{"number":7,"updated_at":"second"}');
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ code: 'DUPLICATE_KEY' });
    await t.idle();
    expect(await runsOf(id)).toHaveLength(1);
    expect((await t.app.inject('/events')).json()).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ delivery: { state: 'deduplicated', attempts: 0 }, runIds: [] }),
      ]),
    });
    const repeated = await bodyDelivery(path, '{"number":7,"updated_at":"second"}');
    expect(repeated.statusCode).toBe(409);
    expect(repeated.json()).toMatchObject({ code: 'REPLAYED' });
  });
  it('serializes concurrent distinct bodies with one key and keeps loop keys isolated', async () => {
    await setSecret();
    const config = bodyHook({ dedupeKey: '$string(number)' });
    const id = await t.publishLoop(triggerLoop('body-concurrent-key', config));
    const path = (await triggersOf(t, id)).webhooks[0]!.path;
    const deliveries = await Promise.all([
      bodyDelivery(path, '{"number":9,"updated_at":"one"}'),
      bodyDelivery(path, '{"number":9,"updated_at":"two"}'),
    ]);
    expect(deliveries.map((r) => r.statusCode).sort()).toEqual([202, 409]);
    expect(deliveries.find((r) => r.statusCode === 409)?.json()).toMatchObject({
      code: 'DUPLICATE_KEY',
    });
    await t.idle();
    expect(await runsOf(id)).toHaveLength(1);
    const other = await t.publishLoop(triggerLoop('body-other-loop-key', config));
    expect(
      (
        await bodyDelivery(
          (await triggersOf(t, other)).webhooks[0]!.path,
          '{"number":9,"updated_at":"three"}',
        )
      ).statusCode,
    ).toBe(202);
    await t.idle();
    expect(await runsOf(other)).toHaveLength(1);
  });
  it('keeps authored filtered and pending keys consumed before any run exists', async () => {
    await setSecret();
    const id = await t.publishLoop(
      triggerLoop('body-filter-key', bodyHook({ filter: 'false', dedupeKey: '"fixed"' })),
    );
    const path = (await triggersOf(t, id)).webhooks[0]!.path;
    expect((await bodyDelivery(path, '{"id":1}')).statusCode).toBe(202);
    await t.app.inject({
      method: 'PUT',
      url: `/loops/${id}/draft`,
      payload: { definition: triggerLoop('body-filter-key', bodyHook({ dedupeKey: '"fixed"' })) },
    });
    expect((await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` })).statusCode).toBe(
      200,
    );
    expect((await bodyDelivery(path, '{"id":2}')).json()).toMatchObject({ code: 'DUPLICATE_KEY' });
    expect(await runsOf(id)).toHaveLength(0);
    expect(await t.container.ports.admission.hasPendingPin(id)).toBe(false);
    const pending = await t.publishLoop(
      triggerLoop('body-pending-key', bodyHook({ dedupeKey: '"fixed"' })),
    );
    const pendingPath = (await triggersOf(t, pending)).webhooks[0]!.path;
    const create = vi
      .spyOn(t.container.ports.admission, 'create')
      .mockRejectedValueOnce(new Error('test-dispatch-failure'));
    expect((await bodyDelivery(pendingPath, '{"id":1}')).statusCode).toBe(503);
    expect((await bodyDelivery(pendingPath, '{"id":2}')).json()).toMatchObject({
      code: 'DUPLICATE_KEY',
    });
    expect(create).toHaveBeenCalledTimes(1);
    t.clock.advance(5000);
    await t.container.manager.retryPendingWebhooks();
    await t.idle();
    expect(await runsOf(pending)).toHaveLength(1);
  });
  it('includes earlier timestamp run keys in body dedupe while the timestamp receiver keeps its window', async () => {
    await setSecret();
    const id = await t.publishLoop(
      triggerLoop('scheme-key', hookTrigger({ dedupeKey: '"fixed"', replayWindowSeconds: 1 })),
    );
    const path = (await triggersOf(t, id)).webhooks[0]!.path;
    expect((await deliver(path, '{"id":1}')).statusCode).toBe(202);
    await t.idle();
    t.clock.advance(2000);
    await t.app.inject({
      method: 'PUT',
      url: `/loops/${id}/draft`,
      payload: { definition: triggerLoop('scheme-key', bodyHook({ dedupeKey: '"fixed"' })) },
    });
    expect((await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` })).statusCode).toBe(
      200,
    );
    expect((await bodyDelivery(path, '{"id":2}')).json()).toMatchObject({ code: 'DUPLICATE_KEY' });
    await t.app.inject({
      method: 'PUT',
      url: `/loops/${id}/draft`,
      payload: {
        definition: triggerLoop(
          'scheme-key',
          hookTrigger({ dedupeKey: '"fixed"', replayWindowSeconds: 1 }),
        ),
      },
    });
    expect((await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` })).statusCode).toBe(
      200,
    );
    t.clock.advance(2000);
    expect((await deliver(path, '{"id":3}')).statusCode).toBe(202);
    await t.idle();
    expect(await runsOf(id)).toHaveLength(2);
  });
  it.each(['after-lookup', 'still-pending'] as const)(
    'reserves an old webhook key from items-mode poll admission when recovery is %s',
    async (ordering) => {
      await setSecret();
      const id = await t.publishLoop(
        triggerLoop('recovery-poll-race', bodyHook({ dedupeKey: '"same"' })),
      );
      const path = (await triggersOf(t, id)).webhooks[0]!.path;
      vi.spyOn(t.container.ports.admission, 'create').mockRejectedValueOnce(new Error('retry'));
      expect((await bodyDelivery(path, '{"key":"same"}')).statusCode).toBe(503);
      const pollConfig = {
        subtype: 'poll',
        intervalSeconds: 5,
        probe: { kind: 'script', command: 'fake-gh' },
        fireWhen: 'true',
        items: { select: 'probe.json', dedupeKey: 'item.key', maxRunsPerPoll: 1 },
      };
      await t.app.inject({
        method: 'PUT',
        url: `/loops/${id}/draft`,
        payload: { definition: triggerLoop('recovery-poll-race', pollConfig) },
      });
      expect((await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` })).statusCode).toBe(
        200,
      );
      vi.spyOn(t.container.ports.scripts, 'run').mockResolvedValue({
        exitCode: 0,
        stdout: '[{"key":"same"},{"key":"next"}]',
        stderr: '',
        timedOut: false,
        stdoutOverflow: false,
      });
      const read = t.container.repos.runs.findTriggerDedupeKeys.bind(t.container.repos.runs);
      vi.spyOn(t.container.repos.runs, 'findTriggerDedupeKeys').mockImplementationOnce(
        async (...args) => {
          const seen = await read(...args);
          expect(seen.size).toBe(0);
          if (ordering === 'after-lookup') await t.container.manager.retryPendingWebhooks();
          return seen;
        },
      );
      t.clock.advance(5000);
      const admitted = await t.container.polls.poll();
      expect(admitted).toHaveLength(1);
      expect(
        (await t.container.repos.runs.getInitialThread(admitted[0]!.id))?.invocation.trigger
          .payload,
      ).toEqual({ key: 'next' });
      if (ordering === 'still-pending') await t.container.manager.retryPendingWebhooks();
      await t.idle();
      expect(await runsOf(id)).toHaveLength(2);
    },
  );
  it('consumes an authored body key when a current poll wins before the old authenticated claim', async () => {
    await setSecret();
    const id = await t.publishLoop(
      triggerLoop('poll-before-claim', bodyHook({ dedupeKey: '"same"' })),
    );
    const path = (await triggersOf(t, id)).webhooks[0]!.path;
    let entered!: () => void, release!: () => void;
    const blocked = new Promise<void>((resolve) => {
        entered = resolve;
      }),
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    const receive = t.container.manager.receiveWebhook.bind(t.container.manager);
    vi.spyOn(t.container.manager, 'receiveWebhook').mockImplementationOnce(async (...args) => {
      entered();
      await gate;
      return receive(...args);
    });
    const delivery = bodyDelivery(path, '{"key":"same"}');
    try {
      await blocked;
      const pollConfig = {
        subtype: 'poll',
        intervalSeconds: 5,
        probe: { kind: 'script', command: 'fake-gh' },
        fireWhen: 'true',
        items: { select: 'probe.json', dedupeKey: 'item.key' },
      };
      await t.app.inject({
        method: 'PUT',
        url: `/loops/${id}/draft`,
        payload: { definition: triggerLoop('poll-before-claim', pollConfig) },
      });
      expect((await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` })).statusCode).toBe(
        200,
      );
      vi.spyOn(t.container.ports.scripts, 'run').mockResolvedValue({
        exitCode: 0,
        stdout: '[{"key":"same"}]',
        stderr: '',
        timedOut: false,
        stdoutOverflow: false,
      });
      t.clock.advance(5000);
      expect(await t.container.polls.poll()).toHaveLength(1);
      release();
      const response = await delivery;
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'DUPLICATE_KEY' });
      await t.idle();
      expect(await runsOf(id)).toHaveLength(1);
      expect(await t.container.ports.admission.hasPendingPin(id)).toBe(false);
    } finally {
      release();
      await delivery;
    }
  });
  it('does not activate business dedupe for generated signature hints', async () => {
    await setSecret();
    const id = await t.publishLoop(triggerLoop('body-no-authored-key', bodyHook()));
    const path = (await triggersOf(t, id)).webhooks[0]!.path;
    expect((await bodyDelivery(path, '{"id":1}')).statusCode).toBe(202);
    expect((await bodyDelivery(path, '{"id":2}')).statusCode).toBe(202);
    await t.idle();
    expect(await runsOf(id)).toHaveLength(2);
  });
  it('keeps filtered content consumed after filter correction, and rejects invalid signatures before JSON', async () => {
    await setSecret();
    const id = await t.publishLoop(triggerLoop('body-filter', bodyHook({ filter: 'false' })));
    const path = (await triggersOf(t, id)).webhooks[0]!.path;
    const body = '{"action":"ping"}';
    expect((await bodyDelivery(path, body)).json()).toMatchObject({ filtered: true });
    await t.app.inject({
      method: 'PUT',
      url: `/loops/${id}/draft`,
      payload: { definition: triggerLoop('body-filter', bodyHook()) },
    });
    await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` });
    expect((await bodyDelivery(path, body)).statusCode).toBe(409);
    expect(await runsOf(id)).toHaveLength(0);
    expect(
      (await bodyDelivery(path, 'broken', { 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) }))
        .statusCode,
    ).toBe(401);
    expect((await bodyDelivery(path, 'broken')).statusCode).toBe(400);
    expect((await t.app.inject('/events')).json()).toMatchObject({
      items: [{ delivery: { state: 'filtered', attempts: 0 } }],
    });
  });
  it('returns safe 503 with a persisted pending intent, blocks deletion, and recovers before redelivery', async () => {
    await setSecret();
    const id = await t.publishLoop(triggerLoop('body-pending', bodyHook()));
    const path = (await triggersOf(t, id)).webhooks[0]!.path;
    vi.spyOn(t.container.ports.admission, 'create').mockRejectedValueOnce(
      new Error('secret-marker'),
    );
    const response = await bodyDelivery(path, '{"id":2}');
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('secret-marker');
    expect((await t.app.inject({ method: 'DELETE', url: `/loops/${id}` })).statusCode).toBe(409);
    expect((await t.app.inject('/events')).json()).toMatchObject({
      items: [
        { delivery: { state: 'pending', attempts: 1, failureCode: 'WEBHOOK_ADMISSION_RETRY' } },
      ],
    });
    t.clock.advance(5000);
    await t.container.manager.retryPendingWebhooks();
    await t.idle();
    expect(await runsOf(id)).toHaveLength(1);
    expect((await bodyDelivery(path, '{"id":2}')).statusCode).toBe(409);
  });
});

describe('bounded items-mode poll integration', () => {
  const config = (extra: Record<string, unknown> = {}) => ({
    subtype: 'poll',
    intervalSeconds: 5,
    probe: { kind: 'script', command: 'fake-gh' },
    fireWhen: 'true',
    items: { select: 'probe.json', dedupeKey: '$string(item.id)' },
    ...extra,
  });
  const result = (stdout: string, extra: Record<string, unknown> = {}) => ({
    exitCode: 0,
    stdout,
    stderr: 'credential-marker',
    timedOut: false,
    stdoutOverflow: false,
    ...extra,
  });
  it('validates all candidates before one indexed lookup, drains cap across sweeps, and uses item payloads', async () => {
    const id = await t.publishLoop(triggerLoop('items-drain', config()));
    const items = Array.from({ length: 8 }, (_, id) => ({ id: id + 1 }));
    const script = vi
      .spyOn(t.container.ports.scripts, 'run')
      .mockResolvedValue(result(JSON.stringify(items)));
    const lookup = vi.spyOn(t.container.repos.runs, 'findTriggerDedupeKeys');
    t.clock.advance(5000);
    const first = await t.container.polls.poll();
    expect(first).toHaveLength(5);
    await t.idle();
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(script.mock.calls[0]![0].maxStdoutBytes).toBe(65536);
    expect(
      (await t.container.repos.runs.getInitialThread(first[0]!.id))?.invocation.trigger.payload,
    ).toEqual({ id: 1 });
    t.clock.advance(5000);
    expect(await t.container.polls.poll()).toHaveLength(3);
    await t.idle();
    t.clock.advance(5000);
    expect(await t.container.polls.poll()).toHaveLength(0);
    expect(await runsOf(id)).toHaveLength(8);
    expect(
      JSON.stringify(await t.container.repos.runs.getInitialThread(first[0]!.id)),
    ).not.toContain('credential-marker');
    script.mockResolvedValue(result(JSON.stringify([{ id: 9 }, { id: 9 }])));
    t.clock.advance(5000);
    lookup.mockClear();
    expect(await t.container.polls.poll()).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
    expect(t.logger.lines).toContainEqual(
      expect.objectContaining({
        obj: expect.objectContaining({ code: 'POLL_ITEMS_INVALID', reason: 'KEY_DUPLICATE' }),
      }),
    );
  });
  it('refuses failed/timeout/overflow/unbounded/invalid JSON probes only in new items mode', async () => {
    await t.publishLoop(triggerLoop('items-probe', config()));
    const script = vi.spyOn(t.container.ports.scripts, 'run');
    const lookup = vi.spyOn(t.container.repos.runs, 'findTriggerDedupeKeys');
    for (const output of [
      result('[]', { exitCode: 1 }),
      result('[]', { timedOut: true }),
      result('[]', { stdoutOverflow: true }),
      result('broken'),
    ]) {
      script.mockResolvedValue(output);
      t.clock.advance(5000);
      expect(await t.container.polls.poll()).toEqual([]);
    }
    expect(lookup).not.toHaveBeenCalled();
    expect(t.logger.lines.map((line) => line.obj.code)).toEqual(
      expect.arrayContaining([
        'POLL_PROBE_FAILED',
        'POLL_PROBE_TIMED_OUT',
        'POLL_STDOUT_OVERFLOW',
        'POLL_JSON_INVALID',
      ]),
    );
  });
  it('skips overlapping sweeps even after republish, and admission failure leaves the unseen tail', async () => {
    const id = await t.publishLoop(triggerLoop('items-overlap', config()));
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    vi.spyOn(t.container.ports.scripts, 'run').mockImplementation(async () => {
      await gate;
      return result('[{"id":1},{"id":2},{"id":3}]');
    });
    t.clock.advance(5000);
    const first = t.container.polls.poll();
    await t.app.inject({
      method: 'PUT',
      url: `/loops/${id}/draft`,
      payload: { definition: triggerLoop('items-overlap', config()) },
    });
    await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` });
    t.clock.advance(5000);
    expect(await t.container.polls.poll()).toEqual([]);
    vi.spyOn(t.container.ports.admission, 'createPollItem').mockRejectedValueOnce(
      new Error('start-failed'),
    );
    release();
    expect(await first).toEqual([]);
    t.clock.advance(5000);
    expect(await t.container.polls.poll()).toHaveLength(3);
    await t.idle();
    expect(await runsOf(id)).toHaveLength(3);
  });
});

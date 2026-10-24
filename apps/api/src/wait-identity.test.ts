import { afterEach, describe, expect, inject, it } from 'vitest';
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { FakeClock } from '@graphgoblin/engine/testing';
import { SqliteRunRepository, SqliteTimerStore } from '@graphgoblin/infrastructure/sqlite';
import { RunManager } from '@graphgoblin/engine';
import { TimerService } from '@graphgoblin/infrastructure/scheduler';
import { createTestApp, type TestApp, type TestAppOptions } from './testing/test-app.js';
import { buildApp } from './app.js';

const opened: TestApp[] = [];
afterEach(async () => {
  for (const t of opened.splice(0)) await t.close();
});
async function setup(options: TestAppOptions = {}) {
  const t = await createTestApp(options);
  opened.push(t);
  return t;
}
function repeated(kind: 'wait' | 'heartbeat' = 'wait'): LoopDefinitionInput {
  return {
    schemaVersion: 4,
    name: 'Repeated wait',
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      kind === 'wait'
        ? { id: 'work', kind, label: 'Work', config: { mode: 'input', prompt: 'Answer' } }
        : {
            id: 'work',
            kind,
            label: 'Work',
            config: {
              intervalSeconds: 1,
              probe: { kind: 'signal-count', name: 'tick' },
              until: 'probe.count >= 1',
              maxBeats: 10,
            },
          },
      {
        id: 'gate',
        kind: 'decision',
        label: 'Gate',
        config: {
          kind: 'expression',
          jsonata: 'gates.gate.passes < 2 ? "repeat" : "done"',
          routes: [
            { id: 'repeat', label: 'Repeat', repeat: true },
            { id: 'done', label: 'Done' },
          ],
          maxPasses: 3,
        },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'outputs.work.value' } },
      { id: 'limit', kind: 'exit', label: 'Limit', config: { outcome: 'exhausted' } },
    ],
    edges: [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
      { id: 'b', from: { node: 'work', port: 'out' }, to: { node: 'gate' } },
      { id: 'c', from: { node: 'gate', port: 'repeat' }, to: { node: 'work' } },
      { id: 'd', from: { node: 'gate', port: 'done' }, to: { node: 'done' } },
      { id: 'e', from: { node: 'gate', port: 'limit-reached' }, to: { node: 'limit' } },
    ],
  };
}
async function start(t: TestApp, definition: LoopDefinitionInput) {
  const loopId = await t.publishLoop(definition);
  const run = await t.container.manager.startRun({
    ownerId: 'local',
    loopId,
    source: 'manual.api',
  });
  await t.idle();
  return (await t.container.manager.getRun(run.id))!;
}
async function observed(t: TestApp, id: string) {
  const run = (await t.app.inject('/runs/' + id)).json<{
    waiting?: { waitId?: string; startedSeq?: number };
  }>();
  if (!run.waiting?.waitId) throw new Error('No observed wait');
  return run.waiting.waitId;
}

describe('observed wait identities over real SQLite and API', () => {
  it('rejects visit A answers at visit B without mutation, and accepts B once', async () => {
    const t = await setup();
    const run = await start(t, repeated());
    const a = await observed(t, run.id);
    const answer = (waitId: string, input: string) =>
      t.app.inject({
        method: 'POST',
        url: '/runs/' + run.id + '/input',
        payload: { waitId, input },
      });
    expect((await answer(a, 'A')).statusCode).toBe(200);
    await t.idle();
    expect((await t.container.manager.getRun(run.id))?.status).toBe('waiting');
    const b = await observed(t, run.id);
    expect(b).not.toBe(a);
    const before = await t.container.ports.events.read(run.id);
    const stale = await answer(a, 'stale A');
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'WAIT_MISMATCH' });
    expect(await t.container.ports.events.read(run.id)).toEqual(before);
    expect((await answer(b, 'B')).statusCode).toBe(200);
    await t.idle();
    expect((await answer(b, 'duplicate B')).statusCode).toBe(409);
    expect((await t.container.manager.getRun(run.id))?.result).toBe('B');
  });
  it('resets signal observations on a genuine heartbeat revisit', async () => {
    const t = await setup();
    const run = await start(t, repeated('heartbeat'));
    const a = await observed(t, run.id);
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/runs/' + run.id + '/signals/tick',
          payload: { waitId: a },
        })
      ).statusCode,
    ).toBe(200);
    t.clock.advance(1000);
    await t.container.timers.poll();
    await t.idle();
    const b = await t.container.manager.getRun(run.id);
    expect(b?.status).toBe('waiting');
    expect(b?.waiting?.beat).toBe(1);
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/runs/' + run.id + '/signals/tick',
          payload: { waitId: a },
        })
      ).statusCode,
    ).toBe(409);
  });
  it('cannot lose a timer delivered synchronously by the injected timer port around parking', async () => {
    const t = await setup();
    t.container.manager.stop();
    const manager = new RunManager(
      {
        ...t.container.ports,
        timers: {
          schedule: async (id, key, at) => {
            await t.container.timers.schedule(id, key, at);
            await t.container.timers.poll();
          },
          cancel: (id, key) => t.container.timers.cancel(id, key),
          onFire: (listener) => t.container.timers.onFire(listener),
        },
      },
      t.container.settings,
    );
    await manager.start();
    try {
      const definition = repeated();
      definition.nodes[1] = {
        id: 'work',
        kind: 'wait',
        label: 'Timer',
        config: { mode: 'until', timestamp: '2026-10-02T12:00:00.000Z' },
      };
      const loopId = await t.publishLoop(definition);
      const run = await manager.startRun({ ownerId: 'local', loopId, source: 'manual.api' });
      await manager.waitForIdle();
      expect((await manager.getRun(run.id))?.status).toBe('succeeded');
    } finally {
      manager.stop();
    }
  });
});

function singleWait(
  config: Extract<LoopDefinitionInput['nodes'][number], { kind: 'wait' }>['config'],
): LoopDefinitionInput {
  const def = repeated();
  def.nodes = [def.nodes[0]!, { id: 'work', kind: 'wait', label: 'Wait', config }, def.nodes[3]!];
  def.edges = [
    def.edges[0]!,
    { id: 'end', from: { node: 'work', port: 'out' }, to: { node: 'done' } },
  ];
  return def;
}
async function closeForRestart(t: TestApp) {
  opened.splice(opened.indexOf(t), 1);
  await t.close();
}
async function diskEnv() {
  const dir = await mkdtemp(join(inject('waitStorageRoot'), 'gg-wp-c2-'));
  return { GG_DATA_DIR: dir, GG_DB_URL: 'file:' + join(dir, 'store.db') };
}
describe('durable wait boundaries', () => {
  it('accepts only one racing API answer and rejects retry without changing the log', async () => {
    const t = await setup();
    const r = await start(t, singleWait({ mode: 'input', prompt: 'Race' }));
    const waitId = await observed(t, r.id);
    const send = (input: string) =>
      t.app.inject({ method: 'POST', url: '/runs/' + r.id + '/input', payload: { waitId, input } });
    const responses = await Promise.all([send('one'), send('two')]);
    expect(responses.map((x) => x.statusCode).sort()).toEqual([200, 409]);
    expect(responses.find((x) => x.statusCode === 409)?.json()).toMatchObject({
      code: 'WAIT_MISMATCH',
    });
    await t.idle();
    const before = await t.container.ports.events.read(r.id);
    expect((await send('retry')).statusCode).toBe(409);
    expect(await t.container.ports.events.read(r.id)).toEqual(before);
    expect(before.filter((e) => e.type === 'input.received')).toHaveLength(1);
    expect(before.filter((e) => e.type === 'run.woken')).toHaveLength(1);
  });
  it('keeps the observed identity when SQLite is closed and reopened', async () => {
    const env = await diskEnv();
    const first = await setup({ env });
    const r = await start(first, singleWait({ mode: 'input', prompt: 'Persist' }));
    const waitId = await observed(first, r.id);
    await closeForRestart(first);
    const next = await setup({ env });
    expect(await observed(next, r.id)).toBe(waitId);
    expect(
      (
        await next.app.inject({
          method: 'POST',
          url: '/runs/' + r.id + '/input',
          payload: { waitId, input: 'saved' },
        })
      ).statusCode,
    ).toBe(200);
    await next.idle();
    expect((await next.container.manager.getRun(r.id))?.result).toBe('saved');
  });
  it.each([50, 1000])(
    'recovers an event-first park and its passed deadline at %i ms polling',
    async (poll) => {
      const env = { ...(await diskEnv()), GG_TIMER_POLL_MS: String(poll) };
      const first = await setup({ env });
      const r = await start(
        first,
        singleWait({ mode: 'until', timestamp: '2026-10-02T12:00:01.000Z' }),
      );
      const waitId = await observed(first, r.id);
      await first.container.ports.runs.update(r.id, { status: 'running', waiting: undefined });
      first.clock.advance(5000);
      // A due row sees the event-first park before its run-record acknowledgement.
      await first.container.timers.poll();
      expect(await new SqliteTimerStore(first.container.handle.db).list(r.id)).toHaveLength(1);
      expect((await first.container.manager.getRun(r.id))?.status).toBe('running');
      expect(
        (await first.container.ports.events.read(r.id)).filter((e) => e.type === 'run.woken'),
      ).toHaveLength(0);
      await closeForRestart(first);
      const clock = new FakeClock();
      clock.advance(5000);
      const next = await setup({ env, clock });
      expect(await observed(next, r.id)).toBe(waitId);
      expect((await next.container.manager.getRun(r.id))?.waiting?.until).toBe(
        '2026-10-02T12:00:01.000Z',
      );
      await next.container.timers.poll();
      await next.idle();
      expect((await next.container.manager.getRun(r.id))?.status).toBe('succeeded');
      expect(
        (await next.container.ports.events.read(r.id)).filter((e) => e.type === 'run.woken'),
      ).toHaveLength(1);
    },
  );
  it('acknowledges a due timer while paused and re-arms its original deadline after reopen and resume', async () => {
    const env = await diskEnv();
    const first = await setup({ env });
    const r = await start(
      first,
      singleWait({ mode: 'until', timestamp: '2026-10-02T12:00:01.000Z' }),
    );
    await first.container.manager.pause(r.id);
    first.clock.advance(5000);
    await first.container.timers.poll();
    const store = new SqliteTimerStore(first.container.handle.db);
    expect(await store.list(r.id)).toHaveLength(0);
    expect((await first.container.manager.getRun(r.id))?.status).toBe('paused');
    const waitId = await observed(first, r.id);
    await closeForRestart(first);
    const clock = new FakeClock();
    clock.advance(5000);
    const next = await setup({ env, clock });
    await next.container.timers.poll();
    expect((await next.container.manager.getRun(r.id))?.status).toBe('paused');
    expect(await observed(next, r.id)).toBe(waitId);
    await next.container.manager.resume(r.id);
    await next.container.timers.poll();
    await next.idle();
    expect((await next.container.manager.getRun(r.id))?.status).toBe('succeeded');
    expect(
      (await next.container.ports.events.read(r.id)).filter((e) => e.type === 'run.woken'),
    ).toHaveLength(1);
  });
  const cases = [50, 1000].flatMap((poll) =>
    [-1000, 0, 1000].flatMap((offset) => [8, 256000].map((bytes) => ({ poll, offset, bytes }))),
  );
  it.each(cases)(
    'handles deadline $offset, context $bytes, polling $poll',
    async ({ poll, offset, bytes }) => {
      const t = await setup({ env: { GG_TIMER_POLL_MS: String(poll) } });
      const loopId = await t.publishLoop(
        singleWait({
          mode: 'until',
          timestamp: new Date(t.clock.now().getTime() + offset).toISOString(),
        }),
      );
      const r = await t.container.manager.startRun({
        ownerId: 'local',
        loopId,
        source: 'manual.api',
        payload: 'x'.repeat(bytes),
      });
      await t.idle();
      await t.container.timers.poll();
      await t.idle();
      expect((await t.container.manager.getRun(r.id))?.status).toBe(
        offset > 0 ? 'waiting' : 'succeeded',
      );
      if (offset > 0) {
        t.clock.advance(offset);
        await t.container.timers.poll();
        await t.idle();
      }
      expect((await t.container.manager.getRun(r.id))?.status).toBe('succeeded');
      expect(
        (await t.container.ports.events.read(r.id)).filter((e) => e.type === 'run.woken'),
      ).toHaveLength(1);
    },
  );
  it('retains heartbeat observations through beats and real SQLite reopen, then rejects old signals', async () => {
    const env = await diskEnv();
    const first = await setup({ env });
    const def = repeated('heartbeat');
    const node = def.nodes[1];
    if (node?.kind !== 'heartbeat') throw Error('heartbeat fixture');
    node.config.until = 'probe.count >= 2';
    const r = await start(first, def);
    const a = await observed(first, r.id);
    expect(
      (
        await first.app.inject({
          method: 'POST',
          url: '/runs/' + r.id + '/signals/tick',
          payload: { waitId: a },
        })
      ).statusCode,
    ).toBe(200);
    first.clock.advance(1000);
    await first.container.timers.poll();
    await first.idle();
    expect((await first.container.manager.getRun(r.id))?.waiting?.beat).toBe(2);
    const b = await observed(first, r.id);
    await closeForRestart(first);
    const next = await setup({ env });
    expect(await observed(next, r.id)).toBe(b);
    expect(
      (
        await next.app.inject({
          method: 'POST',
          url: '/runs/' + r.id + '/signals/tick',
          payload: { waitId: b },
        })
      ).statusCode,
    ).toBe(200);
    next.clock.advance(2000);
    await next.container.timers.poll();
    await next.idle();
    const visitB = await next.container.manager.getRun(r.id);
    expect(visitB?.status).toBe('waiting');
    expect(visitB?.waiting?.beat).toBe(1);
    const before = await next.container.ports.events.read(r.id);
    for (const waitId of [a, b, b])
      expect(
        (
          await next.app.inject({
            method: 'POST',
            url: '/runs/' + r.id + '/signals/tick',
            payload: { waitId },
          })
        ).statusCode,
      ).toBe(409);
    expect(await next.container.ports.events.read(r.id)).toEqual(before);
  });
});

describe('wait rejection and acknowledgement boundaries', () => {
  it('requires an observed token and rejects unknown tokens without mutation', async () => {
    const t = await setup();
    const r = await start(t, singleWait({ mode: 'input', prompt: 'Token' }));
    const before = await t.container.ports.events.read(r.id);
    for (const path of ['/input', '/signals/tick']) {
      const payload = path === '/input' ? { input: null } : {};
      expect(
        (await t.app.inject({ method: 'POST', url: '/runs/' + r.id + path, payload })).statusCode,
      ).toBe(400);
      const bad = await t.app.inject({
        method: 'POST',
        url: '/runs/' + r.id + path,
        payload: { ...payload, waitId: 'unknown' },
      });
      expect(bad.statusCode).toBe(409);
      expect(bad.json()).toMatchObject({ code: 'WAIT_MISMATCH' });
    }
    expect(await t.container.ports.events.read(r.id)).toEqual(before);
  });
  it('records one signal answer atomically when two API requests race', async () => {
    const t = await setup();
    const r = await start(t, singleWait({ mode: 'signal', name: 'go' }));
    const waitId = await observed(t, r.id);
    const send = (payload: number) =>
      t.app.inject({
        method: 'POST',
        url: '/runs/' + r.id + '/signals/go',
        payload: { waitId, payload },
      });
    const replies = await Promise.all([send(1), send(2)]);
    expect(replies.map((x) => x.statusCode).sort()).toEqual([200, 409]);
    await t.idle();
    const events = await t.container.ports.events.read(r.id);
    expect(events.filter((e) => e.type === 'signal.received')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'run.woken')).toHaveLength(1);
    expect((await send(3)).json()).toMatchObject({ code: 'WAIT_MISMATCH' });
    expect(await t.container.ports.events.read(r.id)).toEqual(events);
  });
  it('recovers a paused event-first park before its snapshot/status commit without advancing it', async () => {
    const env = await diskEnv();
    const first = await setup({ env });
    const r = await start(
      first,
      singleWait({ mode: 'until', timestamp: '2026-10-02T12:00:01.000Z' }),
    );
    const waitId = await observed(first, r.id);
    await first.container.timers.cancel(r.id);
    const initial = await first.container.ports.runs.getInitialThread(r.id);
    if (!initial) throw Error('initial thread');
    await first.container.ports.runs.saveThread(r.id, initial, 0, { strict: false });
    await first.container.ports.runs.update(r.id, {
      status: 'paused',
      pausedAt: first.clock.now().toISOString(),
      waiting: undefined,
    });
    await closeForRestart(first);
    const clock = new FakeClock();
    clock.advance(5000);
    const next = await setup({ env, clock });
    expect((await next.container.manager.getRun(r.id))?.status).toBe('paused');
    expect(await observed(next, r.id)).toBe(waitId);
    await next.container.timers.poll();
    expect((await next.container.manager.getRun(r.id))?.status).toBe('paused');
    await next.container.manager.resume(r.id);
    await next.container.timers.poll();
    await next.idle();
    expect((await next.container.manager.getRun(r.id))?.status).toBe('succeeded');
  });
  it('closes and reopens SQLite after the wake but before timer acknowledgement', async () => {
    const env = await diskEnv();
    const first = await setup({ env });
    const r = await start(
      first,
      singleWait({ mode: 'until', timestamp: '2026-10-02T12:00:01.000Z' }),
    );
    first.container.timers.onFire(async () => {
      await first.container.manager.pause(r.id);
      return false;
    });
    first.clock.advance(1000);
    await first.container.timers.poll();
    await first.idle();
    expect(
      (await first.container.ports.events.read(r.id)).filter((e) => e.type === 'run.woken'),
    ).toHaveLength(1);
    expect(await new SqliteTimerStore(first.container.handle.db).list(r.id)).toHaveLength(1);
    await closeForRestart(first);
    const clock = new FakeClock();
    clock.advance(1000);
    const next = await setup({ env, clock });
    expect((await next.container.manager.getRun(r.id))?.status).toBe('paused');
    await next.container.manager.resume(r.id);
    await next.idle();
    expect((await next.container.manager.getRun(r.id))?.status).toBe('succeeded');
    expect(
      (await next.container.ports.events.read(r.id)).filter((e) => e.type === 'run.woken'),
    ).toHaveLength(1);
  });
});

it('a delayed wake acknowledgement cannot replace the next observed wait', async () => {
  const t = await setup();
  t.container.manager.stop();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const held = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let delayFirst = true;
  class DelayedRunRepository extends SqliteRunRepository {
    override async transition(...args: Parameters<SqliteRunRepository['transition']>) {
      if (delayFirst && args[1].includes('waiting') && args[2].status === 'running') {
        delayFirst = false;
        entered();
        await gate;
      }
      return super.transition(...args);
    }
  }
  const manager = new RunManager(
    { ...t.container.ports, runs: new DelayedRunRepository(t.container.handle.db) },
    t.container.settings,
  );
  await manager.start();
  let answer: ReturnType<RunManager['provideInput']> | undefined;
  try {
    const definition = repeated();
    const work = definition.nodes[1];
    if (work?.kind !== 'wait') throw Error('wait fixture');
    work.config = { mode: 'input', prompt: 'Delayed acknowledgement', timeoutSeconds: 1 };
    const loopId = await t.publishLoop(definition);
    const r = await manager.startRun({ ownerId: 'local', loopId, source: 'manual.api' });
    await manager.waitForIdle();
    const a = (await manager.getRun(r.id))!;
    answer = manager.provideInput(r.id, a.waiting!.waitId, 'A');
    await held;
    // A due timeout completes the durable wake while the original acknowledgement is delayed.
    t.clock.advance(1000);
    await t.container.timers.poll();
    await manager.waitForIdle();
    const b = (await manager.getRun(r.id))!;
    expect(b.status).toBe('waiting');
    expect(b.waiting!.waitId).not.toBe(a.waiting!.waitId);
    const before = await t.container.ports.events.read(r.id);
    release();
    await answer;
    await manager.waitForIdle();
    expect((await manager.getRun(r.id))?.waiting?.waitId).toBe(b.waiting!.waitId);
    expect(await t.container.ports.events.read(r.id)).toEqual(before);
  } finally {
    release();
    await answer?.catch(() => undefined);
    await manager.waitForIdle();
    manager.stop();
  }
});

it('redelivery queues a durable wake after its committed status response was lost', async () => {
  const t = await setup();
  t.container.manager.stop();
  let loseResponse = true;
  class LostResponseRunRepository extends SqliteRunRepository {
    override async transition(...args: Parameters<SqliteRunRepository['transition']>) {
      const updated = await super.transition(...args);
      if (loseResponse && args[1].includes('waiting') && args[2].status === 'running') {
        loseResponse = false;
        throw Error('committed status response lost');
      }
      return updated;
    }
  }
  const manager = new RunManager(
    { ...t.container.ports, runs: new LostResponseRunRepository(t.container.handle.db) },
    t.container.settings,
  );
  await manager.start();
  try {
    const loopId = await t.publishLoop(singleWait({ mode: 'duration', seconds: 1 }));
    const r = await manager.startRun({ ownerId: 'local', loopId, source: 'manual.api' });
    await manager.waitForIdle();
    t.clock.advance(1000);
    await t.container.timers.poll();
    expect((await manager.getRun(r.id))?.status).toBe('running');
    expect(await new SqliteTimerStore(t.container.handle.db).list(r.id)).toHaveLength(1);
    t.clock.advance(1000);
    await t.container.timers.poll();
    await manager.waitForIdle();
    expect((await manager.getRun(r.id))?.status).toBe('succeeded');
    expect(
      (await t.container.ports.events.read(r.id)).filter((e) => e.type === 'run.woken'),
    ).toHaveLength(1);
  } finally {
    manager.stop();
  }
});

it.each(['input', 'signal'] as const)(
  'retry repairs a durable %s answer after its status transition failed',
  async (mode) => {
    const t = await setup();
    t.container.manager.stop();
    let failOnce = true;
    class FailedWakeRepository extends SqliteRunRepository {
      override async transition(...args: Parameters<SqliteRunRepository['transition']>) {
        if (failOnce && args[1].includes('waiting') && args[2].status === 'running') {
          failOnce = false;
          throw Error('waiting-to-running write failed');
        }
        return super.transition(...args);
      }
    }
    const manager = new RunManager(
      { ...t.container.ports, runs: new FailedWakeRepository(t.container.handle.db) },
      t.container.settings,
    );
    const app = await buildApp({ ...t.container, manager }, { logger: false });
    await app.ready();
    await manager.start();
    try {
      const loopId = await t.publishLoop(
        singleWait(
          mode === 'input'
            ? { mode: 'input', prompt: 'Durable answer' }
            : { mode: 'signal', name: 'go' },
        ),
      );
      const r = await manager.startRun({ ownerId: 'local', loopId, source: 'manual.api' });
      await manager.waitForIdle();
      const waitId = (await manager.getRun(r.id))!.waiting!.waitId;
      const answer = (value: string) =>
        app.inject({
          method: 'POST',
          url: '/runs/' + r.id + (mode === 'input' ? '/input' : '/signals/go'),
          payload: mode === 'input' ? { waitId, input: value } : { waitId, payload: value },
        });
      expect((await answer('accepted')).statusCode).toBe(500);
      expect((await manager.getRun(r.id))?.status).toBe('waiting');
      const committed = await t.container.ports.events.read(r.id);
      expect(committed.filter((e) => e.type === 'run.woken')).toHaveLength(1);
      const retry = await answer('retry must not replace the accepted payload');
      expect(retry.statusCode).toBe(409);
      expect(retry.json()).toMatchObject({ code: 'WAIT_MISMATCH' });
      await manager.waitForIdle();
      expect((await manager.getRun(r.id))?.status).toBe('succeeded');
      expect((await manager.getRun(r.id))?.result).toBe('accepted');
      const events = await t.container.ports.events.read(r.id);
      expect(events.filter((e) => e.type === 'run.woken')).toHaveLength(1);
      expect(
        events.filter((e) => e.type === (mode === 'input' ? 'input.received' : 'signal.received')),
      ).toHaveLength(1);
    } finally {
      await manager.waitForIdle();
      manager.stop();
      await app.close();
    }
  },
);

it.each(['event', 'row'] as const)(
  'acknowledges timers for unreadable %s history and keeps healthy work available',
  async (damage) => {
    const t = await setup();
    const bad = await start(t, singleWait({ mode: 'duration', seconds: 1 }));
    const healthy = await start(t, singleWait({ mode: 'input', prompt: 'Healthy' }));
    t.container.manager.stop();
    await t.container.handle.client.execute({
      sql:
        damage === 'event'
          ? "UPDATE run_events SET payload = json_remove(payload, '$.wait.waitId') WHERE run_id = ? AND type = 'run.waiting'"
          : "UPDATE runs SET waiting = json_remove(waiting, '$.waitId') WHERE id = ?",
      args: [bad.id],
    });
    const manager = new RunManager(t.container.ports, t.container.settings);
    try {
      await expect(manager.start()).resolves.toBeUndefined();
      const diagnostics = await t.app.inject('/runs/diagnostics');
      expect(diagnostics.statusCode).toBe(200);
      expect(diagnostics.json()).toMatchObject({
        items: [{ runId: bad.id, code: 'HISTORY_UNREADABLE' }],
      });
      t.clock.advance(1000);
      await t.container.timers.poll();
      expect(await new SqliteTimerStore(t.container.handle.db).list(bad.id)).toHaveLength(0);
      const logs = t.logger.lines.length;
      await t.container.timers.poll();
      expect(t.logger.lines).toHaveLength(logs);
      await manager.provideInput(healthy.id, healthy.waiting!.waitId, 'healthy');
      await manager.waitForIdle();
      expect((await manager.getRun(healthy.id))?.status).toBe('succeeded');
    } finally {
      manager.stop();
    }
  },
);

it.each(['input', 'signal'] as const)(
  'reports a paused %s wait as INVALID_STATE without consuming its identity',
  async (mode) => {
    const t = await setup();
    const r = await start(
      t,
      singleWait(
        mode === 'input' ? { mode: 'input', prompt: 'Paused' } : { mode: 'signal', name: 'go' },
      ),
    );
    const waitId = r.waiting!.waitId;
    await t.container.manager.pause(r.id);
    const before = await t.container.ports.events.read(r.id);
    const send = (token: string) =>
      t.app.inject({
        method: 'POST',
        url: '/runs/' + r.id + (mode === 'input' ? '/input' : '/signals/go'),
        payload: mode === 'input' ? { waitId: token, input: 'accepted' } : { waitId: token },
      });
    expect((await send(waitId)).json()).toMatchObject({
      code: 'INVALID_STATE',
      detail: expect.stringContaining('paused'),
    });
    expect((await send('old-wait')).json()).toMatchObject({ code: 'WAIT_MISMATCH' });
    expect(await t.container.ports.events.read(r.id)).toEqual(before);
    await t.container.manager.resume(r.id);
    expect((await send(waitId)).statusCode).toBe(200);
    await t.idle();
    expect((await t.container.manager.getRun(r.id))?.status).toBe('succeeded');
  },
);

it('a paused timer acknowledgement cannot delete a resume re-arm at the same deadline', async () => {
  const t = await setup();
  t.container.manager.stop();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let acknowledgeEntered!: () => void;
  const acknowledging = new Promise<void>((resolve) => {
    acknowledgeEntered = resolve;
  });
  class DelayedAcknowledgementStore extends SqliteTimerStore {
    override async acknowledge(...args: Parameters<SqliteTimerStore['acknowledge']>) {
      acknowledgeEntered();
      await gate;
      return super.acknowledge(...args);
    }
  }
  let observeRearm = false;
  let rearmEntered!: () => void;
  const rearming = new Promise<void>((resolve) => {
    rearmEntered = resolve;
  });
  const timers = new TimerService(new DelayedAcknowledgementStore(t.container.handle.db), t.clock);
  const manager = new RunManager(
    {
      ...t.container.ports,
      timers: {
        schedule: (...args: Parameters<TimerService['schedule']>) => {
          const pending = timers.schedule(...args);
          if (observeRearm) rearmEntered();
          return pending;
        },
        cancel: (...args: Parameters<TimerService['cancel']>) => timers.cancel(...args),
        onFire: (...args: Parameters<TimerService['onFire']>) => timers.onFire(...args),
      },
    },
    t.container.settings,
  );
  await manager.start();
  let polling: Promise<number> | undefined;
  let resumed: ReturnType<RunManager['resume']> | undefined;
  try {
    const loopId = await t.publishLoop(singleWait({ mode: 'duration', seconds: 1 }));
    const r = await manager.startRun({ ownerId: 'local', loopId, source: 'manual.api' });
    await manager.waitForIdle();
    await manager.pause(r.id);
    t.clock.advance(1000);
    polling = timers.poll();
    await acknowledging;
    observeRearm = true;
    resumed = manager.resume(r.id);
    await rearming;
    // Flush already-issued SQL writes while the old acknowledgement remains interrupted.
    await t.container.handle.client.execute('SELECT 1');
    release();
    await Promise.all([polling, resumed]);
    await timers.poll();
    await manager.waitForIdle();
    expect((await manager.getRun(r.id))?.status).toBe('succeeded');
    expect(
      (await t.container.ports.events.read(r.id)).filter((e) => e.type === 'run.woken'),
    ).toHaveLength(1);
  } finally {
    release();
    await Promise.allSettled([polling, resumed]);
    await manager.waitForIdle();
    manager.stop();
  }
});

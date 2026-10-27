import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeliveryError, WebhookDelivery } from '@graphgoblin/contracts';
import { createTestEngine, singleNodeLoop } from './testing/scenario.js';
import { WebhookReturns, webhookStates } from './webhook-returns.js';
import { InMemoryEventStore, InMemoryRunRepository } from './testing/fakes.js';
import type { EventStorePort } from './ports.js';

const transient: DeliveryError = {
  code: 'http',
  message: 'HTTP 503',
  httpStatus: 503,
  retryable: true,
  acknowledgement: 'unknown',
};
const work = {
  id: 'noop',
  kind: 'mutate' as const,
  label: 'M',
  config: { operations: [{ op: 'delete', path: '/vars/x' }] },
};
afterEach(() => vi.useRealTimers());

it('the standalone event fake also refuses a required missing run', async () => {
  const engine = await createTestEngine();
  engine.manager.stop();
  const events = new InMemoryEventStore(engine.ports.clock);
  const runId = engine.ports.ids.next();
  expect(await events.append(runId, [{ type: 'run.cancelled' }], { requireRun: true })).toEqual([]);
});

describe('durable webhook returns through RunManager', () => {
  it.each([true, false])(
    'retains prior acknowledgement uncertainty separately from a later rejection (%s)',
    async (unknown) => {
      vi.useFakeTimers();
      const engine = await createTestEngine();
      engine.ports.delivery.responder = (_id, attempt) =>
        attempt === 3
          ? { ok: true }
          : {
              ok: false,
              error:
                attempt === 1 && unknown
                  ? transient
                  : {
                      code: 'http',
                      message: 'HTTP 429',
                      httpStatus: 429,
                      retryable: true,
                      acknowledgement: 'rejected',
                    },
            };
      const version = engine.publish(
        singleNodeLoop('uncertainty then rejection', work, {
          returns: 'vars',
          destinations: [{ kind: 'webhook', url: 'https://example.test' }],
        }),
      );
      const run = await engine.start(version.loopId);
      await vi.waitFor(() => expect(engine.ports.delivery.webhooks).toHaveLength(1));
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(5000);
      await engine.manager.waitForIdle();
      engine.manager.stop();
      expect(webhookStates(engine.events(run.id))).toMatchObject([
        {
          status: 'delivered',
          attempts: 3,
          acknowledgement: 'accepted',
          acknowledgementUncertain: unknown,
          lastError: { httpStatus: 429, acknowledgement: 'rejected' },
        },
      ]);
      expect(new Set(engine.ports.delivery.webhooks.map((call) => call.deliveryId)).size).toBe(1);
    },
  );
  it.each([1, 2, 5])('delivers or exhausts with one identity (%i attempts)', async (required) => {
    vi.useFakeTimers();
    const engine = await createTestEngine();
    const attemptTimes: number[] = [];
    engine.ports.delivery.responder = (_id, attempt) => {
      attemptTimes.push(Date.now());
      return required === 5 || attempt < required ? { ok: false, error: transient } : { ok: true };
    };
    const version = engine.publish(
      singleNodeLoop('retry', work, {
        returns: 'vars',
        destinations: [{ kind: 'webhook', url: 'https://example.test' }],
      }),
    );
    const run = await engine.start(version.loopId);
    await vi.waitFor(() => expect(engine.ports.delivery.webhooks).toHaveLength(1));
    // Delivery remains pending while execution has already succeeded.
    expect((await engine.ports.runs.get(run.id))?.status).toBe('succeeded');
    for (const delay of [2000, 5000, 10000, 20000].slice(0, required - 1)) {
      const pending = webhookStates(engine.events(run.id))[0]!;
      expect(pending.nextAttemptAt).toBe(
        new Date(engine.ports.clock.now().getTime() + delay).toISOString(),
      );
      const count = engine.ports.delivery.webhooks.length;
      await vi.advanceTimersByTimeAsync(delay);
      expect(engine.ports.delivery.webhooks).toHaveLength(count + 1);
      expect(attemptTimes.at(-1)! - attemptTimes.at(-2)!).toBe(delay);
    }
    await engine.manager.waitForIdle();
    engine.manager.stop();
    const calls = engine.ports.delivery.webhooks;
    expect(calls).toHaveLength(required);
    expect(new Set(calls.map((call) => call.deliveryId)).size).toBe(1);
    const states = webhookStates(engine.events(run.id));
    expect(states).toMatchObject([
      { attempts: required, status: required === 5 ? 'failed' : 'delivered', inFlight: false },
    ]);
    expect(
      engine.events(run.id).filter((event) => event.type === 'delivery.finished'),
    ).toHaveLength(1);
    expect(
      engine.events(run.id).filter((event) => event.type === 'delivery.attempted'),
    ).toHaveLength(required);
    if (required > 1) expect(states[0]?.effectMayHaveHappened).toBe(true);
  });

  it('does not retry a permanent failure and deduplicates identical destinations', async () => {
    const engine = await createTestEngine();
    engine.ports.delivery.failWebhooks = true;
    const channel = { kind: 'webhook' as const, url: 'https://example.test' };
    const version = engine.publish(
      singleNodeLoop('permanent', work, { returns: 'vars', destinations: [channel, channel] }),
    );
    const run = await engine.runToIdle(version.loopId, null, { returnDefaults: [channel] });
    engine.manager.stop();
    expect(engine.ports.delivery.webhooks).toHaveLength(1);
    expect(webhookStates(engine.events(run.id))).toMatchObject([
      { status: 'failed', attempts: 1, acknowledgement: 'rejected', effectMayHaveHappened: false },
    ]);
    expect(run.status).toBe('succeeded');
  });

  it('does not resend a finalized webhook during recovery', async () => {
    const engine = await createTestEngine();
    const version = engine.publish(
      singleNodeLoop('recover final', work, {
        returns: 'vars',
        destinations: [{ kind: 'webhook', url: 'https://example.test' }],
      }),
    );
    const run = await engine.runToIdle(version.loopId);
    engine.manager.stop();
    await engine.ports.runs.clearFinalized(run.id);
    await engine.manager.start();
    await engine.manager.waitForIdle();
    engine.manager.stop();
    expect(engine.ports.delivery.webhooks).toHaveLength(1);
  });
});

describe('recovery of journalled attempts through the delivery component', () => {
  it.each([1, 5])(
    'records an interrupted attempt as unknown and retains budget (%i)',
    async (attempts) => {
      const engine = await createTestEngine();
      const version = engine.publish(singleNodeLoop('journal fixture', work));
      const run = await engine.runToIdle(version.loopId);
      engine.manager.stop();
      vi.useFakeTimers();
      const state: WebhookDelivery = {
        id: 'stable-recovered-id',
        channel: { kind: 'webhook', url: 'https://example.test' },
        status: 'pending',
        attempts,
        maxAttempts: 5,
        inFlight: true,
        acknowledgement: 'unknown',
        effectMayHaveHappened: true,
        acknowledgementUncertain: false,
        nextAttemptAt: new Date(engine.ports.clock.now().getTime() + 100).toISOString(),
      };
      await engine.ports.events.append(run.id, [{ type: 'delivery.attempted', delivery: state }]);
      const component = new WebhookReturns(engine.ports);
      let completions = 0;
      const complete = () => {
        completions++;
        return Promise.resolve();
      };
      component.start(run.id, state, {}, complete);
      component.start(run.id, state, {}, complete);
      await vi.advanceTimersByTimeAsync(100);
      await component.waitForIdle();
      expect(completions).toBe(1);
      expect(engine.ports.delivery.webhooks).toHaveLength(attempts === 5 ? 0 : 1);
      const final = webhookStates(engine.events(run.id))[0]!;
      expect(final).toMatchObject({
        attempts: attempts === 5 ? 5 : 2,
        status: attempts === 5 ? 'failed' : 'delivered',
        lastError: { code: 'interrupted', acknowledgement: 'unknown' },
        effectMayHaveHappened: true,
        acknowledgementUncertain: true,
      });
      component.start(run.id, final, {}, complete);
      await component.waitForIdle();
      expect(completions).toBe(1);
    },
  );

  it('preserves a lost acknowledgement from a thrown transport error', async () => {
    vi.useFakeTimers();
    const engine = await createTestEngine();
    const version = engine.publish(
      singleNodeLoop('unknown', work, {
        returns: 'vars',
        destinations: [{ kind: 'webhook', url: 'https://example.test' }],
      }),
    );
    engine.ports.delivery.responder = (_id, attempt) => {
      if (attempt === 1) throw Error('socket lost');
      return { ok: true };
    };
    const run = await engine.start(version.loopId);
    await vi.waitFor(() => expect(engine.ports.delivery.webhooks).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(2000);
    await engine.manager.waitForIdle();
    engine.manager.stop();
    expect(webhookStates(engine.events(run.id))).toMatchObject([
      {
        status: 'delivered',
        attempts: 2,
        lastError: { code: 'transport', acknowledgement: 'unknown' },
        effectMayHaveHappened: true,
        acknowledgementUncertain: true,
      },
    ]);
  });
});

it('stops a backoff without spending another attempt and resumes the durable deadline', async () => {
  vi.useFakeTimers();
  const engine = await createTestEngine();
  engine.ports.delivery.responder = (_id, n) =>
    n === 1 ? { ok: false, error: transient } : { ok: true };
  const version = engine.publish(
    singleNodeLoop('orderly stop', work, {
      returns: 'vars',
      destinations: [{ kind: 'webhook', url: 'https://example.test' }],
    }),
  );
  const run = await engine.start(version.loopId);
  await vi.waitFor(() => expect(webhookStates(engine.events(run.id))[0]?.inFlight).toBe(false));
  engine.manager.stop();
  await vi.advanceTimersByTimeAsync(2000);
  await engine.manager.waitForIdle();
  expect(engine.ports.delivery.webhooks).toHaveLength(1);
  expect(webhookStates(engine.events(run.id))).toMatchObject([{ status: 'pending', attempts: 1 }]);
  await engine.manager.start();
  await vi.advanceTimersByTimeAsync(2000);
  await engine.manager.waitForIdle();
  engine.manager.stop();
  expect(engine.ports.delivery.webhooks).toHaveLength(2);
  expect(webhookStates(engine.events(run.id))).toMatchObject([
    { status: 'delivered', attempts: 2 },
  ]);
});

it('reports persistence failure distinctly, sends nothing, and leaves recovery possible', async () => {
  const engine = await createTestEngine();
  const version = engine.publish(singleNodeLoop('journal failure', work));
  const run = await engine.runToIdle(version.loopId);
  engine.manager.stop();
  const state: WebhookDelivery = {
    id: 'durable-id',
    channel: { kind: 'webhook', url: 'https://example.test' },
    status: 'pending',
    attempts: 0,
    maxAttempts: 5,
    inFlight: false,
    acknowledgement: 'not_sent',
    effectMayHaveHappened: false,
    acknowledgementUncertain: false,
  };
  await engine.ports.events.append(run.id, [{ type: 'delivery.queued', delivery: state }]);
  const failing = new WebhookReturns({
    ...engine.ports,
    events: {
      append: () => Promise.reject(Error('disk full')),
      recoveryFacts: (...args) => engine.ports.events.recoveryFacts(...args),
      read: (id, after, limit) => engine.ports.events.read(id, after, limit),
      subscribe: (id, listener) => engine.ports.events.subscribe(id, listener),
    },
  });
  let completions = 0;
  const finished = () => {
    completions++;
    return Promise.resolve();
  };
  failing.start(run.id, state, {}, finished);
  await failing.waitForIdle();
  expect(completions).toBe(0);
  expect(engine.ports.delivery.webhooks).toHaveLength(0);
  expect(webhookStates(engine.events(run.id))).toEqual([state]);
  expect(engine.ports.logger.lines).toContainEqual(
    expect.objectContaining({
      level: 'error',
      msg: 'webhook delivery journal persistence failed; recovery required',
    }),
  );
  expect(engine.ports.logger.lines.some((line) => line.msg.includes('run deleted'))).toBe(false);
  const recovered = new WebhookReturns(engine.ports);
  recovered.start(run.id, state, {}, finished);
  await recovered.waitForIdle();
  expect(completions).toBe(1);
  expect(webhookStates(engine.events(run.id))).toMatchObject([
    { status: 'delivered', attempts: 1 },
  ]);
});

async function boundaryFixture() {
  const engine = await createTestEngine();
  const version = engine.publish(singleNodeLoop('delivery boundary', work));
  const run = await engine.runToIdle(version.loopId);
  engine.manager.stop();
  const state: WebhookDelivery = {
    id: 'boundary-delivery',
    channel: { kind: 'webhook', url: 'https://example.test', secretRef: 'token' },
    status: 'pending',
    attempts: 0,
    maxAttempts: 5,
    inFlight: false,
    acknowledgement: 'not_sent',
    effectMayHaveHappened: false,
    acknowledgementUncertain: false,
  };
  return { engine, run, state };
}

it.each(['after append', 'during secret resolution'])(
  'retains an unsent durable attempt conservatively when stop lands %s',
  async (phase) => {
    const { engine, run, state } = await boundaryFixture();
    vi.useFakeTimers();
    await engine.ports.events.append(run.id, [{ type: 'delivery.queued', delivery: state }]);
    const component: WebhookReturns = new WebhookReturns({
      ...engine.ports,
      secrets: {
        resolve: () => {
          expect(webhookStates(engine.events(run.id))).toMatchObject([
            { attempts: 1, inFlight: true },
          ]);
          if (phase === 'during secret resolution') component.stop();
          return Promise.resolve('secret');
        },
      },
    });
    const unsubscribe = engine.ports.events.subscribe(run.id, (event) => {
      if (phase === 'after append' && event.type === 'delivery.attempted') component.stop();
    });
    let completions = 0;
    const finished = () => {
      completions++;
      return Promise.resolve();
    };
    component.start(run.id, state, {}, finished);
    await component.waitForIdle();
    unsubscribe();
    const interrupted = webhookStates(engine.events(run.id))[0]!;
    expect(interrupted).toMatchObject({
      id: state.id,
      status: 'pending',
      attempts: 1,
      inFlight: true,
      acknowledgement: 'unknown',
      effectMayHaveHappened: true,
      acknowledgementUncertain: false,
    });
    expect(interrupted.nextAttemptAt).toBe(
      new Date(engine.ports.clock.now().getTime() + 12000).toISOString(),
    );
    expect(engine.ports.delivery.webhooks).toHaveLength(0);
    expect(completions).toBe(0);
    component.start(run.id, interrupted, {}, finished);
    await component.waitForIdle();
    expect(webhookStates(engine.events(run.id))).toEqual([interrupted]);

    const recovered = new WebhookReturns({
      ...engine.ports,
      secrets: { resolve: () => Promise.resolve('secret') },
    });
    recovered.start(run.id, interrupted, {}, finished);
    await vi.advanceTimersByTimeAsync(12000);
    await recovered.waitForIdle();
    expect(completions).toBe(1);
    expect(engine.ports.delivery.webhooks).toMatchObject([{ deliveryId: state.id }]);
    expect(webhookStates(engine.events(run.id))).toMatchObject([
      {
        id: state.id,
        status: 'delivered',
        attempts: 2,
        inFlight: false,
        effectMayHaveHappened: true,
        acknowledgementUncertain: true,
        lastError: { code: 'interrupted', acknowledgement: 'unknown' },
      },
    ]);
    expect(
      engine.events(run.id).filter((event) => event.type === 'delivery.attempted'),
    ).toHaveLength(2);
  },
);

it.each([
  'before attempt',
  'during recovery',
  'during secret resolution',
  'during response',
  'at journal append',
])('stops a deleted run without further sends or journal writes (%s)', async (phase) => {
  const { engine, run, state } = await boundaryFixture();
  // Model a repository whose public get observes deletion; no private fake state is accessed.
  const runs = new (class extends InMemoryRunRepository {
    deleted = false;
    override get(id: string) {
      return this.deleted ? Promise.resolve(undefined) : super.get(id);
    }
  })();
  const thread = await engine.ports.runs.getInitialThread(run.id);
  expect(thread).toBeDefined();
  await runs.create(run, thread!);
  const events = new InMemoryEventStore(engine.ports.clock, runs);
  const initial = phase === 'during recovery' ? { ...state, attempts: 1, inFlight: true } : state;
  await events.append(run.id, [
    { type: initial.inFlight ? 'delivery.attempted' : 'delivery.queued', delivery: initial },
  ]);
  let journalAtDeletion = events.all(run.id);
  const remove = () => {
    journalAtDeletion = events.all(run.id);
    runs.deleted = true;
  };
  const journal: EventStorePort = {
    append: (id, drafts, options) => {
      if (phase === 'at journal append') remove();
      return events.append(id, drafts, options);
    },
    recoveryFacts: (...args) => events.recoveryFacts(...args),
    read: (id, after, limit) => events.read(id, after, limit),
    subscribe: (id, listener) => events.subscribe(id, listener),
  };
  const component = new WebhookReturns({
    ...engine.ports,
    runs,
    events: journal,
    secrets: {
      resolve: () => {
        if (phase === 'during secret resolution') remove();
        return Promise.resolve('secret');
      },
    },
  });
  engine.ports.delivery.responder = () => {
    remove();
    return { ok: false, error: transient };
  };
  if (phase === 'before attempt' || phase === 'during recovery') remove();
  let completions = 0;
  component.start(run.id, initial, {}, () => {
    completions++;
    return Promise.resolve();
  });
  await component.waitForIdle();
  expect(engine.ports.delivery.webhooks).toHaveLength(phase === 'during response' ? 1 : 0);
  expect(events.all(run.id)).toEqual(journalAtDeletion);
  expect(completions).toBe(0);
  expect(engine.ports.logger.lines).toContainEqual(
    expect.objectContaining({
      level: 'info',
      msg: 'webhook delivery stopped: run deleted',
    }),
  );
  expect(engine.ports.logger.lines.filter((line) => line.level === 'error')).toEqual([]);
});

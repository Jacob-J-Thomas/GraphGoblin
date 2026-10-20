import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeliveryError, WebhookDelivery } from '@graphgoblin/contracts';
import { createTestEngine, singleNodeLoop } from './testing/scenario.js';
import { WebhookReturns, webhookStates } from './webhook-returns.js';

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

describe('durable webhook returns through RunManager', () => {
  it.each([1, 2, 5])('delivers or exhausts with one identity (%i attempts)', async (required) => {
    vi.useFakeTimers();
    const engine = await createTestEngine();
    engine.ports.delivery.responder = (_id, attempt) =>
      required === 5 || attempt < required ? { ok: false, error: transient } : { ok: true };
    const version = engine.publish(
      singleNodeLoop('retry', work, {
        returns: 'vars',
        destinations: [{ kind: 'webhook', url: 'https://example.test' }],
      }),
    );
    const run = await engine.start(version.loopId);
    await vi.waitFor(() => expect(engine.ports.delivery.webhooks).toHaveLength(1));
    engine.manager.stop();
    // Delivery remains pending while execution has already succeeded.
    expect((await engine.ports.runs.get(run.id))?.status).toBe('succeeded');
    await vi.advanceTimersByTimeAsync(37_000);
    await engine.manager.waitForIdle();
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
    engine.manager.stop();
    await vi.advanceTimersByTimeAsync(2000);
    await engine.manager.waitForIdle();
    expect(webhookStates(engine.events(run.id))).toMatchObject([
      {
        status: 'delivered',
        attempts: 2,
        lastError: { code: 'transport', acknowledgement: 'unknown' },
        effectMayHaveHappened: true,
      },
    ]);
  });
});

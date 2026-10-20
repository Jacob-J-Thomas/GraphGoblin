import type { ContextThread, JsonValue, RunEvent, WebhookDelivery } from '@graphgoblin/contracts';
import type { EnginePorts, EventDraft, IdPort } from './ports.js';
import type { NodeResult } from './handler.js';

// Engineering proposal (#246): at most 5 x 10 s requests + 37 s of backoff.
export const WEBHOOK_RETRY_DELAYS_MS = [0, 2_000, 5_000, 10_000, 20_000] as const;
export const WEBHOOK_TIMEOUT_MS = 10_000;

/** Queue atomically with run.finished, so even the first terminal snapshot shows pending work. */
export function queuedWebhooks(
  result: Extract<NodeResult, { kind: 'exit' }>,
  thread: ContextThread,
  ids: IdPort,
): EventDraft[] {
  if (result.returnPayload === undefined) return [];
  const unique = new Map(
    [...result.channels, ...(thread.invocation.returnDefaults ?? [])]
      .filter((channel) => channel.kind === 'webhook')
      .map((channel) => [JSON.stringify(channel), channel]),
  );
  return [...unique.values()].map((channel) => ({
    type: 'delivery.queued',
    delivery: {
      id: ids.next(),
      channel,
      status: 'pending',
      attempts: 0,
      maxAttempts: 5,
      inFlight: false,
      acknowledgement: 'not_sent',
      effectMayHaveHappened: false,
    },
  }));
}

export function webhookStates(events: readonly RunEvent[]): WebhookDelivery[] {
  const states = new Map<string, WebhookDelivery>();
  for (const event of events)
    if ('delivery' in event) states.set(event.delivery.id, event.delivery);
  return [...states.values()];
}

/** Runs independently of execution slots; only durable state authorizes a network attempt. */
export class WebhookReturns {
  private readonly tasks = new Map<string, Promise<void>>();

  constructor(private readonly ports: EnginePorts) {}

  start(
    runId: string,
    initial: WebhookDelivery,
    payload: JsonValue,
    finished: () => Promise<void>,
  ): void {
    if (this.tasks.has(initial.id) || initial.status !== 'pending') return;
    const task = this.deliver(runId, initial, payload)
      .then(finished)
      .catch((error: unknown) => {
        // Persistence failures must leave the run unfinalized for recovery, never claim delivery.
        this.ports.logger.error(
          { runId, deliveryId: initial.id, error: String(error) },
          'webhook delivery journal remains pending',
        );
      })
      .finally(() => {
        this.tasks.delete(initial.id);
      });
    this.tasks.set(initial.id, task);
  }

  async waitForIdle(): Promise<void> {
    while (this.tasks.size) await Promise.all(this.tasks.values());
  }

  private async deliver(
    runId: string,
    initial: WebhookDelivery,
    payload: JsonValue,
  ): Promise<void> {
    let state = initial;
    const record = async (
      type: 'delivery.attempted' | 'delivery.attempt_finished' | 'delivery.finished',
    ) => {
      await this.ports.events.append(runId, [{ type, delivery: state }]);
    };
    if (state.inFlight) {
      // This attempt consumed its budget before the process died. Never resend attempt #1.
      state = {
        ...state,
        inFlight: false,
        acknowledgement: 'unknown',
        effectMayHaveHappened: true,
        lastError: {
          code: 'interrupted',
          message:
            'Process stopped before acknowledgement was recorded; the effect may have happened.',
          retryable: true,
          acknowledgement: 'unknown',
        },
      };
      await record('delivery.attempt_finished');
    }
    while (state.status === 'pending') {
      if (state.attempts >= state.maxAttempts) {
        state = { ...state, status: 'failed', inFlight: false };
        delete state.nextAttemptAt;
        await record('delivery.finished');
        return;
      }
      const delay = state.nextAttemptAt
        ? Math.max(0, Date.parse(state.nextAttemptAt) - this.ports.clock.now().getTime())
        : 0;
      if (delay) await new Promise<void>((resolve) => setTimeout(resolve, delay));
      const attempts = state.attempts + 1;
      const previousEffect = state.effectMayHaveHappened;
      state = {
        ...state,
        attempts,
        inFlight: true,
        acknowledgement: 'unknown',
        effectMayHaveHappened: true,
        // Persist the recovery deadline too: repeated restarts cannot reset the schedule.
        nextAttemptAt: new Date(
          this.ports.clock.now().getTime() +
            WEBHOOK_TIMEOUT_MS +
            (WEBHOOK_RETRY_DELAYS_MS[attempts] ?? 0),
        ).toISOString(),
      };
      await record('delivery.attempted');
      const result = await (async () => {
        const secret = state.channel.secretRef
          ? await this.ports.secrets.resolve(state.channel.secretRef)
          : undefined;
        return this.ports.delivery.webhook(state.channel.url, payload, secret, state.id);
      })().catch(() => ({
        ok: false as const,
        error: {
          code: 'transport' as const,
          message: 'No acknowledgement received; the effect may have happened.',
          retryable: true,
          acknowledgement: 'unknown' as const,
        },
      }));
      state = {
        ...state,
        inFlight: false,
        acknowledgement: result.ok ? 'accepted' : result.error.acknowledgement,
        effectMayHaveHappened:
          previousEffect || result.ok || result.error.acknowledgement === 'unknown',
      };
      if (result.ok) state.status = 'delivered';
      else {
        state.lastError = result.error;
        if (!result.error.retryable || attempts === state.maxAttempts) state.status = 'failed';
      }
      if (state.status === 'pending')
        state.nextAttemptAt = new Date(
          this.ports.clock.now().getTime() + (WEBHOOK_RETRY_DELAYS_MS[attempts] ?? 0),
        ).toISOString();
      else delete state.nextAttemptAt;
      await record(state.status === 'pending' ? 'delivery.attempt_finished' : 'delivery.finished');
    }
  }
}

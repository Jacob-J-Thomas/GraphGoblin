import { createHmac, timingSafeEqual } from 'node:crypto';
import type { JsonValue, WebhookAttemptResult } from '@graphgoblin/contracts';
import { WEBHOOK_TIMEOUT_MS } from '@graphgoblin/engine';
import type { ClockPort, Logger, ReturnDeliveryPort } from '@graphgoblin/engine';
import type { FetchLike } from './probes.js';

export const SIGNATURE_HEADER = 'x-graphgoblin-signature';
export const TIMESTAMP_HEADER = 'x-graphgoblin-timestamp';
export const DELIVERY_ID_HEADER = 'idempotency-key';

/** HMAC-SHA256 over `${timestamp}.${body}`, presented as `sha256=<hex>`. */
export function signPayload(secret: string, timestamp: string, body: string | Uint8Array): string {
  const digest = createHmac('sha256', secret)
    .update(timestamp + '.', 'utf8')
    .update(body)
    .digest('hex');
  return `sha256=${digest}`;
}

/** Constant-time check of a presented signature. */
export function verifySignature(
  secret: string,
  timestamp: string,
  body: string | Uint8Array,
  presented: string,
): boolean {
  const expected = Buffer.from(signPayload(secret, timestamp, body), 'utf8');
  const actual = Buffer.from(presented, 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** HMAC-SHA256 over the original request bytes, without a timestamp prefix. */
export function signRawBody(secret: string, body: Uint8Array): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

/** Reject malformed digests before a constant-time comparison of all 32 digest bytes. */
export function verifyRawBodySignature(
  secret: string,
  body: Uint8Array,
  presented: string,
): boolean {
  if (!/^sha256=[0-9a-fA-F]{64}$/.test(presented)) return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  const actual = Buffer.from(presented.slice(7), 'hex');
  return timingSafeEqual(expected, actual);
}

export interface WebhookDeliveryOptions {
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

/** POSTs JSON to a URL, signing it when a secret is supplied. Non-2xx responses throw. */
export class HttpWebhookDelivery {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(
    private readonly clock: ClockPort,
    options: WebhookDeliveryOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? WEBHOOK_TIMEOUT_MS;
  }

  async webhook(
    url: string,
    payload: JsonValue,
    secret: string | undefined,
    deliveryId: string,
  ): Promise<WebhookAttemptResult> {
    try {
      const destination = new URL(url);
      if (
        !['http:', 'https:'].includes(destination.protocol) ||
        destination.username ||
        destination.password
      )
        throw new Error('invalid destination');
    } catch {
      return {
        ok: false,
        error: {
          code: 'invalid_destination',
          message: 'Webhook destination must be an HTTP(S) URL without credentials.',
          retryable: false,
          acknowledgement: 'not_sent',
        },
      };
    }
    const body = JSON.stringify(payload);
    const timestamp = this.clock.now().toISOString();
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      [TIMESTAMP_HEADER]: timestamp,
      [DELIVERY_ID_HEADER]: deliveryId,
    };
    if (secret) headers[SIGNATURE_HEADER] = signPayload(secret, timestamp, body);
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'manual',
      });
      if (response.ok) {
        // Require a complete acknowledgement, including EOF. Drain without retaining bytes,
        // bounded to 64 KiB and the same request deadline; a truncated 2xx is still uncertain.
        const reader = response.body?.getReader();
        if (reader) {
          let bytes = 0;
          try {
            for (;;) {
              const chunk = await reader.read();
              if (chunk.done) break;
              const value: unknown = chunk.value;
              if (!(value instanceof Uint8Array)) throw new Error('invalid acknowledgement bytes');
              bytes += value.byteLength;
              if (bytes > 65_536) {
                await reader.cancel();
                return {
                  ok: false,
                  error: {
                    code: 'transport',
                    message:
                      'Webhook acknowledgement exceeded 64 KiB; the effect may have happened.',
                    retryable: true,
                    acknowledgement: 'unknown',
                  },
                };
              }
            }
          } finally {
            reader.releaseLock();
          }
        }
        return { ok: true };
      }
      await response.body?.cancel().catch(() => undefined);
      return {
        ok: false,
        error: {
          code: 'http',
          message: `Webhook returned HTTP ${response.status}.`,
          httpStatus: response.status,
          retryable: response.status === 408 || response.status === 429 || response.status >= 500,
          acknowledgement:
            response.status >= 500 || response.status === 408 ? 'unknown' : 'rejected',
        },
      };
    } catch (error) {
      const cause = error instanceof Error ? error.cause : undefined;
      const refused =
        typeof cause === 'object' &&
        cause !== null &&
        'code' in cause &&
        cause.code === 'ECONNREFUSED';
      const timeout =
        error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      return {
        ok: false,
        error: {
          code: refused ? 'connection_refused' : timeout ? 'timeout' : 'transport',
          message: refused
            ? 'Webhook connection refused.'
            : timeout
              ? 'Webhook acknowledgement timed out; the effect may have happened.'
              : 'Webhook acknowledgement lost; the effect may have happened.',
          retryable: true,
          acknowledgement: refused ? 'not_sent' : 'unknown',
        },
      };
    }
  }
}

export interface ReturnDeliveryDeps {
  webhooks: Pick<HttpWebhookDelivery, 'webhook'>;
  /** Publishes onto the gateway's inbound event bus. */
  publishEvent: (eventType: string, payload: JsonValue) => Promise<void>;
  logger: Logger;
}

/** Compose the engine's return-delivery port from its three sinks. */
export function createReturnDelivery(deps: ReturnDeliveryDeps): ReturnDeliveryPort {
  return {
    webhook: (url, payload, secret, deliveryId) =>
      deps.webhooks.webhook(url, payload, secret, deliveryId),
    publishEvent: (eventType, payload) => deps.publishEvent(eventType, payload),
    log: (runId, payload) => deps.logger.info({ runId, result: payload }, 'loop returned'),
  };
}

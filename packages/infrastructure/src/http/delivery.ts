import { createHmac, timingSafeEqual } from 'node:crypto';
import type { JsonValue } from '@graphgoblin/contracts';
import type { ClockPort, Logger, ReturnDeliveryPort } from '@graphgoblin/engine';
import type { FetchLike } from './probes.js';

export const SIGNATURE_HEADER = 'x-graphgoblin-signature';
export const TIMESTAMP_HEADER = 'x-graphgoblin-timestamp';

/** HMAC-SHA256 over `${timestamp}.${body}`, presented as `sha256=<hex>`. */
export function signPayload(secret: string, timestamp: string, body: string): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
  return `sha256=${digest}`;
}

/** Constant-time check of a presented signature. */
export function verifySignature(
  secret: string,
  timestamp: string,
  body: string,
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
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async webhook(url: string, payload: JsonValue, secret?: string): Promise<void> {
    const body = JSON.stringify(payload);
    const timestamp = this.clock.now().toISOString();
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      [TIMESTAMP_HEADER]: timestamp,
    };
    if (secret) headers[SIGNATURE_HEADER] = signPayload(secret, timestamp, body);
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`webhook ${url} returned ${response.status}`);
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
    webhook: (url, payload, secret) => deps.webhooks.webhook(url, payload, secret),
    publishEvent: (eventType, payload) => deps.publishEvent(eventType, payload),
    log: (runId, payload) => deps.logger.info({ runId, result: payload }, 'loop returned'),
  };
}

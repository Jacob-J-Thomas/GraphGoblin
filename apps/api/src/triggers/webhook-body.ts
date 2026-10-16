import { createHash } from 'node:crypto';
import {
  EventNameSchema,
  JsonValueSchema,
  type WebhookAuthentication,
  type WebhookBody,
  type WebhookEventType,
  type JsonValue,
} from '@graphgoblin/contracts';
import {
  TIMESTAMP_HEADER,
  verifyRawBodySignature,
  verifySignature,
} from '@graphgoblin/infrastructure/http';

export type WebhookBodyResult =
  | { ok: true; payload: JsonValue; contentHash: string }
  | { ok: false; status: 400 | 401 | 413 | 503; code: string; detail: string };

/** Ambiguous/multiple authentication headers never select an arbitrary first value. */
function header(
  headers: Record<string, unknown>,
  name: string,
  rawHeaders?: readonly string[],
): string | undefined {
  if (rawHeaders) {
    let count = 0;
    for (let index = 0; index < rawHeaders.length; index += 2)
      if (rawHeaders[index]?.toLowerCase() === name.toLowerCase()) count++;
    if (count !== 1) return undefined;
  }
  const matches = Object.entries(headers).filter(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  if (matches.length !== 1) return undefined;
  const value = matches[0]?.[1];
  return typeof value === 'string' ? value : undefined;
}

/** Authenticate exact bytes before decoding. No credential appears in results. */
export function verifyWebhookBody(
  signing: WebhookAuthentication,
  rawBody: Uint8Array,
  headers: Record<string, unknown>,
  now: Date,
  secret: string | undefined,
  rawHeaders?: readonly string[],
  mode: WebhookBody = { type: 'json' },
): WebhookBodyResult {
  const fail = (
    status: 400 | 401 | 413 | 503,
    code: string,
    detail: string,
  ): WebhookBodyResult => ({
    ok: false,
    status,
    code,
    detail,
  });
  if (rawBody.byteLength > 1024 * 1024)
    return fail(413, 'BODY_TOO_LARGE', 'the webhook body exceeds 1 MiB');
  if (signing.type !== 'none') {
    let timestamp: string | undefined;
    if (signing.message === 'timestamp-body') {
      timestamp = header(headers, TIMESTAMP_HEADER, rawHeaders);
      const at = timestamp
        ? /^\d{1,12}$/.test(timestamp)
          ? Number(timestamp) * 1000
          : Date.parse(timestamp)
        : NaN;
      if (!timestamp || Number.isNaN(at))
        return fail(
          401,
          'TIMESTAMP_MISSING',
          `the ${TIMESTAMP_HEADER} header is missing or invalid`,
        );
      if (Math.abs(now.getTime() - at) > signing.windowSeconds * 1000)
        return fail(401, 'TIMESTAMP_OUT_OF_WINDOW', 'the delivery timestamp is outside the window');
    }
    if (secret === undefined)
      return fail(503, 'HOOK_NOT_READY', 'the endpoint has no signing secret configured');
    const signature = header(headers, signing.header, rawHeaders);
    const valid =
      signature !== undefined &&
      (signing.message === 'body'
        ? verifyRawBodySignature(secret, rawBody, signature)
        : verifySignature(secret, timestamp ?? '', rawBody, signature));
    if (!valid || signature === undefined)
      return fail(401, 'SIGNATURE_INVALID', 'the signature does not match');
  }
  let payload: unknown;
  try {
    if (mode.type === 'bytes')
      payload = { encoding: 'base64', data: Buffer.from(rawBody).toString('base64') };
    else {
      const body = new TextDecoder('utf-8', { fatal: true }).decode(rawBody);
      payload = mode.type === 'text' ? body : JSON.parse(body);
    }
  } catch {
    return fail(400, 'BODY_INVALID', 'the body is not valid UTF-8 or JSON');
  }
  const parsed = JsonValueSchema.safeParse(payload);
  if (!parsed.success) return fail(400, 'BODY_INVALID', 'the body is not valid JSON');
  return {
    ok: true,
    payload: parsed.data,
    contentHash: createHash('sha256').update(rawBody).digest('hex'),
  };
}

/** Extract invocation metadata only; it authenticates nobody and publishes no Event. */
export function extractWebhookEventType(
  config: WebhookEventType,
  payload: JsonValue,
  headers: Record<string, unknown>,
  rawHeaders?: readonly string[],
):
  { ok: true; eventType: string } | { ok: false; status: 400 | 422; code: string; detail: string } {
  let value: unknown;
  if (config.source === 'constant') value = config.value;
  else if (config.source === 'header') {
    const matches = Object.entries(headers).filter(([key]) => key.toLowerCase() === config.name);
    const count = rawHeaders
      ? rawHeaders.filter((name, index) => index % 2 === 0 && name.toLowerCase() === config.name)
          .length
      : matches.length;
    if (count > 1 || matches.length > 1 || Array.isArray(matches[0]?.[1]))
      return {
        ok: false,
        status: 400,
        code: 'EVENT_TYPE_AMBIGUOUS',
        detail: 'the event type header is ambiguous',
      };
    value = matches[0]?.[1];
  } else {
    value = payload;
    for (const encoded of config.pointer === '' ? [] : config.pointer.slice(1).split('/')) {
      const key = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
      if (
        value === null ||
        typeof value !== 'object' ||
        !Object.hasOwn(value, key) ||
        (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key))
      ) {
        value = undefined;
        break;
      }
      value = (value as Record<string, unknown>)[key];
    }
  }
  const text =
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : '';
  // Invalid scalars fail even if they would otherwise be considered blank.
  // eslint-disable-next-line no-control-regex -- Invalid controls must fail before blank-value fallback.
  if (text.length > 128 || /[\u0000-\u001f\u007f-\u009f]/u.test(text))
    return {
      ok: false,
      status: 422,
      code: 'EVENT_TYPE_INVALID',
      detail: 'the event type is invalid',
    };
  const eventType = text.trim()
    ? text
    : config.source === 'constant'
      ? config.value
      : config.fallback;
  if (!EventNameSchema.safeParse(eventType).success)
    return {
      ok: false,
      status: 422,
      code: 'EVENT_TYPE_INVALID',
      detail: 'the event type is invalid',
    };
  return { ok: true, eventType };
}

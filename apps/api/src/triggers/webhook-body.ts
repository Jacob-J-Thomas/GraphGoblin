import { createHash } from 'node:crypto';
import { JsonValueSchema, type JsonValue } from '@graphgoblin/contracts';
import {
  TIMESTAMP_HEADER,
  verifyRawBodySignature,
  verifySignature,
} from '@graphgoblin/infrastructure/http';

export type WebhookSigning =
  | { scheme: 'hmac-sha256'; header: string; replayWindowSeconds: number }
  | { scheme: 'hmac-sha256-body'; header: string };

export type WebhookBodyResult =
  | { ok: true; payload: JsonValue; contentHash: string; signatureHash: string }
  | { ok: false; status: 400 | 401 | 503; code: string; detail: string };

/** Ambiguous/multiple authentication headers never select an arbitrary first value. */
function header(headers: Record<string, unknown>, name: string): string | undefined {
  const matches = Object.entries(headers).filter(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  if (matches.length !== 1) return undefined;
  const value = matches[0]?.[1];
  return typeof value === 'string' ? value : undefined;
}

/** Authenticate exact bytes before decoding body-signature requests. No credential appears in results. */
export function verifyWebhookBody(
  signing: WebhookSigning,
  rawBody: Uint8Array,
  headers: Record<string, unknown>,
  now: Date,
  secret: string | undefined,
): WebhookBodyResult {
  const fail = (status: 400 | 401 | 503, code: string, detail: string): WebhookBodyResult => ({
    ok: false,
    status,
    code,
    detail,
  });
  let timestamp: string | undefined;
  if (signing.scheme === 'hmac-sha256') {
    timestamp = header(headers, TIMESTAMP_HEADER);
    const at = timestamp
      ? /^\d{1,12}$/.test(timestamp)
        ? Number(timestamp) * 1000
        : Date.parse(timestamp)
      : NaN;
    if (!timestamp || Number.isNaN(at))
      return fail(401, 'TIMESTAMP_MISSING', `the ${TIMESTAMP_HEADER} header is missing or invalid`);
    if (Math.abs(now.getTime() - at) > signing.replayWindowSeconds * 1000)
      return fail(401, 'TIMESTAMP_OUT_OF_WINDOW', 'the delivery timestamp is outside the window');
  }
  if (secret === undefined)
    return fail(503, 'HOOK_NOT_READY', 'the endpoint has no signing secret configured');
  const signature = header(headers, signing.header);
  const valid =
    signature !== undefined &&
    (signing.scheme === 'hmac-sha256-body'
      ? verifyRawBodySignature(secret, rawBody, signature)
      : verifySignature(secret, timestamp ?? '', Buffer.from(rawBody).toString('utf8'), signature));
  if (!valid || signature === undefined)
    return fail(401, 'SIGNATURE_INVALID', 'the signature does not match');
  let payload: unknown;
  try {
    const body =
      signing.scheme === 'hmac-sha256-body'
        ? new TextDecoder('utf-8', { fatal: true }).decode(rawBody)
        : Buffer.from(rawBody).toString('utf8');
    payload = signing.scheme === 'hmac-sha256' && body.trim() === '' ? null : JSON.parse(body);
  } catch {
    return fail(400, 'BODY_INVALID', 'the body is not valid UTF-8 JSON');
  }
  const parsed = JsonValueSchema.safeParse(payload);
  if (!parsed.success) return fail(400, 'BODY_INVALID', 'the body is not valid JSON');
  return {
    ok: true,
    payload: parsed.data,
    contentHash: createHash('sha256').update(rawBody).digest('hex'),
    signatureHash: createHash('sha256')
      .update(Buffer.from(signature.slice(7), 'hex'))
      .digest('hex'),
  };
}

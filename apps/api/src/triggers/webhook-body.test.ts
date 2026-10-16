import { describe, expect, it, vi } from 'vitest';
import { signPayload, signRawBody } from '@graphgoblin/infrastructure/http';
import { verifyWebhookBody, type WebhookSigning } from './webhook-body.js';
const now = new Date('2026-10-02T12:00:00.000Z');
const bodySigning: WebhookSigning = { scheme: 'hmac-sha256-body', header: 'x-hub-signature-256' };
const timestampSigning: WebhookSigning = {
  scheme: 'hmac-sha256',
  header: 'x-signature',
  replayWindowSeconds: 300,
};
const bytes = (value: string) => Buffer.from(value, 'utf8');

describe('webhook byte authentication', () => {
  it.each([bodySigning, timestampSigning])(
    'authenticates exact malformed bytes before any decoding ($scheme)',
    (signing) => {
      const body = Buffer.from([0xff, 0x80, 0x00]);
      const timestamp = now.toISOString();
      const signature =
        signing.scheme === 'hmac-sha256-body'
          ? signRawBody('secret', body)
          : signPayload('secret', timestamp, body);
      const headers = { [signing.header]: signature, 'x-graphgoblin-timestamp': timestamp };
      const decode = vi.spyOn(TextDecoder.prototype, 'decode');
      try {
        expect(verifyWebhookBody(signing, body, headers, now, 'wrong')).toMatchObject({
          status: 401,
        });
        expect(decode).not.toHaveBeenCalled();
        expect(verifyWebhookBody(signing, body, headers, now, 'secret')).toMatchObject({
          status: 400,
        });
        expect(decode).toHaveBeenCalledTimes(1);
      } finally {
        decode.mockRestore();
      }
    },
  );
  it.each([bodySigning, timestampSigning])(
    'rejects raw duplicate credentials even if normalized headers contain one value ($scheme)',
    (signing) => {
      const body = bytes('{}');
      const timestamp = now.toISOString();
      const signature =
        signing.scheme === 'hmac-sha256-body'
          ? signRawBody('secret', body)
          : signPayload('secret', timestamp, body);
      const headers = { [signing.header]: signature, 'x-graphgoblin-timestamp': timestamp };
      expect(
        verifyWebhookBody(signing, body, headers, now, 'secret', [
          signing.header,
          signature,
          signing.header.toUpperCase(),
          signature,
          'x-graphgoblin-timestamp',
          timestamp,
        ]),
      ).toMatchObject({ status: 401, code: 'SIGNATURE_INVALID' });
      if (signing.scheme === 'hmac-sha256')
        expect(
          verifyWebhookBody(signing, body, headers, now, 'secret', [
            signing.header,
            signature,
            'x-graphgoblin-timestamp',
            timestamp,
            'X-GraphGoblin-Timestamp',
            timestamp,
          ]),
        ).toMatchObject({ status: 401, code: 'TIMESTAMP_MISSING' });
    },
  );
  it.each([bodySigning, timestampSigning])(
    'rejects empty and whitespace JSON but accepts literal null ($scheme)',
    (signing) => {
      const timestamp = now.toISOString();
      for (const text of ['', ' \n\t', 'null']) {
        const body = bytes(text);
        const signature =
          signing.scheme === 'hmac-sha256-body'
            ? signRawBody('secret', body)
            : signPayload('secret', timestamp, body);
        expect(
          verifyWebhookBody(
            signing,
            body,
            { [signing.header]: signature, 'x-graphgoblin-timestamp': timestamp },
            now,
            'secret',
          ),
        ).toMatchObject(
          text === 'null' ? { ok: true, payload: null } : { status: 400, code: 'BODY_INVALID' },
        );
      }
    },
  );
  it('accepts body signing without timestamps and hashes identical content independently of signature casing and secret rotation', () => {
    const body = bytes('{"action":"opened","title":"é"}\n');
    const signed = signRawBody('secret', body);
    const first = verifyWebhookBody(
      bodySigning,
      body,
      { 'X-Hub-Signature-256': signed },
      now,
      'secret',
    );
    const upper = verifyWebhookBody(
      bodySigning,
      body,
      { 'x-hub-signature-256': 'sha256=' + signed.slice(7).toUpperCase() },
      now,
      'secret',
    );
    const rotated = verifyWebhookBody(
      bodySigning,
      body,
      { 'x-hub-signature-256': signRawBody('new-secret', body) },
      now,
      'new-secret',
    );
    expect(first.ok).toBe(true);
    if (!first.ok || !upper.ok || !rotated.ok) throw new Error('expected valid signatures');
    expect(first.payload).toEqual({ action: 'opened', title: 'é' });
    expect(first.contentHash).toBe(upper.contentHash);
    expect(first.contentHash).toBe(rotated.contentHash);
    expect(first.signatureHash).toBe(upper.signatureHash);
    expect(JSON.stringify(first)).not.toContain(signed);
    expect(
      verifyWebhookBody(
        bodySigning,
        bytes('{"action":"opened","title":"é"}'),
        { 'x-hub-signature-256': signed },
        now,
        'secret',
      ),
    ).toMatchObject({ ok: false, status: 401 });
  });
  it('rejects ambiguous authentication headers and missing signatures with safe details', () => {
    const body = bytes('{}'),
      signature = signRawBody('secret', body);
    for (const headers of [
      {},
      { 'x-hub-signature-256': [signature] },
      { 'x-hub-signature-256': signature, 'X-Hub-Signature-256': signature },
    ])
      expect(verifyWebhookBody(bodySigning, body, headers, now, 'secret')).toMatchObject({
        ok: false,
        code: 'SIGNATURE_INVALID',
      });
    const result = verifyWebhookBody(
      bodySigning,
      body,
      { 'x-hub-signature-256': 'credential-bearing-invalid-signature' },
      now,
      'secret',
    );
    expect(JSON.stringify(result)).not.toContain('credential-bearing');
    expect(verifyWebhookBody(bodySigning, body, {}, now, undefined)).toMatchObject({
      ok: false,
      code: 'HOOK_NOT_READY',
      status: 503,
    });
  });
  it('verifies before JSON/UTF8 parsing, then rejects correctly signed invalid bodies', () => {
    for (const body of [
      bytes(''),
      bytes(' \n\t'),
      bytes('{'),
      Buffer.from([0xff]),
      bytes('1e999'),
    ]) {
      expect(
        verifyWebhookBody(
          bodySigning,
          body,
          { 'x-hub-signature-256': signRawBody('secret', body) },
          now,
          'wrong',
        ),
      ).toMatchObject({ status: 401 });
      expect(
        verifyWebhookBody(
          bodySigning,
          body,
          { 'x-hub-signature-256': signRawBody('secret', body) },
          now,
          'secret',
        ),
      ).toMatchObject({ status: 400, code: 'BODY_INVALID' });
    }
  });
  it('preserves timestamp signing, window boundaries, Unix timestamps and literal JSON null', () => {
    const body = bytes('null'),
      timestamp = now.toISOString();
    expect(
      verifyWebhookBody(
        timestampSigning,
        body,
        {
          'x-graphgoblin-timestamp': timestamp,
          'x-signature': signPayload('secret', timestamp, body),
        },
        now,
        'secret',
      ),
    ).toMatchObject({ ok: true, payload: null });
    const unix = String(now.getTime() / 1000);
    expect(
      verifyWebhookBody(
        timestampSigning,
        bytes('{}'),
        { 'x-graphgoblin-timestamp': unix, 'x-signature': signPayload('secret', unix, '{}') },
        now,
        'secret',
      ),
    ).toMatchObject({ ok: true });
    expect(verifyWebhookBody(timestampSigning, body, {}, now, undefined)).toMatchObject({
      code: 'TIMESTAMP_MISSING',
    });
    expect(
      verifyWebhookBody(
        timestampSigning,
        body,
        { 'x-graphgoblin-timestamp': 'bad' },
        now,
        'secret',
      ),
    ).toMatchObject({ code: 'TIMESTAMP_MISSING' });
    expect(
      verifyWebhookBody(
        timestampSigning,
        body,
        { 'x-graphgoblin-timestamp': new Date(now.getTime() - 300001).toISOString() },
        now,
        'secret',
      ),
    ).toMatchObject({ code: 'TIMESTAMP_OUT_OF_WINDOW' });
  });
});

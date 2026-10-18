import { describe, expect, it, vi } from 'vitest';
import { signPayload, signRawBody } from '@graphgoblin/infrastructure/http';
import type { WebhookAuthentication } from '@graphgoblin/contracts';
import { extractWebhookEventType, verifyWebhookBody } from './webhook-body.js';
const now = new Date('2026-10-02T12:00:00.000Z');
const bodySigning: Exclude<WebhookAuthentication, { type: 'none' }> = {
  type: 'hmac-sha256',
  message: 'body',
  secretRef: 'key',
  header: 'x-hub-signature-256',
};
const timestampSigning: Exclude<WebhookAuthentication, { type: 'none' }> = {
  type: 'hmac-sha256',
  message: 'timestamp-body',
  secretRef: 'key',
  header: 'x-signature',
  windowSeconds: 300,
};
const bytes = (value: string) => Buffer.from(value, 'utf8');

describe('webhook byte authentication', () => {
  it.each([bodySigning, timestampSigning])(
    'authenticates exact malformed bytes before any decoding ($message)',
    (signing) => {
      const body = Buffer.from([0xff, 0x80, 0x00]);
      const timestamp = now.toISOString();
      const signature =
        signing.message === 'body'
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
    'rejects raw duplicate credentials even if normalized headers contain one value ($message)',
    (signing) => {
      const body = bytes('{}');
      const timestamp = now.toISOString();
      const signature =
        signing.message === 'body'
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
      if (signing.message === 'timestamp-body')
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
    'rejects empty and whitespace JSON but accepts literal null ($message)',
    (signing) => {
      const timestamp = now.toISOString();
      for (const text of ['', ' \n\t', 'null']) {
        const body = bytes(text);
        const signature =
          signing.message === 'body'
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

describe('general decoding and event metadata', () => {
  it.each(['none', 'body', 'timestamp-body'] as const)(
    'decodes actual bytes after %s authentication',
    (recipe) => {
      const auth: WebhookAuthentication =
        recipe === 'none' ? { type: 'none' } : recipe === 'body' ? bodySigning : timestampSigning;
      for (const type of ['json', 'text', 'bytes'] as const) {
        const raw =
          type === 'bytes'
            ? Buffer.from([0xff, 0, 0x80])
            : Buffer.from(type === 'text' ? '<xml>\u{1f47a}</xml>' : '"\u{1f47a}"');
        const headers =
          auth.type === 'none'
            ? {}
            : {
                [auth.header]:
                  auth.message === 'body'
                    ? signRawBody('secret', raw)
                    : signPayload('secret', now.toISOString(), raw),
                'x-graphgoblin-timestamp': now.toISOString(),
              };
        expect(
          verifyWebhookBody(
            auth,
            raw,
            headers,
            now,
            auth.type === 'none' ? undefined : 'secret',
            undefined,
            { type },
          ),
        ).toMatchObject({
          ok: true,
          payload:
            type === 'bytes'
              ? { encoding: 'base64', data: raw.toString('base64') }
              : type === 'text'
                ? '<xml>\u{1f47a}</xml>'
                : '\u{1f47a}',
        });
        if (auth.type !== 'none')
          expect(
            verifyWebhookBody(auth, raw, headers, now, 'wrong', undefined, { type }),
          ).toMatchObject({ status: 401 });
      }
    },
  );
  it('allows empty text/bytes, bounds unsigned bytes and refuses unsigned invalid JSON/UTF8', () => {
    for (const type of ['text', 'bytes'] as const)
      expect(
        verifyWebhookBody({ type: 'none' }, Buffer.alloc(0), {}, now, undefined, undefined, {
          type,
        }),
      ).toMatchObject({
        ok: true,
        payload: type === 'text' ? '' : { encoding: 'base64', data: '' },
      });
    expect(
      verifyWebhookBody({ type: 'none' }, Buffer.alloc(1024 * 1024 + 1), {}, now, undefined),
    ).toMatchObject({ status: 413 });
    for (const raw of [Buffer.alloc(0), bytes(' '), Buffer.from([0xff])])
      expect(verifyWebhookBody({ type: 'none' }, raw, {}, now, undefined)).toMatchObject({
        status: 400,
      });
    expect(
      verifyWebhookBody({ type: 'none' }, Buffer.from([0xff]), {}, now, undefined, undefined, {
        type: 'text',
      }),
    ).toMatchObject({ status: 400 });
  });
  it('extracts constants, headers, escaped own-property/array/root pointers and scalar metadata', () => {
    const pointer = (path: string, payload: Parameters<typeof extractWebhookEventType>[1]) =>
      extractWebhookEventType(
        { source: 'json-pointer', pointer: path, fallback: 'fallback' },
        payload,
        {},
      );
    expect(extractWebhookEventType({ source: 'constant', value: 'event' }, null, {})).toEqual({
      ok: true,
      eventType: 'event',
    });
    expect(
      extractWebhookEventType({ source: 'header', name: 'x-event', fallback: 'fallback' }, null, {
        'X-Event': 'issues',
      }),
    ).toEqual({ ok: true, eventType: 'issues' });
    expect(pointer('/a~1b/~0/0', { 'a/b': { '~': ['issues'] } })).toEqual({
      ok: true,
      eventType: 'issues',
    });
    expect(pointer('', 'root')).toEqual({ ok: true, eventType: 'root' });
    for (const [path, payload] of [
      ['/x', null],
      ['/x', {}],
      ['/toString', {}],
      ['/length', []],
      ['/01', ['a', 'b']],
      ['/x', { x: {} }],
      ['/x', { x: null }],
      ['/x', { x: ' ' }],
    ] as const)
      expect(
        pointer(path, JSON.parse(JSON.stringify(payload)) as Parameters<typeof pointer>[1]),
      ).toEqual({ ok: true, eventType: 'fallback' });
    expect(pointer('/x', { x: 0 })).toEqual({ ok: true, eventType: '0' });
    expect(pointer('/x', { x: false })).toEqual({ ok: true, eventType: 'false' });
    expect(
      pointer(
        '/__proto__/event',
        JSON.parse('{"__proto__":{"event":"own"}}') as Parameters<typeof pointer>[1],
      ),
    ).toEqual({ ok: true, eventType: 'own' });
  });
  it('rejects ambiguous raw header metadata and invalid scalars instead of using a fallback', () => {
    const config = { source: 'header' as const, name: 'x-event', fallback: 'fallback' };
    for (const headers of [{ 'x-event': ['a'] }, { 'x-event': 'a', 'X-Event': 'b' }])
      expect(extractWebhookEventType(config, null, headers)).toMatchObject({
        status: 400,
        code: 'EVENT_TYPE_AMBIGUOUS',
      });
    expect(
      extractWebhookEventType(config, null, { 'x-event': 'a' }, ['x-event', 'a', 'X-EVENT', 'a']),
    ).toMatchObject({ status: 400 });
    expect(extractWebhookEventType(config, null, {})).toEqual({ ok: true, eventType: 'fallback' });
    for (const value of ['a\nb', 'x'.repeat(129), '\u0000', '\t', ' '.repeat(129)])
      expect(extractWebhookEventType(config, null, { 'x-event': value })).toMatchObject({
        status: 422,
        code: 'EVENT_TYPE_INVALID',
      });
  });
});

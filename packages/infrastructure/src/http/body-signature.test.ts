import { describe, expect, it } from 'vitest';
import { signPayload, signRawBody, verifyRawBodySignature, verifySignature } from './delivery.js';

describe('body-only webhook HMAC', () => {
  // Official interoperability vector: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
  it('matches the published GitHub SHA256 vector without a timestamp', () => {
    const body = Buffer.from('Hello, World!', 'utf8');
    const signature = 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17';
    expect(signRawBody("It's a Secret to Everybody", body)).toBe(signature);
    expect(verifyRawBodySignature("It's a Secret to Everybody", body, signature)).toBe(true);
    expect(
      verifyRawBodySignature(
        "It's a Secret to Everybody",
        body,
        'sha256=' + signature.slice(7).toUpperCase(),
      ),
    ).toBe(true);
  });

  it('authenticates exact bytes before any decoding, parsing or normalization', () => {
    const body = Buffer.from('{"message":"雪🦎","number":1}\r\n', 'utf8');
    const signature = signRawBody('local-test-secret', body);
    expect(verifyRawBodySignature('local-test-secret', body, signature)).toBe(true);
    for (const changed of [
      Buffer.from('{"message":"雪🦎","number":1}\n', 'utf8'),
      Buffer.from('{"number":1,"message":"雪🦎"}\r\n', 'utf8'),
      Buffer.from('{"message": "雪🦎", "number":1}\r\n', 'utf8'),
      Buffer.from('{"message":"雪🦎","number":2}\r\n', 'utf8'),
    ])
      expect(verifyRawBodySignature('local-test-secret', changed, signature)).toBe(false);
    const undecodable = Uint8Array.from([0xff, 0xfe, 0x00, 0x80]);
    const signedBytes = signRawBody('local-test-secret', undecodable);
    expect(verifyRawBodySignature('local-test-secret', undecodable, signedBytes)).toBe(true);
    expect(
      verifyRawBodySignature(
        'local-test-secret',
        Buffer.from(Buffer.from(undecodable).toString('utf8')),
        signedBytes,
      ),
    ).toBe(false);
  });

  it('refuses incorrect secrets and malformed algorithm/digest headers without throwing', () => {
    const body = new Uint8Array();
    const signature = signRawBody('secret', body);
    expect(verifyRawBodySignature('other', body, signature)).toBe(false);
    for (const malformed of [
      '',
      'sha256=',
      signature.slice(0, -1),
      signature + '0',
      'sha1=' + signature.slice(7),
      'SHA256=' + signature.slice(7),
      ' sha256=' + signature.slice(7),
      signature + '\r\n',
      'sha256=' + 'z'.repeat(64),
      'sha256=' + '0'.repeat(63) + ' ',
      signature + ',' + signature,
    ])
      expect(verifyRawBodySignature('secret', body, malformed)).toBe(false);
  });

  it('keeps timestamp signing independent with its exact existing verification behavior', () => {
    const timestamp = '2026-10-07T12:00:00.000Z';
    const body = '{"a":1}';
    const timestampSignature = signPayload('secret', timestamp, body);
    const bodySignature = signRawBody('secret', Buffer.from(body));
    expect(timestampSignature).not.toBe(bodySignature);
    expect(verifySignature('secret', timestamp, body, timestampSignature)).toBe(true);
    expect(verifySignature('secret', '2026-10-07T12:00:01.000Z', body, timestampSignature)).toBe(
      false,
    );
    expect(verifySignature('secret', timestamp, body, bodySignature)).toBe(false);
    expect(verifyRawBodySignature('secret', Buffer.from(body), timestampSignature)).toBe(false);
  });
});

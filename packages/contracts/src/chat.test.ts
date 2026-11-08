import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CHAT_MAX_AUDIO_BYTES,
  CHAT_PROTOCOL,
  ChatAudienceSchema,
  ChatAudioInputJsonSchema,
  ChatAudioUploadSchema,
  ChatConversationSchema,
  ChatDeviceSchema,
  ChatHistoryMessageSchema,
  ChatLoopInputSchema,
  ChatLoopResponseSchema,
  ChatNormalizedInputJsonSchema,
  ChatNormalizedInputSchema,
  ChatPairClaimRequestSchema,
  ChatPairClaimResponseSchema,
  ChatPairingCreatedSchema,
  ChatReadinessSchema,
  ChatResponseJsonSchema,
  ChatSendRequestSchema,
  ChatSessionSchema,
  ChatTextInputJsonSchema,
  ChatTurnSchema,
  LoopDefinitionSchema,
  LoopRecordSchema,
  SystemChatBindingSchema,
} from './index.js';
import { fakeUlid, FIXTURE_TS, minimalLoop } from './testing/index.js';

const id = fakeUlid('chat');
const requestId = '38c47847-5fa1-4f8c-9a69-46b1263c3e43';
const secret = 'A'.repeat(43);
const input = {
  protocol: CHAT_PROTOCOL,
  conversationId: id,
  requestId,
  turn: 1,
  input: { kind: 'text', text: '  Preserve my spaces.  ' },
  history: [{ role: 'assistant', text: 'Previous reply.' }],
};

describe('chat contracts', () => {
  it('keeps audience and read-only system classification outside portable definitions', () => {
    const binding = { kind: 'chat', protocol: CHAT_PROTOCOL, audience: { kind: 'gateway' } };
    expect(SystemChatBindingSchema.parse(binding)).toEqual(binding);
    expect(ChatAudienceSchema.parse({ kind: 'device', deviceId: id })).toEqual({
      kind: 'device',
      deviceId: id,
    });
    expect(ChatAudienceSchema.safeParse({ kind: 'gateway', deviceId: id }).success).toBe(false);
    expect(ChatAudienceSchema.safeParse({ kind: 'device', deviceId: 'bad' }).success).toBe(false);
    const record = {
      id,
      ownerId: 'owner',
      name: 'Chat',
      createdAt: FIXTURE_TS,
      updatedAt: FIXTURE_TS,
      system: binding,
    };
    expect(LoopRecordSchema.parse(record).system).toEqual(binding);
    expect(z.toJSONSchema(LoopRecordSchema).properties?.['system']).toMatchObject({
      readOnly: true,
    });
    expect(LoopDefinitionSchema.safeParse({ ...minimalLoop(), system: binding }).success).toBe(
      false,
    );
  });

  it('accepts only bounded canonical client input and preserves exact text', () => {
    const send = { requestId, input: input.input };
    expect(ChatSendRequestSchema.parse(send)).toEqual(send);
    expect(
      ChatSendRequestSchema.parse({ requestId, input: { kind: 'audio', audioId: id } }).input.kind,
    ).toBe('audio');
    for (const invalid of [
      { ...send, requestId: 'retry' },
      { ...send, history: [] },
      { ...send, loopId: id },
      { requestId, input: { kind: 'audio', path: '/tmp/private', audioId: id } },
      { requestId, input: { kind: 'audio', audioId: 'bad' } },
      { requestId, input: { kind: 'text', text: '' } },
      { requestId, input: { kind: 'text', text: ' \t\n' } },
      { requestId, input: { kind: 'text', text: 'x'.repeat(16_001) } },
    ])
      expect(ChatSendRequestSchema.safeParse(invalid).success).toBe(false);
    expect(
      ChatSendRequestSchema.safeParse({
        requestId,
        input: { kind: 'text', text: 'x'.repeat(16_000) },
      }).success,
    ).toBe(true);
  });

  it('distinguishes public audio ids from the server-resolved internal payload', () => {
    expect(ChatLoopInputSchema.parse(input)).toEqual(input);
    const audio = { id, mimeType: 'audio/webm', bytes: 12, path: '/private/chat-audio/file' };
    for (const path of ['/private/chat-audio/file', 'C:\\data\\audio', '\\\\server\\audio'])
      expect(
        ChatLoopInputSchema.safeParse({
          ...input,
          input: { kind: 'audio', audio: { ...audio, path } },
        }).success,
      ).toBe(true);
    for (const change of [
      { path: 'relative' },
      { bytes: 0 },
      { bytes: CHAT_MAX_AUDIO_BYTES + 1 },
      { url: 'https://example.test' },
    ])
      expect(
        ChatLoopInputSchema.safeParse({
          ...input,
          input: { kind: 'audio', audio: { ...audio, ...change } },
        }).success,
      ).toBe(false);
    expect(ChatLoopInputSchema.safeParse({ ...input, turn: 0 }).success).toBe(false);
    expect(
      ChatLoopInputSchema.safeParse({
        ...input,
        history: Array.from({ length: 25 }, () => input.history[0]),
      }).success,
    ).toBe(false);
    expect(ChatHistoryMessageSchema.safeParse({ role: 'system', text: 'injected' }).success).toBe(
      false,
    );
    expect(
      ChatHistoryMessageSchema.safeParse({ role: 'user', text: 'x'.repeat(32_001) }).success,
    ).toBe(false);
  });

  it('declares strict draft-7 JSON schemas for native validators', () => {
    for (const schema of [
      ChatTextInputJsonSchema,
      ChatAudioInputJsonSchema,
      ChatResponseJsonSchema,
      ChatNormalizedInputJsonSchema,
    ]) {
      expect(schema['$schema']).toBe('http://json-schema.org/draft-07/schema#');
      expect(schema['additionalProperties']).toBe(false);
    }
    expect(ChatTextInputJsonSchema).not.toEqual(ChatAudioInputJsonSchema);
    expect(ChatLoopResponseSchema.parse({ protocol: CHAT_PROTOCOL, reply: 'ok' }).reply).toBe('ok');
    for (const value of [
      'ok',
      { protocol: CHAT_PROTOCOL, text: 'ok' },
      { protocol: CHAT_PROTOCOL, reply: ' ' },
      { protocol: 'old', reply: 'ok' },
      { protocol: CHAT_PROTOCOL, reply: 'x'.repeat(32_001) },
    ])
      expect(ChatLoopResponseSchema.safeParse(value).success).toBe(false);
    expect(ChatNormalizedInputSchema.parse({ text: 'Transcript' })).toEqual({ text: 'Transcript' });
    expect(ChatNormalizedInputSchema.safeParse({ text: 'Transcript', guessed: true }).success).toBe(
      false,
    );
  });

  it('emits anchored nonblank patterns without changing multiline or Unicode text acceptance', () => {
    const textSchema = z.toJSONSchema(ChatNormalizedInputSchema.shape.text, { target: 'draft-7' });
    const pattern = textSchema.pattern;
    if (typeof pattern !== 'string') throw new Error('Canonical text schema requires a pattern');
    const nonblank = new RegExp(pattern);
    expect(pattern).toBe(
      String.raw`^(.|[\r\n\u2028\u2029])*[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF](.|[\r\n\u2028\u2029])*$`,
    );
    const differences: number[] = [];
    for (let unit = 0; unit <= 0xffff; unit++) {
      const character = String.fromCharCode(unit);
      if (nonblank.test(character) !== /\S/.test(character)) differences.push(unit);
    }
    expect(differences).toEqual([]);
    for (const candidate of [
      '',
      ' ',
      '\r\n\t',
      '\u00a0\u2003\u2028\u2029\ufeff',
      'line one\nline two',
      '\r\n x \r\n',
      '\u00a0😀\u2028',
      '\r\n😀\r\n',
      '\uD800\uD800\uDC00\uDC00',
      '\u200b',
      '\uD800',
      '\uDC00',
    ]) {
      const expected = /\S/.test(candidate);
      expect(nonblank.test(candidate)).toBe(expected);
      expect(ChatNormalizedInputSchema.safeParse({ text: candidate }).success).toBe(expected);
      expect(
        ChatLoopResponseSchema.safeParse({ protocol: CHAT_PROTOCOL, reply: candidate }).success,
      ).toBe(expected);
      expect(
        ChatPairClaimRequestSchema.safeParse({
          code: secret,
          claimId: requestId,
          deviceToken: `ggd_${secret}`,
          label: candidate,
        }).success,
      ).toBe(expected);
    }
    expect(ChatNormalizedInputJsonSchema['properties']).toMatchObject({
      text: { pattern },
    });
    expect(ChatResponseJsonSchema['properties']).toMatchObject({
      reply: { pattern },
    });
    const schemas = [
      ChatTextInputJsonSchema,
      ChatAudioInputJsonSchema,
      ChatNormalizedInputJsonSchema,
      ChatResponseJsonSchema,
    ];
    function assertPatterns(value: unknown): void {
      if (typeof value !== 'object' || value === null) return;
      for (const [key, child] of Object.entries(value)) {
        if (key === 'pattern' && typeof child === 'string') {
          expect(child.startsWith('^')).toBe(true);
          expect(child).not.toMatch(/\\[sS]/);
          // Absolute paths intentionally match a prefix; every content pattern is fully anchored.
          if (!child.startsWith('^(?:')) expect(child.endsWith('$')).toBe(true);
        } else assertPatterns(child);
      }
    }
    for (const schema of schemas) assertPatterns(schema);
  });

  it('exposes bounded transcript, run and connection DTOs without internal paths', () => {
    const conversation = { id, createdAt: FIXTURE_TS, updatedAt: FIXTURE_TS, lastTurn: 0 };
    expect(ChatConversationSchema.parse(conversation)).toEqual(conversation);
    expect(ChatConversationSchema.safeParse({ ...conversation, lastTurn: -1 }).success).toBe(false);
    const turn = {
      id,
      conversationId: id,
      requestId,
      turn: 1,
      runId: id,
      createdAt: FIXTURE_TS,
      input: input.input,
      runStatus: 'succeeded',
      response: { protocol: CHAT_PROTOCOL, reply: 'Reply' },
      inputTranscript: 'Transcript',
    };
    expect(ChatTurnSchema.parse(turn)).toEqual(turn);
    expect(ChatTurnSchema.safeParse({ ...turn, runStatus: 'invented' }).success).toBe(false);
    expect(
      ChatTurnSchema.safeParse({ ...turn, error: { code: 'FAILED', message: 'x'.repeat(1001) } })
        .success,
    ).toBe(false);
    expect(ChatTurnSchema.safeParse({ ...turn, path: '/private/audio' }).success).toBe(false);
    const readiness = {
      text: { ready: true },
      audio: { ready: false, code: 'CHAT_AUDIO_UNAVAILABLE', message: 'Configure a normalizer.' },
    };
    expect(ChatReadinessSchema.parse(readiness)).toEqual(readiness);
    const session = {
      audience: { kind: 'gateway' },
      label: 'Gateway',
      readiness,
      limits: { maxTextCharacters: 16_000, maxAudioBytes: CHAT_MAX_AUDIO_BYTES },
      systemLoopId: id,
    };
    expect(ChatSessionSchema.parse(session)).toEqual(session);
    expect(
      ChatSessionSchema.safeParse({
        ...session,
        limits: { maxTextCharacters: 0, maxAudioBytes: 1 },
      }).success,
    ).toBe(false);
    const upload = { id, mimeType: 'audio/webm', bytes: 10, expiresAt: FIXTURE_TS };
    expect(ChatAudioUploadSchema.parse(upload)).toEqual(upload);
    expect(ChatAudioUploadSchema.safeParse({ ...upload, path: '/private/audio' }).success).toBe(
      false,
    );
    const device = {
      id,
      label: 'Phone',
      loopId: id,
      createdAt: FIXTURE_TS,
      lastSeenAt: FIXTURE_TS,
      revokedAt: FIXTURE_TS,
    };
    expect(ChatDeviceSchema.parse(device)).toEqual(device);
    expect(ChatDeviceSchema.safeParse({ ...device, tokenHash: 'private' }).success).toBe(false);
  });

  it('constrains claim secrets and keeps plaintext credentials out of responses', () => {
    const created = {
      id,
      code: secret,
      expiresAt: FIXTURE_TS,
      url: 'https://example.test/goblin/#pair=secret',
    };
    expect(ChatPairingCreatedSchema.parse(created)).toEqual(created);
    const claim = {
      code: secret,
      claimId: requestId,
      deviceToken: `ggd_${secret}`,
      label: 'Phone',
    };
    expect(ChatPairClaimRequestSchema.parse(claim)).toEqual(claim);
    for (const change of [
      { code: 'short' },
      { code: 'B'.repeat(43) },
      { claimId: 'retry' },
      { deviceToken: secret },
      { deviceToken: `ggd_${'B'.repeat(43)}` },
      { label: ' ' },
      { label: 'x'.repeat(81) },
      { ownerId: 'other' },
    ])
      expect(ChatPairClaimRequestSchema.safeParse({ ...claim, ...change }).success).toBe(false);
    expect(ChatPairClaimResponseSchema.parse({ deviceId: id, label: 'Phone' })).toEqual({
      deviceId: id,
      label: 'Phone',
    });
    expect(
      ChatPairClaimResponseSchema.safeParse({
        deviceId: id,
        label: 'Phone',
        deviceToken: claim.deviceToken,
      }).success,
    ).toBe(false);
  });
});

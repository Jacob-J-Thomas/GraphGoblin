import { z } from 'zod';
import { TimestampSchema, UlidSchema, type JsonSchema } from './common.js';

export const CHAT_PROTOCOL = 'graphgoblin.chat.v1' as const;
export const CHAT_MAX_TEXT_CHARACTERS = 16_000;
export const CHAT_MAX_REPLY_CHARACTERS = 32_000;
export const CHAT_MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const CHAT_MAX_HISTORY_MESSAGES = 24;
export const CHAT_MAX_HISTORY_CHARACTERS = 64_000;

export const ChatProtocolSchema = z.literal(CHAT_PROTOCOL);
export type ChatProtocol = z.infer<typeof ChatProtocolSchema>;
export const ChatAudienceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('gateway') }),
  z.strictObject({ kind: z.literal('device'), deviceId: UlidSchema }),
]);
export type ChatAudience = z.infer<typeof ChatAudienceSchema>;
export const SystemChatBindingSchema = z.strictObject({
  kind: z.literal('chat'),
  protocol: ChatProtocolSchema,
  audience: ChatAudienceSchema,
});
export type SystemChatBinding = z.infer<typeof SystemChatBindingSchema>;

// Spell out ECMAScript whitespace for native JSON-schema grammar portability.
const text = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .regex(
      // eslint-disable-next-line no-control-regex -- ECMAScript whitespace includes tab through carriage return.
      /^(.|[\r\n\u2028\u2029])*[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF](.|[\r\n\u2028\u2029])*$/,
      'must not be blank',
    );
const ChatTextSchema = text(CHAT_MAX_TEXT_CHARACTERS);
const ChatLabelSchema = text(80);
export const ChatSendInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text'), text: ChatTextSchema }),
  z.strictObject({ kind: z.literal('audio'), audioId: UlidSchema }),
]);
export type ChatSendInput = z.infer<typeof ChatSendInputSchema>;
export const ChatSendRequestSchema = z.strictObject({
  requestId: z.uuid(),
  input: ChatSendInputSchema,
});
export type ChatSendRequest = z.infer<typeof ChatSendRequestSchema>;
export const ChatHistoryMessageSchema = z.strictObject({
  role: z.enum(['user', 'assistant']),
  text: text(CHAT_MAX_REPLY_CHARACTERS),
});
export type ChatHistoryMessage = z.infer<typeof ChatHistoryMessageSchema>;

/** Internal engine payload. Its trusted absolute path never appears in a public DTO. */
const ChatAudioReferenceSchema = z.strictObject({
  id: UlidSchema,
  mimeType: z.string().min(1).max(128),
  bytes: z.number().int().min(1).max(CHAT_MAX_AUDIO_BYTES),
  path: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^(?:\/|[A-Za-z]:[\\/]|\\\\)/, 'must be absolute'),
});
const ChatTextLoopInputSchema = z.strictObject({ kind: z.literal('text'), text: ChatTextSchema });
const ChatAudioLoopInputSchema = z.strictObject({
  kind: z.literal('audio'),
  audio: ChatAudioReferenceSchema,
});
const loopInputShape = {
  protocol: ChatProtocolSchema,
  conversationId: UlidSchema,
  requestId: z.uuid(),
  turn: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  history: z.array(ChatHistoryMessageSchema).max(CHAT_MAX_HISTORY_MESSAGES),
};
export const ChatLoopInputSchema = z.strictObject({
  ...loopInputShape,
  input: z.discriminatedUnion('kind', [ChatTextLoopInputSchema, ChatAudioLoopInputSchema]),
});
export type ChatLoopInput = z.infer<typeof ChatLoopInputSchema>;
export const ChatLoopResponseSchema = z.strictObject({
  protocol: ChatProtocolSchema,
  reply: text(CHAT_MAX_REPLY_CHARACTERS),
});
export type ChatLoopResponse = z.infer<typeof ChatLoopResponseSchema>;
export const ChatNormalizedInputSchema = z.strictObject({ text: ChatTextSchema });
export type ChatNormalizedInput = z.infer<typeof ChatNormalizedInputSchema>;

/** Canonical boundary schemas; compare their normalized values rather than object identity. */
export const ChatTextInputJsonSchema: JsonSchema = z.toJSONSchema(
  z.strictObject({ ...loopInputShape, input: ChatTextLoopInputSchema }),
  { target: 'draft-7' },
);
export const ChatAudioInputJsonSchema: JsonSchema = z.toJSONSchema(ChatLoopInputSchema, {
  target: 'draft-7',
});
export const ChatResponseJsonSchema: JsonSchema = z.toJSONSchema(ChatLoopResponseSchema, {
  target: 'draft-7',
});
export const ChatNormalizedInputJsonSchema: JsonSchema = z.toJSONSchema(ChatNormalizedInputSchema, {
  target: 'draft-7',
});

export const ChatConversationSchema = z.strictObject({
  id: UlidSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  lastTurn: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});
export type ChatConversation = z.infer<typeof ChatConversationSchema>;
export const ChatTurnSchema = z.strictObject({
  id: UlidSchema,
  conversationId: UlidSchema,
  requestId: z.uuid(),
  turn: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  runId: UlidSchema,
  createdAt: TimestampSchema,
  input: ChatSendInputSchema,
  inputTranscript: ChatTextSchema.optional(),
  runStatus: z.enum([
    'queued',
    'running',
    'waiting',
    'paused',
    'succeeded',
    'failed',
    'cancelled',
    'exhausted',
  ]),
  response: ChatLoopResponseSchema.optional(),
  error: z.strictObject({ code: z.string().min(1).max(128), message: text(1000) }).optional(),
});
export type ChatTurn = z.infer<typeof ChatTurnSchema>;
const readiness = z.strictObject({
  ready: z.boolean(),
  code: z.string().min(1).max(128).optional(),
  message: text(1000).optional(),
});
export const ChatReadinessSchema = z.strictObject({ text: readiness, audio: readiness });
export type ChatReadiness = z.infer<typeof ChatReadinessSchema>;
export const ChatSessionSchema = z.strictObject({
  audience: ChatAudienceSchema,
  label: ChatLabelSchema,
  readiness: ChatReadinessSchema,
  limits: z.strictObject({
    maxTextCharacters: z.number().int().positive(),
    maxAudioBytes: z.number().int().positive(),
  }),
  systemLoopId: UlidSchema.optional(),
});
export type ChatSession = z.infer<typeof ChatSessionSchema>;
export const ChatAudioUploadSchema = z.strictObject({
  id: UlidSchema,
  mimeType: z.string().min(1).max(128),
  bytes: z.number().int().min(1).max(CHAT_MAX_AUDIO_BYTES),
  expiresAt: TimestampSchema,
});
export type ChatAudioUpload = z.infer<typeof ChatAudioUploadSchema>;
export const ChatDeviceSchema = z.strictObject({
  id: UlidSchema,
  label: ChatLabelSchema,
  loopId: UlidSchema,
  createdAt: TimestampSchema,
  lastSeenAt: TimestampSchema.optional(),
  revokedAt: TimestampSchema.optional(),
});
export type ChatDevice = z.infer<typeof ChatDeviceSchema>;
// A canonical base64url encoding of 32 bytes: 42 full characters and four final data bits.
const secret = z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);
export const ChatPairingCreatedSchema = z.strictObject({
  id: UlidSchema,
  code: secret,
  expiresAt: TimestampSchema,
  url: z.url().optional(),
});
export type ChatPairingCreated = z.infer<typeof ChatPairingCreatedSchema>;
export const ChatPairClaimRequestSchema = z.strictObject({
  code: secret,
  claimId: z.uuid(),
  deviceToken: z.string().regex(/^ggd_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/),
  label: ChatLabelSchema,
});
export type ChatPairClaimRequest = z.infer<typeof ChatPairClaimRequestSchema>;
export const ChatPairClaimResponseSchema = z.strictObject({
  deviceId: UlidSchema,
  label: ChatLabelSchema,
});
export type ChatPairClaimResponse = z.infer<typeof ChatPairClaimResponseSchema>;

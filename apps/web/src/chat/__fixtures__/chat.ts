import type { ChatClient } from '../client.js';
import { vi } from 'vitest';
import type { ChatConversation, ChatDevice, ChatSession, ChatTurn } from '@graphgoblin/contracts';
export const conversation: ChatConversation = {
  id: '01J00000000000000000000001',
  createdAt: '2026-11-07T10:00:00.000Z',
  updatedAt: '2026-11-07T10:00:00.000Z',
  lastTurn: 0,
};
export const session: ChatSession = {
  label: 'Gateway chat',
  audience: { kind: 'gateway' },
  readiness: {
    text: { ready: true },
    audio: { ready: false, message: 'Configure a normalizer in the chat loop.' },
  },
  limits: { maxTextCharacters: 16_000, maxAudioBytes: 10 * 1024 * 1024 },
  systemLoopId: '01J00000000000000000000002',
};
export const turn: ChatTurn = {
  id: '01J00000000000000000000003',
  conversationId: conversation.id,
  requestId: '345ec2dc-143f-45b6-893d-80a657ad811b',
  runId: '01J00000000000000000000004',
  createdAt: conversation.createdAt,
  turn: 1,
  input: { kind: 'text', text: 'Hello' },
  runStatus: 'succeeded',
  response: { protocol: 'graphgoblin.chat.v1', reply: 'The exact loop result.' },
};
export const device: ChatDevice = {
  id: '01J00000000000000000000005',
  label: 'Kitchen tablet',
  loopId: session.systemLoopId!,
  createdAt: conversation.createdAt,
};
export function mockChatClient() {
  return {
    session: vi.fn<ChatClient['session']>().mockResolvedValue(session),
    conversations: vi.fn<ChatClient['conversations']>().mockResolvedValue([]),
    createConversation: vi.fn<ChatClient['createConversation']>().mockResolvedValue(conversation),
    turns: vi.fn<ChatClient['turns']>().mockResolvedValue([]),
    send: vi.fn<ChatClient['send']>().mockImplementation((conversationId, request) =>
      Promise.resolve({
        ...turn,
        conversationId,
        requestId: request.requestId,
        input: request.input,
      }),
    ),
    request: vi.fn<ChatClient['request']>().mockResolvedValue(turn),
    cancel: vi
      .fn<ChatClient['cancel']>()
      .mockResolvedValue({ ...turn, runStatus: 'cancelled', response: undefined }),
    upload: vi.fn<ChatClient['upload']>().mockResolvedValue({
      id: '01J00000000000000000000006',
      mimeType: 'audio/webm',
      bytes: 12,
      expiresAt: '2026-11-07T11:00:00.000Z',
    }),
    discardAudio: vi.fn<ChatClient['discardAudio']>().mockResolvedValue(undefined),
    devices: vi.fn<ChatClient['devices']>().mockResolvedValue([device]),
    createPairing: vi.fn<ChatClient['createPairing']>().mockResolvedValue({
      id: '01J00000000000000000000007',
      code: 'A'.repeat(43),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      url: `https://example.com/goblin/#pair=${'A'.repeat(43)}`,
    }),
    renameDevice: vi
      .fn<ChatClient['renameDevice']>()
      .mockImplementation((_id, label) => Promise.resolve({ ...device, label })),
    revokeDevice: vi
      .fn<ChatClient['revokeDevice']>()
      .mockResolvedValue({ ...device, revokedAt: conversation.createdAt }),
  } satisfies ChatClient;
}

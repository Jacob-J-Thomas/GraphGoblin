import {
  ChatAudioUploadSchema,
  ChatConversationSchema,
  ChatDeviceSchema,
  ChatPairingCreatedSchema,
  ChatSessionSchema,
  ChatTurnSchema,
  type ChatAudioUpload,
  type ChatConversation,
  type ChatDevice,
  type ChatPairingCreated,
  type ChatSendRequest,
  type ChatSession,
  type ChatTurn,
} from '@graphgoblin/contracts';
import { z } from 'zod';

export class ChatApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ChatApiError';
  }
}

/** The shared surface receives only this explicit, audience-scoped transport. */
export interface ChatClient {
  session(signal?: AbortSignal): Promise<ChatSession>;
  conversations(signal?: AbortSignal): Promise<ChatConversation[]>;
  createConversation(signal?: AbortSignal): Promise<ChatConversation>;
  turns(conversationId: string, signal?: AbortSignal): Promise<ChatTurn[]>;
  send(conversationId: string, request: ChatSendRequest, signal?: AbortSignal): Promise<ChatTurn>;
  request(conversationId: string, requestId: string, signal?: AbortSignal): Promise<ChatTurn>;
  cancel(turnId: string, signal?: AbortSignal): Promise<ChatTurn>;
  upload(audio: Blob, signal?: AbortSignal): Promise<ChatAudioUpload>;
  discardAudio(audioId: string, signal?: AbortSignal): Promise<void>;
  devices(signal?: AbortSignal): Promise<ChatDevice[]>;
  createPairing(signal?: AbortSignal): Promise<ChatPairingCreated>;
  renameDevice(deviceId: string, label: string, signal?: AbortSignal): Promise<ChatDevice>;
  revokeDevice(deviceId: string, signal?: AbortSignal): Promise<ChatDevice>;
}

const id = encodeURIComponent;
export function createChatClient(options: {
  getToken: () => string | undefined;
  fetch?: typeof globalThis.fetch;
}): ChatClient {
  const fetch =
    options.fetch ?? ((...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args));
  async function call<T>(
    method: string,
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const token = options.getToken();
    const headers = new Headers({ accept: 'application/json' });
    if (token) headers.set('authorization', `Bearer ${token}`);
    const binary = body instanceof Blob;
    if (body !== undefined) headers.set('content-type', binary ? body.type : 'application/json');
    const response = await fetch(`/chat${path}`, {
      method,
      headers,
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
      ...(signal ? { signal } : {}),
      ...(body !== undefined ? { body: binary ? body : JSON.stringify(body) } : {}),
    });
    const value: unknown =
      response.status === 204 ? undefined : await response.json().catch(() => undefined);
    if (!response.ok) {
      const problem = z
        .object({
          code: z.string().optional(),
          detail: z.string().optional(),
          message: z.string().optional(),
        })
        .safeParse(value);
      throw new ChatApiError(
        response.status,
        problem.success ? (problem.data.code ?? 'CHAT_REQUEST_FAILED') : 'CHAT_REQUEST_FAILED',
        problem.success
          ? (problem.data.detail ?? problem.data.message ?? 'The chat request failed.')
          : 'The chat request failed.',
      );
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success)
      throw new ChatApiError(
        502,
        'CHAT_RESPONSE_INVALID',
        'The gateway returned an invalid chat response.',
      );
    return parsed.data;
  }
  const list = <T>(schema: z.ZodType<T>) => z.object({ items: z.array(schema) });
  return {
    session: (signal) => call('GET', '/session', ChatSessionSchema, undefined, signal),
    conversations: async (signal) =>
      (
        await call(
          'GET',
          '/conversations?limit=50',
          list(ChatConversationSchema),
          undefined,
          signal,
        )
      ).items,
    createConversation: (signal) =>
      call('POST', '/conversations', ChatConversationSchema, {}, signal),
    turns: async (conversationId, signal) => {
      const turns: ChatTurn[] = [];
      let after = 0;
      for (;;) {
        const page = await call(
          'GET',
          `/conversations/${id(conversationId)}/turns?after=${after}&limit=50`,
          list(ChatTurnSchema),
          undefined,
          signal,
        );
        turns.push(...page.items);
        if (page.items.length < 50) return turns;
        const next = page.items.at(-1)!.turn;
        if (next <= after)
          throw new ChatApiError(
            502,
            'CHAT_RESPONSE_INVALID',
            'The gateway returned an invalid turn sequence.',
          );
        after = next;
      }
    },
    send: (conversationId, request, signal) =>
      call('POST', `/conversations/${id(conversationId)}/turns`, ChatTurnSchema, request, signal),
    request: (conversationId, requestId, signal) =>
      call(
        'GET',
        `/conversations/${id(conversationId)}/requests/${id(requestId)}`,
        ChatTurnSchema,
        undefined,
        signal,
      ),
    cancel: (turnId, signal) =>
      call('POST', `/turns/${id(turnId)}/cancel`, ChatTurnSchema, {}, signal),
    upload: (audio, signal) => call('POST', '/audio', ChatAudioUploadSchema, audio, signal),
    discardAudio: (audioId, signal) =>
      call('DELETE', `/audio/${id(audioId)}`, z.undefined(), undefined, signal),
    devices: async (signal) =>
      (await call('GET', '/devices', list(ChatDeviceSchema), undefined, signal)).items,
    createPairing: (signal) => call('POST', '/pairings', ChatPairingCreatedSchema, {}, signal),
    renameDevice: (deviceId, label, signal) =>
      call('PATCH', `/devices/${id(deviceId)}`, ChatDeviceSchema, { label }, signal),
    revokeDevice: (deviceId, signal) =>
      call('POST', `/devices/${id(deviceId)}/revoke`, ChatDeviceSchema, {}, signal),
  };
}

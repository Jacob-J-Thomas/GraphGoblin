import { describe, expect, it, vi } from 'vitest';
import { ChatApiError, createChatClient } from './client.js';
import { conversation, device, session, turn } from './__fixtures__/chat.js';
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const make = () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  return { fetch, client: createChatClient({ fetch, getToken: () => 'ggd_device-only' }) };
};
describe('chat audience transport', () => {
  it('uses only same-origin chat routes, explicit credentials, no cache and no redirects', async () => {
    const { client, fetch } = make();
    fetch.mockResolvedValue(json(session));
    expect(await client.session()).toEqual(session);
    expect(fetch).toHaveBeenCalledWith(
      '/chat/session',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'error',
      }),
    );
    const init = fetch.mock.calls[0]![1]!;
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer ggd_device-only');
    fetch.mockResolvedValue(json(session));
    await createChatClient({ fetch, getToken: () => undefined }).session();
    expect(new Headers(fetch.mock.calls[1]![1]!.headers).has('authorization')).toBe(false);
  });
  it('encodes resource IDs and sends only the frozen canonical bodies', async () => {
    const { client, fetch } = make();
    const signal = new AbortController().signal;
    fetch.mockResolvedValue(json(conversation));
    await client.createConversation(signal);
    expect(fetch).toHaveBeenLastCalledWith(
      '/chat/conversations',
      expect.objectContaining({ method: 'POST', body: '{}', signal }),
    );
    fetch.mockResolvedValue(json(turn));
    await client.send('a/b', { requestId: turn.requestId, input: turn.input });
    expect(fetch).toHaveBeenLastCalledWith(
      '/chat/conversations/a%2Fb/turns',
      expect.objectContaining({
        body: JSON.stringify({ requestId: turn.requestId, input: turn.input }),
      }),
    );
    fetch.mockResolvedValue(json(turn));
    await client.request('a/b', 'c/d');
    expect(fetch.mock.calls.at(-1)![0]).toBe('/chat/conversations/a%2Fb/requests/c%2Fd');
    fetch.mockResolvedValue(json(turn));
    await client.cancel('x/y');
    expect(fetch.mock.calls.at(-1)![0]).toBe('/chat/turns/x%2Fy/cancel');
    fetch.mockResolvedValue(json({ items: [conversation] }));
    expect(await client.conversations()).toEqual([conversation]);
  });
  it('reads all bounded turn pages and rejects a stuck cursor', async () => {
    const { client, fetch } = make();
    const items = Array.from({ length: 50 }, (_, index) => ({ ...turn, turn: index + 1 }));
    fetch
      .mockResolvedValueOnce(json({ items }))
      .mockResolvedValueOnce(json({ items: [{ ...turn, turn: 51 }] }));
    expect(await client.turns(conversation.id)).toHaveLength(51);
    expect(fetch.mock.calls[1]![0]).toContain('after=50&limit=50');
    fetch.mockResolvedValue(json({ items }));
    await expect(client.turns(conversation.id)).rejects.toMatchObject({
      code: 'CHAT_RESPONSE_INVALID',
    });
  });
  it('uploads raw bytes and treats delete as an empty response', async () => {
    const { client, fetch } = make();
    const blob = new Blob(['bytes'], { type: 'audio/webm' });
    fetch.mockResolvedValue(
      json(
        { id: device.id, mimeType: blob.type, bytes: 5, expiresAt: conversation.createdAt },
        201,
      ),
    );
    await client.upload(blob);
    expect(fetch.mock.calls[0]![1]!.body).toBe(blob);
    expect(new Headers(fetch.mock.calls[0]![1]!.headers).get('content-type')).toBe('audio/webm');
    fetch.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(client.discardAudio('a/b')).resolves.toBeUndefined();
    expect(fetch.mock.calls[1]![0]).toBe('/chat/audio/a%2Fb');
  });
  it('has explicit owner device operations without importing owner credential state', async () => {
    const { client, fetch } = make();
    fetch.mockResolvedValue(json({ items: [device] }));
    expect(await client.devices()).toEqual([device]);
    fetch.mockResolvedValue(
      json({ id: device.id, code: 'A'.repeat(43), expiresAt: conversation.createdAt }),
    );
    await client.createPairing();
    expect(fetch.mock.calls.at(-1)![0]).toBe('/chat/pairings');
    fetch.mockResolvedValue(json(device));
    await client.renameDevice(device.id, 'New name');
    expect(fetch.mock.calls.at(-1)![1]!.body).toBe('{"label":"New name"}');
    fetch.mockResolvedValue(json(device));
    await client.revokeDevice(device.id);
    expect(fetch.mock.calls.at(-1)![0]).toBe(`/chat/devices/${device.id}/revoke`);
  });
  it('rejects malformed successful DTOs and bounds non-json gateway errors', async () => {
    const { client, fetch } = make();
    fetch.mockResolvedValue(json({ reply: 'fake' }));
    await expect(client.session()).rejects.toMatchObject({
      status: 502,
      code: 'CHAT_RESPONSE_INVALID',
    });
    fetch.mockResolvedValue(json({ code: 'CHAT_BUSY', detail: 'Wait for the reply.' }, 409));
    await expect(client.session()).rejects.toEqual(
      new ChatApiError(409, 'CHAT_BUSY', 'Wait for the reply.'),
    );
    fetch.mockResolvedValue(json({ message: 'Denied' }, 403));
    await expect(client.session()).rejects.toMatchObject({ message: 'Denied' });
    fetch.mockResolvedValue(new Response('bad html', { status: 500 }));
    await expect(client.session()).rejects.toMatchObject({ message: 'The chat request failed.' });
    fetch.mockResolvedValue(json({}, 400));
    await expect(client.session()).rejects.toMatchObject({ message: 'The chat request failed.' });
  });
  it('resolves the default fetch at call time', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json(session));
    vi.stubGlobal('fetch', fetch);
    try {
      await createChatClient({ getToken: () => undefined }).session();
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

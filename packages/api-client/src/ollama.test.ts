import { describe, expect, it, vi } from 'vitest';
import { createGraphGoblinClient } from './client.js';
import { GraphGoblinApiError } from './errors.js';
import { ollama } from './ollama.js';

const view = {
  connection: { enabled: true, baseUrl: 'http://127.0.0.1:11434', revision: 1 },
  discovery: { state: 'ready', lastSuccessAt: '2026-11-07T12:00:00.000Z' },
};

function setup(response: unknown = view, status = 200) {
  const requests: Request[] = [];
  const fetch = vi.fn((request: Request) => {
    requests.push(request);
    return Promise.resolve(Response.json(response, { status }));
  });
  return {
    requests,
    fetch,
    client: createGraphGoblinClient({
      baseUrl: 'https://gateway.test',
      apiKey: 'owner-key',
      client: 'ui',
      fetch,
    }),
  };
}

describe('Ollama client', () => {
  it('uses the gateway origin, credentials and explicit configured-connection endpoints', async () => {
    const { requests, client, fetch } = setup();
    const controller = new AbortController();
    expect(await ollama.connection(client, { signal: controller.signal })).toEqual(view);
    expect(
      await ollama.configure(client, { enabled: true, baseUrl: 'http://127.0.0.1:11434' }),
    ).toEqual(view);
    fetch.mockResolvedValueOnce(Response.json(view.discovery));
    expect(await ollama.refresh(client)).toEqual(view.discovery);
    expect(requests.map((r) => [r.method, r.url])).toEqual([
      ['GET', 'https://gateway.test/harness/ollama/connection'],
      ['PUT', 'https://gateway.test/harness/ollama/connection'],
    ]);
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer owner-key');
    expect(requests[0]?.headers.get('x-graphgoblin-client')).toBe('ui');
    expect(requests[0]?.headers.get('content-type')).toBeNull();
    expect(requests[0]?.redirect).toBe('error');
    expect(await requests[1]?.json()).toEqual({ enabled: true, baseUrl: 'http://127.0.0.1:11434' });
    const refreshRequest = fetch.mock.calls[2]?.[0];
    expect(refreshRequest?.url).toBe('https://gateway.test/model-catalog/refresh');
    expect(await refreshRequest?.json()).toEqual({ harness: 'ollama' });
  });

  it('keeps discovery failure as a saved connection result', async () => {
    const error = {
      ...view,
      discovery: { state: 'error', error: { code: 'OFFLINE', message: 'Service unavailable.' } },
    };
    const { client } = setup(error);
    expect(
      await ollama.configure(client, { enabled: true, baseUrl: view.connection.baseUrl }),
    ).toEqual(error);
  });

  it('surfaces problem details and refuses invalid successful DTOs', async () => {
    const refused = setup(
      { status: 403, code: 'FORBIDDEN', detail: 'Gateway owner required.' },
      403,
    );
    await expect(ollama.connection(refused.client)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    const malformed = setup({ connection: view.connection, discovery: { state: 'pretend-ready' } });
    await expect(ollama.connection(malformed.client)).rejects.toThrow();
    const nonJson = setup();
    nonJson.fetch.mockResolvedValueOnce(new Response('bad response', { status: 502 }));
    await expect(ollama.connection(nonJson.client)).rejects.toMatchObject({
      status: 502,
      code: 'HTTP_502',
    });
  });

  it('wraps network failures and preserves typed errors and aborts', async () => {
    const { client, fetch } = setup();
    fetch.mockRejectedValueOnce(new Error('Disconnected'));
    await expect(ollama.connection(client)).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
    });
    const typed = new GraphGoblinApiError({ status: 403, code: 'FORBIDDEN' });
    fetch.mockRejectedValueOnce(typed);
    await expect(ollama.connection(client)).rejects.toBe(typed);
    const abort = new DOMException('Cancelled', 'AbortError');
    fetch.mockRejectedValueOnce(abort);
    await expect(ollama.connection(client)).rejects.toBe(abort);
    const controller = new AbortController();
    controller.abort();
    const reason = new Error('Cancelled by caller');
    fetch.mockRejectedValueOnce(reason);
    await expect(ollama.connection(client, { signal: controller.signal })).rejects.toBe(reason);
  });
});

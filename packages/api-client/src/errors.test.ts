import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createGraphGoblinClient, GraphGoblinApiError, loops, system, unwrap } from './index.js';

let server: Server | undefined;

async function serve(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  server?.closeAllConnections();
  if (server) await new Promise((resolve) => server!.close(resolve));
  server = undefined;
});

describe('GraphGoblinApiError', () => {
  it('synthesises a code for non-problem bodies, preferring the body text', async () => {
    const baseUrl = await serve((req, res) => {
      if (req.url === '/healthz') {
        res.writeHead(502, { 'content-type': 'text/plain' }).end('  upstream exploded  ');
      } else {
        res.writeHead(503, 'Busy').end();
      }
    });
    const client = createGraphGoblinClient({ baseUrl });

    const fromText = await system.health(client).catch((e: unknown) => e);
    expect(fromText).toBeInstanceOf(GraphGoblinApiError);
    expect(fromText).toMatchObject({
      status: 502,
      code: 'HTTP_502',
      detail: 'upstream exploded',
      problem: undefined,
      message: 'HTTP_502: upstream exploded',
    });

    const fromStatus = await system.version(client).catch((e: unknown) => e);
    expect(fromStatus).toMatchObject({ status: 503, code: 'HTTP_503', detail: 'Busy' });
  });

  it('formats a message without detail', () => {
    const error = new GraphGoblinApiError({ status: 409, code: 'CONFLICT' });
    expect(error.message).toBe('CONFLICT (409)');
    expect(error.problem).toEqual({ status: 409, code: 'CONFLICT' });
    expect(error.name).toBe('GraphGoblinApiError');
  });

  it('leaves detail empty when neither body nor status text has one', () => {
    const error = GraphGoblinApiError.fromResponse(new Response(null, { status: 500 }), undefined);
    expect(error).toMatchObject({ code: 'HTTP_500', detail: undefined });
  });

  it('wraps transport failures as NETWORK_ERROR with status 0', async () => {
    const baseUrl = await serve((_req, res) => res.end());
    await new Promise((resolve) => server!.close(resolve));
    server = undefined;
    const error = await loops.list(createGraphGoblinClient({ baseUrl })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GraphGoblinApiError);
    expect(error).toMatchObject({ status: 0, code: 'NETWORK_ERROR', problem: undefined });
    expect((error as Error).cause).toBeDefined();
  });

  it('describes non-Error transport failures', async () => {
    const client = createGraphGoblinClient({
      baseUrl: 'http://example.invalid',
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a non-Error rejection is the case under test
      fetch: () => Promise.reject('socket hang up'),
    });
    await expect(system.health(client)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      detail: 'socket hang up',
    });
  });

  it('passes aborts and existing API errors through unchanged', async () => {
    const baseUrl = await serve(() => undefined); // never answers
    const client = createGraphGoblinClient({ baseUrl });
    const controller = new AbortController();
    const pending = client.GET('/healthz', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    const original = new GraphGoblinApiError({ status: 418, code: 'TEAPOT' });
    const failing = createGraphGoblinClient({ baseUrl, fetch: () => Promise.reject(original) });
    await expect(system.health(failing)).rejects.toBe(original);
  });
});

describe('createGraphGoblinClient', () => {
  it('sends default headers and extra headers, and strips trailing slashes', async () => {
    const seen: IncomingMessage['headers'][] = [];
    const baseUrl = await serve((req, res) => {
      seen.push(req.headers);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });
    const client = createGraphGoblinClient({
      baseUrl: `${baseUrl}//`,
      apiKey: 'gg_key',
      client: 'mcp',
      headers: { 'x-trace': '1' },
    });
    expect(client.config.baseUrl).toBe(baseUrl);
    await system.health(client);
    expect(seen[0]).toMatchObject({
      authorization: 'Bearer gg_key',
      'x-graphgoblin-client': 'mcp',
      'x-trace': '1',
    });

    await system.health(createGraphGoblinClient({ baseUrl }));
    expect(seen[1]).not.toHaveProperty('authorization');
    expect(seen[1]).not.toHaveProperty('x-graphgoblin-client');
  });
});

describe('unwrap', () => {
  it('returns data on success, undefined for 204, and throws problem details otherwise', () => {
    expect(unwrap({ data: { a: 1 }, response: new Response(null, { status: 200 }) })).toEqual({
      a: 1,
    });
    expect(unwrap({ response: new Response(null, { status: 204 }) })).toBeUndefined();
    const problem = { status: 404, code: 'LOOP_NOT_FOUND', detail: 'nope', errors: [1] };
    expect(() =>
      unwrap({ error: problem, response: new Response(null, { status: 404 }) }),
    ).toThrowError(expect.objectContaining({ code: 'LOOP_NOT_FOUND', errors: [1], problem }));
  });
});

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { readJson } from './body.js';
import {
  createGraphGoblinClient,
  GraphGoblinApiError,
  runs,
  subscribeRunEvents,
  type GraphGoblinClient,
} from './index.js';

type Handler = (name: string, res: ServerResponse, req: IncomingMessage) => void | Promise<void>;
type Framing = 'fixed-length' | 'chunked';
type Read = (
  client: GraphGoblinClient,
  runId: string,
  options?: { signal?: AbortSignal },
) => Promise<unknown>;

const READS: [string, Read][] = [
  ['runs.get', runs.get],
  ['runs.observation', runs.observation],
];
const FRAMINGS: Framing[] = ['fixed-length', 'chunked'];
const PARTIAL = '{"partial":';
const JSON_HEADERS = { 'content-type': 'application/json', 'x-fixture': 'present' };

let server: Server | undefined;
const sockets = new Set<Socket>();
/** Requests the fixture received, by run id (`/runs/<id>/...`). */
const hits = new Map<string, number>();

/** A port-0 loopback server owned by this file; every socket is destroyed after each test. */
async function serve(handler: Handler): Promise<string> {
  const owned = createServer((req, res) => {
    const name = new URL(req.url ?? '/', 'http://fixture.invalid').pathname.split('/')[2] ?? '';
    hits.set(name, (hits.get(name) ?? 0) + 1);
    void handler(name, res, req);
  });
  owned.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server = owned;
  await new Promise<void>((resolve) => owned.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(owned.address() as AddressInfo).port}`;
}

afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  hits.clear();
  const owned = server;
  server = undefined;
  if (owned) await new Promise((resolve) => owned.close(resolve));
});

/** Send the status line, headers and part of a JSON body, then close without finishing it. */
function truncate(res: ServerResponse, status: number, framing: Framing): void {
  res.writeHead(
    status,
    framing === 'fixed-length'
      ? { ...JSON_HEADERS, 'content-length': String(PARTIAL.length + 64) }
      : JSON_HEADERS,
  );
  res.write(PARTIAL, () => setTimeout(() => res.socket?.destroy(), 10));
}

/** Send a complete body; without a length Node frames it as chunked. */
function complete(res: ServerResponse, status: number, text: string, framing: Framing): void {
  res.writeHead(
    status,
    framing === 'fixed-length'
      ? { ...JSON_HEADERS, 'content-length': String(Buffer.byteLength(text)) }
      : JSON_HEADERS,
  );
  res.end(text);
}

/** Send headers and part of a body and keep the connection open until the test ends. */
function hold(res: ServerResponse): void {
  res.writeHead(200, JSON_HEADERS);
  res.write(PARTIAL);
}

function signal(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => (resolve = settle));
  return { promise, resolve };
}

/** A fetch that returns the native Response unchanged and records it. */
function passThrough(seen: Response[], onHeaders?: () => void) {
  return async (request: Request) => {
    const response = await globalThis.fetch(request);
    seen.push(response);
    onHeaders?.();
    return response;
  };
}

const settle = (pending: Promise<unknown>) =>
  pending.then(
    () => undefined,
    (e: unknown) => e,
  );

describe.each(READS)('%s successful-body boundary', (_label, read) => {
  it.each(FRAMINGS)(
    'classifies a native %s 200 body interrupted after its headers as RESPONSE_INTERRUPTED',
    async (framing) => {
      const baseUrl = await serve((_name, res) => truncate(res, 200, framing));
      const error = await settle(read(createGraphGoblinClient({ baseUrl }), 'mid'));
      expect(error).toBeInstanceOf(GraphGoblinApiError);
      expect(error).toMatchObject({ status: 0, code: 'RESPONSE_INTERRUPTED', problem: undefined });
      expect((error as Error).cause).toBeInstanceOf(TypeError);
      expect((error as Error).cause).not.toBeInstanceOf(GraphGoblinApiError);
      expect(Object.fromEntries(hits)).toEqual({ mid: 1 });
    },
  );

  it.each(FRAMINGS)('returns a complete %s JSON body', async (framing) => {
    const baseUrl = await serve((_name, res) =>
      complete(res, 200, '{"from":"fixture","n":[1,2]}', framing),
    );
    await expect(read(createGraphGoblinClient({ baseUrl }), 'whole')).resolves.toEqual({
      from: 'fixture',
      n: [1, 2],
    });
    expect(Object.fromEntries(hits)).toEqual({ whole: 1 });
  });

  it.each(FRAMINGS)('keeps complete malformed %s JSON a SyntaxError', async (framing) => {
    const baseUrl = await serve((_name, res) =>
      complete(res, 200, '{"completeButInvalid":', framing),
    );
    const error = await settle(read(createGraphGoblinClient({ baseUrl }), 'malformed'));
    expect(error).toBeInstanceOf(SyntaxError);
    expect(error).not.toBeInstanceOf(GraphGoblinApiError);
    expect(Object.fromEntries(hits)).toEqual({ malformed: 1 });
  });

  it('keeps a complete 409 a typed refusal and a truncated 409 a raw, non-offline error', async () => {
    const problem = { status: 409, code: 'FIXTURE_CONFLICT', detail: 'Controlled refusal' };
    const baseUrl = await serve((name, res) =>
      name === 'refused'
        ? complete(res, 409, JSON.stringify(problem), 'chunked')
        : truncate(res, 409, 'fixed-length'),
    );
    const client = createGraphGoblinClient({ baseUrl });
    const refused = await settle(read(client, 'refused'));
    expect(refused).toBeInstanceOf(GraphGoblinApiError);
    expect(refused).toMatchObject({ status: 409, code: 'FIXTURE_CONFLICT', problem });
    const truncated = await settle(read(client, 'truncated'));
    expect(truncated).toBeInstanceOf(TypeError);
    expect(truncated).not.toBeInstanceOf(GraphGoblinApiError);
    expect(Object.fromEntries(hits)).toEqual({ refused: 1, truncated: 1 });
  });

  it.each([
    ['default', () => undefined],
    ['explicit-reason', () => new Error('the caller left')],
  ])('rejects a %s abort before headers with the identical reason', async (_kind, reason) => {
    const arrived = signal();
    const baseUrl = await serve(() => arrived.resolve()); // never answers
    const controller = new AbortController();
    const pending = settle(
      read(createGraphGoblinClient({ baseUrl }), 'before', { signal: controller.signal }),
    );
    await arrived.promise;
    controller.abort(reason());
    expect(await pending).toBe(controller.signal.reason);
    expect(Object.fromEntries(hits)).toEqual({ before: 1 });
  });

  it.each([
    ['default', () => undefined],
    ['explicit-reason', () => new Error('the caller left')],
  ])('rejects a %s abort after headers with the identical reason', async (_kind, reason) => {
    const headers = signal();
    const baseUrl = await serve((_name, res) => hold(res));
    const seen: Response[] = [];
    const client = createGraphGoblinClient({ baseUrl, fetch: passThrough(seen, headers.resolve) });
    const controller = new AbortController();
    const pending = settle(read(client, 'after', { signal: controller.signal }));
    await headers.promise;
    controller.abort(reason());
    expect(await pending).toBe(controller.signal.reason);
    expect(seen[0]!.status).toBe(200);
    expect(Object.fromEntries(hits)).toEqual({ after: 1 });
  });

  it('returns undefined for 204, Content-Length 0 and an empty chunked 200', async () => {
    const baseUrl = await serve((name, res) => {
      if (name === 'no-content') res.writeHead(204).end();
      else if (name === 'length-0') res.writeHead(200, { 'content-length': '0' }).end();
      else res.writeHead(200, JSON_HEADERS).end();
    });
    const seen: Response[] = [];
    const client = createGraphGoblinClient({ baseUrl, fetch: passThrough(seen) });
    await expect(read(client, 'no-content')).resolves.toBeUndefined();
    await expect(read(client, 'length-0')).resolves.toBeUndefined();
    await expect(read(client, 'empty-chunked')).resolves.toBeUndefined();
    expect(
      seen.map((response) => [response.status, response.headers.get('content-length')]),
    ).toEqual([
      [204, null],
      [200, '0'],
      [200, null],
    ]);
    expect(Object.fromEntries(hits)).toEqual({
      'no-content': 1,
      'length-0': 1,
      'empty-chunked': 1,
    });
  });

  it('follows a redirect and reads the native response it returned without replacing it', async () => {
    const baseUrl = await serve((name, res) => {
      if (name === 'hop') res.writeHead(302, { location: '/runs/target' }).end();
      else if (name === 'hop-mid') res.writeHead(302, { location: '/runs/mid-target' }).end();
      else if (name === 'target') complete(res, 200, '{"from":"target"}', 'fixed-length');
      else truncate(res, 200, 'chunked');
    });
    const seen: Response[] = [];
    const client = createGraphGoblinClient({ baseUrl, fetch: passThrough(seen) });
    await expect(read(client, 'hop')).resolves.toEqual({ from: 'target' });
    const [response] = seen;
    expect(response).toMatchObject({
      status: 200,
      url: `${baseUrl}/runs/target`,
      redirected: true,
      type: 'basic',
      bodyUsed: true,
    });
    expect(response!.headers.get('x-fixture')).toBe('present');
    const interrupted = await settle(read(client, 'hop-mid'));
    expect(interrupted).toMatchObject({ status: 0, code: 'RESPONSE_INTERRUPTED' });
    expect(seen[1]).toMatchObject({ url: `${baseUrl}/runs/mid-target`, redirected: true });
    expect(Object.fromEntries(hits)).toEqual({
      hop: 1,
      target: 1,
      'hop-mid': 1,
      'mid-target': 1,
    });
  });

  it('decodes a byte-order mark and multi-byte characters split across chunks', async () => {
    const pieces = [
      Buffer.from([0xef]),
      Buffer.concat([Buffer.from([0xbb, 0xbf]), Buffer.from('{"name":"caf')]),
      Buffer.from([0xc3]),
      Buffer.concat([Buffer.from([0xa9]), Buffer.from('","icon":"')]),
      Buffer.from([0xf0, 0x9f]),
      Buffer.from([0x98]),
      Buffer.concat([Buffer.from([0x80]), Buffer.from('"}')]),
    ];
    const baseUrl = await serve(async (_name, res) => {
      res.writeHead(200, JSON_HEADERS);
      for (const piece of pieces) {
        await new Promise<void>((resolve) => res.write(piece, () => resolve()));
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      res.end();
    });
    await expect(read(createGraphGoblinClient({ baseUrl }), 'utf8')).resolves.toEqual({
      name: 'café',
      icon: '😀',
    });
    expect(Object.fromEntries(hits)).toEqual({ utf8: 1 });
  });

  it('classifies a native response passed through a wrapping fetch unchanged', async () => {
    const baseUrl = await serve((_name, res) => truncate(res, 200, 'fixed-length'));
    const seen: Response[] = [];
    const error = await settle(
      read(createGraphGoblinClient({ baseUrl, fetch: passThrough(seen) }), 'wrapped'),
    );
    expect(error).toMatchObject({ status: 0, code: 'RESPONSE_INTERRUPTED' });
    expect(seen[0]!.type).toBe('basic');
    expect(Object.fromEntries(hits)).toEqual({ wrapped: 1 });
  });

  it('leaves a synthetic Response failure raw even when it imitates a native socket error', async () => {
    const failure = new TypeError('terminated', { cause: { code: 'UND_ERR_SOCKET' } });
    const client = createGraphGoblinClient({
      baseUrl: 'http://graphgoblin.test',
      fetch: () =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                controller.error(failure);
              },
            }),
            { status: 200, headers: JSON_HEADERS },
          ),
        ),
    });
    expect(await settle(read(client, 'synthetic'))).toBe(failure);
  });

  it('leaves a native body re-wrapped in a new Response raw', async () => {
    const baseUrl = await serve((_name, res) => truncate(res, 200, 'chunked'));
    const client = createGraphGoblinClient({
      baseUrl,
      fetch: async (request) => {
        const native = await globalThis.fetch(request);
        return new Response(native.body, native);
      },
    });
    const error = await settle(read(client, 'proxied'));
    expect(error).toBeInstanceOf(TypeError);
    expect(error).not.toBeInstanceOf(GraphGoblinApiError);
    expect(Object.fromEntries(hits)).toEqual({ proxied: 1 });
  });

  it('leaves a body locked or used by middleware raw', async () => {
    const baseUrl = await serve((_name, res) => complete(res, 200, '{"a":1}', 'chunked'));
    const locks: ReadableStreamDefaultReader<Uint8Array>[] = [];
    const locking = createGraphGoblinClient({ baseUrl });
    locking.use({
      onResponse({ response }) {
        locks.push(response.body!.getReader());
      },
    });
    const using = createGraphGoblinClient({ baseUrl });
    using.use({
      async onResponse({ response }) {
        await response.text();
      },
    });
    try {
      for (const client of [locking, using]) {
        const error = await settle(read(client, 'misuse'));
        expect(error).toBeInstanceOf(TypeError);
        expect(error).not.toBeInstanceOf(GraphGoblinApiError);
      }
    } finally {
      for (const lock of locks) await lock.cancel();
    }
    expect(Object.fromEntries(hits)).toEqual({ misuse: 2 });
  });
});

/** Record the rejection of the reader `readJson` acquires, leaving the native object untouched. */
function observeRead(stream: ReadableStream<Uint8Array> | null | undefined): {
  rejection?: unknown;
} {
  const seen: { rejection?: unknown } = {};
  const target = stream!;
  const getReader = target.getReader.bind(target) as () => ReadableStreamDefaultReader<Uint8Array>;
  Object.defineProperty(target, 'getReader', {
    value: () => {
      const reader = getReader();
      const read = reader.read.bind(reader);
      Object.defineProperty(reader, 'read', {
        value: () =>
          read().catch((error: unknown) => {
            seen.rejection = error;
            throw error;
          }),
      });
      return reader;
    },
  });
  return seen;
}

describe('readJson controls', () => {
  it('classifies only a GET read failure and keeps the identical native cause', async () => {
    const baseUrl = await serve((_name, res) => truncate(res, 200, 'chunked'));
    const client = createGraphGoblinClient({ baseUrl });
    for (const method of ['GET', 'HEAD', 'POST']) {
      const result = await client.GET('/runs/{id}', {
        params: { path: { id: method } },
        parseAs: 'stream',
      });
      const seen = observeRead(result.data);
      const error = await settle(readJson(method, result, undefined));
      expect(seen.rejection).toBeInstanceOf(TypeError);
      if (method === 'GET') {
        expect(error).toBeInstanceOf(GraphGoblinApiError);
        expect(error).toMatchObject({ status: 0, code: 'RESPONSE_INTERRUPTED' });
        expect((error as Error).cause).toBe(seen.rejection);
      } else {
        expect(error).toBe(seen.rejection);
      }
    }
    expect(Object.fromEntries(hits)).toEqual({ GET: 1, HEAD: 1, POST: 1 });
  });

  it.each([
    ['default', () => undefined],
    ['explicit-reason', () => new Error('the caller left')],
  ])('rethrows the identical read rejection after a %s abort', async (_kind, reason) => {
    const baseUrl = await serve((_name, res) => hold(res));
    const controller = new AbortController();
    const result = await createGraphGoblinClient({ baseUrl }).GET('/runs/{id}', {
      params: { path: { id: 'aborted' } },
      parseAs: 'stream',
      signal: controller.signal,
    });
    const seen = observeRead(result.data);
    const pending = settle(readJson('GET', result, controller.signal));
    controller.abort(reason());
    const error = await pending;
    expect(seen.rejection).toBeDefined();
    expect(error).toBe(seen.rejection);
    expect(error).not.toBeInstanceOf(GraphGoblinApiError);
    expect(Object.fromEntries(hits)).toEqual({ aborted: 1 });
  });

  it('reads the very Response fetch returned, keeping its metadata', async () => {
    const baseUrl = await serve((_name, res) => complete(res, 200, '{"a":1}', 'fixed-length'));
    const seen: Response[] = [];
    const client = createGraphGoblinClient({ baseUrl, fetch: passThrough(seen) });
    const result = await client.GET('/runs/{id}', {
      params: { path: { id: 'same' } },
      parseAs: 'stream',
    });
    expect(result.response).toBe(seen[0]);
    expect(result.response.bodyUsed).toBe(false);
    await expect(readJson('GET', result, undefined)).resolves.toEqual({ a: 1 });
    expect(result.response).toMatchObject({
      bodyUsed: true,
      status: 200,
      type: 'basic',
      url: `${baseUrl}/runs/same`,
    });
    expect(result.response.headers.get('content-length')).toBe('7');
  });

  it('reads a result without a body, such as HEAD or 204, as undefined', async () => {
    await expect(
      readJson('HEAD', { response: new Response(null) }, undefined),
    ).resolves.toBeUndefined();
    await expect(
      readJson('GET', { data: null, response: new Response(null, { status: 204 }) }, undefined),
    ).resolves.toBeUndefined();
  });
});

describe('boundaries outside runs.get and runs.observation', () => {
  it('leaves raw client.GET, other resources and writes with their native body failure', async () => {
    const baseUrl = await serve((_name, res) => truncate(res, 200, 'chunked'));
    const client = createGraphGoblinClient({ baseUrl });
    const outcomes = [
      await settle(client.GET('/runs/{id}', { params: { path: { id: 'raw-get' } } })),
      await settle(runs.thread(client, 'thread')),
      await settle(runs.cancel(client, 'post')),
    ];
    for (const error of outcomes) {
      expect(error).toBeInstanceOf(TypeError);
      expect(error).not.toBeInstanceOf(GraphGoblinApiError);
    }
    expect(Object.fromEntries(hits)).toEqual({ 'raw-get': 1, thread: 1, post: 1 });
  });

  it('returns a parseAs stream body unread and leaves its failure to the caller', async () => {
    const baseUrl = await serve((_name, res) => truncate(res, 200, 'fixed-length'));
    const { data, response } = await createGraphGoblinClient({ baseUrl }).GET('/runs/{id}', {
      params: { path: { id: 'stream' } },
      parseAs: 'stream',
    });
    expect(response.bodyUsed).toBe(false);
    const reader = data!.getReader();
    const drain = async () => {
      while (!(await reader.read()).done);
    };
    const error = await settle(drain());
    expect(error).toBeInstanceOf(TypeError);
    expect(error).not.toBeInstanceOf(GraphGoblinApiError);
    expect(Object.fromEntries(hits)).toEqual({ stream: 1 });
  });

  it('keeps an SSE body interruption on the subscription retry path', async () => {
    const baseUrl = await serve((_name, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(': open\n\n', () => setTimeout(() => res.socket?.destroy(), 10));
    });
    const errors: unknown[] = [];
    const subscription = subscribeRunEvents({
      client: createGraphGoblinClient({ baseUrl }),
      runId: 'sse',
      onEvent: () => undefined,
      onError: (error) => errors.push(error),
      backoff: { maxAttempts: 1 },
    });
    await expect(subscription.done).rejects.toThrow(/gave up/);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(TypeError);
    expect(errors[0]).not.toBeInstanceOf(GraphGoblinApiError);
    expect(Object.fromEntries(hits)).toEqual({ sse: 1 });
  });
});

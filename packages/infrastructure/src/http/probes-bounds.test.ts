import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { HTTP_PROBE_MAX_BODY_BYTES } from '@graphgoblin/engine';
import { HttpProbes } from './probes.js';

const cap = HTTP_PROBE_MAX_BODY_BYTES;
let server: Server | undefined;
const sockets = new Set<Socket>();
async function serve(handler: RequestListener): Promise<string> {
  server = createServer(handler);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
    for (const socket of sockets) socket.destroy();
  });
  server = undefined;
});
const probe = (
  url: string,
  signal = new AbortController().signal,
  method: 'GET' | 'HEAD' = 'GET',
) => new HttpProbes().fetch({ method, url, timeoutMs: 10_000 }, signal);

describe('HTTP probe body bounds over real sockets', () => {
  it.each([304, 204])(
    'accepts body-less %i metadata with a large declared representation length',
    async (status) => {
      const url = await serve((_req, res) => {
        res.writeHead(status, { 'content-length': 100_000 });
        res.end();
      });
      expect(await probe(url)).toMatchObject({
        status,
        body: '',
        headers: { 'content-length': '100000' },
      });
    },
  );

  it('accepts gzip at the decompressed cap when its wire length exceeds the cap', async () => {
    const body = 'x'.repeat(cap);
    const compressed = gzipSync(body, { level: 0 });
    expect(compressed.length).toBeGreaterThan(cap);
    const url = await serve((_req, res) => {
      res.writeHead(200, { 'content-encoding': 'gzip', 'content-length': compressed.length });
      res.end(compressed);
    });
    expect(await probe(url)).toMatchObject({ body });
  });

  it('bounds decompressed bytes even when the compressed Content-Length fits', async () => {
    const compressed = gzipSync('x'.repeat(cap + 1));
    expect(compressed.length).toBeLessThan(cap);
    const url = await serve((_req, res) => {
      res.writeHead(200, { 'content-encoding': 'gzip', 'content-length': compressed.length });
      res.end(compressed);
    });
    await expect(probe(url)).rejects.toMatchObject({ code: 'HTTP_PROBE_BODY_OVERFLOW' });
  });
  it.each([false, true])('accepts exactly the byte cap (chunked: %s)', async (chunked) => {
    const body = JSON.stringify('x'.repeat(cap - 2));
    const url = await serve((_req, res) => {
      res.writeHead(200, {
        'content-type': 'application/json',
        ...(!chunked ? { 'content-length': Buffer.byteLength(body) } : {}),
      });
      res.write(body.slice(0, 123));
      res.end(body.slice(123));
    });
    const result = await probe(url);
    expect(result.body).toBe(body);
    expect(result.json).toBe('x'.repeat(cap - 2));
    expect(result.headers['content-length']).toBe(chunked ? undefined : String(cap));
  });

  it.each([false, true])('refuses cap plus one before parsing (chunked: %s)', async (chunked) => {
    const body = JSON.stringify('x'.repeat(cap - 1));
    const url = await serve((_req, res) => {
      res.writeHead(200, {
        'content-type': 'application/json',
        ...(!chunked ? { 'content-length': Buffer.byteLength(body) } : {}),
      });
      res.write(body.slice(0, cap));
      res.end(body.slice(cap));
    });
    const outcome = await probe(url).then(
      (response) => ({ outcome: 'success', bytes: Buffer.byteLength(response.body) }),
      (error: unknown) => ({
        outcome: 'failure',
        code: error instanceof Error && 'code' in error ? error.code : undefined,
      }),
    );
    expect(outcome).toEqual({ outcome: 'failure', code: 'HTTP_PROBE_BODY_OVERFLOW' });
  });

  it('refuses an oversized Content-Length without waiting for any body bytes', async () => {
    let closed!: () => void;
    const close = new Promise<void>((resolve) => {
      closed = resolve;
    });
    const url = await serve((_req, res) => {
      res.on('close', closed);
      res.writeHead(200, { 'content-length': cap + 1 });
      res.flushHeaders();
    });
    await expect(probe(url)).rejects.toMatchObject({ code: 'HTTP_PROBE_BODY_OVERFLOW' });
    await close;
  });

  it('cancels a no-length stream on overflow without waiting for EOF', async () => {
    let closed!: () => void;
    const close = new Promise<void>((resolve) => {
      closed = resolve;
    });
    let sent = 0;
    const url = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      const timer = setInterval(() => {
        res.write(Buffer.alloc(4096, 120));
        sent += 4096;
      }, 5);
      res.on('close', () => {
        clearInterval(timer);
        closed();
      });
    });
    await expect(probe(url)).rejects.toMatchObject({ code: 'HTTP_PROBE_BODY_OVERFLOW' });
    await close;
    expect(sent).toBeGreaterThan(cap);
  });

  it.each(Array.from({ length: 10 }, (_, index) => index + 1))(
    'preserves split UTF-8 JSON at byte offset %i, including at the cap',
    async (offset) => {
      const value = 'A\u00e9\u96ea\u{1f98e}Z';
      const sample = Buffer.from(value);
      const body = Buffer.concat([
        Buffer.from('"' + 'x'.repeat(cap - sample.length - 2)),
        sample,
        Buffer.from('"'),
      ]);
      const split = cap - sample.length - 1 + offset;
      const url = await serve((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write(body.subarray(0, split));
        const timer = setTimeout(() => res.end(body.subarray(split)), 30);
        res.on('close', () => clearTimeout(timer));
      });
      const response = await probe(url);
      expect(Buffer.from(response.body)).toEqual(body);
      expect(response.json).toBe('x'.repeat(cap - sample.length - 2) + value);
    },
  );

  it.each(['abort', 'timeout'] as const)('releases the socket on %s mid-read', async (mode) => {
    const controller = new AbortController();
    let began!: () => void;
    const first = new Promise<void>((resolve) => {
      began = resolve;
    });
    let closed!: () => void;
    const close = new Promise<void>((resolve) => {
      closed = resolve;
    });
    const url = await serve((_req, res) => {
      res.writeHead(200);
      res.write(Buffer.from([65, 240, 159]));
      began();
      res.on('close', closed);
    });
    const outcome = new HttpProbes().fetch(
      { method: 'GET', url, timeoutMs: mode === 'timeout' ? 200 : 10_000 },
      controller.signal,
    );
    const assertion = expect(outcome).rejects.toMatchObject({
      name: mode === 'abort' ? 'AbortError' : 'TimeoutError',
    });
    await first;
    if (mode === 'abort') controller.abort(new Error('private reason'));
    await assertion;
    await close;
  });

  it('accepts HEAD metadata for a large representation without reading its body', async () => {
    const url = await serve((_req, res) => {
      res.writeHead(200, { 'content-length': cap * 100, 'content-type': 'application/json' });
      res.end();
    });
    expect(await probe(url, undefined, 'HEAD')).toMatchObject({
      body: '',
      headers: { 'content-length': String(cap * 100) },
    });
  });
});

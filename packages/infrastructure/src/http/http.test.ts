import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CapturingLogger, FakeClock } from '@graphgoblin/engine/testing';
import {
  HttpWebhookDelivery,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  createReturnDelivery,
  signPayload,
  verifySignature,
} from './delivery.js';
import { HttpProbes } from './probes.js';

interface Captured {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

let server: Server;
let base: string;
const captured: Captured[] = [];
const sockets = new Set<Socket>();

beforeEach(async () => {
  captured.length = 0;
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString('utf8')));
    req.on('end', () => {
      captured.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      if (req.url === '/json') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ready: true, echo: body }));
      } else if (req.url === '/bad-json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{not json');
      } else if (req.url === '/slow') {
        // Only the client abort or teardown may close this unanswered request.
        return;
      } else if (req.url === '/fail') {
        res.writeHead(503);
        res.end('nope');
      } else {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
      }
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    for (const socket of sockets) socket.destroy();
  });
});

describe('HttpProbes', () => {
  it('performs GET, HEAD, and POST probes and parses JSON bodies', async () => {
    const probes = new HttpProbes();
    const signal = new AbortController().signal;
    const json = await probes.fetch(
      {
        method: 'POST',
        url: `${base}/json`,
        headers: { 'x-a': '1' },
        body: 'payload',
        timeoutMs: 20_000,
      },
      signal,
    );
    expect(json.status).toBe(200);
    expect(json.json).toEqual({ ready: true, echo: 'payload' });
    expect(json.headers['content-type']).toMatch(/json/);
    expect(captured[0]?.headers['x-a']).toBe('1');

    const text = await probes.fetch(
      { method: 'GET', url: `${base}/text`, body: 'ignored', timeoutMs: 20_000 },
      signal,
    );
    expect(text.body).toBe('ok');
    expect('json' in text).toBe(false);
    expect(captured[1]?.body).toBe('');

    const head = await probes.fetch(
      { method: 'HEAD', url: `${base}/text`, timeoutMs: 20_000 },
      signal,
    );
    expect(head.body).toBe('');

    const bad = await probes.fetch(
      { method: 'GET', url: `${base}/bad-json`, timeoutMs: 20_000 },
      signal,
    );
    expect(bad.json).toBeUndefined();
  });

  it('times out and honours the caller signal', { timeout: 20_000 }, async () => {
    const probes = new HttpProbes();
    await expect(
      probes.fetch(
        { method: 'GET', url: `${base}/slow`, timeoutMs: 100 },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
    const controller = new AbortController();
    controller.abort();
    await expect(
      probes.fetch({ method: 'GET', url: `${base}/text`, timeoutMs: 20_000 }, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(captured.map((request) => request.url)).not.toContain('/text');
  });
});

describe('signatures', () => {
  it('signs and verifies in constant time', () => {
    const sig = signPayload('s3cret', '2026-10-02T12:00:00.000Z', '{"a":1}');
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(verifySignature('s3cret', '2026-10-02T12:00:00.000Z', '{"a":1}', sig)).toBe(true);
    expect(verifySignature('other', '2026-10-02T12:00:00.000Z', '{"a":1}', sig)).toBe(false);
    expect(verifySignature('s3cret', '2026-10-02T12:00:00.000Z', '{"a":2}', sig)).toBe(false);
    expect(verifySignature('s3cret', '2026-10-02T12:00:00.000Z', '{"a":1}', 'sha256=short')).toBe(
      false,
    );
  });
});

describe('HttpWebhookDelivery', () => {
  it('posts signed JSON and throws on non-2xx responses', async () => {
    const clock = new FakeClock();
    const delivery = new HttpWebhookDelivery(clock, { timeoutMs: 20_000 });
    await delivery.webhook(`${base}/hook`, { result: 1 }, 'hs');
    const call = captured[0]!;
    expect(call.method).toBe('POST');
    expect(call.headers['content-type']).toBe('application/json');
    expect(call.headers[TIMESTAMP_HEADER]).toBe(clock.now().toISOString());
    expect(
      verifySignature(
        'hs',
        clock.now().toISOString(),
        call.body,
        String(call.headers[SIGNATURE_HEADER]),
      ),
    ).toBe(true);
    await delivery.webhook(`${base}/hook`, { result: 2 });
    expect(captured[1]?.headers[SIGNATURE_HEADER]).toBeUndefined();
    await expect(delivery.webhook(`${base}/fail`, {})).rejects.toThrow(/returned 503/);
  });

  it('composes the return-delivery port', async () => {
    const logger = new CapturingLogger();
    const events: { eventType: string; payload: unknown }[] = [];
    const port = createReturnDelivery({
      webhooks: { webhook: () => Promise.resolve() },
      publishEvent: (eventType, payload) => {
        events.push({ eventType, payload });
        return Promise.resolve();
      },
      logger,
    });
    await port.webhook('http://x', {}, undefined);
    await port.publishEvent('done', { a: 1 });
    port.log('run-1', { b: 2 });
    expect(events).toEqual([{ eventType: 'done', payload: { a: 1 } }]);
    expect(logger.lines[0]).toMatchObject({
      level: 'info',
      msg: 'loop returned',
      obj: { runId: 'run-1' },
    });
  });
});

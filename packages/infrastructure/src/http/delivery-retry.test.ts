import { createServer, type ServerResponse } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeClock } from '@graphgoblin/engine/testing';
import { HttpWebhookDelivery } from './delivery.js';

const calls: { path: string; id: string | undefined }[] = [];
let url: string;
const late = new Set<ReturnType<typeof setTimeout>>();
const server = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    calls.push({ path: req.url ?? '', id: req.headers['idempotency-key']?.toString() });
    const finish = (response: ServerResponse) => response.writeHead(200).end('accepted');
    if (req.url === '/late') {
      const timer = setTimeout(() => {
        late.delete(timer);
        finish(res);
      }, 200);
      late.add(timer);
    } else if (req.url === '/drop') {
      res.writeHead(200, { 'content-length': '100' });
      res.write('partial');
      const timer = setTimeout(() => {
        late.delete(timer);
        res.destroy();
      }, 5);
      late.add(timer);
    } else if (req.url === '/large') res.writeHead(200).end('x'.repeat(65_537));
    else if (req.url === '/hang') return;
    else if (req.url === '/reset') res.destroy();
    else if (req.url === '/301') res.writeHead(301, { location: '/200' }).end();
    else res.writeHead(Number(req.url?.slice(1)) || 200).end();
  });
});
beforeAll(async () => {
  await new Promise<void>((ok, no) => {
    server.once('error', no);
    server.listen(0, '127.0.0.1', ok);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing receiver address');
  url = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  for (const timer of late) clearTimeout(timer);
  server.closeAllConnections();
  await new Promise<void>((ok) => server.close(() => ok()));
});
describe('webhook HTTP outcomes with a controlled receiver', () => {
  it.each([200, 204, 301, 400, 401, 408, 429, 500, 503])(
    'classifies HTTP %i without redirects',
    async (status) => {
      const result = await new HttpWebhookDelivery(new FakeClock()).webhook(
        url + '/' + status,
        {},
        undefined,
        'identity',
      );
      if (status < 300) expect(result).toEqual({ ok: true });
      else
        expect(result).toMatchObject({
          ok: false,
          error: {
            code: 'http',
            httpStatus: status,
            retryable: status >= 500 || status === 408 || status === 429,
          },
        });
      expect(calls.at(-1)?.id).toBe('identity');
    },
  );
  it.each(['/late', '/drop', '/reset', '/hang'])(
    'preserves uncertain acknowledgement for %s',
    async (path) => {
      const result = await new HttpWebhookDelivery(new FakeClock(), { timeoutMs: 50 }).webhook(
        url + path,
        {},
        undefined,
        'same-id',
      );
      expect(result).toMatchObject({
        ok: false,
        error: { retryable: true, acknowledgement: 'unknown' },
      });
      if (path === '/late' || path === '/hang')
        expect(result).toMatchObject({ error: { code: 'timeout' } });
    },
  );
  it('bounds acknowledgement bytes', async () => {
    await expect(
      new HttpWebhookDelivery(new FakeClock()).webhook(url + '/large', {}, undefined, 'id'),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'transport', acknowledgement: 'unknown' },
    });
  });
  it.each(['not a URL', 'file:///tmp/test', 'https://user:password@example.test'])(
    'rejects malformed or unsupported destinations before sending (%s)',
    async (destination) => {
      await expect(
        new HttpWebhookDelivery(new FakeClock()).webhook(destination, {}, undefined, 'id'),
      ).resolves.toMatchObject({
        ok: false,
        error: { code: 'invalid_destination', retryable: false, acknowledgement: 'not_sent' },
      });
    },
  );
  it('identifies a positively refused connection as not sent', async () => {
    const closed = createServer();
    await new Promise<void>((ok) => closed.listen(0, '127.0.0.1', ok));
    const address = closed.address();
    if (!address || typeof address === 'string') throw Error('Missing closed address');
    await new Promise<void>((ok) => closed.close(() => ok()));
    await expect(
      new HttpWebhookDelivery(new FakeClock()).webhook(
        `http://127.0.0.1:${address.port}`,
        {},
        undefined,
        'id',
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'connection_refused', retryable: true, acknowledgement: 'not_sent' },
    });
  });
});

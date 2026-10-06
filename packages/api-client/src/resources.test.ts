import { expect, it } from 'vitest';
import { apiKeys, cron, createGraphGoblinClient } from './index.js';

it('forwards list cancellation to the request without requiring it from existing callers', async () => {
  const requests: Request[] = [];
  const client = createGraphGoblinClient({
    baseUrl: 'http://graphgoblin.test',
    fetch: (request) => {
      requests.push(request);
      return Promise.resolve(
        new Response(JSON.stringify({ items: [] }), {
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
  });
  const controller = new AbortController();
  await expect(apiKeys.list(client, { signal: controller.signal })).resolves.toEqual([]);
  await expect(apiKeys.list(client)).resolves.toEqual([]);
  controller.abort();
  expect(requests[0]!.signal.aborted).toBe(true);
  expect(requests[1]!.signal.aborted).toBe(false);
});

it('previews through the generated endpoint and forwards body and cancellation', async () => {
  const requests: Request[] = [];
  const client = createGraphGoblinClient({
    baseUrl: 'http://graphgoblin.test',
    fetch: (request) => {
      requests.push(request);
      return Promise.resolve(
        new Response(JSON.stringify({ next: ['2026-03-29T08:00:00.000Z'] }), {
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
  });
  const body = {
    expression: '0 9 * * *',
    timezone: 'Europe/London',
    count: 5,
    from: '2026-03-27T10:00:00.000Z',
  };
  const controller = new AbortController();
  await expect(cron.preview(client, body, { signal: controller.signal })).resolves.toEqual({
    next: ['2026-03-29T08:00:00.000Z'],
  });
  await cron.preview(client, body);
  expect(requests[0]!.method).toBe('POST');
  expect(requests[0]!.url).toBe('http://graphgoblin.test/triggers/cron/preview');
  expect(await requests[0]!.json()).toEqual(body);
  controller.abort();
  expect(requests[0]!.signal.aborted).toBe(true);
  expect(requests[1]!.signal.aborted).toBe(false);
});

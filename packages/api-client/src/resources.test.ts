import { expect, it } from 'vitest';
import { apiKeys, cron, events, runs, createGraphGoblinClient } from './index.js';

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

it('exposes opaque cursors and carries every unchanged filter into following history requests', async () => {
  const requests: Request[] = [];
  const client = createGraphGoblinClient({
    baseUrl: 'http://graphgoblin.test',
    fetch: (request) => {
      requests.push(request);
      return Promise.resolve(
        new Response(JSON.stringify({ items: [], nextCursor: 'opaque_cursor' }), {
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
  });
  const controller = new AbortController();
  const filters = {
    loopId: 'loop',
    status: 'succeeded,failed',
    parent: 'none',
    before: '2026-10-03T00:00:00.000Z',
    limit: 1,
  };
  const first = await runs.list(client, filters, { signal: controller.signal });
  expect(first.nextCursor).toBe('opaque_cursor');
  await runs.list(client, { ...filters, cursor: first.nextCursor! });
  const eventFilters = { type: 'chosen', before: filters.before, limit: 1 };
  const eventPage = await events.list(client, eventFilters, { signal: controller.signal });
  await events.list(client, { ...eventFilters, cursor: eventPage.nextCursor! });
  for (const [index, expected] of [
    [1, filters],
    [3, eventFilters],
  ] as const) {
    const search = new URL(requests[index]!.url).searchParams;
    for (const [key, value] of Object.entries(expected))
      expect(search.get(key)).toBe(String(value));
    expect(search.get('cursor')).toBe('opaque_cursor');
  }
  controller.abort();
  expect(requests[0]!.signal.aborted).toBe(true);
  expect(requests[2]!.signal.aborted).toBe(true);
  expect(requests[1]!.signal.aborted).toBe(false);
});

it('passes an inclusive event anchor with filters and a bounded limit', async () => {
  const requests: Request[] = [];
  const client = createGraphGoblinClient({
    baseUrl: 'http://graphgoblin.test',
    fetch: (request) => {
      requests.push(request);
      return Promise.resolve(Response.json({ items: [], nextCursor: null }));
    },
  });
  const query = {
    anchor: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    type: 'chosen',
    before: '2099-01-01T00:00:00.000Z',
    limit: 100,
  };
  await events.list(client, query);
  const search = new URL(requests[0]!.url).searchParams;
  expect(Object.fromEntries(search)).toEqual({ ...query, limit: '100' });
  expect(search.has('cursor')).toBe(false);
});

it('forwards run observation cancellation to GET without cancelling the run', async () => {
  const requests: Request[] = [];
  const client = createGraphGoblinClient({
    baseUrl: 'http://api',
    fetch: (request) => {
      requests.push(request);
      return Promise.resolve(Response.json({ status: 'running' }));
    },
  });
  const controller = new AbortController();
  await runs.get(client, 'run', { signal: controller.signal });
  await runs.get(client, 'run');
  controller.abort();
  expect(requests.map((request) => request.method)).toEqual(['GET', 'GET']);
  expect(requests[0]!.signal.aborted).toBe(true);
  expect(requests[1]!.signal.aborted).toBe(false);
});

it('carries opaque browser cursors, exact thread boundaries and cancellation to run reads', async () => {
  const requests: Request[] = [];
  const client = createGraphGoblinClient({
    baseUrl: 'http://graphgoblin.test',
    fetch: (request) => {
      requests.push(request);
      return Promise.resolve(
        Response.json({ items: [], olderCursor: 'opaque', newerCursor: null }),
      );
    },
  });
  const controller = new AbortController();
  await runs.events(client, 'run', { cursor: 'opaque', limit: 128 }, { signal: controller.signal });
  await runs.events(client, 'run', { around: 100 });
  await runs.thread(client, 'run', { at: 99 }, { signal: controller.signal });
  await runs.observation(client, 'run', { signal: controller.signal });
  expect(new URL(requests[0]!.url).searchParams.get('cursor')).toBe('opaque');
  expect(new URL(requests[1]!.url).searchParams.get('around')).toBe('100');
  expect(new URL(requests[2]!.url).searchParams.get('at')).toBe('99');
  expect(new URL(requests[3]!.url).pathname).toBe('/runs/run/observation');
  controller.abort();
  expect(requests[0]!.signal.aborted).toBe(true);
  expect(requests[2]!.signal.aborted).toBe(true);
  expect(requests[3]!.signal.aborted).toBe(true);
});

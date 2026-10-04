import { expect, it } from 'vitest';
import { apiKeys, createGraphGoblinClient } from './index.js';

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

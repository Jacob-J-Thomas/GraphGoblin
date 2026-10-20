import type { RunRecord } from '@graphgoblin/contracts';
import { fakeUlid, samplePin } from '@graphgoblin/contracts/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { expect, it } from 'vitest';
import { createMcpServer } from './index.js';

function page(result: unknown): { items: { id: string }[]; nextCursor: string | null } {
  const { content, isError } = result as CallToolResult;
  expect(isError).toBeFalsy();
  const first = content[0];
  if (first?.type !== 'text') throw new Error('expected text content');
  return JSON.parse(first.text) as { items: { id: string }[]; nextCursor: string | null };
}

it('list_runs follows the server cursor past an empty damaged-row page to a readable run', async () => {
  const run: RunRecord = {
    id: fakeUlid('readable-run'),
    ownerId: 'local',
    loopId: fakeUlid('loop'),
    versionId: fakeUlid('version'),
    pinned: samplePin(),
    invocationId: fakeUlid('invocation'),
    status: 'succeeded',
    iteration: 1,
    createdAt: '2026-10-18T00:00:00.000Z',
    lastEventSeq: 1,
  };
  const cursor = 'opaque-server-cursor';
  const requests: URL[] = [];
  const server = createMcpServer({
    apiUrl: 'http://graphgoblin.test',
    fetch: (request) => {
      const url = new URL(request.url);
      requests.push(url);
      return Promise.resolve(
        Response.json(
          url.searchParams.get('cursor') === cursor
            ? { items: [run], nextCursor: null }
            : { items: [], nextCursor: cursor },
        ),
      );
    },
  });
  const client = new Client({ name: 'run-pagination-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const filters = { loopId: run.loopId, status: ['succeeded'], parentRunId: 'none', limit: 1 };
    const first = page(await client.callTool({ name: 'list_runs', arguments: filters }));
    expect(first).toEqual({ items: [], nextCursor: cursor });

    const next = page(
      await client.callTool({
        name: 'list_runs',
        arguments: { ...filters, cursor: first.nextCursor },
      }),
    );
    expect(next.items.map((item) => item.id)).toEqual([run.id]);
    // A full decoded page is still the last page when the server says so.
    expect(next.nextCursor).toBeNull();
    expect(Object.keys(next).sort()).toEqual(['items', 'nextCursor']);
    expect(requests.map((url) => url.pathname)).toEqual(['/runs', '/runs']);
    expect(Object.fromEntries(requests[1]!.searchParams)).toEqual({
      loopId: run.loopId,
      status: 'succeeded',
      parent: 'none',
      limit: '1',
      cursor,
    });
  } finally {
    await client.close();
    await server.close();
  }
});

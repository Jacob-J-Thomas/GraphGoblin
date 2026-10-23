import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { FIXTURE_IDS } from '@graphgoblin/contracts/testing';
import type { FetchLike } from '@graphgoblin/api-client';
import { createMcpServer } from './server.js';

async function connect(fetch: FetchLike) {
  const server = createMcpServer({ apiUrl: 'http://api', fetch, pollMs: 10 });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'wait-test', version: '1' });
  await client.connect(clientSide);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function payload(result: unknown): Record<string, unknown> {
  const parsed = CallToolResultSchema.parse(result);
  expect(parsed.isError).toBeFalsy();
  const content = parsed.content[0];
  if (content?.type !== 'text') throw new Error('expected a text tool result');
  return JSON.parse(content.text) as Record<string, unknown>;
}

describe('MCP observation deadlines', () => {
  afterEach(() => vi.useRealTimers());

  it('advertises a minimum one-second budget and refuses zero without a GET', async () => {
    const requests: Request[] = [];
    const session = await connect((request) => {
      requests.push(request);
      return Promise.resolve(Response.json({ status: 'running' }));
    });
    try {
      const { tools } = await session.client.listTools();
      expect(tools.find((tool) => tool.name === 'wait_for_run')?.inputSchema).toMatchObject({
        properties: { timeoutSeconds: { minimum: 1, maximum: 600 } },
      });
      const result = CallToolResultSchema.parse(
        await session.client.callTool({
          name: 'wait_for_run',
          arguments: { runId: FIXTURE_IDS.run, timeoutSeconds: 0 },
        }),
      );
      expect(result.isError).toBe(true);
      expect(requests).toEqual([]);
    } finally {
      await session.close();
    }
  });

  it('ends a stalled GET at the deadline, ignores its late success, and never cancels the run', async () => {
    const requests: Request[] = [];
    let respond!: (response: Response) => void;
    const session = await connect((request) => {
      requests.push(request);
      return new Promise<Response>((resolve) => {
        respond = resolve;
      });
    });
    try {
      vi.useFakeTimers();
      const pending = session.client.callTool({
        name: 'wait_for_run',
        arguments: { runId: FIXTURE_IDS.run, timeoutSeconds: 1 },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(requests).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1000);
      const result = payload(await pending);
      expect(result).toEqual({ finished: false, next: expect.stringMatching(/No run snapshot/) });
      expect(requests[0]!.signal.aborted).toBe(true);
      respond(Response.json({ status: 'succeeded' }));
      await vi.advanceTimersByTimeAsync(0);
      expect(requests.map((request) => [request.method, new URL(request.url).pathname])).toEqual([
        ['GET', `/runs/${FIXTURE_IDS.run}`],
      ]);
    } finally {
      await session.close();
    }
  });

  it('returns the last observed status when a later request stalls', async () => {
    const requests: Request[] = [];
    const session = await connect((request) => {
      requests.push(request);
      return requests.length === 1
        ? Promise.resolve(Response.json({ status: 'running', lastEventSeq: 7 }))
        : new Promise<Response>(() => undefined);
    });
    try {
      vi.useFakeTimers();
      const pending = session.client.callTool({
        name: 'wait_for_run',
        arguments: { runId: FIXTURE_IDS.run, timeoutSeconds: 1 },
      });
      await vi.advanceTimersByTimeAsync(1000);
      expect(payload(await pending)).toMatchObject({
        finished: false,
        status: 'running',
        cursor: 7,
      });
      expect(requests).toHaveLength(2);
      expect(requests.every((request) => request.signal.aborted)).toBe(true);
      expect(requests.every((request) => request.method === 'GET')).toBe(true);
    } finally {
      await session.close();
    }
  });

  it('propagates MCP request cancellation into a stalled GET without a cancel endpoint', async () => {
    const requests: Request[] = [];
    let requested!: () => void;
    const entered = new Promise<void>((resolve) => {
      requested = resolve;
    });
    const session = await connect((request) => {
      requests.push(request);
      requested();
      return new Promise<Response>(() => undefined);
    });
    try {
      const controller = new AbortController();
      const reason = new Error('caller stopped observing');
      const pending = session.client.callTool(
        { name: 'wait_for_run', arguments: { runId: FIXTURE_IDS.run } },
        undefined,
        { signal: controller.signal },
      );
      const rejected = expect(pending).rejects.toMatchObject({
        name: 'McpError',
        message: expect.stringContaining(reason.message),
      });
      await entered;
      controller.abort(reason);
      await rejected;
      await vi.waitFor(() => expect(requests[0]!.signal.aborted).toBe(true));
      expect(requests.map((request) => request.method)).toEqual(['GET']);
    } finally {
      await session.close();
    }
  });
});

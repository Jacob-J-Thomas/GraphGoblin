import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { createTestApp } from '@graphgoblin/api/testing';
import { createGraphGoblinClient, runs, waitForRun } from '@graphgoblin/api-client';
import { createMcpServer } from './server.js';

let response: ServerResponse | undefined;
let identity: string | undefined;
let receiverUrl: string;
const receiver = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    identity = req.headers['idempotency-key']?.toString();
    response = res;
  });
});
function acknowledge(status: number) {
  response?.writeHead(status).end('ack');
}
function closePending() {
  response?.end();
}
beforeAll(async () => {
  await new Promise<void>((ok, no) => {
    receiver.once('error', no);
    receiver.listen(0, '127.0.0.1', ok);
  });
  const address = receiver.address();
  if (!address || typeof address === 'string') throw Error('Missing receiver address');
  receiverUrl = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  receiver.closeAllConnections();
  await new Promise<void>((ok) => receiver.close(() => ok()));
});

function payload(value: unknown): Record<string, unknown> {
  const result = CallToolResultSchema.parse(value);
  expect(result.isError).toBeFalsy();
  const text = result.content[0];
  if (text?.type !== 'text') throw Error('Missing text result');
  return JSON.parse(text.text) as Record<string, unknown>;
}

it.each([200, 400])(
  'exposes pending and final HTTP %i delivery through REST, api-client and MCP',
  { timeout: 30_000 },
  async (status) => {
    response = undefined;
    const dataDir = await mkdtemp(join(tmpdir(), 'gg-wp-d2-interfaces-'));
    const api = await createTestApp({ env: { GG_DATA_DIR: dataDir } });
    const baseUrl = await api.app.listen({ host: '127.0.0.1', port: 0 });
    const client = createGraphGoblinClient({ baseUrl });
    const server = createMcpServer({ client });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const mcp = new Client({ name: 'delivery-test', version: '1' });
    await mcp.connect(clientTransport);
    const call = async (name: string, runId: string) =>
      payload(await mcp.callTool({ name, arguments: { runId } }));
    try {
      const loopId = await api.publishLoop({
        schemaVersion: 4,
        name: 'Interface delivery ' + status,
        nodes: [
          { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
          {
            id: 'done',
            kind: 'exit',
            label: 'Done',
            config: {
              returns: 'trigger.payload',
              destinations: [{ kind: 'webhook', url: receiverUrl + '/hook' }],
            },
          },
        ],
        edges: [{ id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
      });
      const started = await runs.start(client, loopId, { input: { answer: 42 } });
      await vi.waitFor(() => expect(response).toBeDefined());
      const pending = await runs.get(client, started.id);
      expect(pending).toMatchObject({
        status: 'succeeded',
        deliveries: [{ status: 'pending', attempts: 1, inFlight: true, id: identity }],
      });
      expect(await call('get_run', started.id)).toMatchObject({
        status: 'succeeded',
        deliveries: pending.deliveries,
      });
      expect(await call('wait_for_run', started.id)).toMatchObject({
        finished: true,
        run: { status: 'succeeded', deliveries: pending.deliveries },
      });
      expect(await waitForRun(client, started.id, { timeoutMs: 1000 })).toMatchObject({
        finished: true,
        run: { deliveries: pending.deliveries },
      });
      acknowledge(status);
      await api.idle();
      const final = await runs.get(client, started.id);
      expect(final).toMatchObject({
        status: 'succeeded',
        result: { answer: 42 },
        deliveries: [{ status: status === 200 ? 'delivered' : 'failed', attempts: 1 }],
      });
      const rest = await api.app.inject({ method: 'GET', url: '/runs/' + started.id });
      expect(rest.json()).toEqual(final);
      expect(await call('get_run', started.id)).toEqual(final);
      expect(await call('wait_for_run', started.id)).toMatchObject({ finished: true, run: final });
      expect((await runs.list(client))[0]?.deliveries).toEqual(final.deliveries);
      const events = await runs.events(client, started.id);
      expect(events.items.filter((event) => event.type === 'delivery.finished')).toHaveLength(1);
    } finally {
      closePending();
      await mcp.close();
      await server.close();
      await api.close();
      expect(dirname(dataDir)).toBe(resolve(tmpdir()));
      expect(basename(dataDir).startsWith('gg-wp-d2-interfaces-')).toBe(true);
      await rm(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  },
);

import { expect, it } from 'vitest';
import { createThreadHistoryFixture } from '@graphgoblin/api/testing';
import { ContextThreadSchema, RunRecordSchema } from '@graphgoblin/contracts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from './server.js';

it('MCP reads agree through persisted failure and resume with stale snapshots', async () => {
  const t = await createThreadHistoryFixture();
  const apiUrl = await t.app.listen({ port: 5932, host: '127.0.0.1' });
  const server = createMcpServer({ apiUrl });
  const client = new Client({ name: 'thread-history-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
  async function call(name: string, runId: string) {
    const result = CallToolResultSchema.parse(
      await client.callTool({ name, arguments: { runId } }),
    );
    expect(result.isError).toBeFalsy();
    const text = result.content[0];
    if (text?.type !== 'text') throw new Error('Missing tool result');
    return JSON.parse(text.text) as unknown;
  }
  try {
    const response = await t.app.inject({
      method: 'POST',
      url: '/loops/' + t.loopId + '/runs',
      payload: {},
    });
    const run = RunRecordSchema.parse(response.json<{ run: unknown }>().run);
    await t.manager.waitForIdle();
    for (const status of ['failed', 'running', 'succeeded']) {
      if (status === 'running') {
        await t.app.inject({ method: 'POST', url: '/runs/' + run.id + '/resume' });
        await t.working;
      }
      if (status === 'succeeded') {
        t.release();
        await t.manager.waitForIdle();
      }
      const before = await t.bytes(run.id);
      expect(RunRecordSchema.parse(await call('get_run', run.id)).status).toBe(status);
      const thread = ContextThreadSchema.parse(await call('get_run_thread', run.id));
      expect(thread.vars).toEqual({
        prepared: true,
        ...(status === 'succeeded' ? { completed: true } : {}),
      });
      expect(thread.counters.nodeVisits.work).toBe(status === 'failed' ? 1 : 2);
      expect(await t.bytes(run.id)).toBe(before);
    }
  } finally {
    await client.close();
    await server.close();
    await t.close();
  }
});

import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createTestApp, type TestApp } from '@graphgoblin/api/testing';
import { fakeUlid, FIXTURE_TS, sampleThread } from '@graphgoblin/contracts/testing';
import type { RunRecord } from '@graphgoblin/contracts';
import { createGraphGoblinClient, type GraphGoblinClient } from '@graphgoblin/api-client';
import { createMcpServer, readAllEvents } from './index.js';

describe('MCP history paging against real SQLite and API', () => {
  let t: TestApp;
  let client: Client;
  let api: GraphGoblinClient;
  beforeEach(async () => {
    t = await createTestApp();
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    api = createGraphGoblinClient({
      baseUrl: `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`,
    });
    const server = createMcpServer({
      apiUrl: `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`,
    });
    const [left, right] = InMemoryTransport.createLinkedPair();
    await server.connect(right);
    client = new Client({ name: 'paging-test', version: '1' });
    await client.connect(left);
  });
  afterEach(async () => {
    await client.close();
    await t.close();
  });
  async function seed(index: number, overrides: Partial<RunRecord> = {}) {
    const record: RunRecord = {
      id: fakeUlid(`mcp-page:${index}`),
      ownerId: 'local',
      loopId: fakeUlid('paged-loop'),
      versionId: fakeUlid('version'),
      invocationId: fakeUlid(`inv:${index}`),
      status: 'succeeded',
      iteration: 1,
      lastEventSeq: 0,
      createdAt: FIXTURE_TS,
      ...overrides,
    };
    await t.container.repos.runs.create(record, sampleThread());
    return record;
  }
  async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = CallToolResultSchema.parse(await client.callTool({ name, arguments: args }));
    expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
    const first = result.content[0];
    if (first?.type !== 'text') throw new Error('expected JSON text');
    return JSON.parse(first.text) as T;
  }
  it('carries opaque cursors and all filters across limit-one timestamp ties to exhaustion', async () => {
    const records = [];
    for (let i = 0; i < 4; i++) records.push(await seed(i));
    await seed(9, { status: 'failed' });
    await seed(10, { loopId: fakeUlid('unrelated') });
    await seed(11, { parentRunId: fakeUlid('parent') });
    const filters = {
      loopId: records[0]!.loopId,
      status: ['succeeded'],
      parentRunId: 'none',
      before: '2026-10-03T00:00:00.000Z',
      limit: 1,
    };
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { items: { id: string }[]; nextCursor: string | null } = await call('list_runs', {
        ...filters,
        ...(cursor ? { cursor } : {}),
      });
      ids.push(...page.items.map((item) => item.id));
      expect(page).toHaveProperty('nextCursor');
      cursor = page.nextCursor;
    } while (cursor);
    expect(ids).toEqual(
      records
        .map((r) => r.id)
        .sort()
        .reverse(),
    );
  });
  it('treats before as a time filter, never as a substitute for a tied run cursor', async () => {
    const a = await seed(0);
    await seed(1);
    await seed(2);
    expect(await call('list_runs', { loopId: a.loopId, before: FIXTURE_TS, limit: 1 })).toEqual({
      items: [],
      nextCursor: null,
    });
    const invalid = CallToolResultSchema.parse(
      await client.callTool({ name: 'list_runs', arguments: { cursor: '!' } }),
    );
    expect(invalid.isError).toBe(true);
    expect(invalid.content).toEqual([
      { type: 'text', text: expect.stringContaining('INVALID_CURSOR (HTTP 400)') },
    ]);
  });
  it('reports no more events when the final page exactly equals its limit', async () => {
    const run = await seed(0);
    await t.container.repos.events.append(run.id, [
      { type: 'run.paused', actor: { kind: 'system', id: 'test' } },
      { type: 'run.resumed', actor: { kind: 'system', id: 'test' } },
    ]);
    expect((await readAllEvents(api, run.id, 2, 2)).truncated).toBe(false);
    expect(await call('read_run_events', { runId: run.id, limit: 2 })).toMatchObject({
      nextAfter: 2,
      hasMore: false,
    });
    expect(await call('read_run_events', { runId: run.id, limit: 1 })).toMatchObject({
      nextAfter: 1,
      hasMore: true,
    });
    expect(await call('read_run_events', { runId: run.id, after: 2, limit: 1 })).toEqual({
      items: [],
      nextAfter: 2,
      hasMore: false,
    });
  });
});

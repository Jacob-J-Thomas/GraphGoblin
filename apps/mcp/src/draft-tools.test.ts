import { createGraphGoblinClient, loops } from '@graphgoblin/api-client';
import { createTestApp, type TestApp } from '@graphgoblin/api/testing';
import { fakeUlid, minimalLoop } from '@graphgoblin/contracts/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMcpServer } from './index.js';

const draftNames = [
  'create_loop_draft',
  'get_loop_draft',
  'save_loop_draft',
  'validate_loop_definition',
];

function errorText(result: CallToolResult): string {
  expect(result.isError).toBe(true);
  const [content] = result.content;
  return content?.type === 'text' ? content.text : '';
}

describe('opt-in MCP draft authoring', () => {
  let api: TestApp;
  let url: string;
  let ownerToken: string;
  let readerToken: string;
  let otherToken: string;
  const connections: Client[] = [];

  beforeAll(async () => {
    api = await createTestApp({ requireApiKey: true });
    url = await api.app.listen({ host: '127.0.0.1', port: 0 });
    const keys = api.container.repos.apiKeys;
    ownerToken = (await keys.create('local', 'author', ['loops:write', 'runs:read'])).token;
    readerToken = (await keys.create('local', 'reader', ['loops:read'])).token;
    otherToken = (await keys.create('other', 'another owner', ['loops:write'])).token;
  });

  afterAll(async () => {
    await Promise.all(connections.map((client) => client.close()));
    await api.close();
  });

  async function connect(apiKey?: string, draftTools = true) {
    const server = createMcpServer({ apiUrl: url, draftTools, ...(apiKey ? { apiKey } : {}) });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '1.0.0' });
    connections.push(client);
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return {
      client,
      call: (name: string, args: Record<string, unknown>) =>
        client.callTool({ name, arguments: args }) as Promise<CallToolResult>,
    };
  }

  it('makes only draft capabilities available through the explicit opt-in', async () => {
    const ordinary = await connect(undefined, false);
    const enabled = await connect();
    const defaults = (await ordinary.client.listTools()).tools.map((tool) => tool.name);
    const actual = (await enabled.client.listTools()).tools;
    expect(defaults).toContain('start_run');
    expect(actual.map((tool) => tool.name).sort()).toEqual([...defaults, ...draftNames].sort());
    expect(
      actual.find((tool) => tool.name === 'validate_loop_definition')?.annotations?.readOnlyHint,
    ).toBe(true);
    expect(actual.find((tool) => tool.name === 'save_loop_draft')?.annotations?.readOnlyHint).toBe(
      false,
    );
  });

  it('creates, validates and saves an unpublished draft, refusing stale and wildcard tokens', async () => {
    const author = await connect(ownerToken);
    const client = createGraphGoblinClient({ baseUrl: url, apiKey: ownerToken });
    const original = { ...minimalLoop(), name: 'MCP original' };
    const created = await author.call('create_loop_draft', { definition: original });
    expect(created.isError).toBeFalsy();
    expect(created.structuredContent).toMatchObject({ draft: { status: 'draft' }, issues: [] });
    const { id } = (created.structuredContent?.loop ?? {}) as { id: string };

    const read = await author.call('get_loop_draft', { loopId: id });
    const draftToken = read.structuredContent?.draftToken;
    expect(draftToken).toMatch(/^[0-9a-f]{16}$/);
    const definition = { ...original, name: 'MCP workflow updated' };
    const validate = await author.call('validate_loop_definition', { loopId: id, definition });
    expect(validate.structuredContent).toEqual({ issues: [], publishable: true });
    expect((await loops.get(client, id)).draft?.definition.name).toBe(original.name);

    const saved = await author.call('save_loop_draft', { loopId: id, definition, draftToken });
    expect(saved.structuredContent).toMatchObject({
      draft: { definition: { name: definition.name } },
    });
    const third = { ...definition, name: 'Would overwrite' };
    expect(
      errorText(
        await author.call('save_loop_draft', { loopId: id, definition: third, draftToken }),
      ),
    ).toContain('DRAFT_CONFLICT');
    for (const invalid of [undefined, '*', '%22bad%22, *']) {
      expect(
        errorText(
          await author.call('save_loop_draft', {
            loopId: id,
            definition: third,
            draftToken: invalid,
          }),
        ),
      ).toContain('draftToken');
    }
    const detail = await loops.get(client, id);
    expect(detail.draft?.definition.name).toBe(definition.name);
    expect(detail.current).toBeUndefined();
    expect((await author.call('list_runs', { loopId: id })).structuredContent?.items).toEqual([]);
  });

  it('preserves gateway validation, authorization, and owner isolation', async () => {
    const author = await connect(ownerToken);
    const invalid = await author.call('create_loop_draft', { definition: { name: 'Malformed' } });
    expect(errorText(invalid)).toContain('VALIDATION_FAILED (HTTP 400)');
    expect(errorText(invalid)).toContain('schemaVersion');

    const valid = { ...minimalLoop(), name: 'MCP access control' };
    const badEdges = { ...valid, edges: [] };
    const structural = await author.call('create_loop_draft', { definition: badEdges });
    const { id } = (structural.structuredContent?.loop ?? {}) as { id: string };
    expect(structural.structuredContent).toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ severity: 'error' })]),
    });
    const reader = await connect(readerToken);
    expect(
      (await reader.call('validate_loop_definition', { loopId: id, definition: badEdges }))
        .structuredContent,
    ).toMatchObject({ publishable: false });
    const read = await reader.call('get_loop_draft', { loopId: id });
    expect(
      errorText(
        await reader.call('save_loop_draft', {
          loopId: id,
          definition: valid,
          draftToken: read.structuredContent?.draftToken,
        }),
      ),
    ).toContain('key lacks the "loops:write" scope');
    expect(errorText(await reader.call('create_loop_draft', { definition: {} }))).toContain(
      'FORBIDDEN (HTTP 403)',
    );

    for (const key of [undefined, 'invalid-token']) {
      const unauthorized = await connect(key);
      expect(errorText(await unauthorized.call('create_loop_draft', { definition: {} }))).toContain(
        'UNAUTHORIZED (HTTP 401)',
      );
    }
    const other = await connect(otherToken);
    expect(errorText(await other.call('get_loop_draft', { loopId: id }))).toContain(
      'LOOP_NOT_FOUND',
    );
    expect(
      errorText(await reader.call('get_loop_draft', { loopId: fakeUlid('absent') })),
    ).toContain('LOOP_NOT_FOUND');
  });
});

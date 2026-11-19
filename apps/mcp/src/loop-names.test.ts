/** Public MCP identity behavior over real owner-scoped API data; no provider is invoked. */
import { createTestApp, type TestApp } from '@graphgoblin/api/testing';
import { fakeUlid, minimalLoop } from '@graphgoblin/contracts/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMcpServer, type CreateServerOptions } from './index.js';

const connections: { client: Client; server: ReturnType<typeof createMcpServer> }[] = [];
async function connect(options: CreateServerOptions) {
  const server = createMcpServer(options);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'loop-name-regression', version: '1' });
  connections.push({ client, server });
  await server.connect(serverSide);
  await client.connect(clientSide);
  return {
    client,
    call: (name: string, loopId: string) =>
      client.callTool({ name, arguments: { loopId } }) as Promise<CallToolResult>,
  };
}

function errorText(result: CallToolResult): string {
  expect(result.isError).toBe(true);
  const [content] = result.content;
  expect(content?.type).toBe('text');
  return content?.type === 'text' ? content.text : '';
}

afterAll(async () => {
  for (const { client, server } of connections) {
    await client.close();
    await server.close();
  }
});

describe('loop lookup against the real API', () => {
  let api: TestApp;
  let apiUrl: string;
  let apiKey: string;
  let ids: Record<string, string>;
  const fallbackName = fakeUlid('unallocated-name-id');

  beforeAll(async () => {
    api = await createTestApp({ requireApiKey: true });
    apiUrl = await api.app.listen({ host: '127.0.0.1', port: 0 });
    apiKey = (await api.container.repos.apiKeys.create('local', 'owner', ['*'])).token;
    const other = (await api.container.repos.apiKeys.create('other', 'other owner', ['*'])).token;
    const publish = (name: string, token = apiKey) =>
      api.publishLoop({ ...minimalLoop(), name }, { authorization: `Bearer ${token}` });
    const ordinary = await publish('Ordinary name');
    ids = {
      ordinary,
      padded: await publish('  Padded name  '),
      repeated: await publish('Repeated \t  Words'),
      idName: await publish(ordinary),
      fallback: await publish(fallbackName),
      composed: await publish('Écho'),
      decomposed: await publish('E\u0301cho'),
      sharp: await publish('Straße'),
      folded: await publish('STRASSE'),
      foreign: await publish('Other owner only', other),
    };
    // An equivalent name in another owner's store must neither match nor cause ambiguity.
    await publish(' padded name ', other);
  });

  afterAll(async () => {
    await api.idle();
    await api.close();
  });

  describe.each([false, true])('draft tools enabled: %s', (draftTools) => {
    it.each(['describe_loop', 'start_run'])(
      '%s uses the owner naming rule while keeping exact ID priority',
      async (tool) => {
        const { call } = await connect({ apiUrl, apiKey, draftTools });
        const cases = [
          ['Ordinary name', ids['ordinary']],
          [ids['ordinary']!, ids['ordinary']],
          [ids['padded']!, ids['padded']],
          ['padded name', ids['padded']],
          [' \tPADDED name\n', ids['padded']],
          ['repeated words', ids['repeated']],
          [' REPEATED\n\tWORDS ', ids['repeated']],
          [fallbackName, ids['fallback']],
          ['éCHO', ids['composed']],
          ['e\u0301CHO', ids['decomposed']],
          ['straße', ids['sharp']],
          ['strasse', ids['folded']],
        ];
        for (const [ref, id] of cases) {
          const result = await call(tool, ref!);
          expect(result.isError, JSON.stringify({ tool, ref, result })).not.toBe(true);
          const data = result.structuredContent as { loop: { id: string }; loopId: string };
          expect(tool === 'describe_loop' ? data.loop.id : data.loopId).toBe(id);
        }
        for (const ref of ['missing name', 'Other owner only', ids['foreign']!]) {
          expect(errorText(await call(tool, ref))).toMatch(/^LOOP_NOT_FOUND: .*list_loops/s);
        }
      },
    );

    it('advertises the name policy and exact ID precedence to both tool callers', async () => {
      const { client } = await connect({ apiUrl, apiKey, draftTools });
      const { tools } = await client.listTools();
      for (const name of ['describe_loop', 'start_run']) {
        const tool = tools.find((tool) => tool.name === name)!;
        const schema = tool.inputSchema.properties?.['loopId'] as { description: string };
        expect(schema.description).toMatch(/whitespace runs collapsed/);
        expect(schema.description).toMatch(/case-insensitive/);
        expect(schema.description).toMatch(/exact id takes priority/i);
        expect(schema.description).toMatch(/no Unicode normalization or full case folding/);
      }
    });
  });

  it('preserves authentication and scope failures for both ID and name lookup', async () => {
    const limitedKey = (
      await api.container.repos.apiKeys.create('local', 'run only', ['runs:write'])
    ).token;
    for (const [key, code] of [
      [undefined, 'UNAUTHORIZED'],
      [limitedKey, 'FORBIDDEN'],
    ] as const) {
      const { call } = await connect({ apiUrl, ...(key ? { apiKey: key } : {}) });
      for (const ref of [ids['ordinary']!, 'Ordinary name']) {
        expect(errorText(await call('describe_loop', ref))).toMatch(
          new RegExp(`^GraphGoblin API error ${code} \\(HTTP 40[13]\\)`),
        );
      }
    }
  });
});

describe('controlled inconsistent upstream and failure defenses', () => {
  it.each(['describe_loop', 'start_run'])('%s refuses equivalent ambiguous names', async (tool) => {
    const seen: string[] = [];
    const ids = [fakeUlid('twin-one'), fakeUlid('twin-two')];
    const { call } = await connect({
      apiUrl: 'http://controlled-upstream.test',
      fetch: (request) => {
        seen.push(`${request.method} ${new URL(request.url).pathname}`);
        return Promise.resolve(
          Response.json({
            items: [
              { id: ids[0], name: ' \tTwin  Board ' },
              { id: ids[1], name: 'twin\nboard' },
            ],
          }),
        );
      },
    });
    const text = errorText(await call(tool, ' TWIN board '));
    expect(text).toMatch(/^AMBIGUOUS_LOOP_NAME: 2 loops/);
    expect(text).toContain(ids[0]);
    expect(text).toContain(ids[1]);
    expect(text).toContain('pass the loop id instead');
    expect(seen).toEqual(['GET /loops']);
  });

  it.each([
    [503, 'UNAVAILABLE'],
    [409, 'LOOP_UPGRADE_REQUIRED'],
    [404, 'DIFFERENT_NOT_FOUND'],
  ] as const)('preserves HTTP %s %s instead of falling back to names', async (status, code) => {
    const id = fakeUlid('failed-exact-id');
    const seen: string[] = [];
    const { call } = await connect({
      apiUrl: 'http://controlled-upstream.test',
      fetch: (request) => {
        seen.push(`${request.method} ${new URL(request.url).pathname}`);
        return Promise.resolve(
          Response.json({ status, code, detail: 'Original failure' }, { status }),
        );
      },
    });
    expect(errorText(await call('describe_loop', id))).toContain(
      `GraphGoblin API error ${code} (HTTP ${status}): Original failure`,
    );
    expect(seen).toEqual([`GET /loops/${id}`]);
  });
});

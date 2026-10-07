import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { GraphGoblinApiError } from '@graphgoblin/api-client';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { kitchenSinkLoop } from '@graphgoblin/contracts/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  ConfigError,
  createGatewayClient,
  createMcpServer,
  describeDefinition,
  describeLoop,
  summarizeRun,
  DEFAULT_API_URL,
  describeError,
  isEntryPoint,
  loadConfig,
  McpToolError,
  ok,
  toolError,
} from './index.js';

describe('loadConfig', () => {
  it('uses defaults', () => {
    expect(loadConfig([], {})).toEqual({
      apiUrl: DEFAULT_API_URL,
      transport: 'stdio',
      host: '127.0.0.1',
      port: 4748,
      help: false,
    });
  });

  it('reads the environment', () => {
    expect(
      loadConfig([], {
        GG_API_URL: 'https://gg.example/',
        GG_API_KEY: 'k1',
        GG_MCP_PORT: '9000',
        GG_MCP_HOST: '0.0.0.0',
      }),
    ).toMatchObject({ apiUrl: 'https://gg.example', apiKey: 'k1', port: 9000, host: '0.0.0.0' });
    expect(loadConfig([], { GG_API_KEY: '' })).not.toHaveProperty('apiKey');
  });

  it('lets flags override the environment', () => {
    expect(
      loadConfig(
        [
          '--api-url',
          'http://h:1',
          '--api-key',
          'k2',
          '--http',
          '--port',
          '0',
          '--host',
          '::1',
          '-h',
        ],
        { GG_API_URL: 'http://ignored', GG_API_KEY: 'ignored', GG_MCP_PORT: '5' },
      ),
    ).toEqual({
      apiUrl: 'http://h:1',
      apiKey: 'k2',
      transport: 'http',
      host: '::1',
      port: 0,
      help: true,
    });
  });

  it('rejects bad flags, ports, and URLs', () => {
    expect(() => loadConfig(['--nope'], {})).toThrow(ConfigError);
    expect(() => loadConfig(['extra'], {})).toThrow(ConfigError);
    expect(() => loadConfig(['--port', 'x'], {})).toThrow(/invalid port "x"/);
    expect(() => loadConfig([], { GG_MCP_PORT: '70000' })).toThrow(/invalid port/);
    expect(() => loadConfig(['--api-url', 'not a url'], {})).toThrow(/invalid API URL/);
    expect(() => loadConfig(['--api-url', 'ftp://x'], {})).toThrow(/expected http or https/);
  });
});

describe('tool results', () => {
  it('returns JSON text and structured content for objects only', () => {
    expect(ok({ a: 1 })).toEqual({
      content: [{ type: 'text', text: '{\n  "a": 1\n}' }],
      structuredContent: { a: 1 },
    });
    expect(ok([1])).not.toHaveProperty('structuredContent');
    expect(ok(null)).not.toHaveProperty('structuredContent');
  });

  it('describes every kind of failure with a code first', () => {
    expect(
      describeError(
        new GraphGoblinApiError({
          status: 400,
          code: 'VALIDATION_FAILED',
          detail: 'bad',
          errors: [{ path: 'input' }],
        }),
      ),
    ).toBe(
      'GraphGoblin API error VALIDATION_FAILED (HTTP 400): bad\nerrors: [\n  {\n    "path": "input"\n  }\n]',
    );
    expect(describeError(new GraphGoblinApiError({ status: 503, code: 'HTTP_503' }))).toBe(
      'GraphGoblin API error HTTP_503 (HTTP 503)',
    );
    expect(describeError(new McpToolError('LOOP_NOT_FOUND', 'gone'))).toBe('LOOP_NOT_FOUND: gone');
    expect(describeError(new Error('boom'))).toBe('INTERNAL_ERROR: boom');
    expect(describeError('odd')).toBe('INTERNAL_ERROR: odd');
    expect(toolError(new Error('x'))).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'INTERNAL_ERROR: x' }],
    });
  });

  it('reports an unreachable gateway as NETWORK_ERROR', () => {
    const error = GraphGoblinApiError.network(new Error('ECONNREFUSED'));
    expect(describeError(error)).toBe('GraphGoblin API error NETWORK_ERROR (HTTP 0): ECONNREFUSED');
  });
});

describe('gateway client', () => {
  it('identifies itself as the MCP client and sends the key', async () => {
    const seen: Request[] = [];
    const client = createGatewayClient({
      apiUrl: 'http://gw.test',
      apiKey: 'secret',
      fetch: (request) => {
        seen.push(request);
        return Promise.resolve(Response.json({ items: [] }));
      },
    });
    await client.GET('/loops');
    expect(seen[0]?.headers.get('x-graphgoblin-client')).toBe('mcp');
    expect(seen[0]?.headers.get('authorization')).toBe('Bearer secret');
    expect(createGatewayClient({ client })).toBe(client);
  });
});

describe('isEntryPoint', () => {
  it('compares real paths', () => {
    const here = import.meta.url;
    expect(isEntryPoint(fileURLToPath(here), here)).toBe(true);
    expect(isEntryPoint(undefined, here)).toBe(false);
    expect(isEntryPoint('/definitely/not/here.js', here)).toBe(false);
  });
});

describe('describe helpers', () => {
  it('describes every trigger subtype, waits, and exits of the kitchen-sink loop', () => {
    const definition = LoopDefinitionSchema.parse(kitchenSinkLoop());
    const described = describeDefinition(definition);
    expect(described.nodeKinds.length).toBe(9);
    expect(described.triggers.find((tr) => tr.subtype === 'cron')).toEqual({
      nodeId: 'nightly',
      label: 'Nightly',
      subtype: 'cron',
    });
    expect(described.triggers.find((tr) => tr.subtype === 'manual')).not.toHaveProperty(
      'inputSchema',
    );
    expect(described.exits.length).toBeGreaterThan(0);
  });

  it('reports wait nodes without an input schema and loops without versions', () => {
    const definition = LoopDefinitionSchema.parse({
      schemaVersion: 2,
      name: 'w',
      nodes: [
        { id: 'start', kind: 'trigger', label: 'S', config: { subtype: 'manual' } },
        { id: 'ask', kind: 'wait', label: 'A', config: { mode: 'input', prompt: 'p' } },
        { id: 'nap', kind: 'wait', label: 'N', config: { mode: 'duration', seconds: 1 } },
        { id: 'done', kind: 'exit', label: 'D', config: {} },
      ],
      edges: [],
    });
    expect(describeDefinition(definition).inputWaits).toEqual([
      { nodeId: 'ask', label: 'A', prompt: 'p' },
    ]);
    const loop = {
      id: '01J00000000000000000000000',
      ownerId: 'local',
      name: 'empty',
      createdAt: '2026-10-02T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
    };
    expect(describeLoop({ loop })).toEqual({
      loop: {
        id: loop.id,
        name: 'empty',
        published: false,
        hasDraft: false,
        updatedAt: loop.updatedAt,
      },
      version: null,
      note: expect.stringContaining('no published version'),
    });
  });

  it('summarises failed child runs', () => {
    const run = {
      id: '01J00000000000000000000001',
      ownerId: 'local',
      loopId: '01J00000000000000000000000',
      versionId: '01J00000000000000000000002',
      parentRunId: '01J00000000000000000000003',
      invocationId: '01J00000000000000000000004',
      status: 'failed',
      iteration: 1,
      failure: { code: 'INTERNAL_ERROR', message: 'x', resumable: false, details: { big: true } },
      createdAt: '2026-10-02T00:00:00.000Z',
      lastEventSeq: 3,
    } as const;
    expect(summarizeRun(run)).toEqual({
      id: run.id,
      loopId: run.loopId,
      status: 'failed',
      iteration: 1,
      failure: { code: 'INTERNAL_ERROR', message: 'x' },
      parentRunId: run.parentRunId,
      createdAt: run.createdAt,
    });
  });
});

describe('gateway failures', () => {
  it('surfaces an unreachable gateway as a NETWORK_ERROR tool error', async () => {
    const server = createMcpServer({
      apiUrl: 'http://gw.test',
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    const client = new Client({ name: 'n', version: '1' });
    await client.connect(a);
    const result = await client.callTool({ name: 'describe_loop', arguments: { loopId: 'x' } });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0]?.text).toBe(
      'GraphGoblin API error NETWORK_ERROR (HTTP 0): fetch failed',
    );
    await client.close();
  });
});

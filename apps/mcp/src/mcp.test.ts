/**
 * End-to-end tests: an MCP client connected over the SDK's in-memory transport to the server,
 * which calls the real API booted in-process (in-memory database, fake harness) on an ephemeral port.
 */
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { createTestApp, type TestApp } from '@graphgoblin/api/testing';
import { createGraphGoblinClient } from '@graphgoblin/api-client';
import { createMcpServer, readAllEvents } from './index.js';

const TOOLS = [
  'list_loops',
  'describe_loop',
  'start_run',
  'wait_for_run',
  'get_run',
  'get_run_thread',
  'list_runs',
  'read_run_events',
  'cancel_run',
  'pause_run',
  'resume_run',
  'provide_input',
  'send_signal',
];

const inputLoop: LoopDefinitionInput = {
  schemaVersion: 1,
  name: 'Ask Me',
  description: 'Asks a question and returns the answer.',
  nodes: [
    {
      id: 'start',
      kind: 'trigger',
      label: 'Start',
      config: {
        subtype: 'manual',
        inputSchema: { type: 'object', properties: { topic: { type: 'string' } } },
      },
    },
    {
      id: 'ask',
      kind: 'wait',
      label: 'Ask',
      config: { mode: 'input', prompt: 'Proceed?', inputSchema: { type: 'boolean' } },
    },
    {
      id: 'done',
      kind: 'exit',
      label: 'Done',
      config: { return: { mapping: '$.lastOutput' } },
    },
  ],
  edges: [
    { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'ask' } },
    { id: 'e2', from: { node: 'ask', port: 'out' }, to: { node: 'done' } },
  ],
};

const signalLoop: LoopDefinitionInput = {
  schemaVersion: 1,
  name: 'signal-wait',
  nodes: [
    { id: 'start', kind: 'trigger', label: 'S', config: { subtype: 'manual', exposeTo: ['ui'] } },
    { id: 'hold', kind: 'wait', label: 'Hold', config: { mode: 'signal', name: 'go' } },
    { id: 'done', kind: 'exit', label: 'D', config: {} },
  ],
  edges: [
    { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'hold' } },
    { id: 'e2', from: { node: 'hold', port: 'out' }, to: { node: 'done' } },
  ],
};

const slowLoop: LoopDefinitionInput = {
  schemaVersion: 1,
  name: 'slow-inference',
  nodes: [
    { id: 'start', kind: 'trigger', label: 'S', config: { subtype: 'manual' } },
    { id: 'think', kind: 'inference', label: 'T', config: { prompt: { template: 'think' } } },
    { id: 'done', kind: 'exit', label: 'D', config: {} },
  ],
  edges: [
    { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'think' } },
    { id: 'e2', from: { node: 'think', port: 'out' }, to: { node: 'done' } },
  ],
};

function text(result: unknown): string {
  const content = (result as CallToolResult).content[0];
  if (content?.type !== 'text') throw new Error('expected text content');
  return content.text;
}

function body<T = any>(result: unknown): T {
  expect((result as CallToolResult).isError, text(result)).toBeFalsy();
  return JSON.parse(text(result)) as T;
}

async function until(predicate: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('MCP server against the in-process API', () => {
  let t: TestApp;
  let baseUrl: string;
  let client: Client;
  const call = (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: args });
  const status = async (runId: string): Promise<string> =>
    body(await call('get_run', { runId })).status as string;

  beforeAll(async () => {
    t = await createTestApp();
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
    const server = createMcpServer({ apiUrl: baseUrl, pollMs: 10 });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientSide);
  });
  afterAll(async () => {
    await client.close();
    await t.close();
  });

  it('advertises every tool with an agent-facing description and an input schema', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...TOOLS].sort());
    for (const tool of tools) {
      expect(tool.description?.length).toBeGreaterThan(60);
      expect(tool.inputSchema.type).toBe('object');
    }
    expect(client.getInstructions()).toContain('wait_for_run');
  });

  it('lists and describes loops by id and by name', async () => {
    const askId = await t.publishLoop(inputLoop);
    const all = body(await call('list_loops')).items as { id: string; name: string }[];
    expect(all.map((l) => l.id)).toContain(askId);
    const filtered = body(await call('list_loops', { query: 'returns the ANSWER' })).items;
    expect(filtered).toEqual([
      expect.objectContaining({ id: askId, name: 'Ask Me', published: true, hasDraft: false }),
    ]);
    expect(body(await call('list_loops', { query: 'ask' })).items).toHaveLength(1);
    await t.publishLoop({ ...minimalLoop(), name: 'plain' });
    expect(body(await call('list_loops', { query: 'zzz' })).items).toEqual([]);

    const described = body(await call('describe_loop', { loopId: 'ask me' }));
    expect(described.loop.id).toBe(askId);
    expect(described.version).toMatchObject({ number: 1, status: 'published' });
    expect(described.note).toBeUndefined();
    expect(described.triggers).toEqual([
      {
        nodeId: 'start',
        label: 'Start',
        subtype: 'manual',
        startableFromMcp: true,
        inputSchema: { type: 'object', properties: { topic: { type: 'string' } } },
      },
    ]);
    expect(described.inputWaits).toEqual([
      { nodeId: 'ask', label: 'Ask', prompt: 'Proceed?', inputSchema: { type: 'boolean' } },
    ]);
    expect(described.exits).toEqual([
      {
        nodeId: 'done',
        label: 'Done',
        default: 'success',
        returnMapping: '$.lastOutput',
        returnChannels: ['caller'],
      },
    ]);
    expect(body(await call('describe_loop', { loopId: askId })).loop.name).toBe('Ask Me');
  });

  it('describes a draft-only loop and maps lookup failures to coded tool errors', async () => {
    const created = await t.app.inject({
      method: 'POST',
      url: '/loops',
      payload: { definition: { ...minimalLoop(), name: 'draft-only' } },
    });
    const draftId = created.json<{ loop: { id: string } }>().loop.id;
    const described = body(await call('describe_loop', { loopId: draftId }));
    expect(described.version.status).toBe('draft');
    expect(described.note).toMatch(/allowDraft/);

    const missing = await call('describe_loop', { loopId: 'no-such-loop' });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toMatch(/^LOOP_NOT_FOUND: .*list_loops/);

    await t.publishLoop({ ...minimalLoop(), name: 'twin' });
    await t.publishLoop({ ...minimalLoop(), name: 'Twin' });
    const ambiguous = await call('start_run', { loopId: 'twin' });
    expect(ambiguous.isError).toBe(true);
    expect(text(ambiguous)).toMatch(/^AMBIGUOUS_LOOP_NAME: 2 loops/);

    const unpublished = await call('start_run', { loopId: draftId });
    expect(unpublished.isError).toBe(true);
    expect(text(unpublished)).toMatch(/^GraphGoblin API error [A-Z_]+ \(HTTP 4\d\d\)/);
    const fromDraft = body(await call('start_run', { loopId: draftId, allowDraft: true }));
    const done = body(await call('wait_for_run', { runId: fromDraft.runId, timeoutSeconds: 5 }));
    expect(done).toMatchObject({ finished: true, run: { status: 'succeeded' } });
  });

  it('starts a run, waits for it, and records the manual.mcp source', async () => {
    const loopId = await t.publishLoop({ ...minimalLoop(), name: 'quick' });
    const started = body(
      await call('start_run', { loopId, input: { topic: 'x' }, triggerNodeId: 'start' }),
    );
    expect(started).toMatchObject({ loopId, next: expect.stringContaining('wait_for_run') });
    const done = body(await call('wait_for_run', { runId: started.runId }));
    expect(done.finished).toBe(true);
    expect(done.run).toMatchObject({ id: started.runId, status: 'succeeded' });

    const thread = body(await call('get_run_thread', { runId: started.runId }));
    expect(thread.invocation.source).toBe('manual.mcp');
    expect(body(await call('get_run', { runId: started.runId })).status).toBe('succeeded');

    const page = body(await call('read_run_events', { runId: started.runId, limit: 2 }));
    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    const rest = body(
      await call('read_run_events', { runId: started.runId, after: page.nextAfter }),
    );
    expect(rest.hasMore).toBe(false);
    expect((rest.items as { type: string }[]).at(-1)?.type).toBe('run.finished');

    const runs = body(await call('list_runs', { loopId }));
    expect((runs.items as { id: string }[]).map((r) => r.id)).toEqual([started.runId]);
    expect(runs.nextBefore).toBeUndefined();
    const everything = body(await call('list_runs'));
    expect((everything.items as { id: string }[]).map((r) => r.id)).toContain(started.runId);
  });

  it('times out with a cursor while a run is busy, reports progress, then succeeds', async () => {
    t.harness.script([{ finalText: 'pondered', delayMs: 400 }]);
    const loopId = await t.publishLoop(slowLoop);
    const { runId } = body(await call('start_run', { loopId }));
    const pending = body(await call('wait_for_run', { runId, timeoutSeconds: 0 }));
    expect(pending).toMatchObject({ finished: false, cursor: expect.any(Number) });
    expect(['queued', 'running']).toContain(pending.status);
    expect(pending.next).toMatch(/call wait_for_run again/i);

    const progress: number[] = [];
    const done = await client.callTool({ name: 'wait_for_run', arguments: { runId } }, undefined, {
      onprogress: (p) => progress.push(p.progress),
    });
    expect(body(done)).toMatchObject({ finished: true, run: { status: 'succeeded' } });
    expect(progress.length).toBeGreaterThan(0);
  });

  it('returns early for input, and drives input, signals, pause, resume, and cancel', async () => {
    const askId = await t.publishLoop({ ...inputLoop, name: 'ask-2' });
    const { runId } = body(await call('start_run', { loopId: askId, input: { topic: 'y' } }));
    const waiting = body(await call('wait_for_run', { runId, timeoutSeconds: 30 }));
    expect(waiting).toMatchObject({
      finished: false,
      status: 'waiting',
      currentNodeId: 'ask',
      waiting: { kind: 'input', prompt: 'Proceed?' },
    });
    expect(waiting.next).toMatch(/provide_input/);
    const answered = body(await call('provide_input', { runId, input: true }));
    expect(answered.id).toBe(runId);
    const finished = body(await call('wait_for_run', { runId, timeoutSeconds: 5 }));
    expect(finished.run).toMatchObject({ status: 'succeeded', result: { value: true } });

    const again = await call('provide_input', { runId, input: false });
    expect(again.isError).toBe(true);
    expect(text(again)).toMatch(/^GraphGoblin API error [A-Z_]+ \(HTTP 409\)/);

    const signalId = await t.publishLoop(signalLoop);
    const described = body(await call('describe_loop', { loopId: signalId }));
    expect(described.triggers[0]).toMatchObject({ startableFromMcp: false });
    const held = body(await call('start_run', { loopId: signalId })).runId as string;
    await until(async () => (await status(held)) === 'waiting');
    const notYet = body(await call('wait_for_run', { runId: held, timeoutSeconds: 0 }));
    expect(notYet.next).toMatch(/signal "go"/);
    expect(body(await call('send_signal', { runId: held, name: 'other' })).woke).toBe(false);
    const sent = body(await call('send_signal', { runId: held, name: 'go', payload: { n: 1 } }));
    expect(sent.woke).toBe(true);
    expect(body(await call('wait_for_run', { runId: held })).run.status).toBe('succeeded');

    const second = body(await call('start_run', { loopId: signalId })).runId as string;
    await until(async () => (await status(second)) === 'waiting');
    expect(body(await call('pause_run', { runId: second })).status).toBe('paused');
    const paused = body(await call('wait_for_run', { runId: second, timeoutSeconds: 30 }));
    expect(paused).toMatchObject({ finished: false, status: 'paused' });
    expect(paused.next).toMatch(/resume_run/);
    expect(body(await call('resume_run', { runId: second })).status).toBe('running');
    await until(async () => (await status(second)) === 'waiting');
    await call('cancel_run', { runId: second });
    expect(body(await call('wait_for_run', { runId: second })).run.status).toBe('cancelled');

    const page = body(await call('list_runs', { loopId: signalId, limit: 1 }));
    expect(page.items).toHaveLength(1);
    expect(page.nextBefore).toBe(page.items[0].createdAt);
    const next = body(
      await call('list_runs', {
        loopId: signalId,
        status: ['succeeded', 'cancelled'],
        parentRunId: 'none',
        before: page.nextBefore,
        limit: 1,
      }),
    );
    // The fake clock gives every run the same creation time, so nothing is strictly before it.
    expect(next.items).toEqual([]);
    const filtered = body(
      await call('list_runs', { loopId: signalId, status: ['cancelled'], parentRunId: 'none' }),
    );
    expect((filtered.items as { id: string }[]).map((r) => r.id)).toEqual([second]);
  });

  it('maps API problem details onto tool errors with the code preserved', async () => {
    for (const name of [
      'get_run',
      'get_run_thread',
      'read_run_events',
      'cancel_run',
      'pause_run',
      'resume_run',
      'wait_for_run',
    ]) {
      const result = await call(name, { runId: 'missing' });
      expect(result.isError, name).toBe(true);
      expect(text(result)).toBe(
        'GraphGoblin API error RUN_NOT_FOUND (HTTP 404): run missing not found',
      );
    }
    const signal = await call('send_signal', { runId: 'missing', name: 'go' });
    expect(text(signal)).toContain('RUN_NOT_FOUND');
    const input = await call('provide_input', { runId: 'missing', input: 1 });
    expect(text(input)).toContain('RUN_NOT_FOUND');

    const invalid = await call('list_runs', { limit: 0 });
    expect(invalid.isError).toBe(true);
  });

  it('serves run events and threads as resources', async () => {
    const loopId = await t.publishLoop({ ...minimalLoop(), name: 'resourceful' });
    const { runId } = body(await call('start_run', { loopId }));
    body(await call('wait_for_run', { runId }));

    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((r) => r.uriTemplate).sort()).toEqual([
      'graphgoblin://runs/{id}/events',
      'graphgoblin://runs/{id}/thread',
    ]);
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual(
      expect.arrayContaining([
        `graphgoblin://runs/${runId}/events`,
        `graphgoblin://runs/${runId}/thread`,
      ]),
    );

    const events = await client.readResource({ uri: `graphgoblin://runs/${runId}/events` });
    const log = JSON.parse((events.contents[0] as { text: string }).text);
    expect(log).toMatchObject({ runId, truncated: false });
    expect((log.items as { type: string }[]).at(-1)?.type).toBe('run.finished');

    const thread = await client.readResource({ uri: `graphgoblin://runs/${runId}/thread` });
    expect(thread.contents[0]?.mimeType).toBe('application/json');
    expect(JSON.parse((thread.contents[0] as { text: string }).text).run.id).toBe(runId);

    await expect(client.readResource({ uri: 'graphgoblin://runs/missing/thread' })).rejects.toThrow(
      /RUN_NOT_FOUND/,
    );

    const api = createGraphGoblinClient({ baseUrl });
    const paged = await readAllEvents(api, runId, 2, 3);
    expect(paged.items.length).toBe(4);
    expect(paged.truncated).toBe(true);
    const whole = await readAllEvents(api, runId, 2);
    expect(whole.items).toEqual(log.items);
  });
});

describe('MCP server with API keys', () => {
  it('sends the configured key and reports UNAUTHORIZED without it', async () => {
    const t = await createTestApp({ requireApiKey: true });
    try {
      await t.app.listen({ port: 0, host: '127.0.0.1' });
      const apiUrl = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
      const { token } = await t.container.repos.apiKeys.create('local', 'mcp', ['*']);
      const connect = async (apiKey?: string) => {
        const server = createMcpServer({ apiUrl, ...(apiKey ? { apiKey } : {}) });
        const [a, b] = InMemoryTransport.createLinkedPair();
        await server.connect(b);
        const c = new Client({ name: 'k', version: '1' });
        await c.connect(a);
        return c;
      };
      const anonymous = await connect();
      const denied = await anonymous.callTool({ name: 'list_loops', arguments: {} });
      expect(text(denied)).toMatch(/^GraphGoblin API error UNAUTHORIZED \(HTTP 401\)/);
      const keyed = await connect(token);
      expect(body(await keyed.callTool({ name: 'list_loops', arguments: {} })).items).toEqual([]);
      await anonymous.close();
      await keyed.close();
    } finally {
      await t.close();
    }
  });
});

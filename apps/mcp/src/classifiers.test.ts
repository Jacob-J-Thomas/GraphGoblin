import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { LoopDefinitionInput, RunEvent } from '@graphgoblin/contracts';
import { createTestApp, startFakeClassifierEndpoint, type TestApp } from '@graphgoblin/api/testing';
import { classifierModels, createGraphGoblinClient, loops } from '@graphgoblin/api-client';
import { createMcpServer, toolError } from './index.js';

function definition(model?: string): LoopDefinitionInput {
  return {
    schemaVersion: 1,
    name: `MCP classifier ${model ?? 'default'}`,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } },
      {
        id: 'choose',
        kind: 'decision',
        label: 'Choose',
        config: {
          question: 'Choose a route',
          routes: [
            { label: 'yes', description: 'Ready' },
            { label: 'no', description: 'Wait' },
          ],
          strategy: ['jev', 'expression'],
          expression: { jsonata: '"no"' },
          ...(model ? { jev: { model } } : {}),
        },
      },
      {
        id: 'done',
        kind: 'exit',
        label: 'Done',
        config: { return: { mapping: 'lastOutput.value.route' } },
      },
    ],
    edges: [
      { id: 'start-choose', from: { node: 'start', port: 'out' }, to: { node: 'choose' } },
      ...['yes', 'no'].map((port) => ({
        id: `choose-${port}`,
        from: { node: 'choose', port },
        to: { node: 'done' },
      })),
    ],
  };
}
function output<T>(result: unknown): T {
  const parsed = CallToolResultSchema.parse(result);
  expect(parsed.isError).toBeFalsy();
  const content = parsed.content[0];
  if (content?.type !== 'text') throw new Error('Expected MCP text');
  return JSON.parse(content.text) as T;
}

describe('MCP classifier consumer regression', () => {
  let app: TestApp;
  let endpoint: Awaited<ReturnType<typeof startFakeClassifierEndpoint>>;
  let mcp: Client;
  let api: ReturnType<typeof createGraphGoblinClient>;
  beforeAll(async () => {
    app = await createTestApp({ realClassifiers: true });
    endpoint = await startFakeClassifierEndpoint();
    const apiUrl = await app.app.listen({ host: '127.0.0.1', port: 0 });
    api = createGraphGoblinClient({ baseUrl: apiUrl });
    const server = createMcpServer({ apiUrl, pollMs: 10 });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    mcp = new Client({ name: 'classifier-test', version: '1.0.0' });
    await mcp.connect(clientSide);
  });
  afterAll(async () => {
    await mcp.close();
    await app.close();
    await endpoint.close();
  });
  it('runs and inspects omitted and explicit selections without adding tools', async () => {
    await classifierModels.upsert(api, 'mcp-kev', {
      displayName: 'Kev',
      provider: 'http',
      providerModel: 'native-kev',
      primitives: ['choice'],
      endpoint: endpoint.endpoint,
    });
    await classifierModels.setEnabled(api, 'mcp-kev', true);
    for (const model of [undefined, 'mcp-kev']) {
      const loopId = await app.publishLoop(definition(model));
      const started = output<{ runId: string }>(
        await mcp.callTool({ name: 'start_run', arguments: { loopId } }),
      );
      const done = output<{ finished: boolean; run: { status: string; result: unknown } }>(
        await mcp.callTool({
          name: 'wait_for_run',
          arguments: { runId: started.runId, timeoutSeconds: 5 },
        }),
      );
      expect(done).toMatchObject({
        finished: true,
        run: { status: 'succeeded', result: model ? 'yes' : 'no' },
      });
      const events = output<{ items: RunEvent[] }>(
        await mcp.callTool({ name: 'read_run_events', arguments: { runId: started.runId } }),
      );
      const chosen = events.items.find((event) => event.type === 'decision.made');
      expect(chosen).toMatchObject({ strategy: model ? 'jev' : 'expression' });
      if (model) expect(chosen).toHaveProperty('classifierModel', model);
      else expect(chosen).not.toHaveProperty('classifierModel');
      expect(
        output<{ lastOutput: unknown }>(
          await mcp.callTool({ name: 'get_run_thread', arguments: { runId: started.runId } }),
        ).lastOutput,
      ).toBeDefined();
    }
    expect(endpoint.requests[0]?.body.model).toBe('native-kev');
    expect((await mcp.listTools()).tools.map((tool) => tool.name)).not.toContain(
      'classifier_models',
    );
  });
  it('preserves classifier validation messages through API-client and MCP errors', async () => {
    const created = await loops.create(api, definition('deleted-classifier'));
    try {
      await loops.publish(api, created.loop.id);
      throw new Error('Expected publish rejection');
    } catch (error) {
      const result = toolError(error);
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('CLASSIFIER_MODEL_NOT_FOUND'),
        }),
      ]);
      expect(JSON.stringify(result.content)).toContain('config.jev.model');
      expect(JSON.stringify(result.content)).toContain('Settings, Classifier models');
    }
  });
});

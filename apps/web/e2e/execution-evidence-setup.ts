import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { buildApp, createContainer, loadConfig } from '@graphgoblin/api';
import {
  CURRENT_DEFINITION_FORMAT,
  LoopVersionRecordSchema,
  RunRecordSchema,
  type LoopDefinitionInput,
} from '@graphgoblin/contracts';
import type { DeciderPort } from '@graphgoblin/engine';
import {
  CapturingLogger,
  FakeClock,
  FakeClassifier,
  FakeClassifierRegistry,
  FakeHarness,
  FakeStructured,
} from '@graphgoblin/engine/testing';

/** Public admission/control with built packages and physical SQLite; no live providers. */
export default async function setup() {
  const dataDir = await mkdtemp(join(tmpdir(), 'gg-wp-g1-255-'));
  const harness = new FakeHarness();
  const clock = new FakeClock();
  const classifier = new FakeClassifier('jev', (request) => ({
    type: 'choice',
    optionId: request.options[0]!.id,
    confidence: 0.8765432109876543,
    probabilities: { accept: 0.8765432109876543, reject: 0.1234567890123457 },
  }));
  const decider: DeciderPort = {
    id: 'codex',
    available: () => true,
    route: (request) =>
      Promise.resolve({
        route: request.routes[0]!.id,
        confidence: 0.9123456789012345,
        reasoning: 'Controlled LLM route evidence',
      }),
  };
  const container = await createContainer(
    loadConfig({
      GG_DATA_DIR: dataDir,
      GG_WEB_DIST: resolve('dist'),
      GG_SWAGGER_UI: 'false',
      GG_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
    }),
    {
      harnesses: { codex: harness },
      deciders: [decider],
      classifiers: new FakeClassifierRegistry(classifier),
      structured: new FakeStructured(),
      clock,
      logger: new CapturingLogger(),
      startTimers: false,
    },
  );
  await container.start();
  const app = await buildApp(container, { logger: false });
  const url = await app.listen({ host: '127.0.0.1', port: 6002 });
  async function api(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    payload?: unknown,
    headers?: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const response = await app.inject({
      method,
      url: path,
      ...(payload === undefined
        ? {}
        : {
            payload: JSON.stringify(payload),
            headers: { 'content-type': 'application/json', ...headers },
          }),
    });
    if (response.statusCode >= 400) throw new Error(method + ' ' + path + ': ' + response.body);
    return response.json<Record<string, unknown>>();
  }
  const startNode = {
    id: 'start',
    kind: 'trigger',
    label: 'Original start',
    config: { type: 'manual' },
  } as const;
  const done = { id: 'done', kind: 'exit', label: 'Original finish', config: {} } as const;
  const edge = (from: string, port: string, to: string) => ({
    id: from + '-' + port,
    from: { node: from, port },
    to: { node: to },
  });
  function workLoop(name: string): LoopDefinitionInput {
    return {
      schemaVersion: CURRENT_DEFINITION_FORMAT,
      name,
      nodes: [
        startNode,
        {
          id: 'work',
          kind: 'inference',
          label: 'Original work',
          config: { prompt: { template: 'Append exact evidence' } },
        },
        done,
      ],
      edges: [edge('start', 'out', 'work'), edge('work', 'out', 'done')],
    };
  }
  async function admit(definition: LoopDefinitionInput) {
    const created = await api('POST', '/loops', { definition });
    const loopId = String((created['loop'] as { id: string }).id);
    await api('POST', '/loops/' + loopId + '/publish');
    const started = await api('POST', '/loops/' + loopId + '/runs', { input: {} });
    return RunRecordSchema.parse(started['run']);
  }
  await api('PUT', '/secrets/jev-api-key', { value: 'synthetic-evidence-key' });
  harness.script([{ finalText: 'Appended exact value α 0.123456789012345' }]);
  const append = await admit(workLoop('Original append loop'));
  await container.manager.waitForIdle();
  const decision = await admit({
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name: 'Original decision loop',
    nodes: [
      startNode,
      {
        id: 'classify',
        kind: 'decision',
        label: 'Original classifier',
        config: {
          kind: 'classifier',
          model: 'jev',
          question: 'Accept?',
          recordAlternatives: true,
          answer: {
            type: 'choice',
            options: [
              { id: 'accept', label: 'Original accept', criteria: 'Accept the item' },
              { id: 'reject', label: 'Original reject', criteria: 'Reject the item' },
            ],
          },
        },
      },
      {
        id: 'route',
        kind: 'decision',
        label: 'Original LLM',
        config: {
          kind: 'llm',
          harness: 'codex',
          model: { mode: 'inherit' },
          effort: { mode: 'inherit' },
          instructions: 'Choose original route',
          routes: [
            { id: 'ship', label: 'Original ship' },
            { id: 'hold', label: 'Original hold' },
          ],
        },
      },
      done,
    ],
    edges: [
      edge('start', 'out', 'classify'),
      edge('classify', 'accept', 'route'),
      edge('classify', 'reject', 'done'),
      edge('route', 'ship', 'done'),
      edge('route', 'hold', 'done'),
    ],
  });
  await container.manager.waitForIdle();
  harness.script([{ delayMs: 60_000, finalText: 'Must not complete' }]);
  const cancelled = await admit(workLoop('User cancellation loop'));
  for (let attempt = 0; attempt < 200; attempt++) {
    const events = await api('GET', '/runs/' + cancelled.id + '/events');
    if ((events['items'] as { type: string }[]).some((event) => event.type === 'harness.session'))
      break;
    if (attempt === 199) throw new Error('Cancellation fixture did not reach its harness');
    await new Promise((done) => setTimeout(done, 10));
  }
  await api('POST', '/runs/' + cancelled.id + '/cancel');
  await container.manager.waitForIdle();
  const deadline = await admit({
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name: 'Deadline loop',
    settings: { runDeadlineSeconds: 1 },
    nodes: [
      startNode,
      {
        id: 'wait',
        kind: 'wait',
        label: 'Original deadline wait',
        config: { mode: 'input', prompt: 'Wait for the deadline' },
      },
      done,
    ],
    edges: [edge('start', 'out', 'wait'), edge('wait', 'out', 'done')],
  });
  await container.manager.waitForIdle();
  clock.advance(1001);
  await container.timers.poll();
  await container.manager.waitForIdle();
  harness.script([
    {
      error: {
        code: 'HARNESS_TRANSPORT_FAILED',
        message: 'Recorded diagnostic: controlled provider connection closed',
        retriable: false,
      },
    },
  ]);
  const provider = await admit(workLoop('Provider failure loop'));
  await container.manager.waitForIdle();
  const changed = workLoop('Renamed append loop');
  changed.nodes = changed.nodes.map((node) => ({ ...node, label: 'Renamed ' + node.id }));
  const current = await api('GET', '/loops/' + append.loopId);
  await api(
    'PUT',
    '/loops/' + append.loopId + '/draft',
    { definition: changed },
    { 'if-match': String(current['draftToken']) },
  );
  await api('POST', '/loops/' + append.loopId + '/publish');

  const renamedDecision = LoopVersionRecordSchema.parse(
    await api('GET', '/loops/' + decision.loopId + '/versions/' + decision.versionId),
  ).definition;
  renamedDecision.name = 'Renamed decision loop';
  for (const node of renamedDecision.nodes) {
    node.label = 'Renamed ' + node.id;
    if (node.kind !== 'decision') continue;
    if (node.config.kind === 'classifier' && node.config.answer.type === 'choice') {
      for (const option of node.config.answer.options) option.label = 'Renamed ' + option.id;
    } else if (node.config.kind === 'expression' || node.config.kind === 'llm') {
      for (const route of node.config.routes) route.label = 'Renamed ' + route.id;
    }
  }
  const decisionCurrent = await api('GET', '/loops/' + decision.loopId);
  await api(
    'PUT',
    '/loops/' + decision.loopId + '/draft',
    { definition: renamedDecision },
    { 'if-match': String(decisionCurrent['draftToken']) },
  );
  await api('POST', '/loops/' + decision.loopId + '/publish');
  process.env['GG_E2E_BASE_URL'] = url;
  process.env['GG_EXECUTION_EVIDENCE'] = JSON.stringify({
    append,
    decision,
    cancelled,
    deadline,
    provider,
  });
  console.log('Execution evidence: ' + url + '; disposable store ' + dataDir);
  return async () => {
    await app.close();
    await container.dispose();
    // Keep the disposable store for inspection; workers do not delete directories.
  };
}

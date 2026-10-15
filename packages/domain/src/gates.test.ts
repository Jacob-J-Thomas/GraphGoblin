import { describe, expect, it } from 'vitest';
import {
  LoopDefinitionSchema,
  type LoopDefinitionInput,
  type ClassifierAnswerConfig,
} from '@graphgoblin/contracts';
import { sampleThread } from '@graphgoblin/contracts/testing';
import { outputPorts, validateLoop } from './graph.js';
import { evaluateExpression } from './expression.js';
import { threadView } from './thread-view.js';
import { replayThread, replayStateAt, type ThreadReplayEvent } from './replay.js';

function gateLoop(): LoopDefinitionInput {
  return {
    schemaVersion: 4,
    name: 'gate',
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } },
      {
        id: 'gate',
        kind: 'decision',
        label: 'Gate',
        config: {
          kind: 'expression',
          jsonata: '"repeat"',
          routes: [
            { id: 'repeat', label: 'Repeat', repeat: true },
            { id: 'done', label: 'Done' },
          ],
          maxPasses: 3,
        },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
      { id: 'exhausted', kind: 'exit', label: 'Exhausted', config: { outcome: 'exhausted' } },
    ],
    edges: [
      { id: 'start', from: { node: 'start', port: 'out' }, to: { node: 'gate' } },
      { id: 'repeat', from: { node: 'gate', port: 'repeat' }, to: { node: 'gate' } },
      { id: 'done', from: { node: 'gate', port: 'done' }, to: { node: 'done' } },
      { id: 'limit', from: { node: 'gate', port: 'limit-reached' }, to: { node: 'exhausted' } },
    ],
  };
}
const parse = (input: LoopDefinitionInput) => LoopDefinitionSchema.parse(input);

describe('decision gate graph rules', () => {
  const classifierRoutes: { answer: ClassifierAnswerConfig; path: string }[] = [
    {
      answer: {
        type: 'choice',
        options: [
          { id: 'repeat', label: 'Repeat', criteria: 'Repeat', repeat: true },
          { id: 'done', label: 'Done', criteria: 'Done' },
        ],
      },
      path: 'config.answer.options.0.repeat',
    },
    {
      answer: {
        type: 'noul',
        true: { id: 'repeat', label: 'Repeat', criteria: 'Repeat', repeat: true },
        false: { id: 'done', label: 'Done', criteria: 'Done' },
      },
      path: 'config.answer.true.repeat',
    },
    {
      answer: {
        type: 'noul',
        false: { id: 'repeat', label: 'Repeat', criteria: 'Repeat', repeat: true },
        true: { id: 'done', label: 'Done', criteria: 'Done' },
      },
      path: 'config.answer.false.repeat',
    },
    {
      answer: {
        type: 'score',
        anchors: ['Low', 'High'],
        bands: [
          { id: 'repeat', label: 'Repeat', min: 0, max: 0.5, repeat: true },
          { id: 'done', label: 'Done', min: 0.5, max: 1 },
        ],
      },
      path: 'config.answer.bands.0.repeat',
    },
  ];
  it.each(classifierRoutes)(
    'reports the exact classifier repeat marker at $path',
    ({ answer, path }) => {
      const input = gateLoop();
      input.nodes[1] = {
        id: 'gate',
        kind: 'decision',
        label: 'Gate',
        config: { kind: 'classifier', answer, model: 'jev', question: 'Choose', maxPasses: 3 },
      };
      input.edges[1]!.to.node = 'done';
      expect(validateLoop(parse(input))).toContainEqual(
        expect.objectContaining({ code: 'REPEAT_ROUTE_NOT_CYCLIC', path }),
      );
    },
  );

  it('exposes Limit reached only on gates and requires its connection', () => {
    const input = gateLoop();
    const def = parse(input);
    expect(validateLoop(def)).toEqual([]);
    expect(outputPorts(def.nodes[1]!)).toEqual(['repeat', 'done', 'limit-reached']);
    input.edges.pop();
    expect(validateLoop(parse(input))).toContainEqual(
      expect.objectContaining({
        code: 'PORT_UNCONNECTED',
        nodeId: 'gate',
        path: 'config.maxPasses',
      }),
    );
    const gate = input.nodes[1]!;
    if (gate.kind === 'decision' && gate.config.kind === 'expression') {
      gate.config = {
        kind: 'expression',
        jsonata: '"done"',
        routes: [
          { id: 'repeat', label: 'Repeat' },
          { id: 'done', label: 'Done' },
        ],
      };
    }
    expect(outputPorts(parse(input).nodes[1]!)).toEqual(['repeat', 'done']);
    input.edges.push(def.edges[3]!);
    expect(validateLoop(parse(input)).some((issue) => issue.code === 'EDGE_PORT_MISSING')).toBe(
      true,
    );
  });

  it.each(['done', 'missing', 'start'])(
    'rejects a repeat targeting %s with a precise route path',
    (target) => {
      const input = gateLoop();
      input.edges[1]!.to.node = target;
      expect(validateLoop(parse(input))).toContainEqual(
        expect.objectContaining({
          code: 'REPEAT_ROUTE_NOT_CYCLIC',
          path: 'config.routes.0.repeat',
          edgeId: 'repeat',
        }),
      );
    },
  );

  it('exits have no ports and cannot continue', () => {
    const input = gateLoop();
    input.edges.push({ id: 'bad-exit', from: { node: 'done', port: 'out' }, to: { node: 'gate' } });
    expect(outputPorts(parse(input).nodes[2]!)).toEqual([]);
    expect(validateLoop(parse(input))).toContainEqual(
      expect.objectContaining({ code: 'EDGE_PORT_MISSING', edgeId: 'bad-exit' }),
    );
  });
});

describe('gate count projections', () => {
  it('expressions read gates.<nodeId>.passes', async () => {
    expect(
      await evaluateExpression(
        'gates.review.passes',
        threadView(sampleThread({ gates: { review: { passes: 3 } } })),
      ),
    ).toBe(3);
  });

  it('replays absolute gate counts at every checkpoint without double counting', () => {
    const initial = sampleThread({ gates: { gate: { passes: 1 } } });
    const events: ThreadReplayEvent[] = [
      { type: 'node.started', seq: 1, nodeId: 'gate' },
      { type: 'decision.made', seq: 2, nodeId: 'gate', gate: { passes: 2 } },
      { type: 'node.finished', seq: 3, nodeId: 'gate', patch: [] },
      { type: 'node.started', seq: 4, nodeId: 'gate' },
      { type: 'decision.made', seq: 5, nodeId: 'gate', gate: { passes: 3 } },
      { type: 'node.finished', seq: 6, nodeId: 'gate', patch: [] },
    ];
    const full = replayThread(initial, events);
    expect(full.gates.gate?.passes).toBe(3);
    for (let seq = 0; seq <= 6; seq++) {
      const checkpoint = replayThread(initial, events, seq);
      expect(
        replayThread(
          checkpoint,
          events.filter((event) => event.seq > seq),
          undefined,
          replayStateAt(events, seq),
        ),
      ).toEqual(full);
    }
    expect(replayThread(full, [events[4]!]).gates).toEqual(full.gates);
  });
});

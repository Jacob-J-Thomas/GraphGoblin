import { describe, expect, it } from 'vitest';
import {
  LoopDefinitionSchema,
  type LoopDefinition,
  type LoopDefinitionInput,
} from '@graphgoblin/contracts';
import { kitchenSinkLoop, minimalLoop } from '@graphgoblin/contracts/testing';
import {
  isPublishable,
  nodeById,
  nodesOfKind,
  outgoingEdge,
  outputPorts,
  reachableFrom,
  validateLoop,
} from './graph.js';

function parse(input: LoopDefinitionInput): LoopDefinition {
  return LoopDefinitionSchema.parse(input);
}

function codes(def: LoopDefinition): string[] {
  return validateLoop(def).map((i) => i.code);
}

describe('outputPorts', () => {
  it('derives ports per kind', () => {
    const def = parse(kitchenSinkLoop());
    expect(outputPorts(nodeById(def, 'start')!)).toEqual(['out']);
    expect(outputPorts(nodeById(def, 'decide')!)).toEqual(['good', 'bad']);
    expect(outputPorts(nodeById(def, 'check')!)).toEqual(['out', 'retry']);
    expect(outputPorts(nodeById(def, 'done')!)).toEqual(['loopBack']);
    const minimal = parse(minimalLoop());
    expect(outputPorts(nodeById(minimal, 'done')!)).toEqual([]);
    for (const id of ['infer', 'prep', 'sub', 'approve', 'poll']) {
      expect(outputPorts(nodeById(def, id)!)).toEqual(['out']);
    }
  });
});

describe('validateLoop', () => {
  it('accepts the fixtures', () => {
    expect(validateLoop(parse(minimalLoop()))).toEqual([]);
    const sink = validateLoop(parse(kitchenSinkLoop()));
    expect(sink.filter((i) => i.severity === 'error')).toEqual([]);
    expect(isPublishable(parse(kitchenSinkLoop()))).toBe(true);
  });

  it('reports duplicates, missing endpoints, bad ports, and triggers as targets', () => {
    const input = minimalLoop();
    input.nodes.push({ id: 'start', kind: 'trigger', label: 'Dup', config: { subtype: 'manual' } });
    input.edges.push(
      { id: 'e1', from: { node: 'ghost', port: 'out' }, to: { node: 'done' } },
      { id: 'e2', from: { node: 'done', port: 'nope' }, to: { node: 'start' } },
      { id: 'e3', from: { node: 'start', port: 'out' }, to: { node: 'ghost' } },
    );
    const found = codes(parse(input));
    expect(found).toEqual(
      expect.arrayContaining([
        'DUPLICATE_NODE_ID',
        'DUPLICATE_EDGE_ID',
        'EDGE_FROM_MISSING',
        'EDGE_PORT_MISSING',
        'EDGE_INTO_TRIGGER',
        'EDGE_TO_MISSING',
        'PORT_MULTIPLY_CONNECTED',
      ]),
    );
  });

  it('requires a trigger and an exit', () => {
    const noTrigger = parse({
      schemaVersion: 2,
      name: 'x',
      nodes: [{ id: 'done', kind: 'exit', label: 'Done', config: {} }],
      edges: [],
    });
    expect(codes(noTrigger)).toContain('NO_TRIGGER');
    const noExit = parse({
      schemaVersion: 2,
      name: 'x',
      nodes: [{ id: 'start', kind: 'trigger', label: 'S', config: { subtype: 'manual' } }],
      edges: [],
    });
    expect(codes(noExit)).toEqual(
      expect.arrayContaining(['NO_EXIT', 'PORT_UNCONNECTED', 'TRIGGER_NO_EXIT_PATH']),
    );
  });

  it('reports unconnected ports and unreachable nodes', () => {
    const input = minimalLoop();
    input.nodes.push({
      id: 'island',
      kind: 'mutate',
      label: 'I',
      config: { operations: [{ op: 'delete', path: '/vars/x' }] },
    });
    const found = codes(parse(input));
    expect(found).toContain('PORT_UNCONNECTED');
    expect(found).toContain('NODE_UNREACHABLE');
  });

  it('validates exit loop-back targets and edges', () => {
    const missing = minimalLoop();
    missing.nodes[1] = {
      id: 'done',
      kind: 'exit',
      label: 'Done',
      config: { default: 'loop-back', loopBack: { targetNodeId: 'ghost' } },
    };
    expect(codes(parse(missing))).toContain('LOOPBACK_TARGET_MISSING');

    const toTrigger = minimalLoop();
    toTrigger.nodes[1] = {
      id: 'done',
      kind: 'exit',
      label: 'Done',
      config: { default: 'loop-back', loopBack: { targetNodeId: 'start' } },
    };
    toTrigger.edges.push({
      id: 'lb',
      from: { node: 'done', port: 'loopBack' },
      to: { node: 'start' },
    });
    expect(codes(parse(toTrigger))).toContain('LOOPBACK_TARGET_INVALID');

    const mismatch = kitchenSinkLoop();
    const lb = mismatch.edges.find((e) => e.id === 'e11')!;
    lb.to = { node: 'infer' };
    expect(codes(parse(mismatch))).toContain('LOOPBACK_EDGE_MISMATCH');
  });

  it('reports undeclared decision variables and criteria above the ceiling', () => {
    const input = kitchenSinkLoop();
    const decide = input.nodes.find((n) => n.id === 'decide')!;
    if (decide.kind === 'decision')
      decide.config.evaluation = {
        kind: 'classifier',
        model: 'jev',
        question: 'Q',
        context: { vars: ['nope'] },
      };
    const done = input.nodes.find((n) => n.id === 'done')!;
    if (done.kind === 'exit') done.config.criteria = [{ when: 'max-iterations', value: 99 }];
    const issues = validateLoop(parse(input));
    expect(issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['UNDECLARED_VARIABLE', 'CRITERION_ABOVE_CEILING']),
    );
    expect(issues.find((i) => i.code === 'CRITERION_ABOVE_CEILING')?.severity).toBe('warning');
    expect(isPublishable(parse(input))).toBe(false);
  });
});

describe('graph helpers', () => {
  it('finds nodes, edges, and reachability', () => {
    const def = parse(kitchenSinkLoop());
    expect(nodesOfKind(def, 'trigger').map((n) => n.id)).toEqual(['start', 'nightly']);
    expect(outgoingEdge(def, 'decide', 'bad')?.to.node).toBe('approve');
    expect(outgoingEdge(def, 'decide', 'nope')).toBeUndefined();
    const reach = reachableFrom(def, 'approve');
    expect(reach.has('poll')).toBe(true);
    expect(reach.has('done')).toBe(true);
    expect(reach.has('prep')).toBe(true); // via loop-back
    expect(reach.has('nightly')).toBe(false);
    expect(nodeById(def, 'ghost')).toBeUndefined();
  });
});

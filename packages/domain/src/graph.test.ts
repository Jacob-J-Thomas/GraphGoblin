import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
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
    expect(outputPorts(nodeById(def, 'done')!)).toEqual([]);
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
    input.nodes.push({ id: 'start', kind: 'trigger', label: 'Dup', config: { type: 'manual' } });
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
      schemaVersion: CURRENT_DEFINITION_FORMAT,
      name: 'x',
      nodes: [{ id: 'done', kind: 'exit', label: 'Done', config: {} }],
      edges: [],
    });
    expect(codes(noTrigger)).toContain('NO_TRIGGER');
    const noExit = parse({
      schemaVersion: CURRENT_DEFINITION_FORMAT,
      name: 'x',
      nodes: [{ id: 'start', kind: 'trigger', label: 'S', config: { type: 'manual' } }],
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

  it('reports undeclared decision variables', () => {
    const input = kitchenSinkLoop();
    const decide = input.nodes.find((n) => n.id === 'decide')!;
    if (decide.kind === 'decision')
      decide.config = {
        routes: [
          { id: 'good', label: 'Good' },
          { id: 'bad', label: 'Bad' },
        ],
        kind: 'llm',
        harness: 'codex',
        model: { mode: 'inherit' },
        effort: { mode: 'inherit' },
        instructions: 'Q',
        context: { vars: ['nope'] },
      };
    const issues = validateLoop(parse(input));
    expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining(['UNDECLARED_VARIABLE']));
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
    expect(reach.has('prep')).toBe(false); // exits are terminal
    expect(reach.has('nightly')).toBe(false);
    expect(nodeById(def, 'ghost')).toBeUndefined();
  });
});

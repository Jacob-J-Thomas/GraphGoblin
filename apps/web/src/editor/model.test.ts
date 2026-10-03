import { kitchenSinkLoop, minimalLoop } from '@graphgoblin/contracts/testing';
import type { LoopDefinitionInput, NodeInput } from '@graphgoblin/contracts';
import { NodeConfigSchemas } from '@graphgoblin/contracts';
import { describe, expect, it } from 'vitest';
import {
  canvasPorts,
  connectionProblem,
  defaultConfig,
  NODE_KINDS,
  newLoopDefinition,
  nextEdgeId,
  nextNodeId,
  portsOf,
  validateDraft,
} from './model.js';

describe('editor model', () => {
  it('gives every kind a default config, valid except for the subloop reference', () => {
    for (const kind of NODE_KINDS) {
      const ok = NodeConfigSchemas[kind].safeParse(defaultConfig(kind)).success;
      expect(ok, kind).toBe(kind !== 'subloop');
    }
  });

  it('allocates unique node and edge ids', () => {
    const def = minimalLoop();
    expect(nextNodeId(def, 'decision')).toBe('decision');
    def.nodes.push({ id: 'decision', kind: 'trigger', label: 'x', config: { subtype: 'manual' } });
    def.nodes.push({
      id: 'decision-2',
      kind: 'trigger',
      label: 'x',
      config: { subtype: 'manual' },
    });
    expect(nextNodeId(def, 'decision')).toBe('decision-3');
    expect(nextEdgeId(def)).toBe('e2');
    def.edges.push({ id: 'e2', from: { node: 'a', port: 'out' }, to: { node: 'b' } });
    expect(nextEdgeId(def)).toBe('e3');
  });

  it('derives ports from parsed nodes and from half-edited configs', () => {
    const sink = kitchenSinkLoop();
    const byId = (id: string) => sink.nodes.find((n) => n.id === id)!;
    expect(portsOf(byId('decide'))).toEqual(['good', 'bad']);
    expect(portsOf(byId('check'))).toEqual(['out', 'retry']);
    expect(portsOf(byId('done'))).toEqual(['loopBack']);
    expect(portsOf(byId('prep'))).toEqual(['out']);

    const broken = (kind: NodeInput['kind'], config: unknown): NodeInput =>
      ({ id: 'n', kind, label: 'n', config }) as NodeInput;
    expect(portsOf(broken('decision', { routes: [{ label: 'a' }, { label: '' }, 'x'] }))).toEqual([
      'a',
    ]);
    expect(portsOf(broken('decision', {}))).toEqual([]);
    expect(
      portsOf(
        broken('script', { exitCodeRoutes: { '1': 'x', '2': 'out', '3': 'x' }, command: '' }),
      ),
    ).toEqual(['out', 'x']);
    expect(portsOf(broken('script', null))).toEqual(['out']);
    expect(portsOf(broken('exit', { loopBack: { targetNodeId: 'a' }, default: 'nope' }))).toEqual([
      'loopBack',
    ]);
    expect(portsOf(broken('exit', { default: 'nope' }))).toEqual([]);
    expect(portsOf(broken('wait', { mode: 'nope' }))).toEqual(['out']);
    expect(canvasPorts(broken('exit', { default: 'nope' }))).toEqual(['loopBack']);
    expect(canvasPorts(byId('done'))).toEqual(['loopBack']);
  });

  it('refuses connections into triggers, from unknown ports, and from used ports', () => {
    const def: LoopDefinitionInput = newLoopDefinition('x');
    def.nodes.push({
      id: 'mid',
      kind: 'mutate',
      label: 'm',
      config: defaultConfig('mutate'),
    } as NodeInput);
    expect(
      connectionProblem(def, { source: 'done', sourceHandle: 'loopBack', target: 'start' }),
    ).toBe('triggers have no input');
    expect(connectionProblem(def, { source: 'nope', sourceHandle: 'out', target: 'done' })).toBe(
      'unknown node',
    );
    expect(
      connectionProblem(def, { source: 'mid', sourceHandle: 'weird', target: 'done' }),
    ).toMatch(/no output port "weird"/);
    expect(connectionProblem(def, { source: 'start', sourceHandle: null, target: 'mid' })).toMatch(
      /already connected/,
    );
    expect(
      connectionProblem(def, { source: 'mid', sourceHandle: null, target: 'done' }),
    ).toBeNull();
    expect(
      connectionProblem(def, { source: 'done', sourceHandle: 'loopBack', target: 'mid' }),
    ).toBeNull();
  });

  it('validates drafts with schema issues first, then structural rules', () => {
    expect(validateDraft(newLoopDefinition('ok'))).toEqual({ issues: [], schemaValid: true });

    const structural = newLoopDefinition('x');
    structural.edges = [];
    const result = validateDraft(structural);
    expect(result.schemaValid).toBe(true);
    expect(result.issues.map((i) => i.code)).toContain('PORT_UNCONNECTED');

    const schema = newLoopDefinition('x');
    schema.nodes.push({
      id: 'd',
      kind: 'decision',
      label: 'd',
      config: { routes: [], question: 'q', strategy: [] },
    });
    schema.edges.push({ id: 'bad id!', from: { node: 'start', port: 'out' }, to: { node: 'd' } });
    schema.name = '';
    const invalid = validateDraft(schema);
    expect(invalid.schemaValid).toBe(false);
    expect(invalid.issues.find((i) => i.nodeId === 'd')?.path).toBe('config.routes');
    expect(invalid.issues.find((i) => i.edgeId === 'bad id!')?.path).toBe('id');
    expect(invalid.issues.find((i) => i.path === 'name')).toBeDefined();
  });
});

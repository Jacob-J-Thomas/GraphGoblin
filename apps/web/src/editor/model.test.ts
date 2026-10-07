import { kitchenSinkLoop, minimalLoop } from '@graphgoblin/contracts/testing';
import type { LoopDefinitionInput, NodeInput } from '@graphgoblin/contracts';
import { NodeConfigSchemas } from '@graphgoblin/contracts';
import { describe, expect, it } from 'vitest';
import {
  canvasPorts,
  connectionProblem,
  countsLabel,
  defaultConfig,
  groupIssues,
  issueCounts,
  issuesByNode,
  issuesLabel,
  NODE_KINDS,
  newLoopDefinition,
  nextEdgeId,
  nextNodeId,
  portsOf,
  sameIssues,
  validateDraft,
  type EditorIssue,
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
    expect(
      portsOf(broken('decision', { answer: { options: [{ id: 'a' }, { id: '' }, 'x'] } })),
    ).toEqual(['a']);
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
      config: {
        answer: { type: 'choice', options: [] },
        evaluation: { kind: 'expression', jsonata: '"a"' },
      },
    });
    schema.edges.push({ id: 'bad id!', from: { node: 'start', port: 'out' }, to: { node: 'd' } });
    schema.name = '';
    const invalid = validateDraft(schema);
    expect(invalid.schemaValid).toBe(false);
    expect(invalid.issues.find((i) => i.nodeId === 'd')?.path).toBe('config.answer.options');
    expect(invalid.issues.find((i) => i.edgeId === 'bad id!')?.path).toBe('id');
    expect(invalid.issues.find((i) => i.path === 'name')).toBeDefined();
  });
});

describe('issue display helpers', () => {
  const error = (nodeId?: string, message = 'broken'): EditorIssue => ({
    code: 'X',
    severity: 'error',
    message,
    ...(nodeId ? { nodeId } : {}),
  });
  const warning = (nodeId?: string): EditorIssue => ({
    code: 'W',
    severity: 'warning',
    message: 'careful',
    ...(nodeId ? { nodeId } : {}),
  });

  it('counts errors and warnings and says so in words', () => {
    expect(issueCounts([])).toEqual({ errors: 0, warnings: 0 });
    expect(issueCounts([error(), warning(), error()])).toEqual({ errors: 2, warnings: 1 });
    expect(countsLabel([error(), warning(), error()])).toBe('2 errors, 1 warning');
    expect(countsLabel([error()])).toBe('1 error');
    expect(countsLabel([warning(), warning()])).toBe('2 warnings');
    expect(countsLabel([])).toBe('');
    expect(issuesLabel(1)).toBe('1 issue');
    expect(issuesLabel(3)).toBe('3 issues');
  });

  it('groups issues by node, keeping list order', () => {
    const a = error('start', 'first');
    const b = warning('done');
    const c = error('start', 'second');
    const byNode = issuesByNode([a, error(), b, c]);
    expect([...byNode.keys()]).toEqual(['start', 'done']);
    expect(byNode.get('start')).toEqual([a, c]);
  });

  it('places every issue once: per node of the definition, or with the loop', () => {
    const def = newLoopDefinition('g');
    const loop = error();
    const edge: EditorIssue = { ...warning(), edgeId: 'e1' };
    const orphan = error('renamed');
    const issues = [error('done'), loop, warning('start'), edge, orphan, error('start')];
    const { general, nodes } = groupIssues(issues, def);
    expect(general).toEqual([loop, edge, orphan]);
    // In the definition's order (start before done), whatever the list order.
    expect(nodes.map((n) => [n.nodeId, n.issues.length])).toEqual([
      ['start', 2],
      ['done', 1],
    ]);
    expect(general.length + nodes.reduce((sum, n) => sum + n.issues.length, 0)).toBe(issues.length);
    // A duplicated id is one group.
    const twice = { ...def, nodes: [...def.nodes, def.nodes[0]!] };
    expect(groupIssues([error('start')], twice).nodes).toHaveLength(1);
  });

  it('compares issue lists by what they say', () => {
    const issue: EditorIssue = {
      ...error('start'),
      path: 'config.x',
      discard: { scope: 'node:start', path: 'x' },
    };
    expect(sameIssues([issue], [{ ...issue }])).toBe(true);
    expect(sameIssues([], [])).toBe(true);
    expect(sameIssues([issue], [])).toBe(false);
    expect(sameIssues([issue], [{ ...issue, message: 'other' }])).toBe(false);
    expect(sameIssues([issue], [{ ...issue, severity: 'warning' }])).toBe(false);
    expect(sameIssues([issue], [{ ...issue, edgeId: 'e1' }])).toBe(false);
    expect(sameIssues([issue], [{ ...issue, path: 'config.y' }])).toBe(false);
    expect(
      sameIssues(
        [issue],
        [{ ...issue, discard: { ...issue.discard!, input: 'incomplete schedule' } }],
      ),
    ).toBe(false);
    expect(sameIssues([issue], [{ ...issue, discard: { scope: 'node:other', path: 'x' } }])).toBe(
      false,
    );
    expect(sameIssues([issue], [{ ...issue, discard: { scope: 'node:start', path: 'y' } }])).toBe(
      false,
    );
  });
});

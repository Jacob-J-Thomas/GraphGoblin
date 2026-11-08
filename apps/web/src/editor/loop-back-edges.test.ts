import type { LoopDefinitionInput, NodeInput } from '@graphgoblin/contracts';
import { describe, expect, it } from 'vitest';
import { loopBackEdgeIds } from './loop-back-edges.js';

type Graph = Pick<LoopDefinitionInput, 'nodes' | 'edges'>;

const trigger = (id = 'start'): NodeInput => ({
  id,
  kind: 'trigger',
  label: id,
  config: { type: 'manual' },
});
const work = (id: string): NodeInput => ({
  id,
  kind: 'mutate',
  label: id,
  config: { operations: [{ op: 'delete', path: '/scratch' }] },
});
const decision = (id: string, ports: string[], repeat = false): NodeInput => ({
  id,
  kind: 'decision',
  label: id,
  config: {
    kind: 'expression',
    jsonata: '"next"',
    routes: ports.map((port) => ({ id: port, label: port, ...(repeat ? { repeat: true } : {}) })),
  },
});
const edge = (id: string, from: string, to: string, port = 'out'): Graph['edges'][number] => ({
  id,
  from: { node: from, port },
  to: { node: to },
});
const ids = (graph: Graph) => [...loopBackEdgeIds(graph)].sort();

describe('loopBackEdgeIds', () => {
  it('finds unmarked returns and self-loops without marking forward edges in the same cycle', () => {
    const graph: Graph = {
      nodes: [trigger(), work('body'), decision('check', ['again', 'self', 'done']), work('end')],
      edges: [
        edge('entry', 'start', 'body'),
        edge('next', 'body', 'check'),
        edge('return', 'check', 'body', 'again'),
        edge('self', 'check', 'check', 'self'),
        edge('finish', 'check', 'end', 'done'),
      ],
    };
    expect(ids(graph)).toEqual(['return', 'self']);
    expect(ids({ nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() })).toEqual(
      ids(graph),
    );
  });

  it('recognises script returns and ignores positions, route names, labels and repeat markers', () => {
    const script: NodeInput = {
      id: 'script',
      label: 'Repeat',
      kind: 'script',
      config: { command: 'true', exitCodeRoutes: { '1': 'retry' } },
      ui: { x: 0, y: 0 },
    };
    const graph: Graph = {
      nodes: [
        trigger(),
        { ...work('body'), ui: { x: 700, y: 0 } },
        script,
        decision('gate', ['repeat'], true),
        work('end'),
      ],
      edges: [
        edge('entry', 'start', 'body'),
        edge('next', 'body', 'script'),
        edge('return', 'script', 'body', 'retry'),
        edge('leave', 'script', 'gate'),
        edge('marked-forward', 'gate', 'end', 'repeat'),
      ],
    };
    const before = structuredClone(graph);
    expect(ids(graph)).toEqual(['return']);
    expect(graph).toEqual(before);
  });

  it('finds inner and outer returns in nested loops', () => {
    expect(
      ids({
        nodes: [
          trigger(),
          work('outer'),
          work('inner'),
          decision('inner-check', ['again', 'done']),
          decision('outer-check', ['again', 'done']),
          work('end'),
        ],
        edges: [
          edge('entry', 'start', 'outer'),
          edge('outer-next', 'outer', 'inner'),
          edge('inner-next', 'inner', 'inner-check'),
          edge('inner-return', 'inner-check', 'inner', 'again'),
          edge('inner-done', 'inner-check', 'outer-check', 'done'),
          edge('outer-return', 'outer-check', 'outer', 'again'),
          edge('finish', 'outer-check', 'end', 'done'),
        ],
      }),
    ).toEqual(['inner-return', 'outer-return']);
  });

  it('requires a destination on every entry path, rather than any cycle or DFS ancestor', () => {
    expect(
      ids({
        nodes: [trigger(), decision('split', ['left', 'right']), work('left'), work('right')],
        edges: [
          edge('entry', 'start', 'split'),
          edge('split-left', 'split', 'left', 'left'),
          edge('split-right', 'split', 'right', 'right'),
          edge('left-right', 'left', 'right'),
          edge('right-left', 'right', 'left'),
        ],
      }),
    ).toEqual([]);
  });

  it('uses every trigger as an entry, including disabled cron and poll triggers', () => {
    const graph: Graph = {
      nodes: [trigger(), work('body'), work('check')],
      edges: [
        edge('entry', 'start', 'body'),
        edge('next', 'body', 'check'),
        edge('return', 'check', 'body'),
      ],
    };
    expect(ids(graph)).toEqual(['return']);
    const alternatives: NodeInput[] = [
      trigger('alternative'),
      {
        id: 'alternative',
        kind: 'trigger',
        label: 'Cron',
        config: { type: 'cron', expression: '* * * * *', enabled: false },
      },
      {
        id: 'alternative',
        kind: 'trigger',
        label: 'Poll',
        config: {
          type: 'poll',
          intervalSeconds: 60,
          probe: { kind: 'none' },
          fireWhen: 'true',
          enabled: false,
        },
      },
    ];
    for (const alternative of alternatives)
      expect(
        ids({
          nodes: [...graph.nodes, alternative],
          edges: [...graph.edges, edge('bypass', 'alternative', 'check')],
        }),
      ).toEqual([]);
  });

  it('keeps a return when multiple triggers enter through its shared destination', () => {
    expect(
      ids({
        nodes: [trigger(), trigger('other'), work('body'), work('check')],
        edges: [
          edge('entry', 'start', 'body'),
          edge('other-entry', 'other', 'body'),
          edge('next', 'body', 'check'),
          edge('return', 'check', 'body'),
        ],
      }),
    ).toEqual(['return']);
  });

  it('recomputes the guarantee when connections or entry node kinds change', () => {
    const graph: Graph = {
      nodes: [trigger(), work('body'), work('check'), work('alternative')],
      edges: [
        edge('entry', 'start', 'body'),
        edge('next', 'body', 'check'),
        edge('return', 'check', 'body'),
        edge('detached-entry', 'alternative', 'check'),
      ],
    };
    expect(ids(graph)).toEqual(['return']);
    graph.edges.push(edge('bypass', 'start', 'check'));
    expect(ids(graph)).toEqual([]);
    graph.edges.pop();
    expect(ids(graph)).toEqual(['return']);
    graph.nodes[3] = trigger('alternative');
    expect(ids(graph)).toEqual([]);
    graph.nodes[3] = work('alternative');
    expect(ids(graph)).toEqual(['return']);
  });

  it('keeps detached and triggerless components ordinary except for valid self-loops', () => {
    const graph: Graph = {
      nodes: [work('left'), decision('right', ['back', 'self'])],
      edges: [
        edge('forward', 'left', 'right'),
        edge('back', 'right', 'left', 'back'),
        edge('self', 'right', 'right', 'self'),
      ],
    };
    expect(ids(graph)).toEqual(['self']);
    expect(ids({ ...graph, nodes: [trigger(), ...graph.nodes] })).toEqual(['self']);
    expect(ids({ nodes: [], edges: [] })).toEqual([]);
  });

  it('ignores dangling, unknown-port and impossible terminal connections in incomplete drafts', () => {
    const graph: Graph = {
      nodes: [
        trigger(),
        work('body'),
        decision('check', ['again']),
        { id: 'exit', kind: 'exit', label: 'Exit', config: {} },
      ],
      edges: [
        edge('entry', 'start', 'body'),
        edge('next', 'body', 'check'),
        edge('return', 'check', 'body', 'again'),
        edge('dangling-source', 'missing', 'check'),
        edge('dangling-target', 'start', 'missing'),
        edge('unknown-port-bypass', 'start', 'check', 'missing'),
        edge('exit-bypass', 'exit', 'check'),
        edge('into-trigger', 'check', 'start', 'again'),
        edge('trigger-self', 'start', 'start'),
        edge('exit-self', 'exit', 'exit'),
        edge('unknown-port-self', 'check', 'check', 'missing'),
      ],
    };
    expect(ids(graph)).toEqual(['return']);
  });

  it('does not invent paths or shared styling for duplicate node or edge identities', () => {
    expect(
      ids({
        nodes: [trigger(), work('duplicate'), work('duplicate'), work('check')],
        edges: [
          edge('entry', 'start', 'duplicate'),
          edge('next', 'duplicate', 'check'),
          edge('return', 'check', 'duplicate'),
          edge('ambiguous', 'check', 'check'),
          edge('ambiguous', 'check', 'missing'),
        ],
      }),
    ).toEqual([]);
  });

  it('considers all draft edges on a shared port as possible paths', () => {
    expect(
      ids({
        nodes: [trigger(), work('body'), work('check')],
        edges: [
          edge('entry', 'start', 'body'),
          edge('bypass', 'start', 'check'),
          edge('next', 'body', 'check'),
          edge('return', 'check', 'body'),
        ],
      }),
    ).toEqual([]);
  });

  it('handles the maximum authored node and edge counts without recursion or timing assumptions', () => {
    const nodes = [trigger()];
    const edges: Graph['edges'] = [];
    for (let i = 1; i < 500; i++) {
      const previous = i === 1 ? 'start' : `n${i - 1}`;
      nodes.push(decision(`n${i}`, ['next', 'back', 'self', 'skip']));
      edges.push(edge(`next-${i}`, previous, `n${i}`, i === 1 ? 'out' : 'next'));
      if (i > 1) edges.push(edge(`back-${i}`, `n${i}`, `n${i - 1}`, 'back'));
      edges.push(edge(`self-${i}`, `n${i}`, `n${i}`, 'self'));
      if (i < 499) edges.push(edge(`skip-${i}`, `n${i}`, `n${i + 1}`, 'skip'));
    }
    // Six extra distinct ports bring this draft to the 2000-edge limit without bypassing
    // any earlier node. The remaining duplicate destinations are ordinary parallel paths.
    const last = nodes[499]!;
    if (last.kind !== 'decision' || last.config.kind !== 'expression')
      throw new Error('Expected expression decision');
    last.config.routes.push(
      ...['extra1', 'extra2', 'extra3', 'extra4', 'extra5', 'extra6'].map((id) => ({
        id,
        label: id,
      })),
    );
    for (let i = 1; edges.length < 2000; i++)
      edges.push(edge(`extra-${i}`, 'n499', 'n498', `extra${i}`));
    expect(nodes).toHaveLength(500);
    expect(edges).toHaveLength(2000);
    const result = loopBackEdgeIds({ nodes, edges });
    expect(result.has('next-499')).toBe(false);
    expect(result.has('skip-498')).toBe(false);
    expect(result.has('back-499')).toBe(true);
    expect(result.has('self-499')).toBe(true);
    expect(result.size).toBe(1003);
  });
});

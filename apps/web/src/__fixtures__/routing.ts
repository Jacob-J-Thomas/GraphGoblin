import type { LoopDefinitionInput, NodeInput } from '@graphgoblin/contracts';
import { canvasPorts, defaultConfig } from '../editor/model.js';
import type { RoutingEdge, RoutingNode } from '../editor/routing.js';

const edge = (id: string, source: string, target: string, port = 'out') => ({
  id,
  from: { node: source, port },
  to: { node: target },
});

function node(id: string, kind: NodeInput['kind'], x: number, y = 100): NodeInput {
  return { id, label: id, kind, config: defaultConfig(kind), ui: { x, y } } as NodeInput;
}

function exit(id: string, x: number, target: string, y = 100): NodeInput {
  return {
    ...node(id, 'exit', x, y),
    kind: 'exit',
    config: {
      loopBack: { targetNodeId: target },
      default: 'loop-back',
      criteria: [{ when: 'max-iterations', value: 3 }],
    },
  };
}

export function simpleLoop(): LoopDefinitionInput {
  return {
    schemaVersion: 2,
    name: 'Simple loop',
    nodes: [
      node('start', 'trigger', 0),
      node('work', 'mutate', 300),
      node('check', 'script', 600),
      exit('done', 900, 'work'),
    ],
    edges: [
      edge('start-work', 'start', 'work'),
      edge('work-check', 'work', 'check'),
      edge('check-done', 'check', 'done'),
      edge('return', 'done', 'work', 'loopBack'),
    ],
  };
}

export function nestedLoops(): LoopDefinitionInput {
  return {
    schemaVersion: 2,
    name: 'Nested loops',
    nodes: [
      node('start', 'trigger', 0),
      node('outer-work', 'mutate', 300),
      node('inner-work', 'mutate', 600),
      exit('inner-done', 900, 'inner-work'),
      exit('outer-done', 1200, 'outer-work'),
      {
        ...node('choose', 'decision', 600, -160),
        kind: 'decision',
        config: {
          answer: {
            type: 'choice',
            options: [
              { id: 'repeat', label: 'Repeat', criteria: 'repeat' },
              { id: 'finish', label: 'Finish', criteria: 'finish' },
            ],
          },
          evaluation: { kind: 'expression', jsonata: '"finish"' },
          recordAlternatives: true,
        },
      },
    ],
    edges: [
      edge('start-outer', 'start', 'outer-work'),
      edge('outer-inner', 'outer-work', 'inner-work'),
      edge('inner-check', 'inner-work', 'choose'),
      edge('choose-repeat', 'choose', 'inner-done', 'repeat'),
      edge('choose-finish', 'choose', 'outer-done', 'finish'),
      edge('inner-return', 'inner-done', 'inner-work', 'loopBack'),
      edge('outer-return', 'outer-done', 'outer-work', 'loopBack'),
    ],
  };
}

export function decisionBackRoute(): LoopDefinitionInput {
  return {
    schemaVersion: 2,
    name: 'Decision back-route',
    nodes: [
      node('start', 'trigger', 0),
      node('work', 'mutate', 300),
      {
        ...node('decide', 'decision', 600),
        kind: 'decision',
        config: {
          answer: {
            type: 'choice',
            options: [
              { id: 'retry', label: 'Retry', criteria: 'retry' },
              { id: 'again', label: 'Again', criteria: 'again' },
              { id: 'done', label: 'Done', criteria: 'done' },
            ],
          },
          evaluation: { kind: 'expression', jsonata: '"done"' },
          recordAlternatives: true,
        },
      },
      node('done', 'exit', 900),
    ],
    edges: [
      edge('start-work', 'start', 'work'),
      edge('work-decide', 'work', 'decide'),
      edge('retry', 'decide', 'work', 'retry'),
      edge('self', 'decide', 'decide', 'again'),
      edge('finish', 'decide', 'done', 'done'),
    ],
  };
}

export function sixReturnDecision(): LoopDefinitionInput {
  const labels = Array.from({ length: 6 }, (_, i) => `return-${i + 1}`);
  return {
    schemaVersion: 2,
    name: 'Six decision returns',
    nodes: [
      node('start', 'trigger', 0),
      node('work', 'mutate', 300),
      {
        ...node('decide', 'decision', 650),
        kind: 'decision',
        config: {
          answer: {
            type: 'choice',
            options: [...labels, 'finish'].map((id) => ({ id, label: id, criteria: id })),
          },
          evaluation: { kind: 'expression', jsonata: '"finish"' },
          recordAlternatives: true,
        },
      },
      node('done', 'exit', 1000),
    ],
    edges: [
      edge('begin', 'start', 'work'),
      edge('next', 'work', 'decide'),
      ...labels.map((port) => edge(port, 'decide', 'work', port)),
      edge('finish', 'decide', 'done', 'finish'),
    ],
  };
}

export function tightGap(): LoopDefinitionInput {
  const definition = simpleLoop();
  definition.name = 'Eight pixel neighbour gap';
  definition.nodes.find((n) => n.id === 'done')!.ui = { x: 600, y: 100 };
  definition.nodes.find((n) => n.id === 'check')!.ui = { x: 792, y: 100 };
  return definition;
}

/** An exit can point right: the clear Z path has no middle horizontal after stub simplification. */
export function forwardLoopBack(): LoopDefinitionInput {
  return {
    schemaVersion: 2,
    name: 'Forward loop-back detour',
    nodes: [
      node('start', 'trigger', -300, 0),
      exit('done', 0, 'work', 0),
      node('work', 'wait', 700, 280),
      node('ceiling', 'wait', 180, -150),
      node('shelf', 'wait', 180, 160),
      node('wall', 'wait', 500, 30),
    ],
    edges: [edge('begin', 'start', 'done'), edge('return', 'done', 'work', 'loopBack')],
  };
}

/** Two connected ports per card on average, including return, same-column and self routes. */
export function denseGraph(count = 100): LoopDefinitionInput {
  const nodes: NodeInput[] = [node('start', 'trigger', 0, 0)];
  const edges = [edge('begin', 'start', 'n1')];
  for (let i = 1; i < count - 1; i += 1) {
    const labels = i < 3 ? ['next', 'retry', 'self'] : ['next', 'retry'];
    nodes.push({
      ...node(`n${i}`, 'decision', (i % 10) * 320, Math.floor(i / 10) * 270),
      kind: 'decision',
      config: {
        answer: { type: 'choice', options: labels.map((id) => ({ id, label: id, criteria: id })) },
        evaluation: { kind: 'expression', jsonata: '"next"' },
        recordAlternatives: true,
      },
    });
    edges.push(edge(`next-${i}`, `n${i}`, i === count - 2 ? 'done' : `n${i + 1}`, 'next'));
    edges.push(edge(`retry-${i}`, `n${i}`, i === 1 ? 'n1' : `n${i - 1}`, 'retry'));
    if (i < 3) edges.push(edge(`self-${i}`, `n${i}`, `n${i}`, 'self'));
  }
  nodes.push(exit('done', 9 * 320, 'n1', Math.floor((count - 1) / 10) * 270));
  edges.push(edge('return', 'done', 'n1', 'loopBack'));
  return {
    schemaVersion: 2,
    name: `Dense graph: ${count} nodes, ${count * 2} edges`,
    nodes,
    edges,
  };
}

/** Unit fixtures use explicit boxes/ports; browser tests use xyflow's actual measurements. */
export function routingInput(definition: LoopDefinitionInput): {
  nodes: RoutingNode[];
  edges: RoutingEdge[];
} {
  return {
    nodes: definition.nodes.map((n) => {
      const { x = 0, y = 0 } = n.ui ?? {};
      const ports = canvasPorts(n);
      const height = 102 + ports.length * 20;
      return {
        id: n.id,
        x,
        y,
        width: 184,
        height,
        input: { x, y: y + height / 2 },
        outputs: Object.fromEntries(ports.map((p, i) => [p, { x: x + 184, y: y + 100 + i * 20 }])),
      };
    }),
    edges: definition.edges.map((e) => ({
      id: e.id,
      source: e.from.node,
      target: e.to.node,
      port: e.from.port,
    })),
  };
}

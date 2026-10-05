import { Position, type InternalNode } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { routingInput, simpleLoop } from '../__fixtures__/routing.js';
import { createRoutingCache, ROUTING_MEASURE, createGeometrySelector } from './useRouting.js';

describe('routing measurement and cache', () => {
  it('routes once per geometry/topology change, retains unchanged routes, and bounds the timeline', () => {
    const input = routingInput(simpleLoop());
    const route = createRoutingCache();
    const geometry = { nodes: input.nodes, preparationMs: 0.5 };
    const first = route(geometry, input.edges);
    expect(route(geometry, [...input.edges])).toBe(first);
    const changed = structuredClone(input.nodes);
    changed[0]!.y -= 20;
    const next = route({ nodes: changed, preparationMs: 0.5 }, input.edges);
    expect(next.routes.get('return')).toBe(first.routes.get('return'));
    expect(next.statistics.rerouted).toBe(0);
    const moved = structuredClone(changed);
    moved[3]!.outputs['loopBack']!.y += 10;
    expect(route({ nodes: moved, preparationMs: 0 }, input.edges).routes.get('return')).not.toBe(
      first.routes.get('return'),
    );
    expect(route(geometry, []).routes.size).toBe(0);
    const measures = performance.getEntriesByName(ROUTING_MEASURE);
    expect(measures).toHaveLength(1);
    expect(measures[0]!.duration).toBeGreaterThanOrEqual(0.5);
  });

  it('uses absolute node positions and measured handle tips, ignoring selection and viewport', () => {
    const node: InternalNode = {
      id: 'a',
      data: {},
      position: { x: 0, y: 0 },
      measured: { width: 184, height: 122 },
      internals: {
        positionAbsolute: { x: 100, y: 200 },
        z: 0,
        userNode: { id: 'a', data: {}, position: { x: 0, y: 0 } },
        handleBounds: {
          source: [
            {
              id: 'out',
              type: 'source',
              nodeId: 'a',
              position: Position.Right,
              x: 178,
              y: 84,
              width: 12,
              height: 12,
            },
          ],
          target: [
            {
              id: 'in',
              type: 'target',
              nodeId: 'a',
              position: Position.Left,
              x: -6,
              y: 55,
              width: 12,
              height: 12,
            },
          ],
        },
      },
    };
    const state = { nodeLookup: new Map([['a', node]]) };
    const select = createGeometrySelector();
    const key = select(state);
    expect(key.nodes).toEqual([
      {
        id: 'a',
        x: 100,
        y: 200,
        width: 184,
        height: 122,
        outputs: { out: { x: 290, y: 290 } },
        input: { x: 94, y: 261 },
      },
    ]);
    state.nodeLookup.set('new', { ...node, id: 'new', measured: {} });
    expect(select(state)).toBe(key);
    node.selected = true;
    expect(select(state)).toBe(key);
    node.internals.handleBounds = { source: null, target: null };
    expect(select(state).nodes).toEqual([
      { id: 'a', x: 100, y: 200, width: 184, height: 122, outputs: {} },
    ]);
    delete node.internals.handleBounds;
    expect(select(state).nodes).toEqual([]);
    node.measured = {};
    expect(select(state).nodes).toEqual([]);
    node.measured = { width: 184 };
    expect(select(state).nodes).toEqual([]);
  });
});

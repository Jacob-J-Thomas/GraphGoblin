import { Position, type InternalNode } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { routingInput, simpleLoop } from '../__fixtures__/routing.js';
import { createRoutingCache, ROUTING_MEASURE, routingGeometryKey } from './useRouting.js';

describe('routing measurement and cache', () => {
  it('routes once per geometry/topology change, retains unchanged routes, and bounds the timeline', () => {
    const input = routingInput(simpleLoop());
    const route = createRoutingCache();
    const edges = JSON.stringify(input.edges);
    const key = JSON.stringify(input.nodes);
    const first = route(key, edges);
    expect(route(key, edges)).toBe(first);
    // Move an unrelated trigger, which is outside the return span.
    input.nodes[0]!.y -= 20;
    const next = route(JSON.stringify(input.nodes), edges);
    expect(next).not.toBe(first);
    expect(next.get('return')).toBe(first.get('return'));
    input.nodes[3]!.outputs['loopBack']!.y += 10;
    expect(route(JSON.stringify(input.nodes), edges).get('return')).not.toBe(first.get('return'));
    expect(route(key, '[]').size).toBe(0);
    expect(performance.getEntriesByName(ROUTING_MEASURE)).toHaveLength(1);
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
    const key = routingGeometryKey(state);
    expect(JSON.parse(key)).toEqual([
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
    node.selected = true;
    expect(routingGeometryKey(state)).toBe(key);
    node.internals.handleBounds = { source: null, target: null };
    expect(JSON.parse(routingGeometryKey(state))).toEqual([
      { id: 'a', x: 100, y: 200, width: 184, height: 122, outputs: {} },
    ]);
    delete node.internals.handleBounds;
    expect(routingGeometryKey(state)).toBe('[]');
    node.measured = {};
    expect(routingGeometryKey(state)).toBe('[]');
    node.measured = { width: 184 };
    expect(routingGeometryKey(state)).toBe('[]');
  });
});

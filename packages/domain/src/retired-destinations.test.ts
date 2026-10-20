import { describe, expect, it } from 'vitest';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import {
  retiredEventDestinations,
  withoutRetiredEventDestinations,
} from './retired-destinations.js';

describe('retiredEventDestinations (#242, ADR-0044)', () => {
  it('names every exit destination that publishes an Event, in order', () => {
    const exit = (destinations: unknown) => ({
      id: 'x',
      kind: 'exit',
      label: 'X',
      config: { destinations },
    });
    expect(
      retiredEventDestinations({
        nodes: [
          { id: 'start', kind: 'trigger', config: { type: 'event', eventType: 'go' } },
          exit([{ kind: 'caller' }, { kind: 'event', eventType: 'a' }]),
          exit([{ kind: 'event', eventType: 'b' }, 'not an object', null]),
          exit('not a list'),
          { kind: 'exit', config: null },
          { kind: 'exit' },
          null,
        ],
      }),
    ).toEqual(['/nodes/1/config/destinations/1', '/nodes/2/config/destinations/0']);
  });

  it('leaves out only the retired channel shape, for validation, without touching the input', () => {
    const definition = {
      name: 'old',
      nodes: [
        { id: 'start', kind: 'trigger', config: {} },
        {
          id: 'done',
          kind: 'exit',
          config: {
            returns: '1',
            destinations: [
              { kind: 'caller' },
              { kind: 'event', eventType: 'a' },
              { kind: 'event', eventType: 'b', extra: true },
              { kind: 'event' },
            ],
          },
        },
        { kind: 'exit', config: { destinations: 'not a list' } },
        { kind: 'exit', config: null },
        'not a node',
      ],
    };
    const before = structuredClone(definition);
    expect(withoutRetiredEventDestinations(definition)).toEqual({
      ...definition,
      nodes: [
        definition.nodes[0],
        {
          id: 'done',
          kind: 'exit',
          config: {
            returns: '1',
            destinations: [
              { kind: 'caller' },
              { kind: 'event', eventType: 'b', extra: true },
              { kind: 'event' },
            ],
          },
        },
        ...definition.nodes.slice(2),
      ],
    });
    expect(definition).toEqual(before);
    for (const value of [undefined, 'loop', { nodes: 'none' }])
      expect(withoutRetiredEventDestinations(value)).toBe(value);
  });

  it.each(['', 'loop done', '1-done', 'd' + 'x'.repeat(64), 'loop\ndone', 7])(
    'keeps an Event destination whose event type %j was never a valid slug',
    (eventType) => {
      const destinations = [{ kind: 'event', eventType }];
      const definition = { nodes: [{ id: 'done', kind: 'exit', config: { destinations } }] };
      expect(withoutRetiredEventDestinations(definition)).toEqual(definition);
    },
  );

  it('finds nothing in a current definition or in shapes that are not definitions', () => {
    expect(retiredEventDestinations(minimalLoop())).toEqual([]);
    for (const value of [undefined, null, 'loop', [], {}, { nodes: 'none' }])
      expect(retiredEventDestinations(value)).toEqual([]);
  });
});

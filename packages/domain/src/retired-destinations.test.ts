import { describe, expect, it } from 'vitest';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { retiredEventDestinations } from './retired-destinations.js';

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

  it('finds nothing in a current definition or in shapes that are not definitions', () => {
    expect(retiredEventDestinations(minimalLoop())).toEqual([]);
    for (const value of [undefined, null, 'loop', [], {}, { nodes: 'none' }])
      expect(retiredEventDestinations(value)).toEqual([]);
  });
});

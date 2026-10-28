import type { NodeInput } from '@graphgoblin/contracts';
import { describe, expect, it } from 'vitest';
import { palettePosition } from './node-placement.js';
import { NODE_CARD_SIZE } from './routing-geometry.js';

const decision: NodeInput = {
  id: 'decision',
  kind: 'decision',
  label: 'Decision',
  ui: { x: 200, y: 300 },
  config: {
    kind: 'expression',
    jsonata: '"again"',
    maxPasses: 2,
    routes: [
      { id: 'again', label: 'Again', repeat: true },
      { id: 'finish', label: 'Finish' },
    ],
  },
};

describe('palettePosition', () => {
  it('clears a Decision with three ports before its first DOM measurement', () => {
    expect(palettePosition([decision]).y).toBeGreaterThanOrEqual(
      300 + 154 + NODE_CARD_SIZE.clearance,
    );
  });
  it('uses the lowest bottom, even when the tallest card has a higher top', () => {
    const nodes: NodeInput[] = [
      decision,
      { id: 'exit', kind: 'exit', label: 'Exit', config: {}, ui: { x: 40, y: 350 } },
    ];
    expect(palettePosition(nodes).y).toBe(476);
    expect(nodes[0]?.ui).toEqual({ x: 200, y: 300 });
  });
  it('uses larger measured heights but never an obsolete smaller measurement after ports grow', () => {
    expect(palettePosition([decision], new Map([['decision', 114]])).y).toBe(476);
    expect(palettePosition([decision], new Map([['decision', 220]])).y).toBe(542);
  });
  it('handles an empty canvas, missing positions, exits, scripts and negative coordinates', () => {
    expect(palettePosition([])).toEqual({ x: 40, y: 40 });
    expect(palettePosition([{ id: 'exit', kind: 'exit', label: 'Exit', config: {} }]).y).toBe(114);
    expect(
      palettePosition([
        {
          id: 's',
          kind: 'script',
          label: 'Script',
          config: { command: 'echo', exitCodeRoutes: { 0: 'ok', 1: 'fail' } },
          ui: { x: 900, y: -20 },
        },
      ]).y,
    ).toBe(156);
    expect(palettePosition([{ ...decision, ui: { x: 0, y: -500 } }]).y).toBe(40);
  });
});

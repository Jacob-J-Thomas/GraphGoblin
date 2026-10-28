import { describe, expect, it } from 'vitest';
import { placeEdgeLabels, type EdgeLabelPath } from './edge-label-placement.js';
import { overlapsBox } from './routing-geometry.js';

const path = (id: string, y: number, text = 'Limit reached'): EdgeLabelPath => ({
  id,
  text,
  points: [
    { x: 0, y },
    { x: 500, y },
  ],
  preferred: { x: 250, y },
});
const separate = (paths: readonly EdgeLabelPath[]) => {
  const placements = [...placeEdgeLabels(paths).values()];
  for (const [i, a] of placements.entries())
    for (const b of placements.slice(i + 1)) expect(overlapsBox(a.box, b.box)).toBe(false);
  return placements;
};

describe('placeEdgeLabels', () => {
  it('separates Finish and Limit reached on lanes into the same target only 20px apart', () => {
    separate([path('finish', 100, 'Finish'), path('limit', 120)]);
  });
  it('separates intersecting boxes on unrelated horizontal and vertical edges', () => {
    const vertical = {
      ...path('vertical', 100),
      points: [
        { x: 250, y: 0 },
        { x: 250, y: 500 },
      ],
    };
    const positions = separate([path('horizontal', 100), vertical]);
    expect(positions[1]?.at.x).toBe(250);
  });
  it('is stable across input order and handles more than two labels without mutating paths', () => {
    const paths = [path('c', 100), path('a', 100), path('b', 100)];
    separate(paths);
    expect(placeEdgeLabels(paths)).toEqual(placeEdgeLabels([...paths].reverse()));
    expect(paths.map((p) => p.preferred)).toEqual(Array(3).fill({ x: 250, y: 100 }));
  });
  it('keeps an isolated label in place and omits empty labels', () => {
    expect(placeEdgeLabels([path('one', 100)]).get('one')?.at).toEqual({ x: 250, y: 100 });
    expect(placeEdgeLabels([path('empty', 100, '')]).size).toBe(0);
  });
  it('keeps pills off rounded corners when a segment runs in reverse', () => {
    const reversed = {
      ...path('reverse', 100, 'Finish'),
      preferred: { x: 0, y: 100 },
      points: [
        { x: 500, y: 100 },
        { x: 0, y: 100 },
        { x: 0, y: 110 },
      ],
    };
    expect(placeEdgeLabels([reversed]).get('reverse')?.at).toEqual({ x: 40, y: 100 });
  });
  it('avoids cards and falls back to an attached callout if a path has no room', () => {
    const card = { id: 'card', left: 0, right: 500, top: 0, bottom: 200 };
    const result = placeEdgeLabels([path('one', 100)], [card]).get('one')!;
    expect(overlapsBox(result.box, card)).toBe(false);
    expect(result.anchor).toEqual({ x: 250, y: 100 });
  });
  it('uses the closest free interval along reversed paths, with room for rounded corners', () => {
    const bent = {
      ...path('bent', 100),
      preferred: { x: 250, y: 200 },
      points: [
        { x: 500, y: 100 },
        { x: 0, y: 100 },
        { x: 0, y: 500 },
        { x: 500, y: 500 },
      ],
    };
    const result = placeEdgeLabels(
      [bent],
      [{ id: 'card', left: 150, right: 300, top: 90, bottom: 110 }],
    ).get('bent')!;
    expect(result.at).toEqual({ x: 359.5, y: 100 });
    expect(result.anchor).toBeUndefined();
  });
  it('handles zero-length, short, unavailable and nonorthogonal geometry without an infinite search', () => {
    const unavailable = placeEdgeLabels([{ ...path('missing', 0), points: [] }]).get('missing')!;
    expect(unavailable.anchor).toBeUndefined();
    for (const points of [
      [{ x: 0, y: 0 }],
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    ]) {
      const result = placeEdgeLabels([{ ...path('tiny', 0), points }]).get('tiny')!;
      expect(result.anchor).toBeDefined();
    }
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  createLabelPlacementCache,
  followEdgeLabel,
  placeEdgeLabels,
  type EdgeLabelPath,
} from './edge-label-placement.js';
import { bounds, distance, expand, intersectsBox, overlapsBox } from './routing-geometry.js';

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
  it('keeps a clear default on a short vertical jog even when the pill covers its corners', () => {
    const jog = {
      ...path('jog', 0),
      preferred: { x: 100, y: 5 },
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 10 },
        { x: 200, y: 10 },
      ],
    };
    expect(placeEdgeLabels([jog]).get('jog')?.at).toEqual(jog.preferred);
  });
  it('moves a default pill when an unlabelled edge segment crosses it', () => {
    const own = path('label', 100);
    const crossing = {
      ...path('crossing', 100, ''),
      points: [
        { x: 250, y: 0 },
        { x: 250, y: 500 },
      ],
    };
    const result = placeEdgeLabels([own, crossing]).get('label')!;
    expect(result.at).not.toEqual(own.preferred);
    expect(overlapsBox(result.box, expand(bounds(crossing.points), 2))).toBe(false);
  });
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
  it('keeps a displaced pill off rounded corners when a segment runs in reverse', () => {
    const reversed = {
      ...path('reverse', 100, 'Finish'),
      preferred: { x: 0, y: 100 },
      points: [
        { x: 500, y: 100 },
        { x: 0, y: 100 },
        { x: 0, y: 110 },
      ],
    };
    expect(
      placeEdgeLabels([reversed], [{ id: 'cover', left: -1, right: 1, top: 99, bottom: 101 }]).get(
        'reverse',
      )?.at,
    ).toEqual({ x: 40, y: 100 });
  });
  it('keeps a squeezed callout near its own edge with a leader clear of several cards', () => {
    const cards = [
      { id: 'trigger', left: 100, right: 284, top: 0, bottom: 114 },
      { id: 'work', left: 100, right: 284, top: 200, bottom: 314 },
      { id: 'check', left: 0, right: 184, top: 400, bottom: 534 },
      { id: 'done', left: 200, right: 384, top: 400, bottom: 492 },
      { id: 'other', left: 520, right: 704, top: 400, bottom: 492 },
    ];
    const points = [
      { x: 190, y: 496 },
      { x: 210, y: 496 },
      { x: 210, y: 471 },
      { x: 174, y: 471 },
      { x: 174, y: 446 },
      { x: 194, y: 446 },
    ];
    const result = placeEdgeLabels(
      [{ id: 'yes', text: 'Yes', points, preferred: { x: 192, y: 471 } }],
      cards,
    ).get('yes')!;
    expect(result.anchor).toBeDefined();
    expect(distance(result.anchor!, result.at)).toBeLessThanOrEqual(96);
    for (const card of cards) {
      expect(overlapsBox(result.box, card)).toBe(false);
      expect(intersectsBox(result.anchor!, result.at, card)).toBe(false);
    }
  });
  it('uses the closest free interval along reversed paths, with room for rounded corners', () => {
    const bent = {
      ...path('bent', 100),
      preferred: { x: 250, y: 100 },
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
  it('keeps a long local callout off an unrelated edge lane', () => {
    const tiny = {
      ...path('tiny', 0, 'A long label for a short edge'),
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      preferred: { x: 0.5, y: 0 },
    };
    const lane = {
      ...path('lane', -16, ''),
      points: [
        { x: -500, y: -16 },
        { x: 500, y: -16 },
      ],
    };
    const card = { id: 'below', left: -500, right: 500, top: 4, bottom: 100 };
    const result = placeEdgeLabels([tiny, lane], [card]).get('tiny')!;
    expect(result.anchor).toBeDefined();
    expect(distance(result.anchor!, result.at)).toBeLessThanOrEqual(96);
    expect(result.box.bottom).toBeLessThan(-18);
    expect(intersectsBox(result.anchor!, result.at, card)).toBe(false);
    const followed = followEdgeLabel(
      { ...result, attachment: { segment: 0, fraction: 0.5, offset: { x: 0, y: result.at.y } } },
      [
        { x: 10, y: 20 },
        { x: 11, y: 20 },
      ],
    );
    expect(followed.anchor).toEqual({ x: 10.5, y: 20 });
    expect(followed.at.y).toBe(result.at.y + 20);
  });
  it('handles zero-length, short, unavailable and nonorthogonal geometry without an infinite search', () => {
    const unavailable = placeEdgeLabels([{ ...path('missing', 0), points: [] }]).get('missing')!;
    expect(unavailable.anchor).toBeUndefined();
    const cases = [
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
    ];
    for (const points of cases) {
      const result = placeEdgeLabels([{ ...path('tiny', 0), points }]).get('tiny')!;
      expect(result.at).toEqual({ x: 250, y: 0 });
      expect(result.anchor).toBeUndefined();
    }
  });
  it('does not draw a misleading leader when the entire path is covered', () => {
    const covered = path('covered', 100);
    const result = placeEdgeLabels(
      [covered],
      [{ id: 'cover', left: -10, right: 510, top: 0, bottom: 200 }],
    ).get('covered')!;
    expect(result.at).toEqual(covered.preferred);
    expect(result.anchor).toBeUndefined();
  });
});

describe('label drag cache', () => {
  it('does zero input preparation or collision solving on 80 drag frames of a 300-card graph', () => {
    const cards = Array.from({ length: 300 }, (_, i) => ({
      id: `n${i}`,
      left: 0,
      right: 184,
      top: i * 202,
      bottom: i * 202 + 120,
    }));
    const paths = Array.from({ length: 600 }, (_, i) => ({
      ...path(`e${i}`, i * 32),
      points: [
        { x: 500, y: i * 32 },
        { x: 1000, y: i * 32 },
      ],
      preferred: { x: 750, y: i * 32 },
    }));
    const prepare = vi.fn(() => ({ cards, paths }));
    const place = createLabelPlacementCache();
    const settled = place(false, prepare);
    expect(settled.size).toBe(0); // All clear defaults need no channel or renderer override.
    for (let frame = 0; frame < 80; frame += 1) expect(place(true, prepare)).toBe(settled);
    expect(prepare).toHaveBeenCalledTimes(1);
    place(false, prepare);
    expect(prepare).toHaveBeenCalledTimes(2);
  });
  it('follows a moved label along its own segment and resolves neighbours again on release', () => {
    const place = createLabelPlacementCache();
    const paths = [path('a', 100), path('b', 120)];
    const before = place(false, () => ({ paths, cards: [] }));
    expect(before.has('a')).toBe(false);
    const shifted = before.get('b')!;
    expect(shifted.attachment).toBeDefined();
    const moved = followEdgeLabel(shifted, [
      { x: 10, y: 140 },
      { x: 510, y: 140 },
    ]);
    expect(moved.at).toEqual({ x: shifted.at.x + 10, y: shifted.at.y + 20 });
    expect(moved.box.left).toBe(shifted.box.left + 10);
    expect(followEdgeLabel(shifted, [])).toBe(shifted);
    const untracked = { at: shifted.at, box: shifted.box };
    expect(followEdgeLabel(untracked, [])).toBe(untracked);
    expect(place(false, () => ({ paths: [path('a', 100), path('b', 200)], cards: [] })).size).toBe(
      0,
    );
  });
  it('reserves routed shortened labels first, retaining their own placement', () => {
    const paths = [{ ...path('z-route', 100, 'Short…'), fixed: true }, path('a-forward', 100)];
    const result = placeEdgeLabels(paths);
    expect(result.get('z-route')?.at).toEqual(paths[0]!.preferred);
    expect(overlapsBox(result.get('z-route')!.box, result.get('a-forward')!.box)).toBe(false);
    expect(createLabelPlacementCache()(false, () => ({ paths, cards: [] })).has('z-route')).toBe(
      false,
    );
  });
});

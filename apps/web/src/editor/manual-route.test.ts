import { getSmoothStepPath, Position } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import {
  coordinatesOf,
  crossesCards,
  drawnPoints,
  findSegment,
  forwardPoints,
  GRID,
  midpoint,
  moveSegment,
  normalize,
  nudged,
  pointsOf,
  sameRoute,
  segmentsOf,
  STUB,
} from './manual-route.js';
import { roundedPath } from './routing.js';

const from = { x: 100, y: 0 };
const to = { x: 0, y: 40 };
const loopBack = [130, 180, -20];

describe('manual routes', () => {
  it('turns stored positions into points with stubs on the current port tips, and back', () => {
    expect(pointsOf(loopBack, from, to)).toEqual([
      from,
      { x: 130, y: 0 },
      { x: 130, y: 180 },
      { x: -20, y: 180 },
      { x: -20, y: 40 },
      to,
    ]);
    expect(coordinatesOf(pointsOf(loopBack, from, to))).toEqual(loopBack);
    // A moved card only moves its stubs: the inner segments keep their positions.
    expect(drawnPoints(loopBack, { x: 160, y: 60 }, to)).toEqual([
      { x: 160, y: 60 },
      { x: 130, y: 60 },
      { x: 130, y: 180 },
      { x: -20, y: 180 },
      { x: -20, y: 40 },
      to,
    ]);
    // A vertical first or last segment gets a zero-length stub, so the form always alternates.
    expect(
      coordinatesOf([from, { x: 100, y: 200 }, { x: -20, y: 200 }, { x: -20, y: 40 }, to]),
    ).toEqual([100, 200, -20]);
    expect(
      coordinatesOf([
        { x: 0, y: 0 },
        { x: 0, y: 50 },
      ]),
    ).toEqual([0]);
    expect(
      coordinatesOf([
        { x: 0, y: 5 },
        { x: 0, y: 5 },
        { x: 90, y: 5 },
      ]),
    ).toEqual([]);
    expect(coordinatesOf([])).toEqual([]);
    expect(pointsOf([], { x: 0, y: 5 }, { x: 90, y: 5 })).toEqual([
      { x: 0, y: 5 },
      { x: 90, y: 5 },
    ]);
    // Normalising drops segments that collapsed onto their neighbours.
    expect(normalize([130, 0, 200, 180, -20], from, to)).toEqual([200, 180, -20]);
    expect(normalize([50], { x: 0, y: 5 }, { x: 90, y: 5 })).toEqual([]);
    expect(sameRoute([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(sameRoute([1, 2, 3], [1, 2, 4])).toBe(false);
    expect(sameRoute([1], undefined)).toBe(false);
    expect(sameRoute(undefined, undefined)).toBe(true);
  });

  it('lists the segments a drag can move, and which ones stay on their port', () => {
    expect(segmentsOf(loopBack, from, to).map((s) => [s.index, s.axis, s.kind, s.value])).toEqual([
      [1, 'y', 'first', 0],
      [2, 'x', 'inner', 130],
      [3, 'y', 'inner', 180],
      [4, 'x', 'inner', -20],
      [5, 'y', 'last', 40],
    ]);
    // Zero-length segments have no handle; a straight line is one segment on both ports.
    expect(segmentsOf([100, 200, -20], from, to).map((s) => s.index)).toEqual([2, 3, 4, 5]);
    expect(segmentsOf([], { x: 0, y: 5 }, { x: 90, y: 5 })).toMatchObject([
      { index: 1, axis: 'y', kind: 'only' },
    ]);
  });

  it('moves inner segments in place and splits end segments, keeping stubs on the ports', () => {
    expect(moveSegment(loopBack, 3, 240, from, to)).toEqual({ route: [130, 240, -20], index: 3 });
    expect(moveSegment(loopBack, 2, 150, from, to)).toEqual({ route: [150, 180, -20], index: 2 });
    // The first segment keeps a stub of at most STUB px (or half its length) on the source port.
    expect(moveSegment(loopBack, 1, -30, from, to)).toEqual({
      route: [115, -30, 130, 180, -20],
      index: 3,
    });
    const long = moveSegment([300], 1, 90, { x: 0, y: 0 }, { x: 500, y: 60 });
    expect(long).toEqual({ route: [STUB, 90, 300], index: 3 });
    // The last segment keeps a stub on the target port.
    expect(moveSegment(loopBack, 5, 90, from, to)).toEqual({
      route: [130, 180, -20, 90, -10],
      index: 5,
    });
    // A straight forward line keeps a stub at both ends.
    expect(moveSegment([], 1, 80, { x: 0, y: 5 }, { x: 300, y: 5 })).toEqual({
      route: [STUB, 80, 300 - STUB],
      index: 3,
    });
    const segment = findSegment([STUB, 80, 300 - STUB], { x: 0, y: 5 }, { x: 300, y: 5 }, 'y', 80, {
      x: 150,
      y: 80,
    });
    expect(segment).toMatchObject({ index: 3, value: 80 });
    expect(findSegment(loopBack, from, to, 'x', 999, { x: 0, y: 0 })).toBeUndefined();
    expect(midpoint({ a: { x: 0, y: 0 }, b: { x: 10, y: 4 } })).toEqual({ x: 5, y: 2 });
  });

  it('nudges to grid lines and detects segments entering a card', () => {
    expect(nudged(30, 1)).toBe(GRID * 2);
    expect(nudged(44, 1)).toBe(GRID * 3);
    expect(nudged(44, -1)).toBe(GRID);
    expect(nudged(45, -1)).toBe(GRID * 2);
    expect(nudged(0, 1, 5)).toBe(GRID * 5);
    expect(nudged(-1, -1, 2)).toBe(-GRID * 2);
    const card = { id: 'c', left: 0, right: 100, top: 0, bottom: 100 };
    expect(
      crossesCards(
        [
          { x: -10, y: 50 },
          { x: 50, y: 50 },
        ],
        [card],
      ),
    ).toBe(true);
    // Touching an edge is fine.
    expect(
      crossesCards(
        [
          { x: -10, y: 0 },
          { x: 50, y: 0 },
        ],
        [card],
      ),
    ).toBe(false);
    expect(crossesCards([{ x: 0, y: 0 }], [card])).toBe(false);
  });

  it('matches xyflow’s smoothstep points for a forward edge, wide and narrow', () => {
    for (const [source, target] of [
      [
        { x: 0, y: 0 },
        { x: 300, y: 120 },
      ],
      [
        { x: 0, y: 0 },
        { x: 30, y: 120 },
      ],
      [
        { x: 0, y: 40 },
        { x: 300, y: 40 },
      ],
    ] as const) {
      const points = forwardPoints(source, target);
      const [path] = getSmoothStepPath({
        sourceX: source.x,
        sourceY: source.y,
        sourcePosition: Position.Right,
        targetX: target.x,
        targetY: target.y,
        targetPosition: Position.Left,
        borderRadius: 0,
      });
      // Square corners: the smoothstep path visits exactly these corners.
      const corners = [...path.matchAll(/-?[\d.]+[ ,]-?[\d.]+/g)].map((m) =>
        m[0].split(/[ ,]/).map(Number),
      );
      for (const p of points)
        expect(
          corners.some(([x, y]) => x === p.x && y === p.y),
          JSON.stringify(p),
        ).toBe(true);
      expect(roundedPath(points, 0)).toMatch(/^M/);
    }
    expect(forwardPoints({ x: 0, y: 0 }, { x: 300, y: 120 })).toEqual([
      { x: 0, y: 0 },
      { x: 150, y: 0 },
      { x: 150, y: 120 },
      { x: 300, y: 120 },
    ]);
  });
});

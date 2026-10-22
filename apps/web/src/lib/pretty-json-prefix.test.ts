import { describe, expect, it } from 'vitest';
import { prettyJson, prettyJsonPrefix } from './utils.js';

const fixtures: Record<string, unknown> = {
  scalars: [0, -0, 1.5, -2, 1e21, NaN, Infinity, -Infinity, true, false, null, 'text'],
  strings: ['', 'quote " backslash \\ newline \n tab \t', 'é 😀     \u0000', '\ud800'],
  empties: { object: {}, array: [], nested: { deep: { deeper: [] } } },
  omissions: { kept: 1, dropped: undefined, fn: () => 1, sym: Symbol('s'), list: [undefined, 1] },
  dates: { at: new Date('2026-10-22T12:00:00.000Z'), nested: [new Date(0)] },
  order: { b: 1, a: 2, 10: 'ten', 2: 'two', z: { y: 1, x: 2 } },
  deep: {
    level1: { level2: { level3: { level4: Array.from({ length: 5 }, (_, i) => ({ i })) } } },
  },
  big: { items: Array.from({ length: 300 }, (_, i) => ({ id: i, note: 'n'.repeat(30) })) },
  topString: 'just a string',
  topNumber: 42,
  topNull: null,
  topArray: [1, [2, [3, [4]]]],
  // Shapes JSON.stringify treats specially: holes, boxed primitives, toJSON that omits itself,
  // toJSON reading its key, inherited enumerable properties (not own, so not serialised).
  holes: Object.assign(new Array(6) as unknown[], { 0: 1, 2: 3, 4: () => 1, 5: Symbol('s') }),
  boxed: { s: new String('boxed'), n: new Number(7), b: new Boolean(false) },
  omitting: { a: { toJSON: () => undefined }, b: 1, c: [{ toJSON: () => undefined }] },
  keyed: {
    first: { toJSON: (key: string) => `seen ${key}` },
    list: [{ toJSON: (key: string) => `index ${key}` }],
  },
  inherited: Object.assign(Object.create({ fromPrototype: 1 }) as object, { own: 2 }),
  longKey: { ['k'.repeat(3_000)]: 'v', after: 1 },
  pairs: { text: `${'ab'.repeat(1_023)}😀${'c'.repeat(10)}` },
  // A lone high surrogate right before a real pair at the chunk boundary, as a value and as a key.
  loneThenPair: {
    text: `${'a'.repeat(1_023)}\ud800😀${'z'.repeat(5_000)}`,
    [`${'k'.repeat(1_023)}\ud800😀tail`]: 1,
  },
};

describe('prettyJsonPrefix', () => {
  it('matches prettyJson exactly when the budget is not spent', () => {
    for (const [name, value] of Object.entries(fixtures)) {
      const full = prettyJson(value);
      expect(prettyJsonPrefix(value, Number.POSITIVE_INFINITY), name).toEqual({
        text: full,
        truncated: false,
      });
      expect(prettyJsonPrefix(value, full.length), name).toEqual({ text: full, truncated: false });
    }
  });

  it('returns the exact prefix and the truncated flag for every budget', () => {
    for (const [name, value] of Object.entries(fixtures)) {
      const full = prettyJson(value);
      for (const limit of [0, 1, 2, 3, 7, 16, 64, 255, 1_024, full.length - 1]) {
        if (limit < 0 || limit >= full.length) continue;
        expect(prettyJsonPrefix(value, limit), `${name} at ${limit}`).toEqual({
          text: full.slice(0, limit),
          truncated: true,
        });
      }
    }
  });

  it('renders undefined as nothing and refuses a BigInt like JSON.stringify', () => {
    expect(prettyJsonPrefix(undefined, 10)).toEqual({ text: '', truncated: false });
    expect(() => prettyJsonPrefix({ n: 1n }, 10)).toThrow(TypeError);
    expect(() => prettyJson({ n: 1n })).toThrow(TypeError);
  });

  it('quotes a huge string only as far as the budget, with the exact escapes', () => {
    const huge = `${'quote " and \\ and \n'.repeat(500)}${'x'.repeat(4_000_000)}😀end`;
    const full = JSON.stringify({ text: huge }, null, 2);
    for (const limit of [10, 100, 4_096, 20_000]) {
      expect(prettyJsonPrefix({ text: huge }, limit)).toEqual({
        text: full.slice(0, limit),
        truncated: true,
      });
    }
    // Chunk boundaries never split a surrogate pair, whatever the offset of the pair, and a lone
    // high surrogate beside the boundary does not drag a following pair's first half across it.
    for (const offset of [1_021, 1_022, 1_023, 1_024, 1_025]) {
      for (const lead of ['', '\ud800', '\udc00']) {
        const text = `${'a'.repeat(offset)}${lead}😀${'b'.repeat(5)}`;
        expect(prettyJsonPrefix(text, Number.POSITIVE_INFINITY).text).toBe(JSON.stringify(text));
        for (const limit of [offset + 2, offset + 4, offset + 8])
          expect(prettyJsonPrefix(text, limit).text).toBe(JSON.stringify(text).slice(0, limit));
      }
    }
  });

  it('stops walking once the budget is spent', () => {
    let visited = 0;
    const lazy = {
      first: 'x'.repeat(100),
      get second(): string {
        visited += 1;
        return 'never needed for a short preview';
      },
    };
    expect(prettyJsonPrefix(lazy, 50)).toEqual({
      text: prettyJson({ first: lazy.first, second: '' }).slice(0, 50),
      truncated: true,
    });
    expect(visited).toBe(0);
    prettyJsonPrefix(lazy, 10_000);
    expect(visited).toBe(1);
  });
});

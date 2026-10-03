import { describe, expect, it } from 'vitest';
import { PatchError } from './errors.js';
import {
  formatPointer,
  getAtPointer,
  parsePointer,
  pointerStartsWith,
  updateAtPointer,
} from './pointer.js';

describe('parsePointer / formatPointer', () => {
  it('parses escaped tokens and round-trips', () => {
    expect(parsePointer('')).toEqual([]);
    expect(parsePointer('/a/b~1c/d~0e')).toEqual(['a', 'b/c', 'd~e']);
    expect(formatPointer(['a', 'b/c', 'd~e'])).toBe('/a/b~1c/d~0e');
    expect(formatPointer([])).toBe('');
  });

  it('rejects pointers without a leading slash', () => {
    expect(() => parsePointer('a/b')).toThrow(PatchError);
  });

  it('pointerStartsWith respects segment boundaries', () => {
    expect(pointerStartsWith('/vars/a', '/vars')).toBe(true);
    expect(pointerStartsWith('/vars', '/vars')).toBe(true);
    expect(pointerStartsWith('/varsx', '/vars')).toBe(false);
    expect(pointerStartsWith('/anything', '')).toBe(true);
  });
});

describe('getAtPointer', () => {
  const doc = { a: { b: [10, { c: 'x' }] }, 'k/y': 1 };

  it('reads nested values', () => {
    expect(getAtPointer(doc, '')).toEqual({ found: true, value: doc });
    expect(getAtPointer(doc, '/a/b/1/c')).toEqual({ found: true, value: 'x' });
    expect(getAtPointer(doc, '/k~1y')).toEqual({ found: true, value: 1 });
  });

  it('reports missing paths', () => {
    expect(getAtPointer(doc, '/a/zzz').found).toBe(false);
    expect(getAtPointer(doc, '/a/b/9').found).toBe(false);
    expect(getAtPointer(doc, '/a/b/x').found).toBe(false);
    expect(getAtPointer(doc, '/a/b/0/c').found).toBe(false);
  });
});

describe('updateAtPointer', () => {
  it('adds, replaces, and removes object keys immutably', () => {
    const doc = { a: { b: 1 } };
    const added = updateAtPointer(doc, '/a/c', 'add', 2) as typeof doc & { a: { c: number } };
    expect(added.a.c).toBe(2);
    expect(doc).toEqual({ a: { b: 1 } });
    const replaced = updateAtPointer(added, '/a/b', 'replace', 5) as { a: { b: number } };
    expect(replaced.a.b).toBe(5);
    const removed = updateAtPointer(replaced, '/a/b', 'remove') as { a: Record<string, unknown> };
    expect('b' in removed.a).toBe(false);
  });

  it('inserts into arrays including with "-"', () => {
    const doc = { list: [1, 3] };
    expect(updateAtPointer(doc, '/list/1', 'add', 2)).toEqual({ list: [1, 2, 3] });
    expect(updateAtPointer(doc, '/list/-', 'add', 4)).toEqual({ list: [1, 3, 4] });
    expect(updateAtPointer(doc, '/list/2', 'add', 4)).toEqual({ list: [1, 3, 4] });
    expect(updateAtPointer(doc, '/list/0', 'replace', 9)).toEqual({ list: [9, 3] });
    expect(updateAtPointer(doc, '/list/0', 'remove')).toEqual({ list: [3] });
  });

  it('replaces the root', () => {
    expect(updateAtPointer({ a: 1 }, '', 'replace', { b: 2 })).toEqual({ b: 2 });
    expect(() => updateAtPointer({ a: 1 }, '', 'remove')).toThrow(PatchError);
  });

  it('rejects bad array indices and missing paths', () => {
    const doc = { list: [1], obj: {} };
    expect(() => updateAtPointer(doc, '/list/x', 'add', 1)).toThrow(/invalid array index/);
    expect(() => updateAtPointer(doc, '/list/5', 'add', 1)).toThrow(/out of bounds/);
    expect(() => updateAtPointer(doc, '/list/1', 'replace', 1)).toThrow(/out of bounds/);
    expect(() => updateAtPointer(doc, '/list/-', 'replace', 1)).toThrow(
      /only valid as the final token/,
    );
    expect(() => updateAtPointer(doc, '/obj/missing', 'replace', 1)).toThrow(/does not exist/);
    expect(() => updateAtPointer(doc, '/obj/missing/deeper', 'add', 1)).toThrow(/does not exist/);
    expect(() => updateAtPointer(doc, '/list/0/deeper', 'add', 1)).toThrow(/non-container/);
  });

  it('updates nested arrays through intermediate indices', () => {
    const doc = { list: [{ v: 1 }, { v: 2 }] };
    expect(updateAtPointer(doc, '/list/1/v', 'replace', 7)).toEqual({ list: [{ v: 1 }, { v: 7 }] });
  });
});

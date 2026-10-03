import { describe, expect, it } from 'vitest';
import { PatchError } from './errors.js';
import { applyPatch, cloneJson, jsonEquals } from './patch.js';

describe('jsonEquals', () => {
  it('compares deeply', () => {
    expect(jsonEquals({ a: [1, { b: null }] }, { a: [1, { b: null }] })).toBe(true);
    expect(jsonEquals({ a: 1 }, { a: 2 })).toBe(false);
    expect(jsonEquals([1, 2], [1])).toBe(false);
    expect(jsonEquals([1], { 0: 1 })).toBe(false);
    expect(jsonEquals({ 0: 1 }, [1])).toBe(false);
    expect(jsonEquals({ a: 1 }, { b: 1 })).toBe(false);
    expect(jsonEquals(null, {})).toBe(false);
    expect(jsonEquals('a', 1)).toBe(false);
    expect(jsonEquals(1, 1)).toBe(true);
    expect(jsonEquals('a', 'b')).toBe(false);
  });
});

describe('cloneJson', () => {
  it('deep clones without sharing references', () => {
    const source = { a: [1, { b: 2 }], c: 'x', d: null };
    const copy = cloneJson(source);
    expect(copy).toEqual(source);
    expect(copy.a).not.toBe(source.a);
    expect(copy.a[1]).not.toBe(source.a[1]);
    expect(cloneJson(5)).toBe(5);
  });
});

describe('applyPatch', () => {
  const doc = { vars: { a: 1, list: [1, 2] }, messages: [] as unknown[] };

  it('applies every operation type', () => {
    const result = applyPatch(doc, [
      { op: 'add', path: '/vars/b', value: 2 },
      { op: 'replace', path: '/vars/a', value: 10 },
      { op: 'remove', path: '/vars/list/0' },
      { op: 'move', from: '/vars/b', path: '/vars/c' },
      { op: 'copy', from: '/vars/c', path: '/vars/d' },
      { op: 'test', path: '/vars/d', value: 2 },
      { op: 'add', path: '/messages/-', value: { id: 'm' } },
    ]);
    expect(result).toEqual({ vars: { a: 10, list: [2], c: 2, d: 2 }, messages: [{ id: 'm' }] });
    expect(doc).toEqual({ vars: { a: 1, list: [1, 2] }, messages: [] });
  });

  it('fails atomically with the operation index in the message', () => {
    expect(() =>
      applyPatch(doc, [
        { op: 'add', path: '/vars/x', value: 1 },
        { op: 'test', path: '/vars/a', value: 999 },
      ]),
    ).toThrow(/operation 1 \(test \/vars\/a\): test failed/);
    expect(doc.vars).toEqual({ a: 1, list: [1, 2] });
  });

  it('rejects moving into its own child and missing sources', () => {
    expect(() => applyPatch(doc, [{ op: 'move', from: '/vars', path: '/vars/inner' }])).toThrow(
      PatchError,
    );
    expect(() => applyPatch(doc, [{ op: 'move', from: '/vars/nope', path: '/vars/x' }])).toThrow(
      /does not exist/,
    );
    expect(() => applyPatch(doc, [{ op: 'copy', from: '/vars/nope', path: '/vars/x' }])).toThrow(
      /does not exist/,
    );
    expect(() => applyPatch(doc, [{ op: 'test', path: '/vars/nope', value: 1 }])).toThrow(
      /test failed/,
    );
  });

  it('allows moving a value onto itself', () => {
    expect(applyPatch(doc, [{ op: 'move', from: '/vars/a', path: '/vars/a' }])).toEqual(doc);
  });

  it('rethrows non-patch errors untouched', () => {
    const poison = {
      get vars(): never {
        throw new TypeError('boom');
      },
    };
    expect(() => applyPatch(poison, [{ op: 'add', path: '/vars/x', value: 1 }])).toThrow(TypeError);
  });
});

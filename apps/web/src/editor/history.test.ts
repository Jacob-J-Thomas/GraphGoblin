import { describe, expect, it } from 'vitest';
import {
  COALESCE_MS,
  EMPTY_HISTORY,
  HISTORY_LIMIT,
  recordStep,
  sameValue,
  travel,
  type History,
  type Snapshot,
} from './history.js';
import { newLoopDefinition } from './model.js';

/** A snapshot of a loop named `name`, with no unparsed text. */
const at = (name: string): Snapshot => ({ definition: newLoopDefinition(name), fieldErrors: {} });

describe('sameValue', () => {
  it('compares JSON-like values deeply, with undefined properties counted as absent', () => {
    expect(sameValue(1, 1)).toBe(true);
    expect(sameValue('a', 'b')).toBe(false);
    expect(sameValue(null, {})).toBe(false);
    expect(sameValue({}, null)).toBe(false);
    expect(sameValue(1, {})).toBe(false);
    expect(sameValue({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(sameValue({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false);
    expect(sameValue([1, 2], [1])).toBe(false);
    expect(sameValue([1], { 0: 1 })).toBe(false);
    expect(sameValue({ 0: 1 }, [1])).toBe(false);
    expect(sameValue({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(sameValue({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(sameValue({ a: 1 }, { b: 1 })).toBe(false);
    expect(sameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});

describe('recordStep', () => {
  it('pushes a step holding the state before it, and clears redo', () => {
    const withFuture: History = { ...EMPTY_HISTORY, future: [{ ...at('z'), label: 'old' }] };
    const next = recordStep(withFuture, at('a'), at('b'), { label: 'rename loop' }, 0);
    expect(next.past).toEqual([{ ...at('a'), label: 'rename loop' }]);
    expect(next.future).toEqual([]);
    // A step without a key closes the merge window.
    expect(next.openStep).toBeUndefined();
  });

  it('merges a change with the open step’s key inside the window, and not after it', () => {
    const step = { label: 'edit label of a', coalesceKey: 'label:a' };
    let history = recordStep(EMPTY_HISTORY, at('a'), at('ab'), step, 0);
    history = recordStep(history, at('ab'), at('abc'), step, COALESCE_MS - 1);
    expect(history.past).toHaveLength(1);
    expect(history.past[0]!.definition.name).toBe('a');
    // The window slides with each change: still one step after another 999 ms.
    history = recordStep(history, at('abc'), at('abcd'), step, 2 * COALESCE_MS - 2);
    expect(history.past).toHaveLength(1);
    // A pause of a full window starts a new step.
    history = recordStep(history, at('abcd'), at('abcde'), step, 3 * COALESCE_MS - 2);
    expect(history.past).toHaveLength(2);
    // Another key starts one too, as does a change without a key.
    const other = { label: 'edit loop name', coalesceKey: 'meta:name' };
    history = recordStep(history, at('abcde'), at('x'), other, 3 * COALESCE_MS);
    expect(history.past).toHaveLength(3);
    history = recordStep(history, at('x'), at('y'), { label: 'add exit' }, 3 * COALESCE_MS);
    history = recordStep(history, at('y'), at('z'), other, 3 * COALESCE_MS);
    expect(history.past.map((entry) => entry.label)).toEqual([
      'edit label of a',
      'edit label of a',
      'edit loop name',
      'add exit',
      'edit loop name',
    ]);
  });

  it('drops a merged step that ends where it started', () => {
    const step = { label: 'edit loop name', coalesceKey: 'meta:name' };
    const first = recordStep(EMPTY_HISTORY, at('a'), at('b'), { label: 'other' }, 0);
    let history = recordStep(first, at('b'), at('bc'), step, 0);
    history = recordStep(history, at('bc'), at('b'), step, 10);
    expect(history.past).toEqual(first.past);
    // The next change starts a new step rather than merging into an older one.
    expect(history.openStep).toBeUndefined();
  });

  it('keeps at most HISTORY_LIMIT steps, forgetting the oldest', () => {
    let history = EMPTY_HISTORY;
    for (let i = 0; i <= HISTORY_LIMIT; i += 1) {
      history = recordStep(history, at(`n${i}`), at(`n${i + 1}`), { label: `step ${i}` }, i);
    }
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.past[0]!.label).toBe('step 1');
  });
});

describe('travel', () => {
  it('moves one step between past and future, keeping its label and rename', () => {
    const renamed = { from: 'a', to: 'b' };
    const history = recordStep(EMPTY_HISTORY, at('a'), at('b'), { label: 'rename', renamed }, 0);
    expect(travel(history, at('b'), 'redo')).toBeUndefined();
    const undone = travel(history, at('b'), 'undo')!;
    expect(undone.entry).toEqual({ ...at('a'), label: 'rename', renamed });
    expect(undone.history).toEqual({
      past: [],
      future: [{ ...at('b'), label: 'rename', renamed }],
      openStep: undefined,
    });
    expect(travel(undone.history, at('a'), 'undo')).toBeUndefined();
    const redone = travel(undone.history, at('a'), 'redo')!;
    expect(redone.entry.definition.name).toBe('b');
    expect(redone.history.past).toEqual([{ ...at('a'), label: 'rename', renamed }]);
    expect(redone.history.future).toEqual([]);

    // A step without a rename carries none.
    const plain = recordStep(EMPTY_HISTORY, at('a'), at('b'), { label: 'plain' }, 0);
    expect(travel(plain, at('b'), 'undo')!.history.future[0]).not.toHaveProperty('renamed');
  });
});

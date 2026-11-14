import { describe, expect, it } from 'vitest';
import { stringRepairs, withStringRepairs } from './repair.js';
import { UNSET } from './unset.js';

describe('stringRepairs', () => {
  const shared = { kept: [1, true, null] };
  const before = {
    operations: [
      { op: 'coerce', source: '/counters/nodeVisits/work', repair: { enabled: false } },
      { op: 'append-message', content: 'Same note' },
    ],
    env: { 'a.b': '{{ outputs.work.value }}' },
    shared,
  };

  it('finds the strings a repair replaced, at exact paths, with shared or copied branches', () => {
    const after = {
      ...before,
      operations: [
        { ...before.operations[0], source: '/counters/nodeVisits/worker' },
        { op: 'append-message', content: 'Same note' },
      ],
      env: { 'a.b': '{{ outputs.worker.value }}' },
    };
    expect(stringRepairs(before, after)).toEqual([
      {
        path: ['operations', 0, 'source'],
        from: '/counters/nodeVisits/work',
        to: '/counters/nodeVisits/worker',
      },
      { path: ['env', 'a.b'], from: '{{ outputs.work.value }}', to: '{{ outputs.worker.value }}' },
    ]);
    expect(stringRepairs(before, structuredClone(before))).toEqual([]);
    expect(stringRepairs(before, before)).toEqual([]);
  });

  it('refuses any change other than replaced strings', () => {
    const changed = (edit: (value: typeof before) => unknown) =>
      stringRepairs(before, edit(structuredClone(before)));
    expect(changed((v) => ({ ...v, operations: v.operations.slice(1) }))).toBeUndefined();
    expect(changed((v) => ({ ...v, added: 'x' }))).toBeUndefined();
    expect(changed(({ env: _env, ...rest }) => ({ ...rest, other: {} }))).toBeUndefined();
    expect(changed((v) => ({ ...v, shared: { kept: [2, true, null] } }))).toBeUndefined();
    expect(changed((v) => ({ ...v, shared: { kept: [1, 'true', null] } }))).toBeUndefined();
    expect(changed((v) => ({ ...v, shared: [] }))).toBeUndefined();
    expect(changed((v) => ({ ...v, env: null }))).toBeUndefined();
    expect(stringRepairs('a', 1)).toBeUndefined();
  });
});

describe('withStringRepairs', () => {
  it('replaces each string below the given depth, copying only the way there', () => {
    const untouched = { tags: ['x'] };
    const section = [
      { op: 'coerce', source: '/counters/nodeVisits/work', target: UNSET },
      untouched,
    ];
    const frozen = structuredClone(section);
    const next = withStringRepairs(
      section,
      [{ path: ['operations', 0, 'source'], from: '', to: '/counters/nodeVisits/worker' }],
      1,
    ) as typeof section;
    expect(next).toEqual([
      { op: 'coerce', source: '/counters/nodeVisits/worker', target: UNSET },
      untouched,
    ]);
    expect(next[1]).toBe(untouched);
    expect(section).toEqual(frozen);
    expect(withStringRepairs({ env: {} }, [{ path: ['env', 'a.b'], from: '', to: 'y' }])).toEqual({
      env: { 'a.b': 'y' },
    });
    expect(withStringRepairs(undefined, [{ path: ['a'], from: '', to: 'y' }])).toEqual({ a: 'y' });
  });
});

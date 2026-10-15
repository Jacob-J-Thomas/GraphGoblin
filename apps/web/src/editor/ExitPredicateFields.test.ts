import { describe, expect, it } from 'vitest';
import { exitPredicateVariantChange } from './ExitPredicateFields.js';

describe('separate predicate variant normalization', () => {
  const wrap = (row: unknown) => ({ criteria: [{ when: 'max-iterations', value: 3 }, row] });
  const previous = wrap({
    when: 'predicate',
    predicate: { kind: 'expression', jsonata: 'true' },
    match: { type: 'boolean', value: false },
  });
  it.each([
    [{ kind: 'llm' }, { type: 'boolean', value: true }],
    [
      { kind: 'classifier', answer: { type: 'choice', options: [{ id: 'ready' }] } },
      { type: 'choice', optionIds: ['ready'] },
    ],
    [
      { kind: 'classifier', answer: { type: 'noul' } },
      { type: 'noul', value: true },
    ],
    [
      { kind: 'classifier', answer: { type: 'score' } },
      { type: 'score', operator: 'gte', value: 0 },
    ],
  ])('matches the selected predicate variant %#', (predicate, match) => {
    const next = wrap({ when: 'predicate', predicate, match: { type: 'boolean', value: false } });
    expect(exitPredicateVariantChange(next, previous, 'criteria.1.predicate')).toEqual(
      wrap({ when: 'predicate', predicate, match }),
    );
  });
  it('preserves ordinary edits and malformed or unrelated input without resetting a match', () => {
    for (const path of [
      undefined,
      'return.mapping',
      'criteria.1.predicate.jsonata',
      'criteria.1.match',
    ])
      expect(exitPredicateVariantChange(previous, {}, path)).toBe(previous);
    expect(exitPredicateVariantChange(previous, previous, 'criteria.1.predicate')).toBe(previous);
    for (const next of [null, {}, { criteria: 'wrong' }, wrap({ when: 'max-duration' })])
      expect(exitPredicateVariantChange(next, {}, 'criteria.1')).toBe(next);
  });
});

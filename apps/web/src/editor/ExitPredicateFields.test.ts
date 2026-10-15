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
    [{ kind: 'llm' }, { type: 'boolean', value: false }],
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
  it.each([
    ['expression', 'llm'],
    ['llm', 'expression'],
  ])('preserves the boolean match when switching %s to %s', (from, to) => {
    const match = { type: 'boolean', value: false, minReportedConfidence: 1.2 };
    const before = wrap({ when: 'predicate', predicate: { kind: from }, match });
    const next = wrap({ when: 'predicate', predicate: { kind: to }, match });
    expect(exitPredicateVariantChange(next, before, 'criteria.1.predicate')).toBe(next);
  });
  it('preserves ordinary edits and malformed or unrelated input without resetting a match', () => {
    for (const path of [
      undefined,
      'return.mapping',
      'criteria.1.predicate.jsonata',
      'criteria.1.match',
      'criteria.1.predicateXanswer',
    ])
      expect(exitPredicateVariantChange(previous, {}, path)).toBe(previous);
    expect(exitPredicateVariantChange(previous, previous, 'criteria.1.predicate')).toBe(previous);
    for (const next of [null, {}, { criteria: 'wrong' }, wrap({ when: 'max-duration' })])
      expect(exitPredicateVariantChange(next, {}, 'criteria.1')).toBe(next);
  });
});

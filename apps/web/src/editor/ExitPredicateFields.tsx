function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}
/** Keep the temporary exit predicate and its match coherent when selecting a variant. */
export function exitPredicateVariantChange(
  config: unknown,
  previous: unknown,
  path?: string,
): unknown {
  const changed = /^criteria\.(\d+)(?:\.(?:predicate|predicate\.answer))?$/.exec(path ?? '');
  if (!changed) return config;
  const current = record(config);
  const criteria = current['criteria'];
  if (!Array.isArray(criteria)) return config;
  const index = Number(changed[1]);
  const row = record(criteria[index]);
  if (row['when'] !== 'predicate') return config;
  const oldCriteria = record(previous)['criteria'];
  const oldRow = record(Array.isArray(oldCriteria) ? oldCriteria[index] : undefined);
  const predicate = record(row['predicate']);
  const oldPredicate = record(oldRow['predicate']);
  const answer = record(predicate['answer']);
  const type = answer['type'];
  if (
    oldRow['when'] === 'predicate' &&
    predicate['kind'] === oldPredicate['kind'] &&
    type === record(oldPredicate['answer'])['type']
  )
    return config;
  if (
    oldRow['when'] === 'predicate' &&
    (oldPredicate['kind'] === 'expression' || oldPredicate['kind'] === 'llm') &&
    (predicate['kind'] === 'expression' || predicate['kind'] === 'llm') &&
    record(row['match'])['type'] === 'boolean'
  )
    return config;
  const options = answer['options'];
  const match =
    predicate['kind'] !== 'classifier'
      ? { type: 'boolean', value: true }
      : type === 'score'
        ? { type, operator: 'gte', value: 0 }
        : type === 'choice'
          ? { type, optionIds: [record(Array.isArray(options) ? options[0] : undefined)['id']] }
          : { type: 'noul', value: true };
  return {
    ...current,
    criteria: criteria.map((value: unknown, i) => (i === index ? { ...row, match } : value)),
  };
}

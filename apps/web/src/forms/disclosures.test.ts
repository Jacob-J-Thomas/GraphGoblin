import { describe, expect, it } from 'vitest';
import {
  carryCollectionIdentities,
  createCollectionIdentities,
  createDisclosureIdentities,
} from './disclosures.js';

/** Identities with the rows of `value`'s operations and their nested messages recorded. */
function recorded(value: object) {
  const identities = createDisclosureIdentities();
  const rows = createCollectionIdentities(identities, value);
  const ids = [rows.get('operations', 2), rows.get('operations.0.messages', 1)];
  return { identities, ids };
}

const config = {
  operations: [{ op: 'inject', messages: [{ content: 'Same' }] }, { op: 'drop' }],
};

describe('carryCollectionIdentities', () => {
  it('gives a replacement that keeps every recorded list in place the same row ids', () => {
    const { identities, ids } = recorded(config);
    const repaired = {
      operations: [{ op: 'inject', messages: [{ content: 'Renamed' }] }, { op: 'drop' }],
    };
    carryCollectionIdentities(identities, config, repaired);
    const rows = createCollectionIdentities(identities, repaired);
    expect([rows.get('operations', 2), rows.get('operations.0.messages', 1)]).toEqual(ids);
  });

  it.each([
    ['a shorter list', { operations: [{ op: 'inject', messages: [{ content: 'Same' }] }] }],
    ['a nested list that moved', { operations: [{ op: 'drop' }, config.operations[0]] }],
  ])('carries nothing to %s; rows are not matched by content', (_, changed) => {
    const { identities, ids } = recorded(config);
    carryCollectionIdentities(identities, config, changed);
    expect(identities.snapshots.has(changed)).toBe(false);
    const rows = createCollectionIdentities(identities, changed);
    expect(rows.get('operations', 2)).not.toEqual(ids[0]);
  });

  it('keeps rows already recorded for the replacement and ignores values without rows', () => {
    const { identities } = recorded(config);
    const known = { operations: [{ op: 'drop' }, { op: 'drop' }] };
    const own = createCollectionIdentities(identities, known).get('operations', 2);
    carryCollectionIdentities(identities, config, known);
    expect(createCollectionIdentities(identities, known).get('operations', 2)).toBe(own);

    const unseen = { operations: [] };
    carryCollectionIdentities(identities, { operations: [] }, unseen);
    carryCollectionIdentities(identities, 'text', unseen);
    carryCollectionIdentities(identities, config, undefined);
    expect(identities.snapshots.has(unseen)).toBe(false);
  });
});

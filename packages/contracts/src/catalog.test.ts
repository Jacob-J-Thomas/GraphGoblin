import { describe, expect, it } from 'vitest';
import { ModelCatalogEntrySchema } from './index.js';

describe('catalog contracts', () => {
  it.each(['harness', 'litellm'])('accepts %s source and preserves enabled', (source) => {
    expect(
      ModelCatalogEntrySchema.parse({
        harness: 'provider',
        model: 'local',
        source,
        displayName: 'Local',
        efforts: ['low'],
        defaultEffort: 'low',
        enabled: false,
      }),
    ).toMatchObject({ source, enabled: false });
  });
  it('rejects unknown ownership and requires source', () => {
    const entry = {
      harness: 'codex',
      model: 'm',
      displayName: 'M',
      efforts: ['low'],
      defaultEffort: 'low',
      enabled: true,
    };
    expect(ModelCatalogEntrySchema.safeParse(entry).success).toBe(false);
    expect(ModelCatalogEntrySchema.safeParse({ ...entry, source: 'user' }).success).toBe(false);
  });
});

import type { ModelCatalogEntry } from '@graphgoblin/contracts';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_CATALOG, projectStartupModelCatalog } from './settings.js';

describe('startup model catalog projection', () => {
  it('projects all shipped seeds for an empty catalog without changing the seeds', () => {
    const before = structuredClone(DEFAULT_MODEL_CATALOG);
    const projected = projectStartupModelCatalog(Object.freeze([]));
    expect(projected).toEqual(before);
    expect(projected).not.toBe(DEFAULT_MODEL_CATALOG);
    expect(DEFAULT_MODEL_CATALOG).toEqual(before);
  });

  it('preserves stored order, metadata and disabled rows, then appends only missing pairs', () => {
    const stored: ModelCatalogEntry[] = [
      {
        harness: 'codex',
        model: 'gpt-6.1-terra',
        source: 'harness',
        displayName: 'Stored Terra',
        efforts: ['high'],
        defaultEffort: 'high',
        enabled: false,
      },
      {
        harness: 'custom',
        model: 'gpt-6-luna',
        source: 'litellm',
        displayName: 'Same name in another harness',
        efforts: ['low'],
        defaultEffort: 'low',
        enabled: true,
      },
    ];
    const before = structuredClone(stored);
    for (const entry of stored) {
      Object.freeze(entry.efforts);
      Object.freeze(entry);
    }
    const projected = projectStartupModelCatalog(Object.freeze(stored));
    expect(projected.slice(0, stored.length)).toEqual(before);
    expect(projected.slice(stored.length)).toEqual(
      DEFAULT_MODEL_CATALOG.filter(
        (entry) => !(entry.harness === 'codex' && entry.model === 'gpt-6.1-terra'),
      ),
    );
    expect(projected.filter((entry) => entry.model === 'gpt-6-luna')).toHaveLength(2);
    expect(stored).toEqual(before);
    expect(projectStartupModelCatalog(projected)).toEqual(projected);
  });
});

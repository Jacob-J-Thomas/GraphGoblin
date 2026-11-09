import { describe, expect, it } from 'vitest';
import { openMemoryDatabase } from './db.js';
import { SqliteOllamaRepository } from './ollama.js';
import { SqliteModelCatalog } from './settings.js';
import { modelDiscovery } from './schema.js';
import { OLLAMA_CONTEXT_PROFILE } from '../ollama/context.js';
import { discoveredModel } from '../ollama/discovery.js';
const at = '2026-11-07T00:00:00.000Z';
const later = '2026-11-07T00:05:00.000Z';
const qualifiedModel = (...args: Parameters<typeof discoveredModel>) => ({
  ...discoveredModel(...args),
  contextProfile: OLLAMA_CONTEXT_PROFILE,
});
const defaults = { enabled: true, baseUrl: 'http://localhost:11434' };
describe('Ollama discovery persistence', () => {
  it('atomically reconciles metadata and owner preferences, including missing/reappearing/unsupported', async () => {
    const handle = await openMemoryDatabase();
    const repository = new SqliteOllamaRepository(handle.db);
    const catalog = new SqliteModelCatalog(handle.db);
    try {
      expect(await repository.read(defaults)).toEqual({
        connection: { ...defaults, revision: 1 },
        discovery: { state: 'idle' },
      });
      expect(await repository.cached(1)).toEqual([]);
      expect(await repository.markRefreshing(1, at)).toBe(true);
      const model = qualifiedModel('namespace/qwen:tag', 'd', 1, at, {
        capabilities: ['completion'],
      });
      expect(await repository.reconcile(1, at, [model])).toBe(true);
      expect(await catalog.findOne('ollama', model.model)).toMatchObject({
        enabled: true,
        source: 'harness',
        availability: { state: 'available' },
      });
      expect(await catalog.isAllowed('ollama', model.model, 'none')).toBe(true);
      expect(await catalog.setEnabled('ollama', model.model, false)).toMatchObject({
        enabled: false,
        availability: { state: 'available' },
      });
      expect(await repository.reconcile(1, later, [])).toBe(true);
      expect(await catalog.findOne('ollama', model.model)).toMatchObject({
        enabled: false,
        availability: { state: 'missing' },
      });
      expect(await catalog.isAllowed('ollama', model.model, 'none')).toBe(false);
      await repository.reconcile(1, later, [model]);
      expect((await repository.cached(1))[0]).toMatchObject({
        enabled: false,
        availability: { state: 'available' },
      });
      const unsupported = qualifiedModel('embed:latest', 'e', 1, at, {
        capabilities: ['embedding'],
      });
      await repository.reconcile(1, later, [model, unsupported]);
      expect((await catalog.list()).filter((entry) => entry.harness === 'ollama')).toHaveLength(2);
      expect(await catalog.isAllowed('ollama', unsupported.model)).toBe(false);
      await repository.fail(1, later, { code: 'OFFLINE', message: 'Service unavailable' });
      expect((await repository.read(defaults)).discovery).toEqual({
        state: 'error',
        lastAttemptAt: later,
        lastSuccessAt: later,
        error: { code: 'OFFLINE', message: 'Service unavailable' },
      });
      expect(await repository.cached(1)).toHaveLength(2);
      await repository.markRefreshing(1, later);
      expect((await repository.read(defaults)).discovery).toEqual({
        state: 'refreshing',
        lastAttemptAt: later,
        lastSuccessAt: later,
      });
    } finally {
      handle.close();
    }
  });
  it('keeps old or stale policy snapshots visible but unavailable until a complete qualified scan', async () => {
    const handle = await openMemoryDatabase();
    const repository = new SqliteOllamaRepository(handle.db);
    const catalog = new SqliteModelCatalog(handle.db);
    try {
      await repository.read(defaults);
      const old = discoveredModel('qwen:old', 'digest', 1, at, { capabilities: ['completion'] });
      await repository.reconcile(1, at, [old]);
      await catalog.setEnabled('ollama', old.model, false);
      expect(await catalog.findOne('ollama', old.model)).toMatchObject({
        enabled: false,
        availability: { state: 'unsupported', reason: expect.stringContaining('unverified') },
      });
      expect(await catalog.isAllowed('ollama', old.model, 'none')).toBe(false);
      await repository.reconcile(1, later, [{ ...old, contextProfile: 'obsolete-policy' }]);
      expect((await repository.cached(1))[0]?.availability.state).toBe('unsupported');
      await repository.reconcile(1, later, [{ ...old, contextProfile: OLLAMA_CONTEXT_PROFILE }]);
      expect(await catalog.findOne('ollama', old.model)).toMatchObject({
        enabled: false,
        availability: { state: 'available' },
      });
      expect((await repository.cached(1))[0]?.contextProfile).toBe(OLLAMA_CONTEXT_PROFILE);
    } finally {
      handle.close();
    }
  });

  it('guards revision commits and invalidates old connection availability without losing catalog choices', async () => {
    const handle = await openMemoryDatabase();
    const repository = new SqliteOllamaRepository(handle.db);
    const catalog = new SqliteModelCatalog(handle.db);
    try {
      expect(await repository.markRefreshing(1, at)).toBe(false);
      expect(await repository.reconcile(1, at, [])).toBe(false);
      await repository.fail(1, at, { code: 'NONE', message: 'Not initialized' });
      await repository.configure(defaults, at);
      const model = qualifiedModel('a:tag', 'd', 1, at, { capabilities: ['completion'] });
      await repository.reconcile(1, at, [model]);
      await catalog.setEnabled('ollama', model.model, false);
      const changed = await repository.configure(
        { enabled: false, baseUrl: 'https://models.example' },
        later,
      );
      expect(changed.connection.revision).toBe(2);
      expect(await catalog.findOne('ollama', model.model)).toMatchObject({
        enabled: false,
        availability: { state: 'missing' },
      });
      expect(await repository.cached(2)).toEqual([]);
      expect(await repository.markRefreshing(2, later)).toBe(false);
      expect(await repository.reconcile(1, later, [model])).toBe(false);
      expect(await repository.reconcile(2, later, [model])).toBe(false);
      await repository.fail(1, later, { code: 'STALE', message: 'Old server' });
      await repository.fail(2, later, { code: 'DISABLED', message: 'Disabled server' });
      expect((await repository.read(defaults)).discovery.state).toBe('idle');
      const enabled = await repository.configure(
        { enabled: true, baseUrl: 'https://models.example' },
        later,
      );
      await repository.reconcile(enabled.connection.revision, later, [model]);
      expect(await catalog.findOne('ollama', model.model)).toMatchObject({
        enabled: false,
        availability: { state: 'available' },
      });
    } finally {
      handle.close();
    }
  });
  it('computes off and new-address availability without overwriting the stored snapshot or owner choice', async () => {
    const handle = await openMemoryDatabase();
    const repository = new SqliteOllamaRepository(handle.db);
    const catalog = new SqliteModelCatalog(handle.db);
    try {
      const row = qualifiedModel('qwen:tag', 'digest', 1, at, { capabilities: ['completion'] });
      await catalog.upsert({
        harness: 'ollama',
        source: 'harness',
        model: row.model,
        displayName: row.model,
        enabled: false,
        efforts: ['none'],
        defaultEffort: 'none',
      });
      expect(await catalog.findOne('ollama', row.model)).toMatchObject({
        enabled: false,
        availability: { state: 'missing', reason: 'Not yet listed at the new address' },
      });
      await repository.read(defaults);
      await repository.reconcile(1, at, [row]);
      const stored = await handle.db.select().from(modelDiscovery);
      await repository.configure({ ...defaults, enabled: false }, later);
      expect(await handle.db.select().from(modelDiscovery)).toEqual(stored);
      expect(await catalog.findOne('ollama', row.model)).toMatchObject({
        enabled: false,
        availability: { state: 'missing', reason: 'Ollama is off in Settings' },
      });
      expect((await repository.cached(1))[0]?.availability.reason).toBe(
        'Ollama is off in Settings',
      );
      expect(await catalog.isAllowed('ollama', row.model, 'none')).toBe(false);
      await repository.configure({ enabled: true, baseUrl: 'https://new.example' }, later);
      await repository.fail(3, later, { code: 'OFFLINE', message: 'New address is offline' });
      expect(await handle.db.select().from(modelDiscovery)).toEqual(stored);
      expect((await catalog.list())[0]).toMatchObject({
        enabled: false,
        availability: { state: 'missing', reason: 'Not yet listed at the new address' },
      });
      await repository.fail(1, later, { code: 'OLD', message: 'Old failure' });
      expect((await repository.read(defaults)).discovery.error?.code).toBe('OFFLINE');
      expect(await repository.markRefreshing(1, later)).toBe(false);
      await repository.reconcile(3, later, [row]);
      expect(await catalog.findOne('ollama', row.model)).toMatchObject({
        enabled: false,
        availability: { state: 'available' },
      });
    } finally {
      handle.close();
    }
  });
});

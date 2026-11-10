import { afterEach, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import {
  instanceIdentity,
  launcherRuntimeSupported,
  launcherStoreState,
} from './instance-identity.js';
import * as ownership from './data-dir-lock.js';
import { createTestApp, type TestApp } from './testing/test-app.js';

let testApp: TestApp | undefined;
afterEach(async () => {
  await testApp?.close();
  vi.restoreAllMocks();
});

it('checks both the data directory and external database with the shared read-only policy', async () => {
  const directory = vi.spyOn(ownership, 'dataDirLockState').mockResolvedValue({ state: 'free' });
  const database = vi
    .spyOn(ownership, 'databaseLockState')
    .mockResolvedValue({ state: 'held', path: 'external.db.graphgoblin.lock' });
  const config = loadConfig({ GG_DATA_DIR: '/test/store', GG_DB_URL: 'file:/external.db' });
  expect(await launcherStoreState(config)).toBe('held');
  expect(database).toHaveBeenCalledWith(resolve('/external.db'));
  database.mockResolvedValue({ state: 'free' });
  expect(await launcherStoreState(config)).toBe('free');
  expect(await launcherStoreState({ ...config, dbUrl: ':memory:' })).toBe('free');
  directory.mockResolvedValue({ state: 'held', path: 'graphgoblin.lock.reclaim' });
  database.mockClear();
  expect(await launcherStoreState(config)).toBe('held');
  expect(database).not.toHaveBeenCalled();
});

it.each(['22.22.2', '22.23.4', '22.99.0'])('accepts launcher runtime %s', (version) => {
  expect(launcherRuntimeSupported(version)).toBe(true);
});
it.each(['22.22.1', '22.21.9', '23.0.0', '21.99.0', 'invalid', '22'])(
  'refuses launcher runtime %s',
  (version) => {
    expect(launcherRuntimeSupported(version)).toBe(false);
  },
);

it('identifies runtime configuration and the actual database, without fingerprinting secrets', () => {
  const config = loadConfig({ GG_DATA_DIR: '/test/store' });
  const identity = instanceIdentity(config);
  expect(identity).toMatch(/^[a-f0-9]{64}$/);
  expect(instanceIdentity({ ...config })).toBe(identity);
  expect(
    instanceIdentity({
      ...config,
      masterKey: 'private',
      jevApiKey: { value: 'private', source: 'GG_JEV_API_KEY' },
    }),
  ).toBe(identity);
  for (const changed of [
    { dataDir: '/other' },
    { dbUrl: 'file:/external.db' },
    { port: 4832 },
    { webDist: '/other/web' },
    { goblinDist: '/other/goblin' },
    { requireApiKey: true },
  ]) {
    expect(instanceIdentity({ ...config, ...changed })).not.toBe(identity);
  }
});

it('publishes opaque identity and current shutdown phase on the public health probe', async () => {
  testApp = await createTestApp({ env: { GG_REQUIRE_API_KEY: 'true' } });
  const health = await testApp.app.inject({ method: 'GET', url: '/healthz' });
  expect(health.statusCode).toBe(200);
  expect(health.json()).toEqual({ status: 'ok' });
  expect(health.headers['x-graphgoblin-instance']).toBe(instanceIdentity(testApp.container.config));
  expect(health.headers['x-graphgoblin-pid']).toBe(String(process.pid));
  expect(health.headers['x-graphgoblin-phase']).toBe('running');
});

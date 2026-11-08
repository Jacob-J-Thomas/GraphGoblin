import { afterEach, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { instanceIdentity, launcherRuntimeSupported } from './instance-identity.js';
import { createTestApp, type TestApp } from './testing/test-app.js';

let testApp: TestApp | undefined;
afterEach(async () => testApp?.close());

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

// <repo> evidence-only copy of the public testing composition, using built packages.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp, createContainer, loadConfig } from '../../../../apps/api/dist/index.js';
import {
  CapturingLogger,
  FakeClock,
  FakeDecider,
  FakeClassifier,
  FakeClassifierRegistry,
  FakeHarness,
  FakeStructured,
} from '../../../../packages/engine/dist/testing/index.js';
export const qaStores = [];
export async function createTestApp(options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'gg-qa-204-r3-edge-'));
  const store = { directory: dataDir.split(/[\\/]/).at(-1), appClosed: false };
  qaStores.push(store);
  const config = loadConfig({
    GG_DATA_DIR: dataDir,
    GG_DB_URL: ':memory:',
    GG_SWAGGER_UI: 'false',
    GG_REQUIRE_API_KEY: 'false',
    GG_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
    ...options.env,
  });
  const harness = new FakeHarness(),
    jev = new FakeClassifier('jev'),
    codex = new FakeDecider('codex'),
    structured = new FakeStructured(),
    logger = new CapturingLogger(),
    clock = new FakeClock();
  const container = await createContainer(config, {
    harnesses: options.harnesses ?? { codex: harness },
    deciders: [codex],
    classifiers: new FakeClassifierRegistry(jev),
    structured,
    startTimers: false,
    logger,
    clock,
  });
  await container.start();
  const app = await buildApp(container, { logger: false });
  await app.ready();
  return {
    app,
    container,
    harness,
    jev,
    codex,
    structured,
    logger,
    clock,
    dataDir,
    async close() {
      await app.close();
      await container.stop();
      store.appClosed = true;
    },
  };
}

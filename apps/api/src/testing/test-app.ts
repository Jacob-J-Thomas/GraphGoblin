import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HarnessId, LoopDefinitionInput } from '@graphgoblin/contracts';
import type { HarnessPort } from '@graphgoblin/engine';
import {
  CapturingLogger,
  FakeClock,
  FakeDecider,
  FakeClassifierRegistry,
  FakeHarness,
  FakeStructured,
} from '@graphgoblin/engine/testing';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createContainer, type Container } from '../container.js';
import type { ApiInstance } from '../types.js';
export {
  startFakeClassifierEndpoint,
  type FakeClassifierRequest,
  type FakeClassifierResponse,
} from './fake-classifier.js';

export interface TestApp {
  app: ApiInstance;
  container: Container;
  harness: FakeHarness;
  jev: FakeDecider;
  codex: FakeDecider;
  structured: FakeStructured;
  logger: CapturingLogger;
  clock: FakeClock;
  dataDir: string;
  /** Create a loop from a definition and publish it; returns the loop id. */
  publishLoop(definition: LoopDefinitionInput, headers?: Record<string, string>): Promise<string>;
  idle(): Promise<void>;
  close(): Promise<void>;
}

export interface TestAppOptions {
  harnesses?: Partial<Record<HarnessId, HarnessPort>>;
  requireApiKey?: boolean;
  env?: Record<string, string>;
  /** Exercise real catalog/secret resolution and HTTP transport, retaining fake Codex. */
  realClassifiers?: boolean;
}

/** An API over an in-memory database with fake harness, deciders, and structured completion. */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const dataDir = await mkdtemp(join(tmpdir(), 'gg-api-'));
  const config = loadConfig({
    GG_DATA_DIR: dataDir,
    GG_DB_URL: ':memory:',
    GG_SWAGGER_UI: 'false',
    GG_REQUIRE_API_KEY: options.requireApiKey ? 'true' : 'false',
    GG_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
    ...options.env,
  });
  const harness = new FakeHarness();
  const jev = new FakeDecider('jev');
  const codex = new FakeDecider('codex');
  const structured = new FakeStructured();
  const logger = new CapturingLogger();
  const clock = new FakeClock();
  const container = await createContainer(config, {
    harnesses: options.harnesses ?? { codex: harness },
    deciders: [codex],
    ...(!options.realClassifiers ? { classifiers: new FakeClassifierRegistry(jev) } : {}),
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
    async publishLoop(definition, headers = {}) {
      const created = await app.inject({
        method: 'POST',
        url: '/loops',
        payload: { definition },
        headers,
      });
      if (created.statusCode !== 201) throw new Error(`create loop failed: ${created.body}`);
      const id = created.json<{ loop: { id: string } }>().loop.id;
      const published = await app.inject({ method: 'POST', url: `/loops/${id}/publish`, headers });
      if (published.statusCode !== 200) throw new Error(`publish failed: ${published.body}`);
      return id;
    },
    idle: () => container.manager.waitForIdle(),
    async close() {
      await app.close();
      await container.stop();
      await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

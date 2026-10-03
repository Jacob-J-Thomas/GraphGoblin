import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContextThread, LoopDefinitionInput, RunEvent, RunRecord } from '@graphgoblin/contracts';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createContainer } from './container.js';

/**
 * Live smoke through the whole API with the real Codex adapter: no harness overrides, so the
 * container wires `@graphgoblin/adapter-codex`. Costs one Codex turn on the owner's subscription,
 * so it runs only with `LIVE=1`; otherwise it is collected and skipped.
 *
 *   LIVE=1 pnpm --filter @graphgoblin/api test -- src/live.test.ts
 */
const live = process.env.LIVE === '1';

describe.skipIf(!live)('API live smoke with the real Codex adapter', () => {
  it('runs trigger -> inference -> exit through Codex and records usage', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'gg-live-data-'));
    const workDir = await mkdtemp(join(tmpdir(), 'gg-live-work-'));
    const config = loadConfig({
      GG_DATA_DIR: dataDir,
      GG_DB_URL: ':memory:',
      GG_SWAGGER_UI: 'false',
      GG_MASTER_KEY: Buffer.alloc(32, 5).toString('base64'),
      GG_DEFAULT_MODEL: 'gpt-6-luna',
      GG_DEFAULT_EFFORT: 'low',
    });
    const container = await createContainer(config, { startTimers: false });
    await container.start();
    const app = await buildApp(container, { logger: false });
    await app.ready();
    try {
      const definition: LoopDefinitionInput = {
        schemaVersion: 1,
        name: 'live-smoke',
        settings: { workingDirectory: { kind: 'fixed', path: workDir } },
        nodes: [
          { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } },
          {
            id: 'ask',
            kind: 'inference',
            label: 'Ask',
            config: {
              model: 'gpt-6-luna',
              effort: 'low',
              harnessOptions: { sandbox: 'read-only', approval: 'never' },
              prompt: { template: 'Reply with exactly the single word OK and nothing else.' },
              timeoutSeconds: 240,
            },
          },
          { id: 'done', kind: 'exit', label: 'Done', config: {} },
        ],
        edges: [
          { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'ask' } },
          { id: 'e2', from: { node: 'ask', port: 'out' }, to: { node: 'done' } },
        ],
      };
      const created = await app.inject({ method: 'POST', url: '/loops', payload: { definition } });
      expect(created.statusCode).toBe(201);
      const loopId = created.json<{ loop: { id: string } }>().loop.id;
      expect((await app.inject({ method: 'POST', url: `/loops/${loopId}/publish` })).statusCode).toBe(
        200,
      );
      const started = await app.inject({
        method: 'POST',
        url: `/loops/${loopId}/runs`,
        payload: {},
      });
      const { run } = started.json<{ run: RunRecord }>();
      await container.manager.waitForIdle();

      const final = (await app.inject(`/runs/${run.id}`)).json<RunRecord>();
      const thread = (await app.inject(`/runs/${run.id}/thread`)).json<ContextThread>();
      const events = (await app.inject(`/runs/${run.id}/events?limit=1000`)).json<{
        items: RunEvent[];
      }>().items;
      const assistant = thread.messages.filter((m) => m.role === 'assistant');
      const usage = events.filter((e) => e.type === 'harness.usage');
      console.warn(
        '[live] api smoke',
        JSON.stringify({
          status: final.status,
          failure: final.failure,
          assistant: assistant.map((m) => m.content),
          eventTypes: events.map((e) => e.type),
          usage,
        }),
      );
      expect(final.status).toBe('succeeded');
      expect(assistant.at(-1)?.content.trim()).toMatch(/^OK\.?$/i);
      expect(usage.length).toBeGreaterThan(0);
    } finally {
      await app.close();
      await container.stop();
      await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }, 300_000);
});

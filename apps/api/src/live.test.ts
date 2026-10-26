import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ContextThread,
  LoopDefinitionInput,
  ModelCatalogEntry,
  RunEvent,
  RunRecord,
} from '@graphgoblin/contracts';
import { CLAUDE_HAIKU_MODEL, CLAUDE_SONNET_MODEL } from '@graphgoblin/infrastructure/claude';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createContainer, type Container } from './container.js';

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
      GG_DEFAULTS: JSON.stringify({ byHarness: { codex: { model: 'gpt-6-luna', effort: 'low' } } }),
    });
    const container = await createContainer(config, { startTimers: false });
    await container.start();
    const app = await buildApp(container, { logger: false });
    await app.ready();
    try {
      const definition: LoopDefinitionInput = {
        schemaVersion: CURRENT_DEFINITION_FORMAT,
        name: 'live-smoke',
        settings: { workingDirectory: { kind: 'fixed', path: workDir } },
        nodes: [
          { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
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
      expect(
        (await app.inject({ method: 'POST', url: `/loops/${loopId}/publish` })).statusCode,
      ).toBe(200);
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

/**
 * One real turn per added Claude model (#206) through the container's own Claude adapter and the
 * owner-installed CLI login: no harness overrides, a disposable data directory, an in-memory
 * database and a temporary read-only working directory. Each test costs one subscription turn, so
 * the block runs only with `LIVE_CLAUDE=1` on native Windows, separately from the Codex smoke.
 * Name the file directly so only this file runs:
 *
 *   LIVE_CLAUDE=1 pnpm --filter @graphgoblin/api exec vitest run src/live.test.ts
 *
 * Effort is the catalog row's suggested default effort, set explicitly on the node because
 * execution never infers it from the catalog. A succeeded run means the adapter accepted the CLI
 * init record and result usage, which must both report exactly the requested model.
 */
const liveClaude = process.env.LIVE_CLAUDE === '1' && process.platform === 'win32';

describe.skipIf(!liveClaude)('API live smoke with the installed Claude CLI', () => {
  let dataDir: string;
  let container: Container;
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'gg-live-claude-data-'));
    container = await createContainer(
      loadConfig({
        GG_DATA_DIR: dataDir,
        GG_DB_URL: ':memory:',
        GG_SWAGGER_UI: 'false',
        GG_MASTER_KEY: Buffer.alloc(32, 6).toString('base64'),
      }),
      { startTimers: false },
    );
    await container.start();
    app = await buildApp(container, { logger: false });
    await app.ready();
  }, 60_000);
  afterAll(async () => {
    await app.close();
    await container.stop();
    await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it.each([CLAUDE_SONNET_MODEL, CLAUDE_HAIKU_MODEL])(
    'runs trigger -> %s inference -> exit and records the requested model and effort',
    async (model) => {
      const workDir = await mkdtemp(join(tmpdir(), 'gg-live-claude-work-'));
      try {
        const catalog = (await app.inject('/model-catalog')).json<{
          items: ModelCatalogEntry[];
        }>().items;
        const entry = catalog.find((item) => item.harness === 'claude' && item.model === model);
        expect(entry).toMatchObject({ enabled: true });
        const effort = entry!.defaultEffort;
        const definition: LoopDefinitionInput = {
          schemaVersion: CURRENT_DEFINITION_FORMAT,
          name: 'live-claude-' + model,
          settings: { workingDirectory: { kind: 'fixed', path: workDir } },
          nodes: [
            { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
            {
              id: 'ask',
              kind: 'inference',
              label: 'Ask',
              config: {
                harness: 'claude',
                model,
                effort,
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
        const created = await app.inject({
          method: 'POST',
          url: '/loops',
          payload: { definition },
        });
        expect(created.statusCode, created.body).toBe(201);
        const loopId = created.json<{ loop: { id: string } }>().loop.id;
        const published = await app.inject({ method: 'POST', url: `/loops/${loopId}/publish` });
        expect(published.statusCode, published.body).toBe(200);
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
        const session = events.find((event) => event.type === 'harness.session');
        const transcript = thread.artifacts.find((artifact) => artifact.kind === 'transcript');
        const items = transcript
          ? (await app.inject(`/runs/${run.id}/artifacts/${transcript.id}`)).json<
              { id: string; detail?: Record<string, unknown> }[]
            >()
          : [];
        const policy = items.find((item) => item.id === 'claude-policy')?.detail;
        const assistant = thread.messages.filter((m) => m.role === 'assistant');
        console.warn(
          '[live] claude smoke',
          JSON.stringify({
            model,
            status: final.status,
            failure: final.failure,
            session,
            policy: policy && {
              requestedModel: policy['requestedModel'],
              requestedEffort: policy['requestedEffort'],
              effectiveEffort: policy['effectiveEffort'],
              authMethod: policy['authMethod'],
              sandbox: policy['sandbox'],
              tools: policy['tools'],
            },
            assistant: assistant.map((m) => m.content),
            usage: events.filter((event) => event.type === 'harness.usage'),
          }),
        );
        expect(final.status).toBe('succeeded');
        expect(session).toMatchObject({ harness: 'claude', mode: 'fresh', model, effort });
        expect(policy).toMatchObject({
          requestedModel: model,
          requestedEffort: effort,
          effectiveEffort: null,
          authMethod: 'claude.ai',
        });
        expect(assistant.at(-1)?.content.trim()).toMatch(/^OK\.?$/i);
      } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      }
    },
    300_000,
  );
});

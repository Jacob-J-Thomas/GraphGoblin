import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CURRENT_DEFINITION_FORMAT,
  type LoopDefinitionInput,
  type LoopVersionRecord,
  type RunEvent,
  type RunRecord,
} from '@graphgoblin/contracts';
import {
  FakeClassifier,
  FakeClassifierRegistry,
  FakeDecider,
  FakeHarness,
} from '@graphgoblin/engine/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createContainer, type Container } from './container.js';
import { startFakeClassifierEndpoint } from './testing/test-app.js';
import type { ApiInstance } from './types.js';

/**
 * ADR-0041 over the real API and SQLite store: published and draft runs keep the definition and
 * inherited defaults they started with through edits, publishes, Settings changes and a restart.
 */

/** start -> ask (input) -> shape (vars.mark) [-> think] -> done (returns vars.mark). */
function definition(mark: string, think = false): LoopDefinitionInput {
  return {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name: 'Pinned',
    variables: { mark: { type: 'string' } },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      { id: 'ask', kind: 'wait', label: 'Ask', config: { mode: 'input', prompt: 'Go?' } },
      {
        id: 'shape',
        kind: 'mutate',
        label: 'Shape',
        config: {
          operations: [{ op: 'set', path: '/vars/mark', value: { kind: 'literal', value: mark } }],
        },
      },
      ...(think
        ? [
            {
              id: 'think',
              kind: 'inference' as const,
              label: 'Think',
              config: { prompt: { template: 'x' } },
            },
          ]
        : []),
      { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'vars.mark' } },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'ask' } },
      { id: 'e2', from: { node: 'ask', port: 'out' }, to: { node: 'shape' } },
      ...(think
        ? [
            { id: 'e3', from: { node: 'shape', port: 'out' }, to: { node: 'think' } },
            { id: 'e4', from: { node: 'think', port: 'out' }, to: { node: 'done' } },
          ]
        : [{ id: 'e3', from: { node: 'shape', port: 'out' }, to: { node: 'done' } }]),
    ],
  };
}

let dataDir: string;
let container: Container | undefined;
let app: ApiInstance | undefined;
let harness: FakeHarness;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'gg-pins-'));
  harness = new FakeHarness();
});

afterEach(async () => {
  await close();
  await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
});

/**
 * Open the API over the file store in `dataDir`: a fresh container each time, with recovery. With
 * `realClassifiers` the container composes its own catalog-backed classifier registry.
 */
async function open(
  env: Record<string, string> = {},
  realClassifiers = false,
): Promise<ApiInstance> {
  const config = loadConfig({
    GG_DATA_DIR: dataDir,
    GG_DB_URL: `file:${join(dataDir, 'gg.db').replace(/\\/g, '/')}`,
    GG_SWAGGER_UI: 'false',
    GG_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
    ...env,
  });
  container = await createContainer(config, {
    harnesses: { codex: harness },
    deciders: [new FakeDecider('codex')],
    ...(realClassifiers
      ? {}
      : { classifiers: new FakeClassifierRegistry(new FakeClassifier('jev')) }),
    startTimers: false,
  });
  await container.start();
  app = await buildApp(container, { logger: false });
  await app.ready();
  return app;
}

async function close(): Promise<void> {
  await app?.close();
  // Physical store handoff; managed normal stop deliberately waits for these parked runs.
  await container?.stop();
  app = undefined;
  container = undefined;
}

async function call<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  url: string,
  payload?: unknown,
  status = method === 'POST' && url.endsWith('/runs')
    ? 202
    : method === 'POST' && url === '/loops'
      ? 201
      : 200,
): Promise<T> {
  const response = await app!.inject({
    method,
    url,
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
  expect(response.statusCode, response.body).toBe(status);
  return response.json<T>();
}

async function idle(): Promise<void> {
  await container!.manager.waitForIdle();
}

const run = (id: string) => call<RunRecord>('GET', `/runs/${id}`);
/** Answer the run's current input wait with `true`, binding the answer to the observed wait identity. */
const answer = async (id: string) => {
  const waiting = await run(id);
  await call('POST', `/runs/${id}/input`, { waitId: waiting.waiting!.waitId, input: true });
};
const events = async (id: string) =>
  (await call<{ items: RunEvent[] }>('GET', `/runs/${id}/events`)).items;

describe('runs pin their definition across edits, Settings changes and a restart', () => {
  it(
    'keeps published and draft runs on their start definition and defaults',
    { timeout: 180_000 },
    async () => {
      await open();
      const { loop } = await call<{ loop: { id: string } }>('POST', '/loops', {
        definition: definition('old', true),
      });
      const v1 = (await call<{ version: LoopVersionRecord }>('POST', `/loops/${loop.id}/publish`))
        .version;
      const { draft } = await call<{ draft: LoopVersionRecord }>('PUT', `/loops/${loop.id}/draft`, {
        definition: definition('old', true),
      });

      // Start endpoints answer with the pin.
      const published = (await call<{ run: RunRecord }>('POST', `/loops/${loop.id}/runs`, {})).run;
      expect(published).toMatchObject({
        versionId: v1.id,
        pinned: {
          source: 'published',
          version: 1,
          name: 'Pinned',
          label: 'Pinned v1',
          defaults: {
            owner: { byHarness: {} },
            process: { byHarness: { codex: { model: 'gpt-6-luna', effort: 'low' } } },
          },
        },
      });
      const drafted = (
        await call<{ run: RunRecord }>('POST', `/loops/${loop.id}/runs`, {
          versionId: draft.id,
          allowDraft: true,
        })
      ).run;
      expect(drafted.versionId).not.toBe(draft.id);
      expect(drafted.pinned).toMatchObject({
        source: 'draft',
        version: 2,
        label: 'Pinned draft v2',
      });
      await idle();
      for (const started of [published, drafted]) {
        expect((await run(started.id)).status).toBe('waiting');
        expect((await events(started.id))[0]).toMatchObject({
          type: 'run.queued',
          versionId: started.versionId,
          pinned: started.pinned,
        });
      }
      // The inspector reads the draft run's own frozen definition, never the live draft.
      const snapshotUrl = `/loops/${loop.id}/versions/${drafted.versionId}`;
      expect(await call<LoopVersionRecord>('GET', snapshotUrl)).toMatchObject({
        status: 'snapshot',
        version: 2,
        definition: { nodes: expect.arrayContaining([expect.objectContaining({ id: 'shape' })]) },
      });
      // A snapshot is not a startable version, and not part of the version history.
      const refused = await app!.inject({
        method: 'POST',
        url: `/loops/${loop.id}/runs`,
        payload: { versionId: drafted.versionId, allowDraft: true },
      });
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({ code: 'VERSION_NOT_PUBLISHED' });
      const history = await call<{ items: LoopVersionRecord[] }>(
        'GET',
        `/loops/${loop.id}/versions`,
      );
      expect(history.items.map((version) => version.id)).not.toContain(drafted.versionId);

      // While both wait: the draft is edited and published, and Settings defaults change.
      await call('PUT', `/loops/${loop.id}/draft`, { definition: definition('new', true) });
      const v2 = (await call<{ version: LoopVersionRecord }>('POST', `/loops/${loop.id}/publish`))
        .version;
      await call('PUT', '/settings', {
        defaults: { byHarness: { codex: { model: 'gpt-6-sol', effort: 'high' } } },
      });
      const snapshotBefore = await call<LoopVersionRecord>('GET', snapshotUrl);

      // The process restarts with different process defaults; recovery runs at start.
      await close();
      await open({
        GG_DEFAULTS: JSON.stringify({
          byHarness: { codex: { model: 'gpt-6-astra', effort: 'max' } },
        }),
      });
      for (const started of [published, drafted]) {
        await answer(started.id);
        await idle();
        const finished = await run(started.id);
        expect(finished).toMatchObject({
          status: 'succeeded',
          result: 'old',
          versionId: started.versionId,
          pinned: started.pinned,
        });
      }
      expect(harness.started.map(({ model, effort }) => `${model}/${effort}`)).toEqual([
        'gpt-6-luna/low',
        'gpt-6-luna/low',
      ]);
      expect(await call<LoopVersionRecord>('GET', snapshotUrl)).toEqual(snapshotBefore);

      // New runs take the newest definition and the current defaults.
      const next = (await call<{ run: RunRecord }>('POST', `/loops/${loop.id}/runs`, {})).run;
      expect(next).toMatchObject({
        versionId: v2.id,
        pinned: {
          label: 'Pinned v2',
          defaults: {
            owner: { byHarness: { codex: { model: 'gpt-6-sol', effort: 'high' } } },
            process: { byHarness: { codex: { model: 'gpt-6-astra', effort: 'max' } } },
          },
        },
      });
      await idle();
      await answer(next.id);
      await idle();
      expect(await run(next.id)).toMatchObject({ status: 'succeeded', result: 'new' });
      expect(harness.started.at(-1)).toMatchObject({ model: 'gpt-6-sol', effort: 'high' });

      // A replay fork of the draft run executes the draft run's snapshot.
      const fork = (
        await call<{ run: RunRecord }>(
          'POST',
          `/runs/${drafted.id}/replay`,
          { nodeId: 'shape' },
          202,
        )
      ).run;
      expect(fork).toMatchObject({ versionId: drafted.versionId, pinned: drafted.pinned });
      await idle();
      expect(await run(fork.id)).toMatchObject({ status: 'succeeded', result: 'old' });
    },
  );
});

describe('classifier bindings are pinned at start', () => {
  /** start -> ask (input) -> decide (classifier `custom`) -> done, returning the chosen route. */
  const classified: LoopDefinitionInput = {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name: 'Classified',
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      { id: 'ask', kind: 'wait', label: 'Ask', config: { mode: 'input', prompt: 'Go?' } },
      {
        id: 'decide',
        kind: 'decision',
        label: 'Decide',
        config: {
          kind: 'classifier',
          model: 'custom',
          question: 'Which?',
          answer: {
            type: 'choice',
            options: [
              { id: 'yes', label: 'Yes', criteria: 'Yes' },
              { id: 'no', label: 'No', criteria: 'No' },
            ],
          },
        },
      },
      { id: 'yes', kind: 'exit', label: 'Yes', config: { returns: '"yes"' } },
      { id: 'no', kind: 'exit', label: 'No', config: { returns: '"no"' } },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'ask' } },
      { id: 'e2', from: { node: 'ask', port: 'out' }, to: { node: 'decide' } },
      { id: 'e3', from: { node: 'decide', port: 'yes' }, to: { node: 'yes' } },
      { id: 'e4', from: { node: 'decide', port: 'no' }, to: { node: 'no' } },
    ],
  };

  it(
    'calls the provider model a waiting run pinned, after a catalog edit and a restart',
    { timeout: 180_000 },
    async () => {
      const fixture = await startFakeClassifierEndpoint();
      const entry = (providerModel: string) => ({
        displayName: 'Custom',
        provider: 'http',
        providerModel,
        primitives: ['choice'],
        endpoint: fixture.endpoint,
      });
      try {
        await open({}, true);
        await call('PUT', '/classifier-models/custom', entry('model-original'));
        await call('PATCH', '/classifier-models/custom', { enabled: true });
        const { loop } = await call<{ loop: { id: string } }>('POST', '/loops', {
          definition: classified,
        });
        await call('POST', `/loops/${loop.id}/publish`);
        const started = (await call<{ run: RunRecord }>('POST', `/loops/${loop.id}/runs`, {})).run;
        expect(started.pinned.classifiers).toEqual({
          custom: {
            provider: 'http',
            providerModel: 'model-original',
            primitives: ['choice'],
            endpoint: fixture.endpoint,
          },
        });
        await idle();
        expect((await run(started.id)).status).toBe('waiting');

        // The owner edits the classifier while the run waits; the process restarts.
        await call('PUT', '/classifier-models/custom', entry('model-edited'));
        await close();
        await open({}, true);
        await answer(started.id);
        await idle();
        expect(await run(started.id)).toMatchObject({
          status: 'succeeded',
          result: 'yes',
          pinned: started.pinned,
        });
        expect(fixture.requests.map((request) => request.body.model)).toEqual(['model-original']);

        // A new run binds the edited entry.
        const next = (await call<{ run: RunRecord }>('POST', `/loops/${loop.id}/runs`, {})).run;
        expect(next.pinned.classifiers['custom']?.providerModel).toBe('model-edited');
        await idle();
        await answer(next.id);
        await idle();
        expect(fixture.requests.map((request) => request.body.model)).toEqual([
          'model-original',
          'model-edited',
        ]);

        // Disabling stays live for pinned runs: the next one fails explicitly, nothing else runs.
        const held = (await call<{ run: RunRecord }>('POST', `/loops/${loop.id}/runs`, {})).run;
        await idle();
        await call('PATCH', '/classifier-models/custom', { enabled: false });
        await answer(held.id);
        await idle();
        expect(await run(held.id)).toMatchObject({
          status: 'failed',
          failure: { code: 'EVALUATION_UNAVAILABLE', resumable: true },
        });
        expect(fixture.requests).toHaveLength(2);
      } finally {
        await fixture.close();
      }
    },
  );

  it(
    'starts and runs a classifier whose catalog id is an Object property name',
    { timeout: 180_000 },
    async () => {
      const fixture = await startFakeClassifierEndpoint();
      try {
        await open({}, true);
        await call('PUT', '/classifier-models/constructor', {
          displayName: 'Constructor',
          provider: 'http',
          providerModel: 'model-constructor',
          primitives: ['choice'],
          endpoint: fixture.endpoint,
        });
        await call('PATCH', '/classifier-models/constructor', { enabled: true });
        const definition = JSON.parse(
          JSON.stringify(classified).replace('"model":"custom"', '"model":"constructor"'),
        ) as LoopDefinitionInput;
        const { loop } = await call<{ loop: { id: string } }>('POST', '/loops', { definition });
        await call('POST', `/loops/${loop.id}/publish`);
        const started = (await call<{ run: RunRecord }>('POST', `/loops/${loop.id}/runs`, {})).run;
        expect(started.pinned.classifiers).toEqual({
          constructor: {
            provider: 'http',
            providerModel: 'model-constructor',
            primitives: ['choice'],
            endpoint: fixture.endpoint,
          },
        });
        await idle();
        await answer(started.id);
        await idle();
        expect(await run(started.id)).toMatchObject({ status: 'succeeded', result: 'yes' });
        expect(fixture.requests.map((request) => request.body.model)).toEqual([
          'model-constructor',
        ]);
      } finally {
        await fixture.close();
      }
    },
  );
});

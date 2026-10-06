import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LoopDefinitionSchema,
  type ClassifierModelSummary,
  type LoopDefinitionInput,
  type LoopIssue,
  type RunRecord,
} from '@graphgoblin/contracts';
import { FIXTURE_TS, minimalLoop } from '@graphgoblin/contracts/testing';
import { createJevDecider } from '@graphgoblin/adapter-jev';
import {
  createCodexDecider,
  createCodexHarness,
  createCodexStructured,
  type CodexThreadLike,
} from '@graphgoblin/adapter-codex';
import { BUILTIN_CLASSIFIER } from './classifier-registry.js';
import { createTestApp, startFakeClassifierEndpoint, type TestApp } from './testing/test-app.js';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp({ realClassifiers: true });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await t.close();
});
const metadata = {
  displayName: 'Local Kev',
  provider: 'http',
  providerModel: 'kev-native',
  primitives: ['choice'],
  endpoint: 'http://127.0.0.1:8008',
};
const upsert = (id = 'kev', input: Record<string, unknown> = metadata) =>
  t.app.inject({ method: 'PUT', url: `/classifier-models/${id}`, payload: input });
const toggle = (id: string, enabled: boolean) =>
  t.app.inject({ method: 'PATCH', url: `/classifier-models/${id}`, payload: { enabled } });
async function list() {
  return (await t.app.inject('/classifier-models')).json<{ items: ClassifierModelSummary[] }>()
    .items;
}

function decisionLoop(model?: string, fallback = true): LoopDefinitionInput {
  const definition = minimalLoop();
  return {
    ...definition,
    name: 'classifier-test',
    nodes: [
      definition.nodes[0]!,
      {
        id: 'decide',
        kind: 'decision',
        label: 'Choose team',
        config: {
          routes: [
            { label: 'yes', description: 'Approve' },
            { label: 'no', description: 'Reject' },
          ],
          question: 'Which team?',
          strategy: fallback ? ['jev', 'expression'] : ['jev'],
          ...(model ? { jev: { model } } : {}),
          ...(fallback ? { expression: { jsonata: '"no"' } } : {}),
        },
      },
      {
        id: 'done',
        kind: 'exit',
        label: 'Done',
        config: { return: { mapping: 'lastOutput.value.route' } },
      },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'decide' } },
      { id: 'e2', from: { node: 'decide', port: 'yes' }, to: { node: 'done' } },
      { id: 'e3', from: { node: 'decide', port: 'no' }, to: { node: 'done' } },
    ],
  };
}

describe('classifier catalog HTTP API', () => {
  it('requires secrets:write to attach a secret and permits settings-only edits that clear it', async () => {
    const fixture = await startFakeClassifierEndpoint();
    try {
      await t.container.repos.secretsFor('local').set('github-token', 'private-owner-token');
      const limited = await t.container.repos.apiKeys.create('local', 'settings only', [
        'settings:write',
      ]);
      const allowed = await t.container.repos.apiKeys.create('local', 'settings and secrets', [
        'settings:write',
        'secrets:write',
      ]);
      const put = (token: string, secretRef?: string) =>
        t.app.inject({
          method: 'PUT',
          url: '/classifier-models/kev',
          headers: { authorization: `Bearer ${token}` },
          payload: { ...metadata, endpoint: fixture.endpoint, ...(secretRef ? { secretRef } : {}) },
        });
      expect(
        (
          await t.app.inject({
            url: '/secrets',
            headers: { authorization: `Bearer ${limited.token}` },
          })
        ).statusCode,
      ).toBe(403);
      const rejected = await put(limited.token, 'github-token');
      expect(rejected.statusCode).toBe(403);
      expect(rejected.json()).toHaveProperty('code', 'FORBIDDEN');
      expect(await t.container.repos.classifiers.findOne('local', 'kev')).toBeUndefined();
      expect(fixture.requests).toEqual([]);
      expect((await put(allowed.token, 'github-token')).statusCode).toBe(200);
      await toggle('kev', true);
      const loopId = await t.publishLoop(decisionLoop('kev'));
      const run = async () => {
        await t.app.inject({ method: 'POST', url: `/loops/${loopId}/runs`, payload: {} });
        await t.idle();
      };
      await run();
      expect(fixture.requests[0]?.authorization).toBe('Bearer private-owner-token');
      expect((await put(limited.token, 'github-token')).statusCode).toBe(403);
      expect((await put(limited.token)).json()).toMatchObject({ enabled: true, configured: true });
      expect(await t.container.repos.classifiers.findOne('local', 'kev')).not.toHaveProperty(
        'secretRef',
      );
      await run();
      expect(fixture.requests[1]?.authorization).toBeUndefined();
    } finally {
      await fixture.close();
    }
  });
  it('returns a configured/enabled distinction and protects builtin metadata', async () => {
    expect(await list()).toEqual([
      {
        ...BUILTIN_CLASSIFIER,
        configured: false,
        configurationReason: "Missing or blank secret 'jev-api-key'. Set it in Settings, Secrets.",
      },
    ]);
    expect((await upsert('jev')).json()).toMatchObject({
      code: 'CLASSIFIER_MANAGED_BY_SYSTEM',
      status: 409,
    });
    expect((await upsert('jev', { invalid: 'metadata' })).json()).toMatchObject({
      code: 'CLASSIFIER_MANAGED_BY_SYSTEM',
      status: 409,
    });
    expect(
      (await t.app.inject({ method: 'DELETE', url: '/classifier-models/jev' })).json(),
    ).toMatchObject({ code: 'CLASSIFIER_MANAGED_BY_SYSTEM', status: 409 });
    expect((await toggle('jev', false)).json()).toMatchObject({
      enabled: false,
      configured: false,
    });
    await toggle('jev', true);
    expect((await list())[0]?.enabled).toBe(true);
  });
  it('creates disabled, replaces metadata preserving enabled, clears auth and retains secrets on delete', async () => {
    const created = await upsert();
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      id: 'kev',
      source: 'custom',
      enabled: false,
      configured: true,
    });
    await t.app.inject({
      method: 'PUT',
      url: '/secrets/kev-key',
      payload: { value: 'private-test-key' },
    });
    await upsert('kev', { ...metadata, secretRef: 'kev-key' });
    await toggle('kev', true);
    const replaced = await upsert('kev', {
      ...metadata,
      displayName: 'Edited',
      providerModel: 'rotated',
    });
    expect(replaced.json()).toMatchObject({
      id: 'kev',
      enabled: true,
      configured: true,
      providerModel: 'rotated',
    });
    expect(replaced.json()).not.toHaveProperty('secretRef');
    expect(
      (await t.app.inject({ method: 'DELETE', url: '/classifier-models/kev' })).statusCode,
    ).toBe(204);
    expect(await t.container.repos.secretsFor('local').resolve('kev-key')).toBe('private-test-key');
    for (const response of [
      await toggle('kev', false),
      await t.app.inject({ method: 'DELETE', url: '/classifier-models/kev' }),
    ]) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toHaveProperty('code', 'CLASSIFIER_MODEL_NOT_FOUND');
    }
  });
  it.each([
    { enabled: true },
    { source: 'custom' },
    { configured: true },
    { apiKey: 'key' },
    { endpoint: 'https://user:key@host' },
    { endpoint: 'http://classifier.example', secretRef: 'required-key' },
    { primitives: ['choice', 'choice'] },
  ])('rejects invalid metadata with field paths %j', async (bad) => {
    const response = await t.app.inject({
      method: 'PUT',
      url: '/classifier-models/kev',
      payload: { ...metadata, ...bad },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: [expect.objectContaining({ path: expect.any(String) })],
    });
  });
  it('creates only with If-None-Match: *, refusing an existing id with CLASSIFIER_EXISTS', async () => {
    const create = (input: Record<string, unknown>, ifNoneMatch = '*') =>
      t.app.inject({
        method: 'PUT',
        url: '/classifier-models/kev',
        headers: { 'if-none-match': ifNoneMatch },
        payload: input,
      });
    const created = await create(metadata);
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      id: 'kev',
      enabled: false,
      endpoint: metadata.endpoint,
    });
    await toggle('kev', true);
    // A second create of the same id (a stale tab, or a list that had not loaded) changes nothing.
    const refused = await create({
      ...metadata,
      providerModel: 'other-model',
      endpoint: 'http://127.0.0.1:9009',
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({
      code: 'CLASSIFIER_EXISTS',
      detail: "Classifier 'kev' already exists",
    });
    expect((await list()).find((model) => model.id === 'kev')).toMatchObject({
      providerModel: 'kev-native',
      endpoint: 'http://127.0.0.1:8008',
      enabled: true,
    });
    // Without the header the PUT still replaces; only `*` is a valid precondition.
    expect((await upsert('kev', { ...metadata, providerModel: 'edited' })).statusCode).toBe(200);
    const malformed = await create(metadata, '"etag"');
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toHaveProperty('code', 'VALIDATION_FAILED');
    // Built-in Jev keeps its own refusal.
    const builtin = await t.app.inject({
      method: 'PUT',
      url: '/classifier-models/jev',
      headers: { 'if-none-match': '*' },
      payload: metadata,
    });
    expect(builtin.json()).toHaveProperty('code', 'CLASSIFIER_MANAGED_BY_SYSTEM');
  });
  it('lets exactly one of two concurrent create-only requests for an id succeed', async () => {
    const results = await Promise.all(
      ['first', 'second'].map((providerModel) =>
        t.app.inject({
          method: 'PUT',
          url: '/classifier-models/race',
          headers: { 'if-none-match': '*' },
          payload: { ...metadata, providerModel },
        }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const winner = results.find((r) => r.statusCode === 200)!.json<{ providerModel: string }>();
    expect((await list()).find((model) => model.id === 'race')?.providerModel).toBe(
      winner.providerModel,
    );
  });
  it('rejects invalid ids and enabled bodies', async () => {
    expect((await toggle('1bad', true)).statusCode).toBe(400);
    for (const id of ['JEV', 'Jev', 'Kev']) expect((await upsert(id)).statusCode).toBe(400);
    expect((await list()).map((model) => model.id)).toEqual(['jev']);
    for (const payload of [{}, { enabled: 'yes' }, { enabled: false, endpoint: 'http://host' }]) {
      expect(
        (await t.app.inject({ method: 'PATCH', url: '/classifier-models/jev', payload })).json(),
      ).toHaveProperty('code', 'VALIDATION_FAILED');
    }
  });
  it('checks settings scopes before parsing bodies and isolates owners and their secret state', async () => {
    const reader = await t.container.repos.apiKeys.create('local', 'read', ['settings:read']);
    const writer = await t.container.repos.apiKeys.create('other', 'write', ['settings:write']);
    const outsider = await t.container.repos.apiKeys.create('local', 'loops only', ['loops:read']);
    for (const method of ['PUT', 'PATCH', 'DELETE'] as const) {
      const response = await t.app.inject({
        method,
        url: '/classifier-models/jev',
        payload: '{broken',
        headers: { authorization: `Bearer ${reader.token}`, 'content-type': 'application/json' },
      });
      expect(response.statusCode).toBe(403);
    }
    expect(
      (
        await t.app.inject({
          url: '/classifier-models',
          headers: { authorization: `Bearer ${outsider.token}` },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await t.app.inject({
          url: '/classifier-models',
          headers: { authorization: 'Bearer invalid' },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await t.app.inject({
          url: '/classifier-models',
          headers: { authorization: `Bearer ${reader.token}` },
        })
      ).statusCode,
    ).toBe(200);
    const headers = { authorization: `Bearer ${writer.token}` };
    await t.container.repos.classifiers.seedBuiltin('other', BUILTIN_CLASSIFIER);
    expect(
      (
        await t.app.inject({
          method: 'PUT',
          url: '/classifier-models/kev',
          payload: metadata,
          headers,
        })
      ).statusCode,
    ).toBe(200);
    expect((await list()).map((entry) => entry.id)).toEqual(['jev']);
    expect((await t.app.inject({ url: '/classifier-models', headers })).json().items).toHaveLength(
      2,
    );
    expect((await toggle('kev', true)).statusCode).toBe(404);
    expect(
      (
        await t.app.inject({
          method: 'PATCH',
          url: '/classifier-models/kev',
          payload: { enabled: true },
          headers,
        })
      ).statusCode,
    ).toBe(200);
    await t.container.repos.secretsFor('local').set('jev-api-key', 'local-only');
    expect(
      (await t.app.inject({ url: '/classifier-models', headers })).json().items[0].configured,
    ).toBe(false);
  });
  it('derives status without provider calls through missing, blank, created, rotated, unreadable and deleted secrets', async () => {
    const fixture = await startFakeClassifierEndpoint();
    try {
      await t.app.inject({
        method: 'PUT',
        url: '/classifier-models/kev',
        payload: { ...metadata, endpoint: fixture.endpoint, secretRef: 'kev-key' },
      });
      const status = async () => (await list()).find((entry) => entry.id === 'kev')!;
      expect(await status()).toMatchObject({
        configured: false,
        configurationReason: expect.stringContaining('kev-key'),
      });
      for (const key of ['   ', 'first-key', 'rotated-key']) {
        await t.app.inject({ method: 'PUT', url: '/secrets/kev-key', payload: { value: key } });
        expect((await status()).configured).toBe(key.trim().length > 0);
      }
      await t.container.handle.client.execute(
        "UPDATE secrets SET ciphertext = 'broken' WHERE owner_id = 'local' AND name = 'kev-key'",
      );
      await t.container.onSecretChanged('local', 'kev-key');
      expect(await status()).toMatchObject({
        configured: false,
        configurationReason: "Unreadable secret 'kev-key'. Set it in Settings, Secrets.",
      });
      await t.app.inject({ method: 'DELETE', url: '/secrets/kev-key' });
      expect((await status()).configured).toBe(false);
      expect(fixture.requests).toEqual([]);
      expect(JSON.stringify(await list())).not.toMatch(/first-key|rotated-key/);
    } finally {
      await fixture.close();
    }
  });
});

describe('classifier publish validation agreement', () => {
  it.each(['disabled', 'missing', 'blank', 'unreadable', 'configured'])(
    'reports built-in Jev exit predicate warnings on all five endpoints (%s)',
    async (state) => {
      if (state !== 'missing')
        await t.container.repos
          .secretsFor('local')
          .set('jev-api-key', state === 'blank' ? ' ' : 'test-key');
      if (state === 'disabled') await toggle('jev', false);
      if (state === 'unreadable')
        await t.container.handle.client.execute(
          "UPDATE secrets SET ciphertext = 'broken' WHERE name = 'jev-api-key'",
        );
      const base = minimalLoop();
      const definition: LoopDefinitionInput = {
        ...base,
        nodes: base.nodes.map((node) =>
          node.kind === 'exit'
            ? {
                ...node,
                config: {
                  criteria: [
                    {
                      when: 'predicate',
                      strategy: 'expression',
                      jsonata: 'false',
                      outcome: 'success',
                    },
                    { when: 'predicate', strategy: 'jev', question: 'Done?', outcome: 'success' },
                  ],
                },
              }
            : node,
        ),
      };
      const created = await t.app.inject({
        method: 'POST',
        url: '/loops',
        payload: { definition },
      });
      expect(created.statusCode, created.body).toBe(201);
      const { loop, issues } = created.json<{ loop: { id: string }; issues: LoopIssue[] }>();
      if (state === 'configured') expect(issues).toEqual([]);
      else
        expect(issues).toEqual([
          expect.objectContaining({
            code:
              state === 'disabled'
                ? 'CLASSIFIER_MODEL_DISABLED'
                : state === 'unreadable'
                  ? 'CLASSIFIER_SECRET_UNREADABLE'
                  : 'CLASSIFIER_SECRET_MISSING',
            severity: 'warning',
            nodeId: 'done',
            path: 'config.criteria.1.strategy',
            message: expect.stringContaining("Exit 'Done' (done), classifier 'Jev' (jev)"),
          }),
        ]);
      if (issues.length) {
        expect(issues[0]?.message).toContain('DECIDER_UNAVAILABLE');
        expect(issues[0]?.message).toContain(
          state === 'disabled'
            ? 'Enable it in Settings, Classifier models.'
            : "secret 'jev-api-key'. Set it in Settings, Secrets.",
        );
      }
      const saved = await t.app.inject({
        method: 'PUT',
        url: `/loops/${loop.id}/draft`,
        payload: { definition },
      });
      const imported = await t.app.inject({
        method: 'POST',
        url: '/loops/import',
        payload: {
          format: 'graphgoblin-loop',
          formatVersion: 1,
          exportedAt: FIXTURE_TS,
          loop: definition,
        },
      });
      const validated = await t.app.inject({
        method: 'POST',
        url: `/loops/${loop.id}/validate`,
        payload: { definition },
      });
      const published = await t.app.inject({ method: 'POST', url: `/loops/${loop.id}/publish` });
      for (const response of [saved, imported, validated, published]) {
        expect(response.statusCode, response.body).toBe(response === imported ? 201 : 200);
        expect(response.json().issues).toEqual(issues);
      }
      expect(validated.json().publishable).toBe(true);
    },
  );
  it.each([
    'missing',
    'no-choice',
    'disabled',
    'secret-missing',
    'secret-blank',
    'secret-unreadable',
    'implicit',
    'implicit-only',
    'configured',
  ])('reports the same diagnostics on every endpoint (%s)', async (state) => {
    const model = state.startsWith('implicit') ? undefined : 'selected';
    if (state !== 'missing' && model) {
      await t.app.inject({
        method: 'PUT',
        url: '/classifier-models/selected',
        payload: {
          ...metadata,
          primitives: state === 'no-choice' ? ['score'] : ['choice'],
          ...(state.startsWith('secret') ? { secretRef: 'required-key' } : {}),
        },
      });
      if (state !== 'disabled') await toggle('selected', true);
      if (state === 'secret-blank')
        await t.container.repos.secretsFor('local').set('required-key', ' ');
      if (state === 'secret-unreadable') {
        await t.container.repos.secretsFor('local').set('required-key', 'key');
        await t.container.handle.client.execute(
          "UPDATE secrets SET ciphertext = 'broken' WHERE name = 'required-key'",
        );
      }
    }
    const definition = decisionLoop(model, state !== 'implicit-only');
    const created = await t.app.inject({ method: 'POST', url: '/loops', payload: { definition } });
    expect(created.statusCode, created.body).toBe(201);
    const initial = created.json<{ loop: { id: string }; issues: LoopIssue[] }>();
    const id = initial.loop.id;
    const validated = (
      await t.app.inject({ method: 'POST', url: `/loops/${id}/validate`, payload: { definition } })
    ).json<{ issues: LoopIssue[]; publishable: boolean }>();
    const saved = await t.app.inject({
      method: 'PUT',
      url: `/loops/${id}/draft`,
      payload: { definition },
    });
    const imported = await t.app.inject({
      method: 'POST',
      url: '/loops/import',
      payload: {
        format: 'graphgoblin-loop',
        formatVersion: 1,
        exportedAt: FIXTURE_TS,
        loop: definition,
      },
    });
    expect(saved.json().issues).toEqual(initial.issues);
    expect(imported.json().issues).toEqual(initial.issues);
    expect(validated.issues).toEqual(initial.issues);
    const expected =
      state === 'missing'
        ? 'CLASSIFIER_MODEL_NOT_FOUND'
        : state === 'no-choice'
          ? 'CLASSIFIER_PRIMITIVE_UNSUPPORTED'
          : state === 'disabled'
            ? 'CLASSIFIER_MODEL_DISABLED'
            : state === 'secret-unreadable'
              ? 'CLASSIFIER_SECRET_UNREADABLE'
              : 'CLASSIFIER_SECRET_MISSING';
    if (state === 'configured') expect(initial.issues).toEqual([]);
    else {
      expect(initial.issues).toEqual([
        expect.objectContaining({
          code: expected,
          nodeId: 'decide',
          path: 'config.jev.model',
          message: expect.stringContaining('Choose team'),
        }),
      ]);
      if (state === 'implicit-only')
        expect(initial.issues[0]?.message).toContain('cannot currently produce a route');
    }
    const published = await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` });
    const errors = state === 'missing' || state === 'no-choice';
    expect(validated.publishable).toBe(!errors);
    expect(published.statusCode).toBe(errors ? 422 : 200);
    expect(published.json()[errors ? 'errors' : 'issues']).toEqual(initial.issues);
  });
  it('ignores stale classifier metadata when the Jev strategy is unused and preserves portable references', async () => {
    const selected = LoopDefinitionSchema.parse(decisionLoop('absent'));
    const definition = {
      ...selected,
      nodes: selected.nodes.map((node) =>
        node.kind === 'decision'
          ? { ...node, config: { ...node.config, strategy: ['expression'] } }
          : node,
      ),
    };
    const created = await t.app.inject({ method: 'POST', url: '/loops', payload: { definition } });
    expect(created.json().issues).toEqual([]);
    const id = created.json().loop.id as string;
    const exported = (await t.app.inject(`/loops/${id}/export?draft=true`)).json();
    expect(exported.loop.nodes[1].config.jev.model).toBe('absent');
    expect(exported).not.toHaveProperty('classifierModels');
    const imported = await t.app.inject({
      method: 'POST',
      url: '/loops/import',
      payload: exported,
    });
    expect(imported.json().draft.definition.nodes[1].config.jev.model).toBe('absent');
  });
});

describe('classifier runtime hot reload', () => {
  it('rejects Jev probabilities with an undeclared secret key before any run read', async () => {
    const marker = 'gg-private-alternative-regression';
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            answers: {
              answer: {
                type: 'choice',
                choice: 'yes',
                probabilities: { yes: 0.8, no: 0.1, [marker]: 0.1 },
              },
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    await t.container.repos.secretsFor('local').set('jev-api-key', 'test-key');
    const definition = decisionLoop();
    for (const node of definition.nodes)
      if (node.kind === 'decision') node.config.recordAlternatives = true;
    const loopId = await t.publishLoop(definition);
    const started = await t.app.inject({
      method: 'POST',
      url: `/loops/${loopId}/runs`,
      payload: {},
    });
    await t.idle();
    const run = await safeFailureReads(started.json().run.id as string, marker);
    expect(run.failure?.details).toEqual({ strategy: 'jev', code: 'DECIDER_INVALID_RESPONSE' });
  });

  it('keeps real Jev exit HTTP error bodies out of snapshots, events, streams and logs', async () => {
    const marker = 'gg-private-exit-error-regression';
    const decider = createJevDecider({
      secrets: { resolve: () => Promise.resolve('test-key') },
      logger: t.logger,
      retry: { maxRetries: 0 },
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { message: marker } }), {
            status: 400,
            headers: { 'content-type': 'application/json', 'x-typesafe-request-id': marker },
          }),
        ),
    });
    await decider.init();
    t.jev.judge = (request, signal) =>
      decider.judge(request, signal ?? new AbortController().signal);
    const definition = minimalLoop();
    for (const node of definition.nodes)
      if (node.kind === 'exit')
        node.config = {
          criteria: [{ when: 'predicate', strategy: 'jev', question: 'Done?', outcome: 'success' }],
        };
    const loopId = await t.publishLoop(definition);
    const started = await t.app.inject({
      method: 'POST',
      url: `/loops/${loopId}/runs`,
      payload: {},
    });
    await t.idle();
    const run = await safeFailureReads(started.json().run.id as string, marker);
    expect(run.failure?.message).toBe('Decision provider request failed');
    expect(run.failure?.details).toEqual({ code: 'DECIDER_HTTP_ERROR', strategy: 'jev' });
    expect(JSON.stringify(t.logger.lines)).not.toContain(marker);
    expect(t.logger.lines).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        obj: expect.objectContaining({
          name: 'JevError',
          code: 'DECIDER_HTTP_ERROR',
          status: 400,
          strategy: 'jev',
        }),
      }),
    );
  });
  async function safeFailureReads(id: string, marker: string) {
    const reader = await t.container.repos.apiKeys.create('local', 'failure reader', ['runs:read']);
    const headers = { authorization: `Bearer ${reader.token}` };
    expect((await t.app.inject({ url: '/secrets', headers })).statusCode).toBe(403);
    const snapshot = await t.app.inject({ url: `/runs/${id}`, headers });
    expect(snapshot.json()).toMatchObject({
      status: 'failed',
      failure: { code: 'INTERNAL_ERROR' },
    });
    const events = await t.app.inject({ url: `/runs/${id}/events`, headers });
    expect(events.json().items).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'run.failed' })]),
    );
    const stream = await t.app.inject({
      url: `/runs/${id}/events`,
      headers: { ...headers, accept: 'text/event-stream' },
    });
    expect(stream.body).toContain('event: run.failed');
    for (const response of [snapshot, events, stream]) {
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain(marker);
    }
    return snapshot.json<RunRecord>();
  }

  it.each([200, 400])(
    'sanitizes real built-in Jev validation paths and error bodies (HTTP %i)',
    async (status) => {
      const marker = 'gg-provider-error-private-regression';
      vi.stubGlobal('fetch', () =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              status === 200
                ? {
                    answers: {
                      answer: {
                        type: 'choice',
                        choice: 'yes',
                        probabilities: { yes: 0.8, no: 0.2, [marker]: 'invalid' },
                      },
                    },
                  }
                : { error: marker },
            ),
            { status, headers: { 'content-type': 'application/json' } },
          ),
        ),
      );
      await t.container.repos.secretsFor('local').set('jev-api-key', marker);
      const loopId = await t.publishLoop(decisionLoop());
      const started = await t.app.inject({
        method: 'POST',
        url: `/loops/${loopId}/runs`,
        payload: {},
      });
      const id = started.json().run.id as string;
      await t.idle();
      const run = await safeFailureReads(id, marker);
      expect(run.failure?.details).toEqual({
        strategy: 'jev',
        code: status === 200 ? 'DECIDER_INVALID_RESPONSE' : 'DECIDER_HTTP_ERROR',
      });
    },
  );

  it('sanitizes a real Codex turn failure before persisting it for run readers', async () => {
    const marker = 'gg-codex-provider-error-private-regression';
    const thread: CodexThreadLike = {
      runStreamed: () =>
        Promise.resolve({
          events: (async function* () {
            yield await Promise.resolve({ type: 'thread.started', thread_id: 'fake-thread' });
            yield { type: 'turn.failed', error: { message: marker } };
          })(),
        }),
    };
    const harness = createCodexHarness({
      clientFactory: () => ({ startThread: () => thread, resumeThread: () => thread }),
    });
    const decider = createCodexDecider(
      createCodexStructured(harness, { workingDirectory: t.dataDir }),
    );
    t.codex.choose = (request, signal) =>
      decider.choose(request, signal ?? new AbortController().signal);
    const definition = decisionLoop();
    for (const node of definition.nodes)
      if (node.kind === 'decision') node.config.strategy = ['codex'];
    const loopId = await t.publishLoop(definition);
    const started = await t.app.inject({
      method: 'POST',
      url: `/loops/${loopId}/runs`,
      payload: {},
    });
    const id = started.json().run.id as string;
    await t.idle();
    const run = await safeFailureReads(id, marker);
    expect(run.failure?.details).toEqual({ strategy: 'codex' });
  });
  it.each([true, false])(
    'never exposes an echoed classifier bearer to runs:read (fallback %s)',
    async (fallback) => {
      const fixture = await startFakeClassifierEndpoint();
      const bearer = 'gg-provider-bearer-private-regression';
      fixture.respondWith((request) => ({
        body: {
          answers: {
            answer: {
              type: 'choice',
              choice: request.authorization?.slice('Bearer '.length),
              probabilities: { yes: 0.8, no: 0.2 },
            },
          },
        },
      }));
      try {
        await t.container.repos.secretsFor('local').set('classifier-key', bearer);
        await upsert('kev', {
          ...metadata,
          endpoint: fixture.endpoint,
          secretRef: 'classifier-key',
        });
        await toggle('kev', true);
        const loopId = await t.publishLoop(decisionLoop('kev', fallback));
        const started = await t.app.inject({
          method: 'POST',
          url: `/loops/${loopId}/runs`,
          payload: {},
        });
        const id = started.json().run.id as string;
        await t.idle();
        expect(fixture.requests[0]?.authorization).toBe(`Bearer ${bearer}`);
        const reader = await t.container.repos.apiKeys.create('local', 'run reader', ['runs:read']);
        const headers = { authorization: `Bearer ${reader.token}` };
        expect((await t.app.inject({ url: '/secrets', headers })).statusCode).toBe(403);
        const snapshot = await t.app.inject({ url: `/runs/${id}`, headers });
        expect(snapshot.statusCode).toBe(200);
        expect(snapshot.json()).toMatchObject({
          status: 'failed',
          failure: {
            code: 'INTERNAL_ERROR',
            message: 'Decision provider returned an invalid response',
            details: { code: 'DECIDER_INVALID_RESPONSE' },
          },
        });
        const events = await t.app.inject({ url: `/runs/${id}/events`, headers });
        expect(events.statusCode).toBe(200);
        expect(events.json().items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: 'run.failed',
              failure: expect.objectContaining({
                details: expect.objectContaining({ code: 'DECIDER_INVALID_RESPONSE' }),
              }),
            }),
          ]),
        );
        const stream = await t.app.inject({
          url: `/runs/${id}/events`,
          headers: { ...headers, accept: 'text/event-stream' },
        });
        expect(stream.statusCode).toBe(200);
        expect(stream.body).toContain('event: run.failed');
        for (const response of [snapshot, events, stream])
          expect(response.body).not.toContain(bearer);
      } finally {
        await fixture.close();
      }
    },
  );
  it('passes the engine logger to the decision-time Jev SDK client', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            answers: {
              answer: { type: 'choice', choice: 'yes', probabilities: { yes: 1, no: 0 } },
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    await t.container.repos.secretsFor('local').set('jev-api-key', 'dummy-key');
    const resolved = await t.container.classifierRegistry.resolve('local', 'jev');
    expect(resolved.status).toBe('ready');
    if (resolved.status !== 'ready') throw new Error('expected configured Jev');
    await resolved.classifier.choose(
      {
        question: 'Choose',
        options: [
          { label: 'yes', description: 'Approve' },
          { label: 'no', description: 'Reject' },
        ],
        context: {},
      },
      new AbortController().signal,
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(t.logger.lines.some((entry) => entry.msg.startsWith('jev: '))).toBe(true);
  });
  it('uses catalog/provider ids, updates secrets and metadata, preserves in-flight snapshots and falls through deleted/disabled published references', async () => {
    const fixture = await startFakeClassifierEndpoint();
    try {
      const put = (providerModel = 'native-one', secretRef: string | null = 'kev-key') =>
        t.app.inject({
          method: 'PUT',
          url: '/classifier-models/kev',
          payload: {
            ...metadata,
            endpoint: fixture.endpoint,
            providerModel,
            ...(secretRef ? { secretRef } : {}),
          },
        });
      await t.app.inject({
        method: 'PUT',
        url: '/secrets/kev-key',
        payload: { value: 'first-key' },
      });
      await put();
      await toggle('kev', true);
      const loopId = await t.publishLoop(decisionLoop('kev'));
      const start = async () =>
        (await t.app.inject({ method: 'POST', url: `/loops/${loopId}/runs`, payload: {} })).json<{
          run: RunRecord;
        }>().run.id;
      const run = await start();
      await t.idle();
      expect((await t.container.repos.runs.get(run))?.status).toBe('succeeded');
      expect((await t.container.repos.runs.get(run))?.result).toBe('yes');
      expect(
        (await t.container.repos.events.read(run)).find((event) => event.type === 'decision.made'),
      ).toMatchObject({ classifierModel: 'kev', route: 'yes' });
      expect(fixture.requests[0]).toMatchObject({
        body: { model: 'native-one' },
        authorization: 'Bearer first-key',
      });
      let entered!: () => void;
      let release!: () => void;
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      fixture.respondWith(async () => {
        entered();
        await gate;
        return {
          body: {
            answers: {
              answer: { type: 'choice', choice: 'yes', probabilities: { yes: 1, no: 0 } },
            },
          },
        };
      });
      const pending = await start();
      await ready;
      await t.app.inject({
        method: 'PUT',
        url: '/secrets/kev-key',
        payload: { value: 'rotated-key' },
      });
      await put('native-two');
      release();
      await t.idle();
      expect((await t.container.repos.runs.get(pending))?.status).toBe('succeeded');
      expect(fixture.requests[1]).toMatchObject({
        body: { model: 'native-one' },
        authorization: 'Bearer first-key',
      });
      await start();
      await t.idle();
      expect(fixture.requests[2]).toMatchObject({
        body: { model: 'native-two' },
        authorization: 'Bearer rotated-key',
      });
      await put('no-auth', null);
      await start();
      await t.idle();
      expect(fixture.requests[3]?.authorization).toBeUndefined();
      const before = await t.container.repos.loops.getLatestPublished(loopId);
      await toggle('kev', false);
      const disabled = await start();
      await t.idle();
      expect(
        (await t.container.repos.events.read(disabled)).find(
          (event) => event.type === 'decision.made',
        ),
      ).toMatchObject({ strategy: 'expression', route: 'no' });
      await t.app.inject({ method: 'DELETE', url: '/classifier-models/kev' });
      const deleted = await start();
      await t.idle();
      expect(
        (await t.container.repos.events.read(deleted)).find(
          (event) => event.type === 'decision.made',
        ),
      ).toMatchObject({ strategy: 'expression', route: 'no' });
      expect(await t.container.repos.loops.getLatestPublished(loopId)).toEqual(before);
      expect(await t.container.repos.secretsFor('local').resolve('kev-key')).toBe('rotated-key');
    } finally {
      await fixture.close();
    }
  });
  it('reports an unreachable endpoint as a provider failure, without silently falling through', async () => {
    const fixture = await startFakeClassifierEndpoint();
    await fixture.close();
    await upsert('kev', { ...metadata, endpoint: fixture.endpoint });
    await toggle('kev', true);
    const loopId = await t.publishLoop(decisionLoop('kev'));
    const started = await t.app.inject({
      method: 'POST',
      url: `/loops/${loopId}/runs`,
      payload: {},
    });
    const id = started.json().run.id as string;
    await t.idle();
    expect(await t.container.repos.runs.get(id)).toMatchObject({
      status: 'failed',
      failure: {
        message: 'Classifier endpoint is unreachable',
        details: { code: 'DECIDER_UNREACHABLE' },
      },
    });
    expect(
      (await t.container.repos.events.read(id)).some((event) => event.type === 'decision.made'),
    ).toBe(false);
  });
});

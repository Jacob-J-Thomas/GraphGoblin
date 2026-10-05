import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LoopDefinitionSchema,
  type ClassifierModelSummary,
  type LoopDefinitionInput,
  type LoopIssue,
  type RunRecord,
} from '@graphgoblin/contracts';
import { FIXTURE_TS, minimalLoop } from '@graphgoblin/contracts/testing';
import { BUILTIN_CLASSIFIER } from './classifier-registry.js';
import { createTestApp, startFakeClassifierEndpoint, type TestApp } from './testing/test-app.js';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp({ realClassifiers: true });
});
afterEach(async () => {
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
  it('returns a configured/enabled distinction and protects builtin metadata', async () => {
    expect(await list()).toEqual([
      {
        ...BUILTIN_CLASSIFIER,
        configured: false,
        configurationReason: "Missing or blank secret 'jev-api-key'",
      },
    ]);
    expect((await upsert('jev')).json()).toMatchObject({
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
  it('rejects invalid ids and enabled bodies', async () => {
    expect((await toggle('1bad', true)).statusCode).toBe(400);
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
        configurationReason: "Unreadable secret 'kev-key'",
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
      failure: { message: 'Classifier endpoint is unreachable' },
    });
    expect(
      (await t.container.repos.events.read(id)).some((event) => event.type === 'decision.made'),
    ).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LoopDefinitionInput, LoopIssue, ModelCatalogEntry } from '@graphgoblin/contracts';
import { fakeUlid, minimalLoop } from '@graphgoblin/contracts/testing';
import { createTestApp, type TestApp } from './testing/test-app.js';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});
const body = { displayName: 'Changed', efforts: ['low'], defaultEffort: 'low' };
const url = '/model-catalog/codex/gpt-6-luna';

describe('catalog ownership and toggle routes', () => {
  it('returns source and enabled, refuses harness edit/delete/create and source spoofing', async () => {
    const before = (await t.app.inject('/model-catalog')).json<{ items: ModelCatalogEntry[] }>()
      .items;
    expect(before.every((entry) => entry.source === 'harness' && entry.enabled)).toBe(true);
    for (const request of [
      { method: 'PUT' as const, url, payload: body },
      { method: 'PUT' as const, url, payload: { ...body, source: 'litellm' } },
      { method: 'DELETE' as const, url },
      { method: 'PUT' as const, url: '/model-catalog/other/new', payload: body },
    ]) {
      const response = await t.app.inject(request);
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'MODEL_MANAGED_BY_HARNESS' });
    }
    expect((await t.app.inject('/model-catalog')).json().items).toEqual(before);
    const missing = await t.app.inject({
      method: 'PUT',
      url: '/model-catalog/any/new',
      payload: { ...body, source: 'litellm' },
    });
    expect(missing.statusCode).toBe(409);
    expect(missing.json()).toMatchObject({
      code: 'LITELLM_NOT_CONFIGURED',
      detail: expect.stringContaining('LiteLLM is not configured'),
    });
  });

  it('freezes hand-added legacy rows too, without removing their ability to toggle', async () => {
    await t.container.repos.catalog.upsert({
      harness: 'old',
      model: 'hand-added',
      source: 'harness',
      displayName: 'Custom',
      efforts: ['low'],
      defaultEffort: 'low',
      enabled: true,
    });
    const path = '/model-catalog/old/hand-added';
    expect((await t.app.inject({ method: 'DELETE', url: path })).json().code).toBe(
      'MODEL_MANAGED_BY_HARNESS',
    );
    expect((await t.app.inject({ method: 'PUT', url: path, payload: body })).json().code).toBe(
      'MODEL_MANAGED_BY_HARNESS',
    );
    expect(
      (await t.app.inject({ method: 'PATCH', url: path, payload: { enabled: false } })).json(),
    ).toMatchObject({ source: 'harness', displayName: 'Custom', enabled: false });
  });

  it.each(['harness', 'litellm'] as const)(
    'PATCH only changes enabled for %s rows',
    async (source) => {
      const row = {
        harness: 'test',
        model: 'shared',
        source,
        displayName: 'Test',
        efforts: ['high' as const],
        defaultEffort: 'high' as const,
        enabled: true,
      };
      await t.container.repos.catalog.upsert(row);
      for (const enabled of [false, true, true]) {
        const response = await t.app.inject({
          method: 'PATCH',
          url: '/model-catalog/test/shared',
          payload: { enabled },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ ...row, enabled });
      }
    },
  );

  it('edits/deletes LiteLLM rows, defaults enabled, and cannot change their source', async () => {
    await t.container.repos.catalog.upsert({
      harness: 'local-key',
      model: 'local-model',
      source: 'litellm',
      displayName: 'Local',
      efforts: ['high'],
      defaultEffort: 'high',
      enabled: false,
    });
    const path = '/model-catalog/local-key/local-model';
    const changed = await t.app.inject({ method: 'PUT', url: path, payload: body });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({ ...body, source: 'litellm', enabled: true });
    expect(
      (
        await t.app.inject({ method: 'PUT', url: path, payload: { ...body, source: 'harness' } })
      ).json().code,
    ).toBe('INVALID_INPUT');
    expect(
      (
        await t.app.inject({ method: 'PUT', url: path, payload: { ...body, defaultEffort: 'max' } })
      ).json().code,
    ).toBe('INVALID_INPUT');
    expect((await t.app.inject({ method: 'DELETE', url: path })).statusCode).toBe(204);
    expect((await t.app.inject({ method: 'DELETE', url: path })).json().code).toBe(
      'MODEL_NOT_FOUND',
    );
    expect(
      (await t.app.inject({ method: 'PATCH', url: path, payload: { enabled: true } })).json().code,
    ).toBe('MODEL_NOT_FOUND');
  });

  it.each([{}, { enabled: 'false' }, { enabled: false, displayName: 'Oops' }, { enabled: null }])(
    'rejects invalid PATCH %j without a write',
    async (payload) => {
      const response = await t.app.inject({ method: 'PATCH', url, payload });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('VALIDATION_FAILED');
      expect((await t.container.repos.catalog.findOne('codex', 'gpt-6-luna'))?.enabled).toBe(true);
    },
  );

  it('rejects unauthorized and wrong-scope writes before validating bodies; read/write scopes work', async () => {
    await t.close();
    t = await createTestApp({ requireApiKey: true });
    const reader = await t.container.repos.apiKeys.create('local', 'reader', ['settings:read']);
    const writer = await t.container.repos.apiKeys.create('local', 'writer', ['settings:write']);
    for (const method of ['PATCH', 'PUT', 'DELETE'] as const) {
      expect((await t.app.inject({ method, url })).statusCode).toBe(401);
      expect(
        (
          await t.app.inject({
            method,
            url,
            headers: { authorization: `Bearer ${reader.token}` },
            payload: { invalid: true },
          })
        ).statusCode,
      ).toBe(403);
    }
    expect(
      (
        await t.app.inject({
          method: 'PATCH',
          url,
          headers: { authorization: `Bearer ${writer.token}` },
          payload: { enabled: false },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await t.app.inject({
          url: '/model-catalog',
          headers: { authorization: `Bearer ${reader.token}` },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await t.app.inject({
          url: '/model-catalog',
          headers: { authorization: `Bearer ${writer.token}` },
        })
      ).statusCode,
    ).toBe(200);
  });
});

function modelLoop(
  place: 'inference' | 'decision' | 'default',
  model?: string,
): LoopDefinitionInput {
  const definition = minimalLoop();
  if (place === 'default')
    return { ...definition, settings: { defaults: { ...(model ? { model } : {}) } } };
  const node =
    place === 'inference'
      ? {
          id: 'model-node',
          kind: 'inference' as const,
          label: 'Infer',
          config: { prompt: { template: 'Hi' }, ...(model ? { model } : {}) },
        }
      : {
          id: 'model-node',
          kind: 'decision' as const,
          label: 'Decide',
          config: {
            strategy: ['codex' as const],
            question: 'Which?',
            routes: [
              { label: 'a', description: 'A' },
              { label: 'b', description: 'B' },
            ],
            ...(model ? { codex: { model } } : {}),
          },
        };
  return {
    ...definition,
    nodes: [definition.nodes[0]!, node, definition.nodes[1]!],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'model-node' } },
      {
        id: 'e2',
        from: { node: 'model-node', port: place === 'decision' ? 'a' : 'out' },
        to: { node: 'done' },
      },
      ...(place === 'decision'
        ? [{ id: 'e3', from: { node: 'model-node', port: 'b' }, to: { node: 'done' } }]
        : []),
    ],
  };
}

describe('advisory model validation', () => {
  it.each(['inference', 'decision', 'default'] as const)(
    'validate and publish report disabled/missing/present %s models without blocking',
    async (place) => {
      for (const state of ['disabled', 'missing', 'present', 'implicit'] as const) {
        await t.container.repos.catalog.setEnabled('codex', 'gpt-6-luna', state !== 'disabled');
        // Same id under another harness must not satisfy a Codex catalog lookup.
        await t.container.repos.catalog.upsert({
          harness: 'other',
          model: 'missing-model',
          source: 'litellm',
          displayName: 'Other',
          efforts: ['low'],
          defaultEffort: 'low',
          enabled: true,
        });
        const definition = modelLoop(
          place,
          state === 'missing' ? 'missing-model' : state === 'implicit' ? undefined : 'gpt-6-luna',
        );
        const created = await t.app.inject({
          method: 'POST',
          url: '/loops',
          payload: { definition },
        });
        expect(created.statusCode).toBe(201);
        const id = created.json<{ loop: { id: string } }>().loop.id;
        const validated = await t.app.inject({
          method: 'POST',
          url: `/loops/${id}/validate`,
          payload: { definition },
        });
        expect(validated.statusCode).toBe(200);
        const result = validated.json<{ publishable: boolean; issues: LoopIssue[] }>();
        const warnings = result.issues.filter((issue) => issue.code.startsWith('MODEL_'));
        expect(result.publishable).toBe(true);
        if (state === 'disabled' || state === 'missing') {
          expect(warnings).toEqual([
            expect.objectContaining({
              code: state === 'disabled' ? 'MODEL_DISABLED' : 'MODEL_NOT_IN_CATALOG',
              severity: 'warning',
              path:
                place === 'default'
                  ? 'settings.defaults.model'
                  : `nodes.1.config.${place === 'decision' ? 'codex.model' : 'model'}`,
            }),
          ]);
          expect(warnings[0]?.nodeId).toBe(place === 'default' ? undefined : 'model-node');
        } else expect(warnings).toEqual([]);
        const published = await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` });
        expect(published.statusCode, published.body).toBe(200);
        expect(published.json().issues).toEqual(result.issues);
        expect(published.json().version.status).toBe('published');
      }
    },
  );

  it('still requires ownership for validation', async () => {
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: `/loops/${fakeUlid('absent')}/validate`,
          payload: { definition: modelLoop('default', 'missing') },
        })
      ).statusCode,
    ).toBe(404);
  });
});

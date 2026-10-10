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
    expect(before.every((entry) => entry.source === 'harness')).toBe(true);
    expect(
      before.filter((entry) => !entry.enabled).map((entry) => [entry.harness, entry.model]),
    ).toEqual([]);
    for (const request of [
      { method: 'PUT' as const, url, payload: body },
      { method: 'PUT' as const, url, payload: { ...body, source: 'litellm' } },
      { method: 'DELETE' as const, url },
      { method: 'PUT' as const, url: '/model-catalog/other/new', payload: body },
    ]) {
      const response = await t.app.inject(request);
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: 'MODEL_MANAGED_BY_HARNESS',
        detail:
          request.url === url
            ? 'Harness models can only be enabled or disabled'
            : 'Models for this harness come from the harness and cannot be added',
      });
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
      detail: 'LiteLLM is not configured; adding local models is not available yet',
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

  it('edits/deletes LiteLLM rows, preserves enabled when omitted, and cannot change source', async () => {
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
    expect(changed.json()).toMatchObject({ ...body, source: 'litellm', enabled: false });
    for (const enabled of [true, false]) {
      expect(
        (await t.app.inject({ method: 'PUT', url: path, payload: { ...body, enabled } })).json(),
      ).toMatchObject({ ...body, source: 'litellm', enabled });
      expect(
        (await t.app.inject({ method: 'PUT', url: path, payload: body })).json(),
      ).toMatchObject({
        ...body,
        enabled,
      });
    }
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
    return {
      ...definition,
      settings: { defaults: { byHarness: { codex: { ...(model ? { model } : {}) } } } },
    };
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
            answer: {
              type: 'choice' as const,
              options: [
                { id: 'a', label: 'A', criteria: 'A' },
                { id: 'b', label: 'B', criteria: 'B' },
              ],
            },
            evaluation: {
              kind: 'llm' as const,
              harness: 'codex' as const,
              question: 'Which?',
              model: model
                ? { mode: 'explicit' as const, value: model }
                : { mode: 'inherit' as const },
              effort: { mode: 'inherit' as const },
            },
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
  it('ignores stale Codex models when the decision uses only an expression', async () => {
    const original = modelLoop('decision', 'stale-model');
    const definition: LoopDefinitionInput = {
      ...original,
      nodes: original.nodes.map((node) =>
        node.kind === 'decision'
          ? {
              ...node,
              config: {
                ...node.config,
                evaluation: { kind: 'expression', jsonata: '"a"' },
              },
            }
          : node,
      ),
    };
    const created = await t.app.inject({ method: 'POST', url: '/loops', payload: { definition } });
    expect(created.statusCode).toBe(201);
    const id = created.json<{ loop: { id: string } }>().loop.id;
    const validated = await t.app.inject({
      method: 'POST',
      url: `/loops/${id}/validate`,
      payload: { definition },
    });
    expect(validated.statusCode).toBe(200);
    expect(validated.json<{ issues: LoopIssue[] }>().issues).toEqual([]);
    const published = await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` });
    expect(published.statusCode).toBe(200);
    expect(published.json<{ issues: LoopIssue[] }>().issues).toEqual([]);
  });

  it.each(['inference', 'decision', 'default'] as const)(
    'rejects explicit unknown/wrong-family %s models and blocks unavailable selected models',
    async (place) => {
      const unknown = await t.app.inject({
        method: 'POST',
        url: '/loops',
        payload: { definition: modelLoop(place, 'missing-model') },
      });
      expect(unknown.statusCode).toBe(400);
      expect(unknown.json().code).toBe('EVALUATION_INVALID_CONFIGURATION');
      await t.container.repos.catalog.setEnabled('codex', 'gpt-6-luna', false);
      const definition = modelLoop(place, 'gpt-6-luna');
      const created = await t.app.inject({
        method: 'POST',
        url: '/loops',
        payload: { definition },
      });
      expect(created.statusCode).toBe(201);
      const id = created.json<{ loop: { id: string } }>().loop.id;
      const result = (
        await t.app.inject({
          method: 'POST',
          url: '/loops/' + id + '/validate',
          payload: { definition },
        })
      ).json<{ publishable: boolean; issues: LoopIssue[] }>();
      // A defaults-only graph has no evaluator to invoke; selection becomes unavailable only at use.
      expect(result.publishable).toBe(place === 'default');
      expect(result.issues.filter((issue) => issue.code === 'MODEL_DISABLED')).toHaveLength(
        place === 'default' ? 0 : 1,
      );
      expect(
        (await t.app.inject({ method: 'POST', url: '/loops/' + id + '/publish' })).statusCode,
      ).toBe(place === 'default' ? 200 : 422);
      await t.container.repos.catalog.setEnabled('codex', 'gpt-6-luna', true);
      const ready = await t.app.inject({
        method: 'POST',
        url: '/loops',
        payload: { definition: modelLoop(place) },
      });
      expect(ready.statusCode).toBe(201);
      expect(ready.json().issues).toEqual([]);
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

describe('uniform strict evaluator admission', () => {
  it.each(['disabled model', 'unavailable harness'] as const)(
    'keeps existing exit predicates subject to publication admission for an %s',
    async (unavailable) => {
      const definition: LoopDefinitionInput = {
        ...minimalLoop(),
        nodes: minimalLoop().nodes.map((node) =>
          node.kind === 'exit'
            ? {
                ...node,
                config: {
                  criteria: [
                    {
                      when: 'predicate',
                      answer: {
                        type: 'noul',
                        true: { label: 'Ready', criteria: 'Task is done' },
                        false: { label: 'Continue', criteria: 'Task is not done' },
                      },
                      evaluation: {
                        kind: 'llm',
                        harness: 'codex',
                        model: { mode: 'inherit' },
                        effort: { mode: 'inherit' },
                        question: 'Complete?',
                      },
                      match: { type: 'noul', value: true },
                      outcome: 'success',
                    },
                  ],
                },
              }
            : node,
        ),
      };
      if (unavailable === 'disabled model')
        await t.container.repos.catalog.setEnabled('codex', 'gpt-6-luna', false);
      else delete t.container.ports.harnesses.codex;
      const code = unavailable === 'disabled model' ? 'MODEL_DISABLED' : 'HARNESS_UNAVAILABLE';
      const created = await t.app.inject({
        method: 'POST',
        url: '/loops',
        payload: { definition },
      });
      expect(created.statusCode).toBe(201);
      expect(created.json().issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code, severity: 'warning', nodeId: 'done' }),
        ]),
      );
      const id = created.json<{ loop: { id: string } }>().loop.id;
      const validated = await t.app.inject({
        method: 'POST',
        url: `/loops/${id}/validate`,
        payload: { definition },
      });
      expect(validated.statusCode).toBe(200);
      expect(validated.json().publishable).toBe(false);
      expect((await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` })).statusCode).toBe(
        422,
      );
      if (unavailable === 'disabled model')
        await t.container.repos.catalog.setEnabled('codex', 'gpt-6-luna', true);
      else t.container.ports.harnesses.codex = t.harness;
      expect((await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` })).statusCode).toBe(
        200,
      );
    },
  );
  it('reports explicit unknown model configuration even while its harness is unavailable', async () => {
    delete t.container.ports.harnesses.codex;
    const definition = modelLoop('decision', 'unknown-model');
    const created = await t.app.inject({ method: 'POST', url: '/loops', payload: { definition } });
    expect(created.statusCode).toBe(400);
    expect(created.json().errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'MODEL_NOT_IN_CATALOG', severity: 'error' }),
        expect.objectContaining({ code: 'HARNESS_UNAVAILABLE', severity: 'warning' }),
      ]),
    );
    const baseId = await t.publishLoop(minimalLoop());
    const validated = await t.app.inject({
      method: 'POST',
      url: '/loops/' + baseId + '/validate',
      payload: { definition },
    });
    expect(validated.json().publishable).toBe(false);
    for (const request of [
      { method: 'PUT' as const, url: '/loops/' + baseId + '/draft', payload: { definition } },
      {
        method: 'POST' as const,
        url: '/loops/import',
        payload: {
          format: 'graphgoblin-loop',
          formatVersion: 3,
          exportedAt: '2026-10-02T12:00:00.000Z',
          loop: definition,
        },
      },
    ])
      expect((await t.app.inject(request)).statusCode).toBe(400);
  });
  it('returns a typed cutover refusal for old portable and bare definitions without saving them', async () => {
    for (const payload of [
      {
        format: 'graphgoblin-loop',
        formatVersion: 1,
        loop: {},
        exportedAt: '2026-10-02T12:00:00.000Z',
      },
      { ...minimalLoop(), schemaVersion: 1 },
    ]) {
      const response = await t.app.inject({ method: 'POST', url: '/loops/import', payload });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('LOOP_FORMAT_UPGRADE_REQUIRED');
      expect(response.body).toContain('graphgoblin-upgrade');
    }
    expect((await t.app.inject('/loops')).json().items).toEqual([]);
  });
});

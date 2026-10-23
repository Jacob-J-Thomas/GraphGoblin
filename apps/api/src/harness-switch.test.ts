import { afterEach, expect, it } from 'vitest';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { FakeHarness, singleNodeLoop } from '@graphgoblin/engine/testing';
import { claudeModelCapabilities, claudePolicy } from '@graphgoblin/infrastructure/claude';
import { createTestApp, type TestApp } from './testing/test-app.js';

let t: TestApp;
afterEach(async () => {
  await t?.close();
});
for (const harness of ['codex', 'claude'] as const) {
  it(`saves, validates, publishes and starts the explicit switched ${harness} choice without runtime substitution`, async () => {
    const codex = new FakeHarness([], 'codex');
    const claude = new FakeHarness([], 'claude');
    claude.preflightResult = {
      state: 'ready',
      ok: true,
      authenticated: true,
      problems: [],
      models: claudeModelCapabilities(),
      supportedPolicies: [
        claudePolicy({ sandbox: 'read-only', approval: 'never' }, undefined, 'win32'),
      ],
    };
    t = await createTestApp({ harnesses: { codex, claude } });
    const from = harness === 'codex' ? 'claude' : 'codex';
    const previous = from === 'codex' ? 'gpt-6-astra' : 'claude-fable-5-1';
    const model = harness === 'codex' ? 'gpt-6.1-sol' : 'claude-opus-5-5';
    const original = singleNodeLoop('Switch exact request', {
      id: 'infer',
      kind: 'inference',
      label: 'Infer',
      config: {
        harness: from,
        model: previous,
        effort: 'high',
        prompt: { template: 'Synthetic only' },
        harnessOptions: { sandbox: 'read-only', approval: 'never' },
      },
    });
    const created = await t.app.inject({
      method: 'POST',
      url: '/loops',
      payload: { definition: original },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json<{ loop: { id: string } }>().loop.id;
    // The authoring action supplies explicit values; execution keeps the existing resolver.
    const switched = {
      ...original,
      nodes: original.nodes.map((node) =>
        node.id === 'infer'
          ? { ...node, config: { ...node.config, harness, model, effort: 'low' } }
          : node,
      ),
    };
    const saved = await t.app.inject({
      method: 'PUT',
      url: `/loops/${id}/draft`,
      payload: { definition: switched },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const reopened = await t.app.inject({ method: 'GET', url: `/loops/${id}` });
    const definition = LoopDefinitionSchema.parse(
      reopened.json<{ draft: { definition: unknown } }>().draft.definition,
    );
    expect(definition.nodes.find((node) => node.id === 'infer')?.config).toMatchObject({
      harness,
      model,
      effort: 'low',
    });
    const validation = await t.app.inject({
      method: 'POST',
      url: `/loops/${id}/validate`,
      payload: { definition },
    });
    expect(validation.statusCode).toBe(200);
    expect(validation.json()).toMatchObject({ publishable: true, issues: [] });
    expect((await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` })).statusCode).toBe(
      200,
    );
    const started = await t.app.inject({
      method: 'POST',
      url: `/loops/${id}/runs`,
      payload: { input: null },
    });
    expect(started.statusCode, started.body).toBe(202);
    await t.idle();
    expect((harness === 'codex' ? codex : claude).started).toMatchObject([
      { model, effort: 'low' },
    ]);
    expect((harness === 'codex' ? claude : codex).started).toEqual([]);
    const incompatible = {
      ...definition,
      nodes: definition.nodes.map((node) =>
        node.id === 'infer' ? { ...node, config: { ...node.config, model: previous } } : node,
      ),
    };
    const invalid = await t.app.inject({
      method: 'POST',
      url: `/loops/${id}/validate`,
      payload: { definition: incompatible },
    });
    expect(invalid.json()).toMatchObject({
      publishable: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'MODEL_HARNESS_MISMATCH', path: 'config.model' }),
      ]),
    });
  });
}

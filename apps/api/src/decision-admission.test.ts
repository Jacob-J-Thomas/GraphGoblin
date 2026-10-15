import { afterEach, describe, it, expect } from 'vitest';
import {
  DecisionConfigSchema,
  CURRENT_DEFINITION_FORMAT,
  type DecisionConfig,
  type LoopDefinitionInput,
} from '@graphgoblin/contracts';
import { FIXTURE_TS, minimalLoop } from '@graphgoblin/contracts/testing';
import { decisionRouteDeclarations } from '@graphgoblin/domain';
import { createTestApp, type TestApp } from './testing/test-app.js';
const apps: TestApp[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});
const routes = [
  { id: 'yes', label: 'Yes' },
  { id: 'no', label: 'No' },
];
const configs = [
  { kind: 'expression', jsonata: '"yes"', routes },
  {
    kind: 'llm',
    instructions: 'Choose yes for a ready result; otherwise no.',
    routes,
    harness: 'codex',
    model: { mode: 'explicit', value: 'gpt-6-luna' },
    effort: { mode: 'explicit', value: 'low' },
  },
  {
    kind: 'classifier',
    model: 'jev',
    question: 'Ready?',
    answer: {
      type: 'choice',
      options: routes.map((route) => ({ ...route, criteria: route.label })),
    },
  },
].map((config) => DecisionConfigSchema.parse(config));
function definition(config: DecisionConfig): LoopDefinitionInput {
  const base = minimalLoop();
  return {
    ...base,
    nodes: [
      base.nodes[0]!,
      { id: 'decide', kind: 'decision', label: 'Decide', config },
      base.nodes[1]!,
    ],
    edges: [
      { id: 'start', from: { node: 'start', port: 'out' }, to: { node: 'decide' } },
      ...decisionRouteDeclarations(config).map((route) => ({
        id: route.id,
        from: { node: 'decide', port: route.id },
        to: { node: 'done' },
      })),
    ],
  };
}
const envelope = (loop: LoopDefinitionInput) => ({
  format: 'graphgoblin-loop',
  formatVersion: CURRENT_DEFINITION_FORMAT,
  exportedAt: FIXTURE_TS,
  loop,
});
describe('evaluator-specific decision admission', () => {
  it.each(configs)(
    'agrees across create, import, save, validate and publish for $kind',
    async (config) => {
      const t = await createTestApp();
      apps.push(t);
      await t.container.repos.secretsFor('local').set('jev-api-key', 'synthetic-key');
      const input = definition(config),
        created = await t.app.inject({
          method: 'POST',
          url: '/loops',
          payload: { definition: input },
        });
      expect(created.statusCode, created.body).toBe(201);
      expect(created.json().issues).toEqual([]);
      const id = created.json().loop.id as string;
      const imported = await t.app.inject({
        method: 'POST',
        url: '/loops/import',
        payload: envelope(input),
      });
      expect(imported.statusCode, imported.body).toBe(201);
      expect(imported.json().issues).toEqual([]);
      const saved = await t.app.inject({
        method: 'PUT',
        url: `/loops/${id}/draft`,
        payload: { definition: input },
      });
      expect(saved.statusCode, saved.body).toBe(200);
      expect(saved.json().issues).toEqual([]);
      const validated = await t.app.inject({
        method: 'POST',
        url: `/loops/${id}/validate`,
        payload: { definition: input },
      });
      expect(validated.json()).toMatchObject({ issues: [], publishable: true });
      const published = await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` });
      expect(published.statusCode, published.body).toBe(200);
      expect(published.json().version.definition.nodes[1].config).toEqual(config);
    },
  );
  it.each(configs.filter((config) => config.kind !== 'classifier'))(
    'reports the same invalid source path across authoring and publish for $kind',
    async (config) => {
      const t = await createTestApp();
      apps.push(t);
      const invalid =
        config.kind === 'expression'
          ? { ...config, jsonata: '(' }
          : { ...config, instructions: '{{ missing' };
      const input = definition(invalid),
        created = await t.app.inject({
          method: 'POST',
          url: '/loops',
          payload: { definition: input },
        });
      expect(created.statusCode, created.body).toBe(201);
      const id = created.json().loop.id as string,
        issues = created.json().issues;
      expect(issues).toContainEqual(
        expect.objectContaining({
          path: config.kind === 'expression' ? 'config.jsonata' : 'config.instructions',
        }),
      );
      const saved = await t.app.inject({
          method: 'PUT',
          url: `/loops/${id}/draft`,
          payload: { definition: input },
        }),
        imported = await t.app.inject({
          method: 'POST',
          url: '/loops/import',
          payload: envelope(input),
        }),
        validated = await t.app.inject({
          method: 'POST',
          url: `/loops/${id}/validate`,
          payload: { definition: input },
        });
      for (const response of [saved, imported, validated])
        expect(response.json().issues).toEqual(issues);
      const published = await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` });
      expect(published.statusCode).toBe(422);
      expect(published.json().errors).toEqual(issues);
    },
  );
  it.each([1, 2, 3])(
    'refuses a format-%s export with the existing upgrade-required code',
    async (version) => {
      const t = await createTestApp();
      apps.push(t);
      const response = await t.app.inject({
        method: 'POST',
        url: '/loops/import',
        payload: {
          ...envelope(minimalLoop()),
          formatVersion: version,
          loop: { ...minimalLoop(), schemaVersion: version },
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('LOOP_FORMAT_UPGRADE_REQUIRED');
    },
  );
});

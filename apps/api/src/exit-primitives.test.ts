import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ExitPredicateSchema,
  type ClassifierPrimitive,
  type LoopDefinitionInput,
  type RunRecord,
} from '@graphgoblin/contracts';
import { FakeClassifierRegistry } from '@graphgoblin/engine/testing';
import { createTestApp, startFakeClassifierEndpoint, type TestApp } from './testing/test-app.js';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp({ realClassifiers: true });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await t.close();
});
function definition(type: ClassifierPrimitive, model = 'selected'): LoopDefinitionInput {
  const answer =
    type === 'noul'
      ? {
          type,
          true: { label: 'Ready', criteria: 'Ready' },
          false: { label: 'Continue', criteria: 'Continue' },
        }
      : type === 'choice'
        ? {
            type,
            options: [
              { id: 'ready', label: 'Ready', criteria: 'Ready' },
              { id: 'continue', label: 'Continue', criteria: 'Continue' },
            ],
          }
        : { type, anchors: ['low', 'high'] };
  const match =
    type === 'noul'
      ? { type, value: true }
      : type === 'choice'
        ? { type, optionIds: ['ready'] }
        : { type, operator: 'eq', value: 0 };
  return {
    schemaVersion: 3,
    name: 'exit-' + type,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } },
      {
        id: 'done',
        kind: 'exit',
        label: 'Done',
        config: {
          criteria: [
            ExitPredicateSchema.parse({
              when: 'predicate',
              answer,
              evaluation: {
                kind: 'classifier',
                model,
                question: 'Evaluate {{ trigger.payload.value }}',
              },
              match,
              outcome: 'success',
            }),
          ],
          return: { mapping: 'trigger.payload.value', channels: [{ kind: 'caller' }] },
        },
      },
    ],
    edges: [{ id: 'out', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
  };
}
async function register(endpoint: string, primitives: ClassifierPrimitive[], enabled = true) {
  expect(
    (
      await t.app.inject({
        method: 'PUT',
        url: '/classifier-models/selected',
        payload: {
          displayName: 'Selected exit model',
          provider: 'http',
          providerModel: 'native-exit',
          endpoint,
          primitives,
        },
      })
    ).statusCode,
  ).toBe(200);
  if (enabled)
    expect(
      (
        await t.app.inject({
          method: 'PATCH',
          url: '/classifier-models/selected',
          payload: { enabled: true },
        })
      ).statusCode,
    ).toBe(200);
}
async function run(loopId: string) {
  const started = await t.app.inject({
    method: 'POST',
    url: `/loops/${loopId}/runs`,
    payload: { input: { value: 'ready' } },
  });
  expect(started.statusCode, started.body).toBe(202);
  const id = started.json<{ run: RunRecord }>().run.id;
  await t.idle();
  return {
    record: await t.container.repos.runs.get(id),
    events: await t.container.repos.events.read(id),
  };
}
describe('explicit primitive exit API admission and execution', () => {
  it.each(['noul', 'choice', 'score'] as const)(
    'executes only the selected HTTP %s exit primitive with factual evidence',
    async (type) => {
      const fixture = await startFakeClassifierEndpoint();
      try {
        await register(fixture.endpoint, [type]);
        const id = await t.publishLoop(definition(type));
        const { record, events } = await run(id);
        expect(record).toMatchObject({ status: 'succeeded', result: 'ready' });
        expect(events.find((event) => event.type === 'exit.evaluated')).toMatchObject({
          criteria: [
            {
              status: 'matched',
              strategy: 'classifier',
              answer: { type },
              acceptance: { status: 'accepted' },
              provenance: {
                kind: 'classifier',
                provider: 'http',
                classifierId: 'selected',
                model: 'native-exit',
                effort: null,
              },
            },
          ],
          result: { kind: 'completed', criterionIndex: 0 },
        });
        expect(events.some((event) => event.type === 'decision.made')).toBe(false);
        expect(fixture.requests).toHaveLength(1);
        expect(fixture.requests[0]).toMatchObject({
          body: {
            model: 'native-exit',
            state: {
              trigger: { value: 'ready' },
              vars: {},
              lastOutput: { value: 'ready' },
              lastMessage: null,
              iteration: 1,
            },
            questions: { answer: { type, instructions: 'Evaluate ready' } },
          },
        });
        expect(t.codex.nouls).toEqual([]);
        expect(t.codex.choices).toEqual([]);
      } finally {
        await fixture.close();
      }
    },
  );
  it.each(['noul', 'choice', 'score'] as const)(
    'checks selected %s capability across all admission endpoints before any call',
    async (type) => {
      const fixture = await startFakeClassifierEndpoint();
      try {
        await register(fixture.endpoint, [type === 'choice' ? 'score' : 'choice']);
        const input = definition(type);
        const baseId = await t.publishLoop({
          ...input,
          nodes: input.nodes.map((node) => (node.kind === 'exit' ? { ...node, config: {} } : node)),
        });
        const create = await t.app.inject({
          method: 'POST',
          url: '/loops',
          payload: { definition: input },
        });
        const save = await t.app.inject({
          method: 'PUT',
          url: `/loops/${baseId}/draft`,
          payload: { definition: input },
        });
        const imported = await t.app.inject({
          method: 'POST',
          url: '/loops/import',
          payload: {
            format: 'graphgoblin-loop',
            formatVersion: 3,
            exportedAt: '2026-10-02T12:00:00.000Z',
            loop: input,
          },
        });
        for (const response of [create, save, imported]) {
          expect(response.statusCode, response.body).toBe(400);
          expect(response.json().errors).toContainEqual(
            expect.objectContaining({
              code: 'CLASSIFIER_PRIMITIVE_UNSUPPORTED',
              nodeId: 'done',
              path: 'config.criteria.0.evaluation.model',
            }),
          );
        }
        const validate = await t.app.inject({
          method: 'POST',
          url: `/loops/${baseId}/validate`,
          payload: { definition: input },
        });
        expect(validate.json().publishable).toBe(false);
        expect(validate.json().issues).toContainEqual(
          expect.objectContaining({ code: 'CLASSIFIER_PRIMITIVE_UNSUPPORTED' }),
        );
        await register(fixture.endpoint, [type]);
        const saved = await t.app.inject({
          method: 'PUT',
          url: `/loops/${baseId}/draft`,
          payload: { definition: input },
        });
        expect(saved.statusCode, saved.body).toBe(200);
        await register(fixture.endpoint, [type === 'choice' ? 'score' : 'choice']);
        expect(
          (await t.app.inject({ method: 'POST', url: `/loops/${baseId}/publish` })).statusCode,
        ).toBe(422);
        expect(fixture.requests).toEqual([]);
      } finally {
        await fixture.close();
      }
    },
  );
  it('retains a rejected false Noul as a nonmatch even when false is authored', async () => {
    const fixture = await startFakeClassifierEndpoint();
    fixture.respondWith(() => ({ body: { answers: { answer: { type: 'noul', noul: 0.4 } } } }));
    try {
      await register(fixture.endpoint, ['noul']);
      const input = definition('noul');
      for (const node of input.nodes)
        if (node.kind === 'exit') {
          node.config.criteria = [
            ExitPredicateSchema.parse({
              ...node.config.criteria?.[0],
              evaluation: {
                kind: 'classifier',
                model: 'selected',
                question: '?',
                minConfidence: 0.8,
              },
              match: { type: 'noul', value: false },
            }),
          ];
        }
      const { events } = await run(await t.publishLoop(input));
      expect(events.find((event) => event.type === 'exit.evaluated')).toMatchObject({
        criteria: [
          {
            status: 'not-matched',
            answer: { holds: false, trueProbability: 0.4, confidence: 0.6 },
            acceptance: { status: 'rejected', minConfidence: 0.8 },
            configuredMinConfidence: 0.8,
            rejection: { kind: 'classifier-confidence', minimum: 0.8, confidence: 0.6 },
          },
        ],
        result: { reason: 'default-success' },
      });
    } finally {
      await fixture.close();
    }
  });
  it('checks explicit exit LLM model and effort at its criterion path', async () => {
    const input = definition('noul');
    for (const node of input.nodes)
      if (node.kind === 'exit')
        node.config.criteria = [
          ExitPredicateSchema.parse({
            ...node.config.criteria?.[0],
            evaluation: {
              kind: 'llm',
              harness: 'codex',
              model: { mode: 'explicit', value: 'unknown-model' },
              effort: { mode: 'explicit', value: 'low' },
              question: '?',
            },
          }),
        ];
    const rejected = await t.app.inject({
      method: 'POST',
      url: '/loops',
      payload: { definition: input },
    });
    expect(rejected.statusCode, rejected.body).toBe(400);
    expect(rejected.json().errors).toContainEqual(
      expect.objectContaining({
        code: 'MODEL_NOT_IN_CATALOG',
        path: 'config.criteria.0.evaluation.model',
      }),
    );
    for (const node of input.nodes)
      if (node.kind === 'exit')
        node.config.criteria = [
          ExitPredicateSchema.parse({
            ...node.config.criteria?.[0],
            evaluation: {
              kind: 'llm',
              harness: 'codex',
              model: { mode: 'explicit', value: 'gpt-6-luna' },
              effort: { mode: 'explicit', value: 'low' },
              question: '?',
            },
          }),
        ];
    const { events } = await run(await t.publishLoop(input));
    expect(events.find((event) => event.type === 'exit.evaluated')).toMatchObject({
      criteria: [{ provenance: { model: 'gpt-6-luna', effort: 'low', provider: 'codex' } }],
    });
  });
  it('uses a fake classifier by default and never reaches fetch for a synthetic Noul exit', async () => {
    await t.close();
    const fetch = vi.fn(() => Promise.reject(new Error('Unexpected network')));
    vi.stubGlobal('fetch', fetch);
    t = await createTestApp();
    expect(t.container.ports.classifiers).toBeInstanceOf(FakeClassifierRegistry);
    await t.container.repos.secretsFor('local').set('jev-api-key', 'synthetic-key');
    const { record } = await run(await t.publishLoop(definition('noul', 'jev')));
    expect(record?.status).toBe('succeeded');
    expect(t.jev.classifierNouls).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('refuses Choice expressions in exit configuration at every authored admission endpoint', async () => {
    await register('http://127.0.0.1:65500', ['choice']);
    const input = definition('choice');
    const baseId = await t.publishLoop({
      ...input,
      nodes: input.nodes.map((node) => (node.kind === 'exit' ? { ...node, config: {} } : node)),
    });
    for (const node of input.nodes)
      if (node.kind === 'exit' && node.config.criteria?.[0]?.when === 'predicate') {
        node.config.criteria[0].evaluation = { kind: 'expression', jsonata: '"ready"' };
      }
    const responses = [
      await t.app.inject({ method: 'POST', url: '/loops', payload: { definition: input } }),
      await t.app.inject({
        method: 'PUT',
        url: `/loops/${baseId}/draft`,
        payload: { definition: input },
      }),
      await t.app.inject({
        method: 'POST',
        url: '/loops/import',
        payload: {
          format: 'graphgoblin-loop',
          formatVersion: 3,
          exportedAt: '2026-10-02T12:00:00.000Z',
          loop: input,
        },
      }),
      await t.app.inject({
        method: 'POST',
        url: `/loops/${baseId}/validate`,
        payload: { definition: input },
      }),
    ];
    for (const response of responses) {
      expect(response.statusCode, response.body).toBe(400);
      expect(response.body).toContain('expression');
    }
    expect(t.codex.choices).toEqual([]);
  });
});

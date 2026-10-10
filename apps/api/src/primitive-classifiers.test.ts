import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ClassifierPrimitive,
  LoopDefinitionInput,
  LoopIssue,
  RunRecord,
} from '@graphgoblin/contracts';
import { createTestApp, startFakeClassifierEndpoint, type TestApp } from './testing/test-app.js';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp({ realClassifiers: true });
});
afterEach(async () => {
  await t.close();
});

function definition(type: 'noul' | 'score', model = 'local-primitive'): LoopDefinitionInput {
  return {
    schemaVersion: 3,
    name: type,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } },
      {
        id: 'decide',
        kind: 'decision',
        label: 'Evaluate',
        config: {
          answer:
            type === 'noul'
              ? {
                  type: 'noul',
                  true: { id: 'pass', label: 'Pass', criteria: 'Ready' },
                  false: { id: 'fix', label: 'Fix', criteria: 'Not ready' },
                }
              : {
                  type: 'score',
                  anchors: ['low', 'high', 'critical'],
                  bands: [
                    { id: 'pass', label: 'Low', min: 0, max: 1 },
                    { id: 'fix', label: 'High', min: 1, max: 2 },
                  ],
                },
          evaluation: {
            kind: 'classifier',
            model,
            question: 'Evaluate {{ trigger.payload.value }}',
          },
        },
      },
      {
        id: 'done',
        kind: 'exit',
        label: 'Done',
        config: { return: { mapping: 'lastOutput.value' } },
      },
    ],
    edges: [
      { id: 'start', from: { node: 'start', port: 'out' }, to: { node: 'decide' } },
      { id: 'pass', from: { node: 'decide', port: 'pass' }, to: { node: 'done' } },
      { id: 'fix', from: { node: 'decide', port: 'fix' }, to: { node: 'done' } },
    ],
  };
}
async function register(endpoint: string, primitives: ClassifierPrimitive[], enabled = true) {
  expect(
    (
      await t.app.inject({
        method: 'PUT',
        url: '/classifier-models/local-primitive',
        payload: {
          displayName: 'Local primitive',
          provider: 'http',
          providerModel: 'native',
          primitives,
          endpoint,
        },
      })
    ).statusCode,
  ).toBe(200);
  if (enabled)
    expect(
      (
        await t.app.inject({
          method: 'PATCH',
          url: '/classifier-models/local-primitive',
          payload: { enabled: true },
        })
      ).statusCode,
    ).toBe(200);
}
async function run(loopId: string) {
  const response = await t.app.inject({
    method: 'POST',
    url: `/loops/${loopId}/runs`,
    payload: { input: { value: 'ready' } },
  });
  expect(response.statusCode, response.body).toBe(202);
  const id = response.json<{ run: RunRecord }>().run.id;
  await t.idle();
  return {
    record: await t.container.repos.runs.get(id),
    events: await t.container.repos.events.read(id),
  };
}

describe('primitive classifier API admission and execution', () => {
  it.each(['noul', 'score'] as const)(
    'executes the selected HTTP %s primitive with catalog provenance',
    async (primitive) => {
      const fixture = await startFakeClassifierEndpoint();
      try {
        await register(fixture.endpoint, [primitive]);
        const id = await t.publishLoop(definition(primitive));
        const result = await run(id);
        expect(result.record).toMatchObject({
          status: 'succeeded',
          result: {
            answer: { type: primitive },
            portId: 'pass',
            provenance: {
              kind: 'classifier',
              provider: 'http',
              classifierId: 'local-primitive',
              model: 'native',
              effort: null,
            },
          },
        });
        expect(result.events.find((event) => event.type === 'decision.made')).toMatchObject({
          answer: { type: primitive },
          portId: 'pass',
        });
        expect(fixture.requests).toHaveLength(1);
        expect(fixture.requests[0]).toMatchObject({
          body: {
            model: 'native',
            questions: {
              answer: {
                type: primitive,
                instructions: 'Evaluate ready',
                criteria:
                  primitive === 'noul'
                    ? { true: 'Ready', false: 'Not ready' }
                    : ['low', 'high', 'critical'],
              },
            },
          },
        });
        expect(t.codex.choices).toEqual([]);
        expect(t.codex.nouls).toEqual([]);
      } finally {
        await fixture.close();
      }
    },
  );

  it.each(['noul', 'score'] as const)(
    'rejects unsupported %s capability before calls',
    async (primitive) => {
      const fixture = await startFakeClassifierEndpoint();
      try {
        await register(fixture.endpoint, ['choice']);
        const input = definition(primitive);
        const response = await t.app.inject({
          method: 'POST',
          url: '/loops',
          payload: { definition: input },
        });
        expect(response.statusCode, response.body).toBe(400);
        expect(response.json<{ errors: LoopIssue[] }>().errors).toContainEqual(
          expect.objectContaining({
            code: 'CLASSIFIER_PRIMITIVE_UNSUPPORTED',
            nodeId: 'decide',
            path: 'config.evaluation.model',
          }),
        );
        expect(fixture.requests).toEqual([]);
        expect(
          await t.container.classifierRegistry.resolve('local', 'local-primitive', primitive),
        ).toMatchObject({ status: 'unavailable', reason: 'CLASSIFIER_PRIMITIVE_UNSUPPORTED' });
      } finally {
        await fixture.close();
      }
    },
  );

  it.each(['noul', 'score'] as const)(
    'blocks disabled %s publication and rechecks an edited capability at runtime',
    async (primitive) => {
      const fixture = await startFakeClassifierEndpoint();
      try {
        await register(fixture.endpoint, [primitive], false);
        const created = await t.app.inject({
          method: 'POST',
          url: '/loops',
          payload: { definition: definition(primitive) },
        });
        expect(created.statusCode, created.body).toBe(201);
        const id = created.json<{ loop: { id: string } }>().loop.id;
        expect(
          (await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` })).statusCode,
        ).toBe(422);
        expect(
          (
            await t.app.inject({
              method: 'PATCH',
              url: '/classifier-models/local-primitive',
              payload: { enabled: true },
            })
          ).statusCode,
        ).toBe(200);
        expect(
          (await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` })).statusCode,
        ).toBe(200);
        await t.app.inject({
          method: 'PUT',
          url: '/classifier-models/local-primitive',
          payload: {
            displayName: 'Changed',
            provider: 'http',
            providerModel: 'next',
            primitives: ['choice'],
            endpoint: fixture.endpoint,
          },
        });
        const result = await run(id);
        expect(result.record).toMatchObject({
          status: 'failed',
          failure: { code: 'EVALUATION_INVALID_CONFIGURATION', resumable: false },
        });
        expect(fixture.requests).toEqual([]);
        expect(result.events.some((event) => event.type === 'decision.made')).toBe(false);
      } finally {
        await fixture.close();
      }
    },
  );
});

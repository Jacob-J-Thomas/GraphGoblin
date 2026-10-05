import { describe, expect, it } from 'vitest';
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import type { ClassifierUnavailableReason } from '../ports.js';
import { FakeClassifierRegistry, FakeDecider, createTestEngine } from '../testing/index.js';

function loop(model?: string, fallback = true): LoopDefinitionInput {
  return {
    schemaVersion: 1,
    name: `classifier-${model ?? 'default'}`,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } },
      {
        id: 'decide',
        kind: 'decision',
        label: 'Choose',
        config: {
          question: 'Which?',
          routes: [
            { label: 'yes', description: 'Yes' },
            { label: 'no', description: 'No' },
          ],
          strategy: fallback ? ['jev', 'expression'] : ['jev'],
          jev: { ...(model ? { model } : {}), minConfidence: 0.5 },
          ...(fallback ? { expression: { jsonata: '"no"' } } : {}),
        },
      },
      { id: 'yes', kind: 'exit', label: 'Yes', config: { return: { mapping: '"yes"' } } },
      { id: 'no', kind: 'exit', label: 'No', config: { return: { mapping: '"no"' } } },
    ],
    edges: [
      { id: 'start-decide', from: { node: 'start', port: 'out' }, to: { node: 'decide' } },
      { id: 'route-yes', from: { node: 'decide', port: 'yes' }, to: { node: 'yes' } },
      { id: 'route-no', from: { node: 'decide', port: 'no' }, to: { node: 'no' } },
    ],
  };
}
describe('classifier selection through the executor', () => {
  it('routes two registered classifiers distinctly and records catalog provenance and owner', async () => {
    const e = await createTestEngine();
    const a = new FakeDecider('jev', () => ({ label: 'yes', confidence: 1 }));
    const b = new FakeDecider('jev', () => ({ label: 'no', confidence: 1 }));
    e.ports.classifiers.models.set('a', a);
    e.ports.classifiers.models.set('b', b);
    for (const [id, route] of [
      ['a', 'yes'],
      ['b', 'no'],
    ] as const) {
      const v = e.publish(loop(id));
      const run = await e.runToIdle(v.loopId);
      expect(run.result).toBe(route);
      expect(e.events(run.id).find((event) => event.type === 'decision.made')).toMatchObject({
        strategy: 'jev',
        classifierModel: id,
        route,
      });
    }
    expect(e.ports.classifiers.requests).toEqual([
      { ownerId: 'local', modelId: 'a' },
      { ownerId: 'local', modelId: 'b' },
    ]);
    expect(a.choices[0]).toMatchObject({
      question: 'Which?',
      options: [
        { label: 'yes', description: 'Yes' },
        { label: 'no', description: 'No' },
      ],
    });
    expect(b.choices).toHaveLength(1);
  });
  it('uses built-in jev for omitted selection without adding configuration to the loop', async () => {
    const e = await createTestEngine();
    const v = e.publish(loop());
    expect(v.definition.nodes[1]).toMatchObject({
      config: { jev: { primitive: 'choice', minConfidence: 0.5 } },
    });
    const run = await e.runToIdle(v.loopId);
    expect(run.result).toBe('yes');
    expect(e.events(run.id).find((event) => event.type === 'decision.made')).toHaveProperty(
      'classifierModel',
      'jev',
    );
  });
  it.each([
    'CLASSIFIER_MODEL_NOT_FOUND',
    'CLASSIFIER_PRIMITIVE_UNSUPPORTED',
    'CLASSIFIER_MODEL_DISABLED',
    'CLASSIFIER_SECRET_MISSING',
    'CLASSIFIER_SECRET_UNREADABLE',
  ] satisfies ClassifierUnavailableReason[])(
    'skips %s, never substitutes built-in, and explains exhaustion',
    async (reason) => {
      const e = await createTestEngine();
      e.ports.classifiers.unavailable.set('selected', {
        status: 'unavailable',
        reason,
        message: 'Selected model cannot run',
      });
      const fallback = e.publish(loop('selected'));
      const run = await e.runToIdle(fallback.loopId);
      expect(run.result).toBe('no');
      expect(e.ports.jev.choices).toEqual([]);
      expect(e.events(run.id).find((event) => event.type === 'decision.made')).not.toHaveProperty(
        'classifierModel',
      );
      const only = e.publish({ ...loop('selected', false), name: 'only' });
      const exhausted = await e.runToIdle(only.loopId);
      expect(exhausted.failure).toMatchObject({
        code: 'DECISION_NO_ROUTE',
        details: { tried: [expect.stringContaining(reason)] },
      });
    },
  );
  it('covers unknown fake registrations, unconfigured fake providers, and low confidence fallback', async () => {
    const fake = new FakeClassifierRegistry();
    expect(await fake.resolve('local', 'missing')).toMatchObject({
      reason: 'CLASSIFIER_MODEL_NOT_FOUND',
    });
    const e = await createTestEngine();
    e.ports.jev.isAvailable = false;
    const v = e.publish(loop());
    expect((await e.runToIdle(v.loopId)).result).toBe('no');
    e.ports.classifiers.models.set(
      'low',
      new FakeDecider('jev', () => ({ label: 'yes', confidence: 0.1 })),
    );
    const low = e.publish(loop('low'));
    expect((await e.runToIdle(low.loopId)).result).toBe('no');
  });
  it('resolves the current selection again on resumed execution and propagates provider errors', async () => {
    const e = await createTestEngine();
    const v = e.publish(loop('missing', false));
    const run = await e.runToIdle(v.loopId);
    expect(run.failure?.code).toBe('DECISION_NO_ROUTE');
    e.ports.classifiers.models.set('missing', new FakeDecider('jev'));
    await e.manager.resume(run.id);
    expect((await e.settle(run.id)).result).toBe('yes');
    e.ports.classifiers.models.set('throws', {
      choose: () =>
        Promise.reject(Object.assign(new Error('provider failed'), { code: 'DECIDER_HTTP_ERROR' })),
    });
    const throws = e.publish(loop('throws'));
    expect((await e.runToIdle(throws.loopId)).failure).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'provider failed',
    });
  });
  it('passes executor cancellation to the selected provider', async () => {
    const e = await createTestEngine();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    e.ports.classifiers.models.set('blocking', {
      choose: (_request, signal) =>
        new Promise((_resolve, reject) => {
          started();
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        }),
    });
    const v = e.publish(loop('blocking'));
    const run = await e.start(v.loopId);
    await ready;
    await e.manager.cancel(run.id);
    expect((await e.settle(run.id)).status).toBe('cancelled');
  });
});

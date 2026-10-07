import { describe, expect, it } from 'vitest';
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import type { ClassifierUnavailableReason } from '../ports.js';
import { FakeClassifierRegistry, FakeDecider, createTestEngine } from '../testing/index.js';
function loop(model = 'jev'): LoopDefinitionInput {
  return {
    schemaVersion: 2,
    name: 'classifier-' + model,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } },
      {
        id: 'decide',
        kind: 'decision',
        label: 'Choose',
        config: {
          answer: {
            type: 'choice',
            options: [
              { id: 'yes', label: 'Yes', criteria: 'Yes criterion' },
              { id: 'no', label: 'No', criteria: 'No criterion' },
            ],
          },
          evaluation: { kind: 'classifier', model, question: 'Which?', minConfidence: 0.5 },
        },
      },
      { id: 'yes', kind: 'exit', label: 'Yes', config: { return: { mapping: '"yes"' } } },
      { id: 'no', kind: 'exit', label: 'No', config: { return: { mapping: '"no"' } } },
    ],
    edges: [
      { id: 'start-decide', from: { node: 'start', port: 'out' }, to: { node: 'decide' } },
      { id: 'yes-route', from: { node: 'decide', port: 'yes' }, to: { node: 'yes' } },
      { id: 'no-route', from: { node: 'decide', port: 'no' }, to: { node: 'no' } },
    ],
  };
}
describe('classifier selection through the executor', () => {
  it('routes registered classifiers distinctly with current catalog provenance and owner', async () => {
    const e = await createTestEngine();
    for (const [id, optionId] of [
      ['a', 'yes'],
      ['b', 'no'],
    ] as const) {
      const d = new FakeDecider('jev', () => ({
        type: 'choice',
        optionId,
        confidence: 1,
        probabilities: { yes: optionId === 'yes' ? 1 : 0, no: optionId === 'no' ? 1 : 0 },
      }));
      e.ports.classifiers.models.set(id, d);
      const r = await e.runToIdle(e.publish(loop(id)).loopId);
      expect(r.result).toBe(optionId);
      expect(e.events(r.id).find((ev) => ev.type === 'decision.made')).toMatchObject({
        answer: { optionId },
        portId: optionId,
        provenance: {
          kind: 'classifier',
          provider: 'http',
          classifierId: id,
          model: id,
          effort: null,
        },
      });
      expect(d.choices[0]).toMatchObject({
        question: 'Which?',
        options: [
          { id: 'yes', label: 'Yes', criteria: 'Yes criterion' },
          { id: 'no', label: 'No', criteria: 'No criterion' },
        ],
      });
    }
    expect(e.ports.classifiers.requests).toEqual([
      { ownerId: 'local', modelId: 'a' },
      { ownerId: 'local', modelId: 'b' },
    ]);
  });
  it.each([
    'CLASSIFIER_MODEL_NOT_FOUND',
    'CLASSIFIER_PRIMITIVE_UNSUPPORTED',
    'CLASSIFIER_MODEL_DISABLED',
    'CLASSIFIER_SECRET_MISSING',
    'CLASSIFIER_SECRET_UNREADABLE',
  ] satisfies ClassifierUnavailableReason[])(
    'reports %s without selecting another evaluator',
    async (reason) => {
      const e = await createTestEngine();
      e.ports.classifiers.unavailable.set('selected', {
        status: 'unavailable',
        reason,
        message: 'private diagnostic',
      });
      const r = await e.runToIdle(e.publish(loop('selected')).loopId);
      const invalid = reason === 'CLASSIFIER_PRIMITIVE_UNSUPPORTED';
      expect(r.failure).toMatchObject({
        code: invalid ? 'EVALUATION_INVALID_CONFIGURATION' : 'EVALUATION_UNAVAILABLE',
        resumable: !invalid,
        details: { reason },
      });
      expect(JSON.stringify(e.events(r.id))).not.toContain('private diagnostic');
      expect(e.ports.jev.choices).toEqual([]);
      expect(e.ports.codexDecider.choices).toEqual([]);
      expect(e.eventTypes(r.id)).not.toContain('decision.made');
    },
  );
  it('covers unknown fake registrations and unconfigured providers', async () => {
    expect(await new FakeClassifierRegistry().resolve('local', 'missing')).toMatchObject({
      reason: 'CLASSIFIER_MODEL_NOT_FOUND',
    });
    const e = await createTestEngine();
    e.ports.jev.isAvailable = false;
    const r = await e.runToIdle(e.publish(loop()).loopId);
    expect(r.failure).toMatchObject({ code: 'EVALUATION_UNAVAILABLE', resumable: true });
  });
  it('resolves the selected classifier again after restoring its configuration', async () => {
    const e = await createTestEngine();
    e.ports.jev.isAvailable = false;
    const r = await e.runToIdle(e.publish(loop()).loopId);
    expect(r.failure?.resumable).toBe(true);
    e.ports.jev.isAvailable = true;
    await e.manager.resume(r.id);
    expect((await e.settle(r.id)).result).toBe('yes');
    expect(e.ports.classifiers.requests).toHaveLength(2);
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
    const r = await e.start(e.publish(loop('blocking')).loopId);
    await ready;
    await e.manager.cancel(r.id);
    expect((await e.settle(r.id)).status).toBe('cancelled');
    expect(e.eventTypes(r.id)).not.toContain('decision.made');
  });
});

import { describe, expect, it } from 'vitest';
import {
  MAX_MODEL_NAME_LENGTH,
  ExitPredicateSchema,
  RunEventSchema,
  type ExitConfig,
  type LoopDefinitionInput,
} from '@graphgoblin/contracts';
import { createTestEngine, singleNodeLoop } from '@graphgoblin/engine/testing';

function loop(config: Partial<ExitConfig>): LoopDefinitionInput {
  return singleNodeLoop(
    'exit-evidence',
    {
      id: 'prep',
      kind: 'mutate',
      label: 'Prepare',
      config: { operations: [{ op: 'delete', path: '/vars/x' }] },
    },
    config,
  );
}

describe('exit evaluation evidence', () => {
  it('retains the actual resolved Codex model when the judge call fails', async () => {
    const e = await createTestEngine();
    e.ports.codexDecider.noul = () =>
      Promise.reject(
        Object.assign(new Error('private judge error'), {
          code: 'DECIDER_HTTP_ERROR',
          status: 503,
        }),
      );
    const v = e.publish(
      loop({
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
              question: 'Done?',
            },
            match: { type: 'noul', value: true },
            outcome: 'success',
          },
        ],
      }),
    );
    const r = await e.runToIdle(v.loopId);
    expect(e.events(r.id).find((event) => event.type === 'exit.evaluated')).toMatchObject({
      criteria: [
        {
          status: 'error',
          provenance: { model: 'gpt-6-luna' },
          diagnostic: { code: 'EVALUATION_PROVIDER_FAILED' },
        },
      ],
    });
  });

  it('emits valid evidence for a Codex model at the configured maximum', async () => {
    const e = await createTestEngine();
    const model = 'm'.repeat(MAX_MODEL_NAME_LENGTH);
    e.ports.modelCatalog.entries.push({ ...e.ports.modelCatalog.entries[0]!, model });
    const definition = loop({
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
            question: 'Done?',
          },
          match: { type: 'noul', value: true },
          outcome: 'success',
        },
      ],
    });
    definition.settings = { defaults: { byHarness: { codex: { model } } } };
    const v = e.publish(definition);
    const run = await e.runToIdle(v.loopId);
    expect(run.status).toBe('succeeded');
    const event = e.events(run.id).find((event) => event.type === 'exit.evaluated');
    expect(event).toMatchObject({ criteria: [{ provenance: { model } }] });
    expect(RunEventSchema.parse(JSON.parse(JSON.stringify(event)))).toEqual(event);
  });
  it('identifies the expression following a false Jev predicate and skips later criteria', async () => {
    const e = await createTestEngine();
    e.ports.jev.classifyNoul = () => Promise.resolve({ type: 'noul', trueProbability: 0.07 });
    const v = e.publish(
      loop({
        criteria: [
          {
            when: 'predicate',
            answer: {
              type: 'noul',
              true: { label: 'Ready', criteria: 'Task is done' },
              false: { label: 'Continue', criteria: 'Task is not done' },
            },
            evaluation: { kind: 'classifier', model: 'jev', question: 'Done?' },
            match: { type: 'noul', value: true },
            outcome: 'success',
          },
          {
            when: 'predicate',
            answer: { type: 'noul' },
            evaluation: { kind: 'expression', jsonata: 'true' },
            match: { type: 'noul', value: true },
            outcome: 'success',
          },
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
              question: 'Done?',
            },
            match: { type: 'noul', value: true },
            outcome: 'failure',
          },
        ],
      }),
    );
    const run = await e.runToIdle(v.loopId);
    expect(run.status).toBe('succeeded');
    const event = e.events(run.id).find((event) => event.type === 'exit.evaluated');
    expect(event).toMatchObject({
      iteration: 1,
      criteria: [
        {
          index: 0,
          strategy: 'classifier',
          status: 'not-matched',
          answer: { holds: false, confidence: 1 - 0.07, trueProbability: 0.07 },
          provenance: { classifierId: 'jev' },
        },
        { index: 1, strategy: 'expression', status: 'matched', answer: { holds: true } },
        {
          index: 2,
          strategy: 'llm',
          status: 'skipped',
          reason: { code: 'EARLIER_CRITERION_MATCHED' },
        },
      ],
      result: { kind: 'completed', criterionIndex: 1, outcome: 'success' },
    });
    expect(RunEventSchema.safeParse(event).success).toBe(true);
    expect(e.ports.codexDecider.nouls).toHaveLength(0);
    expect(e.eventTypes(run.id).indexOf('exit.evaluated')).toBeLessThan(
      e.eventTypes(run.id).lastIndexOf('node.finished'),
    );
  });
  it('records Codex model, bounded reasoning and a positive verdict below the confidence threshold', async () => {
    const e = await createTestEngine();
    e.ports.codexDecider.noul = () =>
      Promise.resolve({
        type: 'noul',
        holds: true,
        confidence: 0.4,
        reasoning: 'Reviewed',
      });
    const v = e.publish(
      loop({
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
              question: 'Done?',
            },
            match: { type: 'noul', value: true, minReportedConfidence: 0.8 },
            outcome: 'success',
          },
        ],
      }),
    );
    const run = await e.runToIdle(v.loopId);
    expect(e.events(run.id).find((event) => event.type === 'exit.evaluated')).toMatchObject({
      criteria: [
        {
          status: 'not-matched',
          answer: { holds: true, confidence: 0.4, reasoning: 'Reviewed' },
          rejection: { kind: 'llm-reported-confidence', minimum: 0.8, confidence: 0.4 },
          acceptance: { status: 'accepted' },
          provenance: { model: 'gpt-6-luna' },
        },
      ],
      result: { kind: 'completed', reason: 'default-success' },
    });
    expect(JSON.stringify(e.events(run.id))).not.toContain('untrusted-envelope-field');
  });
  it('records every loop-back and the hard ceiling', async () => {
    const e = await createTestEngine();
    const definition = loop({
      default: 'loop-back',
      loopBack: { targetNodeId: 'prep' },
      criteria: [
        {
          when: 'predicate',
          answer: { type: 'noul' },
          evaluation: { kind: 'expression', jsonata: 'false' },
          match: { type: 'noul', value: true },
          outcome: 'success',
        },
      ],
    });
    definition.settings = { maxIterations: 3 };
    definition.edges.push({
      id: 'back',
      from: { node: 'done', port: 'loopBack' },
      to: { node: 'prep' },
    });
    const v = e.publish(definition);
    const run = await e.runToIdle(v.loopId);
    expect(run.status).toBe('exhausted');
    expect(
      e
        .events(run.id)
        .filter((event) => event.type === 'exit.evaluated')
        .map((event) => ({ iteration: event.iteration, result: event.result })),
    ).toEqual([
      {
        iteration: 1,
        result: { kind: 'looped-back', reason: 'no-criterion-matched', targetNodeId: 'prep' },
      },
      {
        iteration: 2,
        result: { kind: 'looped-back', reason: 'no-criterion-matched', targetNodeId: 'prep' },
      },
      {
        iteration: 3,
        result: {
          kind: 'limit-reached',
          limit: 'iteration-ceiling',
          value: 3,
          outcome: 'exhausted',
        },
      },
    ]);
  });
  it.each([
    { when: 'max-iterations', value: 1, outcome: 'exhausted' },
    { when: 'max-duration', seconds: 1, outcome: 'exhausted' },
  ] as const)('names the configured $when limit', async (criterion) => {
    const e = await createTestEngine();
    const v = e.publish(loop({ criteria: [criterion] }));
    // The fake clock is advanced at node completion, before the exit evaluates elapsed time.
    if (criterion.when === 'max-duration') {
      const original = e.ports.events.append.bind(e.ports.events);
      e.ports.events.append = async (id, drafts, options) => {
        const events = await original(id, drafts, options);
        if (drafts.some((event) => event.type === 'node.finished')) e.ports.clock.advance(2000);
        return events;
      };
    }
    const run = await e.runToIdle(v.loopId);
    expect(e.events(run.id).find((event) => event.type === 'exit.evaluated')).toMatchObject({
      result: { kind: 'limit-reached', limit: criterion.when, value: 1, criterionIndex: 0 },
    });
  });
  it.each(['unavailable', 'provider-error', 'expression-error', 'invalid-confidence'] as const)(
    'records safe evidence for %s before run.failed',
    async (failure) => {
      const e = await createTestEngine();
      const marker = 'private-provider-token';
      if (failure === 'unavailable') e.ports.classifiers.models.clear();
      if (failure === 'provider-error')
        e.ports.jev.classifyNoul = () =>
          Promise.reject(
            Object.assign(new Error(marker), { code: 'DECIDER_HTTP_ERROR', status: 503 }),
          );
      if (failure === 'invalid-confidence')
        e.ports.jev.classifyNoul = () => Promise.resolve({ type: 'noul', trueProbability: NaN });
      const first = ExitPredicateSchema.parse(
        failure === 'expression-error'
          ? {
              when: 'predicate',
              answer: { type: 'noul' },
              evaluation: { kind: 'expression', jsonata: '$error("private-provider-token")' },
              match: { type: 'noul', value: true },
              outcome: 'success',
            }
          : {
              when: 'predicate',
              answer: {
                type: 'noul',
                true: { label: 'Ready', criteria: 'Task is done' },
                false: { label: 'Continue', criteria: 'Task is not done' },
              },
              evaluation: { kind: 'classifier', model: 'jev', question: 'Done?' },
              match: { type: 'noul', value: true },
              outcome: 'success',
            },
      );
      const v = e.publish(
        loop({ criteria: [first, { when: 'max-iterations', value: 1, outcome: 'exhausted' }] }),
      );
      const run = await e.runToIdle(v.loopId);
      expect(run.status).toBe('failed');
      const event = e.events(run.id).find((event) => event.type === 'exit.evaluated');
      expect(event).toMatchObject({
        criteria: [
          { status: 'error' },
          { status: 'skipped', reason: { code: 'EARLIER_CRITERION_FAILED' } },
        ],
        result: { kind: 'failed' },
      });
      expect(RunEventSchema.safeParse(event).success).toBe(true);
      expect(JSON.stringify(event)).not.toContain(marker);
      if (failure === 'provider-error')
        expect(event).toMatchObject({
          result: { diagnostic: { code: 'EVALUATION_PROVIDER_FAILED', status: 503 } },
        });
    },
  );
  it('records cancellation while a predicate is in flight', async () => {
    const e = await createTestEngine();
    let ready!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    e.ports.jev.classifyNoul = (_request, signal) =>
      new Promise((_resolve, reject) => {
        ready();
        signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
          once: true,
        });
      });
    const v = e.publish(
      loop({
        criteria: [
          {
            when: 'predicate',
            answer: {
              type: 'noul',
              true: { label: 'Ready', criteria: 'Task is done' },
              false: { label: 'Continue', criteria: 'Task is not done' },
            },
            evaluation: { kind: 'classifier', model: 'jev', question: 'Done?' },
            match: { type: 'noul', value: true },
            outcome: 'success',
          },
        ],
      }),
    );
    const run = await e.start(v.loopId);
    await started;
    await e.manager.cancel(run.id);
    expect((await e.settle(run.id)).status).toBe('cancelled');
    expect(e.events(run.id).find((event) => event.type === 'exit.evaluated')).toMatchObject({
      result: { kind: 'cancelled' },
    });
  });
  it('records a return mapping failure without claiming the exit completed', async () => {
    const e = await createTestEngine();
    const v = e.publish(
      loop({
        criteria: [
          {
            when: 'predicate',
            answer: { type: 'noul' },
            evaluation: { kind: 'expression', jsonata: 'true' },
            match: { type: 'noul', value: true },
            outcome: 'success',
          },
          { when: 'max-iterations', value: 1, outcome: 'exhausted' },
        ],
        return: { mapping: '$error("private-mapping-error")', channels: [] },
      }),
    );
    const run = await e.runToIdle(v.loopId);
    expect(run.status).toBe('failed');
    const event = e.events(run.id).find((event) => event.type === 'exit.evaluated');
    expect(event).toMatchObject({
      criteria: [
        { status: 'matched' },
        { status: 'skipped', reason: { code: 'EARLIER_CRITERION_MATCHED' } },
      ],
      result: {
        kind: 'failed',
        diagnostic: { code: 'RETURN_MAPPING_ERROR', message: 'Exit return mapping failed' },
      },
    });
    expect(JSON.stringify(event)).not.toContain('private-mapping-error');
  });
});

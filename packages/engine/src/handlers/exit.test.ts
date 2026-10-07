import { describe, expect, it } from 'vitest';
import {
  MAX_MODEL_NAME_LENGTH,
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
  it('emits valid evidence for a Codex model at the configured maximum', async () => {
    const e = await createTestEngine();
    const model = 'm'.repeat(MAX_MODEL_NAME_LENGTH);
    const definition = loop({
      criteria: [{ when: 'predicate', strategy: 'codex', question: 'Done?', outcome: 'success' }],
    });
    definition.settings = { defaults: { model } };
    const v = e.publish(definition);
    const run = await e.runToIdle(v.loopId);
    expect(run.status).toBe('succeeded');
    const event = e.events(run.id).find((event) => event.type === 'exit.evaluated');
    expect(event).toMatchObject({ criteria: [{ model }] });
    expect(RunEventSchema.parse(JSON.parse(JSON.stringify(event)))).toEqual(event);
  });
  it('identifies the expression following a false Jev predicate and skips later criteria', async () => {
    const e = await createTestEngine();
    e.ports.jev.judge = () => Promise.resolve({ holds: false, confidence: 0.93 });
    const v = e.publish(
      loop({
        criteria: [
          { when: 'predicate', strategy: 'jev', question: 'Done?', outcome: 'success' },
          { when: 'predicate', strategy: 'expression', jsonata: 'true', outcome: 'success' },
          { when: 'predicate', strategy: 'codex', question: 'Done?', outcome: 'failure' },
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
          strategy: 'jev',
          status: 'not-matched',
          holds: false,
          confidence: 0.93,
          classifierModel: 'jev',
        },
        { index: 1, strategy: 'expression', status: 'matched', holds: true },
        {
          index: 2,
          strategy: 'codex',
          status: 'skipped',
          reason: { code: 'EARLIER_CRITERION_MATCHED' },
        },
      ],
      result: { kind: 'completed', criterionIndex: 1, outcome: 'success' },
    });
    expect(RunEventSchema.safeParse(event).success).toBe(true);
    expect(e.ports.codexDecider.judgements).toHaveLength(0);
    expect(e.eventTypes(run.id).indexOf('exit.evaluated')).toBeLessThan(
      e.eventTypes(run.id).lastIndexOf('node.finished'),
    );
  });
  it('records Codex model, bounded reasoning and a positive verdict below the confidence threshold', async () => {
    const e = await createTestEngine();
    e.ports.codexDecider.judge = () =>
      Promise.resolve({
        holds: true,
        confidence: 0.4,
        reasoning: 'x'.repeat(3000),
        model: 'untrusted-envelope-field',
      });
    const v = e.publish(
      loop({
        criteria: [
          {
            when: 'predicate',
            strategy: 'codex',
            question: 'Done?',
            outcome: 'success',
            minConfidence: 0.8,
          },
        ],
      }),
    );
    const run = await e.runToIdle(v.loopId);
    expect(e.events(run.id).find((event) => event.type === 'exit.evaluated')).toMatchObject({
      criteria: [
        {
          status: 'not-matched',
          holds: true,
          confidence: 0.4,
          minConfidence: 0.8,
          model: 'gpt-6-luna',
          reasoning: 'x'.repeat(2048),
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
        { when: 'predicate', strategy: 'expression', jsonata: 'false', outcome: 'success' },
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
      if (failure === 'unavailable') e.ports.deciders = [];
      if (failure === 'provider-error')
        e.ports.jev.judge = () =>
          Promise.reject(
            Object.assign(new Error(marker), { code: 'DECIDER_HTTP_ERROR', status: 503 }),
          );
      if (failure === 'invalid-confidence')
        e.ports.jev.judge = () => Promise.resolve({ holds: true, confidence: NaN });
      const first =
        failure === 'expression-error'
          ? {
              when: 'predicate' as const,
              strategy: 'expression' as const,
              jsonata: '$error("private-provider-token")',
              outcome: 'success' as const,
            }
          : {
              when: 'predicate' as const,
              strategy: 'jev' as const,
              question: 'Done?',
              outcome: 'success' as const,
            };
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
          result: { diagnostic: { code: 'DECIDER_HTTP_ERROR', status: 503 } },
        });
    },
  );
  it('records cancellation while a predicate is in flight', async () => {
    const e = await createTestEngine();
    let ready!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    e.ports.jev.judge = (_request, signal) =>
      new Promise((_resolve, reject) => {
        ready();
        signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
          once: true,
        });
      });
    const v = e.publish(
      loop({
        criteria: [{ when: 'predicate', strategy: 'jev', question: 'Done?', outcome: 'success' }],
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
          { when: 'predicate', strategy: 'expression', jsonata: 'true', outcome: 'success' },
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

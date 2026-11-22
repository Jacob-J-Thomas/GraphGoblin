import { expect, it } from 'vitest';
import type { HarnessId, RunEvent, RunRecord, RunRecovery } from '@graphgoblin/contracts';
import type { HarnessEvent, HarnessPort, HarnessResult } from '@graphgoblin/engine';
import { FakeHarness, singleNodeLoop } from '@graphgoblin/engine/testing';
import { createTestApp } from './testing/test-app.js';

const families = ['codex', 'claude'] as const;
const definition = (family: HarnessId) =>
  singleNodeLoop('API repair boundary', {
    id: 'infer',
    kind: 'inference',
    label: 'Infer',
    config: {
      harness: family,
      model: family === 'claude' ? 'claude-opus-5-5' : 'gpt-6-luna',
      effort: 'low',
      harnessOptions: { sandbox: 'read-only', approval: 'never' },
      prompt: { template: 'Original task' },
      output: {
        schema: {
          jsonSchema: { type: 'number' },
          repair: {
            enabled: true,
            maxAttempts: 1,
            prompt: 'Repair exactly: {{ value }}',
          },
        },
      },
    },
  });
it.each(
  families.flatMap((family) =>
    (['missing', 'termination', 'cancel', 'cleanup'] as const).map((boundary) => ({
      family,
      boundary,
    })),
  ),
)(
  'keeps later authoritative $family evidence at $boundary over an earlier event',
  async ({ family, boundary }) => {
    const fake = new FakeHarness([{ finalText: 'invalid' }, { finalText: '42' }], family);
    let calls = 0;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const code =
      boundary === 'missing' ? 'HARNESS_SESSION_MISSING' : 'HARNESS_TERMINATION_UNCONFIRMED';
    const harness: HarnessPort = {
      id: family,
      preflight: () => fake.preflight(),
      start(request, signal) {
        calls += 1;
        return fake.start(request, signal);
      },
      resume(id, request, signal) {
        calls += 1;
        if (calls > 2) return fake.resume(id, request, signal);
        let reject!: (error: Error) => void;
        const result = new Promise<HarnessResult>((_resolve, rejected) => {
          reject = rejected;
        });
        void result.catch(() => undefined);
        return {
          sessionId: Promise.resolve(id),
          result,
          events: (async function* (): AsyncGenerator<HarnessEvent> {
            yield {
              type: 'error',
              code:
                boundary === 'cleanup' ? 'HARNESS_SESSION_MISSING' : 'HARNESS_NOT_AUTHENTICATED',
              message: 'Earlier refusal',
              retriable: true,
              submission: boundary === 'cleanup' ? 'session-missing' : 'definitely-not-submitted',
            };
            entered();
            if (boundary === 'cancel')
              await new Promise<void>((resolve) => {
                if (signal.aborted) resolve();
                else signal.addEventListener('abort', () => resolve(), { once: true });
              });
            reject(
              Object.assign(new Error('Later authoritative evidence'), {
                code: boundary === 'cleanup' ? 'HARNESS_SESSION_MISSING' : code,
                retriable: false,
              }),
            );
          })(),
          cancel: () =>
            boundary === 'cleanup'
              ? Promise.reject(Object.assign(new Error('Process still alive'), { code }))
              : Promise.resolve(),
        };
      },
    };
    const test = await createTestApp({ harnesses: { [family]: harness } });
    try {
      const loopId = await test.publishLoop(definition(family));
      const started = await test.app.inject({
        method: 'POST',
        url: `/loops/${loopId}/runs`,
        payload: {},
      });
      expect(started.statusCode).toBe(202);
      const runId = started.json<{ run: { id: string } }>().run.id;
      if (boundary === 'cancel') {
        await ready;
        await test.app.inject({ method: 'POST', url: `/runs/${runId}/cancel`, payload: {} });
      }
      await test.idle();
      const failed = (
        await test.app.inject({ method: 'GET', url: `/runs/${runId}` })
      ).json<RunRecord>();
      expect.soft(failed).toMatchObject({
        status: 'failed',
        failure: {
          code,
          resumable: false,
          inference: {
            promptKind: 'repair',
            submission: boundary === 'missing' ? 'session-missing' : 'delivery-uncertain',
          },
        },
      });
      expect(failed.failure?.details ?? {}).not.toHaveProperty('phase');
      expect(failed.failure?.message).not.toContain(
        'GraphGoblin received the provider result before this step failed.',
      );
      const history = (
        await test.app.inject({ method: 'GET', url: `/runs/${runId}/events` })
      ).json<{ items: RunEvent[] }>().items;
      expect
        .soft(history.filter((event) => event.type === 'harness.submission').at(-1)?.submission)
        .toBe(boundary === 'missing' ? 'session-missing' : 'delivery-uncertain');
      const resumed = await test.app.inject({
        method: 'POST',
        url: `/runs/${runId}/resume`,
        payload: { observedSeq: (await test.container.manager.getRecovery(runId)).observedSeq },
      });
      await test.idle();
      expect.soft(resumed.statusCode).toBe(409);
      expect.soft(calls).toBe(2);
    } finally {
      await test.close();
    }
  },
);

it.each(
  families.flatMap((family) =>
    (['primary', 'repair', 'output'] as const).flatMap((stage) =>
      [false, true].map((fails) => ({ family, stage, fails })),
    ),
  ),
)(
  '#486 HTTP $family $stage authored fails=$fails has row/event/REST parity and effect counts',
  async ({ family, stage, fails }) => {
    const fake = new FakeHarness(
      [{ finalText: stage === 'repair' ? 'invalid' : '42', accepted: false }, { finalText: '42' }],
      family,
    );
    const test = await createTestApp({ harnesses: { [family]: fake } });
    try {
      const loop = singleNodeLoop('Authored failure parity', {
        id: 'infer',
        kind: 'inference',
        label: 'Infer',
        config: {
          harness: family,
          model: family === 'claude' ? 'claude-opus-5-5' : 'gpt-6-luna',
          effort: 'low',
          harnessOptions: { sandbox: 'read-only', approval: 'never' },
          prompt: {
            template:
              stage === 'primary' && fails
                ? '{{ "private-template-486" | append }}'
                : 'Original task',
          },
          output:
            stage === 'repair'
              ? {
                  schema: {
                    jsonSchema: { type: 'number' },
                    repair: {
                      enabled: true,
                      maxAttempts: 1,
                      prompt: fails
                        ? '{{ "private-template-486" | append }}'
                        : 'Repair exactly: {{ value }}',
                    },
                  },
                }
              : stage === 'output'
                ? {
                    transforms: [
                      {
                        op: 'set',
                        path: '/vars/mapped',
                        value: {
                          kind: 'expression',
                          jsonata: fails ? '$error("private-transform-486")' : '42',
                        },
                      },
                    ],
                  }
                : {},
        },
      });
      const loopId = await test.publishLoop(loop);
      const start = await test.app.inject({
        method: 'POST',
        url: `/loops/${loopId}/runs`,
        payload: {},
      });
      expect(start.statusCode).toBe(202);
      const id = start.json<{ run: RunRecord }>().run.id;
      await test.idle();
      const snapshot = (await test.app.inject(`/runs/${id}`)).json<
        RunRecord & { recovery: RunRecovery }
      >();
      const row = await test.container.ports.runs.get(id);
      const events = (await test.app.inject(`/runs/${id}/events`)).json<{ items: RunEvent[] }>()
        .items;
      const turns = events.filter((event) => event.type === 'harness.turn');
      expect(snapshot.failure).toEqual(row?.failure);
      if (!fails) {
        expect(snapshot.status).toBe('succeeded');
        expect(turns).toHaveLength(stage === 'repair' ? 2 : 1);
        if (stage === 'output')
          expect((await test.container.manager.getThread(id))?.vars['mapped']).toBe(42);
        return;
      }
      const boundary =
        stage === 'primary'
          ? 'inference.prompt.template'
          : stage === 'repair'
            ? 'inference.output.schema.repair.prompt'
            : 'inference.output.transforms';
      const cause =
        stage === 'output'
          ? 'The expression could not evaluate this input. Check its input type and mapping.'
          : 'The template could not be rendered at line 1, column 1. Check its filters and input values.';
      const causeCode = stage === 'output' ? 'EXPRESSION_ERROR' : 'TEMPLATE_ERROR';
      const label =
        stage === 'primary'
          ? 'Inference prompt template'
          : stage === 'repair'
            ? 'Inference schema repair prompt, attempt 1'
            : 'Inference output transform 1 (set)';
      expect(snapshot.failure).toMatchObject({
        code: stage === 'output' ? 'MUTATION_ERROR' : 'TEMPLATE_ERROR',
        nodeId: 'infer',
        resumable: false,
        message: `${label} failed. ${cause}${stage === 'primary' ? '' : ' GraphGoblin received the provider result before this step failed.'}`,
        details: {
          boundary,
          cause: { code: causeCode, message: cause },
          ...(stage === 'repair'
            ? { attempt: 1, phase: 'after-result' }
            : stage === 'output'
              ? { operationIndex: 0, operationKind: 'set', phase: 'after-result' }
              : {}),
        },
      });
      expect(events.filter((event) => event.type === 'run.failed')).toMatchObject([
        { failure: snapshot.failure },
      ]);
      expect(turns).toHaveLength(stage === 'primary' ? 0 : 1);
      if (stage === 'primary') expect(snapshot.failure?.inference).toBeUndefined();
      else
        expect(snapshot.failure?.inference).toMatchObject({
          visitId: turns[0]!.visitId,
          turnId: turns[0]!.turnId,
          promptKind: 'authored',
          submission: 'delivery-uncertain',
        });
      expect(fake.started).toHaveLength(stage === 'primary' ? 0 : 1);
      expect(fake.resumed).toHaveLength(0);
      const before = JSON.stringify(events);
      const refusal = await test.app.inject({
        method: 'POST',
        url: `/runs/${id}/resume`,
        payload: { observedSeq: snapshot.recovery.observedSeq },
      });
      expect(refusal.statusCode).toBe(409);
      expect(refusal.json()).toMatchObject({ code: 'FAILURE_NOT_RESUMABLE' });
      await test.idle();
      expect(
        JSON.stringify(
          (await test.app.inject(`/runs/${id}/events`)).json<{ items: RunEvent[] }>().items,
        ),
      ).toBe(before);
      expect(fake.resumed).toHaveLength(0);
      expect(JSON.stringify(snapshot.failure)).not.toMatch(
        /private-transform-486|private-template-486/,
      );
    } finally {
      await test.close();
    }
  },
);

it.each(families)('retains the committed %s repair when its append then throws', async (family) => {
  const test = await createTestApp();
  const fake = new FakeHarness([{ finalText: 'invalid' }, { finalText: '42' }], family);
  test.container.ports.harnesses[family] = fake;
  const events = test.container.ports.events;
  let fired = false;
  test.container.ports.events = {
    async append(id, drafts, options) {
      const stored = await events.append(id, drafts, options);
      if (
        !fired &&
        drafts.some((draft) => draft.type === 'harness.turn' && draft.promptKind === 'repair')
      ) {
        fired = true;
        throw new Error('Repair append committed before failure');
      }
      return stored;
    },
    recoveryFacts: (...args) => events.recoveryFacts(...args),
    read: (...args) => events.read(...args),
    subscribe: (...args) => events.subscribe(...args),
  };
  try {
    const loopId = await test.publishLoop(definition(family));
    const started = await test.app.inject({
      method: 'POST',
      url: `/loops/${loopId}/runs`,
      payload: {},
    });
    expect(started.statusCode).toBe(202);
    const runId = started.json<{ run: { id: string } }>().run.id;
    await test.idle();
    const failed = (
      await test.app.inject({ method: 'GET', url: `/runs/${runId}` })
    ).json<RunRecord>();
    const history = (await test.app.inject({ method: 'GET', url: `/runs/${runId}/events` })).json<{
      items: RunEvent[];
    }>().items;
    const repair = history.filter((event) => event.type === 'harness.turn').at(-1)!;
    expect.soft(failed.failure).toMatchObject({
      code: 'INTERNAL_ERROR',
      resumable: true,
      inference: {
        promptKind: 'repair',
        submission: 'definitely-not-submitted',
        turnId: repair.turnId,
        visitId: repair.visitId,
      },
    });
    expect.soft(fake.cancelled).toHaveLength(0);
    expect(fake.resumed).toHaveLength(0);
    const resumed = await test.app.inject({
      method: 'POST',
      url: `/runs/${runId}/resume`,
      payload: { observedSeq: (await test.container.manager.getRecovery(runId)).observedSeq },
    });
    await test.idle();
    expect(resumed.statusCode).toBe(200);
    expect.soft(fake.resumed[0]?.request.turn.prompt).toBe(repair.prompt);
    expect.soft(fake.resumed[0]?.request.turn.prompt).toBe('Repair exactly: "invalid"');
    expect(
      (await test.app.inject({ method: 'GET', url: `/runs/${runId}` })).json<RunRecord>().status,
    ).toBe('succeeded');
  } finally {
    await test.close();
  }
});

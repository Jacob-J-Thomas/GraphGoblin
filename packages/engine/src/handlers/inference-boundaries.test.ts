import { expect, it } from 'vitest';
import type { HarnessId } from '@graphgoblin/contracts';
import type { HarnessEvent, HarnessResult, HarnessSession } from '../ports.js';
import { RunManager } from '../run-manager.js';
import { FakeHarness } from '../testing/fakes.js';
import { createTestEngine, singleNodeLoop } from '../testing/scenario.js';

const families = ['codex', 'claude'] as const;
const repairLoop = (family: HarnessId) =>
  singleNodeLoop('repair boundary', {
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
          repair: { enabled: true, maxAttempts: 1, prompt: 'Repair exactly: {{ value }}' },
        },
      },
    },
  });
async function engine() {
  const e = await createTestEngine();
  e.ports.modelCatalog.entries.push({
    harness: 'claude',
    model: 'claude-opus-5-5',
    source: 'harness',
    displayName: 'Opus',
    efforts: ['low'],
    defaultEffort: 'low',
    enabled: true,
  });
  return e;
}
const sequences = families.flatMap((family) =>
  (
    [
      'iterator',
      'result',
      'cancel',
      'cleanup',
      'missing-cleanup',
      'wrapper',
      'later-event',
    ] as const
  ).flatMap((boundary) =>
    (boundary === 'iterator' || boundary === 'result'
      ? ['HARNESS_SESSION_MISSING', 'HARNESS_TERMINATION_UNCONFIRMED']
      : [
          boundary === 'wrapper'
            ? 'GENERIC_WRAPPER'
            : boundary === 'later-event'
              ? 'HARNESS_DELIVERY_UNCERTAIN'
              : 'HARNESS_TERMINATION_UNCONFIRMED',
        ]
    ).map((code) => ({ family, boundary, code })),
  ),
);
it.each(sequences)(
  'preserves later $family $code at $boundary',
  async ({ family, boundary, code }) => {
    const e = await engine();
    const fake = new FakeHarness([{ finalText: 'invalid' }, { finalText: '42' }], family);
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let calls = 0;
    let cleanups = 0;
    e.ports.harnesses[family] = {
      id: family,
      preflight: () => fake.preflight(),
      start: (request, signal) => fake.start(request, signal),
      resume(id, request, signal): HarnessSession {
        calls += 1;
        if (calls > 1) return fake.resume(id, request, signal);
        let reject!: (error: Error) => void;
        const result = new Promise<HarnessResult>((_resolve, rejected) => {
          reject = rejected;
        });
        void result.catch(() => undefined);
        const priorCode =
          boundary === 'missing-cleanup' ? 'HARNESS_SESSION_MISSING' : 'HARNESS_NOT_AUTHENTICATED';
        return {
          sessionId: Promise.resolve(id),
          result,
          events: (async function* (): AsyncGenerator<HarnessEvent> {
            yield {
              type: 'error',
              code: priorCode,
              message: 'Earlier structured refusal',
              retriable: true,
              submission:
                priorCode === 'HARNESS_SESSION_MISSING'
                  ? 'session-missing'
                  : 'definitely-not-submitted',
            };
            if (boundary === 'later-event')
              yield {
                type: 'error',
                code: 'HARNESS_TURN_FAILED',
                message: 'Later structured delivery uncertainty',
                retriable: true,
                submission: 'delivery-uncertain',
              };
            entered();
            if (boundary === 'cancel')
              await new Promise<void>((resolve) => {
                if (signal.aborted) resolve();
                else signal.addEventListener('abort', () => resolve(), { once: true });
              });
            const error =
              boundary === 'wrapper' || boundary === 'later-event'
                ? new Error('Generic final wrapper')
                : Object.assign(new Error('Later authoritative evidence'), {
                    code:
                      boundary === 'cleanup' || boundary === 'missing-cleanup' ? priorCode : code,
                    retriable: false,
                  });
            reject(error);
            if (boundary === 'iterator') throw error;
          })(),
          cancel() {
            cleanups += 1;
            return boundary === 'cleanup' || boundary === 'missing-cleanup'
              ? Promise.reject(
                  Object.assign(new Error('Process still alive'), {
                    code: 'HARNESS_TERMINATION_UNCONFIRMED',
                  }),
                )
              : Promise.resolve();
          },
        };
      },
    };
    try {
      const v = e.publish(repairLoop(family));
      const started = await e.start(v.loopId);
      if (boundary === 'cancel') {
        await ready;
        await e.manager.cancel(started.id, { kind: 'user', id: 'owner' });
      }
      const run = await e.settle(started.id);
      const wrapper = boundary === 'wrapper';
      expect(run.status).toBe('failed');
      expect(run.failure).toMatchObject({
        code: wrapper ? 'HARNESS_NOT_AUTHENTICATED' : code,
        resumable: wrapper || boundary === 'later-event',
        inference: {
          submission: wrapper
            ? 'definitely-not-submitted'
            : code === 'HARNESS_SESSION_MISSING'
              ? 'session-missing'
              : 'delivery-uncertain',
          promptKind: 'repair',
        },
      });
      expect(
        e
          .events(run.id)
          .filter((event) => event.type === 'harness.submission')
          .at(-1)?.submission,
      ).toBe(run.failure?.inference?.submission);
      if (wrapper || boundary === 'later-event') {
        await e.manager.resume(run.id);
        expect((await e.settle(run.id)).status).toBe('succeeded');
        expect(fake.resumed.at(-1)?.request.turn.prompt).toBe(
          wrapper
            ? 'Repair exactly: "invalid"'
            : 'The previous turn was interrupted before GraphGoblin recorded its result. Continue the task from where you left off and finish it.',
        );
      } else {
        await expect(e.manager.resume(run.id)).rejects.toThrow();
        expect(calls).toBe(1);
      }
      if (code === 'HARNESS_TERMINATION_UNCONFIRMED')
        expect(cleanups).toBe(boundary === 'cleanup' || boundary === 'missing-cleanup' ? 1 : 0);
    } finally {
      e.manager.stop();
    }
  },
);

it.each(
  families.flatMap((family) => [false, true].map((afterCommit) => ({ family, afterCommit }))),
)(
  'retains $family repair intent across append refusal afterCommit=$afterCommit',
  async ({ family, afterCommit }) => {
    const e = await engine();
    e.manager.stop();
    const fake = new FakeHarness([{ finalText: 'invalid' }, { finalText: '42' }], family);
    e.ports.harnesses[family] = fake;
    let refused = false;
    const events = e.ports.events;
    const manager = new RunManager(
      {
        ...e.ports,
        events: {
          async append(id, drafts, options) {
            if (
              !refused &&
              drafts.some((draft) => draft.type === 'harness.turn' && draft.promptKind === 'repair')
            ) {
              refused = true;
              if (afterCommit) await events.append(id, drafts, options);
              throw new Error('Repair append refused');
            }
            return events.append(id, drafts, options);
          },
          read: (...args) => events.read(...args),
          subscribe: (...args) => events.subscribe(...args),
        },
      },
      e.settings,
    );
    await manager.start();
    try {
      const v = e.publish(repairLoop(family));
      const started = await manager.startRun({
        ownerId: 'local',
        loopId: v.loopId,
        source: 'manual.api',
      });
      await manager.waitForIdle();
      const run = (await e.ports.runs.get(started.id))!;
      expect(run.failure).toMatchObject({
        code: 'INTERNAL_ERROR',
        inference: { promptKind: 'repair', submission: 'definitely-not-submitted' },
        details: { name: 'Error', stack: expect.stringContaining('Repair append refused') },
      });
      const repair = e
        .events(run.id)
        .filter((event) => event.type === 'harness.turn')
        .at(-1)!;
      expect(repair.promptKind).toBe('repair');
      expect(run.failure?.inference?.turnId).toBe(repair.turnId);
      expect(fake.started).toHaveLength(1);
      expect(fake.resumed).toHaveLength(0);
      expect(fake.cancelled).toHaveLength(0);
      await manager.resume(run.id);
      await manager.waitForIdle();
      expect((await e.ports.runs.get(run.id))?.status).toBe('succeeded');
      expect(fake.resumed[0]?.request.turn.prompt).toBe('Repair exactly: "invalid"');
      expect(
        e
          .events(run.id)
          .filter((event) => event.type === 'harness.turn')
          .at(-1)?.turnId,
      ).toBe(repair.turnId);
    } finally {
      manager.stop();
    }
  },
);

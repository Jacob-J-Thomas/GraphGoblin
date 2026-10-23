import { expect, it } from 'vitest';
import { FakeHarness } from '../testing/fakes.js';
import { createTestEngine, singleNodeLoop } from '../testing/scenario.js';

const cases = (['codex', 'claude'] as const).flatMap((family) =>
  [false, true].flatMap((retriable) =>
    (['sync', 'async', 'result'] as const).map((mode) => ({ family, retriable, mode })),
  ),
);

it.each(['HARNESS_TURN_FAILED', 'HARNESS_TERMINATION_UNCONFIRMED'])(
  'does not downgrade synchronous %s delivery uncertainty to safe non-submission',
  async (code) => {
    const e = await createTestEngine();
    let calls = 0;
    e.ports.harnesses.codex = {
      id: 'codex',
      preflight: () => e.ports.harness.preflight(),
      start() {
        calls += 1;
        throw Object.assign(new Error('Transport failed before returning its handle'), {
          code,
          submission:
            code === 'HARNESS_TERMINATION_UNCONFIRMED'
              ? 'definitely-not-submitted'
              : 'delivery-uncertain',
          retriable: false,
        });
      },
      resume() {
        throw new Error('Must not resume without a usable session');
      },
    };
    const version = e.publish(
      singleNodeLoop('uncertain launch', {
        id: 'infer',
        kind: 'inference',
        label: 'Infer',
        config: { prompt: { template: 'Original task' } },
      }),
    );
    try {
      const run = await e.runToIdle(version.loopId);
      expect(run.failure).toMatchObject({
        code: code === 'HARNESS_TURN_FAILED' ? 'HARNESS_DELIVERY_UNCERTAIN' : code,
        resumable: false,
        inference: { submission: 'delivery-uncertain' },
      });
      await expect(e.manager.resume(run.id)).rejects.toThrow();
      expect(calls).toBe(1);
    } finally {
      e.manager.stop();
    }
  },
);

it.each(cases)(
  'preserves $mode $family missing-session repair refusal with retriable=$retriable',
  async ({ family, retriable, mode }) => {
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
    const fake = new FakeHarness([{ finalText: 'invalid' }], family);
    const calls: string[] = [];
    e.ports.harnesses[family] = {
      id: family,
      preflight: () => fake.preflight(),
      start: (request, signal) => fake.start(request, signal),
      resume(id, request, signal) {
        calls.push(id);
        const error = {
          code: 'HARNESS_SESSION_MISSING',
          message: 'Recorded conversation no longer exists',
          retriable,
        };
        if (mode === 'sync') throw Object.assign(new Error(error.message), error);
        fake.script([{ error, submission: 'session-missing', announceSession: false }]);
        const session = fake.resume(id, request, signal);
        if (mode === 'result')
          return {
            ...session,
            // A rejected result can carry its cause even when the error event was lost.
            events: (async function* () {
              for await (const event of session.events) if (event.type !== 'error') yield event;
            })(),
          };
        return session;
      },
    };
    const version = e.publish(
      singleNodeLoop('missing-session repair', {
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
      }),
    );
    try {
      const run = await e.runToIdle(version.loopId);
      expect(run.status).toBe('failed');
      expect(run.failure).toMatchObject({
        code: 'HARNESS_SESSION_MISSING',
        resumable: false,
        details: { adapterCode: 'HARNESS_SESSION_MISSING' },
        inference: { submission: 'session-missing', promptKind: 'repair' },
      });
      const turn = e
        .events(run.id)
        .filter((event) => event.type === 'harness.turn')
        .at(-1)!;
      expect(turn.prompt).toBe('Repair exactly: "invalid"');
      expect(
        e
          .events(run.id)
          .filter((event) => event.type === 'harness.submission')
          .at(-1),
      ).toMatchObject({
        turnId: turn.turnId,
        visitId: turn.visitId,
        submission: 'session-missing',
      });
      await expect(e.manager.resume(run.id)).rejects.toThrow();
      expect(calls).toEqual([turn.resumeSessionId]);
      expect(fake.cancelled).toHaveLength(mode === 'sync' ? 0 : 1);
    } finally {
      e.manager.stop();
    }
  },
);

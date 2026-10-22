import { describe, expect, it } from 'vitest';
import { CodexHarness } from '@graphgoblin/adapter-codex';
import type { RunEvent, RunRecord } from '@graphgoblin/contracts';
import type { HarnessPort } from '@graphgoblin/engine';
import { FakeHarness, singleNodeLoop } from '@graphgoblin/engine/testing';
import { createTestApp } from './testing/test-app.js';

describe('inference recovery contract over the API', () => {
  it.each(
    (['codex', 'claude'] as const).flatMap((family) =>
      [false, true].map((retriable) => ({ family, retriable })),
    ),
  )(
    'blocks synchronous $family missing-session repair refusal with retriable=$retriable',
    async ({ family, retriable }) => {
      let calls = 0;
      const fake = new FakeHarness([{ finalText: 'invalid' }], family);
      const refusal = () => {
        throw Object.assign(new Error('Recorded conversation no longer exists'), {
          code: 'HARNESS_SESSION_MISSING',
          retriable,
        });
      };
      const codex = new CodexHarness({
        clientFactory: () => ({
          startThread: () => ({
            runStreamed: () =>
              Promise.resolve({
                events: (async function* () {
                  yield await Promise.resolve({
                    type: 'thread.started',
                    thread_id: 'repair-thread',
                  });
                  yield { type: 'turn.started' };
                  yield {
                    type: 'item.completed',
                    item: { id: 'answer', type: 'agent_message', text: 'invalid' },
                  };
                  yield { type: 'turn.completed', usage: {} };
                })(),
              }),
          }),
          // Exercise the SDK boundary used by the auditor, before a session is returned.
          resumeThread: refusal,
        }),
      });
      const harness: HarnessPort = {
        id: family,
        preflight: () => fake.preflight(),
        start(request, signal) {
          calls += 1;
          return family === 'codex' ? codex.start(request, signal) : fake.start(request, signal);
        },
        resume(id, request, signal) {
          calls += 1;
          // Claude's public harness port is the auditor's synchronous fault seam.
          return family === 'codex' ? codex.resume(id, request, signal) : refusal();
        },
      };
      const test = await createTestApp({ harnesses: { [family]: harness } });
      try {
        const loopId = await test.publishLoop(
          singleNodeLoop('missing-session boundary', {
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
        const response = await test.app.inject({
          method: 'POST',
          url: `/loops/${loopId}/runs`,
          payload: {},
        });
        expect(response.statusCode).toBe(202);
        const runId = response.json<{ run: { id: string } }>().run.id;
        await test.idle();
        const failed = await test.app.inject({ method: 'GET', url: `/runs/${runId}` });
        expect.soft(failed.json<RunRecord>().failure).toMatchObject({
          code: 'HARNESS_SESSION_MISSING',
          resumable: false,
          details: { adapterCode: 'HARNESS_SESSION_MISSING' },
          inference: { submission: 'session-missing', promptKind: 'repair' },
        });
        const history = await test.app.inject({ method: 'GET', url: `/runs/${runId}/events` });
        const events = history.json<{ items: RunEvent[] }>().items;
        const repair = events.filter((event) => event.type === 'harness.turn').at(-1)!;
        expect(repair.prompt).toBe('Repair exactly: "invalid"');
        expect
          .soft(events.filter((event) => event.type === 'harness.submission').at(-1))
          .toMatchObject({
            submission: 'session-missing',
            visitId: repair.visitId,
            turnId: repair.turnId,
          });
        expect(calls).toBe(2);
        const resumed = await test.app.inject({
          method: 'POST',
          url: `/runs/${runId}/resume`,
          payload: {},
        });
        await test.idle();
        expect.soft(resumed.statusCode).toBe(409);
        expect.soft(calls).toBe(2);
      } finally {
        await test.close();
      }
    },
  );
  it.each(['definitely-not-submitted', 'delivery-uncertain', 'session-missing'] as const)(
    'exposes %s and enforces its resume policy',
    async (submission) => {
      const test = await createTestApp();
      try {
        const loopId = await test.publishLoop(
          singleNodeLoop('submission API', {
            id: 'infer',
            kind: 'inference',
            label: 'Infer',
            config: { prompt: { template: 'authored task' } },
          }),
        );
        test.harness.script([
          {
            submission,
            announceSession: submission !== 'delivery-uncertain',
            error: {
              code:
                submission === 'session-missing'
                  ? 'HARNESS_SESSION_MISSING'
                  : 'HARNESS_TURN_FAILED',
              message: 'fixture',
              retriable: false,
            },
          },
        ]);
        const response = await test.app.inject({
          method: 'POST',
          url: `/loops/${loopId}/runs`,
          payload: {},
        });
        const runId = response.json<{ run: { id: string } }>().run.id;
        await test.idle();
        const failed = await test.app.inject({ method: 'GET', url: `/runs/${runId}` });
        expect(failed.json()).toMatchObject({
          failure: {
            inference: { submission, promptKind: 'authored' },
            resumable: submission === 'definitely-not-submitted',
          },
        });
        const resumed = await test.app.inject({
          method: 'POST',
          url: `/runs/${runId}/resume`,
          payload: {},
        });
        expect(resumed.statusCode).toBe(submission === 'definitely-not-submitted' ? 200 : 409);
        await test.idle();
        if (submission === 'definitely-not-submitted')
          expect(test.harness.started[1]!.turn.prompt).toBe('authored task');
      } finally {
        await test.close();
      }
    },
  );
});

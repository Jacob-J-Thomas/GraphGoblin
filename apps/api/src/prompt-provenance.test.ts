import { describe, expect, it, vi } from 'vitest';
import * as domain from '@graphgoblin/domain';
import { CodexHarness } from '@graphgoblin/adapter-codex';
import type { RunEvent, RunRecord } from '@graphgoblin/contracts';
import type { HarnessPort } from '@graphgoblin/engine';
import { FakeHarness, singleNodeLoop } from '@graphgoblin/engine/testing';
import { createTestApp } from './testing/test-app.js';

it('#486 an output failure after a result without a session keeps the real turn and refuses Resume', async () => {
  const fake = new FakeHarness([
    { finalText: 'received', announceSession: false, accepted: false },
  ]);
  const test = await createTestApp({ harnesses: { codex: fake } });
  try {
    const loopId = await test.publishLoop(
      singleNodeLoop('No-session result', {
        id: 'infer',
        kind: 'inference',
        label: 'Infer',
        config: {
          prompt: { template: 'go' },
          output: {
            transforms: [
              {
                op: 'set',
                path: '/vars/value',
                value: { kind: 'expression', jsonata: '$error("private-no-session-486")' },
              },
            ],
          },
        },
      }),
    );
    const start = await test.app.inject({
      method: 'POST',
      url: `/loops/${loopId}/runs`,
      payload: {},
    });
    expect(start.statusCode).toBe(202);
    const id = start.json<{ run: RunRecord }>().run.id;
    await test.idle();
    const snapshot = (await test.app.inject(`/runs/${id}`)).json<RunRecord>();
    const events = (await test.app.inject(`/runs/${id}/events`)).json<{ items: RunEvent[] }>()
      .items;
    const turns = events.filter((event) => event.type === 'harness.turn');
    expect(turns).toHaveLength(1);
    expect(snapshot.failure).toMatchObject({
      code: 'MUTATION_ERROR',
      nodeId: 'infer',
      resumable: false,
      details: { boundary: 'inference.output.transforms', phase: 'after-result' },
    });
    expect(snapshot.failure?.inference).toEqual({
      turnId: turns[0]!.turnId,
      visitId: turns[0]!.visitId,
      promptKind: 'authored',
      submission: 'delivery-uncertain',
    });
    expect(snapshot.failure?.message).toContain(
      'GraphGoblin received the provider result before this step failed.',
    );
    expect(snapshot.failure?.message).not.toContain('no usable session');
    expect((await test.container.ports.runs.get(id))?.failure).toEqual(snapshot.failure);
    expect(events.filter((event) => event.type === 'run.failed')).toMatchObject([
      { failure: snapshot.failure },
    ]);
    const before = JSON.stringify(events);
    const refusal = await test.app.inject({
      method: 'POST',
      url: `/runs/${id}/resume`,
      payload: { observedSeq: (await test.container.manager.getRecovery(id)).observedSeq },
    });
    expect(refusal.statusCode).toBe(409);
    expect(refusal.json()).toMatchObject({ code: 'FAILURE_NOT_RESUMABLE' });
    expect(JSON.stringify(await test.container.ports.events.read(id))).toBe(before);
    expect(fake.started).toHaveLength(1);
    expect(fake.resumed).toHaveLength(0);
  } finally {
    await test.close();
  }
});

it('#486 a synthetic canonical rerender fault is safe, engine-owned and resumable over HTTP', async () => {
  const fake = new FakeHarness();
  const render = vi.spyOn(domain, 'renderTemplate');
  const harness: HarnessPort = {
    id: 'codex',
    preflight: () => fake.preflight(),
    start: (request, signal) => fake.start(request, signal),
    resume: (id, request, signal) => fake.resume(id, request, signal),
    contextWindow: () => {
      render.mockRejectedValueOnce(new domain.TemplateError('private canonical rerender marker'));
      return Promise.resolve({
        contextTokens: 4096,
        outputReserveTokens: 1024,
        profile: 'test/bytes',
        fits: (prompt: string) => Buffer.byteLength(prompt) <= 400,
      });
    },
  };
  const test = await createTestApp({ harnesses: { codex: harness } });
  try {
    const loopId = await test.publishLoop(
      domain.createSystemChatDefinition({ name: 'Canonical rerender', harness: 'codex' }),
    );
    const started = await test.app.inject({
      method: 'POST',
      url: `/loops/${loopId}/runs`,
      payload: {
        input: {
          protocol: 'graphgoblin.chat.v1',
          conversationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
          requestId: '33d911ae-7293-4acb-ab74-910e67293f1d',
          turn: 2,
          history: [
            { role: 'user', text: 'old question ' + 'x'.repeat(80) },
            { role: 'assistant', text: 'old answer ' + 'x'.repeat(80) },
          ],
          input: { kind: 'text', text: 'Required current question' },
        },
      },
    });
    expect(started.statusCode).toBe(202);
    const id = started.json<{ run: RunRecord }>().run.id;
    await test.idle();
    const run = (await test.app.inject(`/runs/${id}`)).json<RunRecord>();
    expect(render).toHaveBeenCalled();
    expect(run.failure).toEqual({
      code: 'INTERNAL_ERROR',
      nodeId: 'respond',
      resumable: true,
      message: 'An unexpected error interrupted the run. See the server logs for this run.',
    });
    expect((await test.container.ports.runs.get(id))?.failure).toEqual(run.failure);
    const events = (await test.app.inject(`/runs/${id}/events`)).json<{ items: RunEvent[] }>()
      .items;
    expect(events.filter((event) => event.type === 'run.failed')).toMatchObject([
      { failure: run.failure },
    ]);
    expect(events.filter((event) => event.type === 'harness.turn')).toHaveLength(0);
    expect(fake.started).toHaveLength(0);
    expect(JSON.stringify(run.failure)).not.toContain('private canonical rerender marker');
  } finally {
    render.mockRestore();
    await test.close();
  }
});

describe('inference recovery contract over the API', () => {
  it.each(
    (['codex', 'claude'] as const).flatMap((family) =>
      [false, true].flatMap((retriable) =>
        (family === 'codex' ? ['sync', 'promise', 'iterator'] : ['sync']).map((boundary) => ({
          family,
          retriable,
          boundary,
        })),
      ),
    ),
  )(
    'blocks $boundary $family missing-session repair refusal with retriable=$retriable',
    async ({ family, retriable, boundary }) => {
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
          resumeThread: () => {
            if (boundary === 'sync') return refusal();
            const error = Object.assign(new Error('Recorded conversation no longer exists'), {
              code: 'HARNESS_SESSION_MISSING',
              retriable,
            });
            return {
              runStreamed: () =>
                boundary === 'promise'
                  ? Promise.reject(error)
                  : Promise.resolve({
                      events: (async function* () {
                        yield await Promise.reject(error);
                      })(),
                    }),
            };
          },
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
        expect(failed.json<RunRecord>().failure?.details ?? {}).not.toHaveProperty('phase');
        expect(failed.json<RunRecord>().failure?.message).not.toContain(
          'GraphGoblin received the provider result before this step failed.',
        );
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
          payload: { observedSeq: (await test.container.manager.getRecovery(runId)).observedSeq },
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

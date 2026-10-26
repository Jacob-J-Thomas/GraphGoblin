import { expect, it } from 'vitest';
import type { RunRecord } from '@graphgoblin/contracts';
import {
  expectedFailure,
  failureCases,
  failureHarness,
  failureLoop,
  recordingModes,
  FakeHarness,
} from '@graphgoblin/engine/testing';
import { createTestApp } from './testing/test-app.js';

// The exhaustive port-source product is in the engine; exercise HTTP eligibility and retry
// provenance here with real SQLite for every evidence class and recording outcome.
const matrix = (['codex', 'claude'] as const).flatMap((family) =>
  failureCases.flatMap((spec) =>
    [false, true].flatMap((retriable) =>
      recordingModes.map((storage) => ({ family, spec, retriable, storage })),
    ),
  ),
);
it.each(matrix)(
  'keeps HTTP $family $spec.code retry=$retriable storage=$storage',
  async ({ family, spec, retriable, storage }) => {
    const h = failureHarness(family, spec, 'result', retriable);
    const test = await createTestApp({ harnesses: { [family]: h.port } });
    const events = test.container.ports.events;
    let fired = false;
    test.container.ports.events = {
      async append(id, drafts, options) {
        if (
          storage !== 'ok' &&
          !fired &&
          h.calls.length === 2 &&
          drafts.some(
            (draft) => draft.type === 'harness.submission' && draft.submission === spec.state,
          )
        ) {
          fired = true;
          if (storage === 'after') await events.append(id, drafts, options);
          throw new Error('HTTP classification recording fault ' + storage);
        }
        return events.append(id, drafts, options);
      },
      read: (...args) => events.read(...args),
      subscribe: (...args) => events.subscribe(...args),
    };
    try {
      const loopId = await test.publishLoop(failureLoop(family));
      const started = await test.app.inject({
        method: 'POST',
        url: `/loops/${loopId}/runs`,
        payload: {},
      });
      expect(started.statusCode).toBe(202);
      const id = started.json<{ run: { id: string } }>().run.id;
      await test.idle();
      const run = (await test.app.inject({ method: 'GET', url: `/runs/${id}` })).json<RunRecord>();
      const expected = expectedFailure(spec, 'result', family, retriable);
      if (storage !== 'ok') expect(fired).toBe(true);
      expect.soft(run.failure).toMatchObject({
        code: expected.code,
        resumable: expected.resumable,
        inference: { promptKind: 'repair', submission: spec.state },
      });
      if (fired) expect.soft(run.failure?.details).toMatchObject({ recording: expect.any(Array) });
      const resumed = await test.app.inject({
        method: 'POST',
        url: `/runs/${id}/resume`,
        payload: {},
      });
      await test.idle();
      expect.soft(resumed.statusCode).toBe(expected.resumable ? 200 : 409);
      expect.soft(h.calls.length).toBe(expected.resumable ? 3 : 2);
      if (expected.resumable)
        expect(h.calls.at(-1)).toBe(
          spec.state === 'definitely-not-submitted'
            ? 'Repair exactly: "invalid"'
            : 'The previous turn was interrupted before GraphGoblin recorded its result. Continue the task from where you left off and finish it.',
        );
    } finally {
      await test.close();
    }
  },
);

it.each(
  (['codex', 'claude'] as const).flatMap((family) =>
    [false, true].map((afterCommit) => ({ family, afterCommit })),
  ),
)(
  'retries exact HTTP $family repair after append/read faults afterCommit=$afterCommit',
  async ({ family, afterCommit }) => {
    const fake = new FakeHarness([{ finalText: 'invalid' }, { finalText: '42' }], family);
    const test = await createTestApp({ harnesses: { [family]: fake } });
    const events = test.container.ports.events;
    let fired = false;
    let readFailed = false;
    test.container.ports.events = {
      async append(id, drafts, options) {
        if (!fired && drafts.some((d) => d.type === 'harness.turn' && d.promptKind === 'repair')) {
          fired = true;
          if (afterCommit) await events.append(id, drafts, options);
          throw new Error('Repair intent append failed');
        }
        return events.append(id, drafts, options);
      },
      read(...args) {
        if (fired && !readFailed) {
          readFailed = true;
          throw new Error('Reconciliation read failed');
        }
        return events.read(...args);
      },
      subscribe: (...args) => events.subscribe(...args),
    };
    try {
      const loopId = await test.publishLoop(failureLoop(family));
      const started = await test.app.inject({
        method: 'POST',
        url: `/loops/${loopId}/runs`,
        payload: {},
      });
      expect(started.statusCode).toBe(202);
      const id = started.json<{ run: { id: string } }>().run.id;
      await test.idle();
      const run = (await test.app.inject({ method: 'GET', url: `/runs/${id}` })).json<RunRecord>();
      expect(run.failure).toMatchObject({
        inference: { promptKind: 'repair', submission: 'definitely-not-submitted' },
        details: { recording: expect.any(Array) },
      });
      expect(
        (await test.app.inject({ method: 'POST', url: `/runs/${id}/resume`, payload: {} }))
          .statusCode,
      ).toBe(200);
      await test.idle();
      expect(fake.resumed[0]?.request.turn.prompt).toBe('Repair exactly: "invalid"');
      expect(fake.cancelled).toHaveLength(0);
    } finally {
      await test.close();
    }
  },
);

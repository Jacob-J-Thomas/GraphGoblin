import { describe, expect, it } from 'vitest';
import { singleNodeLoop } from '@graphgoblin/engine/testing';
import { createTestApp } from './testing/test-app.js';

describe('inference recovery contract over the API', () => {
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

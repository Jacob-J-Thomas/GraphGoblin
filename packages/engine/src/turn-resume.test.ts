import { expect, it } from 'vitest';
import { FakeHarness, createTestEngine, singleNodeLoop } from './testing/index.js';

const continuation =
  'The previous turn was interrupted before GraphGoblin recorded its result. Continue the task from where you left off and finish it.';

it.each(['codex', 'claude'] as const)(
  'uses the %s generic failure rule after an accepted fresh turn loses its stream',
  async (family) => {
    const e = await createTestEngine();
    try {
      if (family === 'claude')
        e.ports.modelCatalog.entries.push({
          harness: 'claude',
          model: 'claude-opus-5-5',
          source: 'harness',
          displayName: 'Opus',
          efforts: ['low'],
          defaultEffort: 'low',
          enabled: true,
        });
      const harness = new FakeHarness(
        [
          {
            accepted: true,
            error: {
              code: 'HARNESS_TURN_FAILED',
              message: 'the Codex event stream ended before the turn completed',
              retriable: false,
            },
          },
        ],
        family,
      );
      e.ports.harnesses[family] = harness;
      const version = e.publish(
        singleNodeLoop('lost stream-' + family, {
          id: 'infer',
          kind: 'inference',
          label: 'Infer',
          config: {
            harness: family,
            model: family === 'codex' ? 'gpt-6-luna' : 'claude-opus-5-5',
            effort: 'low',
            harnessOptions: { sandbox: 'read-only', approval: 'never' },
            session: { policy: 'fresh' },
            prompt: { template: 'Task A' },
          },
        }),
      );
      const run = await e.runToIdle(version.loopId);
      expect(run.failure).toMatchObject({
        code: 'HARNESS_DELIVERY_UNCERTAIN',
        resumable: family === 'codex',
        inference: { submission: 'delivery-uncertain', promptKind: 'authored' },
      });
      if (family === 'claude') {
        await expect(e.manager.resume(run.id)).rejects.toThrow();
        expect(harness.resumed).toHaveLength(0);
        return;
      }
      expect(e.events(run.id)).toContainEqual(
        expect.objectContaining({ type: 'harness.submission', submission: 'submitted' }),
      );
      await e.manager.resume(run.id);
      expect((await e.settle(run.id)).status).toBe('succeeded');
      expect(harness.started).toHaveLength(1);
      expect(harness.resumed).toHaveLength(1);
      expect(harness.resumed[0]).toMatchObject({
        sessionId: run.failure?.inference?.sessionId,
        request: { turn: { prompt: continuation } },
      });
      const turns = e.events(run.id).filter((event) => event.type === 'harness.turn');
      expect(turns[1]).toMatchObject({ visitId: turns[0]?.visitId, promptKind: 'continuation' });
    } finally {
      e.manager.stop();
    }
  },
);

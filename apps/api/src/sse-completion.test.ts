import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { LoopDefinitionInput, RunEvent, RunRecord } from '@graphgoblin/contracts';
import { FIXTURE_IDS } from '@graphgoblin/contracts/testing';
import { FakeClock, InMemoryEventStore } from '@graphgoblin/engine/testing';
import { streamRunEvents } from './sse.js';
import { createTestApp } from './testing/test-app.js';

const frames = (body: string) => body.split('\n\n').filter((frame) => frame.includes('data: '));
const ids = (body: string) => [...body.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
const completion = (body: string, after: number) => {
  const controls = frames(body).filter((frame) => frame.includes('event: stream.complete\n'));
  expect(controls).toEqual([`event: stream.complete\ndata: ${JSON.stringify({ after })}`]);
  expect(body).not.toContain('stream.error');
};
const waitLoop: LoopDefinitionInput = {
  schemaVersion: 4,
  name: 'completion',
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    { id: 'wait', kind: 'wait', label: 'Wait', config: { mode: 'input', prompt: 'Go?' } },
    { id: 'done', kind: 'exit', label: 'Done', config: {} },
  ],
  edges: [
    { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'wait' } },
    { id: 'b', from: { node: 'wait', port: 'out' }, to: { node: 'done' } },
  ],
};

describe('authoritative SSE completion', () => {
  it('replays a real failed, resumed and succeeded run through its current outcome', async () => {
    const t = await createTestApp();
    try {
      t.harness.script([
        {
          error: { code: 'HARNESS_TURN_FAILED', message: 'retry', retriable: false },
          accepted: true,
        },
        { finalText: 'recovered' },
      ]);
      const loopId = await t.publishLoop({
        ...waitLoop,
        nodes: waitLoop.nodes.map((node) =>
          node.id === 'wait'
            ? {
                id: 'wait',
                kind: 'inference' as const,
                label: 'Infer',
                config: { prompt: { template: 'go' } },
              }
            : node,
        ),
      });
      const run = (
        await t.app.inject({ method: 'POST', url: `/loops/${loopId}/runs`, payload: {} })
      ).json<{ run: RunRecord }>().run;
      await t.idle();
      expect((await t.container.manager.getRun(run.id))?.status).toBe('failed');
      expect(
        (await t.app.inject({ method: 'POST', url: `/runs/${run.id}/resume`, payload: {} }))
          .statusCode,
      ).toBe(200);
      await t.idle();
      expect((await t.container.manager.getRun(run.id))?.status).toBe('succeeded');
      const log = await t.container.repos.events.read(run.id);
      expect(log.some((event) => event.type === 'run.resumed')).toBe(true);
      const response = await t.app.inject({
        url: `/runs/${run.id}/events`,
        headers: { accept: 'text/event-stream' },
      });
      expect(ids(response.body)).toEqual(log.map((event) => event.seq));
      completion(response.body, log.at(-1)!.seq);
    } finally {
      await t.close();
    }
  });

  it.each([0, 128, 131, 132, 232])(
    'delivers the durable suffix and completes after cursor %s',
    async (after) => {
      const t = await createTestApp();
      try {
        const loopId = await t.publishLoop(waitLoop);
        const run = (
          await t.app.inject({ method: 'POST', url: `/loops/${loopId}/runs`, payload: {} })
        ).json<{ run: RunRecord }>().run;
        await t.idle();
        const store = t.container.repos.events;
        const count = (await store.read(run.id)).length;
        await store.append(run.id, [
          ...Array.from({ length: 127 - count }, () => ({
            type: 'run.woken' as const,
            nodeId: 'wait',
            reason: 'manual' as const,
          })),
          {
            type: 'run.failed',
            failure: { code: 'HARNESS_TURN_FAILED', message: 'retry', resumable: true },
          },
          { type: 'run.resumed', actor: { kind: 'user', id: 'local' } },
          { type: 'run.woken', nodeId: 'wait', reason: 'manual' },
          { type: 'run.finished', status: 'succeeded', outcome: 'success', result: 'done' },
          { type: 'return.delivered', channel: { kind: 'caller' }, target: 'run.result' },
        ]);
        await t.container.handle.client.execute({
          sql: 'UPDATE runs SET status = ? WHERE id = ?',
          args: ['succeeded', run.id],
        });
        const log = await store.read(run.id);
        const response = await t.app.inject({
          url: `/runs/${run.id}/events?after=${after}`,
          headers: { accept: 'text/event-stream' },
        });
        expect(ids(response.body)).toEqual(
          log.filter((event) => event.seq > after).map((event) => event.seq),
        );
        completion(response.body, Math.max(after, 132));
      } finally {
        await t.close();
      }
    },
  );

  const latestLifecycle = async (store: InMemoryEventStore, runId: string) =>
    (await store.read(runId)).findLast((event) =>
      ['run.cancelled', 'run.failed', 'run.finished', 'run.resumed', 'run.started'].includes(
        event.type,
      ),
    );

  it('completes a cursor past the durable tail when a later outcome lands at or below it', async () => {
    const store = new InMemoryEventStore(new FakeClock());
    const runId = FIXTURE_IDS.run;
    await store.append(runId, [
      { type: 'run.cancelled' },
      { type: 'run.resumed', actor: { kind: 'user', id: 'local' } },
    ]);
    let scheduled = false;
    const app = Fastify();
    app.get('/', (request, reply) =>
      streamRunEvents(request, reply, store, runId, 106, {
        isTerminal: () => Promise.resolve(false),
        lastLifecycleEvent: async () => {
          const marker = await latestLifecycle(store, runId);
          if (!scheduled) {
            scheduled = true;
            // The active run is cancelled after the stream opened; its seq is below the cursor.
            setTimeout(() => void store.append(runId, [{ type: 'run.cancelled' }]), 50);
          }
          return marker;
        },
        closeSignal: AbortSignal.timeout(3_000),
      }),
    );
    try {
      const response = await app.inject('/');
      expect(ids(response.body)).toEqual([]);
      completion(response.body, 106);
    } finally {
      await app.close();
    }
  });

  it('does not complete a cursor past the tail when a resume races the confirmation', async () => {
    const store = new InMemoryEventStore(new FakeClock());
    const runId = FIXTURE_IDS.run;
    await store.append(runId, [
      {
        type: 'run.failed',
        failure: { code: 'HARNESS_TURN_FAILED', message: 'retry', resumable: true },
      },
    ]);
    let raced = false;
    const app = Fastify();
    app.get('/', (request, reply) =>
      streamRunEvents(request, reply, store, runId, 112, {
        // Status lags, so the first lookup is the post-catch-up confirmation itself.
        isTerminal: () => Promise.resolve(false),
        lastLifecycleEvent: async () => {
          const marker = await latestLifecycle(store, runId);
          if (!raced) {
            raced = true;
            await store.append(runId, [
              { type: 'run.resumed', actor: { kind: 'user', id: 'local' } },
            ]);
          }
          return marker;
        },
        // The run stays active, so the stream must still be open when this ends it.
        closeSignal: AbortSignal.timeout(1_500),
      }),
    );
    try {
      const response = await app.inject('/');
      expect(response.body).not.toContain('stream.complete');
    } finally {
      await app.close();
    }
  });

  it.each(['empty replay', 'audit suffix'] as const)(
    'confirms a consumed outcome while the run status still lags (%s)',
    async (shape) => {
      const store = new InMemoryEventStore(new FakeClock());
      const runId = FIXTURE_IDS.run;
      await store.append(
        runId,
        shape === 'empty replay'
          ? [{ type: 'run.cancelled' }]
          : [
              { type: 'run.cancelled' },
              { type: 'return.delivered', channel: { kind: 'caller' }, target: 'run.result' },
            ],
      );
      const app = Fastify();
      app.get('/', (request, reply) =>
        streamRunEvents(request, reply, store, runId, 1, {
          // The outcome is durable, but the status write has not landed yet.
          isTerminal: () => Promise.resolve(false),
          lastLifecycleEvent: async () =>
            (await store.read(runId)).find((event) => event.type === 'run.cancelled'),
          // Ends an unconfirmed stream so a regression fails instead of hanging.
          closeSignal: AbortSignal.timeout(3_000),
        }),
      );
      try {
        const response = await app.inject('/');
        const log: RunEvent[] = await store.read(runId);
        expect(ids(response.body)).toEqual(
          log.filter((event) => event.seq > 1).map((event) => event.seq),
        );
        completion(response.body, log.at(-1)!.seq);
      } finally {
        await app.close();
      }
    },
  );

  it.each(['audit', 'resume'] as const)(
    'checks the durable tail after a lifecycle lookup racing a %s',
    async (kind) => {
      const store = new InMemoryEventStore(new FakeClock());
      const runId = FIXTURE_IDS.run;
      await store.append(runId, [{ type: 'run.cancelled' }]);
      let appended = false;
      const app = Fastify();
      app.get('/', (request, reply) =>
        streamRunEvents(request, reply, store, runId, 0, {
          lastLifecycleEvent: async () => {
            const log = await store.read(runId);
            const marker = log.findLast((event) =>
              ['run.cancelled', 'run.finished', 'run.resumed'].includes(event.type),
            );
            if (!appended) {
              appended = true;
              await store.append(
                runId,
                kind === 'audit'
                  ? [
                      {
                        type: 'return.delivered',
                        channel: { kind: 'caller' },
                        target: 'run.result',
                      },
                    ]
                  : [
                      { type: 'run.resumed', actor: { kind: 'user', id: 'local' } },
                      { type: 'run.cancelled' },
                    ],
              );
            }
            return marker;
          },
        }),
      );
      try {
        const response = await app.inject('/');
        const log: RunEvent[] = await store.read(runId);
        expect(ids(response.body)).toEqual(log.map((event) => event.seq));
        completion(response.body, log.at(-1)!.seq);
      } finally {
        await app.close();
      }
    },
  );
});

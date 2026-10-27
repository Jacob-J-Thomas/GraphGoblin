import Fastify from 'fastify';
import { createServer, get } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EventStorePort } from '@graphgoblin/engine';
import { FakeClock, InMemoryEventStore } from '@graphgoblin/engine/testing';
import { FIXTURE_IDS } from '@graphgoblin/contracts/testing';
import { RunEventSchema } from '@graphgoblin/contracts';
import { streamRunEvents } from './sse.js';
import { createTestApp } from './testing/test-app.js';

const runId = FIXTURE_IDS.run;
const draft = { type: 'run.woken', nodeId: 'wait', reason: 'manual' } as const;
const ids = (text: string) => [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));

describe('durable SSE catch-up', () => {
  it.each(['memory', 'sqlite'] as const)(
    'keeps a fast real-socket %s reader complete while every replay page appends more events',
    async (kind) => {
      const dataDir = await mkdtemp(join(tmpdir(), 'gg-wp-e1-186-'));
      const t =
        kind === 'sqlite'
          ? await createTestApp({
              env: {
                GG_DATA_DIR: dataDir,
                GG_DB_URL: `file:${join(dataDir, 'events.db')}`,
              },
            })
          : undefined;
      const events = t?.container.repos.events ?? new InMemoryEventStore(new FakeClock());
      for (let i = 0; i < 150; i++)
        await events.append(
          runId,
          Array.from({ length: 128 }, () => draft),
        );
      let appended = 0;
      let finished = false;
      const store: EventStorePort = {
        append: (...args) => events.append(...args),
        subscribe: (...args) => events.subscribe(...args),
        recoveryFacts: (...args) => events.recoveryFacts(...args),
        read: async (id, after, limit) => {
          const page = await events.read(id, after, limit);
          if (!finished && limit !== undefined) {
            await events.append(id, [draft, draft]);
            appended += 2;
            if (page.length < limit) {
              finished = true;
              await events.append(id, [{ type: 'run.cancelled' }]);
            }
          }
          return page;
        },
      };
      const app = Fastify();
      app.get('/', (request, reply) =>
        streamRunEvents(request, reply, store, runId, 0, {
          isFinalized: () => Promise.resolve(true),
        }),
      );
      const base = await app.listen({ host: '127.0.0.1', port: 0 });
      try {
        const text = await (await fetch(base)).text();
        expect(text.includes('event: stream.error')).toBe(false);
        expect(appended).toBeGreaterThan(256);
        const stored = await events.read(runId);
        expect(ids(text)).toEqual(stored.map((e) => e.seq));
        const delivered = [...text.matchAll(/^data: (.+)\nid: \d+$/gm)].map((m) =>
          RunEventSchema.parse(JSON.parse(m[1]!)),
        );
        expect(delivered).toEqual(stored);
      } finally {
        await app.close();
        await t?.close();
      }
    },
    120_000,
  );

  it.each(['corrupt', 'query', 'gap'] as const)(
    'handles a SQLite %s beyond the replay cursor without consuming a control id',
    async (fault) => {
      const dataDir = await mkdtemp(join(tmpdir(), 'gg-wp-e1-186-'));
      const t = await createTestApp({
        env: {
          GG_DATA_DIR: dataDir,
          GG_DB_URL: `file:${join(dataDir, 'events.db')}`,
        },
      });
      const events = t.container.repos.events;
      const client = t.container.handle.client;
      await events.append(runId, [
        ...Array.from({ length: 300 }, () => draft),
        { type: 'run.cancelled' },
      ]);
      if (fault === 'corrupt')
        await client.execute({
          sql: 'UPDATE run_events SET payload = ? WHERE run_id = ? AND seq = 129',
          args: ['{', runId],
        });
      if (fault === 'gap')
        await client.execute({
          sql: 'DELETE FROM run_events WHERE run_id = ? AND seq = 2',
          args: [runId],
        });
      let reads = 0;
      let renamed = false;
      const store: EventStorePort = {
        append: (...args) => events.append(...args),
        subscribe: (...args) => events.subscribe(...args),
        recoveryFacts: (...args) => events.recoveryFacts(...args),
        read: async (...args) => {
          const page = await events.read(...args);
          if (++reads === 1 && fault === 'query') {
            await client.execute('ALTER TABLE run_events RENAME TO held_run_events');
            renamed = true;
          }
          return page;
        },
      };
      const app = Fastify();
      app.get('/', (request, reply) =>
        streamRunEvents(request, reply, store, runId, 0, {
          isFinalized: () => Promise.resolve(true),
        }),
      );
      try {
        const response = await app.inject('/');
        expect(response.statusCode).toBe(200);
        if (fault === 'gap') {
          expect(response.body.includes('event: stream.error')).toBe(false);
          expect(ids(response.body)).toEqual((await events.read(runId)).map((e) => e.seq));
        } else {
          expect(ids(response.body)).toEqual(Array.from({ length: 128 }, (_, i) => i + 1));
          const control = response.body.split('event: stream.error\n')[1]!;
          expect(control).not.toMatch(/^id:/m);
          const problem = JSON.parse(/^data: (.+)$/m.exec(control)![1]!);
          expect(problem).toMatchObject({
            status: 500,
            code: fault === 'corrupt' ? 'STORED_EVENT_INVALID' : 'SSE_REPLAY_FAILED',
          });
        }
      } finally {
        if (renamed) await client.execute('ALTER TABLE held_run_events RENAME TO run_events');
        await app.close();
        await t.close();
      }
    },
  );

  it.each([
    { count: 3_000, past: 0 },
    { count: 3_000, past: 100 },
    { count: 6_000, past: 0 },
    { count: 6_000, past: 100 },
  ])(
    'bounds terminal confirmation for $count events, $past past the end',
    async ({ count, past }) => {
      const events = new InMemoryEventStore(new FakeClock());
      const log = await events.append(runId, [
        ...Array.from({ length: count - 1 }, () => draft),
        { type: 'run.cancelled' },
      ]);
      const reads: { after: number; limit: number | undefined; rows: number }[] = [];
      const store: EventStorePort = {
        append: (...args) => events.append(...args),
        subscribe: (...args) => events.subscribe(...args),
        recoveryFacts: (...args) => events.recoveryFacts(...args),
        read: async (id, after, limit) => {
          const page = await events.read(id, after, limit);
          reads.push({ after: after ?? 0, limit, rows: page.length });
          return page;
        },
      };
      const app = Fastify();
      const options = {
        isTerminal: () => Promise.resolve(true),
        lastLifecycleEvent: () => Promise.resolve(log.at(-1)),
      };
      app.get('/', (request, reply) =>
        streamRunEvents(request, reply, store, runId, count + past, {
          ...options,
          isFinalized: () => Promise.resolve(true),
        }),
      );
      try {
        const response = await app.inject('/');
        expect(ids(response.body)).toEqual([]);
        expect(response.body).toContain(': connected');
        // One extra bounded tail read follows lifecycle confirmation before stream.complete.
        expect(reads.length).toBeLessThanOrEqual(3);
        expect(reads.every((read) => read.after === count + past && read.limit === 128)).toBe(true);
        expect(reads.reduce((sum, read) => sum + read.rows, 0)).toBe(0);
      } finally {
        await app.close();
      }
    },
  );

  it('bounds confirmation after catching up through post-terminal delivery audit events', async () => {
    const events = new InMemoryEventStore(new FakeClock());
    await events.append(
      runId,
      Array.from({ length: 3_000 }, () => draft),
    );
    const [terminal] = await events.append(runId, [
      {
        type: 'run.finished',
        status: 'succeeded',
        outcome: 'success',
        result: 'done',
      },
    ]);
    const audit = await events.append(
      runId,
      Array.from({ length: 300 }, () => ({
        type: 'return.delivered' as const,
        channel: { kind: 'caller' as const },
        target: 'run.result',
      })),
    );
    let reads = 0;
    let rows = 0;
    const store: EventStorePort = {
      append: (...args) => events.append(...args),
      subscribe: (...args) => events.subscribe(...args),
      recoveryFacts: (...args) => events.recoveryFacts(...args),
      read: async (...args) => {
        reads++;
        const page = await events.read(...args);
        rows += page.length;
        return page;
      },
    };
    const app = Fastify();
    const options = {
      isTerminal: () => Promise.resolve(true),
      lastLifecycleEvent: () => Promise.resolve(terminal),
    };
    app.get('/', (request, reply) =>
      streamRunEvents(request, reply, store, runId, terminal!.seq, {
        ...options,
        isFinalized: () => Promise.resolve(true),
      }),
    );
    try {
      const response = await app.inject('/');
      expect(ids(response.body)).toEqual(audit.map((event) => event.seq));
      expect(response.body).not.toContain('stream.error');
      expect(reads).toBeLessThanOrEqual(5);
      expect(rows).toBe(300);
    } finally {
      await app.close();
    }
  });

  it.each(['missing', 'resumed'] as const)(
    'keeps defensive grace for a %s current terminal marker',
    async (kind) => {
      const events = new InMemoryEventStore(new FakeClock());
      const log = await events.append(
        runId,
        kind === 'missing'
          ? [draft]
          : [
              {
                type: 'run.failed',
                failure: { code: 'HARNESS_TURN_FAILED', message: 'retry', resumable: true },
              },
              { type: 'run.resumed', actor: { kind: 'user', id: 'local' } },
            ],
      );
      let confirmations = 0;
      const options = {
        isTerminal: () => Promise.resolve(true),
        lastLifecycleEvent: () => {
          confirmations++;
          return Promise.resolve(kind === 'missing' ? undefined : log.at(-1));
        },
        terminalGraceMs: 1,
      };
      const app = Fastify();
      app.get('/', (request, reply) =>
        streamRunEvents(request, reply, events, runId, log.at(-1)!.seq, {
          ...options,
          isFinalized: () => Promise.resolve(true),
        }),
      );
      try {
        const response = await app.inject('/');
        expect(ids(response.body)).toEqual([]);
        expect(response.body).not.toContain('stream.error');
        // Both confirmation sites ran: no old/missing outcome incorrectly short-circuited grace.
        expect(confirmations).toBe(2);
      } finally {
        await app.close();
      }
    },
  );

  it('reports the writable ceiling on a paused real high-water-mark transport', async () => {
    const events = new InMemoryEventStore(new FakeClock());
    await events.append(runId, [
      { ...draft, payload: 'x'.repeat(8_388_608) },
      { type: 'run.cancelled' },
    ]);
    // This public Node transport has a high-water mark ABOVE the SSE ceiling. A paused peer
    // fills the real queue; the ceiling must fail before write can return false and await drain.
    const app = Fastify({
      serverFactory: (handler) => createServer({ highWaterMark: 1_048_576 }, handler),
    });
    let declared!: () => void;
    const declaration = new Promise<void>((resolve) => {
      declared = resolve;
    });
    const store: EventStorePort = {
      append: (...args) => events.append(...args),
      recoveryFacts: (...args) => events.recoveryFacts(...args),
      read: (...args) => events.read(...args),
      subscribe: (id, listener) => {
        const stop = events.subscribe(id, listener);
        return () => {
          stop();
          declared();
        };
      },
    };
    app.get('/', (request, reply) => {
      expect(reply.raw.writableHighWaterMark).toBe(1_048_576);
      return streamRunEvents(request, reply, store, runId, 0, {
        isFinalized: () => Promise.resolve(true),
      });
    });
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    try {
      const text = await new Promise<string>((resolve, reject) => {
        const req = get(base, (response) => {
          response.socket.pause();
          response.pause();
          let text = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            text += chunk;
          });
          response.on('end', () => resolve(text));
          response.on('error', reject);
          void declaration.then(() => {
            response.socket.resume();
            response.resume();
          });
        });
        req.on('error', reject);
      });
      expect(text.includes('event: stream.error')).toBe(true);
      expect(text.includes('SSE_SLOW_CONSUMER')).toBe(true);
      expect(ids(text)).toEqual([0]);
    } finally {
      await app.close();
    }
  }, 20_000);
});

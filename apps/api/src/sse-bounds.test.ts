import Fastify from 'fastify';
import { get } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EventStorePort } from '@graphgoblin/engine';
import { FakeClock, InMemoryEventStore } from '@graphgoblin/engine/testing';
import { FIXTURE_IDS } from '@graphgoblin/contracts/testing';
import { RunEventSchema, type RunEvent } from '@graphgoblin/contracts';
import { streamRunEvents, type SseOptions } from './sse.js';
import { createTestApp } from './testing/test-app.js';

const runId = FIXTURE_IDS.run;
const draft = { type: 'run.woken', nodeId: 'wait', reason: 'manual' } as const;
const ids = (text: string) => [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));

describe('bounded SSE transport', () => {
  it('catches up a live sequence gap from durable history without failing the reader', async () => {
    const events = new InMemoryEventStore(new FakeClock());
    await events.append(runId, [draft]);
    const store: EventStorePort = {
      append: (...args) => events.append(...args),
      read: (...args) => events.read(...args),
      // A public-port fault fixture: durable append is ordered, live notification 2 is absent.
      subscribe: (id, listener) =>
        events.subscribe(id, (event) => {
          if (event.seq !== 2) listener(event);
        }),
    };
    const app = Fastify();
    app.get('/', (request, reply) =>
      streamRunEvents(request, reply, store, runId, 0, {
        isFinalized: () => Promise.resolve(true),
      }),
    );
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    try {
      const response = await fetch(base);
      await events.append(runId, [draft, draft, { type: 'run.cancelled' }]);
      const text = await response.text();
      expect(text.includes('event: stream.error')).toBe(false);
      expect(ids(text)).toEqual((await events.read(runId)).map((e) => e.seq));
    } finally {
      await app.close();
    }
  });

  it.each([0, -1, 1.5])(
    'reads bounded pages from %s and merges a durable live append between pages exactly once',
    async (after) => {
      const events = new InMemoryEventStore(new FakeClock());
      await events.append(
        runId,
        Array.from({ length: 300 }, () => draft),
      );
      const reads: Array<{ after: number; limit: number | undefined }> = [];
      const store: EventStorePort = {
        append: (...args) => events.append(...args),
        subscribe: (...args) => events.subscribe(...args),
        read: async (id, after = 0, limit) => {
          reads.push({ after, limit });
          const page = await events.read(id, after, limit);
          if (reads.length === 2 || limit === undefined)
            await events.append(id, [draft, { type: 'run.cancelled' }]);
          return page;
        },
      };
      const app = Fastify();
      app.get('/', (request, reply) =>
        streamRunEvents(request, reply, store, runId, after, {
          isFinalized: () => Promise.resolve(true),
        }),
      );
      try {
        const response = await app.inject('/');
        expect(reads.every(({ limit }) => limit !== undefined && limit <= 128)).toBe(true);
        expect(reads.length).toBeGreaterThan(2);
        expect(ids(response.body)).toEqual(
          (await events.read(runId)).filter((e) => e.seq > after).map((e) => e.seq),
        );
      } finally {
        await app.close();
      }
    },
  );

  it.each(['count', 'bytes'] as const)(
    'bounds the held-live %s queue by catching up from the log without a stream failure',
    async (kind) => {
      const events = new InMemoryEventStore(new FakeClock());
      await events.append(runId, [draft]);
      const reads: number[] = [];
      const store: EventStorePort = {
        append: (...args) => events.append(...args),
        subscribe: (...args) => events.subscribe(...args),
        read: async (id, after, limit) => {
          reads.push(after ?? 0);
          return events.read(id, after, limit);
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
        const response = await fetch(base);
        const burst =
          kind === 'count'
            ? Array.from({ length: 300 }, () => draft)
            : [{ ...draft, payload: 'x'.repeat(1_048_576) }];
        await events.append(runId, [...burst, { type: 'run.cancelled' }]);
        const body = await response.text();
        expect(body.includes('event: stream.error')).toBe(false);
        const stored = await events.read(runId);
        expect(stored).toHaveLength(kind === 'count' ? 302 : 3);
        // Recovery must consult the log before draining the burst, demonstrating a bounded
        // handoff through the public read port rather than inspecting the private queue.
        expect(reads.slice(0, 2)).toEqual([0, 1]);
        expect(reads.length).toBeGreaterThan(2);
        expect(reads[2]).toBeLessThanOrEqual(2);
        const recovered = [...body.matchAll(/^data: (.+)\nid: \d+$/gm)].map((match) =>
          RunEventSchema.parse(JSON.parse(match[1]!)),
        );
        expect(recovered).toEqual(stored);
      } finally {
        await app.close();
      }
    },
  );

  it('fails a paused real socket, then recovers its complete SQLite sequence and payloads from the last id', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'gg-wp-e1-186-'));
    const t = await createTestApp({ env: { GG_DB_URL: `file:${join(dataDir, 'events.db')}` } });
    const events = t.container.repos.events;
    const id = await t.publishLoop({
      schemaVersion: 4,
      name: 'paused',
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
        { id: 'wait', kind: 'wait', label: 'Wait', config: { mode: 'input', prompt: 'Go?' } },
        { id: 'done', kind: 'exit', label: 'Done', config: {} },
      ],
      edges: [
        { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'wait' } },
        { id: 'b', from: { node: 'wait', port: 'out' }, to: { node: 'done' } },
      ],
    });
    const run = await t.container.manager.startRun({
      ownerId: 'local',
      loopId: id,
      source: 'manual.api',
    });
    await t.idle();
    const previous = (await events.read(run.id)).at(-1)!.seq;
    await events.append(run.id, [
      ...Array.from({ length: 256 }, (_, index) => {
        const empty = RunEventSchema.parse({
          ...draft,
          runId: run.id,
          seq: previous + index + 1,
          ts: t.clock.now().toISOString(),
          payload: '',
        });
        // Align the data-line newline to a chunk boundary: JSON can be complete while id is
        // still unsent. Cursor recovery must discard that partial frame rather than skip it.
        const payloadBytes =
          65_536 - Buffer.byteLength(`event: run.woken\ndata: ${JSON.stringify(empty)}\n`);
        return { ...draft, payload: 'x'.repeat(payloadBytes) };
      }),
      { type: 'run.cancelled' },
    ]);
    const app = Fastify();
    let declared!: () => void;
    const declaration = new Promise<void>((resolve) => {
      declared = resolve;
    });
    const transportStore: EventStorePort = {
      append: (...args) => events.append(...args),
      read: (...args) => events.read(...args),
      subscribe: (id, listener) => {
        const stop = events.subscribe(id, listener);
        return () => {
          stop();
          declared();
        };
      },
    };
    const options: SseOptions & { drainTimeoutMs: number } = {
      drainTimeoutMs: 100,
      isFinalized: () => Promise.resolve(true),
    };
    app.get<{ Querystring: { after?: string } }>('/', (request, reply) =>
      streamRunEvents(
        request,
        reply,
        transportStore,
        run.id,
        Number(request.query.after ?? 0),
        request.query.after
          ? { drainTimeoutMs: 5_000, isFinalized: () => Promise.resolve(true) }
          : options,
      ),
    );
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    try {
      const text = await new Promise<string>((resolve, reject) => {
        const req = get(base, (response) => {
          const socket = response.socket;
          socket.pause();
          response.pause();
          let text = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            text += chunk;
          });
          response.on('end', () => resolve(text));
          response.on('error', reject);
          // Observe subscription release instead of guessing when a loaded host reaches TCP
          // backpressure. The baseline releases after queuing everything, without a failure.
          void declaration.then(() => {
            socket.resume();
            response.resume();
          });
        });
        req.on('error', reject);
      });
      expect(text.includes('event: stream.error')).toBe(true);
      expect(text.includes('SSE_SLOW_CONSUMER')).toBe(true);
      const prefix = text.split('\n\n').flatMap((frame) => {
        const data = /^data: (.+)$/m.exec(frame)?.[1];
        if (!data || !/^id: \d+$/m.test(frame)) return [];
        // Failure can terminate a partial frame with a cursor reset and invalid multi-line data.
        if (frame.includes('\ndata: [interrupted]')) return [];
        return [RunEventSchema.parse(JSON.parse(data))];
      });
      const cursor = ids(text).at(-1) ?? 0;
      expect(cursor).toBe(prefix.at(-1)?.seq ?? 0);
      const suffix = await (await fetch(`${base}/?after=${cursor}`)).text();
      const recovered = suffix.split('\n\n').flatMap((frame) => {
        const data = /^data: (.+)$/m.exec(frame)?.[1];
        return data && /^id: \d+$/m.test(frame) ? [JSON.parse(data) as RunEvent] : [];
      });
      expect([...prefix, ...recovered]).toEqual(await events.read(run.id));
    } finally {
      await app.close();
      await t.close();
    }
  }, 20_000);
});

import { performance } from 'node:perf_hooks';
import { and, asc, eq, gt } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { fakeUlid, FIXTURE_TS } from '@graphgoblin/contracts/testing';
import { FakeClock } from '@graphgoblin/engine/testing';
import { openMemoryDatabase } from './db.js';
import { SqliteEventStore } from './events.js';
import { runEvents } from './schema.js';

it('round-trips large mixed evaluation pages and measures read validation overhead', async () => {
  const handle = await openMemoryDatabase();
  try {
    const runId = fakeUlid('event-read-benchmark');
    const store = new SqliteEventStore(handle.db, new FakeClock());
    const rows = Array.from({ length: 10_000 }, (_, index) => ({
      runId,
      seq: index + 1,
      ts: FIXTURE_TS,
      nodeId: 'done',
      type: index % 2 === 0 ? 'exit.evaluated' : 'decision.made',
      payload:
        index % 2 === 0
          ? {
              iteration: 2,
              maxIterations: 5,
              criteria: [
                {
                  index: 0,
                  strategy: 'jev',
                  status: 'not-matched',
                  holds: false,
                  confidence: 0.8,
                  classifierModel: 'jev',
                },
                {
                  index: 1,
                  strategy: 'codex',
                  status: 'matched',
                  holds: true,
                  confidence: 0.93,
                  model: 'gpt-6-luna',
                  reasoning: 'Done. '.repeat(100),
                },
              ],
              result: {
                kind: 'completed',
                reason: 'criterion-matched',
                outcome: 'success',
                criterionIndex: 1,
              },
            }
          : {
              strategy: 'expression',
              route: 'yes',
              skipped: [
                {
                  strategy: 'jev',
                  code: 'CLASSIFIER_MODEL_DISABLED',
                  message: 'The selected classifier is disabled',
                },
              ],
            },
    }));
    for (let offset = 0; offset < rows.length; offset += 500)
      await handle.db.insert(runEvents).values(rows.slice(offset, offset + 500));
    const baseline = async (limit: number) => {
      const stored = await handle.db
        .select()
        .from(runEvents)
        .where(and(eq(runEvents.runId, runId), gt(runEvents.seq, 0)))
        .orderBy(asc(runEvents.seq))
        .limit(limit);
      return stored.map((row) => ({
        ...row.payload,
        runId: row.runId,
        seq: row.seq,
        ts: row.ts,
        type: row.type,
        nodeId: row.nodeId,
      }));
    };
    const median = (samples: number[]) =>
      [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)]!;
    for (const size of [1000, 10_000]) {
      for (let warmup = 0; warmup < 3; warmup++) {
        await baseline(size);
        await store.read(runId, 0, size);
      }
      const raw: number[] = [];
      const validated: number[] = [];
      for (let repeat = 0; repeat < 10; repeat++) {
        // Alternate order to reduce warm-cache and scheduling bias.
        const measure = async (read: () => Promise<unknown>, samples: number[]) => {
          const started = performance.now();
          await read();
          samples.push(performance.now() - started);
        };
        if (repeat % 2 === 0) {
          await measure(() => baseline(size), raw);
          await measure(() => store.read(runId, 0, size), validated);
        } else {
          await measure(() => store.read(runId, 0, size), validated);
          await measure(() => baseline(size), raw);
        }
      }
      expect(await store.read(runId, 0, size)).toEqual(await baseline(size));
      console.warn(
        JSON.stringify({
          eventReadBenchmark: {
            rows: size,
            samples: 10,
            baselineMedianMs: median(raw),
            validatedMedianMs: median(validated),
            addedMedianMs: median(validated) - median(raw),
          },
        }),
      );
    }
  } finally {
    handle.close();
  }
}, 60_000);

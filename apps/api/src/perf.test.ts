import type { AddressInfo } from 'node:net';
import { cpus, totalmem } from 'node:os';
import type { LoopDefinitionInput, RunEvent, RunRecord } from '@graphgoblin/contracts';
import type { HarnessItem } from '@graphgoblin/engine';
import { describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './testing/test-app.js';

/**
 * Backend performance baseline (docs/10, "Performance baseline"). Boots the API in-process over
 * the in-memory database with the fake harness, whose scripted turn streams ITEMS items, so one
 * run appends a little over ITEMS events (one `node.progress` per item). It measures 10 runs in
 * parallel and SSE delivery of one run's log, and prints the numbers. Skipped unless `PERF=1`:
 *
 *   PERF=1 pnpm --filter @graphgoblin/api test -- src/perf.test.ts          (bash)
 *   $env:PERF='1'; pnpm --filter @graphgoblin/api test -- src/perf.test.ts  (PowerShell)
 */
const perf = process.env.PERF === '1';
const ITEMS = 1_000;
const PARALLEL = 10;

const loop: LoopDefinitionInput = {
  schemaVersion: 1,
  name: 'perf',
  nodes: [
    { id: 'start', kind: 'trigger', label: 'S', config: { subtype: 'manual' } },
    { id: 'infer', kind: 'inference', label: 'I', config: { prompt: { template: 'stream' } } },
    { id: 'done', kind: 'exit', label: 'D', config: {} },
  ],
  edges: [
    { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'infer' } },
    { id: 'e2', from: { node: 'infer', port: 'out' }, to: { node: 'done' } },
  ],
};

function items(): HarnessItem[] {
  return Array.from({ length: ITEMS }, (_, i) => ({
    id: `item-${String(i)}`,
    type: i % 3 === 0 ? 'command' : 'message',
    summary: `step ${String(i)}: ${'x'.repeat(120)}`,
  }));
}

function ms(start: number): number {
  return Math.round(performance.now() - start);
}

async function startRun(t: TestApp, loopId: string): Promise<RunRecord> {
  const response = await t.app.inject({
    method: 'POST',
    url: `/loops/${loopId}/runs`,
    payload: {},
  });
  return response.json<{ run: RunRecord }>().run;
}

/** Read an SSE response to the end; returns time to first event, total time, and the events. */
async function readSse(url: string): Promise<{ firstMs: number; totalMs: number; events: number }> {
  const start = performance.now();
  const response = await fetch(url, { headers: { accept: 'text/event-stream' } });
  if (!response.body) throw new Error('no body');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let events = 0;
  let firstMs = -1;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    let index: number;
    while ((index = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      if (frame.startsWith('id:')) {
        events += 1;
        if (firstMs < 0) firstMs = ms(start);
      }
    }
  }
  return { firstMs, totalMs: ms(start), events };
}

describe.skipIf(!perf)('performance baseline', () => {
  it(`runs ${String(PARALLEL)} runs of ${String(ITEMS)}+ events in parallel and streams one over SSE`, async () => {
    const t = await createTestApp({ env: { GG_MAX_CONCURRENT_RUNS: String(PARALLEL) } });
    try {
      t.harness.script(Array.from({ length: PARALLEL + 2 }, () => ({ items: items() })));
      const loopId = await t.publishLoop(loop);

      // (a) 10 runs in parallel.
      const wall = performance.now();
      const runs = await Promise.all(Array.from({ length: PARALLEL }, () => startRun(t, loopId)));
      const finishedAt = new Map<string, number>();
      for (const run of runs) {
        t.container.repos.events.subscribe(run.id, (event: RunEvent) => {
          if (event.type === 'run.finished') finishedAt.set(run.id, performance.now());
        });
      }
      await t.idle();
      const wallMs = ms(wall);
      const records = await Promise.all(runs.map((r) => t.container.repos.runs.get(r.id)));
      const eventCounts = await Promise.all(
        runs.map(async (r) => (await t.container.repos.events.read(r.id)).length),
      );
      const perRun = runs.map((r) => Math.round((finishedAt.get(r.id) ?? NaN) - wall));
      expect(records.every((r) => r?.status === 'succeeded')).toBe(true);
      expect(Math.min(...eventCounts)).toBeGreaterThanOrEqual(ITEMS);

      // (b) SSE replay of a finished run's whole log, over a real socket.
      await t.app.listen({ host: '127.0.0.1', port: 0 });
      const { port } = t.app.server.address() as AddressInfo;
      const base = `http://127.0.0.1:${String(port)}`;
      const replay = await readSse(`${base}/runs/${runs[0]!.id}/events`);
      expect(replay.events).toBe(eventCounts[0]);

      // (c) SSE live tail of a run that starts as the client connects.
      const liveRun = await startRun(t, loopId);
      const live = await readSse(`${base}/runs/${liveRun.id}/events`);
      await t.idle();
      expect(live.events).toBe((await t.container.repos.events.read(liveRun.id)).length);

      const summary = {
        machine: `${cpus()[0]?.model.trim() ?? 'unknown'} x${String(cpus().length)}, ${String(Math.round(totalmem() / 2 ** 30))} GiB, ${process.platform}, Node ${process.versions.node}`,
        eventsPerRun: eventCounts[0],
        parallel: {
          runs: PARALLEL,
          allSucceeded: true,
          wallMs,
          perRunMs: { min: Math.min(...perRun), max: Math.max(...perRun) },
          eventsPerSecond: Math.round(eventCounts.reduce((a, b) => a + b, 0) / (wallMs / 1000)),
        },
        sseReplay: replay,
        sseLive: live,
      };
      process.stdout.write(`PERF ${JSON.stringify(summary, null, 2)}\n`);
    } finally {
      await t.close();
    }
  }, 300_000);
});

import { createServer, type Server } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { JsonValue, LoopDefinitionInput } from '@graphgoblin/contracts';
import { createTestApp, type TestApp } from '../testing/test-app.js';

const opened: TestApp[] = [];
let source: Server | undefined;
let candidates: JsonValue[] = [];
let responseBody: string | undefined;
afterEach(async () => {
  for (const t of opened.splice(0)) await t.close();
  await new Promise<void>((resolve) => {
    if (!source) return resolve();
    source.close(() => resolve());
    source.closeAllConnections();
  });
  source = undefined;
  responseBody = undefined;
});
function deep(levels: number, key = 'deep'): JsonValue {
  let v: JsonValue = 'private candidate value';
  for (let i = 0; i < levels; i += 1) v = [v];
  return { key, v };
}
async function setup(env?: Record<string, string>) {
  if (!env) {
    const dir = await mkdtemp(join(tmpdir(), 'gg-wp-c3-'));
    env = { GG_DATA_DIR: dir, GG_DB_URL: 'file:' + join(dir, 'store.db') };
  }
  const t = await createTestApp({ env });
  opened.push(t);
  return { t, env };
}
async function publish(t: TestApp) {
  source = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(responseBody ?? JSON.stringify(candidates));
  });
  await new Promise<void>((resolve, reject) => {
    source!.once('error', reject);
    source!.listen(5788, '127.0.0.1', resolve);
  });
  const definition: LoopDefinitionInput = {
    schemaVersion: 4,
    name: 'Depth refusal',
    nodes: [
      {
        id: 'poll',
        kind: 'trigger',
        label: 'Poll',
        config: {
          type: 'poll',
          intervalSeconds: 5,
          probe: { kind: 'http', url: 'http://127.0.0.1:5788' },
          fireWhen: 'true',
          items: { select: 'probe.json', dedupeKey: 'item.key', maxRunsPerPoll: 5 },
        },
      },
      { id: 'wait', kind: 'wait', label: 'Wait', config: { mode: 'input', prompt: 'Answer' } },
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
    ],
    edges: [
      { id: 'a', from: { node: 'poll', port: 'out' }, to: { node: 'wait' } },
      { id: 'b', from: { node: 'wait', port: 'out' }, to: { node: 'done' } },
    ],
  };
  return t.publishLoop(definition);
}
async function poll(t: TestApp) {
  t.clock.advance(5000);
  const runs = await t.container.polls.poll();
  await t.idle();
  return Promise.all(
    runs.map(
      async (run) =>
        (await t.container.repos.runs.getInitialThread(run.id))?.invocation.trigger.dedupeKey,
    ),
  );
}

describe('structurally refused poll candidates over HTTP and real SQLite', () => {
  it.each([1100, 3000])(
    'admits both later candidates when the first has %i nested arrays',
    async (depth) => {
      const { t } = await setup();
      candidates = [deep(depth), { key: 's-a' }, { key: 's-b' }];
      // The fixture must not rely on JSON.stringify's own recursive stack limit.
      responseBody =
        '[{"key":"deep","v":' +
        '['.repeat(depth) +
        '"private candidate value"' +
        ']'.repeat(depth) +
        '},{"key":"s-a"},{"key":"s-b"}]';
      const loopId = await publish(t);
      expect(await poll(t)).toEqual(['s-a', 's-b']);
      expect(await t.container.repos.runs.hasTriggerDedupe(loopId, 'poll', 'deep')).toBe(false);
      const warnings = t.logger.lines.filter((line) => line.level === 'warn');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.obj).toMatchObject({
        code: 'POLL_ITEM_REJECTED',
        itemIndex: 0,
        reason: 'NESTING_DEPTH_EXCEEDED',
      });
      expect(JSON.stringify(warnings)).not.toContain('private candidate value');
      expect(JSON.stringify(warnings[0]).length).toBeLessThan(512);
    },
  );
  it('admits the SQLite boundary and refuses the next depth without blocking the tail', async () => {
    const { t } = await setup();
    candidates = [deep(996, 'boundary'), deep(997), { key: 'later' }];
    const loopId = await publish(t);
    expect(await poll(t)).toEqual(['boundary', 'later']);
    expect(await t.container.repos.runs.hasTriggerDedupe(loopId, 'poll', 'deep')).toBe(false);
    expect(
      t.logger.lines.find((line) => line.obj.code === 'POLL_ITEM_REJECTED')?.obj,
    ).toMatchObject({ itemIndex: 1 });
  });
  it('keeps middle refusals unconsumed and successful keys deduplicated across store reopen', async () => {
    const { t, env } = await setup();
    candidates = [{ key: 'mid-a' }, deep(1200), { key: 'mid-b' }];
    const loopId = await publish(t);
    expect(await poll(t)).toEqual(['mid-a', 'mid-b']);
    expect(await poll(t)).toEqual([]);
    expect(t.logger.lines.filter((line) => line.obj.code === 'POLL_ITEM_REJECTED')).toHaveLength(2);
    expect(await t.container.repos.runs.hasTriggerDedupe(loopId, 'poll', 'deep')).toBe(false);
    opened.splice(opened.indexOf(t), 1);
    await t.close();
    const next = (await setup(env)).t;
    expect(await poll(next)).toEqual([]);
    expect(await next.container.repos.runs.hasTriggerDedupe(loopId, 'poll', 'deep')).toBe(false);
    expect(await next.container.repos.runs.list({ loopId })).toHaveLength(2);
    expect(
      next.logger.lines.find((line) => line.obj.code === 'POLL_ITEM_REJECTED')?.obj,
    ).toMatchObject({ itemIndex: 1 });
    // The same key remains admissible when its structure is repaired.
    candidates = [{ key: 'mid-a' }, { key: 'deep' }, { key: 'mid-b' }];
    expect(await poll(next)).toEqual(['deep']);
    expect(await next.container.repos.runs.list({ loopId })).toHaveLength(3);
  });
});

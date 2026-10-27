import { afterEach, beforeEach, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/libsql';
import { fakeUlid } from '@graphgoblin/contracts/testing';
import type { EventDraft } from '@graphgoblin/engine';
import { FakeClock } from '@graphgoblin/engine/testing';
import { openMemoryDatabase, type DatabaseHandle } from './db.js';
import { SqliteEventStore } from './events.js';
import { schema } from './schema.js';

let handle: DatabaseHandle;
const runId = fakeUlid('evidence-index');

beforeEach(async () => {
  handle = await openMemoryDatabase();
});
afterEach(() => {
  handle.close();
});

const decision: EventDraft = {
  type: 'decision.made',
  nodeId: 'route',
  portId: 'again',
  provenance: { kind: 'expression', provider: null, model: null, effort: null, classifierId: null },
  diagnostics: [],
  observation: { kind: 'route', routeId: 'again', confidence: null, reasoning: null },
};
const gated: EventDraft = {
  ...decision,
  nodeId: 'gate',
  gate: {
    previousPasses: 1,
    passes: 2,
    maxPasses: null,
    repeatRouteId: 'again',
    elapsedSeconds: 0,
    limit: null,
  },
};
const resume: EventDraft = { type: 'run.resumed', actor: { kind: 'user', id: 'local' } };
const freshResume: EventDraft = {
  ...resume,
  freshSession: {
    visitId: `${runId}:work:1`,
    harness: 'claude',
    origin: 'resume-own',
    model: 'sonnet',
    effort: 'low',
    nodeId: 'work',
    failureSeq: 1,
    priorContextCarried: false,
  },
};

/** A store whose every statement is recorded through Drizzle's public query logger. */
function recordingStore() {
  const statements: { query: string; params: unknown[] }[] = [];
  const db = drizzle(handle.client, {
    schema,
    logger: { logQuery: (query, params) => statements.push({ query, params }) },
  });
  return { store: new SqliteEventStore(db, new FakeClock()), statements };
}

/** SQLite's plan for a recorded statement, run with the parameters it was given. */
async function plan(statement: { query: string; params: unknown[] }): Promise<string[]> {
  const args = statement.params.map((value) =>
    typeof value === 'string' || typeof value === 'number' ? value : String(value),
  );
  const rows = await handle.client.execute({ sql: `EXPLAIN QUERY PLAN ${statement.query}`, args });
  return rows.rows.map((row) => {
    const detail = row['detail'];
    if (typeof detail !== 'string') throw new Error('A query plan row has no detail');
    return detail;
  });
}

it('finds the latest gate and fresh-session choices with one partial-index seek, however long the history (#186)', async () => {
  const { store, statements } = recordingStore();
  // An ungated cyclic loop keeps appending decisions without gate evidence, and resumes without
  // a fresh-session choice accumulate: neither may lengthen the observation read.
  const [first] = await store.append(runId, [gated, freshResume]);
  for (let batch = 0; batch < 4; batch++)
    await store.append(
      runId,
      Array.from({ length: 500 }, (_, i) => (i % 2 ? decision : resume)),
    );
  const [lastFresh] = await store.append(runId, [freshResume]);

  statements.length = 0;
  expect(await store.latestGate(runId)).toEqual(first);
  expect(statements).toHaveLength(1);
  expect(await plan(statements[0]!)).toEqual([
    'SEARCH run_events USING INDEX run_events_gate_idx (run_id=?)',
  ]);

  statements.length = 0;
  const choices = await store.freshSessionChoices(runId, 20);
  expect(choices.map((event) => event.seq)).toEqual([2, lastFresh!.seq]);
  expect(statements).toHaveLength(1);
  expect(await plan(statements[0]!)).toEqual([
    'SEARCH run_events USING INDEX run_events_fresh_session_idx (run_id=?)',
  ]);

  // Each index holds only the evidence rows (and malformed ones), not the 2,000 others.
  const indexed = async (index: string) =>
    Number(
      (
        await handle.client.execute({
          sql: `SELECT count(*) AS n FROM run_events INDEXED BY ${index} WHERE run_id = ? AND ${
            index === 'run_events_gate_idx'
              ? `"run_events"."type" = 'decision.made' and case when json_valid("run_events"."payload") then json_type("run_events"."payload", '$.gate') is not null else 1 end`
              : `"run_events"."type" = 'run.resumed' and case when json_valid("run_events"."payload") then json_type("run_events"."payload", '$.freshSession') is not null else 1 end`
          }`,
          args: [runId],
        })
      ).rows[0]!['n'],
    );
  expect(await indexed('run_events_gate_idx')).toBe(1);
  expect(await indexed('run_events_fresh_session_idx')).toBe(2);
});

it('still reports a malformed newest evidence row instead of skipping it (#186)', async () => {
  const store = new SqliteEventStore(handle.db, new FakeClock());
  await store.append(runId, [gated, decision, resume]);
  await handle.client.execute({
    sql: 'UPDATE run_events SET payload = ? WHERE run_id = ? AND seq IN (2, 3)',
    args: ['{invalid', runId],
  });
  await expect(store.latestGate(runId)).rejects.toMatchObject({
    code: 'HISTORY_UNREADABLE',
    seq: 2,
  });
  await expect(store.freshSessionChoices(runId, 20)).rejects.toMatchObject({
    code: 'HISTORY_UNREADABLE',
    seq: 3,
  });
});

import { expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/libsql';
import { fakeUlid } from '@graphgoblin/contracts/testing';
import { FakeClock } from '@graphgoblin/engine/testing';
import { openMemoryDatabase } from './db.js';
import { SqliteEventStore } from './events.js';
import { schema } from './schema.js';

it('bounds recovery evidence and SQL rows independently of old history', async () => {
  const handle = await openMemoryDatabase();
  try {
    const statements: { query: string; params: unknown[] }[] = [];
    const store = new SqliteEventStore(
      drizzle(handle.client, {
        schema,
        logger: { logQuery: (query, params) => statements.push({ query, params }) },
      }),
      new FakeClock(),
    );
    const id = fakeUlid('bounded-recovery');
    expect(await store.recoveryFacts(id, [])).toMatchObject({ observedSeq: 0, reachedNodeIds: [] });
    await store.append(id, [
      { type: 'node.started', nodeId: 'work', kind: 'script', attempt: 1, configHash: 'test' },
      {
        type: 'run.failed',
        failure: { code: 'SCRIPT_EXIT_CODE', message: 'retry', resumable: true },
      },
      {
        type: 'run.resumed',
        actor: { kind: 'user', id: 'reviewer' },
        childRecovery: {
          runId: fakeUlid('child'),
          failureSeq: 7,
          observedSeq: 8,
          retryUncertainScript: true,
        },
      },
      { type: 'run.started', attempt: 2 },
    ]);
    for (const count of [0, 1000, 10000]) {
      for (let i = 0; i < count; i += 100)
        await store.append(
          id,
          Array.from(
            { length: 100 },
            () => ({ type: 'signal.received', name: 'old', payload: 'x'.repeat(1024) }) as const,
          ),
        );
      statements.length = 0;
      const facts = await store.recoveryFacts(id, ['work', 'unreached']);
      expect(facts.observedSeq).toBe(count === 0 ? 4 : count === 1000 ? 1004 : 11004);
      expect(facts.reachedNodeIds).toEqual(['work']);
      expect(facts.lifecycle?.type).toBe('run.started');
      expect(facts.failed?.seq).toBe(2);
      expect(facts.resumed?.childRecovery?.failureSeq).toBe(7);
      expect(statements).toHaveLength(4);
      let rows = 0;
      const plans: string[] = [];
      for (const { query, params } of statements) {
        const args = params.map((value) =>
          typeof value === 'number' || typeof value === 'string' ? value : String(value),
        );
        rows += (await handle.client.execute({ sql: query, args })).rows.length;
        const plan = await handle.client.execute({ sql: `EXPLAIN QUERY PLAN ${query}`, args });
        plans.push(
          ...plan.rows.map((row) => {
            const detail = row['detail'];
            if (typeof detail !== 'string') throw new Error('Query plan has no detail');
            return detail;
          }),
        );
      }
      expect(rows).toBe(5); // tail + three event payloads + one reached identity
      expect(plans.some((line) => line.includes('run_events_reached_idx'))).toBe(true);
      expect(plans.some((line) => /SCAN run_events/.test(line))).toBe(false);
    }
    // Unrelated history is not decoded; current recovery evidence remains validated.
    await handle.client.execute({
      sql: 'UPDATE run_events SET payload = ? WHERE run_id = ? AND seq = 5',
      args: ['{', id],
    });
    expect((await store.recoveryFacts(id, ['work'])).observedSeq).toBe(11004);
    await handle.client.execute({
      sql: 'UPDATE run_events SET payload = ? WHERE run_id = ? AND seq = 2',
      args: ['{', id],
    });
    await expect(store.recoveryFacts(id, [])).rejects.toMatchObject({
      code: 'HISTORY_UNREADABLE',
      seq: 2,
    });
  } finally {
    handle.close();
  }
});

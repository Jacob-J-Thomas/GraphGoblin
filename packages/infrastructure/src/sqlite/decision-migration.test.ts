import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { RunEventSchema } from '@graphgoblin/contracts';
import { fakeUlid, FIXTURE_TS } from '@graphgoblin/contracts/testing';
import { openDatabase } from './db.js';

describe('decision skipped evidence migration', () => {
  it('rewrites historical decisions once and preserves existing evidence and other events', async () => {
    const handle = openDatabase({ url: ':memory:' });
    try {
      await handle.migrate();
      const runId = fakeUlid('migration-run');
      const old = { strategy: 'expression', route: 'yes' };
      const recorded = {
        ...old,
        skipped: [
          { strategy: 'jev', code: 'CLASSIFIER_MODEL_DISABLED', message: 'Classifier disabled' },
        ],
      };
      for (const [index, payload] of [old, recorded, { attempt: 1 }].entries()) {
        await handle.client.execute({
          sql: 'INSERT INTO run_events (run_id, seq, ts, type, node_id, payload) VALUES (?, ?, ?, ?, ?, ?)',
          args: [
            runId,
            index + 1,
            FIXTURE_TS,
            index === 2 ? 'run.started' : 'decision.made',
            index === 2 ? null : 'done',
            JSON.stringify(payload),
          ],
        });
      }
      const sql = await readFile(
        new URL('../../drizzle/0007_decision_skipped.sql', import.meta.url),
        'utf8',
      );
      await handle.client.execute(sql);
      await handle.client.execute(sql);
      const rows = (await handle.client.execute('SELECT payload FROM run_events ORDER BY seq'))
        .rows;
      const payloads = rows.map((row) => {
        const payload = row['payload'];
        if (typeof payload !== 'string') throw new Error('Expected event JSON');
        return JSON.parse(payload) as unknown;
      });
      expect(payloads).toEqual([{ ...old, skipped: [] }, recorded, { attempt: 1 }]);
      expect(
        RunEventSchema.safeParse({
          runId,
          seq: 1,
          ts: FIXTURE_TS,
          type: 'decision.made',
          nodeId: 'done',
          ...(payloads[0] as Record<string, unknown>),
        }).success,
      ).toBe(true);
    } finally {
      handle.close();
    }
  });
});

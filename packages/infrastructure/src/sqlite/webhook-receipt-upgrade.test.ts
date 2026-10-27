import { afterEach, beforeEach, expect, it } from 'vitest';
import { RunEventSchema } from '@graphgoblin/contracts';
import { FIXTURE_TS, fakeUlid } from '@graphgoblin/contracts/testing';
import { openMemoryDatabase, type DatabaseHandle } from './db.js';

let handle: DatabaseHandle;
const runId = fakeUlid('historical receipt boundary');
const channel = { kind: 'webhook', url: 'https://example.test/hook' };
const delivered = (target?: unknown, secretRef?: string, url = channel.url) => ({
  channel: { ...channel, url, ...(secretRef === undefined ? {} : { secretRef }) },
  ...(target === undefined ? {} : { target }),
});
const failed = (error: string) => ({ channel, error });
const cases = [
  { name: 'omitted optionals', payload: delivered(), valid: true },
  { name: 'empty optionals', payload: delivered('', ''), valid: true },
  { name: 'ASCII maxima', payload: delivered('t'.repeat(4096), 's'.repeat(128)), valid: true },
  { name: 'astral maxima', payload: delivered('😀'.repeat(4096), '😀'.repeat(128)), valid: true },
  { name: 'short embedded NUL', payload: delivered('a\0b', 'x\0y'), valid: true },
  {
    name: 'URL normalization preserves stored channel',
    payload: delivered(undefined, undefined, ' https://example.test/hook '),
    valid: true,
  },
  { name: 'failure ASCII maximum', payload: failed('e'.repeat(4000)), valid: true },
  { name: 'failure astral maximum', payload: failed('😀'.repeat(4000)), valid: true },
  { name: 'empty failure', payload: failed(''), valid: true },
  { name: 'astral target 2049', payload: delivered('😀'.repeat(2049)), valid: true },
  { name: 'astral secret 65', payload: delivered(undefined, '😀'.repeat(65)), valid: true },
  { name: 'astral error 2001', payload: failed('😀'.repeat(2001)), valid: true },
  { name: 'target 4097 code points', payload: delivered('😀'.repeat(4097)), valid: false },
  { name: 'ASCII target overflow', payload: delivered('t'.repeat(4097)), valid: false },
  { name: 'ASCII secret overflow', payload: delivered(undefined, 's'.repeat(129)), valid: false },
  { name: 'ASCII error overflow', payload: failed('e'.repeat(4001)), valid: false },
  { name: 'NUL target overflow', payload: delivered('a\0' + 't'.repeat(4096)), valid: false },
  {
    name: 'NUL secret overflow',
    payload: delivered(undefined, 'a\0' + 's'.repeat(128)),
    valid: false,
  },
  { name: 'NUL error overflow', payload: failed('a\0' + 'e'.repeat(4000)), valid: false },
  { name: 'invalid URL', payload: delivered(undefined, undefined, 'not-a-url'), valid: false },
  { name: 'numeric target', payload: delivered(17), valid: false },
  { name: 'unknown evidence', payload: { channel, unexpectedEvidence: 'keep' }, valid: false },
];

beforeEach(async () => {
  handle = await openMemoryDatabase();
  // Restore a pre-0015 ledger prefix; remove the later index before both migrations replay.
  await handle.client.execute('DROP INDEX runs_loop_owner_history_idx');
  // A pre-0015 fixture must not retain the later targeted Event ledger.
  await handle.client.execute('DROP TABLE event_receipts');
  await handle.client.execute('DROP INDEX run_events_gate_idx');
  await handle.client.execute('DROP INDEX run_events_fresh_session_idx');

  await handle.client.execute('ALTER TABLE runs DROP COLUMN thread_snapshot_replay_state');
  await handle.client.execute('DELETE FROM __drizzle_migrations WHERE created_at>=1792454400000');
});
afterEach(() => handle.close());

async function insert(payload: unknown, type = 'return.delivered') {
  await handle.client.execute({
    sql: 'INSERT INTO run_events (run_id,seq,ts,type,payload) VALUES (?,1,?,?,?)',
    args: [runId, FIXTURE_TS, type, JSON.stringify(payload)],
  });
  return (await handle.client.execute('SELECT * FROM run_events')).rows;
}

it.each(cases)('frozen receipt contract: $name', async ({ payload, valid }) => {
  const type = 'error' in payload ? 'return.failed' : 'return.delivered';
  const before = await insert(payload, type);
  await handle.migrate();
  const after = (await handle.client.execute('SELECT * FROM run_events')).rows;
  if (!valid) {
    expect(after, 'An invalid historical receipt must remain byte-identical').toEqual(before);
  } else {
    expect(after[0]?.['type']).toBe('delivery.finished');
    const storedPayload = after[0]?.['payload'];
    if (typeof storedPayload !== 'string') throw new Error('Expected stored JSON text');
    expect(JSON.parse(storedPayload)).toMatchObject({ delivery: { channel: payload.channel } });
    expect(
      RunEventSchema.safeParse({
        runId,
        seq: 1,
        ts: FIXTURE_TS,
        type: 'delivery.finished',
        ...JSON.parse(storedPayload),
      }).success,
      'Every converted row must validate against the current event contract',
    ).toBe(true);
  }
  await handle.migrate();
  expect((await handle.client.execute('SELECT * FROM run_events')).rows).toEqual(after);
});

it('commits receipt conversion, structure and migration ledger atomically', async () => {
  const before = await insert(delivered());
  await handle.client.execute('DROP INDEX run_events_delivery_idx');
  await handle.client
    .execute(`CREATE TRIGGER fail_receipt_upgrade BEFORE INSERT ON __drizzle_migrations
    WHEN NEW.created_at=1792454400000 BEGIN SELECT RAISE(ABORT, 'injected migration failure'); END`);
  await expect(handle.migrate()).rejects.toThrow('injected migration failure');
  expect((await handle.client.execute('SELECT * FROM run_events')).rows).toEqual(before);
  expect((await handle.client.execute('SELECT * FROM __drizzle_migrations')).rows).toHaveLength(15);
  expect(
    (
      await handle.client.execute(
        "SELECT name FROM sqlite_master WHERE name='run_events_delivery_idx'",
      )
    ).rows,
  ).toEqual([]);
  await handle.client.execute('DROP TRIGGER fail_receipt_upgrade');
  await handle.migrate();
  expect((await handle.client.execute('SELECT type FROM run_events')).rows[0]?.['type']).toBe(
    'delivery.finished',
  );
});

it.each([
  { name: 'invalid JSON', payload: '{broken', nodeId: null },
  {
    name: 'invalid envelope timestamp',
    payload: JSON.stringify(delivered()),
    nodeId: null,
    ts: 'bad',
  },
  {
    name: 'unexpected envelope field',
    payload: JSON.stringify({ ...delivered(), seq: 17 }),
    nodeId: null,
  },
  { name: 'unexpected node id', payload: JSON.stringify(delivered()), nodeId: 'done' },
])('preserves damaged receipt $name', async ({ payload, nodeId, ...options }) => {
  await handle.client.execute({
    sql: 'INSERT INTO run_events (run_id,seq,ts,type,node_id,payload) VALUES (?,1,?,?,?,?)',
    args: [runId, 'ts' in options ? options.ts : FIXTURE_TS, 'return.delivered', nodeId, payload],
  });
  const before = (await handle.client.execute('SELECT * FROM run_events')).rows;
  await handle.migrate();
  expect((await handle.client.execute('SELECT * FROM run_events')).rows).toEqual(before);
});

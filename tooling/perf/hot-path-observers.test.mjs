import { test } from 'vitest';
import assert from 'node:assert/strict';
import { equivalence } from './equivalence.mjs';
import { observeAppendClient } from './append-observer.mjs';

test('equivalence ignores observed clocks and consistently renames generated identities, preserving payloads', () => {
  function result(id, time, payload = [1, 2]) {
    const capture = equivalence();
    capture.event({
      runId: id,
      ts: time,
      seq: 1,
      type: 'node.finished',
      durationMs: time,
      patch: payload,
    });
    return capture.finish(
      { run: { id }, vars: { payload } },
      { status: 'succeeded', result: payload },
    );
  }
  const a = result('01K00000000000000000000000', 1);
  assert.deepEqual(a, result('01K11111111111111111111111', 2));
  assert.notDeepEqual(a, result('01K11111111111111111111111', 2, [2, 1]));
});

test('append observer measures the supplied client and transaction without changing arguments or results', async () => {
  const calls = [];
  const tx = {
    async execute(statement) {
      calls.push(statement);
      return { rows: [statement] };
    },
    async commit() {
      calls.push('commit');
    },
    close() {
      calls.push('close');
    },
  };
  const client = {
    async transaction(mode) {
      calls.push(mode);
      return tx;
    },
    name: 'client',
  };
  const observed = observeAppendClient(client);
  const transaction = await observed.client.transaction('write');
  assert.deepEqual(await transaction.execute({ sql: 'select coalesce(max(seq), 0)' }), {
    rows: [{ sql: 'select coalesce(max(seq), 0)' }],
  });
  await transaction.execute('insert into events values (1)');
  await transaction.execute('update runs set seq = 1');
  await transaction.commit();
  transaction.close();
  assert.equal(observed.client.name, 'client');
  const spans = observed.summary();
  for (const key of [
    'client.begin',
    'transaction.sequenceLookup',
    'transaction.insert',
    'transaction.runSequenceUpdate',
    'transaction.commit',
  ])
    assert.equal(spans[key].count, 1);
  assert.equal(calls.length, 6);
  observed.reset();
  assert.deepEqual(observed.summary(), {});
});

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openReadOnlyDatabaseClient } from '../../../packages/infrastructure/dist/sqlite/index.js';
const out = fileURLToPath(new URL('./', import.meta.url));
const load = async (f) => JSON.parse(await readFile(join(out, f), 'utf8'));
const matrix = await load('results.json');
const data = join(tmpdir(), matrix.data.split('/').at(-1));
const auth = JSON.parse(await readFile(join(data, 'browser-state.json'), 'utf8'));
const client = openReadOnlyDatabaseClient(join(data, 'graphgoblin.db'));
const result = { checks: [], sources: [], negative: [] };
function check(name, fn) {
  try {
    fn();
    result.checks.push({ name, status: 'PASS' });
  } catch (e) {
    result.checks.push({ name, status: 'FAIL', error: e.message });
  }
}
async function response(path, options = {}) {
  const r = await fetch(auth.origin + path, {
    headers: { authorization: `Bearer ${auth.key}`, ...options.headers },
    ...options,
  });
  const text = await r.text();
  return { status: r.status, text };
}
try {
  for (const [name, file] of [
    [
      'original terminal source after all forks/restarts/extra-field replay',
      'first-after-trigger-source-bytes.json',
    ],
    ['failed source across active fork crash and restart', 'failed-source-source-bytes.json'],
  ]) {
    const original = await load(file);
    const id = original.sourceId;
    const run = await client.execute({ sql: 'SELECT * FROM runs WHERE id=?', args: [id] });
    const events = await client.execute({
      sql: 'SELECT * FROM run_events WHERE run_id=? ORDER BY seq',
      args: [id],
    });
    const after = {
      record: (await response(`/runs/${id}`)).text,
      events: (await response(`/runs/${id}/events?limit=1000`)).text,
      thread: (await response(`/runs/${id}/thread`)).text,
      sqlite: JSON.stringify({ run: run.rows, events: events.rows }),
    };
    check(name + ': byte-for-byte unchanged', () => assert.deepEqual(after, original.before));
    result.sources.push({ name, sourceId: id, before: original.before, after });
  }
  for (const [label, path, options, expected] of [
    [
      'unauthenticated replay',
      `/runs/${matrix.browser.primaryId}/replay`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"nodeId":"append"}',
      },
      401,
    ],
    [
      'malformed JSON',
      `/runs/${matrix.browser.primaryId}/replay`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${auth.key}`, 'content-type': 'application/json' },
        body: '{',
      },
      400,
    ],
    [
      'empty node',
      `/runs/${matrix.browser.primaryId}/replay`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${auth.key}`, 'content-type': 'application/json' },
        body: '{"nodeId":""}',
      },
      400,
    ],
    ['unknown current-thread ID', '/runs/01ARZ3NDEKTSV4RRFFQ69G5FAV/thread', {}, 404],
  ]) {
    const actual = await response(path, options);
    result.negative.push({ label, status: actual.status, body: JSON.parse(actual.text) });
    check(label, () => assert.equal(actual.status, expected));
  }
} finally {
  client.close();
}
await writeFile(join(out, 'supplement-results.json'), JSON.stringify(result, null, 2));
process.stdout.write(JSON.stringify(result.checks) + '\n');

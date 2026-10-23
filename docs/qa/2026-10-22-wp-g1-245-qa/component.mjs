import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialThreadFrom, tryThreadAt } from '../../../apps/web/src/runs/projections.ts';
const out = fileURLToPath(new URL('./', import.meta.url));
const load = async (n) => JSON.parse(await readFile(join(out, n + '.json'), 'utf8'));
const g = await load('gate-pass-1');
const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, status: 'PASS' });
  } catch (e) {
    results.push({ name, status: 'FAIL', error: e.message });
  }
}
const original = JSON.stringify({ seed: g.storedSeed, events: g.events, current: g.current });
const wrongCurrent = structuredClone(g.current);
wrongCurrent.vars = { wrong: true };
wrongCurrent.counters.nodeVisits = { wrong: 999 };
const initial = initialThreadFrom(wrongCurrent, g.events);
check('recorded seed takes precedence over incorrect current values', () =>
  assert.deepEqual(initial, g.storedSeed),
);
for (const e of g.events) tryThreadAt(initial, g.events, e.seq);
check('projection never mutates seed, event patches or current fixture', () =>
  assert.equal(
    JSON.stringify({ seed: g.storedSeed, events: g.events, current: g.current }),
    original,
  ),
);
const corrupt = [
  ...g.events.slice(0, 3),
  {
    ...g.events[4],
    type: 'node.finished',
    nodeId: 'gate',
    patch: [{ op: 'replace', path: '/vars/nonexistent/child', value: 1 }],
  },
];
const failure = tryThreadAt(initial, corrupt, 999);
check('malformed recorded patch returns an explanation', () => {
  assert.equal(failure.ok, false);
  assert.ok(failure.error.includes('nonexistent'));
});
const iterationSeed = structuredClone(initial);
iterationSeed.run.iteration = 7;
const historical = tryThreadAt(
  iterationSeed,
  [{ type: 'iteration.incremented', seq: 1, to: 8 }],
  1,
);
check('synthetic historical iteration increments preserve seeded visits', () => {
  assert.equal(historical.thread.run.iteration, 8);
  assert.deepEqual(historical.thread.counters, iterationSeed.counters);
});
const c1 = await load('concurrent-1');
const c2 = await load('concurrent-2');
for (const field of ['vars', 'counters', 'gates'])
  check('concurrent independent fork values: ' + field, () =>
    assert.deepEqual(c1.current[field], c2.current[field]),
  );
check('concurrent forks retain identical inherited trigger output', () =>
  assert.deepEqual(c1.current.outputs.start, c2.current.outputs.start),
);
check('concurrent decision values agree apart from measured elapsed time', () => {
  const decision = (c) => {
    const value = structuredClone(c.current.outputs.gate.value);
    delete value.gate.elapsedSeconds;
    return value;
  };
  assert.deepEqual(decision(c1), decision(c2));
});
check('concurrent fork messages have equal semantic content and distinct generated IDs', () => {
  const semantic = (c) =>
    c.current.messages.map((m) => ({ role: m.role, content: m.content, nodeId: m.nodeId }));
  assert.deepEqual(semantic(c1), semantic(c2));
  assert.notEqual(c1.current.messages.at(-1).id, c2.current.messages.at(-1).id);
});
await writeFile(
  join(out, 'component-results.json'),
  JSON.stringify(
    {
      evidenceTier: 'supported projection component; historical iteration is synthetic',
      checks: results,
      malformedPatchResult: failure,
    },
    null,
    2,
  ),
);
process.stdout.write(JSON.stringify(results) + '\n');

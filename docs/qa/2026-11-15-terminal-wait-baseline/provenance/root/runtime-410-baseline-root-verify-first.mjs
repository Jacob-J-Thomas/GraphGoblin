import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const root = process.cwd();
const evidence = join(root, 'runtime-410-native-preparation/evidence-baseline-review-02');
const launch = join(root, 'runtime-410-launch-execution-baseline-review-02');
const read = async (path) => JSON.parse(await readFile(path, 'utf8'));
const sha = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');
const s = await read(join(evidence, 'summary.json'));
const result = await read(join(launch, 'launch-result.json'));
const exit = await read(join(launch, 'child-exit.json'));
assert.equal(exit.exitCode, 0);
assert.equal(exit.deadlineExpired, false);
assert.equal(result.wrapperStatus, 'matrix-finished-for-review');
assert.equal(s.result, 'assertions-met');
for (const [name, hash] of Object.entries(result.evidenceSha256)) assert.equal(await sha(join(evidence, name)), hash);
for (const item of [s.W1, s.W2]) {
  assert.equal(item.after.parent.raw.row.status, 'failed');
  assert.ok(item.after.parent.raw.row.finalized_at);
  assert.equal(item.after.parent.raw.row.waiting, item.before.parent.raw.row.waiting);
  assert.deepEqual(item.after.parent.rest.waiting, JSON.parse(item.after.parent.raw.row.waiting));
  assert.equal(item.after.parent.raw.events.filter(e => e.type === 'run.failed').length, 1);
}
assert.equal(s.W2.gate.delegateEntered, false);
assert.equal(s.W2.gate.ownsWaitingMember, false);
assert.equal(s.W2.landing.parent.row.status, 'running');
assert.equal(s.W2.landing.parent.row.finalized_at, null);
assert.deepEqual(s.W2.after.parent.raw.events, s.W2.landing.parent.events);
assert.deepEqual(s.W2.after.rawChild, s.W2.landing.child);
assert.deepEqual(s.W2.interrupted, { code: null, signal: 'SIGKILL' });
assert.deepEqual(s.W4.after.parent.raw, s.W1.after.parent.raw);
assert.deepEqual(s.W4.after.rawChild, s.W1.after.rawChild);
assert.deepEqual(s.W3.activeAfterOtherRuns, s.W3.activeBefore);
for (const pair of [s.W3.successAfter, s.W3.cancelled]) {
  assert.equal(pair.parent.raw.row.waiting, null);
  assert.equal(pair.rawChild.row.waiting, null);
}
assert.deepEqual(s.remaining, { writers: [], mcp: [], observers: 0 });
for (const c of Object.values(s.cleanup)) { assert.equal(c.empty, true); assert.deepEqual(await readdir(c.path), []); }
const d = s.cleanup.live.seedDerivation;
assert.deepEqual(d.checkpoint, { busy: 0, log: 0, checkpointed: 0 });
assert.equal(d.journalMode, 'delete');
assert.equal(d.exactRawWitness, true);
assert.deepEqual(d.helper.exit, { code: 0, signal: null });
assert.deepEqual(d.helper.close, d.helper.exit);
assert.deepEqual(await readdir(d.stage), []);
for (const input of d.inputs) assert.equal(input.sha256, input.copySha256);
assert.equal(await sha(s.cleanup.live.seed.database), s.cleanup.live.seed.sha256);
const output = { at: new Date().toISOString(), state: 'baseline-offline-readback-passed', summarySha256: await sha(join(evidence, 'summary.json')), W1: 'stale wait confirmed', W2: 'committed failure before projection; one unchanged terminal event after same-store restart; stale wait confirmed', W3: 'active row/event preservation and successful/cancelled clear waits', W4: 'baseline terminal parent/child rows and events unchanged after restart', seed: s.cleanup.live.seed, seedDerivation: 'closed bundle copy hashes matched; bounded helper checkpointed copy and exact raw witness matched', remaining: s.remaining, wrapperResultSha256: await sha(join(launch, 'launch-result.json')) };
await writeFile(join(root, 'runtime-410-baseline-root-offline-readback.json'), JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify(output) + '\n');

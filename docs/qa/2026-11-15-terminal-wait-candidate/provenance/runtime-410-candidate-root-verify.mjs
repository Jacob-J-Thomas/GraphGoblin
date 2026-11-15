import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const root = process.cwd();
const evidence = join(root, 'runtime-410-native-preparation/evidence-candidate-review-01');
const launch = join(root, 'runtime-410-launch-execution-candidate-review-01');
const read = async (path) => JSON.parse(await readFile(path, 'utf8'));
const sha = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');
const s = await read(join(evidence, 'summary.json'));
const baseline = await read(join(root, 'runtime-410-native-preparation/evidence-baseline-review-02/summary.json'));
const result = await read(join(launch, 'launch-result.json'));
const exit = await read(join(launch, 'child-exit.json'));
assert.equal(exit.exitCode, 0);
assert.equal(exit.deadlineExpired, false);
assert.equal(result.wrapperStatus, 'matrix-finished-for-review');
assert.equal(s.phase, 'candidate');
assert.equal(s.result, 'assertions-met');
assert.equal(result.closingBuild.head, '4e4501bd92953794bb733a746f7c24d1bcc2452a');
for (const [name, hash] of Object.entries(result.evidenceSha256)) assert.equal(await sha(join(evidence, name)), hash);
for (const item of [s.W1, s.W2]) {
  const after = item.after.parent;
  assert.equal(after.raw.row.status, 'failed');
  assert.ok(after.raw.row.finalized_at);
  assert.ok(item.before.parent.raw.row.waiting);
  assert.equal(after.raw.row.waiting, null);
  const restList = after.restPages.flatMap(p => p.items).find(r => r.id === after.raw.row.id);
  const mcpList = after.mcpPages.flatMap(p => p.items).find(r => r.id === after.raw.row.id);
  for (const projection of [after.rest, after.mcpGet.structuredContent, restList, mcpList]) {
    assert.ok(projection);
    assert.equal(projection.status, 'failed');
    assert.equal(Object.hasOwn(projection, 'waiting'), false);
  }
  const terminal = after.raw.events.filter(e => e.type === 'run.failed');
  assert.equal(terminal.length, 1);
  assert.deepEqual(JSON.parse(after.raw.row.failure), after.rest.failure);
}
assert.equal(s.W2.gate.delegateEntered, false);
assert.equal(s.W2.gate.ownsWaitingMember, true);
assert.equal(s.W2.landing.parent.row.status, 'running');
assert.equal(s.W2.landing.parent.row.finalized_at, null);
assert.deepEqual(s.W2.after.parent.raw.events, s.W2.landing.parent.events);
assert.deepEqual(s.W2.after.rawChild, s.W2.landing.child);
assert.deepEqual(s.W2.interrupted, { code: null, signal: 'SIGKILL' });
assert.deepEqual(s.W4.after.parent.raw, baseline.W1.after.parent.raw);
assert.deepEqual(s.W4.after.rawChild, baseline.W1.after.rawChild);
assert.ok(s.W4.after.parent.raw.row.waiting);
assert.deepEqual(s.W3.activeAfterOtherRuns.parent.raw, s.W3.activeBefore.parent.raw);
assert.deepEqual(s.W3.activeAfterOtherRuns.rawChild, s.W3.activeBefore.rawChild);
for (const pair of [s.W3.successAfter, s.W3.cancelled]) {
  assert.equal(pair.parent.raw.row.waiting, null);
  assert.equal(pair.rawChild.row.waiting, null);
}
assert.deepEqual(s.remaining, { writers: [], mcp: [], observers: 0 });
for (const c of Object.values(s.cleanup)) { assert.equal(c.empty, true); assert.deepEqual(await readdir(c.path), []); }
assert.equal(await sha(baseline.cleanup.live.seed.database), baseline.cleanup.live.seed.sha256);
const output = { at: new Date().toISOString(), state: 'candidate-offline-readback-passed', head: result.closingBuild.head, summarySha256: await sha(join(evidence, 'summary.json')), W1: 'SQL NULL, REST/MCP get/list omit wait, one typed failure', W2: 'committed failure before projection; one unchanged terminal event after same-store restart; SQL NULL and REST/MCP omit wait', W3: 'active raw rows/events preserved; successful/cancelled waits clear', W4: 'original baseline terminal parent/child rows/events and stale wait unchanged after restart', seedSha256: baseline.cleanup.live.seed.sha256, remaining: s.remaining, wrapperResultSha256: await sha(join(launch, 'launch-result.json')) };
await writeFile(join(root, 'runtime-410-candidate-root-offline-readback.json'), JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify(output) + '\n');

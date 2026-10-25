// Run from the worktree root after pnpm build, with Node 22:
// node docs/qa/2026-10-23-wp-f3-270/real-adapter-check.mjs
// Uses the installed subscription login. Never targets an existing API or store.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, access, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
if (process.env.GG_WP_F3_270_CHILD !== '1') {
  // Evaluate in the API package so workspace dependencies resolve through their public exports.
  const child = spawn(process.execPath, ['--input-type=module'], {
    cwd: fileURLToPath(new URL('../../../apps/api/', import.meta.url)),
    env: { ...process.env, GG_WP_F3_270_CHILD: '1' }, stdio: ['pipe', 'inherit', 'inherit'],
  });
  child.stdin.end(await readFile(new URL(import.meta.url), 'utf8'));
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('exit', (code) => resolve(code ?? 2));
  });
} else {
const { CodexHarness, CodexStructured } = await import('@graphgoblin/adapter-codex');
const { createTestEngine, singleNodeLoop } = await import('@graphgoblin/engine/testing');
const model = process.env.GG_QA_MODEL ?? 'gpt-6-luna';
const scratch = [];
const sessions = [];
const native = new CodexHarness({ model, effort: 'low',
  ...(process.env.GG_CODEX_BINARY ? { codexBinary: process.env.GG_CODEX_BINARY } : {}),
});
function observed(session, signal) {
  const row = { signal, settled: false }; sessions.push(row);
  void session.result.then(() => { row.settled = true; }, () => { row.settled = true; });
  return session;
}
const harness = { id: native.id, preflight: () => native.preflight(),
  start: (request, signal) => observed(native.start(request, signal), signal),
  resume: (id, request, signal) => observed(native.resume(id, request, signal), signal),
};
const adapter = new CodexStructured(harness, { tempDir: async () => {
  const path = await mkdtemp(join(tmpdir(), 'gg-wp-f3-270-'));
  const row = { path, cleaned: false }; scratch.push(row);
  return { path, cleanup: async () => { await rm(path, { recursive: true, force: true }); row.cleaned = true; } };
} });
const e = await createTestEngine({ maxConcurrentRuns: 1 });
e.ports.structured = adapter;
// Explicit QA watchdog only: caps the entire two-turn validation at two minutes.
const watchdog = setTimeout(() => { console.error('QA watchdog exceeded 120000 ms'); process.exit(2); }, 120_000);
async function run(name, deadline, prompt) {
  const def = singleNodeLoop(name, { id: 'repair', kind: 'mutate', label: 'Real Codex completion', config: {
    operations: [{ op: 'coerce', source: '/vars/value', target: '/vars/value', jsonSchema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'], additionalProperties: false },
      repair: { enabled: true, maxAttempts: 1, prompt } }],
  } });
  def.settings = { structuredTimeoutMs: deadline };
  const started = Date.now();
  const final = await e.runToIdle(e.publish(def).loopId);
  console.log(JSON.stringify({ name, model, deadlineMs: deadline, durationMs: Date.now()-started,
    status: final.status, code: final.failure?.code ?? null }));
  return final;
}
try {
  const timed = await run('Real adapter short deadline', 100,
    'Think carefully about a long mathematical proof, then return only the JSON object {"value":7}. Do not use tools.');
  assert.equal(timed.failure?.code, 'STRUCTURED_COMPLETION_TIMEOUT');
  // Engine slots settle immediately; adapter process cancellation/cleanup completes separately.
  const cleanupBy = Date.now() + 10_000;
  while ((scratch.length === 0 || !scratch.every((row) => row.cleaned) || !sessions.every((row) => row.settled)) && Date.now() < cleanupBy)
    await new Promise((resolve) => setTimeout(resolve, 25));
  assert.ok(scratch.length > 0 && scratch.every((row) => row.cleaned), 'timeout scratch cleanup did not finish');
  assert.ok(sessions.length > 0 && sessions.every((row) => row.settled && row.signal.aborted), 'native SDK result did not settle after abort');
  const fast = await run('Real adapter ordinary completion', 60_000,
    'Return only the JSON object {"value":7} immediately. Do not use tools or explain.');
  assert.equal(fast.status, 'succeeded', `real completion failed: ${fast.failure?.code}`);
  assert.deepEqual((await e.manager.getThread(fast.id))?.vars.value, { value: 7 });
  assert.ok(scratch.every((row) => row.cleaned));
  for (const row of scratch) await assert.rejects(access(row.path));
  console.log(JSON.stringify({ result: 'PASS', cleanedDirectories: scratch.length,
    lateResults: e.ports.logger.lines.filter((row) => row.msg === 'late structured completion discarded').length,
    evidence: 'real Codex adapter and CLI; original SDK session result settled after abort and scratch cleanup finished; no PID tree inventory' }));
} finally {
  clearTimeout(watchdog);
  e.manager.stop();
  for (const candidate of await e.ports.runs.listRecoveryCandidates()) {
    const record = await e.ports.runs.get(candidate.id);
    if (record && ['queued','running','waiting','paused'].includes(record.status)) await e.manager.cancel(record.id);
  }
  await e.manager.waitForIdle();
}

}

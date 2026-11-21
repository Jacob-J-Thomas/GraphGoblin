// D4c B17 (SYNTHETIC-SEAM): a pure canonical-rerender fault after the context-window callback.
// Expected: engine-owned INTERNAL_ERROR safe copy, resumable true, node respond, no harness.turn/start,
// marker absent publicly. Control in the same process with the seam disarmed: trim succeeds.
import { register } from 'node:module';
register(new URL('./lib/b17-hooks.mjs', import.meta.url).href);
const { randomUUID } = await import('node:crypto');
const { writeFileSync } = await import('node:fs');
const { join } = await import('node:path');
const { OUT, recorder, containsAny } = await import('./lib/rec.mjs');
const { boot, domain, countType } = await import('./lib/boot.mjs');

const r = recorder('d4c');
const t = await boot({ name: 'd4c', port: 5876 });
const H = () => t.harness.codex;
r.raw('resources', { driverPid: process.pid, apiPort: 5876, dataDir: t.dataDir, seam: 'resolve hook: engine handlers/inference-context.js -> b17-shim.mjs' });
const def = domain.createSystemChatDefinition({ name: 'qa b17 seam chat', harness: 'codex' });
const p = await t.publish(def);
const input = () => ({ protocol: 'graphgoblin.chat.v1', conversationId: '01M7ZG0000000000000000QA17', requestId: randomUUID(), turn: 3, history: [{ role: 'user', text: 'QA-OLDEST-PAIR user' }, { role: 'assistant', text: 'QA-OLDEST-PAIR assistant' }, { role: 'user', text: 'recent user text' }, { role: 'assistant', text: 'recent assistant text' }], input: { kind: 'text', text: 'current message' } });
const cw = () => Promise.resolve({ contextTokens: 1000, outputReserveTokens: 100, profile: 'qa-window', fits: (prompt) => !prompt.includes('QA-OLDEST-PAIR') });
if (!p.ok) r.check('B17-setup', 'system chat definition publishes', false, p.published?.json, 'SETUP');
else {
  // Fault
  H().reset(); H().contextWindowImpl = cw;
  globalThis.__QA486_B17 = true; globalThis.__QA486_B17_CALLS = 0;
  const res = await t.run(p.loopId, input());
  globalThis.__QA486_B17 = false;
  const evs = await t.events(res.id);
  const f = res.snapshot.failure;
  r.check('B17', 'canonical rerender fault -> engine-owned INTERNAL_ERROR safe message, resumable true, node respond, after contextWindow, no harness.turn/start, marker absent', f?.code === 'INTERNAL_ERROR' && f?.message === 'An unexpected error interrupted the run. See the server logs for this run.' && f?.resumable === true && f?.nodeId === 'respond' && H().counters.contextWindow === 1 && H().counters.starts === 0 && countType(evs, 'harness.turn') === 0 && containsAny([f, evs], ['QA486-EXT-B17']).length === 0 && globalThis.__QA486_B17_CALLS >= 1, { failure: f, cw: H().counters.contextWindow, starts: H().counters.starts, seamCalls: globalThis.__QA486_B17_CALLS }, 'SYNTHETIC-SEAM');
  const row = await t.container.repos.runs.get(res.id);
  const failed = evs.filter((e) => e.type === 'run.failed');
  r.check('B17-parity', 'row == run.failed == REST', failed.length === 1 && JSON.stringify(row.failure) === JSON.stringify(failed[0].failure) && JSON.stringify(failed[0].failure) === JSON.stringify(f), { row: row.failure }, 'SYNTHETIC-SEAM');
  // Resume (ordinary pre-turn internal eligibility) with seam disarmed -> trims and succeeds.
  H().reset(); H().contextWindowImpl = cw;
  const resume = await t.rest('POST', `/runs/${res.id}/resume`, { observedSeq: res.snapshot.recovery?.observedSeq ?? 0 });
  const done = await t.settle(res.id, ['succeeded', 'failed']);
  r.check('B17-resume', 'Resume allowed; with the seam disarmed the canonical trim succeeds (one start)', res.snapshot.recovery?.resume?.allowed === true && resume.status === 200 && done.status === 'succeeded' && H().counters.starts === 1, { allowed: res.snapshot.recovery?.resume, resume: resume.status, status: done.status, failure: done.failure }, 'SYNTHETIC-SEAM');
}
writeFileSync(join(OUT, 'd4c.logger.json'), JSON.stringify(t.logger.lines, null, 1));
const shut = await t.shutdown();
r.check('CLEANUP', 'authenticated drain accepted; port refuses', shut.drainStatus === 202 && shut.portRefused === true, shut, 'CLEANUP');
r.finish({ driverPid: process.pid, apiPort: 5876, dataDir: t.dataDir });
process.exit(0);

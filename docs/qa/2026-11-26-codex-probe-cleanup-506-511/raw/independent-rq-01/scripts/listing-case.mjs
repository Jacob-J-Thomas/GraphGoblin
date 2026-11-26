// One independent QA case for the per-turn MCP listing (#506, review-1 R2 wording). Usage:
//   node --experimental-transform-types --import ./register.mjs listing-case.mjs \
//     <case-id> <scenario: listing-hang|listing-unconfirmed> <mode: cancel|deadline> <listingTimeoutMs> [cancelGraceMs] [holdMs]
// Drives HEAD's public createCodexHarness().start() with the QA fake CLI as codexBinary. The fake
// refuses (and records) any turn command; CODEX_HOME points to an unused path. Fixtures live under
// G:/ggq/tmp/506-511-qa/runs/<case-id>-*, which the case removes after its helpers have ended.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [caseId, scenario, mode, timeoutArg, graceArg = '', holdArg = '8000'] = process.argv.slice(2);
const WT = 'G:/ggq/gg-fu-codex-cleanup-20261124/GraphGoblin/';
const RUNS = 'G:/ggq/tmp/506-511-qa/runs';
const FAKE = 'G:/ggq/tmp/506-511-qa/scripts/fake-codex.mjs';
const holdMs = Number(holdArg);

const root = mkdtempSync(join(RUNS, `${caseId}-`));
const work = join(root, 'work');
const state = join(root, 'state');
const temp = join(root, 'temp');
for (const d of [work, state, temp]) mkdirSync(d);
for (const name of ['TEMP', 'TMP', 'TMPDIR']) process.env[name] = temp;
const env = {
  ...process.env,
  GG_QA_SCENARIO: scenario,
  GG_QA_STATE: state,
  GG_QA_HOLD_MS: String(holdMs),
  CODEX_HOME: join(root, 'unused-codex-home'),
};
delete env.NODE_OPTIONS;

const events = (globalThis.__qaEvents ??= []);
const t0 = performance.now();
const rel = (at) => Math.round((at - t0) * 10) / 10;
const warnings = [];
const logger = { debug() {}, info() {}, error() {}, warn: (obj, msg) => warnings.push({ obj, msg }) };

const { createCodexHarness } = await import(pathToFileURL(WT + 'packages/adapter-codex/src/index.ts').href);
const harness = createCodexHarness({
  codexBinary: FAKE,
  preflightTimeoutMs: Number(timeoutArg),
  env,
  logger,
  ...(graceArg ? { cancelGraceMs: Number(graceArg) } : {}),
});
const request = {
  workingDirectory: work,
  model: 'gpt-6-luna',
  effort: 'low',
  options: { sandbox: 'read-only', approval: 'never' },
  turn: { prompt: 'QA fixture; no provider call' },
};
const session = harness.start(request, new AbortController().signal);
const outcome = (p) =>
  p.then(
    () => ({ status: 'fulfilled', at: rel(performance.now()) }),
    (e) => ({ status: 'rejected', at: rel(performance.now()), name: e?.name, code: e?.code, message: e?.message, retriable: e?.retriable, submission: e?.submission }),
  );
const resultOutcome = outcome(session.result);

// Wait until the listing process has announced itself on stderr.
const until = Date.now() + 15000;
while (!events.some((e) => e.kind === 'stderr-first') && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
const announcedAt = events.find((e) => e.kind === 'stderr-first');
// For the unconfirmed scenario, also wait for its grandchild to be running.
if (scenario === 'listing-unconfirmed') {
  const g = Date.now() + 5000;
  while (!existsSync(join(state, 'listing-grandchild.pid')) && Date.now() < g) await new Promise((r) => setTimeout(r, 50));
}

let cancelOutcome;
let cancelAt;
if (mode === 'cancel') {
  cancelAt = rel(performance.now());
  cancelOutcome = await outcome(session.cancel());
}
const result = await resultOutcome;
const drained = [];
for await (const event of session.events) drained.push(event);

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const pids = () => readdirSync(state).filter((n) => n.endsWith('.pid')).map((n) => ({ name: n, pid: Number(readFileSync(join(state, n), 'utf8')) }));
const helpersAtSettle = pids().map((h) => ({ ...h, alive: alive(h.pid) }));
const deadline = Date.now() + holdMs + 6000;
while (pids().some((h) => alive(h.pid)) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
await new Promise((r) => setTimeout(r, 300));

const reported = JSON.stringify({ result, cancelOutcome, drained, warnings });
const record = {
  caseId,
  scenario,
  mode,
  listingTimeoutMs: Number(timeoutArg),
  cancelGraceMs: graceArg ? Number(graceArg) : 'default',
  node: process.version,
  announcedAt: announcedAt ? rel(announcedAt.at) : null,
  cancelAt,
  cancelOutcome,
  result,
  settleAfterCancelMs: cancelAt !== undefined ? Math.round(result.at - cancelAt) : undefined,
  drainedEvents: drained,
  warnings,
  spawnCount: events.filter((e) => e.kind === 'spawn').length,
  events: events.map((e) => ({ ...e, at: rel(e.at) })),
  helpersAtSettle,
  helpersAliveAfterWait: pids().filter((h) => alive(h.pid)).map((h) => h.name),
  turnAttempt: existsSync(join(state, 'turn-attempt.json')),
  leaks: ['PRIVATE_LISTING_CANARY', 'G:\\\\ggq', 'G:/ggq', 'fake-codex'].filter((t) => reported.includes(t)),
};
writeFileSync(join(RUNS, `${caseId}.record.json`), JSON.stringify(record, null, 2));
console.log(JSON.stringify(record, null, 2));
if (!record.helpersAliveAfterWait.length) rmSync(root, { recursive: true, force: true, maxRetries: 5 });
console.log('CASE_ROOT_REMOVED', !existsSync(root));

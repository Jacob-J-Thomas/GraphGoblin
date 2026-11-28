// One independent QA preflight case (#506). Usage:
//   node --experimental-transform-types --import ./register.mjs preflight-case.mjs \
//     <case-id> <source: head|babb335c|4e1037c9> <scenario> <timeoutMs> [holdMs] [binary: fake|missing]
// HEAD is driven through the package's public createCodexHarness().preflight(); an older revision
// (a labelled red control) through its own cli.ts preflightCli + runCli, byte-identical to Git.
// Everything is created under G:/ggq/tmp/506-511-qa/runs/<case-id>-*; the case removes only that.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [caseId, source, scenario, timeoutArg, holdArg = '8000', binaryKind = 'fake'] = process.argv.slice(2);
const timeoutMs = Number(timeoutArg);
const holdMs = Number(holdArg);
const WT = 'G:/ggq/gg-fu-codex-cleanup-20261124/GraphGoblin/';
const RUNS = 'G:/ggq/tmp/506-511-qa/runs';
const FAKE = 'G:/ggq/tmp/506-511-qa/scripts/fake-codex.mjs';

mkdirSync(RUNS, { recursive: true });
const root = mkdtempSync(join(RUNS, `${caseId}-`));
let temp = join(root, 'temp');
const state = join(root, 'state');
mkdirSync(temp);
mkdirSync(state);
// A case id containing "long" runs under a 226-character TEMP root (the #363/#466 boundary).
if (caseId.includes('long')) {
  while (temp.length < 226 - 21) temp = join(temp, 'segment-abcdefghij');
  temp = join(temp, 'x'.repeat(226 - temp.length - 1));
  mkdirSync(temp, { recursive: true });
}
for (const name of ['TEMP', 'TMP', 'TMPDIR']) process.env[name] = temp;

const events = (globalThis.__qaEvents ??= []);
const t0 = performance.now();
const rel = (at) => Math.round((at - t0) * 10) / 10;

const env = {
  ...process.env,
  GG_QA_SCENARIO: scenario,
  GG_QA_STATE: state,
  GG_QA_HOLD_MS: String(holdMs),
  CODEX_HOME: join(root, 'unused-codex-home'),
};
delete env.NODE_OPTIONS;
const binary = binaryKind === 'missing' ? join(root, 'graphgoblin-no-such-codex.exe') : FAKE;

let result;
const started = performance.now();
if (source === 'head') {
  const { createCodexHarness } = await import(pathToFileURL(WT + 'packages/adapter-codex/src/index.ts').href);
  const harness = createCodexHarness({ codexBinary: binary, preflightTimeoutMs: timeoutMs, env });
  result = await harness.preflight();
} else {
  const { preflightCli, runCli, cliFor } = await import(
    pathToFileURL(`G:/ggq/tmp/506-511-qa/old/${source}/cli.ts`).href
  );
  result = await preflightCli({ ...cliFor(binary), env }, runCli, timeoutMs);
}
const elapsedMs = Math.round(performance.now() - started);

const spawned = events.filter((e) => e.kind === 'spawn');
const probe = spawned[0]?.cwd;
const listing = (dir) => (dir && existsSync(dir) ? readdirSync(dir) : 'ABSENT');
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const pids = () =>
  existsSync(state)
    ? readdirSync(state)
        .filter((n) => n.endsWith('.pid'))
        .map((n) => ({ name: n, pid: Number(readFileSync(join(state, n), 'utf8')) }))
    : [];

const atReturn = {
  tempEntries: listing(temp),
  probeExists: probe ? existsSync(probe) : false,
  probeEntries: listing(probe),
  helpers: pids().map((h) => ({ ...h, alive: alive(h.pid) })),
};

// A helper started by a CLI that has already exited may not have written its pid yet: wait for it.
const expectsHelper = /unconfirmed|cwdhold/.test(scenario);
const appear = Date.now() + 5000;
while (expectsHelper && !pids().length && Date.now() < appear) await new Promise((r) => setTimeout(r, 100));
// Wait for every bounded helper this case started to end on its own (hold + margin).
const deadline = Date.now() + holdMs + 6000;
while (pids().some((h) => alive(h.pid)) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
const stillAlive = pids().filter((h) => alive(h.pid));
const forced = [];
for (const h of stillAlive) {
  // Only a process whose command line carries this QA's marker is ever terminated.
  const line = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${h.pid}").CommandLine`], { encoding: 'utf8', windowsHide: true });
  if (line.includes('gg-qa-506-helper-')) {
    process.kill(h.pid);
    forced.push(h);
  }
}
// Let any late close of the checked child arrive before recording.
await new Promise((r) => setTimeout(r, 300));

const afterHelpers = {
  tempEntries: listing(temp),
  probeExists: probe ? existsSync(probe) : false,
  probeEntries: listing(probe),
  helpersAlive: pids().filter((h) => alive(h.pid)).map((h) => h.name),
  forcedTermination: forced,
  turnAttempt: existsSync(join(state, 'turn-attempt.json')),
};

const record = {
  caseId,
  source,
  scenario,
  timeoutMs,
  holdMs,
  binaryKind,
  node: process.version,
  root,
  probe,
  elapsedMs,
  result,
  events: events.map((e) => ({ ...e, at: rel(e.at) })),
  rmCalls: events.filter((e) => e.kind === 'rm').map((e) => ({ path: e.path, outcome: e.outcome })),
  atReturn,
  afterHelpers,
};
writeFileSync(join(RUNS, `${caseId}.record.json`), JSON.stringify(record, null, 2));
console.log(JSON.stringify(record, null, 2));

// The case removes only its own root, and only after every helper it started has ended.
if (!afterHelpers.helpersAlive.length) rmSync(root, { recursive: true, force: true, maxRetries: 5 });
console.log('CASE_ROOT_REMOVED', !existsSync(root));

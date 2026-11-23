// Drives one real Vitest 5 run of a generated copy of the maintained probe-directory tests and
// records what happened. Usage: node run-mode.mjs <mode>. Writes runs/<mode>/{input,receipt.json,
// events.jsonl,controller.jsonl,vitest.json}. Uses disposable TEMP and cache directories under
// scratch/<mode> and only the fake readiness CLI; no provider is launched.
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';

const evidence = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkout = 'D:/GraphGoblin-AIDLC/2026-11-18-five/lane-a/GraphGoblin';
const adapter = `${checkout}/packages/adapter-codex`;
const headCopy = join(evidence, 'sources/probe-directory.test.ts.HEAD-0ff00d67.txt');
const HEAD_SHA256 = 'e211bfdc49b1a465e4b1b0d997f028005112d003282417c7286172f928e15e75';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

const ORDINARY_LIFECYCLE = 'reports an ordinary case failure once';
const DIRECT = 'runs the fake CLI under a 226-character';
// Each pattern starts at a line start, so the four-space entry check never matches the six-space one.
const ENTRY_CHECK = '\n    context.signal.throwIfAborted();\n';
const ENTRY_CHECK_LIFECYCLE = '\n      context.signal.throwIfAborted();\n';
const LISTENER =
  "\n    enclosing.addEventListener('abort', () => controller.abort(enclosing.reason), { once: true });\n";

/** Exact, counted replacements: a mutation that does not apply fails the run. */
function replaceOnce(text, from, to) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`Expected one occurrence, found ${count}: ${JSON.stringify(from)}`);
  return text.replace(from, to);
}
const mutations = {
  none: (text) => text,
  // The repaired file with both entry checks removed: the unrepaired helpers plus the new regressions.
  'no-entry-checks': (text) =>
    replaceOnce(replaceOnce(text, ENTRY_CHECK, '\n'), ENTRY_CHECK_LIFECYCLE, '\n'),
  // The alternative of forwarding an already-aborted signal inside controlledLifecycle only.
  'forward-only': (text) =>
    replaceOnce(
      mutations['no-entry-checks'](text),
      LISTENER,
      '\n    if (enclosing.aborted) controller.abort(enclosing.reason);\n    else' + LISTENER.slice(4),
    ),
  // Entry checks kept, the enclosing listener removed: later aborts no longer reach the case.
  'no-listener': (text) => replaceOnce(text, LISTENER, '\n'),
};

const modes = {
  'regression-repaired': { source: 'repaired', mutation: 'none', observer: false },
  'regression-unrepaired-helpers': { source: 'repaired', mutation: 'no-entry-checks', observer: false },
  'regression-forward-only': { source: 'repaired', mutation: 'forward-only', observer: false },
  'regression-no-listener': { source: 'repaired', mutation: 'no-listener', observer: false },
  'cancel-before-head-lifecycle': { source: 'head', cancel: 'before', pattern: ORDINARY_LIFECYCLE },
  'cancel-before-repaired-lifecycle': { source: 'repaired', cancel: 'before', pattern: ORDINARY_LIFECYCLE },
  'cancel-before-head-direct': { source: 'head', cancel: 'before', pattern: DIRECT },
  'cancel-before-repaired-direct': { source: 'repaired', cancel: 'before', pattern: DIRECT },
  'cancel-inflight-head-lifecycle': { source: 'head', cancel: 'inflight', pattern: ORDINARY_LIFECYCLE },
  'cancel-inflight-repaired-lifecycle': { source: 'repaired', cancel: 'inflight', pattern: ORDINARY_LIFECYCLE },
  'cancel-inflight-head-direct': { source: 'head', cancel: 'inflight', pattern: DIRECT },
  'cancel-inflight-repaired-direct': { source: 'repaired', cancel: 'inflight', pattern: DIRECT },
  // A real Vitest timeout of a running case: a 150 ms budget in this disposable config only, so
  // the timeout lands while the case's fake CLIs run. Repository deadlines are not changed.
  'timeout-head-lifecycle': { source: 'head', timeout: 150, pattern: ORDINARY_LIFECYCLE },
  'timeout-repaired-lifecycle': { source: 'repaired', timeout: 150, pattern: ORDINARY_LIFECYCLE },
  'timeout-head-direct': { source: 'head', timeout: 150, pattern: DIRECT },
  'timeout-repaired-direct': { source: 'repaired', timeout: 150, pattern: DIRECT },
};

const modeName = process.argv[2];
const mode = modes[modeName];
if (!mode) throw new Error(`Unknown mode ${modeName}`);
// An optional label keeps a repeated or corrected run beside the earlier one, never over it.
const name = process.argv[3] ? `${modeName}-${process.argv[3]}` : modeName;
const run = join(evidence, 'runs', name);
const input = join(run, 'input');
const scratch = join(evidence, 'scratch', name);
const temp = join(scratch, 'temp');
if (existsSync(run)) throw new Error(`${run} already exists; runs are never overwritten`);
mkdirSync(input, { recursive: true });
mkdirSync(temp, { recursive: true });

const sourcePath = mode.source === 'head' ? headCopy : `${adapter}/src/probe-directory.test.ts`;
const sourceBytes = readFileSync(sourcePath);
if (mode.source === 'head' && sha(sourceBytes) !== HEAD_SHA256) throw new Error('HEAD copy changed');
let text = mutations[mode.mutation ?? 'none'](sourceBytes.toString('utf8'));
text = replaceOnce(text, "from './index.js'", `from '${adapter}/src/index.ts'`);
text = replaceOnce(text, "from './cli.js'", `from '${adapter}/src/cli.ts'`);
text = replaceOnce(
  text,
  "'./fixtures/readiness-cli.mjs'",
  `'${pathToFileURL(`${adapter}/src/fixtures/readiness-cli.mjs`).href}'`,
);
if (mode.observer !== false) text += readFileSync(join(evidence, 'harness/observer.ts.txt'), 'utf8');
const generated = join(input, 'probe-preabort.test.ts');
writeFileSync(generated, text);

const require = createRequire(`${adapter}/package.json`);
const config = {
  root: input.replaceAll('\\', '/'),
  cacheDir: join(evidence, 'scratch/cache', name).replaceAll('\\', '/'),
  // The ESM entry: `require.resolve('vitest')` would select the CommonJS stub, which refuses import.
  resolve: {
    conditions: ['development'],
    alias: {
      vitest: join(dirname(require.resolve('vitest/package.json')), 'dist/index.js').replaceAll('\\', '/'),
    },
  },
  test: {
    include: ['*.test.ts'],
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    pool: 'forks',
    execArgv: ['--expose-gc'],
    ...(mode.pattern ? { testNamePattern: mode.pattern } : {}),
    ...(mode.timeout ? { testTimeout: mode.timeout } : {}),
  },
};
writeFileSync(join(input, 'vitest.config.mjs'), `export default ${JSON.stringify(config, null, 2)};\n`);

for (const variable of ['TEMP', 'TMP', 'TMPDIR']) process.env[variable] = temp;
const events = join(run, 'events.jsonl');
writeFileSync(events, '');
process.env.GG_PREABORT_EVENTS = events;
process.env.GG_PREABORT_MODE = mode.cancel ?? 'none';
process.env.NO_COLOR = '1';

const begin = performance.now();
const controllerLog = join(run, 'controller.jsonl');
const record = (event, data = {}) =>
  appendFileSync(
    controllerLog,
    JSON.stringify({ event, utc: new Date().toISOString(), elapsedMs: Math.round(performance.now() - begin), ...data }) + '\n',
  );
const readEvents = () =>
  readFileSync(events, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));

const start = new Date().toISOString();
const { createVitest } = await import(pathToFileURL(require.resolve('vitest/node')).href);
const vitest = await createVitest({
  root: config.root,
  config: join(input, 'vitest.config.mjs'),
  watch: false,
  run: true,
  reporters: ['verbose', 'json'],
  outputFile: { json: join(run, 'vitest.json') },
});
let state;
try {
  let finished = false;
  const running = vitest.start().finally(() => {
    finished = true;
  });
  if (mode.cancel) {
    const trigger = mode.cancel === 'before' ? 'rendezvous' : 'fake-cli-launch';
    const deadline = Date.now() + 60_000;
    let seen;
    while (!seen && !finished && Date.now() < deadline) {
      seen = readEvents().find((event) => event.event === trigger);
      if (!seen) await wait(5);
    }
    if (!seen) {
      record('harness-error', { message: `The ${trigger} event never appeared` });
      throw new Error(`The ${trigger} event never appeared`);
    }
    record('cancel-requested', { reason: 'keyboard-input', after: seen });
    await vitest.cancelCurrentRun('keyboard-input');
    record('cancel-returned');
  }
  await running;
  state = vitest.state.getCountOfFailedTests?.();
  record('start-returned', { failedTests: state ?? null });
} finally {
  await vitest.close();
  record('closed');
}

// Any fake CLI still alive after the run is a residual; stop it and record it.
const launched = readEvents().filter((event) => event.event === 'fake-cli-launch').map((e) => e.pid);
const alive = launched.filter((pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
});
for (const pid of alive) process.kill(pid);

const report = existsSync(join(run, 'vitest.json'))
  ? JSON.parse(readFileSync(join(run, 'vitest.json'), 'utf8'))
  : undefined;
const receipt = {
  mode: name,
  definition: mode,
  start,
  end: new Date().toISOString(),
  node: process.version,
  sourcePath,
  sourceSha256: sha(sourceBytes),
  generatedSha256: sha(readFileSync(generated)),
  fixtureSha256: sha(readFileSync(`${adapter}/src/fixtures/readiness-cli.mjs`)),
  processExitCode: process.exitCode ?? 0,
  launchedPids: launched,
  aliveAfterRunPids: alive,
  scratchTempEntries: readdirSync(temp),
  tests: report?.testResults.flatMap((file) =>
    file.assertionResults.map((test) => ({
      title: test.title,
      status: test.status,
      errors: (test.failureMessages ?? []).map((message) => message.split('\n')[0]),
    })),
  ),
  suiteMessages: report?.testResults.map((file) => file.message?.split('\n')[0]).filter(Boolean),
  counts: report && {
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    pending: report.numPendingTests,
    failedSuites: report.numFailedTestSuites,
    success: report.success,
  },
};
writeFileSync(join(run, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ mode: name, counts: receipt.counts, launched, alive }, null, 0));

import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const input = process.argv[2];
const output = process.env.GG505_OUTPUT;
const meta = JSON.parse(readFileSync(join(input, 'meta.json')));
const requireDependency = createRequire('C:/Users/98jak/.codex/worktrees/gg-20261117-probe-466/GraphGoblin/packages/adapter-codex/package.json');
const { createVitest } = await import(pathToFileURL(requireDependency.resolve('vitest/node')).href);
const eventsPath = join(output, 'controller-events.jsonl');
const record = (event, details = {}) => appendFileSync(eventsPath, JSON.stringify({ event, at: new Date().toISOString(), ...details }) + '\n');
let vitest;
let cancellation;
let cancelRequests = 0;
let endReason;
let unhandled = [];
let watchdogFired = false;
const reporter = {
  onUserConsoleLog(log) {
    if (!log.content.includes('GG505_CANCEL_REQUEST') || cancellation) return;
    cancelRequests += 1;
    record('public-cancel-request', { method: "Vitest.cancelCurrentRun('keyboard-input')", content: log.content });
    cancellation = vitest.cancelCurrentRun('keyboard-input');
    cancellation.then(() => record('public-cancel-resolved'), (error) => record('public-cancel-rejected', { error: String(error) }));
  },
  onTestRunEnd(_modules, errors, reason) {
    endReason = reason;
    unhandled = errors.map((error) => ({ name: error.name, message: error.message, stack: error.stack }));
    record('public-test-run-ended', { reason, unhandled });
  },
};
record('runner-start', { input, meta, node: process.version, runnerTemp: process.env.TEMP });
vitest = await createVitest({ config: join(input, 'vitest.config.mjs'), watch: false, run: true }, {
  test: { reporters: ['verbose', ['json', { outputFile: join(output, 'vitest.json') }], reporter] },
});
const watchdog = setTimeout(() => {
  watchdogFired = true;
  record('watchdog-fired');
  void vitest.cancelCurrentRun('keyboard-input');
}, 30000);
try {
  await vitest.start();
  if (cancellation) await cancellation;
  const runnerTemp = process.env.TEMP;
  const beforeClose = { exists: existsSync(runnerTemp), entries: readdirSync(runnerTemp) };
  record('runner-observation-before-close', { runnerTemp, ...beforeClose });
  await vitest.close();
  const afterClose = { exists: existsSync(runnerTemp), entries: readdirSync(runnerTemp) };
  record('runner-observation-after-close', { runnerTemp, ...afterClose });
  const report = JSON.parse(readFileSync(join(output, 'vitest.json')));
  const summary = {
    input, mode: meta.mode, sourceSha256: meta.sourceSha256, node: process.version,
    cancelRequests, endReason, unhandled, watchdogFired,
    apiObservedExitCode: process.exitCode ?? 0,
    passed: report.numPassedTests, failed: report.numFailedTests, skipped: report.numPendingTests,
    runnerTempBeforeClose: { path: runnerTemp, ...beforeClose },
    runnerTempAfterClose: { path: runnerTemp, ...afterClose },
    assertions: report.testResults.flatMap((file) => file.assertionResults).map((test) => ({ title: test.title, status: test.status, failureHeads: test.failureMessages.map((message) => message.split('\n')[0]) })),
  };
  writeFileSync(join(output, 'driver-summary.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
  record('runner-finished', { observedExitCode: process.exitCode ?? 0 });
  console.log(JSON.stringify(summary, null, 2));
} finally {
  clearTimeout(watchdog);
}

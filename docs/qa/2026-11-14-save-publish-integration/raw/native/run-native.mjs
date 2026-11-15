// Orchestrates the bounded native verification of the dirty #237+#209 integration candidate.
// Usage (cwd anywhere): node run-native.mjs <worktree> <HEAD> <MERGE_HEAD>
// 1. Starts the copied gateway.mjs (built apps/api/dist/main.js, disposable file SQLite under this
//    directory, 127.0.0.1 port 0, no providers) and waits for GG_QA_READY.
// 2. For each copied driver, launches actual Microsoft Edge through the repository's Playwright
//    (channel msedge, headless, a fresh isolated context, service workers blocked, as in
//    desktop.edge.json), opens /app/loops?qa-group=<group>, and calls the driver with the page.
// 3. Closes the gateway through its stdin, which re-asserts identity and source bytes.
// Screenshots are written relative to this directory.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [worktree, head, mergeHead] = process.argv.slice(2);
const native = dirname(fileURLToPath(import.meta.url));
process.chdir(native);
const digest = (value) => createHash('sha256').update(value).digest('hex');
const require = createRequire(join(worktree, 'apps', 'web', 'package.json'));
const { chromium } = require('@playwright/test');
const playwrightVersion = require('@playwright/test/package.json').version;
const config = JSON.parse(await readFile(join(native, 'desktop.edge.json'), 'utf8')).browser;
const log = createWriteStream(join(native, 'gateway.log'));
const summary = { startedAt: new Date().toISOString(), node: process.version, playwrightVersion,
  orchestratorPid: process.pid, runs: [] };

const gateway = spawn(process.execPath, [join(native, 'gateway.mjs'), worktree, head, mergeHead,
  join(native, 'source-paths.json'), join(native, 'binding-before.json')], { stdio: ['pipe', 'pipe', 'pipe'] });
summary.gatewayPid = gateway.pid;
const exited = new Promise((done) => gateway.once('exit', (code, signal) => done({ code, signal })));
gateway.stderr.pipe(log, { end: false });
const url = await new Promise((resolve, reject) => {
  let buffer = '';
  const timer = setTimeout(() => reject(new Error('gateway not ready in 60 s')), 60000);
  gateway.stdout.on('data', (chunk) => {
    log.write(chunk);
    buffer += chunk;
    const match = /GG_QA_READY (http:\/\/127\.0\.0\.1:\d+)/.exec(buffer);
    if (match) { clearTimeout(timer); resolve(match[1]); }
  });
  exited.then((result) => { clearTimeout(timer); reject(new Error('gateway exited ' + JSON.stringify(result))); });
});
if (/:474[78]$/.test(url)) throw new Error('Refused owner port ' + url);
summary.url = url;

const drivers = [
  ['verify-readback.playwright.js', 'readback-integration', 'observed-readback.json'],
  ['verify-u2-readiness.playwright.js', 'u2-readiness', 'observed-u2-readiness.json'],
];
try {
  for (const [file, group, out] of drivers) {
    const source = await readFile(join(native, file), 'utf8');
    const browser = await chromium.launch(config.launchOptions);
    const edge = browser.version();
    const context = await browser.newContext(config.contextOptions);
    const page = await context.newPage();
    const consoleEntries = [];
    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type()))
        consoleEntries.push({ type: message.type(), text: message.text().slice(0, 500) });
    });
    const startedAt = new Date().toISOString();
    let result, thrown = null;
    try {
      await page.goto(url + '/app/loops?qa-group=' + group);
      const driver = (0, eval)('(' + source + ')');
      result = await driver(page);
    } catch (error) {
      thrown = String(error?.stack ?? error);
    } finally {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
    const record = { driver: file, driverSha256: digest(source), group, url, edge, playwrightVersion,
      launch: config, startedAt, finishedAt: new Date().toISOString(), consoleEntries, thrown, result };
    await writeFile(join(native, out), JSON.stringify(record, null, 2) + '\n');
    summary.runs.push({ driver: file, out, edge, thrown,
      failures: result?.failures?.length ?? (result?.failure ? 1 : 0),
      failure: result?.failure ?? result?.failures ?? null,
      pageErrors: result?.pageErrors?.length ?? null,
      consoleErrors: consoleEntries.filter((entry) => entry.type === 'error').length });
  }
} finally {
  gateway.stdin.end('\n');
  const timeout = new Promise((done) => setTimeout(() => done({ timeout: true }), 30000));
  summary.gatewayExit = await Promise.race([exited, timeout]);
  if (summary.gatewayExit.timeout) gateway.kill();
  summary.finishedAt = new Date().toISOString();
  log.end();
  await writeFile(join(native, 'run-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}

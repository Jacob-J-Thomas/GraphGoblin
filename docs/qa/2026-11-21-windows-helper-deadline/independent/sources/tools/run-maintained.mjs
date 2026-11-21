// QA167I runner for the single maintained bounded-log acceptance group. Not product code.
// node run-maintained.mjs <checkout> <private-dir> <record.json>
// Runs only the named top-level test through pnpm.cmd, retaining the raw TAP output privately.
// Environment: GG_TEST_PORT_START=25860 (the group's own 20-port pool 25860-25879); GITHUB_PAT removed.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const [checkout, privateDir, recordPath] = process.argv.slice(2);
if (existsSync(recordPath)) throw new Error('record exists; never overwritten');
mkdirSync(privateDir, { recursive: true });
const NAME = 'bounded Windows logs: stale entry, closed outcomes, one writer per root, legacy writer and unsafe names';
const command = `pnpm.cmd exec node --test --test-reporter=tap "--test-name-pattern=${NAME}" tooling/scripts/windows-launcher.acceptance.mjs`;
const env = { ...process.env, GG_TEST_PORT_START: '25860' };
delete env.GITHUB_PAT;
const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8' }).trim();
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const record = {
  schema: 'qa167i-maintained-run/1',
  startUtc: new Date().toISOString(),
  command,
  cwd: checkout,
  envChanges: { set: { GG_TEST_PORT_START: '25860' }, removed: ['GITHUB_PAT'] },
  node: process.version,
  checkout: { head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), trackedChanges: git('status', '--porcelain=v1', '--untracked-files=no').length },
  acceptanceSha256: sha(readFileSync(join(checkout, 'tooling/scripts/windows-launcher.acceptance.mjs'))),
  launcherSha256: sha(readFileSync(join(checkout, 'apps/windows-launcher/Launcher.cs'))),
  nativeChecksSha256: sha(readFileSync(join(checkout, 'apps/windows-launcher/NativeChecks.cs'))),
};
const started = Date.now();
const child = spawn('cmd.exe', ['/d', '/s', '/c', `"${command}"`], { cwd: checkout, env, windowsHide: true, windowsVerbatimArguments: true, stdio: ['ignore', 'pipe', 'pipe'] });
const stdout = [], stderr = [];
child.stdout.on('data', (chunk) => stdout.push(chunk));
child.stderr.on('data', (chunk) => stderr.push(chunk));
const exit = await new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
record.exit = exit;
record.ms = Date.now() - started;
record.endUtc = new Date().toISOString();
const out = Buffer.concat(stdout), err = Buffer.concat(stderr);
writeFileSync(join(privateDir, 'tap.stdout.bin'), out);
writeFileSync(join(privateDir, 'stderr.bin'), err);
record.stdout = { bytes: out.length, sha256: sha(out) };
record.stderr = { bytes: err.length, sha256: sha(err) };
const text = out.toString('utf8');
const tally = (pattern) => (text.match(pattern) ?? []).length;
record.tap = {
  okLines: tally(/^\s*ok \d+/gm),
  notOkLines: tally(/^\s*not ok \d+/gm),
  summary: Object.fromEntries([...text.matchAll(/^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) (\S+)/gm)].map((match) => [match[1], Number(match[2])])),
  subtests: [...text.matchAll(/^    (ok|not ok) \d+ - (.+)$/gm)].map((match) => ({ status: match[1], name: match[2] })),
  topLevel: [...text.matchAll(/^(ok|not ok) \d+ - (.+?)(?: # SKIP.*)?$/gm)].map((match) => ({ status: match[1], name: match[2] })),
  artifacts: [...text.matchAll(/"evidence":"windows-launcher-bounded-logs","artifacts":"([^"]+)"/g)].map((match) => match[1]),
};
record.checkoutAfter = { trackedChanges: git('status', '--porcelain=v1', '--untracked-files=no').length };
writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify({ exit, ms: record.ms, tap: { ...record.tap, subtests: record.tap.subtests.length } }));

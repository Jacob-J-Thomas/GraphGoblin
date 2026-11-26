import cp from 'node:child_process';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';

const root = resolve(process.env.TEMP);
const expected = resolve('G:/ggq/delivery-evidence/2026-11-24-followups/codex-cleanup-506-511/native');
if (!root.startsWith(expected + '\\')) throw new Error('Expected an exclusively owned diagnostic root');
const events = [];
const children = [];
const started = performance.now();
const record = (event, fields = {}) => events.push({ event, elapsedMs: performance.now() - started, ...fields });
const originalSpawn = cp.spawn;
const originalRm = fs.rm;
cp.spawn = function (...args) {
  const child = originalSpawn.apply(this, args);
  children.push(child);
  record('spawn', { pid: child.pid, args: args[1], cwd: args[2]?.cwd });
  const kill = child.kill;
  child.kill = function (...signals) {
    record('termination-request', { pid: child.pid, signal: signals[0] ?? 'SIGTERM' });
    const result = kill.apply(this, signals);
    record('termination-return', { pid: child.pid, result });
    return result;
  };
  child.on('exit', (code, signal) => record('exit', { pid: child.pid, code, signal }));
  child.on('close', (code, signal) => record('close', { pid: child.pid, code, signal }));
  return child;
};
fs.rm = async function (path, options) {
  record('remove-attempt', { path: String(path) });
  try {
    const result = await originalRm(path, options);
    record('remove-success', { path: String(path) });
    return result;
  } catch (error) {
    record('remove-failure', { path: String(path), code: error.code, syscall: error.syscall });
    throw error;
  }
};
syncBuiltinESMExports();
const { preflightCli, runCli } = await import(pathToFileURL(resolve(process.argv[2])).href);
const result = await preflightCli({ command: process.execPath, prefix: [resolve(process.argv[3]), 'hang'] }, async (...args) => {
  const answer = await runCli(...args);
  record('runner-settled', { args: args[1], code: answer.code, spawnError: answer.spawnError });
  return answer;
}, 1000);
record('preflight-settled', { result });
const entriesAtSettlement = await fs.readdir(root);
for (const child of children) {
  if (child.exitCode !== null || child.signalCode !== null) continue;
  await new Promise((resolveWait, reject) => {
    const timer = setTimeout(() => reject(new Error('Owned fake child did not close within 3 seconds')), 3000);
    child.once('close', () => { clearTimeout(timer); resolveWait(); });
  });
}
const entriesAfterClose = await fs.readdir(root);
for (const name of entriesAfterClose) {
  if (!/^gg-codex-probe-[a-f0-9]{8}$/.test(name)) throw new Error('Unexpected diagnostic entry');
  await originalRm(join(root, name), { recursive: true, force: true });
}
console.log(JSON.stringify({ platform: process.platform, node: process.version, root, result, events, entriesAtSettlement, entriesAfterClose, entriesAfterOwnedCleanup: await fs.readdir(root) }, null, 2));

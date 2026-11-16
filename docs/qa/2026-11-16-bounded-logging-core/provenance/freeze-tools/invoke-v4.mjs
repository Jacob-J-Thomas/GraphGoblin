import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { admitRef, batch, checkedRef, currentNode, json, outputPath, psPath, suite, verifyManifest } from './freeze.mjs';

const [planPath, sha256, ...extra] = process.argv.slice(2);
assert.equal(extra.length, 0, 'Usage: invoke-v4.mjs <root invocation plan> <SHA-256>');
const planRef = await admitRef({ path: planPath, sha256 }, batch);
const plan = await json(planRef.path);
assert.equal(plan.schema, 'gg438-native-candidate-invocation/v1');
assert.equal(plan.state, 'root-admitted-invocation');
assert.match(plan.attempt, /^candidate-attempt-[1-9][0-9]*$/u);
assert.deepEqual(process.execArgv, []);
assert(!Object.keys(process.env).some((key) => key.toUpperCase() === 'NODE_OPTIONS'));
const runtime = await currentNode();
const node = await checkedRef(runtime.nodePath, runtime.nodeSha256);
assert.deepEqual(plan.node, node);
assert.equal(plan.powerShell.path, psPath);
assert.equal(plan.powerShell.version, '7.6.9');
const ps = { ...await admitRef(plan.powerShell, undefined, true), version: plan.powerShell.version };
const admission = await admitRef(plan.admission, batch);
const cfg = await json(admission.path);
assert.equal(cfg.schema, 'gg438-native-candidate-admission/v4');
assert.equal(cfg.state, 'root-admitted');
assert.equal(cfg.mode, 'candidate');
assert.equal(cfg.attempt, plan.attempt);
assert.deepEqual(cfg.powerShell, ps);
const binding = await admitRef(cfg.binding, batch);
const { manifest, rows } = await verifyManifest({ plan: { v4ManifestSha256: cfg.v4Manifest.sha256 } });
assert.deepEqual(cfg.v4Manifest, manifest);
assert.deepEqual(plan.v4Manifest, manifest);
const wrapper = rows.get('launch.ps1');
assert.deepEqual(cfg.wrapper, wrapper);
assert.deepEqual(plan.wrapper, wrapper);
assert.deepEqual(plan.privateFixtureReceipt, cfg.privateFixtureReceipt);
await admitRef(plan.privateFixtureReceipt, batch);
await admitRef(cfg.stdioQualification, batch);
for (const folder of ['receipts', 'attempts'])
  await assert.rejects(lstat(join(suite, folder, plan.attempt)), { code: 'ENOENT' });

const out = outputPath(plan.outputDirectory, /^launcher-438-candidate-invocation-[0-9]{2,}$/u);
await mkdir(out);
assert.equal(await realpath(out), out);
const now = () => new Date().toISOString();
const save = (name, value) => writeFile(join(out, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const args = [
  '-NoProfile', '-NonInteractive', '-File', wrapper.path,
  '-Admission', admission.path, '-Sha256', admission.sha256, '-ReceiptName', plan.attempt,
];
await save('requested.json', { at: now(), executable: ps, args, cwd: suite, node,
  invocationPlan: planRef, invocation: await checkedRef(fileURLToPath(import.meta.url), undefined, batch),
  wrapper, admission, binding, manifest, privateFixtureReceipt: plan.privateFixtureReceipt, attempt: plan.attempt });

const child = spawn(ps.path, args, { cwd: suite, windowsHide: true, shell: false, stdio: ['ignore','pipe','pipe'] });
const exit = { pid: child.pid ?? null, spawnfile: child.spawnfile, spawnargs: child.spawnargs };
const spawnSeen = Promise.withResolvers();
const close = Promise.withResolvers();
child.once('spawn', () => { exit.spawnedAt = now(); spawnSeen.resolve(); });
child.once('error', (error) => { exit.spawnError = { name: error.name, message: error.message, code: error.code }; });
child.once('exit', (exitCode, signal) => { exit.observedExit = { exitCode, signal, at: now() }; });
child.once('close', (exitCode, signal) => {
  Object.assign(exit, { exitCode, signal, closedAt: now() });
  close.resolve();
  spawnSeen.resolve();
});
const captures = {};
const drains = ['stdout','stderr'].map((name) => {
  const stream = child[name];
  const path = join(out, name + '.raw');
  const receipt = (captures[name] = { path });
  stream.once('end', () => { receipt.endedAt = now(); });
  return pipeline(stream, createWriteStream(path, { flags: 'wx' })).then(
    () => { receipt.writeClosedAt = now(); },
    (error) => { receipt.error = { name: error.name, message: error.message }; },
  );
});
await spawnSeen.promise;
try { await save('launch.json', { pid: exit.pid, spawnedAt: exit.spawnedAt ?? null }); }
catch (error) { exit.launchReceiptError = { name: error.name, message: error.message }; }
await Promise.all([close.promise, ...drains]);
if (exit.observedExit) await save('exit.json', { pid: exit.pid, ...exit.observedExit });
for (const receipt of Object.values(captures)) {
  if (receipt.endedAt && receipt.writeClosedAt && !receipt.error)
    Object.assign(receipt, await checkedRef(receipt.path, undefined, batch), { bytes: (await lstat(receipt.path)).size });
}
const complete = exit.pid && exit.spawnedAt && exit.observedExit?.exitCode === exit.exitCode &&
  exit.observedExit?.signal === exit.signal && exit.closedAt && !exit.spawnError && !exit.launchReceiptError &&
  Object.values(captures).every(({ sha256 }) => sha256);
await save('close.json', { ...exit, stdout: captures.stdout, stderr: captures.stderr, complete: Boolean(complete) });
console.log(JSON.stringify({ complete: Boolean(complete), pid: exit.pid, exitCode: exit.exitCode, output: out }));
process.exitCode = complete ? (exit.exitCode ?? 1) : 1;


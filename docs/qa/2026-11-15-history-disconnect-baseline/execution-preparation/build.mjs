// Root invokes once after the post-#410 base and #419 source to build have been admitted.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, open, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { absolute, buildEnv, collectArtifacts, confirmTooling, hash, iso,
  readAdmission, readIdentity, receiptReference, save } from './common.mjs';

const [admissionPath, admissionSha256, ...extra] = process.argv.slice(2);
assert.equal(extra.length, 0, 'Usage: build.mjs <root build admission> <lowercase SHA-256>');
const job = await readAdmission(admissionPath, admissionSha256);
const before = await readIdentity(job);
await mkdir(job.directory);
assert.equal(await realpath(job.directory), job.directory);

const command = 'pnpm.cmd build --force';
const shell = join(absolute(process.env.SystemRoot), 'System32', 'cmd.exe');
const shellArguments = ['/d', '/s', '/c', command];
const logPath = join(job.directory, 'build.log');
const launchPath = join(job.directory, 'build-launch.json');
const exitPath = join(job.directory, 'build-exit.json');
const receiptPath = join(job.directory, 'build-receipt.json');
const combined = await open(logPath, 'wx');
const startedAt = iso();
const child = spawn(shell, shellArguments, {
  cwd: job.checkout, env: buildEnv(job.node), windowsHide: true,
  stdio: ['ignore', combined.fd, combined.fd],
});
let spawnError;
const closed = new Promise((resolve) => {
  child.once('error', (error) => { spawnError = { name: error.name, code: error.code, message: error.message }; });
  child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
});
const launch = {
  schema: 'gg419-build-launch/v1', ...receiptReference(job), before, command, shell,
  shellArguments, pid: child.pid ?? null, startedAt, logPath,
};
let launchError;
try {
  await combined.close();
  await save(launchPath, launch);
  process.stdout.write(JSON.stringify({ launchPath, pid: launch.pid, startedAt }) + '\n');
} catch (error) {
  launchError = error;
}

const disposition = await closed;
const rawExit = {
  schema: 'gg419-build-child-exit/v1', pid: launch.pid, startedAt, finishedAt: iso(),
  ...disposition, ...(spawnError ? { spawnError } : {}),
};
// Keep the direct process disposition even if hashing or the closing fingerprint fails.
await save(exitPath, rawExit);
const receipt = {
  schema: 'gg419-build-receipt/v1', ...receiptReference(job), before, command,
  rawExit, cleanAfter: false,
};
try {
  receipt.exit = { path: exitPath, sha256: await hash(exitPath) };
  receipt.log = { path: logPath, sha256: await hash(logPath), bytes: (await stat(logPath)).size };
  if (launchError) throw launchError;
  receipt.launch = { path: launchPath, sha256: await hash(launchPath) };
  const after = await readIdentity(job);
  assert.deepEqual(after, before, 'Source or index drift after build');
  receipt.after = after;
  if (rawExit.exitCode === 0 && rawExit.signal === null && !spawnError) {
    const artifacts = await collectArtifacts(job.checkout);
    receipt.artifacts = { inventorySha256: artifacts.inventorySha256, ...artifacts.counts,
      dependencyFiles: Object.keys(artifacts.dependencyFiles).length,
      workspaceLinks: Object.keys(artifacts.workspaceLinks).length };
  }
  assert.deepEqual(await readIdentity(job), before, 'Source or index drift during output readback');
  assert.equal(await hash(job.node.nodePath), job.node.nodeSha256);
  assert.equal(await hash(job.admissionPath), job.admissionSha256);
  await confirmTooling(job.input.tooling);
  receipt.cleanAfter = true;
} catch (error) {
  receipt.readbackError = { name: error.name, message: error.message, stack: error.stack };
}
await save(receiptPath, receipt);
const successful = rawExit.exitCode === 0 && rawExit.signal === null && receipt.cleanAfter &&
  !spawnError && receipt.artifacts !== undefined;
process.stdout.write(JSON.stringify({ receiptPath, receiptSha256: await hash(receiptPath), exitPath,
  exitCode: rawExit.exitCode, cleanAfter: receipt.cleanAfter, successful }) + '\n');
process.exitCode = successful ? 0 : 1;

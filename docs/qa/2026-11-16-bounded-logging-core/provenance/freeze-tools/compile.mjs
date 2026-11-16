import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { admitRef, batch, checkedRef, checkSource, compileEnvironment, identity, openContext } from './freeze.mjs';

const [planPath, planSha, ...extra] = process.argv.slice(2);
assert.equal(extra.length, 0, 'Usage: compile.mjs <root plan> <sha256>');
const context = await openContext(planPath, planSha);
const { plan, job, opening, compiler, node, git, ps, planRef, buildReceipt } = context;
const source = await checkSource(context);
const output = plan.compileDirectory;
const now = () => new Date().toISOString();
const save = (file, value) => writeFile(join(output, file), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const describe = (error) => ({ name: error.name, message: error.message, code: error.code });

await mkdir(output);
assert.equal(await realpath(output), output);
const executablePath = join(output, 'GraphGoblin.exe');
const argv = [
  '/nologo', '/target:winexe', '/optimize+', '/platform:x64', '/reference:System.Windows.Forms.dll',
  '/reference:System.Web.Extensions.dll', '/out:' + executablePath, source.path,
];
const environment = compileEnvironment(compiler, output, node);
const launch = {
  schema: 'gg438-candidate-compiler-launch/v1', requestedAt: now(), opening, compiler, source, node,
  nodeVersion: process.version, git, ps, plan: planRef, buildReceipt, argv, cwd: job.checkout, environment,
  deadlineMs: 30000, stdoutPath: join(output, 'stdout.raw'), stderrPath: join(output, 'stderr.raw'),
};
await save('requested.json', launch);

function capture(stream, path) {
  const observation = { path };
  stream.once('end', () => { observation.endedAt = now(); });
  const done = pipeline(stream, createWriteStream(path, { flags: 'wx' })).then(
    () => { observation.writeClosedAt = now(); },
    (error) => { observation.error = describe(error); },
  );
  return { observation, done };
}

const child = spawn(compiler.path, argv, {
  cwd: job.checkout, env: environment, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
const exit = {
  schema: 'gg438-candidate-compiler-exit/v1', pid: child.pid ?? null, startedAt: now(), timedOut: false,
  spawnfile: child.spawnfile, spawnargs: child.spawnargs,
};
const closed = Promise.withResolvers();
child.once('spawn', () => { exit.spawnedAt = now(); });
child.once('error', (error) => { exit.spawnError = describe(error); });
child.once('exit', (exitCode, signal) => {
  exit.observedExit = { exitCode, signal, at: now() };
});
child.once('close', (exitCode, signal) => {
  Object.assign(exit, { exitCode, signal, closedAt: now() });
  closed.resolve();
});
const streams = {
  stdout: capture(child.stdout, launch.stdoutPath),
  stderr: capture(child.stderr, launch.stderrPath),
};
const hardClose = Promise.withResolvers();
let captureTimer;
const timeout = setTimeout(() => {
  exit.timedOut = true;
  exit.timeoutAt = now();
  if (exit.pid && !exit.observedExit) {
    try { exit.terminationRequested = child.kill(); }
    catch (error) { exit.terminationError = describe(error); }
  }
  captureTimer = setTimeout(() => {
    child.stdout.destroy(new Error('Compiler pipe did not close after deadline'));
    child.stderr.destroy(new Error('Compiler pipe did not close after deadline'));
    child.unref();
    exit.closeAmbiguous = true;
    hardClose.resolve();
  }, 3000);
}, launch.deadlineMs);

let launchError;
try { await save('launch.json', { ...launch, pid: exit.pid, startedAt: exit.startedAt }); }
catch (error) { launchError = describe(error); }
await Promise.race([
  Promise.all([closed.promise, ...Object.values(streams).map(({ done }) => done)]),
  hardClose.promise,
]);
clearTimeout(timeout);
clearTimeout(captureTimer);
for (const [name, { observation }] of Object.entries(streams)) exit[name] = { ...observation };
if (launchError) exit.launchReceiptError = launchError;
await save('exit.json', exit);

const receipt = {
  ...launch, schema: 'gg438-candidate-compiler-receipt/v1', pid: exit.pid, result: exit,
  rawExit: await checkedRef(join(output, 'exit.json'), undefined, batch), complete: false,
};
try {
  for (const name of ['stdout', 'stderr']) {
    const status = exit[name];
    assert(status.endedAt && status.writeClosedAt && !status.error, 'Compiler raw stream incomplete: ' + name);
    const ref = await checkedRef(status.path, undefined, batch);
    receipt[name] = { ...ref, bytes: (await lstat(ref.path)).size, endedAt: status.endedAt, writeClosedAt: status.writeClosedAt };
  }
  assert(!launchError && !exit.spawnError && !exit.timedOut && !exit.closeAmbiguous);
  assert(exit.pid && exit.spawnedAt && exit.closedAt && exit.observedExit);
  assert.equal(exit.exitCode, 0);
  assert.equal(exit.signal, null);
  assert.equal(exit.observedExit.exitCode, 0);
  assert.equal(exit.observedExit.signal, null);
  const executable = await checkedRef(executablePath, undefined, batch);
  const pe = await readFile(executable.path);
  assert.equal(pe.readUInt16LE(0), 0x5a4d);
  const offset = pe.readUInt32LE(0x3c);
  assert.equal(pe.readUInt32LE(offset), 0x4550);
  assert.equal(pe.readUInt16LE(offset + 4), 0x8664);
  assert.equal(pe.readUInt16LE(offset + 24), 0x20b);
  assert.equal(pe.readUInt16LE(offset + 24 + 68), 2); // IMAGE_SUBSYSTEM_WINDOWS_GUI
  receipt.executable = { ...executable, bytes: pe.length };
  receipt.closing = await identity(context);
  assert.deepEqual(receipt.closing, opening);
  assert.deepEqual(await checkSource(context), source);
  await admitRef(compiler, undefined, true);
  await admitRef(node);
  await admitRef(git);
  await admitRef(ps, undefined, true);
  await admitRef(planRef, batch);
  await admitRef(buildReceipt, batch);
  receipt.complete = true;
} catch (error) {
  receipt.firstFailure = describe(error);
}
await save('receipt.json', receipt);
const receiptRef = await checkedRef(join(output, 'receipt.json'), undefined, batch);
console.log(JSON.stringify({ complete: receipt.complete, receipt: receiptRef, executable: receipt.executable }));
process.exitCode = receipt.complete ? 0 : 1;


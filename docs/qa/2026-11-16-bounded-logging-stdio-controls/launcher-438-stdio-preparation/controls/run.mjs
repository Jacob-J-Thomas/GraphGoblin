import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, lstat, readFile, readdir, realpath, rmdir, writeFile } from 'node:fs/promises';
import { release } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const controls = await realpath(fileURLToPath(new URL('.', import.meta.url)));
const preparation = dirname(controls);
const profile = dirname(dirname(dirname(preparation)));
const nodePath = join(profile, '.claude', 'codex-runs', 'GraphGoblin', 'runtime',
  'node-v22.23.4-win-x64', 'node.exe');
const digest = (data) => createHash('sha256').update(data).digest('hex');
const shaPattern = /^[0-9a-f]{64}$/u;
const filetime = /^[1-9][0-9]{16,18}$/u;
const captureLimit = 65536;
const script = 'setTimeout(() => {}, 30000)';
const timestamp = () => new Date().toISOString();
const exclusive = (path, data) => writeFile(path, data, { flag: 'wx' });
const save = (path, value) => exclusive(path, JSON.stringify(value, null, 2) + '\n');

async function readCanonical(path, allowSystemHardLinks = false) {
  assert.equal(await realpath(path), path, 'Noncanonical path: ' + path);
  const stat = await lstat(path);
  assert(stat.isFile() && (allowSystemHardLinks || stat.nlink === 1), path);
  return readFile(path);
}

const [admissionPath, admissionSha, ...extra] = process.argv.slice(2);
assert.equal(extra.length, 0);
assert.equal(process.platform, 'win32');
assert.equal(process.arch, 'x64');
assert.equal(process.version, 'v22.23.4');
assert.equal(await realpath(process.execPath), nodePath);
assert.deepEqual(process.execArgv, []);
assert(!Object.keys(process.env).some((key) => key.toUpperCase() === 'NODE_OPTIONS'));
assert(shaPattern.test(admissionSha));
assert.equal(admissionPath, resolve(admissionPath));
const admissionRelative = relative(controls, admissionPath);
assert(/^(?:admission-[a-z0-9-]+|admissions\\[a-z0-9-]+)\.json$/u.test(admissionRelative));
const admissionBytes = await readCanonical(admissionPath);
assert.equal(digest(admissionBytes), admissionSha);
const admission = JSON.parse(admissionBytes.toString('utf8'));
assert.equal(admission.schema, 'gg438-stdio-controls-admission/v1');
assert.equal(admission.state, 'root-admitted');
assert.match(admission.attempt, /^attempt-[1-9][0-9]*$/u);
assert.equal(admission.hostRelease, release());

const systemRoot = await realpath(process.env.SystemRoot);
const system32 = join(systemRoot, 'System32');
const systemLibraries = new Set(['ntdll', 'kernel32', 'kernelbase']);
const paths = {
  driver: join(controls, 'run.mjs'),
  fixtureSource: join(controls, 'StdioFixtureHost.cs'),
  fixtureExe: join(controls, 'StdioFixtureHost.exe'),
  fixtureCompileReceipt: join(controls, 'compile-check.json'),
  observerSource: join(preparation, 'ObserveStdio.cs'),
  observerExe: join(preparation, 'ObserveStdio.compile-check.exe'),
  observerCompileReceipt: join(preparation, 'compile-check.json'),
  node: nodePath,
  ntdll: join(system32, 'ntdll.dll'),
  kernel32: join(system32, 'kernel32.dll'),
  kernelbase: join(system32, 'KernelBase.dll'),
};

async function verify() {
  assert.deepEqual(Object.keys(admission.sha256).sort(), Object.keys(paths).sort());
  const hashes = {};
  for (const [name, path] of Object.entries(paths)) {
    assert(shaPattern.test(admission.sha256[name]), 'Missing hash: ' + name);
    const systemFile = systemLibraries.has(name);
    const canonical = systemFile ? await realpath(path) : path;
    if (systemFile) {
      assert.equal(dirname(canonical), system32);
      assert.equal(canonical.toLowerCase(), path.toLowerCase());
    }
    const contents = await readCanonical(canonical, systemFile);
    const sha256 = digest(contents);
    assert.equal(sha256, admission.sha256[name], name);
    hashes[name] = { path: canonical, sha256 };
    if (name.endsWith('CompileReceipt')) {
      const receipt = JSON.parse(contents.toString('utf8'));
      assert.equal(receipt.exitCode, 0);
      const kind = name.slice(0, -'CompileReceipt'.length);
      assert.equal(receipt.sourceSha256, admission.sha256[kind + 'Source']);
      assert.equal(receipt.outputSha256, admission.sha256[kind + 'Exe']);
    }
  }
  assert.equal(digest(await readCanonical(admissionPath)), admissionSha);
  return { hostRelease: release(), nodeVersion: process.version, arch: process.arch, hashes, admissionSha };
}

const opening = await verify();
const attempts = join(controls, 'attempts');
await mkdir(attempts, { recursive: true });
assert.equal(await realpath(attempts), attempts);
const attemptDir = join(attempts, admission.attempt);
await mkdir(attemptDir);
assert.equal(await realpath(attemptDir), attemptDir);
const scratch = join(attemptDir, 'scratch');
await mkdir(scratch);
assert.equal(await realpath(scratch), scratch);
const evidence = join(attemptDir, 'evidence');
await mkdir(evidence);
const artifact = (name, value) => save(join(evidence, name), value);
await exclusive(join(evidence, 'admission.json'), admissionBytes);
await artifact('opening-binding.json', opening);

const env = {
  PATH: dirname(nodePath) + ';' + system32,
  SystemRoot: systemRoot, WINDIR: systemRoot,
  TEMP: scratch, TMP: scratch, HOME: scratch, USERPROFILE: scratch,
  APPDATA: scratch, LOCALAPPDATA: scratch,
};
const fixtureResults = [];
let firstFailure;
let released = false;

async function fail(label, error) {
  if (firstFailure) return;
  firstFailure = { label, at: timestamp(), message: error.message, stack: error.stack };
  await artifact('first-failure.json', firstFailure);
}

function within(promise, milliseconds, label) {
  let clock;
  const timeout = new Promise((_, reject) => {
    clock = setTimeout(() => reject(new Error(label + ' timed out')), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(clock));
}

function captureStream(stream, firstLine) {
  const chunks = [];
  let bytes = 0;
  let captured = 0;
  let endAt;
  let streamError;
  let lineFound = false;
  stream.on('data', (chunk) => {
    bytes += chunk.length;
    if (captured < captureLimit) {
      const truncated = chunk.subarray(0, captureLimit - captured);
      chunks.push(truncated);
      captured += truncated.length;
    }
    if (firstLine && !lineFound && chunk.includes(10)) {
      lineFound = true;
      firstLine(Buffer.concat(chunks, captured).toString('utf8').split('\n', 1)[0]);
    }
  });
  stream.on('error', (error) => { streamError = error.message; });
  stream.on('end', () => { endAt = timestamp(); });
  return () => ({ bytes, captured, endAt, streamError, raw: Buffer.concat(chunks, captured) });
}

async function start(label, exe, args, observer = false) {
  const requested = { exe, args, cwd: scratch, at: timestamp() };
  await artifact(label + '-request.json', requested);
  const child = spawn(exe, args, {
    cwd: scratch, env, windowsHide: true, shell: false,
    stdio: [observer ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });
  const record = { pid: child.pid, at: timestamp(), requested };
  const first = Promise.withResolvers();
  const stdout = captureStream(child.stdout, first.resolve);
  const stderr = captureStream(child.stderr);
  const done = Promise.withResolvers();
  child.once('error', (error) => { record.error = error.message; });
  child.once('exit', (code, signal) => { record.exit = { code, signal, at: timestamp() }; });
  child.once('close', (code, signal) => {
    record.close = { code, signal, at: timestamp() };
    done.resolve();
  });
  if (observer) {
    child.stdin.on('error', (error) => { record.stdinError = error.message; });
    child.stdin.end();
  }
  const spawnReceipt = artifact(label + '-spawn.json', record).then(() => null, (error) => error);
  return { label, child, record, stdout, stderr, spawnReceipt, first: first.promise, done: done.promise };
}

function abandon(run) {
  run.child.stdout.destroy();
  run.child.stderr.destroy();
  run.child.stdin?.destroy();
  run.child.unref();
  run.record.retainedAt = timestamp();
}

async function capture(run) {
  const { label, record } = run;
  const { raw: stdout, ...out } = run.stdout();
  const { raw: stderr, ...err } = run.stderr();
  await exclusive(join(evidence, label + '-stdout.raw'), stdout);
  await exclusive(join(evidence, label + '-stderr.raw'), stderr);
  await artifact(label + '-process.json', { ...record, stdout: out, stderr: err });
  return { record, stdout, stderr, out, err };
}

function settled(outcome, expected) {
  const { record, out, err } = outcome;
  assert.equal(record.error, undefined);
  assert.equal(record.stdinError, undefined);
  assert.equal(out.streamError, undefined);
  assert.equal(err.streamError, undefined);
  assert(out.endAt && err.endAt, 'Missing stream EOF');
  assert.equal(out.bytes, out.captured);
  assert.equal(err.bytes, err.captured);
  for (const disposition of [record.exit, record.close]) {
    assert.equal(disposition?.code, expected);
    assert.equal(disposition.signal, null);
  }
}

async function observe(label, pid, birth, image, expectedCode) {
  const run = await start(label, paths.observerExe, [String(pid), birth, image], true);
  let timeout;
  try {
    await within(run.done, 9000, label);
  } catch (error) {
    timeout = error;
    run.record.timeoutAt = timestamp();
    // ChildProcess is the exact observer just spawned. This is never the fixture or its host.
    if (!run.record.exit && run.child.pid) run.record.observerTermination = run.child.kill();
    try { await within(run.done, 3000, label + ' observer close after timeout'); }
    catch { abandon(run); }
  }
  const outcome = await capture(run);
  if (timeout) throw timeout;
  const receiptError = await run.spawnReceipt;
  if (receiptError) throw receiptError;
  settled(outcome, expectedCode);
  return outcome;
}

function checkSpawn(receipt, mapping) {
  assert.equal(receipt.schema, 'gg438-stdio-fixture/v1');
  assert.equal(receipt.outcome, 'spawned');
  assert.equal(receipt.mapping, mapping);
  assert(Number.isSafeInteger(receipt.pid) && receipt.pid > 0);
  assert.match(receipt.birthFileTime, filetime);
  assert.equal(receipt.executable.toLowerCase(), nodePath.toLowerCase());
  assert.deepEqual(receipt.arguments, ['-e', script]);
  assert.equal(receipt.commandLine, '"' + receipt.executable + '" -e "' + script + '"');
  assert.equal(receipt.cwd.toLowerCase(), scratch.toLowerCase());
  assert.equal(receipt.startupFlags, '0x00000100');
  assert.equal(receipt.creationFlags, '0x08080000');
  assert.equal(receipt.handleListAttribute, '0x00020002');
  assert.equal(receipt.inheritHandles, true);
  assert.deepEqual(receipt.nul, {
    name: 'NUL', shareMode: '0x00000003', disposition: '0x00000003',
    flags: '0x00000080', readAccess: '0x80000000', writeAccess: '0x40000000',
  });
  const roles = ['nul-read', 'nul-write'];
  if (mapping === 'wrong-destination') roles.push('pipe-write');
  assert.deepEqual(receipt.inheritedHandleRoles, roles);
  const stdout = mapping === 'wrong-direction' ? 'nul-read' :
    mapping === 'wrong-destination' ? 'pipe-write' : 'nul-write';
  assert.deepEqual(receipt.slots, ['nul-read', stdout, 'nul-write']);
}

function checkNull(slot, read, write, matched) {
  assert.equal(slot.objectType, 'File');
  assert.equal(slot.win32FileType, 2);
  assert.equal(slot.objectName.toLowerCase(), '\\device\\null');
  assert.equal(slot.nameStatus, 'observed');
  assert.match(slot.grantedAccess, /^0x[0-9A-F]{8}$/u);
  const access = Number.parseInt(slot.grantedAccess.slice(2), 16);
  assert.equal((access & 1) !== 0, read);
  assert.equal((access & 2) !== 0, write);
  assert.equal(slot.readData, read);
  assert.equal(slot.writeData, write);
  assert.equal(slot.matches, matched);
}

function checkSlots(outcome, mapping, fixture) {
  assert.equal(outcome.stderr.length, 0);
  const value = JSON.parse(outcome.stdout.toString('utf8'));
  assert.equal(value.schema, 'gg438-stdio-observation/v1');
  assert.equal(value.pid, fixture.pid);
  assert.equal(value.birthFileTime, fixture.birthFileTime);
  assert.equal(value.image, nodePath);
  assert.equal(value.machine, 'native-amd64');
  const [base] = value.localStdHandleOffsets;
  assert(Number.isInteger(base) && base >= 16 && base <= 72 && base % 8 === 0);
  assert.deepEqual(value.localStdHandleOffsets, [base, base + 8, base + 16]);
  assert.equal(value.dosNullCurrentTarget.toLowerCase(), '\\device\\null');
  assert.equal(value.status, mapping === 'positive' ? 'matched' : 'nonconforming');
  const [input, output, error] = value.slots;
  assert.deepEqual(value.slots.map(({ slot }) => slot), ['stdin', 'stdout', 'stderr']);
  checkNull(input, true, false, true);
  checkNull(error, false, true, true);
  if (mapping === 'positive') checkNull(output, false, true, true);
  if (mapping === 'wrong-direction') checkNull(output, true, false, false);
  if (mapping === 'wrong-destination') {
    assert.equal(output.objectType, 'File');
    assert.equal(output.win32FileType, 3);
    assert.equal(output.objectName, null);
    assert.equal(output.nameStatus, 'outside-character-device-probe');
    assert.match(output.grantedAccess, /^0x[0-9A-F]{8}$/u);
    assert((Number.parseInt(output.grantedAccess.slice(2), 16) & 2) !== 0);
    assert.equal(output.writeData, true);
    assert.equal(output.matches, false);
  }
  return value;
}

function checkRefusal(outcome, message) {
  assert.equal(outcome.stdout.length, 0);
  const error = JSON.parse(outcome.stderr.toString('utf8'));
  assert.equal(error.schema, 'gg438-stdio-observation/v1');
  assert.equal(error.status, 'inconclusive');
  assert.equal(error.reason, message);
  assert(!Object.hasOwn(error, 'slots'));
}

async function runFixture(mapping) {
  const host = await start(mapping + '-host', paths.fixtureExe, [mapping, nodePath]);
  const state = { mapping, hostPid: host.child.pid, naturalExit: false };
  fixtureResults.push(state);
  try {
    const receiptError = await host.spawnReceipt;
    if (receiptError) throw receiptError;
    const readyLine = await within(Promise.race([
      host.first, host.done.then(() => { throw new Error('Fixture host closed before spawn receipt'); }),
    ]), 5000, mapping + ' spawn receipt');
    const fixture = JSON.parse(readyLine);
    state.fixturePid = fixture.pid;
    state.birthFileTime = fixture.birthFileTime;
    checkSpawn(fixture, mapping);
    await artifact(mapping + '-fixture.json', fixture);
    const witness = await observe(mapping + '-observer', fixture.pid, fixture.birthFileTime,
      nodePath, mapping === 'positive' ? 0 : 1);
    const slots = checkSlots(witness, mapping, fixture);
    await artifact(mapping + '-checked-slots.json', slots);
    if (mapping === 'positive') {
      const wrongBirth = (BigInt(fixture.birthFileTime) + 1n).toString();
      checkRefusal(await observe('wrong-birth-observer', fixture.pid, wrongBirth, nodePath, 2),
        'Target creation FILETIME mismatch');
      checkRefusal(await observe('wrong-image-observer', fixture.pid, fixture.birthFileTime,
        join(scratch, 'different-node.exe'), 2), 'Target executable mismatch');
    }
  } catch (error) {
    await fail(mapping, error);
    throw error;
  } finally {
    try {
      await within(host.done, 40000, mapping + ' natural host close');
    } catch (error) {
      abandon(host);
      await fail(mapping + ' natural exit', error);
    }
    const outcome = await capture(host);
    try {
      settled(outcome, 0);
      assert.equal(outcome.stderr.length, 0);
      const lines = outcome.stdout.toString('utf8').trimEnd().split(/\r?\n/u);
      assert.equal(lines.length, 2);
      const spawned = JSON.parse(lines[0]);
      const ended = JSON.parse(lines[1]);
      assert.equal(spawned.outcome, 'spawned');
      assert.equal(ended.outcome, 'natural-exit');
      assert.equal(ended.schema, spawned.schema);
      assert.equal(ended.mapping, mapping);
      assert.equal(ended.pid, spawned.pid);
      assert.equal(ended.exitCode, 0);
      Object.assign(state, { fixturePid: spawned.pid, born: spawned.birthFileTime,
        fixtureExitCode: ended.exitCode, hostExit: outcome.record.exit, hostClose: outcome.record.close,
        naturalExit: true });
    } catch (error) {
      await fail(mapping + ' close receipt', error);
    }
  }
  assert(!firstFailure, 'Routine cleanup failed');
}

try {
  for (const mapping of ['positive', 'wrong-direction', 'wrong-destination']) await runFixture(mapping);
  assert(fixtureResults.every(({ naturalExit }) => naturalExit));
  assert.equal(dirname(scratch), attemptDir);
  assert.equal(await realpath(scratch), scratch);
  assert((await lstat(scratch)).isDirectory());
  assert.deepEqual(await readdir(scratch), [], 'Fixture scratch retained files');
  await rmdir(scratch);
  await assert.rejects(lstat(scratch), { code: 'ENOENT' });
  released = true;
} catch (error) {
  await fail('execution or owned scratch cleanup', error);
} finally {
  try {
    const closing = await verify();
    assert.deepEqual(closing, opening);
    await artifact('closing-binding.json', closing);
  } catch (error) {
    await fail('closing binding', error);
  }
  await artifact('cleanup.json', { scratch, scratchRemoved: released, fixtures: fixtureResults });
  await artifact('result.json', { status: firstFailure ? 'incomplete' : 'observed',
    at: timestamp(), ...(firstFailure ? { firstFailure } : {}) });
  console.log(JSON.stringify({ attempt: admission.attempt, evidence,
    status: firstFailure ? 'incomplete' : 'observed' }));
  process.exitCode = firstFailure ? 1 : 0;
}


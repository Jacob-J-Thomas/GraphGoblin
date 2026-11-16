import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  close as callbackClose, constants, fstat as callbackFstat, fstatSync, linkSync, lstatSync,
  mkdirSync, open as callbackOpen, readFileSync, readdirSync,
  realpathSync, renameSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { open as openFileHandle } from 'node:fs/promises';
import { promisify } from 'node:util';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';

const source = fileURLToPath(import.meta.url);
const root = process.cwd();
const [role, ...args] = process.argv.slice(2);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const utf8 = new TextDecoder('utf-8', { fatal: true });
const limit = 64 * 1024;
const closeDescriptor = promisify(callbackClose);
const statDescriptor = promisify(callbackFstat);
const openDescriptor = promisify(callbackOpen);
const retryWindow = 1500;
const retryInterval = 25;
const gcActions = ['gc-raw', 'gc-filehandle'];
let reservationDescriptor;
const own = process.geteuid?.();
const path = (name) => join(root, name);
const node = realpathSync(process.execPath);
const tool = path('capability');
const deadline = performance.now() + 105_000;
const report = { schema: 'gg456-darwin-log-capability/v3', root, at: new Date().toISOString(),
  commands: [], cases: {}, scratchRetained: true };

function verifyWorkspace() {
  assert.equal(process.platform, 'darwin');
  assert.equal(process.arch, 'arm64');
  assert.match(process.versions.node, /^22\.[0-9]+\.[0-9]+$/u);
  const [, minor, patch] = process.versions.node.split('.').map(Number);
  assert(minor > 22 || (minor === 22 && patch >= 2));
  assert(own > 0 && own === process.getuid());
  assert.deepEqual(process.execArgv, role === 'node-lock' && gcActions.includes(args[1]) ? ['--expose-gc'] : []);
  assert.equal(realpathSync(root), root);
  assert(root.startsWith(realpathSync(homedir()) + '/'));
  assert.match(basename(root), /^gg456-logcap-[a-f0-9]{32}$/u);
  const meta = lstatSync(root);
  assert(meta.isDirectory() && !meta.isSymbolicLink() && meta.uid === own && (meta.mode & 0o7777) === 0o700);
  assert.equal(source, path('probe.mjs'));
}

function fact(stat) {
  return { dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid), mode: Number(stat.mode & 0o7777n),
    nlink: String(stat.nlink),
    kind: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : stat.isSymbolicLink() ? 'symlink' : 'other' };
}
const id = (value) => [value.dev, value.ino];
const factAt = (name) => fact(lstatSync(path(name), { bigint: true }));
const freshFile = (name, bytes = 'disposable capability sentinel\n', mode = 0o600) =>
  writeFileSync(path(name), bytes, { flag: 'wx', mode });
const makeDir = (name) => mkdirSync(path(name), { mode: 0o700 });

function fixtureLockPath(relative, resolveAlias) {
  assert.match(relative, /^locks\/[a-zA-Z0-9_/\p{L}\p{M}\p{N}-]{1,70}$/u);
  assert(!relative.includes('//') && !relative.endsWith('/'));
  const name = path(relative);
  assert.equal(realpathSync(dirname(name)), dirname(name));
  if (!resolveAlias) return name;
  const physical = realpathSync(name);
  assert(physical.startsWith(path('locks') + '/'));
  return physical;
}

async function emit(value) {
  await new Promise((resolve, reject) =>
    process.stdout.write(JSON.stringify(value) + '\n', (error) => error ? reject(error) : resolve()));
}

function input(ms) {
  return new Promise((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      process.stdin.off('data', onData);
      process.stdin.off('end', onEnd);
      process.stdin.pause();
    };
    const onData = (bytes) => { stop(); resolve(Buffer.from(bytes)); };
    const onEnd = () => { stop(); resolve(null); };
    const timer = setTimeout(() => { stop(); reject(new Error('fixture input deadline')); }, ms);
    if (process.stdin.readableEnded) { onEnd(); return; }
    process.stdin.once('data', onData).once('end', onEnd).resume();
  });
}

async function acquire(physical, flags, retry) {
  const started = performance.now();
  const deadline = started + retryWindow;
  let attempts = 0;
  let lastAttemptMs = 0;
  let failure;
  for (;;) {
    const now = performance.now();
    if (attempts > 0 && now >= deadline) break;
    attempts++;
    lastAttemptMs = now - started;
    try {
      const fd = await openDescriptor(physical, flags, 0o600);
      return { fd, attempts, lastAttemptMs, elapsedMs: performance.now() - started };
    } catch (error) {
      failure = error;
      if (!retry || error.code !== 'EAGAIN') break;
      if (attempts === 1) await emit({ state: 'retrying', code: error.code, errno: error.errno, pid: process.pid });
      const remaining = deadline - performance.now();
      if (remaining <= 0) break;
      await pause(Math.min(retryInterval, remaining));
    }
  }
  return { failure, attempts, lastAttemptMs, elapsedMs: performance.now() - started };
}

async function abandonFileHandleAfterCue(physical, flags) {
  const handle = await openFileHandle(physical, flags);
  const fd = handle.fd;
  assert(fd >= 3 && fd < 1024);
  const original = fact(await handle.stat({ bigint: true }));
  await emit({ state: 'filehandle-held', pid: process.pid, descriptor: fd, original });
  assert.deepEqual(await input(3000), Buffer.from('g'));
  assert.equal(handle.fd, fd);
  return fd;
}

async function gcNegative(physical, flags) {
  const fd = await abandonFileHandleAfterCue(physical, flags);
  const original = fact(await statDescriptor(fd, { bigint: true }));
  for (let round = 1; round <= 20; round++) {
    global.gc();
    await pause(20);
    try {
      const current = fact(await statDescriptor(fd, { bigint: true }));
      assert.deepEqual(id(current), id(original), 'descriptor number reused before exact close readback');
    } catch (error) {
      if (error.code !== 'EBADF') throw error;
      await emit({ state: 'filehandle-gc-closed', pid: process.pid, descriptor: fd, rounds: round, code: error.code });
      assert.equal(await input(6000), null);
      return;
    }
  }
  throw new Error('FileHandle GC negative control did not close within 20 rounds');
}

async function nodeLock([relative, action, mask]) {
  const held = ['hold', 'race', 'exit-with-descendant', 'flush-owner', 'gc-raw'];
  const retry = ['retry', 'retry-nofollow'].includes(action);
  assert([...held, ...gcActions, 'observe', 'plain', 'retry', 'retry-nofollow'].includes(action));
  const exlock = Number(mask);
  assert.equal(exlock, 0x20);
  if (action === 'race') {
    await emit({ state: 'armed', pid: process.pid });
    assert.deepEqual(await input(3000), Buffer.from('s'));
  }
  const physical = fixtureLockPath(relative, action !== 'retry-nofollow');
  const flags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  if (action === 'gc-filehandle') return gcNegative(physical, flags | exlock);
  const acquired = await acquire(physical, flags | (action === 'plain' ? 0 : exlock), retry);
  const { fd, failure, attempts, elapsedMs, lastAttemptMs } = acquired;
  const witness = { attempts, elapsedMs, lastAttemptMs };
  if (failure) {
    await emit({ state: 'refused', code: failure.code, errno: failure.errno, pid: process.pid, ...witness });
    return;
  }
  assert.equal(reservationDescriptor, undefined);
  reservationDescriptor = fd;
  try {
    assert(Number.isInteger(fd) && fd >= 3 && fd < 1024);
    const opened = fact(await statDescriptor(fd, { bigint: true }));
    assert(opened.kind === 'directory' && opened.uid === own);
    assert.deepEqual(opened, fact(lstatSync(physical, { bigint: true })));
    let descendant;
    if (action === 'exit-with-descendant') {
      const child = spawn(node, [source, 'descendant', String(fd), ...id(opened)], {
        cwd: root, env: process.env, detached: true, stdio: 'ignore',
      });
      try {
        await new Promise((resolve, reject) => child.once('spawn', resolve).once('error', reject));
        descendant = child.pid;
      } finally { child.unref(); }
    }
    if (action === 'gc-raw') {
      for (let round = 0; round < 6; round++) {
        global.gc();
        await pause(20);
      }
      assert.deepEqual(fact(await statDescriptor(reservationDescriptor, { bigint: true })), opened);
    }
    await emit({ state: 'opened', pid: process.pid, opened, descriptor: fd, descendant,
      gcRounds: action === 'gc-raw' ? 6 : undefined, ...witness });
    if (action === 'gc-raw') {
      assert.deepEqual(await input(3000), Buffer.from('d'));
      const second = await openDescriptor(physical, flags, 0o600);
      try {
        assert.notEqual(second, reservationDescriptor);
        assert.deepEqual(fact(await statDescriptor(second, { bigint: true })), opened);
      } finally { await closeDescriptor(second); }
      await emit({ state: 'ordinary-descriptor-closed', pid: process.pid, descriptor: second });
    }
    if (action === 'flush-owner') {
      assert.deepEqual(await input(6000), Buffer.from('f'));
      const began = performance.now();
      await pause(150);
      await emit({ state: 'flush-ended', pid: process.pid, simulatedFlushMs: performance.now() - began });
      process.exit(0);
    }
    if (held.includes(action)) assert.equal(await input(10_000), null, 'release is exact controller EOF');
    if (action === 'exit-with-descendant') process.exit(0);
  } finally {
    await closeDescriptor(reservationDescriptor);
    reservationDescriptor = undefined;
  }
}

async function descendant([slot, device, inode]) {
  const descriptor = Number(slot);
  assert(Number.isInteger(descriptor) && descriptor >= 3 && descriptor < 1024);
  assert.match(device, /^\d+$/u);
  assert.match(inode, /^\d+$/u);
  const matched = [];
  let knownSlot = null;
  for (let fd = 0; fd < 1024; fd++) {
    try {
      const entry = fact(fstatSync(fd, { bigint: true }));
      if (fd === descriptor) knownSlot = entry;
      if (entry.dev === device && entry.ino === inode) matched.push(fd);
    } catch (error) { if (error.code !== 'EBADF') throw error; }
  }
  freshFile('descendant-ready.json', JSON.stringify({ pid: process.pid, ppid: process.ppid,
    descriptor, knownSlot, matched, checkedThrough: 1023 }) + '\n');
  // This owner-independent deadline applies even if the driver or original parent disappears.
  const until = performance.now() + 12_000;
  while (performance.now() < until) {
    const release = completeMarker('descendant-release.json');
    if (release) {
      assert.equal(release.pid, process.pid);
      freshFile('descendant-exit.json', JSON.stringify({ pid: process.pid, disposition: 'natural-release' }) + '\n');
      return;
    }
    await pause(35);
  }
  freshFile('descendant-exit.json', JSON.stringify({ pid: process.pid, disposition: 'self-deadline' }) + '\n');
  process.exitCode = 1;
}

const env = {
  HOME: homedir(), TMPDIR: path('temp'), PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8',
};

async function until(label, ms, attempt) {
  const stop = Math.min(deadline, performance.now() + ms);
  while (performance.now() < stop) {
    const value = await attempt();
    if (value !== undefined) return value;
    await pause(20);
  }
  throw new Error(label + ' deadline');
}

function oneLine(bytes) {
  const lines = utf8.decode(bytes).split('\n');
  assert.equal(lines.pop(), '');
  assert.equal(lines.length, 1);
  return JSON.parse(lines[0]);
}

function completeMarker(name) {
  try {
    const bytes = readFileSync(path(name));
    return bytes.at(-1) === 10 ? oneLine(bytes) : undefined;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  }
}

function waitBounded(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((resolve) => { timer = setTimeout(() => resolve(false), ms); })])
    .finally(() => clearTimeout(timer));
}

async function command(label, executable, argv, timeout, work, childEnv = env) {
  assert(report.commands.length < 80 && performance.now() < deadline, 'command budget');
  const started = performance.now();
  const number = String(report.commands.length + 1).padStart(2, '0');
  const record = { label, executable, argv, startedAt: new Date().toISOString(), bytes: { stdout: 0, stderr: 0 },
    streams: {}, process: {} };
  report.commands.push(record);
  const chunks = { stdout: [], stderr: [] };
  let finished;
  let closed = false;
  const combined = (stream) => Buffer.concat(chunks[stream]);
  const child = spawn(executable, argv, { cwd: root, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    record.process.pid = child.pid ?? null;
    child.stdin.on('error', (error) => { record.process.inputError = error.code; });
    finished = new Promise((resolve) => {
      child.once('error', (error) => { record.process.spawnError = error.code; });
      child.once('exit', (code, signal) => { record.process.exit = { code, signal }; });
      child.once('close', (code, signal) => {
        closed = true;
        record.process.close = { code, signal };
        resolve(true);
      });
    });
    for (const stream of ['stdout', 'stderr']) {
      child[stream].on('data', (bytes) => {
        const remaining = Math.max(0, limit - record.bytes[stream]);
        if (remaining) chunks[stream].push(bytes.subarray(0, remaining));
        record.bytes[stream] += bytes.length;
      });
      child[stream].once('end', () => { record.streams[stream] = { eof: true, bytes: record.bytes[stream] }; });
    }
    const left = () => Math.max(0, Math.min(started + timeout, deadline) - performance.now());
    const wait = async () => {
      child.stdin.end();
      assert(await waitBounded(finished, left()), label + ' timed out');
      assert.equal(record.process.spawnError, undefined, label);
      assert.deepEqual(record.process.exit, { code: 0, signal: null }, label + ' exact exit');
      assert.deepEqual(record.process.close, record.process.exit, label + ' exact pipe close');
      for (const stream of ['stdout', 'stderr']) {
        assert(record.bytes[stream] <= limit && record.streams[stream]?.eof, label + ' capture incomplete');
      }
      return { stdout: combined('stdout'), stderr: combined('stderr'), pid: child.pid };
    };
    const line = (index = 0) => until(label + ' complete output record', left(), () => {
      const captured = combined('stdout');
      const lastLF = captured.lastIndexOf(10);
      const lines = lastLF < 0 ? [] : utf8.decode(captured.subarray(0, lastLF)).split('\n');
      if (lines.length > index) return JSON.parse(lines[index]);
      if (closed) throw new Error(label + ' closed before expected output record');
      return undefined;
    });
    if (!work) return await wait();
    return await work({ line, send: (bytes) => child.stdin.write(bytes), wait, pid: child.pid });
  } finally {
    child.stdin.end();
    if (finished && !closed) await waitBounded(finished, 1500);
    if (!closed) {
      record.process.disposition = 'exact child exit unresolved';
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
    }
    record.ms = performance.now() - started;
    for (const stream of ['stdout', 'stderr']) freshFile('evidence/' + number + '-' + stream + '.raw', combined(stream));
    freshFile('evidence/' + number + '-process.json', JSON.stringify(record, null, 2) + '\n');
  }
}

function nodeCommand(label, relative, action, work) {
  const timeout = action === 'retry' ? 2600 : work ? 9000 : 2300;
  const flags = gcActions.includes(action) ? ['--expose-gc'] : [];
  return command(label, node, [...flags, source, 'node-lock', relative, action, '32'], timeout, work);
}

function nativeCommand(label, argv, work) {
  return command(label, tool, argv, work ? 10_000 : 2300, work);
}

async function readNative(label, ...argv) {
  const raw = await nativeCommand(label, argv);
  assert.equal(raw.stderr.length, 0);
  return oneLine(raw.stdout);
}

async function readNode(label, relative, mode = 'observe') {
  const raw = await nodeCommand(label, relative, mode);
  assert.equal(raw.stderr.length, 0);
  return oneLine(raw.stdout);
}

function requireNodeBusy(value) {
  assert.deepEqual([value.state, value.code, value.errno], ['refused', 'EAGAIN', -35]);
}

async function lockCases() {
  const physical = 'locks/base/Root-Å';
  const alias = 'locks/alias';
  const disjoint = 'locks/other';
  const expected = factAt(physical);
  const aliases = [physical, alias];
  for (const name of ['locks/base/root-å', 'locks/base/Root-A\u030a']) {
    try {
      if (id(factAt(name)).join(':') === id(expected).join(':')) aliases.push(name);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const snapshot = () => ({ top: readdirSync(path('locks')).sort(), base: readdirSync(path('locks/base')).sort(),
    root: readdirSync(path(physical)).sort(), marker: sha(readFileSync(path(physical + '/sentinel'))),
    current: factAt(physical), separate: factAt(disjoint) });
  const before = snapshot();
  const controls = {};
  report.cases.locks = { aliases, before, controls };
  controls.rawAliasNoFollow = await readNode('non-EAGAIN lexical alias does not retry', alias, 'retry-nofollow');
  assert.equal(controls.rawAliasNoFollow.state, 'refused');
  assert(['ELOOP', 'ENOTDIR'].includes(controls.rawAliasNoFollow.code));
  assert.equal(controls.rawAliasNoFollow.attempts, 1);

  await nodeCommand('Node O_EXLOCK owner', physical, 'hold', async (owner) => {
    controls.nodeOwner = await owner.line();
    assert.deepEqual(controls.nodeOwner.opened, expected);
    controls.swiftContender = await readNative('Swift flock contender through alias', 'lock', alias);
    assert.deepEqual([controls.swiftContender.state, controls.swiftContender.errno], ['refused', 35]);
    assert.deepEqual(controls.swiftContender.opened, expected);
    controls.nodeAliases = [];
    for (const name of aliases) {
      const contender = await readNode('Node locked physical alias', name);
      controls.nodeAliases.push({ name, contender });
      requireNodeBusy(contender);
    }
    controls.plain = await readNode('Node ordinary open while lock held', alias, 'plain');
    assert.deepEqual(controls.plain.opened, expected);
    controls.disjoint = await readNode('Node disjoint lock while owner held', disjoint);
    assert.deepEqual(controls.disjoint.opened, factAt(disjoint));
    await owner.wait();
  });
  controls.explicitClose = await readNative('Swift successor after explicit Node close', 'lock', physical);
  assert.deepEqual([controls.explicitClose.state, controls.explicitClose.opened], ['locked', expected]);

  await nativeCommand('Swift parent vnode flock while gateway root held', ['lock', 'locks/base'], async (parent) => {
    controls.parentOwner = await parent.line();
    assert.equal(controls.parentOwner.state, 'locked');
    await nodeCommand('independent gateway directory reservation', alias, 'hold', async (gateway) => {
      assert.deepEqual((await gateway.line()).opened, expected);
      controls.parentAlias = await readNative('second Swift parent contender alias', 'lock', 'locks/base-alias');
      assert.deepEqual([controls.parentAlias.state, controls.parentAlias.errno,
        ...id(controls.parentAlias.opened)], ['refused', 35, ...id(controls.parentOwner.opened)]);
      controls.otherParent = await readNative('independent second Swift parent', 'lock', 'locks/other-parent');
      assert.equal(controls.otherParent.state, 'locked');
      requireNodeBusy(await readNode('Node contender while independent Swift parent held', alias));
      await gateway.wait();
    });
    // Independently prove that Node-style exclusive open conflicts with Swift on the same vnode.
    controls.reverse = await readNode('Node O_EXLOCK conflicts with Swift flock', 'locks/base-alias');
    requireNodeBusy(controls.reverse);
    await parent.wait();
  });

  await nodeCommand('Node race contender A', physical, 'race', async (a) =>
    nodeCommand('Node race contender B', alias, 'race', async (b) => {
      const armed = await Promise.all([a.line(), b.line()]);
      assert(armed.every((row) => row.state === 'armed'));
      a.send('s'); b.send('s');
      controls.race = await Promise.all([a.line(1), b.line(1)]);
      assert.deepEqual(controls.race.map((row) => row.state).sort(), ['opened', 'refused']);
      requireNodeBusy(controls.race.find((row) => row.state === 'refused'));
      assert.deepEqual(controls.race.find((row) => row.state === 'opened').opened, expected);
      await Promise.all([a.wait(), b.wait()]);
    }));
  assert.deepEqual(snapshot(), before);
}

async function gcCases() {
  const controls = {};
  const target = 'locks/other';
  report.cases.garbageCollection = controls;
  await nodeCommand('raw reservation after forced GC', target, 'gc-raw', async (owner) => {
    controls.owner = await owner.line();
    assert.deepEqual([controls.owner.state, controls.owner.gcRounds], ['opened', 6]);
    controls.afterGC = await readNode('contender after six raw descriptor GC rounds', target);
    requireNodeBusy(controls.afterGC);
    owner.send('d');
    controls.secondDescriptor = await owner.line(1);
    assert.equal(controls.secondDescriptor.state, 'ordinary-descriptor-closed');
    assert.notEqual(controls.secondDescriptor.descriptor, controls.owner.descriptor);
    controls.afterSecondClose = await readNode('contender after ordinary descriptor close', target);
    requireNodeBusy(controls.afterSecondClose);
    await owner.wait();
  });

  await nodeCommand('unreferenced FileHandle GC negative', target, 'gc-filehandle', async (owner) => {
    controls.fileHandle = await owner.line();
    assert.equal(controls.fileHandle.state, 'filehandle-held');
    requireNodeBusy(await readNode('FileHandle still held before forcing GC', target));
    owner.send('g');
    controls.collected = await owner.line(1);
    assert.deepEqual([controls.collected.state, controls.collected.descriptor,
      controls.collected.pid, controls.collected.code],
    ['filehandle-gc-closed', controls.fileHandle.descriptor, owner.pid, 'EBADF']);
    assert(controls.collected.rounds >= 1 && controls.collected.rounds <= 20);
    controls.successor = await readNode('successor after FileHandle GC while original process lives', target);
    assert.deepEqual([controls.successor.state, ...id(controls.successor.opened)],
      ['opened', ...id(controls.fileHandle.original)]);
    await owner.wait();
  });
}

async function retryCases() {
  const target = 'locks/other';
  const controls = {};
  report.cases.releaseOverlap = controls;
  await nodeCommand('old reservation held during simulated final flush', target, 'flush-owner', async (old) => {
    controls.old = await old.line();
    assert.equal(controls.old.state, 'opened');
    await nodeCommand('same spawned contender during old flush', target, 'retry', async (next) => {
      controls.initialBusy = await next.line();
      assert.deepEqual([controls.initialBusy.state, controls.initialBusy.code], ['retrying', 'EAGAIN']);
      old.send('f');
      controls.flush = await old.line(1);
      assert.equal(controls.flush.state, 'flush-ended');
      assert(controls.flush.simulatedFlushMs <= 250, 'controlled flush exceeded the 250 ms fixture cap');
      await old.wait();
      controls.resumed = await next.line(1);
      assert.deepEqual([controls.resumed.state, controls.resumed.pid], ['opened', controls.initialBusy.pid]);
      assert(controls.resumed.attempts > 1 && controls.resumed.elapsedMs <= retryWindow);
      await next.wait();
    });
  });
  await nodeCommand('persistent reservation holder', target, 'hold', async (owner) => {
    assert.equal((await owner.line()).state, 'opened');
    await nodeCommand('bounded retry against persistent holder', target, 'retry', async (next) => {
      controls.persistentInitial = await next.line();
      assert.equal(controls.persistentInitial.state, 'retrying');
      controls.persistent = await next.line(1);
      requireNodeBusy(controls.persistent);
      assert.equal(controls.persistent.pid, controls.persistentInitial.pid);
      assert(controls.persistent.attempts > 1 && controls.persistent.elapsedMs >= retryWindow);
      assert(controls.persistent.lastAttemptMs < retryWindow, 'open attempted after the retry window');
      await next.wait();
    });
    await owner.wait();
  });
}

async function orphanCase() {
  report.cases.orphan = {};
  const capture = report.cases.orphan;
  let witness;
  try {
    await nodeCommand('Node lock lifetime owner with detached descendant', 'locks/other', 'exit-with-descendant', async (owner) => {
      const acquired = await owner.line();
      assert.equal(acquired.state, 'opened');
      assert(Number.isSafeInteger(acquired.descendant) && acquired.descendant > 1);
      capture.owner = acquired;
      witness = await readNative('inspect exact spawned descendant birth', 'birth', String(acquired.descendant));
      assert.equal(witness.state, 'live');
      assert.equal(witness.pid, acquired.descendant);
      assert.equal(witness.executable, node);
      assert.equal(witness.ppid, owner.pid);
      capture.beforeParentExit = witness;
      const ready = await until('descendant FD scan', 2000, () => completeMarker('descendant-ready.json'));
      capture.ready = ready;
      assert.deepEqual([ready.pid, ready.ppid, ready.descriptor, ready.checkedThrough],
        [witness.pid, owner.pid, acquired.descriptor, 1023]);
      assert.deepEqual(ready.matched, [], 'descendant inherited the reserved inode');
      const busy = await readNode('successor refuses while owner live', 'locks/other');
      requireNodeBusy(busy);
      await owner.wait();
      capture.directOwnerExited = true;
    });
    const orphan = await readNative('observe same descendant after direct owner exit', 'birth', String(witness.pid));
    capture.afterParentExit = orphan;
    assert.deepEqual([orphan.state, orphan.birth, orphan.executable], ['live', witness.birth, node]);
    assert.notEqual(orphan.ppid, witness.ppid);
    capture.successor = await readNode('successor admits while descendant remains live', 'locks/other');
    assert.equal(capture.successor.state, 'opened');
    const live = await readNative('same descendant live after successor', 'birth', String(witness.pid));
    assert.deepEqual([live.state, live.birth], ['live', witness.birth]);
  } finally {
    if (witness?.state === 'live' && capture.owner?.descendant === witness.pid && witness.executable === node) {
      freshFile('descendant-release.json', JSON.stringify({ pid: witness.pid }) + '\n');
      // A natural TTL exists even if the cleanup readback itself cannot be taken.
    }
  }
  capture.ended = await until('descendant exact birth gone', 3500, async () => {
    await pause(40);
    const ended = await readNative('observe descendant terminal birth', 'birth', String(witness.pid));
    return ended.state === 'absent' || ended.birth !== witness.birth ? ended : undefined;
  });
  const ended = JSON.parse(readFileSync(path('descendant-exit.json'), 'utf8'));
  assert.deepEqual(ended, { pid: witness.pid, disposition: 'natural-release' });
  capture.naturalCompletion = ended;
}

async function aclCases() {
  const checks = {};
  report.cases.acl = checks;
  async function inspect(name) {
    const observed = await readNative('descriptor metadata ' + name, 'inspect', name);
    assert.deepEqual(observed.opened, factAt(name));
    assert.deepEqual(observed.named, observed.opened);
    assert.deepEqual([observed.local, observed.enforcesOwnership, observed.fs], [true, true, 'apfs']);
    assert(observed.aclCapability > 0 && observed.aclCapabilityErrno === 0);
    assert.equal(observed.aclPropertyStatus, 0);
    assert.equal(observed.opened.uid, own);
    checks[name] = observed;
    return observed;
  }
  async function acl(name, rule) {
    const before = factAt(name);
    assert(before.uid === own && ['file', 'directory'].includes(before.kind));
    const result = await command('chmod only disposable ACL fixture ' + name, '/bin/chmod',
      ['+a', rule, path(name)], 2000);
    assert.deepEqual([result.stdout.length, result.stderr.length], [0, 0]);
  }
  const plainDir = await inspect('acl/private');
  const plainFile = await inspect('acl/private/file');
  assert.deepEqual([plainDir.opened.mode, plainFile.opened.mode], [0o700, 0o600]);
  for (const observed of [plainDir, plainFile]) assert(['absent', 'empty'].includes(observed.acl.state));
  await acl('acl/deny', 'everyone deny delete');
  assert.deepEqual((await inspect('acl/deny')).acl, { state: 'present', entries: ['deny'] });
  await acl('acl/explicit', 'everyone allow read,search,readattr');
  assert.deepEqual((await inspect('acl/explicit')).acl, { state: 'present', entries: ['allow'] });
  const beforeInheritance = await inspect('acl/inherit');
  assert(['absent', 'empty'].includes(beforeInheritance.acl.state));
  checks.inheritanceParentBefore = beforeInheritance;
  await acl('acl/inherit', 'everyone allow read,search,readattr,file_inherit,directory_inherit');
  assert.deepEqual((await inspect('acl/inherit')).acl, { state: 'present', entries: ['allow'] });
  freshFile('acl/inherit/new-file');
  const inherited = await inspect('acl/inherit/new-file');
  assert.equal(inherited.opened.mode, 0o600);
  assert.deepEqual(inherited.acl, { state: 'present', entries: ['allow'] });
  assert.equal((await inspect('acl/broad-mode')).opened.mode, 0o755);
  assert.equal((await inspect('acl/broad-mode/file')).opened.mode, 0o644);
  const aliased = await inspect('acl/hard-link');
  assert.equal(aliased.opened.nlink, '2');
  assert.deepEqual(id(aliased.opened), id(factAt('acl/link-target')));
  for (const name of ['acl/symlink', 'acl/dangling']) {
    const observation = await readNative('no-follow metadata refusal ' + name, 'inspect', name);
    checks[name] = observation;
    assert.equal(observation.state, 'open-refused');
    assert.equal(observation.named.kind, 'symlink');
  }
  const bad = await readNative('real descriptor query error', 'bad-fd');
  checks.invalidDescriptor = bad;
  assert.deepEqual(bad, { state: 'query-error', operation: 'fstatx_np', errno: 9 });
  const prior = await inspect('acl/replaced');
  renameSync(path('acl/replaced'), path('acl/old'));
  freshFile('acl/replaced');
  const replacement = await inspect('acl/replaced');
  checks.replacement = { prior, replacement };
  assert.notDeepEqual(id(prior.opened), id(replacement.opened));
  assert.deepEqual(id(factAt('acl/old')), id(prior.opened));
}

function seed() {
  for (const dir of ['locks', 'locks/base', 'locks/base/Root-Å', 'locks/other', 'locks/other-parent', 'acl',
    'acl/private', 'acl/explicit', 'acl/deny', 'acl/inherit', 'acl/broad-mode']) makeDir(dir);
  freshFile('locks/base/Root-Å/sentinel');
  symlinkSync('base/Root-Å', path('locks/alias'));
  symlinkSync('base', path('locks/base-alias'));
  for (const name of ['acl/private/file', 'acl/link-target', 'acl/replaced']) freshFile(name);
  // The scratch-only broad-mode negatives are deliberately readable by mode but live below the private root.
  freshFile('acl/broad-mode/file');
  linkSync(path('acl/link-target'), path('acl/hard-link'));
  symlinkSync('link-target', path('acl/symlink'));
  symlinkSync('missing', path('acl/dangling'));
}

async function driver([admissionDigest]) {
  assert.match(admissionDigest, /^[0-9a-f]{64}$/u);
  assert.deepEqual(readdirSync(root).sort(), ['Capability.swift', 'admission.json', 'probe.mjs']);
  const admissionBytes = readFileSync(path('admission.json'));
  assert.equal(sha(admissionBytes), admissionDigest);
  const cfg = JSON.parse(utf8.decode(admissionBytes));
  assert.equal(cfg.schema, 'gg456-darwin-log-capability-admission/v3');
  assert.equal(cfg.root, root);
  assert.equal(cfg.node, node);
  assert.equal(cfg.nodeVersion, process.versions.node);
  assert.equal(sha(readFileSync(node)), cfg.nodeSha256);
  assert(['owner-mac', 'hosted-macos-15'].includes(cfg.platform));
  assert.equal(sha(readFileSync(source)), cfg.driverSha256);
  assert.equal(sha(readFileSync(path('Capability.swift'))), cfg.swiftSha256);
  assert((cfg.platform === 'owner-mac' && cfg.os === '26.6.2') ||
    (cfg.platform === 'hosted-macos-15' && /^15\.[0-9]+(?:\.[0-9]+)?$/u.test(cfg.os)));
  assert.match(cfg.build, /^[A-Za-z0-9]{4,15}$/u);
  const admit = { ...cfg, admissionDigest };
  for (const dir of ['temp', 'evidence', 'module-cache', 'compiler-home']) makeDir(dir);
  process.umask(0o077);
  report.admission = admit;
  report.node = { path: node, versions: process.versions, uid: own };

  try {
    const os = await command('exact macOS host version', '/usr/bin/sw_vers', [], 2000);
    assert.equal(os.stderr.length, 0);
    const osText = utf8.decode(os.stdout);
    const osMatch = osText.match(/^ProductVersion:\s+([0-9.]+)$/mu);
    const build = osText.match(/^BuildVersion:\s+([A-Za-z0-9]+)$/mu);
    assert.deepEqual([osMatch?.[1], build?.[1]], [cfg.os, cfg.build]);
    const compilerEnv = { ...env, HOME: path('compiler-home') };
    const sdk = await command('selected native Apple SDK', '/usr/bin/xcrun',
      ['--sdk', 'macosx', '--show-sdk-path'], 4500, undefined, compilerEnv);
    const swift = await command('selected Swift compiler', '/usr/bin/xcrun',
      ['--sdk', 'macosx', '--find', 'swiftc'], 4500, undefined, compilerEnv);
    assert.deepEqual([utf8.decode(sdk.stdout).trim(), utf8.decode(swift.stdout).trim()], [cfg.sdk, cfg.swiftc]);
    assert.equal(sha(readFileSync(cfg.swiftc)), cfg.swiftcSha256);
    const expectedHeaders = ['sys/acl.h', 'sys/errno.h', 'sys/fcntl.h', 'sys/mount.h', 'sys/stat.h', 'sys/unistd.h', 'unistd.h'];
    assert.deepEqual(Object.keys(cfg.sdkHeaders).sort(), expectedHeaders);
    report.localSdkHeaders = Object.fromEntries(expectedHeaders.map((name) =>
      [name, sha(readFileSync(join(cfg.sdk, 'usr/include', name)))]));
    assert.deepEqual(report.localSdkHeaders, cfg.sdkHeaders);
    await command('compile bounded Swift fixture', '/usr/bin/xcrun', ['--sdk', 'macosx', 'swiftc',
      '-sdk', cfg.sdk, '-target', 'arm64-apple-macosx15.0', '-module-cache-path', path('module-cache'),
      '-o', tool, path('Capability.swift')], 40_000, undefined, compilerEnv);
    report.binarySha256 = sha(readFileSync(tool));
    const nativeFlags = await readNative('read Darwin SDK lock constants', 'flags');
    report.nativeFlags = nativeFlags;
    assert.deepEqual(nativeFlags, { exlock: 32, contentionErrno: 35, uid: own, nonblock: constants.O_NONBLOCK,
      readonly: constants.O_RDONLY, nofollow: constants.O_NOFOLLOW, directory: constants.O_DIRECTORY,
      widthCanary: '18446744073709551615' });

    seed();
    await command('broad owned scratch directory mode fixture', '/bin/chmod', ['755', path('acl/broad-mode')], 2000);
    await command('broad owned scratch file mode fixture', '/bin/chmod', ['644', path('acl/broad-mode/file')], 2000);
    await lockCases();
    await gcCases();
    await retryCases();
    await orphanCase();
    await aclCases();
    report.status = 'capability-observed';
  } catch (error) {
    report.firstFailure = { message: error.message, stack: error.stack, code: error.code };
    report.status = 'incomplete';
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    const json = JSON.stringify(report, null, 2) + '\n';
    freshFile('result.json', json);
    process.stdout.write(json);
  }
}

verifyWorkspace();
if (role === 'driver') await driver(args);
else if (role === 'node-lock') await nodeLock(args);
else if (role === 'descendant') await descendant(args);
else throw new Error('Unknown capability fixture role');

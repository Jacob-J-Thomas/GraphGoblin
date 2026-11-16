import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, realpathSync, writeFileSync,
} from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const branch = 'refs/heads/codex/456-macos-logcap';
const sourceSeals = {
  'fixture-v3-SHA256SUMS.txt': 'a17850d38a45eb012317ef7bde9662547a779a26435d4f7ee7e9fe881723af19',
  'Capability.swift': 'd3fe6df4b73eb5b42d8256775ddd1f6ec3e8dca121243855b2bb1df7a7188884',
  'probe.mjs': 'deeef1060f421d34994d6732483e8cd44370ef99e372eae10252c0879d821324',
};
const headers = ['sys/acl.h', 'sys/errno.h', 'sys/fcntl.h', 'sys/mount.h', 'sys/stat.h', 'sys/unistd.h', 'unistd.h'];
const markers = ['descendant-ready.json', 'descendant-release.json', 'descendant-exit.json'];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const text = (bytes) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const here = dirname(fileURLToPath(import.meta.url));
const uid = process.getuid();
const temp = realpathSync(process.env.RUNNER_TEMP);
const out = join(temp, 'gg456-logcap-evidence');
const files = {};
const receipt = { schema: 'gg456-hosted-logcap-capture/v1', startedAt: new Date().toISOString(), status: 'incomplete' };

function metadata(path) {
  const stat = lstatSync(path, { bigint: true });
  return { uid: Number(stat.uid), mode: Number(stat.mode & 0o7777n),
    dev: String(stat.dev), ino: String(stat.ino), directory: stat.isDirectory() };
}

function privateDirectory(path) {
  const stat = metadata(path);
  assert.equal(realpathSync(path), path);
  assert(stat.directory && stat.uid === uid && stat.mode === 0o700, 'private directory ' + path);
  return stat;
}

function readOrdinary(path, maxBytes, optional = false) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (optional && error.code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    assert(stat.isFile() && stat.nlink === 1 && stat.uid === uid && stat.size <= maxBytes, path);
    const bytes = readFileSync(fd);
    assert.equal(bytes.length, stat.size, path);
    return bytes;
  } finally {
    closeSync(fd);
  }
}

function retain(name, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  writeFileSync(join(out, name), bytes, { flag: 'wx', mode: 0o600 });
  files[name] = { bytes: bytes.length, sha256: sha(bytes) };
}

async function capture(label, executable, args, { cwd, env, timeout = 5000, limit = 64 * 1024 }) {
  const processRecord = { executable, args, cwd, startedAt: new Date().toISOString(), streams: {} };
  const chunks = { stdout: [], stderr: [] };
  let timer;
  let closed = false;
  const child = spawn(executable, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    processRecord.pid = child.pid ?? null;
    await new Promise((resolve) => {
      child.stdin.on('error', (error) => { processRecord.stdinError = error.code; });
      child.once('error', (error) => { processRecord.spawnError = error.code; });
      child.once('exit', (code, signal) => { processRecord.exit = { code, signal }; });
      child.once('close', (code, signal) => {
        closed = true;
        processRecord.close = { code, signal };
        resolve();
      });
      for (const stream of ['stdout', 'stderr']) {
        const info = { bytes: 0, eof: false };
        processRecord.streams[stream] = info;
        child[stream].on('data', (bytes) => {
          if (info.bytes < limit) chunks[stream].push(bytes.subarray(0, limit - info.bytes));
          info.bytes += bytes.length;
        });
        child[stream].once('end', () => { info.eof = true; });
        child[stream].once('error', (error) => { info.error = error.code; });
      }
      timer = setTimeout(() => { processRecord.timedOut = true; resolve(); }, timeout);
      child.stdin.end();
    });
  } finally {
    clearTimeout(timer);
    if (!closed) {
      processRecord.disposition = 'exact child exit unresolved';
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
    }
    processRecord.finishedAt = new Date().toISOString();
    retain(label + '-process.json', json(processRecord));
    for (const stream of ['stdout', 'stderr']) retain(label + '-' + stream + '.raw', Buffer.concat(chunks[stream]));
  }
  const complete = closed && !processRecord.timedOut && !processRecord.spawnError && !processRecord.stdinError &&
    Object.values(processRecord.streams).every((info) => info.eof && !info.error && info.bytes <= limit);
  return { complete, exit: processRecord.exit, close: processRecord.close,
    stdout: Buffer.concat(chunks.stdout), stderr: Buffer.concat(chunks.stderr) };
}

function requireSuccess(command, label) {
  assert(command.complete, label + ' capture incomplete');
  assert.deepEqual(command.exit, { code: 0, signal: null }, label + ' exact exit');
  assert.deepEqual(command.close, command.exit, label + ' pipe close');
}

function collectNative(root) {
  const evidence = join(root, 'evidence');
  const items = new Set();
  try {
    privateDirectory(evidence);
    for (const name of readdirSync(evidence)) items.add(name);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const names = [...markers, 'result.json'];
  for (let index = 1; index <= 80; index += 1) {
    const number = String(index).padStart(2, '0');
    for (const suffix of ['process.json', 'stdout.raw', 'stderr.raw']) {
      const name = number + '-' + suffix;
      if (!items.delete(name)) continue;
      const bytes = readOrdinary(join(evidence, name), 64 * 1024);
      retain('native-' + name, bytes);
    }
  }
  const captured = {};
  for (const name of names) {
    const maxBytes = name === 'result.json' ? 2 * 1024 * 1024 : 16 * 1024;
    const bytes = readOrdinary(join(root, name), maxBytes, true);
    if (bytes) {
      retain(name, bytes);
      captured[name] = bytes;
    }
  }
  assert.equal(items.size, 0, 'unexpected native evidence names');
  return captured;
}

process.umask(0o077);
privateDirectory(out);
try {
  const setup = readOrdinary(join(out, 'setup.txt'), 16 * 1024);
  files['setup.txt'] = { bytes: setup.length, sha256: sha(setup) };
  const variables = ['GITHUB_ACTIONS', 'GITHUB_EVENT_NAME', 'GITHUB_REF', 'GITHUB_REPOSITORY', 'GITHUB_SHA',
    'GITHUB_WORKFLOW_REF', 'GITHUB_WORKFLOW_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'RUNNER_OS', 'RUNNER_ARCH',
    'RUNNER_ENVIRONMENT', 'ImageOS', 'ImageVersion'];
  const job = Object.fromEntries(variables.map((name) => [name, process.env[name] ?? null]));
  retain('job.json', json(job));
  assert.equal(job.GITHUB_ACTIONS, 'true');
  assert.equal(job.GITHUB_EVENT_NAME, 'push');
  assert.equal(job.GITHUB_REF, branch);
  assert.match(job.GITHUB_SHA, /^[a-f0-9]{40}$/u);
  assert.equal(job.GITHUB_WORKFLOW_SHA, job.GITHUB_SHA);
  assert.equal(job.GITHUB_WORKFLOW_REF, job.GITHUB_REPOSITORY + '/.github/workflows/macos-logcap.yml@' + branch);
  assert.equal(job.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.deepEqual([job.RUNNER_OS, job.RUNNER_ARCH], ['macOS', 'ARM64']);
  assert.deepEqual([process.platform, process.arch, process.versions.node], ['darwin', 'arm64', '22.22.2']);
  assert(uid > 0 && uid === process.geteuid());

  const home = realpathSync(userInfo().homedir);
  assert.equal(realpathSync(homedir()), home);
  assert(metadata(home).directory && metadata(home).uid === uid, 'authenticated runner home');
  const token = randomBytes(16).toString('hex');
  const parent = join(home, '.gg456-logcap-ci-' + token);
  mkdirSync(parent, { mode: 0o700 });
  const env = { HOME: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8' };
  const preflight = async (label, executable, args) => {
    const run = await capture(label, executable, args, { cwd: parent, env: { ...env, HOME: parent } });
    requireSuccess(run, label);
    assert.equal(run.stderr.length, 0, label + ' stderr');
    return text(run.stdout).trim();
  };
  privateDirectory(parent);
  await preflight('parent-acl-clear', '/bin/chmod', ['-N', parent]);
  const root = join(parent, 'gg456-logcap-' + token);
  mkdirSync(root, { mode: 0o700 });
  retain('workspace.json', json({ home, parent, root, parentIdentity: privateDirectory(parent),
    rootIdentity: privateDirectory(root) }));
  assert.equal(await preflight('architecture', '/usr/bin/uname', ['-m']), 'arm64');
  const osReadback = await preflight('os', '/usr/bin/sw_vers', []);
  const os = osReadback.match(/^ProductVersion:\s+(15\.[0-9]+(?:\.[0-9]+)?)$/mu)?.[1];
  const build = osReadback.match(/^BuildVersion:\s+([A-Za-z0-9]{4,15})$/mu)?.[1];
  assert(os && build, 'macOS 15 version and build');
  const sdk = await preflight('sdk-path', '/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path']);
  await preflight('sdk-version', '/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-version']);
  const swiftc = await preflight('swift-path', '/usr/bin/xcrun', ['--sdk', 'macosx', '--find', 'swiftc']);
  assert(sdk.startsWith('/') && swiftc.startsWith('/'), 'absolute selected SDK and Swift paths');
  await preflight('swift-version', swiftc, ['--version']);
  const node = realpathSync(process.execPath);
  retain('runtime.json', json({ platform: process.platform, arch: process.arch, uid, versions: process.versions,
    node, sdk, physicalSdk: realpathSync(sdk), swiftc, physicalSwiftc: realpathSync(swiftc) }));

  const original = {};
  for (const [name, digest] of Object.entries(sourceSeals)) {
    const bytes = readOrdinary(join(here, name), 128 * 1024);
    assert.equal(sha(bytes), digest, name + ' seal');
    original[name] = bytes;
    retain(name, bytes);
  }
  const admission = {
    schema: 'gg456-darwin-log-capability-admission/v3', platform: 'hosted-macos-15', root, os, build,
    node, nodeVersion: process.versions.node, nodeSha256: sha(readFileSync(node)),
    sdk, swiftc, swiftcSha256: sha(readFileSync(swiftc)),
    swiftSha256: sourceSeals['Capability.swift'], driverSha256: sourceSeals['probe.mjs'],
    sdkHeaders: Object.fromEntries(headers.map((name) => [name, sha(readFileSync(join(sdk, 'usr/include', name)))])),
  };
  const admissionBytes = Buffer.from(json(admission));
  const admissionDigest = sha(admissionBytes);
  const staged = { 'Capability.swift': original['Capability.swift'], 'probe.mjs': original['probe.mjs'],
    'admission.json': admissionBytes };
  for (const [name, bytes] of Object.entries(staged)) {
    const path = join(root, name);
    writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
    assert.deepEqual(readOrdinary(path, 128 * 1024), bytes, 'staged ' + name);
    assert.equal(metadata(path).mode, 0o600);
  }
  const inventory = readdirSync(root).sort();
  assert.deepEqual(inventory, ['Capability.swift', 'admission.json', 'probe.mjs']);
  retain('admission.json', admissionBytes);
  retain('launch.json', json({ admissionDigest, initialInventory: inventory, root, node,
    stagingScriptSha256: sha(readFileSync(fileURLToPath(import.meta.url))) }));

  let driver;
  let native;
  try {
    driver = await capture('driver', node, [join(root, 'probe.mjs'), 'driver', admissionDigest],
      { cwd: root, env, timeout: 125_000, limit: 2 * 1024 * 1024 });
  } finally {
    native = collectNative(root);
  }
  requireSuccess(driver, 'native driver');
  const resultBytes = native['result.json'];
  assert(resultBytes, 'missing native result');
  assert.deepEqual(driver.stdout, resultBytes, 'native result versus stdout');
  const result = JSON.parse(text(resultBytes));
  assert.equal(result.schema, 'gg456-darwin-log-capability/v3');
  assert.equal(result.status, 'capability-observed');
  assert.deepEqual(result.admission, { ...admission, admissionDigest });
  assert(Number.isInteger(result.commands?.length) && result.commands.length > 0 && result.commands.length <= 80);
  assert.equal(Object.keys(files).filter((name) => name.startsWith('native-')).length, result.commands.length * 3);
  for (const [index, command] of result.commands.entries()) {
    const prefix = 'native-' + String(index + 1).padStart(2, '0') + '-';
    const processBytes = readOrdinary(join(out, prefix + 'process.json'), 64 * 1024);
    assert.deepEqual(JSON.parse(text(processBytes)), command, prefix + 'process receipt');
    assert.deepEqual(command.process.exit, { code: 0, signal: null }, prefix + 'exit');
    assert.deepEqual(command.process.close, command.process.exit, prefix + 'pipe close');
    for (const stream of ['stdout', 'stderr']) {
      const bytes = files[prefix + stream + '.raw']?.bytes;
      assert(command.streams[stream]?.eof && bytes === command.bytes[stream], prefix + stream + ' EOF and bytes');
    }
  }
  assert(markers.every((name) => native[name]), 'missing descendant lifecycle evidence');
  receipt.status = 'capability-observed';
} catch (error) {
  receipt.failure = { message: error.message, code: error.code, stack: error.stack };
  process.exitCode = 1;
} finally {
  receipt.finishedAt = new Date().toISOString();
  receipt.files = files;
  writeFileSync(join(out, 'capture.json'), json(receipt), { flag: 'wx', mode: 0o600 });
  process.stdout.write('Darwin capability capture ' + receipt.status + '\n');
}

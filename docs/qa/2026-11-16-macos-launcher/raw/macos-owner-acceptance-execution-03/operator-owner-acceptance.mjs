// The wrapper assembles this module after the exact source-model.mjs bytes.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, constants, createReadStream, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync,
  readdirSync, readSync, realpathSync, statfsSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [token, manifestSha256] = process.argv.slice(1);
const node = '/opt/homebrew/Cellar/node@22/22.22.2_2/bin/node';
const nodeSha256 = 'e67e9c664f5b3d6d9fc0050ac895d8f30d213ce340c84439750edc9cc449d010';
const parent = '/Users/jake/Library/Caches';
const stagePath = `${parent}/graphgoblin-456-owner-acceptance-${token}`;
const pnpmStage = `${parent}/graphgoblin-pnpm-materialized-12.8.1-7dcdb45652c44a26b97a681a95075056`;
const pnpmRoot = `${pnpmStage}/pnpm-12.8.1`;
const pnpm = `${pnpmRoot}/pnpm`;
const pnpmSha256 = '544fdf18e7b3dc9823e552f01ed7031cd75d7fd6a48371ff7ebfdd935a50ee27';
const pnpmManifestSha256 = '11bbc14f157f770b27690fd530e6f1be1a5d54331a36efb0a4d918f03241cc00';
const emptyPnpmDirectories = [
  'dist/node_modules/undici/types',
  'dist/node_modules/exponential-backoff/src',
  'dist/node_modules/exponential-backoff/src/jitter',
  'dist/node_modules/exponential-backoff/src/delay',
  'dist/node_modules/exponential-backoff/src/delay/always',
  'dist/node_modules/exponential-backoff/src/delay/skip-first',
  'dist/node_modules/exponential-backoff/src/jitter/full',
  'dist/node_modules/exponential-backoff/src/jitter/no',
];
const tools = '/Library/Developer/CommandLineTools';
const xcrun = '/usr/bin/xcrun';
const systemEnv = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C', LC_ALL: 'C' };
const hardDeadlineMs = 650000;
const eofDeadlineMs = 5000;
const streamLimit = 4 * 1024 ** 2;
const metadataLimit = 128 * 1024;
const schema = 'gg456-owner-mac-acceptance/v1';

function capture(file, args, env = systemEnv) {
  const child = spawnSync(file, args, { cwd: '/', env, encoding: 'utf8', maxBuffer: 16384,
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000, killSignal: 'SIGKILL' });
  return { file, args, code: child.status, signal: child.signal, errorCode: child.error?.code ?? null,
    stdout: child.stdout ?? '', stderr: child.stderr ?? '' };
}

function command(file, args, env = systemEnv) {
  const result = capture(file, args, env);
  check(result.code === 0 && result.errorCode === null && !result.stderr,
    `Preflight command failed: ${file} ${args.join(' ')} (${result.errorCode ?? result.code ?? result.signal})`);
  return result.stdout;
}

function physicalDir(path) {
  const details = lstatSync(path, { bigint: true });
  check(details.isDirectory() && realpathSync(path) === path, `Nonphysical directory: ${path}`);
  return { path, uid: Number(details.uid), dev: String(details.dev), ino: String(details.ino),
    mode: (details.mode & 0o7777n).toString(8) };
}

function directoryAcl(path) {
  const before = physicalDir(path);
  const [header, ...lines] = command('/bin/ls', ['-lde', path]).trimEnd().split('\n');
  check(JSON.stringify(physicalDir(path)) === JSON.stringify(before) && header.endsWith(` ${path}`),
    `Directory changed during ACL read: ${path}`);
  return { ...before, headerMode: header.split(' ')[0], acl: lines.length ? `${lines.join('\n')}\n` : '',
    fsType: String(statfsSync(path, { bigint: true }).type) };
}

function verifyParent() {
  for (const path of ['/', '/Users', '/Users/jake', '/Users/jake/Library']) {
    const info = physicalDir(path);
    check([0, 501].includes(info.uid) && !(parseInt(info.mode, 8) & 0o022), `Unsafe cache ancestor: ${path}`);
  }
  const seen = directoryAcl(parent);
  check(seen.uid === 501 && seen.dev === '16777232' && seen.ino === '48306' && seen.mode === '700' &&
    seen.headerMode === 'drwx------+' && seen.acl === ' 0: group:everyone deny delete\n', 'Cache parent drift');
  return seen;
}

function mkdirPrivate(path) {
  mkdirSync(path, { mode: 0o700 });
}

function privateDir(path, dev) {
  const info = physicalDir(path);
  check(info.uid === 501 && info.dev === dev && info.mode === '700', `Private directory drift: ${path}`);
}

async function fixedExecutable(path, expectedReal, maxBytes, digest, expectedBytes) {
  const real = realpathSync(path);
  const stat = lstatSync(real, { bigint: true });
  check((expectedReal ? real === expectedReal : real.startsWith(`${tools}/usr/bin/`)) && stat.isFile() &&
    stat.uid === 0n && (stat.mode & 0o7777n) === 0o755n && stat.size > 0n && stat.size <= BigInt(maxBytes) &&
    (expectedBytes === undefined || stat.size === BigInt(expectedBytes)), `Executable path or metadata drift: ${path}`);
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(real, { start: 0, end: Number(stat.size) - 1 })) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  const sha = hash.digest('hex');
  const after = lstatSync(real, { bigint: true });
  check(bytes === Number(stat.size) && (digest === undefined || sha === digest) && realpathSync(path) === real &&
    stat.dev === after.dev && stat.ino === after.ino && stat.mode === after.mode && stat.uid === after.uid &&
    stat.size === after.size && stat.mtimeNs === after.mtimeNs && stat.ctimeNs === after.ctimeNs,
  `Executable hash or identity drift: ${path}`);
  return { path, real, bytes, sha256: sha };
}

async function verifyTools(env, report) {
  const readback = report.toolchain = {};
  const select = '/usr/bin/xcode-select';
  readback.xcodeSelect = await fixedExecutable(select, select, 256 * 1024,
    'e7c2963f798dca1b7fc2fd6fce9639d1fd25d914c85d17ea0c79eb693112b006', 118912);
  const selectedEnv = { ...env };
  delete selectedEnv.DEVELOPER_DIR;
  readback.selectedDeveloperDir = command(select, ['-p'], selectedEnv).trim();
  check(readback.selectedDeveloperDir === tools && realpathSync(tools) === tools, 'Selected developer directory drift');
  readback.xcrun = await fixedExecutable(xcrun, xcrun, 256 * 1024,
    '178e19cfe796ce33815195c42d34562c20ec4d5131534fb7e6a55b91f14371d5', 117104);
  const query = (...args) => command(xcrun, ['--sdk', 'macosx', ...args], env).trim();
  const sdkPath = query('--show-sdk-path');
  const sdkVersion = query('--show-sdk-version');
  const sdkReal = `${tools}/SDKs/MacOSX26.4.sdk`;
  check(sdkPath === `${tools}/SDKs/MacOSX.sdk` && sdkVersion === '26.4.1' &&
    lstatSync(sdkPath).isSymbolicLink() && readlinkSync(sdkPath) === 'MacOSX26.4.sdk' &&
    realpathSync(sdkPath) === sdkReal && lstatSync(sdkReal).isDirectory() && lstatSync(sdkReal).uid === 0, 'SDK drift');
  readback.sdk = { path: sdkPath, real: sdkReal, version: sdkVersion };
  const compiler = query('--find', 'swiftc');
  check(compiler === `${tools}/usr/bin/swiftc`, 'Swift compiler path drift');
  const executableLimit = 512 * 1024 * 1024;
  readback.swiftc = await fixedExecutable(compiler, `${tools}/usr/bin/swift-frontend`, executableLimit,
    '87fa6b2a17224aa31f977b7930491bc827dfddea87c77dc27c5269c428447248', 357109488);
  readback.version = capture(compiler, ['--version'], env);
  check(readback.version.code === 0 && readback.version.errorCode === null &&
    readback.version.stdout === 'Apple Swift version 6.3.1 (swiftlang-6.3.1.1.2 clang-2100.0.123.102)\nTarget: arm64-apple-macosx26.0\n' &&
    readback.version.stderr.trim() === 'swift-driver version: 1.148.6', 'Swift compiler version drift');
  const swift = query('--find', 'swift');
  check(swift === `${tools}/usr/bin/swift`, 'Swift driver is outside the selected toolchain');
  readback.swift = await fixedExecutable(swift, undefined, executableLimit);
}

function writeBytes(fd, bytes) {
  for (let offset = 0; offset < bytes.length;) {
    const wrote = writeSync(fd, bytes, offset, bytes.length - offset);
    check(wrote > 0, 'Bounded receipt or archive write made no progress');
    offset += wrote;
  }
}

function frameReader() {
  const chunks = process.stdin[Symbol.asyncIterator]();
  let pending = Buffer.alloc(0);
  async function consume(count, accept) {
    while (count > 0) {
      if (!pending.length) {
        const next = await chunks.next();
        check(!next.done, 'Truncated build input');
        pending = next.value;
      }
      const n = Math.min(count, pending.length);
      accept(pending.subarray(0, n));
      pending = pending.subarray(n);
      count -= n;
    }
  }
  async function block(count) {
    const bytes = Buffer.alloc(count);
    let offset = 0;
    await consume(count, (part) => { offset += part.copy(bytes, offset); });
    return bytes;
  }
  async function end() {
    check(!pending.length && (await chunks.next()).done, 'Unexpected bytes after source archive');
  }
  return { consume, block, end };
}

function output(bytes) {
  return new Promise((resolve, reject) => process.stdout.write(bytes, (error) => error ? reject(error) : resolve()));
}

async function frame(value, streams = []) {
  const body = Buffer.from(JSON.stringify(value));
  check(body.length > 0 && body.length <= metadataLimit, 'Result metadata exceeds frame cap');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  await output(header);
  await output(body);
  for (const chunks of streams) for (const chunk of chunks) await output(chunk);
}

function bindHost() {
  check(process.platform === 'darwin' && process.arch === 'arm64' && process.getuid() === 501 && process.geteuid() === 501 &&
    process.execPath === node && process.versions.node === '22.22.2' && command('/usr/bin/id', ['-un']).trim() === 'jake',
  'Host, account or Node execution mismatch');
  const stat = lstatSync(node);
  check(stat.isFile() && stat.size === 84640 && stat.uid === 501 && realpathSync(node) === node &&
    sha256(readFileSync(node)) === nodeSha256, 'Pinned Node mismatch');
  const osVersion = command('/usr/bin/sw_vers', ['-productVersion']).trim();
  const buildVersion = command('/usr/bin/sw_vers', ['-buildVersion']).trim();
  check(osVersion === '26.6.2' && buildVersion === '25G83', 'Owner Mac OS build drift');
  return { uid: 501, arch: process.arch, node, nodeVersion: process.versions.node, nodeSha256, osVersion, buildVersion };
}

function privateStage() {
  const parentBefore = verifyParent();
  mkdirPrivate(stagePath);
  const found = directoryAcl(stagePath);
  check(found.uid === 501 && found.mode === '700' && found.headerMode === 'drwx------' && found.acl === '' &&
    found.dev === parentBefore.dev && found.fsType === parentBefore.fsType, 'Product stage ownership, ACL or volume mismatch');
  check(JSON.stringify(verifyParent()) === JSON.stringify(parentBefore), 'Cache parent changed during stage creation');
  return { parent: parentBefore, stage: found };
}

function verifyPrivateFile(path, row, dev) {
  const stat = lstatSync(path, { bigint: true });
  check(stat.isFile() && stat.nlink === 1n && stat.uid === 501n && String(stat.dev) === dev &&
    (stat.mode & 0o7777n).toString(8) === row.mode && stat.size === BigInt(row.bytes) && realpathSync(path) === path,
  `Private file metadata mismatch: ${path}`);
  const same = (other) => stat.ino === other.ino && stat.dev === other.dev && stat.size === other.size &&
    stat.mode === other.mode && stat.nlink === other.nlink && stat.uid === other.uid &&
    stat.mtimeNs === other.mtimeNs && stat.ctimeNs === other.ctimeNs;
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const bytes = Buffer.alloc(row.bytes);
  try {
    check(same(fstatSync(fd, { bigint: true })), `Private file changed before open: ${path}`);
    for (let offset = 0; offset < bytes.length;) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      check(count > 0, `Truncated private file: ${path}`);
      offset += count;
    }
    check(readSync(fd, Buffer.alloc(1), 0, 1, bytes.length) === 0 && same(fstatSync(fd, { bigint: true })) &&
      same(lstatSync(path, { bigint: true })) && (row.sha256 === undefined || sha256(bytes) === row.sha256),
    `Private file byte or identity mismatch: ${path}`);
    return bytes;
  } finally { closeSync(fd); }
}

function verifyPnpm(expected, dev) {
  const seen = directoryAcl(pnpmStage);
  check(seen.uid === 501 && seen.dev === dev && seen.ino === '178541570' && seen.mode === '700' &&
    seen.acl === '' && seen.headerMode === 'drwx------', 'Retained pnpm stage identity drift');
  const directories = new Set(['', ...emptyPnpmDirectories]);
  for (const path of expected.keys()) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'));
  }
  for (const path of directories) {
    const dir = join(pnpmRoot, path);
    privateDir(dir, dev);
    for (const name of readdirSync(dir)) {
      const relative = path ? `${path}/${name}` : name;
      check(directories.has(relative) || expected.has(relative), `Unexpected retained pnpm path: ${relative}`);
    }
  }
  check(directories.size === 107, 'Retained pnpm directory closure differs');
  for (const [relative, row] of expected) verifyPrivateFile(join(pnpmRoot, relative), row, dev);
  return { path: pnpm, sha256: pnpmSha256, files: expected.size, manifestSha256: pnpmManifestSha256, stage: seen };
}

function verifySources(repo, model, dev) {
  for (const path of model.directories) privateDir(join(repo, path), dev);
  for (const [path, row] of model.paths) {
    verifyPrivateFile(join(repo, path), { ...row, mode: row.gitMode === '100755' ? '700' : '600' }, dev);
  }
}

async function runPhase(phase, executable, args, cwd, env, timeoutMs, report, journal) {
  const streams = Object.fromEntries(['stdout', 'stderr'].map((name) => [name, {
    path: join(stagePath, `${phase}-${name}.raw`), chunks: [], bytes: 0, eof: false, overflow: false,
  }]));
  let reason;
  const receipt = { type: 'phase', phase, executable, args, cwd, at: new Date().toISOString(),
    workerProcessGroup: process.pid, timeoutMs, code: null, signal: null, exitObserved: false };
  try {
    for (const state of Object.values(streams)) state.fd = openSync(state.path, 'wx', 0o600);
    reason = await new Promise((resolve) => {
      const child = spawn(executable, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      receipt.pid = child.pid ?? null;
      report.activePhase = receipt;
      let finished = false;
      let eofTimer;
      const timer = setTimeout(() => finish('phase-deadline'), timeoutMs);
      function finish(stop) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        clearTimeout(eofTimer);
        for (const name of Object.keys(streams)) child[name]?.pause();
        resolve(stop);
      }
      for (const [name, state] of Object.entries(streams)) {
        child[name].on('data', (chunk) => {
          if (finished) return;
          try {
            const kept = chunk.subarray(0, streamLimit - state.bytes);
            writeBytes(state.fd, kept);
            state.bytes += kept.length;
            state.chunks.push(kept);
            if (kept.length !== chunk.length) { state.overflow = true; finish(`${name}-overflow`); }
          } catch (error) { receipt.captureError = error.message.slice(0, 1024); finish('stream-capture-failure'); }
        });
        child[name].on('end', () => { state.eof = true; });
        child[name].on('error', (error) => { receipt.captureError = error.message.slice(0, 1024); finish('stream-read-failure'); });
      }
      child.once('error', (error) => { receipt.spawnError = error.code ?? error.message; finish('spawn-failure'); });
      child.once('exit', (code, signal) => {
        if (finished) return;
        clearTimeout(timer);
        Object.assign(receipt, { code, signal, exitObserved: true, exitedAt: new Date().toISOString() });
        eofTimer = setTimeout(() => finish('pipe-eof-deadline'), eofDeadlineMs);
      });
      child.once('close', () => finish(receipt.exitObserved && streams.stdout.eof && streams.stderr.eof ? null : 'pipe-eof-failure'));
      try {
        if (child.pid) {
          const birth = capture('/bin/ps', ['-o', 'lstart=', '-p', String(child.pid)], env);
          receipt.birth = birth.code === 0 ? birth.stdout.trim() : null;
        }
        journal();
      } catch (error) { receipt.captureError = error.message.slice(0, 1024); finish('journal-failure'); }
    });
  } finally {
    for (const state of Object.values(streams)) if (state.fd !== undefined) {
      try { fsyncSync(state.fd); } finally { closeSync(state.fd); }
    }
  }
  Object.assign(receipt, { finishedAt: new Date().toISOString(), stopReason: reason });
  for (const [name, state] of Object.entries(streams)) {
    const hash = createHash('sha256');
    for (const chunk of state.chunks) hash.update(chunk);
    receipt[name] = { path: state.path, bytes: state.bytes, sha256: hash.digest('hex'), eof: state.eof, overflow: state.overflow };
  }
  report.phases.push(receipt);
  report.activePhase = null;
  if (reason !== null) report.stopOwnedGroup = reason;
  journal();
  await frame(receipt, Object.values(streams).map((state) => state.chunks));
  check(reason === null && receipt.code === 0 && receipt.signal === null, `${phase}: ${reason ?? `exit ${receipt.code}`}`);
  return phase === 'swift-release-bin-path' ? Buffer.concat(streams.stdout.chunks, streams.stdout.bytes) : undefined;
}

const buildStage = `${parent}/graphgoblin-456-product-build-d75d293f66da44ffb60198a07d8fa2e2`;
const repo = `${buildStage}/repo`;
const driverPath = 'tooling/scripts/macos-launcher.acceptance.mjs';
const driverDigest = '8dfc56f694770c65a4b41c6a2b390aca42e6c9c172bd5e506fc1608e9b1ecd93';
const installerDigest = 'd37e7f02f14c68f9ae19fa1886fe38b91ad3fbd8b1c9d286da88c442e8f8d7bd';
const buildHead = '4341d1f8882f4b69651bfb0b5988345b7f074339';
const buildTree = 'a5f8fa3e13fb297cbcdb386ae445cb8159156617';
const freezeDigest = '31a26763478b6e8c6e31ca3b64275a8eb3573a67b45cf92431341edcd1aa385d';
const buildResultDigest = '738c56a109a49f4c7b266ff97e6e5db8a7fc8fcb1e1ed0a623269045fb011656';

async function readAcceptanceInput() {
  const reader = frameReader();
  check((await reader.block(inputMagic.length)).equals(inputMagic), 'Acceptance input magic mismatch');
  const size = (await reader.block(4)).readUInt32BE();
  check(size > 0 && size <= sourceLimits.manifestBytes, 'Acceptance manifest exceeds its bound');
  const manifest = await reader.block(size);
  await reader.end();
  check(sha256(manifest) === manifestSha256, 'Acceptance manifest digest mismatch');
  const body = JSON.parse(sourceUtf8.decode(manifest));
  check(body.schema === 'gg456-macos-owner-acceptance-input/v1' && body.token === token &&
    body.buildStage === buildStage && body.buildResultSha256 === buildResultDigest, 'Acceptance source stage mismatch');
  const frozen = Buffer.from(body.sourceFreezeBase64, 'base64');
  check(sha256(frozen) === freezeDigest, 'Retained product freeze digest mismatch');
  const freeze = JSON.parse(sourceUtf8.decode(frozen));
  const model = validateFreeze(freeze);
  check(freeze.head === buildHead && freeze.tree === buildTree && model.paths.size === 1765 &&
    model.paths.get(driverPath)?.sha256 === driverDigest &&
    model.paths.get('scripts/install-macos-launcher.sh')?.sha256 === installerDigest, 'Reviewed driver or installer pin mismatch');
  check(Array.isArray(body.pnpmFiles) && body.pnpmFiles.length === 437, 'Retained pnpm file list mismatch');
  const tools = new Map();
  const toolDigest = createHash('sha256');
  let previous = '';
  let totalBytes = 0;
  for (const row of body.pnpmFiles) {
    check((row.path === 'pnpm' || (safePath(row.path) && row.path.startsWith('dist/'))) && row.path > previous &&
      Number.isInteger(row.bytes) && row.bytes >= 0 && row.bytes <= 44735648 &&
      ['600', '700'].includes(row.mode) && isDigest(row.sha256), 'Unexpected pnpm file metadata');
    previous = row.path;
    totalBytes += row.bytes;
    tools.set(row.path, row);
    toolDigest.update(`${row.path}\t${row.mode}\t${row.bytes}\t${row.sha256}\n`);
  }
  check(toolDigest.digest('hex') === pnpmManifestSha256 && totalBytes === 48406617 &&
    tools.get('pnpm')?.sha256 === pnpmSha256, 'Retained pnpm manifest SHA-256 mismatch');
  const bin = `${buildStage}/swift-release/arm64-apple-macosx/release`;
  const expectedArtifacts = new Set([`${bin}/GraphGoblin`, `${bin}/GraphGoblinLauncherInstaller`,
    ...['apps/api/dist/main.js', 'apps/api/dist/instance-identity.js', 'apps/api/dist/macos-log/guard.js',
      'apps/api/dist/managed-log/guard.js', 'apps/api/dist/managed-log/gateway-log-writer.js',
      'apps/api/dist/windows-log/guard.js', 'apps/web/dist/index.html', 'apps/web/dist-goblin/index.html']
      .map((path) => `${repo}/${path}`)]);
  check(Array.isArray(body.artifacts) && body.artifacts.length === expectedArtifacts.size, 'Wrong successful artifact set');
  for (const row of body.artifacts) {
    check(expectedArtifacts.delete(row.path) && ['600', '700'].includes(row.mode) && isDigest(row.sha256) &&
      Number.isInteger(row.bytes) && row.bytes > 0 && row.bytes <= 128 * 1024 ** 2, 'Unexpected artifact row');
  }
  return { model, tools, artifacts: body.artifacts };
}

function verifyBuild(input, dev) {
  const found = directoryAcl(buildStage);
  check(found.uid === 501 && found.dev === dev && found.ino === '178893353' && found.mode === '700' &&
    found.headerMode === 'drwx------' && found.acl === '' && found.fsType === '25', 'Retained successful stage identity drift');
  privateDir(repo, dev);
  try { lstatSync(join(repo, '.git')); throw new Error('Unexpected Git metadata in source archive'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  verifyPrivateFile(join(buildStage, 'source-freeze.json'), { bytes: 383408, mode: '600', sha256: freezeDigest }, dev);
  verifySources(repo, input.model, dev);
  for (const row of input.artifacts) verifyPrivateFile(row.path, row, dev);
  return found;
}

function evidenceFiles(directory, dev) {
  try { lstatSync(directory); } catch (error) { if (error.code === 'ENOENT') return { items: [], bytes: [] }; throw error; }
  const owned = directoryAcl(directory);
  check(owned.uid === 501 && owned.dev === dev && owned.mode === '700' && owned.acl === '', 'Case evidence identity mismatch');
  const names = readdirSync(directory).sort();
  check(names.length <= 512, 'Case evidence file count exceeds its bound');
  const logFiles = new Set(['gateway.log.snapshot', 'api-managed-key-recheck.gateway.log',
    'final-gateway.log', 'final-gateway.log.1', 'final-launcher.log', 'final-launcher.log.1']);
  const items = [];
  const data = [];
  let sum = 0;
  let manifest;
  for (const name of names) {
    const limit = name === 'manifest.json' ? 1024 ** 2 : name === 'held-store.launcher.log' ? 256 * 1024 :
      logFiles.has(name) ? 4 * 1024 ** 2 :
      /^\d{3}-[a-z0-9-]+\.(stdout|stderr)$/.test(name) ? 256 * 1024 : -1;
    const path = join(directory, name);
    const stat = lstatSync(path);
    check(stat.size <= limit && (sum += stat.size) <= 40 * 1024 ** 2, `Case evidence type or size exceeds bounds: ${name}`);
    const bytes = verifyPrivateFile(path, { bytes: stat.size, mode: '600' }, dev);
    items.push({ name, bytes: bytes.length, sha256: sha256(bytes) });
    data.push(bytes);
    if (name === 'manifest.json') manifest = JSON.parse(sourceUtf8.decode(bytes));
  }
  return { items, bytes: data, manifest };
}

function verifiedCase(manifest, input, evidence, tmp) {
  check(manifest?.outcome === 'passed' && manifest.stage === 'fixture-cleanup' && manifest.cases.length === 9 &&
    manifest.output === evidence && manifest.root.startsWith(`${tmp}/graphgoblin-macos-acceptance-`) &&
    /^\/Users\/jake\/Applications\/GraphGoblin QA [a-f0-9]{32}\.app$/.test(manifest.app),
  'Exact acceptance case did not report all nine checkpoints and scoped cleanup');
  check(manifest.binding?.commit === buildHead && manifest.binding?.tree === buildTree && manifest.binding?.driver === driverDigest &&
    manifest.binding.main === input.artifacts.find((row) => row.path === `${repo}/apps/api/dist/main.js`).sha256 &&
    manifest.binding.helper === input.artifacts.find((row) => row.path === `${repo}/apps/api/dist/instance-identity.js`).sha256,
  'Case result did not bind the frozen source and staged API');
  const { primary, contender } = manifest.ports;
  check(Number.isInteger(primary) && Number.isInteger(contender) && primary > 0 && contender > 0 &&
    primary <= 65535 && contender <= 65535 && primary !== contender &&
    ![4747, 4748].includes(primary) && ![4747, 4748].includes(contender), 'Case result ports are out of scope');
}

async function worker() {
  const report = { type: 'result', schema, token, manifestSha256, stagePath, buildStage, head: buildHead, tree: buildTree,
    buildResultSha256: buildResultDigest, at: new Date().toISOString(), workerPid: process.pid, phases: [] };
  let journalFd;
  let input;
  let evidence;
  let tmp;
  let evidencePayload = [];
  let step = 'source-and-toolchain';
  function record() {
    if (journalFd === undefined) return;
    writeFileSync(journalFd, `${JSON.stringify({ step, ...report })}\n`);
    fsyncSync(journalFd);
  }
  await output(outputMagic);
  const inputTimer = setTimeout(() => process.stdin.destroy(new Error('Acceptance stdin deadline')), 12000);
  try {
    input = await readAcceptanceInput();
    clearTimeout(inputTimer);
    const setup = performance.now();
    report.host = bindHost();
    Object.assign(report, privateStage());
    journalFd = openSync(join(stagePath, 'receipt.jsonl'), 'ax', 0o600);
    const { dev } = report.stage;
    report.retainedBuild = verifyBuild(input, dev);
    report.pnpm = verifyPnpm(input.tools, dev);
    tmp = join(stagePath, 'tmp');
    const home = join(stagePath, 'home');
    evidence = join(stagePath, 'cases');
    for (const path of [tmp, home]) mkdirPrivate(path);
    const env = { ...systemEnv, PATH: `${dirname(node)}:${systemEnv.PATH}`,
      HOME: home, CFFIXED_USER_HOME: home, TMPDIR: tmp, TMP: tmp, TEMP: tmp, XCRUN_NOCACHE: '1',
      DEVELOPER_DIR: tools, GG_MACOS_LAUNCHER_SOURCE_COMMIT: buildHead, GG_MACOS_LAUNCHER_SOURCE_TREE: buildTree,
      GG_MACOS_LAUNCHER_ARTIFACT_DIR: evidence };
    await verifyTools(env, report);
    check(report.toolchain.swift.sha256 === '87fa6b2a17224aa31f977b7930491bc827dfddea87c77dc27c5269c428447248',
      'Swift driver differs from successful build');
    check(performance.now() - setup <= 90000, 'Acceptance setup exceeded 90 seconds');
    check(JSON.stringify(verifyParent()) === JSON.stringify(report.parent) &&
      JSON.stringify(directoryAcl(stagePath)) === JSON.stringify(report.stage), 'Acceptance stage identity drift');
    report.caseDirectory = evidence;
    record();
    step = 'acceptance';
    await runPhase('acceptance', node, ['--test', join(repo, driverPath)], repo, env, 480000, report, record);
    step = 'case-readback';
    report.status = 'driver-exit-zero';
  } catch (error) {
    clearTimeout(inputTimer);
    report.status = 'owner-acceptance-failed';
    report.failure = { step, code: error.code ?? null, error: error.message.slice(0, 4096) };
    if (report.activePhase) report.stopOwnedGroup ??= 'incomplete-acceptance-phase';
  }
  try {
    if (evidence && report.phases.length && !report.stopOwnedGroup) {
      const readback = evidenceFiles(evidence, report.stage.dev);
      report.caseFiles = readback.items;
      evidencePayload = readback.bytes;
      if (readback.manifest) report.case = { outcome: readback.manifest.outcome, stage: readback.manifest.stage,
        app: readback.manifest.app, ports: readback.manifest.ports, cleanup: readback.manifest.cleanup,
        cases: readback.manifest.cases, failure: readback.manifest.failure, cleanupError: readback.manifest.cleanupError };
      if (report.status === 'driver-exit-zero') {
        verifiedCase(readback.manifest, input, evidence, tmp);
        check(readback.items.some(({ name }) => name === 'held-store.launcher.log'),
          'Successful case is missing the held-store diagnostic evidence');
        report.postCaseBuild = verifyBuild(input, report.stage.dev);
        report.postCasePnpm = verifyPnpm(input.tools, report.stage.dev);
        report.status = 'owner-acceptance-exit-zero';
      }
    }
    record();
  } catch (error) {
    report.status = 'owner-acceptance-failed';
    report.caseReadbackFailure = error.message.slice(0, 4096);
  } finally { if (journalFd !== undefined) closeSync(journalFd); }
  process.exitCode = report.status === 'owner-acceptance-exit-zero' ? 0 : 2;
  await frame(report, [evidencePayload]);
  if (report.stopOwnedGroup) {
    process.channel.ref();
    process.send({ action: 'stop-owned-group', reason: report.stopOwnedGroup });
  } else process.disconnect();
}

function supervise() {
  const child = spawn(node, [...process.execArgv, '--', token, manifestSha256], {
    cwd: '/', env: { ...systemEnv, GG456_OWNER_ACCEPTANCE_WORKER: '1' }, detached: true,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  });
  let reaped = false;
  let stopReason;
  function stop(reason) {
    if (stopReason || !child.pid || reaped) return;
    stopReason = reason;
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) {
      if (error.code !== 'ESRCH') process.stderr.write(`owner acceptance owned-group stop failed: ${error.code}\n`);
    }
  }
  const timer = setTimeout(() => stop('owned-worker-group-deadline'), hardDeadlineMs);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => stop(signal));
  child.on('message', (message) => {
    if (message?.action === 'stop-owned-group') stop(String(message.reason).slice(0, 128));
  });
  child.once('error', (error) => process.stderr.write(`owner acceptance worker start failed: ${error.code}\n`));
  child.once('exit', () => { reaped = true; });
  child.once('close', (code, signal) => {
    clearTimeout(timer);
    if (stopReason || code === null) {
      process.stderr.write(`${JSON.stringify({ event: 'owner-acceptance-worker-stopped', token, stagePath, pid: child.pid,
        reason: stopReason ?? signal ?? 'start failure', observedExit: code, signal, at: new Date().toISOString() })}\n`);
    }
    process.exitCode = stopReason || code === null ? 2 : code;
  });
}

check(process.argv.length === 3 && /^[a-f0-9]{32}$/.test(token ?? '') && isDigest(manifestSha256),
  'Invalid owner acceptance token or manifest binding');
if (process.env.GG456_OWNER_ACCEPTANCE_WORKER === '1') await worker();
else supervise();


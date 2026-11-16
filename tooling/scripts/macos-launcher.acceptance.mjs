import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir, userInfo } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const host = '127.0.0.1';
const protectedPorts = new Set([4747, 4748]);
const leaseNames = ['graphgoblin.lock', 'graphgoblin.db.graphgoblin.lock'];
const logNames = ['gateway.log', 'gateway.log.1', 'launcher.log', 'launcher.log.1'];
const streamLimit = 256 * 1024;
const indexLimit = 16 * 1024 * 1024;
const slotLimit = 4 * 1024 * 1024;
const launcherSlotLimit = 256 * 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const isAbsent = (error) => error?.code === 'ENOENT';
const uid = userInfo().uid;
const fileIdentity = (stat) => ({
  device: BigInt.asUintN(64, stat.dev).toString(),
  inode: BigInt.asUintN(64, stat.ino).toString(),
});

async function statIfPresent(path) {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    if (isAbsent(error)) return undefined;
    throw error;
  }
}

async function ownedDirectory(path) {
  const stat = await lstat(path, { bigint: true });
  assert.ok(
    stat.isDirectory() && stat.uid === BigInt(uid),
    'Expected an owned physical directory.',
  );
  assert.equal(await realpath(path), path, 'Directory must have the bound physical path.');
  return fileIdentity(stat);
}

async function ownedFile(path, maxBytes, privateMode = false) {
  const stat = await lstat(path, { bigint: true });
  assert.ok(stat.isFile() && stat.uid === BigInt(uid) && stat.nlink === 1n);
  assert.ok(stat.size <= BigInt(maxBytes), 'Bounded fixture file exceeded its cap.');
  if (privateMode) assert.equal(stat.mode & 0o077n, 0n);
  const bytes = await readFile(path);
  const after = await lstat(path, { bigint: true });
  assert.deepEqual(fileIdentity(after), fileIdentity(stat));
  assert.ok(bytes.length <= maxBytes);
  return { bytes, identity: fileIdentity(stat), hash: sha256(bytes) };
}

async function observeProcess(evidence, label, executable, args, options) {
  const name = String(++evidence.nextProcess).padStart(3, '0') + '-' + label;
  const child = spawn(executable, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const received = { stdout: 0, stderr: 0 };
  const chunks = { stdout: [], stderr: [] };
  const eof = { stdout: false, stderr: false };
  let exit = null;
  let spawnError = null;
  for (const stream of ['stdout', 'stderr']) {
    child[stream].on('data', (bytes) => {
      const available = streamLimit - received[stream];
      if (available > 0) chunks[stream].push(bytes.subarray(0, available));
      received[stream] += bytes.length;
    });
    child[stream].once('end', () => {
      eof[stream] = true;
    });
  }
  child.once('exit', (code, signal) => {
    exit = { code, signal };
  });
  child.once('error', (error) => {
    spawnError = error.code ?? error.name;
  });
  const timedOut = await new Promise((done) => {
    const timer = setTimeout(() => {
      // A stuck potentially committed launch stays observed as uncertain. No gateway is signalled.
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      done(true);
    }, options.timeout);
    child.once('close', () => {
      clearTimeout(timer);
      done(false);
    });
  });
  const stdout = Buffer.concat(chunks.stdout);
  const stderr = Buffer.concat(chunks.stderr);
  const record = {
    name,
    pid: child.pid ?? null,
    exit,
    eof,
    received,
    spawnError,
    timedOut,
    truncated: received.stdout > streamLimit || received.stderr > streamLimit,
  };
  evidence.processes.push(record);
  await Promise.all([
    writeFile(join(evidence.output, name + '.stdout'), stdout, { mode: 0o600, flag: 'wx' }),
    writeFile(join(evidence.output, name + '.stderr'), stderr, { mode: 0o600, flag: 'wx' }),
  ]);
  assert.equal(record.spawnError, null, name + ' failed to spawn');
  assert.equal(record.timedOut, false, name + ' exceeded its process and stream deadline');
  assert.equal(record.truncated, false, name + ' exceeded its output cap');
  assert.deepEqual(
    record.eof,
    { stdout: true, stderr: true },
    name + ' must reach independent EOF',
  );
  assert.ok(record.exit, name + ' must produce an exit event');
  return { pid: child.pid, ...record.exit, stdout, stderr };
}

function expectExit(result, code, label) {
  assert.equal(result.signal, null, label + ' ended by signal');
  assert.equal(result.code, code, label + ' exited unexpectedly');
}

function expectHeadless(result, code, outcome, port) {
  expectExit(result, code, outcome);
  const expected = { version: 1, code: outcome };
  if (port !== undefined) expected.port = port;
  assert.equal(utf8.decode(result.stdout), JSON.stringify(expected) + '\n');
  assert.equal(result.stderr.length, 0);
}

function loopback(port, path, options = {}) {
  assert.ok(Number.isInteger(port) && port > 0 && !protectedPorts.has(port));
  const { body, token } = options;
  return new Promise((done, fail) => {
    const connection = request({
      host,
      port,
      path,
      agent: false,
      method: body === undefined ? 'GET' : 'POST',
      signal: AbortSignal.timeout(3000),
      headers:
        body === undefined
          ? { 'cache-control': 'no-cache' }
          : {
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(body),
              'x-graphgoblin-shutdown-token': token,
            },
    });
    connection.once('error', fail);
    connection.once('response', (response) => {
      const chunks = [];
      let count = 0;
      response.once('error', fail);
      response.on('data', (chunk) => {
        count += chunk.length;
        if (count > (options.limit ?? indexLimit)) {
          response.destroy(new Error('Loopback response exceeded the fixture cap.'));
          return;
        }
        chunks.push(chunk);
      });
      response.once('end', () => {
        done({
          status: response.statusCode,
          headers: response.rawHeaders,
          bytes: Buffer.concat(chunks),
        });
      });
    });
    connection.end(body);
  });
}

async function refused(port) {
  try {
    await loopback(port, '/healthz', { limit: 4096 });
    return false;
  } catch (error) {
    if (error?.code === 'ECONNREFUSED') return true;
    throw error;
  }
}

async function bindForeign(excluded = new Set()) {
  for (let attempts = 0; attempts < 8; attempts++) {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"status":"fixture-foreign"}');
    });
    await new Promise((done, fail) => {
      server.once('error', fail).listen({ host, port: 0 }, done);
    });
    const port = server.address().port;
    const close = () =>
      new Promise((done, fail) => server.close((error) => (error ? fail(error) : done())));
    if (!protectedPorts.has(port) && !excluded.has(port)) return { port, close };
    await close();
  }
  throw new Error('Could not bind an independent fixture port.');
}

function header(headers, name) {
  const values = [];
  for (let at = 0; at < headers.length; at += 2) {
    if (headers[at].toLowerCase() === name) values.push(headers[at + 1]);
  }
  assert.equal(values.length, 1, 'Expected exactly one ' + name);
  return values[0];
}

async function health(port, fingerprint) {
  const response = await loopback(port, '/healthz', { limit: 4096 });
  assert.equal(response.status, 200);
  assert.equal(utf8.decode(response.bytes), '{"status":"ok"}');
  assert.equal(header(response.headers, 'x-graphgoblin-instance'), fingerprint);
  const pidText = header(response.headers, 'x-graphgoblin-pid');
  assert.match(pidText, /^[1-9][0-9]*$/u);
  const pid = Number(pidText);
  assert.ok(Number.isSafeInteger(pid));
  const phase = header(response.headers, 'x-graphgoblin-phase');
  return { pid, phase };
}

async function bothShells(port, shells) {
  const observed = [];
  for (const { url, dir } of shells) {
    const expected = await readFile(join(dir, 'index.html'));
    const response = await loopback(port, url);
    assert.equal(response.status, 200);
    assert.equal(
      sha256(response.bytes),
      sha256(expected),
      'Served shell differs from built shell.',
    );
    const asset = [...utf8.decode(expected).matchAll(/\b(?:src|href)="([^"]+)"/gu)]
      .map((match) => match[1])
      .find((value) => value.startsWith(url + 'assets/') && /\.(?:css|js)$/u.test(value));
    assert.ok(asset, 'The shell must reference a representative built JS or CSS asset.');
    const name = asset.slice((url + 'assets/').length);
    assert.equal(basename(name), name);
    const builtAsset = await readFile(join(dir, 'assets', name));
    const servedAsset = await loopback(port, asset);
    assert.equal(servedAsset.status, 200);
    assert.equal(sha256(servedAsset.bytes), sha256(builtAsset));
    observed.push({ url, shell: sha256(expected), asset, assetHash: sha256(builtAsset) });
  }
  return observed;
}

async function processAndLeases(fixture, port, fingerprint, label) {
  const live = await health(port, fingerprint);
  assert.equal(live.phase, 'running');
  const native = await fixture.run(label, '/bin/ps', [
    '-ww',
    '-p',
    String(live.pid),
    '-o',
    'uid=',
    '-o',
    'lstart=',
    '-o',
    'command=',
  ]);
  expectExit(native, 0, 'owned gateway process inspection');
  const match = /^(\d+)\s+(\w{3} +\w{3} +\d{1,2} \d\d:\d\d:\d\d \d{4}) +(.+)$/u.exec(
    utf8.decode(native.stdout).trim(),
  );
  assert.ok(match, 'Could not establish owner UID, process birth and argv.');
  assert.equal(Number(match[1]), uid);
  assert.equal(match[3], fixture.node + ' ' + fixture.entry);
  const leases = [];
  for (const name of leaseNames) {
    const record = await ownedFile(join(fixture.dataDir, name), 1024, true);
    const owner = JSON.parse(utf8.decode(record.bytes));
    assert.equal(owner.pid, live.pid);
    assert.match(owner.token, /^[0-9a-f-]{36}$/u);
    leases.push({ name, hash: record.hash, identity: record.identity });
  }
  const after = await health(port, fingerprint);
  assert.deepEqual(after, live);
  return { pid: live.pid, birth: match[2], command: match[3], leases };
}

async function waitUntil(predicate, budget, failure) {
  const deadline = performance.now() + budget;
  while (performance.now() < deadline) {
    if (await predicate()) return;
    await pause(100);
  }
  throw new Error(failure);
}

async function drainVerified(fixture, port, fingerprint, owner) {
  const route = '/system/shutdown';
  assert.deepEqual(await processAndLeases(fixture, port, fingerprint, 'drain-before'), owner);
  const response = await loopback(port, route, { limit: 8192 });
  assert.equal(response.status, 200);
  const state = JSON.parse(utf8.decode(response.bytes));
  assert.equal(state.phase, 'running');
  assert.deepEqual(state.activeRunIds, []);
  assert.deepEqual(state.unconfirmedRunIds, []);
  assert.ok(typeof state.controlToken === 'string' && state.controlToken.length > 0);
  assert.deepEqual(await processAndLeases(fixture, port, fingerprint, 'drain-rebound'), owner);
  const drain = await loopback(port, route, {
    body: '{"action":"drain"}',
    token: state.controlToken,
    limit: 8192,
  });
  assert.equal(drain.status, 202);
  await waitUntil(
    async () =>
      (await refused(port)) &&
      (
        await Promise.all(
          leaseNames.map(
            async (name) =>
              (await statIfPresent(join(fixture.dataDir, name))) === undefined &&
              (await statIfPresent(join(fixture.dataDir, name + '.reclaim'))) === undefined,
          ),
        )
      ).every(Boolean),
    15_000,
    'The verified gateway listener and leases did not release.',
  );
  await waitUntil(
    async () => {
      const gone = await fixture.run('drain-process-exit', '/bin/ps', [
        '-ww',
        '-p',
        String(owner.pid),
        '-o',
        'lstart=',
      ]);
      if (
        gone.code === 1 &&
        gone.signal === null &&
        gone.stdout.length === 0 &&
        gone.stderr.length === 0
      )
        return true;
      expectExit(gone, 0, 'process birth reinspection');
      return utf8.decode(gone.stdout).trim() !== owner.birth;
    },
    10_000,
    'The verified gateway process did not exit after drain.',
  );
}

async function captureInstalled(fixture, port, previousID) {
  const applicationsIdentity = await ownedDirectory(dirname(fixture.app));
  const bundle = await ownedDirectory(fixture.app);
  const configPath = join(fixture.app, 'Contents', 'Resources', 'launcher.json');
  const plistPath = join(fixture.app, 'Contents', 'Info.plist');
  const [configuration, plist, executable] = await Promise.all([
    ownedFile(configPath, 16_384),
    ownedFile(plistPath, 32_768),
    ownedFile(fixture.launcher, 64 * 1024 * 1024),
  ]);
  const plistRead = await fixture.run('installed-plist', '/usr/bin/plutil', [
    '-convert',
    'json',
    '-o',
    '-',
    plistPath,
  ]);
  expectExit(plistRead, 0, 'installed plist');
  const values = JSON.parse(utf8.decode(plistRead.stdout));
  const id = values.GraphGoblinInstallationID;
  assert.match(id, /^[0-9a-f]{32}$/u);
  assert.equal(values.CFBundleIdentifier, 'com.graphgoblin.launcher.instance.' + id);
  if (previousID !== undefined) assert.equal(id, previousID);
  assert.deepEqual(JSON.parse(utf8.decode(configuration.bytes)), {
    version: 1,
    checkout: fixture.repo,
    node: fixture.node,
    dataDirectory: fixture.dataDir,
    port,
    requireAPIKey: false,
    ollamaEnabled: false,
  });
  const receiptPath = join(
    fixture.home,
    'Library',
    'Application Support',
    'GraphGoblin',
    'LauncherInstalls',
    id + '.json',
  );
  const record = await ownedFile(receiptPath, 16_384, true);
  const witness = {
    bundle,
    executable: executable.hash,
    plist: plist.hash,
    configuration: configuration.hash,
  };
  assert.deepEqual(JSON.parse(utf8.decode(record.bytes)), {
    version: 1,
    id,
    name: basename(fixture.app),
    applications: applicationsIdentity,
    installed: witness,
  });
  return { id, witness, receiptPath, receiptIdentity: record.identity, receiptHash: record.hash };
}

async function checkLogs(fixture, root) {
  const identity = await ownedDirectory(root);
  const directory = await lstat(root, { bigint: true });
  assert.equal(directory.mode & 0o077n, 0n);
  const slots = [];
  for (const name of await readdir(root)) {
    assert.ok(logNames.includes(name), 'Managed logs must use only fixed filenames.');
    const path = join(root, name);
    const info = await lstat(path, { bigint: true });
    assert.ok(info.isFile() && info.uid === BigInt(uid) && info.nlink === 1n);
    assert.equal(info.mode & 0o077n, 0n);
    assert.equal(info.dev, directory.dev);
    assert.ok(info.size <= BigInt(slotLimit), 'Managed slot exceeded 4 MiB.');
    slots.push({ name, size: Number(info.size), ...fileIdentity(info) });
  }
  assert.ok(
    slots.some(({ name }) => name === 'gateway.log'),
    'Cold start did not create the managed log.',
  );
  const gatewayLog = (await ownedFile(join(root, 'gateway.log'), slotLimit, true)).bytes;
  await writeFile(join(fixture.evidence.output, 'gateway.log.snapshot'), gatewayLog, {
    mode: 0o600,
    flag: 'wx',
  });
  return { identity, slots, gatewayLog };
}

async function setup(output) {
  const repo = await realpath(fileURLToPath(new URL('../..', import.meta.url)));
  const node = await realpath(process.execPath);
  const home = await realpath(userInfo().homedir);
  const temporary = await realpath(tmpdir());
  const base = await realpath(await mkdtemp(join(temporary, 'graphgoblin-macos-acceptance-')));
  const cfg = output ?? (await mkdtemp(join(temporary, 'graphgoblin-macos-evidence-')));
  if (output !== undefined) {
    await mkdir(dirname(cfg), { recursive: true, mode: 0o700 });
    await mkdir(cfg, { mode: 0o700 });
  }
  const id = randomUUID().replaceAll('-', '');
  const app = join(home, 'Applications', 'GraphGoblin QA ' + id + '.app');
  const dataDir = join(base, 'store α %');
  await mkdir(dataDir, { mode: 0o700 });
  await assert.rejects(lstat(app), { code: 'ENOENT' });
  const evidence = {
    output: cfg,
    nextProcess: 0,
    processes: [],
    cases: [],
    root: base,
    app,
    dataDir,
    git: process.env.GITHUB_SHA ?? null,
  };
  const env = {
    HOME: home,
    PATH: dirname(node) + ':/usr/bin:/bin:/usr/sbin:/sbin',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'C',
    TMPDIR: temporary,
  };
  return {
    repo,
    node,
    home,
    base,
    baseIdentity: await ownedDirectory(base),
    app,
    dataDir,
    evidence,
    entry: await realpath(join(repo, 'apps', 'api', 'dist', 'main.js')),
    helper: await realpath(join(repo, 'apps', 'api', 'dist', 'instance-identity.js')),
    shells: [
      { url: '/app/', dir: await realpath(join(repo, 'apps', 'web', 'dist')) },
      { url: '/goblin/', dir: await realpath(join(repo, 'apps', 'web', 'dist-goblin')) },
    ],
    installer: join(repo, 'scripts', 'install-macos-launcher.sh'),
    launcher: join(app, 'Contents', 'MacOS', 'GraphGoblin'),
    run: (label, executable, args, options = {}) =>
      observeProcess(evidence, label, executable, args, {
        cwd: repo,
        env,
        timeout: 10_000,
        ...options,
      }),
    env,
  };
}

function gatewayEnv(fixture, port, dataDir = fixture.dataDir) {
  return {
    ...fixture.env,
    GG_HOST: host,
    GG_PORT: String(port),
    GG_DATA_DIR: dataDir,
    GG_DB_URL: pathToFileURL(join(dataDir, 'graphgoblin.db')).href,
    GG_REQUIRE_API_KEY: 'false',
    GG_OLLAMA_ENABLED: 'false',
    GG_WEB_DIST: fixture.shells[0].dir,
    GG_GOBLIN_DIST: fixture.shells[1].dir,
  };
}

function install(fixture, port, label) {
  // The script is the public entry, with its admitted toolchain and exact typed install flags.
  return fixture.run(
    label,
    '/bin/bash',
    [
      fixture.installer,
      '--app-name',
      basename(fixture.app),
      '--node',
      fixture.node,
      '--data-dir',
      fixture.dataDir,
      '--port',
      String(port),
      '--disable-ollama',
    ],
    { timeout: 150_000 },
  );
}

function headless(fixture, label, ...args) {
  return fixture.run(label, fixture.launcher, args, { timeout: 75_000 });
}

async function apiControl(fixture, port, dataDir, root, label, code) {
  const snapshot = {
    version: 1,
    root,
    ...fileIdentity(await lstat(await realpath(root), { bigint: true })),
  };
  const result = await fixture.run(label, fixture.node, [fixture.entry], {
    timeout: 15_000,
    env: {
      ...gatewayEnv(fixture, port, dataDir),
      GG_MACOS_LAUNCHER_LOG_ADMISSION: JSON.stringify(snapshot),
    },
  });
  expectExit(result, code, label);
  assert.equal(result.stdout.length, 0);
  assert.equal(result.stderr.length, 0);
}

async function cleanSuccessfulFixture(fixture, installed, logRoot, logIdentity, port) {
  assert.deepEqual(await captureInstalled(fixture, port, installed.id), installed);
  for (const dir of ['Contents', join('Contents', 'MacOS'), join('Contents', 'Resources')])
    await ownedDirectory(join(fixture.app, dir));
  assert.deepEqual(await readdir(fixture.app), ['Contents']);
  assert.deepEqual((await readdir(join(fixture.app, 'Contents'))).sort(), [
    'Info.plist',
    'MacOS',
    'Resources',
  ]);
  assert.deepEqual(await readdir(join(fixture.app, 'Contents', 'MacOS')), ['GraphGoblin']);
  assert.deepEqual(await readdir(join(fixture.app, 'Contents', 'Resources')), ['launcher.json']);
  assert.deepEqual(await ownedDirectory(logRoot), logIdentity);
  for (const name of await readdir(logRoot)) {
    assert.ok(logNames.includes(name));
    const file = await ownedFile(join(logRoot, name), slotLimit, true);
    await writeFile(join(fixture.evidence.output, 'final-' + name), file.bytes, {
      mode: 0o600,
      flag: 'wx',
    });
  }
  assert.deepEqual(await ownedDirectory(fixture.base), fixture.baseIdentity);
  // All validated paths are exact per-run targets, never the default app, logs or parent directories.
  await rm(fixture.app, { recursive: true });
  await unlink(installed.receiptPath);
  await rm(logRoot, { recursive: true });
  await rm(fixture.base, { recursive: true });
}

async function sourceBinding(fixture) {
  let commit = process.env.GG_MACOS_LAUNCHER_SOURCE_COMMIT;
  let tree = process.env.GG_MACOS_LAUNCHER_SOURCE_TREE;
  let authority = 'transport-supplied source archive metadata';
  if (await statIfPresent(join(fixture.repo, '.git'))) {
    const head = await fixture.run('checked-out-head', '/usr/bin/git', [
      'rev-parse',
      '--show-toplevel',
      'HEAD',
      'HEAD^{tree}',
    ]);
    expectExit(head, 0, 'Git source binding');
    const [repository, gitCommit, gitTree] = utf8.decode(head.stdout).trim().split('\n');
    assert.equal(await realpath(repository), fixture.repo);
    if (commit !== undefined) assert.equal(commit, gitCommit);
    if (tree !== undefined) assert.equal(tree, gitTree);
    if (fixture.evidence.git !== null) assert.equal(gitCommit, fixture.evidence.git);
    commit = gitCommit;
    tree = gitTree;
    authority = 'local Git checkout';
  }
  // On an archive, only the reviewed transport can establish the supplied commit and tree.
  assert.match(commit ?? '', /^[0-9a-f]{40}$/u);
  assert.match(tree ?? '', /^[0-9a-f]{40}$/u);
  return {
    commit,
    tree,
    authority,
    main: sha256(await readFile(fixture.entry)),
    helper: sha256(await readFile(fixture.helper)),
    driver: sha256(await readFile(fileURLToPath(import.meta.url))),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    imageOS: process.env.ImageOS ?? null,
    imageVersion: process.env.ImageVersion ?? null,
  };
}

async function scopedAcceptance(fixture, t) {
  const { evidence, dataDir, launcher } = fixture;
  let foreign;
  let spare;
  let fingerprint;
  let primaryPort;
  let otherPort;
  let owner;
  let installed;
  let logRoot;
  let logIdentity;
  let failure;
  let stage = 'platform-and-toolchain';
  let cleanup = 'fixture preserved';
  const passed = (name) => {
    evidence.cases.push(name);
    t.diagnostic(name);
  };

  try {
    const platform = await fixture.run('platform', '/usr/bin/sw_vers', []);
    const swift = await fixture.run('swift', '/usr/bin/xcrun', [
      '--sdk',
      'macosx',
      'swift',
      '--version',
    ]);
    const sdk = await fixture.run('macos-sdk', '/usr/bin/xcrun', [
      '--sdk',
      'macosx',
      '--show-sdk-version',
    ]);
    for (const result of [platform, swift, sdk]) expectExit(result, 0, 'platform provenance');
    evidence.binding = await sourceBinding(fixture);

    stage = 'public-install';
    foreign = await bindForeign();
    primaryPort = foreign.port;
    spare = await bindForeign(new Set([primaryPort]));
    otherPort = spare.port;
    evidence.ports = { primary: primaryPort, contender: otherPort };
    const clean = await install(fixture, primaryPort, 'public-install');
    expectExit(clean, 0, 'public install');
    installed = await captureInstalled(fixture, primaryPort);
    evidence.installation = installed;
    assert.equal(await realpath(launcher), launcher);
    expectHeadless(
      await headless(fixture, 'installed-validation', '--validate-installation'),
      10,
      'installation-invalid',
    );
    expectHeadless(
      await headless(fixture, 'invalid-argv', '--ensure-gateway', '--validate-installation'),
      64,
      'usage',
    );
    passed(
      'Public install validated its staged bundle and published a receipt-bound alternate app.',
    );

    stage = 'foreign-loopback';
    expectHeadless(
      await headless(fixture, 'foreign-port', '--ensure-gateway'),
      20,
      'port-in-use',
      primaryPort,
    );
    const survivor = await loopback(primaryPort, '/healthz', { limit: 4096 });
    assert.equal(survivor.status, 200);
    assert.equal(utf8.decode(survivor.bytes), '{"status":"fixture-foreign"}');
    assert.deepEqual(await readdir(dataDir), []);
    await foreign.close();
    foreign = undefined;
    assert.equal(await refused(primaryPort), true);
    passed('A foreign listener survived the launcher refusal and no store was initialized.');

    stage = 'key-refusal';
    const sentinel = join(dataDir, 'nonfresh');
    const marker = Buffer.from('disposable nonfresh store sentinel\n');
    await writeFile(sentinel, marker, { mode: 0o600, flag: 'wx' });
    const bound = await ownedFile(sentinel, 1024, true);
    expectHeadless(
      await headless(fixture, 'missing-local-key', '--ensure-gateway'),
      13,
      'key-source-unavailable',
    );
    assert.deepEqual(await readdir(dataDir), ['nonfresh']);
    assert.deepEqual(await ownedFile(sentinel, 1024, true), bound);
    await unlink(sentinel);
    passed('An occupied store without its key refused before spawn and preserved its contents.');

    stage = 'expected-fingerprint';
    const expected = await fixture.run(
      'independent-identity-helper',
      fixture.node,
      [fixture.helper],
      {
        env: gatewayEnv(fixture, primaryPort),
      },
    );
    expectExit(expected, 0, 'independent helper');
    const match = /^([0-9a-f]{64})\n$/u.exec(utf8.decode(expected.stdout));
    assert.ok(match && match[0].length === expected.stdout.length);
    assert.equal(expected.stderr.length, 0);
    fingerprint = match[1];
    evidence.fingerprint = fingerprint;

    stage = 'concurrent-cold-launch';
    const attempts = await Promise.allSettled([
      headless(fixture, 'cold-attempt-one', '--ensure-gateway'),
      headless(fixture, 'cold-attempt-two', '--ensure-gateway'),
    ]);
    owner = await processAndLeases(fixture, primaryPort, fingerprint, 'cold-owner');
    evidence.owner = owner;
    for (const attempt of attempts) {
      if (attempt.status === 'rejected') throw attempt.reason;
      expectHeadless(attempt.value, 0, 'open-management-running', primaryPort);
      assert.notEqual(attempt.value.pid, owner.pid);
    }
    evidence.shells = await bothShells(primaryPort, fixture.shells);
    assert.deepEqual(
      await processAndLeases(fixture, primaryPort, fingerprint, 'post-shell-owner'),
      owner,
    );
    assert.equal((await ownedFile(join(dataDir, 'master.key'), 256, true)).bytes.length, 44);
    passed(
      'Concurrent cold attempts completed and a single verified gateway served both built shells after both launchers exited.',
    );

    stage = 'warm-and-log-admission';
    expectHeadless(
      await headless(fixture, 'warm', '--ensure-gateway'),
      0,
      'open-management-running',
      primaryPort,
    );
    assert.deepEqual(
      await processAndLeases(fixture, primaryPort, fingerprint, 'warm-owner'),
      owner,
    );
    logRoot = join(
      fixture.home,
      'Library',
      'Logs',
      'GraphGoblin',
      'LauncherInstances',
      installed.id,
    );
    const canary = 'GG-MACOS-ACCEPTANCE-PRIVATE-ACCESS';
    const routed = await loopback(primaryPort, '/healthz?probe=' + canary, { limit: 4096 });
    assert.equal(routed.status, 200);
    await waitUntil(
      async () => {
        const stats = await statIfPresent(join(logRoot, 'gateway.log'));
        if (!stats || stats.size > BigInt(slotLimit)) return false;
        const text = utf8.decode(await readFile(join(logRoot, 'gateway.log')));
        return text.includes('"route":"/healthz"') && text.includes('"statusCode":200');
      },
      3000,
      'The managed access projection did not reach the log.',
    );
    const logs = await checkLogs(fixture, logRoot);
    logIdentity = logs.identity;
    evidence.slots = logs.slots;
    const contents = utf8.decode(logs.gatewayLog);
    assert.ok(!contents.includes(canary));
    const listening = contents
      .slice(0, contents.lastIndexOf('\n'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((record) => record.msg === 'GraphGoblin API listening');
    assert.equal(listening.length, 1);
    assert.equal(listening[0].pid, owner.pid);
    passed('Warm launch kept the serving PID and private managed logs excluded the request query.');

    stage = 'physical-log-contention';
    const isolated = join(fixture.base, 'contender-store');
    await mkdir(isolated, { mode: 0o700 });
    const alias = join(fixture.base, 'managed-log-alias');
    await symlink(logRoot, alias, 'dir');
    await apiControl(fixture, primaryPort, isolated, alias, 'api-physical-log-contention', 70);
    assert.deepEqual(await readdir(isolated), []);
    assert.deepEqual(
      await processAndLeases(fixture, primaryPort, fingerprint, 'post-log-contender'),
      owner,
    );
    passed(
      'A second built API entry contended on the actual physical log reservation before touching its store.',
    );

    stage = 'under-lease-key-recheck';
    const controlLogs = join(fixture.base, 'recheck-logs');
    await mkdir(controlLogs, { mode: 0o700 });
    const database = join(isolated, 'graphgoblin.db');
    await writeFile(database, marker, { mode: 0o600, flag: 'wx' });
    const before = await ownedFile(database, 1024, true);
    await apiControl(fixture, otherPort, isolated, controlLogs, 'api-managed-key-recheck', 74);
    assert.deepEqual(await readdir(isolated), ['graphgoblin.db']);
    assert.deepEqual(await ownedFile(database, 1024, true), before);
    const preserved = (await ownedFile(join(controlLogs, 'gateway.log'), slotLimit, true)).bytes;
    const startup = JSON.parse(utf8.decode(preserved));
    assert.equal(startup.stage, 'store');
    assert.equal(startup.cause, 'key-source-unavailable');
    await writeFile(join(evidence.output, 'api-managed-key-recheck.gateway.log'), preserved, {
      mode: 0o600,
      flag: 'wx',
    });
    passed(
      'The actual managed API refused a missing local key at the store stage, preserving database bytes.',
    );

    stage = 'managed-replacement-and-held-store';
    await spare.close();
    spare = undefined;
    assert.equal(await refused(otherPort), true);
    const update = await install(fixture, otherPort, 'public-managed-replacement');
    expectExit(update, 0, 'public managed replacement');
    const replacement = await captureInstalled(fixture, otherPort, installed.id);
    assert.notDeepEqual(replacement.witness.bundle, installed.witness.bundle);
    assert.equal(replacement.receiptPath, installed.receiptPath);
    evidence.replacement = replacement;
    installed = replacement;

    assert.deepEqual(await ownedDirectory(logRoot), logIdentity);
    const launcherLogPath = join(logRoot, 'launcher.log');
    const previousLauncherLog = (await statIfPresent(launcherLogPath))
      ? await ownedFile(launcherLogPath, launcherSlotLimit, true)
      : undefined;
    expectHeadless(await headless(fixture, 'held-store', '--ensure-gateway'), 21, 'store-blocked');
    const launcherLog = await ownedFile(launcherLogPath, launcherSlotLimit, true);
    await writeFile(join(evidence.output, 'held-store.launcher.log'), launcherLog.bytes, {
      mode: 0o600,
      flag: 'wx',
    });
    assert.deepEqual(await ownedDirectory(logRoot), logIdentity);
    assert.equal(launcherLog.identity.device, logIdentity.device);
    const priorBytes = previousLauncherLog?.bytes.length ?? 0;
    if (previousLauncherLog) {
      // Only this fixture's earlier refusals can have used the fresh alternate log.
      assert.deepEqual(launcherLog.identity, previousLauncherLog.identity);
      assert.ok(launcherLog.bytes.subarray(0, priorBytes).equals(previousLauncherLog.bytes));
    }
    assert.equal(
      utf8.decode(launcherLog.bytes.subarray(priorBytes)),
      'stage=waiting-for-store outcome=store-blocked\n',
    );
    assert.equal(await refused(otherPort), true);
    assert.deepEqual(
      await processAndLeases(fixture, primaryPort, fingerprint, 'post-store-contender'),
      owner,
    );
    const held = await fixture.run(
      'store-state-held',
      fixture.node,
      [fixture.helper, '--store-state'],
      {
        env: gatewayEnv(fixture, otherPort),
      },
    );
    expectExit(held, 0, 'store state helper');
    assert.equal(held.stderr.length, 0);
    const state = JSON.parse(utf8.decode(held.stdout));
    assert.equal(state.state, 'held');
    assert.equal(state.path, join(dataDir, leaseNames[0]));
    passed(
      'Same-path replacement kept the alternate identity and logged the held-store deadline refusal.',
    );

    stage = 'verified-drain';
    await drainVerified(fixture, primaryPort, fingerprint, owner);
    owner = undefined;
    const free = await fixture.run(
      'store-state-free',
      fixture.node,
      [fixture.helper, '--store-state'],
      {
        env: gatewayEnv(fixture, otherPort),
      },
    );
    expectExit(free, 0, 'released store state helper');
    assert.equal(utf8.decode(free.stdout), '{"state":"free"}\n');
    assert.equal(free.stderr.length, 0);
    passed(
      'Supported drain released both leases, the verified process birth and the loopback listener.',
    );

    stage = 'fixture-cleanup';
    await cleanSuccessfulFixture(fixture, installed, logRoot, logIdentity, otherPort);
    cleanup = 'verified disposable bundle, receipt, logs and store removed; evidence retained';
  } catch (error) {
    failure = error;
  } finally {
    for (const listener of [foreign, spare]) {
      if (listener) {
        try {
          await listener.close();
        } catch {
          /* Fixture and original failure are retained. */
        }
      }
    }
    if (failure && owner !== undefined) {
      try {
        await drainVerified(fixture, primaryPort, fingerprint, owner);
        cleanup = 'verified gateway drained; failed fixture and evidence retained';
      } catch (error) {
        evidence.cleanupError = error.message;
      }
    }
    evidence.outcome = failure ? 'failed' : 'passed';
    evidence.stage = stage;
    evidence.cleanup = cleanup;
    if (failure) evidence.failure = failure.message;
    evidence.processes.sort((first, second) => first.name.localeCompare(second.name));
    await writeFile(
      join(evidence.output, 'manifest.json'),
      JSON.stringify(evidence, null, 2) + '\n',
      {
        mode: 0o600,
        flag: 'wx',
      },
    );
    t.diagnostic('Evidence: ' + evidence.output);
  }
  if (failure) throw failure;
}

test(
  'macOS public launcher, native headless process and actual gateway',
  {
    skip: process.platform !== 'darwin' || process.arch !== 'arm64',
    timeout: 450_000,
  },
  async (t) => {
    const configured = process.env.GG_MACOS_LAUNCHER_ARTIFACT_DIR;
    const fixture = await setup(configured ? resolve(configured) : undefined);
    await scopedAcceptance(fixture, t);
  },
);

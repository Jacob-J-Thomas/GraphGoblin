import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, readlink, realpath, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const suite = await realpath(dirname(fileURLToPath(import.meta.url)));
const [phase, checkoutArg, evidenceName, ...extras] = process.argv.slice(2);
assert.ok(['baseline', 'candidate'].includes(phase));
assert.match(evidenceName ?? '', /^evidence-(baseline|candidate)-[a-z0-9-]{3,48}$/);
assert.ok(evidenceName.startsWith('evidence-' + phase + '-'));
assert.equal(extras.length, 0);
assert.equal(process.platform, 'win32');
assert.equal(process.version, 'v22.23.4');
assert.deepEqual(process.execArgv, []);
assert.equal(process.env.NODE_OPTIONS, undefined);
const profile = resolve(suite, '..', '..', '..', '..');
const node = await realpath(join(profile, '.claude', 'codex-runs', 'GraphGoblin',
  'runtime', 'node-v22.23.4-win-x64', 'node.exe'));
assert.equal(await realpath(process.execPath), node);
const checkout = await realpath(resolve(checkoutArg));
const worktrees = await realpath(join(profile, '.codex', 'worktrees'));
assert.match(relative(worktrees, checkout), /^gg-[^\\/]+[\\/]GraphGoblin$/i);
const junctionSuite = join(profile, 'graphgoblin-qa', '2026-11-13-aidlc-batch', 'launcher-435-native-preparation');
assert.equal(await realpath(junctionSuite), junctionSuite);
const sharedBindings = {};
for (const [name, file, expected] of [
  ['junctionManifest', 'SHA256SUMS.txt', '9bc668ac5cf3b56b84d6aa1d4ccb1ad24f8656bd10325282f32e532c1d839130'],
  ['junctionRunner', 'run.mjs', '2cbb10e74295b22f040837a354e826189e5bb168b769cb335c3ab7053d69fe43'],
  ['windowsNativeUtilities', 'native.mjs', '486f6b060ca6ba16320af8f198de51251c90632b56ef444053dba41bea09587d'],
]) {
  const input = join(junctionSuite, file);
  assert.equal(await realpath(input), input);
  assert.ok((await lstat(input)).isFile());
  const value = createHash('sha256').update(await readFile(input)).digest('hex');
  assert.equal(value, expected, file);
  sharedBindings[name] = { file: input, sha256: value };
}
const { checkPort, createNative, observe, refused, selectPort, sha256, systemRoot } =
  await import(pathToFileURL(sharedBindings.windowsNativeUtilities.file).href);
const evidence = join(suite, evidenceName);
const helperRel = 'apps/api/dist/instance-identity.js';
const mainRel = 'apps/api/dist/main.js';
const launcherRel = 'apps/windows-launcher/Launcher.cs';
const webRel = 'apps/web/dist';
const goblinRel = 'apps/web/dist-goblin';
const alias = join(evidence, 'checkout symlink α 雪 %');
const pendingGateways = new Map();
const usedPorts = new Set();
const stores = new Set();
const result = {
  phase, checkout, evidence, node, runnerPid: process.pid, bindings: { ...sharedBindings }, cases: {},
  tier: 'built direct helper and native Windows launcher --ensure-gateway over real TCP and file SQLite store',
  processes: [], ports: [], cleanup: {},
};
let stage = 'binding';
let native;
let launcher;
let failure;
let capabilityRefusal;

function serialize(_key, value) {
  return value instanceof Error ? { ...value, name: value.name, message: value.message, stack: value.stack } : value;
}

function save(name, value) {
  return writeFile(join(evidence, name), JSON.stringify(value, serialize, 2) + '\n', { flag: 'wx' });
}

async function bind(name, file) {
  const canonical = await realpath(file);
  assert.equal(canonical, file);
  result.bindings[name] = { file, sha256: sha256(await readFile(file)) };
}

function goodIdentity(call) {
  assert.equal(call.exit.code, 0);
  assert.equal(call.stderr, '');
  assert.match(call.stdout, /^[0-9a-f]{64}\n$/);
  assert.equal(call.stdout.length, 65);
  return call.stdout.slice(0, -1);
}

function aliasSilence(call) {
  assert.equal(call.exit.code, 0);
  assert.equal(call.stdout, '');
  assert.equal(call.stderr, '');
}

function freeState(call) {
  assert.equal(call.exit.code, 0);
  assert.equal(call.stderr, '');
  assert.match(call.stdout, /^[^\r\n]*\n$/);
  assert.equal(call.stdout.split('\n').length, 2);
  assert.deepEqual(JSON.parse(call.stdout), { state: 'free' });
}

function invalidConfig(call) {
  assert.equal(call.exit.code, 1);
  assert.equal(call.stdout, '');
  assert.match(call.stderr, /^Launcher configuration is invalid\. Check the configured GG_\* overrides\.\r?\n$/);
}

function helperEnvironment(config, overrides = {}) {
  // Exact effective helper/configuration inputs from Configuration.ChildEnvironment at source.
  return {
    ...native.env, ...config.Environment,
    PATH: dirname(node) + ';' + native.env.PATH,
    GG_HOST: '127.0.0.1', GG_PORT: String(config.Port), GG_DATA_DIR: config.DataDir,
    GG_WEB_DIST: join(config.Repo, webRel), ...overrides,
  };
}

async function directHelper(label, config, args = [], overrides = {}, entry = join(config.Repo, helperRel)) {
  return native.run(label, node, [entry, ...args], config.Repo,
    { childEnv: helperEnvironment(config, overrides), timeout: 18_000, reapReadOnly: true });
}

async function store(name) {
  const directory = join(evidence, name);
  await mkdir(directory);
  assert.equal(await realpath(directory), directory);
  stores.add(directory);
  return directory;
}

async function port() {
  const selected = await selectPort();
  assert.ok(!usedPorts.has(selected), 'OS reused an earlier fixture port; preserve first evidence');
  usedPorts.add(selected);
  result.ports.push(selected);
  assert.equal(await refused(selected), true);
  return selected;
}

function cfg(repo, data, portNumber) {
  checkPort(portNumber);
  return {
    Repo: repo, Node: node, DataDir: data, Port: portNumber,
    Environment: { GG_LOG_LEVEL: 'info', GG_REQUIRE_API_KEY: 'false',
      GG_OLLAMA_ENABLED: 'false', GG_SWAGGER_UI: 'false' },
    LauncherAppUserModelId: 'GraphGoblin.QA435.Isolated',
    StartupTimeoutSeconds: 30, WindowTimeoutSeconds: 2,
  };
}

async function writeConfig(label, config) {
  const directory = join(evidence, 'native-' + label);
  await mkdir(directory);
  assert.equal(await realpath(directory), directory);
  const file = join(directory, 'fixture config α.json');
  await writeFile(file, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
  const received = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(received, config);
  return { config, directory, file };
}

async function launch(label, written, extra = []) {
  return native.run(label, launcher, ['--config', written.file, '--ensure-gateway', ...extra], checkout,
    { timeout: 72_000 });
}

async function exchange(portNumber, path, options = {}) {
  checkPort(portNumber);
  assert.ok(path.startsWith('/') && !path.startsWith('//'));
  const origin = 'http://127.0.0.1:' + portNumber;
  const response = await fetch(origin + path, {
    ...options, redirect: 'error', signal: AbortSignal.timeout(4000),
    headers: { connection: 'close', ...options.headers },
  });
  return response;
}

async function health(config) {
  const response = await exchange(config.Port, '/healthz');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
  assert.match(response.headers.get('x-graphgoblin-pid') ?? '', /^[1-9][0-9]*$/);
  const pid = Number(response.headers.get('x-graphgoblin-pid'));
  assert.ok(Number.isSafeInteger(pid));
  const identity = response.headers.get('x-graphgoblin-instance');
  assert.match(identity ?? '', /^[0-9a-f]{64}$/);
  return { pid, identity, phase: response.headers.get('x-graphgoblin-phase') };
}

async function lease(data, name) {
  assert.ok(stores.has(data));
  const file = join(data, name);
  const raw = await readFile(file);
  const value = JSON.parse(raw);
  return { file, pid: value.pid, creation: value.windowsCreationTime, sha256: sha256(raw) };
}

async function sqliteFile(data) {
  assert.ok(stores.has(data));
  const file = join(data, 'graphgoblin.db');
  assert.ok((await lstat(file)).isFile());
  assert.equal(await realpath(file), file);
  const handle = await open(file, 'r');
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    assert.equal(bytesRead, header.length);
    assert.equal(header.toString('ascii'), 'SQLite format 3\0');
  } finally { await handle.close(); }
  return file;
}

async function readGateway(config, expected, originalLauncherPid) {
  const response = await health(config);
  assert.equal(response.identity, expected);
  assert.equal(response.phase, 'running');
  const identity = await native.cim(response.pid);
  assert.equal(identity.pid, response.pid);
  assert.equal(await realpath(identity.executable), node);
  assert.equal(identity.parentPid, originalLauncherPid);
  const args = /^"([^"]+)"\s+"([^"]+)"$/u.exec(identity.commandLine);
  assert.ok(args, 'expected the native argv to name one exact Node executable and built entry');
  assert.equal(await realpath(args[1]), node);
  assert.equal(await realpath(args[2]), join(checkout, mainRel));
  const dirLock = await lease(config.DataDir, 'graphgoblin.lock');
  const dbLock = await lease(config.DataDir, 'graphgoblin.db.graphgoblin.lock');
  for (const lock of [dirLock, dbLock]) {
    assert.equal(lock.pid, response.pid);
    assert.equal(lock.creation, identity.creationFileTime);
  }
  return { ...response, identityProof: identity, actualEntryArgument: args[2], dirLock, dbLock,
    sqliteFile: await sqliteFile(config.DataDir) };
}

async function assetProof(config, route, directory) {
  const local = join(checkout, directory);
  const expected = await readFile(join(local, 'index.html'));
  const shell = await exchange(config.Port, route);
  assert.equal(shell.status, 200);
  assert.match(shell.headers.get('content-type') ?? '', /^text\/html/);
  const received = Buffer.from(await shell.arrayBuffer());
  assert.ok(received.equals(expected), route + ' served/bound shell SHA-256: ' +
    sha256(received) + ' / ' + sha256(expected));
  const quoted = /<script\b[^>]*\bsrc=(["'])([^"']+)\1/iu.exec(expected.toString('utf8'));
  assert.ok(quoted);
  const origin = 'http://127.0.0.1:' + config.Port;
  const asset = new URL(quoted[2], origin + route);
  assert.equal(asset.origin, origin);
  assert.ok(asset.pathname.startsWith(route));
  assert.equal(asset.search, '');
  assert.equal(asset.hash, '');
  const localAsset = join(local, decodeURIComponent(asset.pathname.slice(route.length)));
  assert.ok((await realpath(localAsset)).startsWith(local + '\\'));
  const expectedAsset = await readFile(localAsset);
  const served = await exchange(config.Port, asset.pathname);
  assert.equal(served.status, 200);
  const receivedAsset = Buffer.from(await served.arrayBuffer());
  assert.ok(receivedAsset.equals(expectedAsset), asset.pathname + ' served/bound asset SHA-256: ' +
    sha256(receivedAsset) + ' / ' + sha256(expectedAsset));
  return { route, shellSha256: sha256(received), asset: asset.pathname, assetSha256: sha256(expectedAsset) };
}

async function absent(path) {
  try { await lstat(path); return false; }
  catch (error) { if (error.code === 'ENOENT') return true; throw error; }
}


async function symlinkIdentity() {
  assert.equal(dirname(alias), evidence);
  assert.notEqual(alias, checkout);
  const entry = await lstat(alias, { bigint: true });
  assert.ok(entry.isSymbolicLink());
  assert.equal(await realpath(alias), checkout);
  return { device: String(entry.dev), inode: String(entry.ino), linkTarget: await readlink(alias) };
}

const linkTypeQuery = Buffer.from(String.raw`
$ErrorActionPreference = 'Stop'
$qaItem = Get-Item -LiteralPath $env:QA435_LINK -Force
$qaRecord = [ordered]@{
    linkType = [string]$qaItem.LinkType
    directory = [bool]($qaItem.Attributes -band [IO.FileAttributes]::Directory)
    reparse = [bool]($qaItem.Attributes -band [IO.FileAttributes]::ReparsePoint)
} | ConvertTo-Json -Compress
[Console]::WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($qaRecord)))
`, 'utf16le').toString('base64');

async function stopVerified(known, receipt) {
  const { config, before, launcherPid } = known;
  assert.deepEqual(await readGateway(config, before.identity, launcherPid), before);
  const running = await exchange(config.Port, '/runs?status=queued,running,waiting,paused&limit=1');
  assert.equal(running.status, 200);
  assert.deepEqual((await running.json()).items, []);
  const status = await exchange(config.Port, '/system/shutdown');
  assert.equal(status.status, 200);
  const control = await status.json();
  assert.ok(control.controlToken);
  const action = await exchange(config.Port, '/system/shutdown', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-graphgoblin-shutdown-token': control.controlToken },
    body: '{"action":"drain"}',
  });
  assert.equal(action.status, 202);
  await action.text();
  await observe('closed listener and released exact store locks', async () => {
    if (!(await refused(config.Port))) return false;
    const names = ['graphgoblin.lock', 'graphgoblin.lock.reclaim',
      'graphgoblin.db.graphgoblin.lock', 'graphgoblin.db.graphgoblin.lock.reclaim'];
    return (await Promise.all(names.map((name) => absent(join(config.DataDir, name))))).every(Boolean);
  }, 20_000);
  const after = await observe('exact original Windows process identity absent', async () => {
    const snapshot = await native.cim(before.pid);
    return (!snapshot.pid || snapshot.creationFileTime !== before.identityProof.creationFileTime)
      ? snapshot : false;
  }, 8_000);
  receipt.gateway = { pid: before.pid, oldCreation: before.identityProof.creationFileTime,
    pidAfter: after, port: config.Port, portRefused: true, locksReleased: true, drainStatus: action.status };
  pendingGateways.delete(config.Port);
}

async function wrongConfigControls(label, written, expected, before, launcherPid) {
  const config = written.config;
  for (const [suffix, replacement] of [
    ['store', { DataDir: await store('refused-' + label + '-store') }],
    ['settings', { Environment: { ...config.Environment, GG_REQUIRE_API_KEY: 'true' } }],
  ]) {
    const negative = await writeConfig(label + '-wrong-' + suffix, { ...config, ...replacement });
    const changed = goodIdentity(await directHelper(label + ' wrong ' + suffix + ' identity', negative.config));
    assert.notEqual(changed, expected);
    const refusedLaunch = await launch(label + ' wrong ' + suffix, negative);
    assert.equal(refusedLaunch.exit.code, 1);
    assert.equal(refusedLaunch.stdout, '');
    assert.match(refusedLaunch.stderr, /unrelated or differently configured service/);
    assert.ok(await absent(join(negative.directory, 'gateway.log')));
    assert.deepEqual(await readGateway(config, expected, launcherPid), before);
    if (replacement.DataDir) assert.deepEqual(await readdir(replacement.DataDir), []);
    result.cases[label + '-wrong-' + suffix] = { config: negative.file, changedFingerprint: changed,
      originalPid: before.pid, originalCreation: before.identityProof.creationFileTime,
      refused: true, processRecordPid: refusedLaunch.pid };
  }
}

async function launchModes(label, written, spelling, expected, alternate) {
  const config = written.config;
  assert.equal(await refused(config.Port), true);
  assert.deepEqual(await readdir(config.DataDir), []);
  const cold = await launch(label + ' cold', written);
  if (phase === 'baseline' && spelling === 'alias') {
    assert.equal(cold.exit.code, 1);
    assert.equal(cold.stdout, '');
    assert.match(cold.stderr, /runtime, launcher configuration or store ownership could not be checked/);
    assert.equal(await refused(config.Port), true);
    assert.deepEqual(await readdir(config.DataDir), []);
    assert.ok(await absent(join(written.directory, 'gateway.log')));
    result.cases[label] = { coldLauncherPid: cold.pid, expectedOldRefusal: true, noWriter: true };
    return;
  }
  assert.equal(cold.exit.code, 0, cold.stderr);
  assert.equal(cold.stdout, '');
  assert.equal(cold.stderr, '');
  const before = await readGateway(config, expected, cold.pid);
  const owned = { config, before, launcherPid: cold.pid };
  pendingGateways.set(config.Port, owned);
  await save(label + '-gateway-identity.json', owned);
  const recorded = { config: written.file, configuredRepo: config.Repo, coldLauncherPid: cold.pid,
    before, shells: await Promise.all([assetProof(config, '/app/', webRel), assetProof(config, '/goblin/', goblinRel)]) };
  result.cases[label] = recorded;
  const stillHeld = await directHelper(label + ' live --store-state', config, ['--store-state']);
  assert.equal(stillHeld.exit.code, 0);
  assert.equal(stillHeld.stderr, '');
  const held = JSON.parse(stillHeld.stdout);
  assert.equal(held.state, 'held');
  assert.equal(await realpath(held.path), before.dirLock.file);
  recorded.heldReason = held.detail;

  const warm = await launch(label + ' warm', written);
  assert.equal(warm.exit.code, 0, warm.stderr);
  assert.equal(warm.stdout, '');
  assert.equal(warm.stderr, '');
  assert.deepEqual(await readGateway(config, expected, cold.pid), before);
  recorded.warmLauncherPid = warm.pid;

  if (alternate) {
    const viaOther = await writeConfig(label + '-opposite-spelling', { ...config, Repo: alternate });
    const cross = await launch(label + ' warm via other spelling', viaOther);
    if (phase === 'baseline') {
      assert.equal(cross.exit.code, 1);
      assert.equal(cross.stdout, '');
      assert.match(cross.stderr, /runtime, launcher configuration or store ownership could not be checked/);
    } else {
      assert.equal(cross.exit.code, 0, cross.stderr);
      assert.equal(cross.stdout, '');
      assert.equal(cross.stderr, '');
    }
    assert.ok(await absent(join(viaOther.directory, 'gateway.log')));
    assert.deepEqual(await readGateway(config, expected, cold.pid), before);
    recorded.crossPathWarm = { configuredRepo: alternate, launcherPid: cross.pid, exit: cross.exit,
      unchangedServingPid: before.pid };
  }
  await wrongConfigControls(label, written, expected, before, cold.pid);
  await stopVerified(owned, recorded);
}

await mkdir(evidence);
assert.equal(await realpath(evidence), evidence);
const watchdog = setTimeout(() => {
  process.stderr.write('QA #435 overall watchdog. Retain the owned paths and process evidence for review.\n');
  process.exit(124);
}, 245_000);

try {
  await bind('node', node);
  for (const [name, file] of Object.entries({ helper: helperRel, gateway: mainRel, launcherSource: launcherRel,
    web: webRel + '/index.html', goblin: goblinRel + '/index.html' })) await bind(name, join(checkout, file));
  const scratch = join(evidence, 'temp');
  await mkdir(scratch);
  native = createNative(scratch, result.processes);
  const compiler = await realpath(join(systemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'));
  await bind('compiler', compiler);
  const systemPowerShell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  await bind('systemPowerShell', systemPowerShell);
  await save('runner.json', result);

  stage = 'native directory symbolic link creation';
  assert.ok(await absent(alias));
  try {
    await symlink(checkout, alias, 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code) && await absent(alias)) {
      capabilityRefusal = error;
      result.symlinkCapability = { state: 'creation-refused', requestedType: 'dir', alias, target: checkout,
        error, aliasAbsent: true };
    }
    throw error;
  }
  stage = 'verify native directory symbolic link';
  const entry = await symlinkIdentity();
  const inspected = await native.run('Windows directory symbolic link type', systemPowerShell,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', linkTypeQuery], scratch,
    { childEnv: { ...native.env, QA435_LINK: alias }, timeout: 9000, reapReadOnly: true });
  assert.equal(inspected.exit.code, 0);
  assert.equal(inspected.stderr, '');
  const encoded = inspected.stdout.trim();
  assert.match(encoded, /^[A-Za-z0-9+/]+={0,2}$/);
  const bytes = Buffer.from(encoded, 'base64');
  assert.equal(bytes.toString('base64'), encoded);
  const metadata = JSON.parse(bytes.toString('utf8'));
  assert.deepEqual({ directory: metadata.directory, reparse: metadata.reparse }, { directory: true, reparse: true });
  assert.match(metadata.linkType, /^(?:SymbolicLink|SymLink)$/);
  assert.equal(await realpath(join(alias, helperRel)), join(checkout, helperRel));
  result.symlinkCapability = { state: 'verified', requestedType: 'dir', nativeQueryPid: inspected.pid };
  result.symlink = { alias, target: checkout, aliasedHelper: join(alias, helperRel), entry, metadata };
  stage = 'symbolic link and helper matrix';
  const first = cfg(checkout, await store('direct-store'), await port());
  const second = cfg(alias, await store('aliased-store'), await port());
  const baselineAliasEnv = { ...first, Repo: alias };
  const direct = goodIdentity(await directHelper('direct helper identity', first));
  assert.equal(goodIdentity(await directHelper('relative entry from direct cwd', first, [], {},
    './' + helperRel)), direct);
  freeState(await directHelper('direct store state', first, ['--store-state']));
  const aliasIdentity = await directHelper('symbolic link helper identity', baselineAliasEnv);
  const aliasState = await directHelper('symbolic link store state', baselineAliasEnv, ['--store-state']);
  if (phase === 'baseline') {
    aliasSilence(aliasIdentity);
    aliasSilence(aliasState);
  } else {
    assert.equal(goodIdentity(aliasIdentity), direct);
    freeState(aliasState);
  }
  for (const config of [first, baselineAliasEnv]) {
    const absoluteEntry = join(config.Repo, helperRel);
    const script = 'const m = await import(' + JSON.stringify(pathToFileURL(absoluteEntry).href) +
      '); if (typeof m.instanceIdentity !== "function") throw new Error("missing export"); process.stdout.write("qa435-import-ok\\n");';
    const imported = await native.run('imported helper remains inert', node,
      ['--input-type=module', '-e', script], config.Repo,
      { childEnv: helperEnvironment(config), timeout: 18_000, reapReadOnly: true });
    assert.equal(imported.exit.code, 0);
    assert.equal(imported.stdout, 'qa435-import-ok\n');
    assert.equal(imported.stderr, '');
    assert.deepEqual(await readdir(config.DataDir), [], 'import changed the empty owned store');
    const invalid = await directHelper('invalid helper environment', config, ['--store-state'], { GG_PORT: 'invalid' });
    if (phase === 'baseline' && config.Repo === alias) aliasSilence(invalid);
    else invalidConfig(invalid);
  }
  const missing = await directHelper('missing aliased entry', baselineAliasEnv, [], {},
    join(alias, 'apps/api/dist/qa435-missing-identity.js'));
  assert.notEqual(missing.exit.code, 0);
  assert.equal(missing.stdout, '');
  assert.match(missing.stderr, /MODULE_NOT_FOUND/);
  assert.deepEqual(await readdir(first.DataDir), []);
  assert.deepEqual(await readdir(second.DataDir), []);
  for (const value of usedPorts) assert.equal(await refused(value), true);
  result.cases.helper = { fingerprint: direct, symlinkExit: aliasIdentity.exit,
    symlinkStdout: aliasIdentity.stdout, symlinkStateStdout: aliasState.stdout,
    readOnlyEmptyStores: true, listenersAbsentAfterHelperMatrix: true };

  stage = 'external native launcher compilation';
  launcher = join(evidence, 'QA GraphGoblin 435.exe');
  const compile = await native.run('csc exact launcher source', compiler, [
    '/nologo', '/target:winexe', '/platform:x64', '/reference:System.Windows.Forms.dll',
    '/reference:System.Web.Extensions.dll', '/out:' + launcher, join(checkout, launcherRel),
  ], evidence, { timeout: 30_000, reapReadOnly: true });
  assert.equal(compile.exit.code, 0, compile.stdout + compile.stderr);
  result.launcher = { file: launcher, sha256: sha256(await readFile(launcher)), compiler: compiler };
  const firstConfig = await writeConfig('real', first);
  const secondConfig = await writeConfig('alias', second);

  stage = 'native argument and path controls';
  const arg = await launch('unknown quiet launcher argument', firstConfig, ['--qa435-unknown']);
  assert.equal(arg.exit.code, 1);
  assert.match(arg.stderr, /Unknown launcher argument/);
  const invalidPath = await writeConfig('missing-repo', { ...first, Repo: join(evidence, 'missing checkout') });
  const pathRefusal = await launch('missing checkout launcher config', invalidPath);
  assert.equal(pathRefusal.exit.code, 1);
  assert.match(pathRefusal.stderr, /Invalid launcher paths/);
  assert.deepEqual(await readdir(first.DataDir), []);
  assert.equal(await refused(first.Port), true);
  result.cases.negativeInvocation = { unknownFlagExit: arg.exit.code, missingRepoExit: pathRefusal.exit.code,
    targetStillFree: true };

  stage = 'real native cold/warm/wrong configuration';
  await launchModes('real', firstConfig, 'real', direct, alias);
  stage = 'verbatim symbolic link native cold/warm/wrong configuration';
  const secondExpected = goodIdentity(await directHelper('canonical expected fingerprint for aliased store',
    { ...second, Repo: checkout }));
  await launchModes('alias', secondConfig, 'alias', secondExpected,
    phase === 'candidate' ? checkout : undefined);

  stage = 'owned cleanup';
  assert.equal(pendingGateways.size, 0);
  assert.ok(result.processes.every((item) => item.close));
  for (const directory of stores) {
    const receipt = {};
    result.cleanup[directory] = receipt;
    await native.closeStore(evidence, directory, receipt);
  }
  assert.deepEqual(await symlinkIdentity(), result.symlink.entry);
  await unlink(alias);
  assert.ok(await absent(alias));
  result.cleanup.symlinkRemoved = true;
  for (const value of usedPorts) assert.equal(await refused(value), true);
} catch (error) {
  failure = error;
  result.firstFailure = { stage, error };
  await save('first-failure.json', result);
  // Only ordinary drain of a fully verified gateway. An unknown/ambiguous PID is left for root.
  for (const known of [...pendingGateways.values()]) {
    const receipt = {};
    result.cleanup['owned-gateway-' + known.config.Port] = receipt;
    try { await stopVerified(known, receipt); } catch (cleanupError) { receipt.error = cleanupError; }
  }
} finally {
  const unavailable = capabilityRefusal !== undefined && failure === capabilityRefusal;
  result.status = unavailable ? 'capability-unavailable' : failure ? 'incomplete' : 'assertions-met';
  result.remainingVerifiedGateways = [...pendingGateways].map(([portNumber, known]) =>
    ({ port: portNumber, pid: known.before.pid, creation: known.before.identityProof.creationFileTime, store: known.config.DataDir }));
  await save('summary.json', result);
  clearTimeout(watchdog);
  if (failure) process.exit(unavailable ? 2 : 1);
}

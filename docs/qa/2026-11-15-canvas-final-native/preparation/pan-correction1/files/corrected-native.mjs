import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ownedMouseController } from './owned-mouse-controller.mjs';

const script = fileURLToPath(import.meta.url);
const preparedRoot = dirname(script);
const [mode, admissionPath, admissionSha, argument, ...cases] = process.argv.slice(2);
assert(admissionPath && /^[a-f0-9]{64}$/.test(admissionSha ?? ''), 'Supply the signed-off literal admission path and SHA-256');
const rawAdmission = await readFile(resolve(admissionPath));
const digest = (data) => createHash('sha256').update(data).digest('hex');
assert.equal(digest(rawAdmission), admissionSha, 'Admission changed');
const admission = JSON.parse(rawAdmission.toString('utf8'));
assert.equal(admission.status, 'ROOT_ADMITTED');
assert(['run', 'gateway'].includes(mode), 'This packet cannot build or admit');
const correctedCases = ['pan-reset', 'blank-device', 'coarse', 'protected-chat'];
if (mode === 'run') assert.deepEqual(cases, ['correction1', ...correctedCases], 'Only the exact correction1 batch is admitted');
const { preparedManifestSha256: correctedManifest, previousContinuationAdmission, panCorrectionApproval,
  panCorrectionReceipts, ...sameContinuation } = admission;
const continuationAdmissionHash = '1a5c189451eaf74a611638885f5e05da5a05cbe9de84ccafcb97c999ff04ec29';
assert.equal(previousContinuationAdmission?.sha256, continuationAdmissionHash);
const previousContinuation = await readFile(resolve(previousContinuationAdmission.path));
assert.equal(digest(previousContinuation), continuationAdmissionHash);
const { preparedManifestSha256: continuationManifest, ...expectedContinuation } = JSON.parse(previousContinuation);
assert.equal(continuationManifest, 'd4bbc290c80e6dab75479c36a1e039eb2fe9db01cf0c8870a233115579026bd1');
assert.deepEqual(sameContinuation, expectedContinuation);
const originalAdmissionHash = '6e081ebbe9b710c99eb5bd26d37d6e24d0a693d6b369c5e5622865443b0894f3';
const { originalAdmission, administrativeClearance, ...unchangedAdmission } = sameContinuation;
assert.equal(originalAdmission?.sha256, originalAdmissionHash, 'Original root admission required');
const original = await readFile(resolve(originalAdmission.path));
assert.equal(digest(original), originalAdmissionHash);
const { preparedManifestSha256: originalManifest, ...previousAdmission } = JSON.parse(original);
assert.equal(originalManifest, '146b57ff6a48497e2b1460628a5bcb8201f609cb6eeaca0ccb8eb80e14061a37');
assert.deepEqual(unchangedAdmission, previousAdmission, 'Only continuation manifest and administrative references may differ');
for (const key of ['resetDisposition', 'selectionDisposition', 'integration']) {
  const receipt = admission.rootApprovals?.[key];
  assert(receipt && /^[a-f0-9]{64}$/.test(receipt.sha256), 'Missing root-accepted ' + key);
  assert.equal(digest(await readFile(resolve(receipt.path))), receipt.sha256, key + ' changed');
}
assert.equal(admission.rootApprovals.selectionDisposition.sha256, 'c0c8dfc514a8ff7c1a386d10f1849a81fddff64334ea016951332bcdcfc2dacd');
for (const control of ['modifier', 'keyboard']) assert.equal(admission.selectionControls?.[control], 'exercise');
const osStatus = admission.nativeMouse?.status;
assert(['ROOT_GRANTED_OWNED_FOREGROUND', 'HOST_UNAVAILABLE_ROOT_REVIEW'].includes(osStatus),
  'Bind admission for the disposable OS input witness');
const alreadyUsed = admission.fixtureBudget?.correctedBatchesAlreadyUsed;
assert.equal(admission.fixtureBudget?.knownNegativeBatchesUsed, 2);
assert(Number.isInteger(alreadyUsed) && alreadyUsed >= 0 && alreadyUsed <= 2,
  'Bind the total prior corrections across corrected candidate heads');
const extras = admission.extraEmbeddedLeaves;
assert(Array.isArray(extras) && extras.every((leaf) => /^[A-Za-z0-9_./-]+$/.test(leaf) &&
  !leaf.includes('..') && !leaf.startsWith('/')), 'Bind accepted extra source-map inputs');
const { head, tree, target, actualMain, checkout, evidenceRoot } = admission.candidate;
for (const sha of [head, tree, target, actualMain]) assert(/^[a-f0-9]{40}$/.test(sha));
assert.equal(target, actualMain, 'Run targets actual main, using its exact readback');
assert.equal(process.version, 'v22.23.4');
process.env.GIT_OPTIONAL_LOCKS = '0';
const identity = { head, tree, base: target, actualMain };
const repo = await realpath(checkout);
const evidence = resolve(evidenceRoot);
assert(repo.toLowerCase().includes('\\.codex\\worktrees\\') &&
  !repo.toLowerCase().includes('canvas-repair'), 'Root must provide a clean integrated isolated checkout');
assert.equal(evidence, resolve(preparedRoot, '..', 'corrected-doubleclick-native-' + head.slice(0, 12)),
  'Use the admitted external execution sibling for this immutable head');
assert(relative(repo, evidence).startsWith('..'), 'Evidence must be external');
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const archive = await readFile(join(preparedRoot, 'literal-manifest.json'));
assert.equal(digest(archive), correctedManifest, 'Prepared manifest changed');
for (const [name, expected] of Object.entries(JSON.parse(archive.toString('utf8')).files)) {
  assert(/^[\w. -]+$/.test(name), 'Unsafe prepared source name');
  assert.equal(digest(await readFile(join(preparedRoot, name))), expected.sha256, 'Prepared artifact changed ' + name);
}
const scenarios = await json(join(preparedRoot, 'scenarios.json'));
if (mode === 'gateway') assert(correctedCases.includes(cases[0]), 'Never rerun an earlier passing fixture');

const record = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const git = (...args) => execFileSync('git', args, { cwd: repo, maxBuffer: 24 * 1024 * 1024 });

function frozenCheckout() {
  const [head, tree, actualMain] = git('rev-parse', 'HEAD', 'HEAD^{tree}', 'origin/main').toString().trim().split(/\r?\n/);
  assert.deepEqual({ head, tree, actualMain }, {
    head: identity.head, tree: identity.tree, actualMain: identity.actualMain,
  });
  assert.equal(git('merge-base', identity.base, identity.head).toString().trim(), identity.base);
  assert.equal(git('status', '--porcelain=v1').toString(), '', 'Frozen checkout must stay clean');
}

async function sourceClosure() {
  const entries = git('ls-tree', '-rz', identity.head).toString('utf8').split('\0').filter(Boolean);
  const records = {};
  for (const entry of entries) {
    const [head, path] = entry.split('\t');
    if (path.startsWith('docs/qa/')) continue;
    const [attributes, type, gitBlob] = head.split(' ');
    assert.equal(type, 'blob', path);
    const bytes = await readFile(join(repo, path));
    records[path] = { sha256: digest(bytes), bytes: bytes.length, gitBlob, attributes };
  }
  const dependencies = [
    'node_modules/.pnpm/@xyflow+system@0.0.83/node_modules/@xyflow/system/dist/esm/index.js',
    'apps/web/node_modules/@xyflow/react/dist/esm/index.js',
    'node_modules/.pnpm/d3-drag@3.0.0/node_modules/d3-drag/src/drag.js',
    'node_modules/.pnpm/d3-drag@3.0.0/node_modules/d3-drag/src/nodrag.js',
    'node_modules/.pnpm/d3-zoom@3.0.0/node_modules/d3-zoom/src/zoom.js',
  ];
  for (const path of dependencies) {
    const bytes = await readFile(join(repo, path));
    records[path] = { sha256: digest(bytes), bytes: bytes.length, installed: true };
  }
  return records;
}

async function walk(folder, visit) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = join(folder, entry.name);
    assert(!entry.isSymbolicLink(), file);
    if (entry.isDirectory()) await walk(file, visit);
    else {
      assert(entry.isFile(), file);
      await visit(file);
    }
  }
}

async function buildFiles(trees) {
  const all = {};
  for (const name of trees) {
    const dir = join(repo, name);
    const files = {};
    await walk(dir, async (file) => {
      files[relative(dir, file).replaceAll('\\', '/')] = digest(await readFile(file));
    });
    all[name] = Object.fromEntries(Object.keys(files).sort().map((file) => [file, files[file]]));
  }
  return all;
}

async function priorReadback() {
  frozenCheckout();
  await mkdir(evidence);
  const previous = admission.priorOutputs;
  let actual;
  let previousBundle = null;
  if (previous?.kind === 'bound') {
    const raw = await readFile(previous.binding);
    assert.equal(digest(raw), previous.sha256, 'Historical binding bytes changed');
    const binding = JSON.parse(raw.toString('utf8'));
    assert.deepEqual(Object.keys(binding.artifacts).sort(), [...artifactTrees].sort());
    actual = await buildFiles(artifactTrees);
    assert.deepEqual(actual, binding.artifacts, 'Prior entire output set changed');
    previousBundle = binding.bundle;
  } else {
    assert.equal(previous?.kind, 'unbuilt', 'Root must name old output binding or an explicitly unbuilt checkout');
    for (const tree of artifactTrees) assert(!existsSync(join(repo, tree)), 'Unexpected prior output ' + tree);
    actual = {};
  }
  const sources = await sourceClosure();
  const files = Object.values(actual).reduce((sum, tree) => sum + Object.keys(tree).length, 0);
  await record(join(evidence, 'prebuild-artifact-readback.json'), {
    ...identity, prior: previous, priorBundle: previousBundle, trees: artifactTrees, files, artifacts: actual,
  });
  await record(join(evidence, 'source-closure-before.json'), { ...identity, sources });
  await record(join(evidence, 'execution-admission.json'), { admissionPath: resolve(admissionPath), admissionSha, ...identity, repo });
  console.log('Verified prebuild artifacts ' + files + ' and current source closure ' + Object.keys(sources).length + '.');
}

const artifactTrees = [
  'apps/web/dist', 'apps/web/dist-goblin', 'apps/api/dist', 'apps/mcp/dist',
  'apps/plugin-codex/dist', 'apps/plugin-claude/dist', 'packages/contracts/dist',
  'packages/domain/dist', 'packages/engine/dist', 'packages/infrastructure/dist',
  'packages/api-client/dist', 'packages/adapter-codex/dist', 'packages/adapter-jev/dist',
];


const embeddedLeaves = [
  'editor/Canvas.tsx', 'editor/OrthogonalEdge.tsx', 'editor/NodeEditorDialog.tsx',
  'editor/stranded-edges.ts', 'editor/ValidationIndicator.tsx', 'editor/model.ts',
  'editor/useResolveConflict.ts', 'editor/useLoadEditor.ts', 'editor/useAutosave.ts',
  'editor/store.ts', 'editor/viewport-gesture.ts', 'editor/decision-route-edges.ts',
  'editor/EditorPage.tsx', 'editor/IssuePopover.tsx', 'drafts/local-drafts.ts',
  'forms/SchemaForm.tsx', 'forms/repair.ts', 'editor/route-editing.ts', 'editor/canvas-focus.ts',
];

async function inspectCurrent() {
  frozenCheckout();
  const before = await json(join(evidence, 'source-closure-before.json'));
  const old = await json(join(evidence, 'prebuild-artifact-readback.json'));
  const build = await json(join(evidence, 'forced-build-exit.json'));
  assert.deepEqual([build.head, build.tree, build.base, build.actualMain, build.node, build.exitCode, build.cleanAfter],
    [identity.head, identity.tree, identity.base, identity.actualMain, process.version, 0, true]);
  const log = await readFile(join(evidence, 'forced-build.log'));
  assert.equal(digest(log), build.logSha256);
  assert.match(log.toString(), /12 successful,\s*12 total/);
  assert.match(log.toString(), /0 cached,\s*12 total/);
  assert.deepEqual(await sourceClosure(), before.sources, 'Frozen source closure changed');
  const artifacts = await buildFiles(old.trees);
  const web = artifacts['apps/web/dist'];
  const candidates = Object.keys(web).filter((file) => /^assets\/index-[\w-]+\.js$/.test(file));
  assert.equal(candidates.length, 1);
  const main = candidates[0];
  const bundle = '/app/' + main;
  assert.notEqual(bundle, old.priorBundle, 'Fresh corrected bundle remains byte-identical to prior admitted runtime');
  const sourcemap = await json(join(repo, 'apps/web/dist', main + '.map'));
  const embedded = {};
  for (const leaf of new Set([...embeddedLeaves, ...extras])) {
    const i = sourcemap.sources.findIndex((path) => path.endsWith('/' + leaf));
    assert(i >= 0, 'Missing critical embedded source ' + leaf);
    const hash = digest(sourcemap.sourcesContent[i]);
    assert.equal(hash, before.sources['apps/web/src/' + leaf].sha256, leaf + ' embedded bytes');
    embedded[leaf] = hash;
  }
  assert(!sourcemap.sources.some((path) => path.endsWith('/NodeConnections.tsx')));
  return {
    ...identity, node: process.version, bundle, bundleSha256: web[main],
    mapSha256: web[main + '.map'], apiEntrySha256: artifacts['apps/api/dist']['main.js'],
    artifactFiles: Object.values(artifacts).reduce((sum, tree) => sum + Object.keys(tree).length, 0),
    sourceFiles: Object.keys(before.sources).length, artifacts, embedded,
  };
}

async function admitted() {
  const current = await inspectCurrent();
  await record(join(evidence, 'binding-before.json'), current);
  console.log('Admitted ' + current.bundle + ' with ' + current.sourceFiles + ' source inputs, ' +
    Object.keys(current.embedded).length + ' embedded modules and ' + current.artifactFiles + ' artifact hashes.');
}

function child(executable, args, cwd, env = process.env) {
  const instance = spawn(executable, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  instance.stdout.on('data', (data) => { stdout += data; });
  instance.stderr.on('data', (data) => { stderr += data; });
  instance.stdin.on('error', (error) => { stderr += String(error); });
  const exit = once(instance, 'close').then(([code, signal]) => ({ code, signal, stdout, stderr }));
  return { instance, exit, stdout: () => stdout };
}

const delay = (milliseconds) => new Promise((done) => {
  const timer = setTimeout(done, milliseconds);
  timer.unref();
});

async function withDeadline(task, milliseconds, fallback) {
  return Promise.race([task, delay(milliseconds).then(() => fallback)]);
}

async function runCli(cli, output, session, stage, args, deadline = 95000, env = process.env) {
  const command = child(process.execPath, [cli, '-s=' + session, ...args], output, env);
  command.instance.stdin.end();
  const outcome = await withDeadline(command.exit, stage === 'run' ? deadline : 20000, null);
  const timedOut = outcome === null;
  if (timedOut) command.instance.kill();
  const settled = outcome ?? await command.exit;
  await writeFile(join(output, 'browser-' + stage + '.log'), settled.stdout + settled.stderr, { flag: 'wx' });
  return { ...settled, timedOut, pid: command.instance.pid };
}

async function portClosed(port) {
  return new Promise((done) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => { socket.destroy(); done(false); });
    socket.once('error', (error) => done(error.code === 'ECONNREFUSED'));
    socket.setTimeout(1200, () => { socket.destroy(); done(false); });
  });
}

async function settleClosedStore(output, gatewayCleanup) {
  assert(gatewayCleanup && !gatewayCleanup.listening, 'Gateway close was unverified');
  const outputPath = await realpath(output);
  const store = await realpath(gatewayCleanup.scratch);
  assert(/^gateway-store-[\w-]+$/.test(relative(outputPath, store)), 'Disposable store path was not admitted');
  const readResidue = async () => (await readdir(store)).filter((name) => /(?:\.lock|\.reclaim|-wal|-shm)$/i.test(name));
  const before = await readResidue();
  assert(!before.some((name) => /\.(?:lock|reclaim)$/i.test(name)), 'Fixture ownership lock still exists');
  let checkpoint;
  if (before.length) {
    const file = join(store, 'graphgoblin.db');
    assert(existsSync(file), 'Missing disposable SQLite database');
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(file);
    try {
      checkpoint = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
      assert.equal(checkpoint.busy, 0, 'Closed disposable store WAL still busy');
    } finally {
      db.close();
    }
  }
  const residue = await readResidue();
  const disposition = { store, before, checkpoint, residue, checkedAt: new Date().toISOString() };
  await record(join(output, 'post-gateway-file-readback.json'), disposition);
  assert.deepEqual(residue, [], 'Closed disposable SQLite store still has sidecars');
  return disposition;
}

async function runFixture(cli, batchDir, scenario, binding) {
  const output = join(batchDir, scenario);
  await mkdir(output);
  const plan = scenarios[scenario];
  assert(plan, 'Unknown admitted case');
  if (scenario === 'selection-os-mouse' && osStatus === 'HOST_UNAVAILABLE_ROOT_REVIEW') {
    const result = { scenario, result: 'LIMITED_OS_MOUSE_HOST_NOT_ADMITTED',
      error: 'No foreground host admission for this witness', launched: false };
    await record(join(output, 'run.json'), result);
    return result;
  }
  const browserDriver = plan.driver;
  const configPath = plan.config ?? 'desktop.edge.json';
  await copyFile(join(preparedRoot, browserDriver), join(output, browserDriver));
  await copyFile(join(preparedRoot, configPath), join(output, configPath));
  const session = 'gg207-' + identity.head.slice(0, 8) + '-' + scenario + '-' + process.pid;
  const gateway = child(process.execPath, [script, 'gateway', admissionPath, admissionSha, output, scenario], output);
  const info = { scenario, session, orchestratorPid: process.pid, gatewayPid: gateway.instance.pid,
    startedAt: new Date().toISOString(), head: identity.head };
  let origin;
  let mouse = null;
  let browserEnv = process.env;
  try {
    const gatewayReady = await new Promise((done) => {
      const capture = () => {
        const match = /GG_QA_READY (http:\/\/127\.0\.0\.1:\d+)/.exec(gateway.stdout());
        if (match) {
          gateway.instance.stdout.removeListener('data', capture);
          done(match[1]);
        }
      };
      gateway.instance.stdout.on('data', capture);
      capture();
      gateway.exit.then(() => done(null));
      delay(18000).then(() => done(null));
    });
    assert(gatewayReady, 'Compiled disposable gateway never became ready');
    origin = gatewayReady;
    info.origin = origin;
    const port = Number(new URL(origin).port);
    assert(![4747, 4748].includes(port));
    const pid = String(gateway.instance.pid);
    const policy = { frozen: true, head: identity.head, bundle: binding.bundle,
      removeName: 'Remove connection', resetName: 'Reset route',
      recoverySectionRole: 'group', recoverySectionName: 'Connections the canvas cannot draw',
      recoveryActionPrefix: 'Remove edge ' };
    if (scenario === 'selection-os-mouse') {
      const helper = join(preparedRoot, 'owned-mouse.ps1');
      await copyFile(helper, join(output, 'owned-mouse.ps1'));
      mouse = await ownedMouseController(output, info.startedAt, helper);
      browserEnv = { ...process.env, TMP: mouse.fixtureTemp, TEMP: mouse.fixtureTemp };
      info.ownedMousePort = mouse.port;
    }
    const query = new URLSearchParams({ ...mouse?.query, case: scenario, bundle: binding.bundle, gatewayPid: pid,
      'qa-mode': 'after', 'qa-map': '207-final-independent-native-v1',
      'qa-pid': pid, 'qa-bundle': binding.bundle,
      'qa-case': plan.action ?? scenario, 'qa-group': plan.group ?? scenario,
      'qa-policy': JSON.stringify(policy) });
    const open = await runCli(cli, output, session, 'open', ['open', origin + '/app/loops?' + query, '--config=' + configPath], 20000, browserEnv);
    info.browserOpen = { code: open.code, timedOut: open.timedOut, pid: open.pid };
    info.browserPid = Number(open.stdout.match(/opened with pid (\d+)/)?.[1]) || null;
    assert.equal(open.code, 0, open.stderr);
    const played = await runCli(cli, output, session, 'run', ['run-code', '--filename=' + browserDriver], plan.timeoutMs, browserEnv);
    info.browserRun = { code: played.code, timedOut: played.timedOut, pid: played.pid };
    assert.equal(played.code, 0, played.stderr);
    const line = played.stdout.split(/\r?\n/).find((entry) => entry.startsWith('{"suite":') && entry.includes(plan.suite));
    assert(line, 'No structured Playwright result');
    const observed = JSON.parse(line);
    await record(join(output, 'observed.json'), observed);
    info.result = observed.outcome ?? (observed.failure ? null : 'PASS_PRESERVATION');
    info.failure = observed.failure ?? null;
    info.writes = (observed.puts ?? observed.writes).length;
    info.pageErrors = observed.pageErrors;
    info.checkpoints = observed.checkpoints.length;
    assert(!observed.failure, JSON.stringify(observed.failure));
    if (plan.expected && !info.result?.startsWith('REPRODUCED_')) assert.equal(info.result, plan.expected);
    assert(observed.bundleResponses?.some((entry) => entry.status === 200) || observed.loaded?.includes(200));
    assert.equal(observed.pageErrors.length, 0);
  } catch (error) {
    info.error = String(error.stack ?? error);
  } finally {
    if (mouse) {
      try {
        await mouse.close();
        info.ownedMousePortClosed = await portClosed(mouse.port);
        assert(info.ownedMousePortClosed, 'Owned mouse coordinator port remains open');
      } catch (error) { info.cleanupError = String(error.stack ?? error); }
    }
    const closed = await runCli(cli, output, session, 'close', ['close'], 20000, browserEnv).catch((error) => ({ error: String(error) }));
    info.browserClose = { code: closed.code, timedOut: closed.timedOut, error: closed.error, pid: closed.pid };
    gateway.instance.stdin.end('\n');
    let exit = await withDeadline(gateway.exit, 13000, null);
    info.gatewayForced = exit === null;
    if (exit === null) {
      gateway.instance.kill();
      exit = await gateway.exit;
    }
    info.gatewayExit = { code: exit.code, signal: exit.signal };
    await writeFile(join(output, 'gateway.log'), exit.stdout + exit.stderr, { flag: 'wx' });
    if (origin) info.portClosed = await portClosed(Number(new URL(origin).port));
    info.gatewayCleanup = existsSync(join(output, 'gateway-closed.json')) ? await json(join(output, 'gateway-closed.json')) : null;
    if (info.portClosed && !info.gatewayForced && info.gatewayCleanup) {
      try { info.closedStore = await settleClosedStore(output, info.gatewayCleanup); }
      catch (error) { info.cleanupError ??= String(error.stack ?? error); }
    }
    info.finishedAt = new Date().toISOString();
    await record(join(output, 'run.json'), info);
  }
  console.log(JSON.stringify({ scenario, outcome: info.result, failure: info.failure, error: info.error,
    writes: info.writes, pageErrors: info.pageErrors, portClosed: info.portClosed, gatewayExit: info.gatewayExit,
    cleanupError: info.cleanupError ?? null }));
  return info;
}

async function confirmOptionalMouseDisposition() {
  const exact = {
    disposition: ['first-phase-root-disposition.md', '2a642a0a02657f5f972d98bf636f5eb4ad4ba7871c6e5024fe19a7c4bb2f8a54'],
    overview: ['runs/initial-clicks/overview.json', '40bfe0e8a17a35cc0e8bb8fb4726d3a8f8b2319725cd2c389ed87808f26b7fbe'],
    osRun: ['runs/initial-clicks/selection-os-mouse/run.json', 'f4951512dc8a00efe74acfbb933a5e6e2371aa440e323b306094f9446bfb15e6'],
    osObserved: ['runs/initial-clicks/selection-os-mouse/observed.json', 'ed381e9faf325392b238ffc30f74f3a41f0b05fea0ebf4c2b0d7befac1cb94d2'],
    osRefusal: ['runs/initial-clicks/selection-os-mouse/owned-mouse-move-refusal.json', 'c47e5177b57cc803c364723987979dafdd1b4bab4454e660fd58423b17e192e8'],
    cleanup: ['first-phase-terminal-cleanup.json', 'd9064d3fc015993f884eccba99307c33cf98edb93bf6fd21fdac57c980bb86b2'],
    browserPid: ['first-phase-refused-browser-pid-readback.json', 'bb021048267564d43b40d50d5314dbfef36a77f7dbd4f39f9d47aa27553bff4e'],
    binding: ['binding-before.json', '30301a845a772e816da4bdfe4816766e81278fe58dcfd8b3ca4ee249925da81f'],
    firstBindingAfter: ['runs/initial-clicks/binding-after.json', '30301a845a772e816da4bdfe4816766e81278fe58dcfd8b3ca4ee249925da81f'],
  };
  assert.deepEqual(Object.keys(administrativeClearance).sort(), Object.keys(exact).sort());
  const records = {};
  for (const [key, [name, sha256]] of Object.entries(exact)) {
    const path = resolve(evidence, name);
    assert.equal(resolve(administrativeClearance[key].path), path);
    assert.equal(administrativeClearance[key].sha256, sha256);
    const bytes = await readFile(path);
    assert.equal(digest(bytes), sha256, key + ' first-phase bytes changed');
    if (name.endsWith('.json')) records[key] = JSON.parse(bytes);
  }
  const { overview, osRun, osObserved, osRefusal, cleanup, browserPid, binding } = records;
  for (const record of [overview, binding]) {
    assert.deepEqual([record.head, record.tree, record.actualMain], [identity.head, identity.tree, identity.actualMain]);
  }
  assert.equal(osRun.head, identity.head);
  assert.deepEqual(overview.outcomes.map(({ scenario }) => scenario),
    ['selection-doubleclick', 'reset-doubleclick', 'selection-touch', 'selection-os-mouse']);
  assert.deepEqual(overview.outcomes[3], osRun);
  for (const row of overview.outcomes) {
    assert(!row.failure && !row.cleanupError && !row.gatewayForced && row.portClosed &&
      row.gatewayExit.code === 0 && row.browserClose.code === 0 && row.closedStore.residue.length === 0 &&
      row.pageErrors.length === 0, 'No other first-phase failure or cleanup issue is waived');
  }
  for (const row of overview.outcomes.slice(0, 3)) {
    assert(!row.error);
    assert.equal(row.result, scenarios[row.scenario].expected);
  }
  const limitation = 'LIMITED_OS_MOUSE_WINDOW_OR_PROCESS_GUARD';
  assert.equal(osRun.result, limitation);
  assert(osRun.error.startsWith('AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:') &&
    osRun.error.includes("+ '" + limitation + "'") && osRun.error.includes("- 'PASS_OS_MOUSE_BROWSER_CLASSIFICATION'"));
  assert.equal(osRun.ownedMousePortClosed, true);
  assert.equal(osRefusal.stage, 'move');
  assert(osRefusal.refused.includes('Exact 100% single-display calibration is unavailable'));
  assert.equal(osObserved.outcome, limitation);
  const probe = osObserved.checkpoints.find((item) => item.label === 'owned headed Edge OS-injected double-click');
  assert.deepEqual(probe.events.map(({ type }) => type), ['pointermove']);
  assert.deepEqual([probe.clicks, probe.pointers, probe.writes], [[], [], []]);
  const osOutput = join(evidence, 'runs', 'initial-clicks', 'selection-os-mouse');
  for (const name of ['owned-mouse-move.json', 'owned-mouse-double.json', 'owned-mouse-double-refusal.json']) {
    assert(!existsSync(join(osOutput, name)), 'OS calibration or injection advanced unexpectedly');
  }
  assert.equal(cleanup.allClosed, true);
  assert.deepEqual(cleanup.gitIdentity, [identity.head, identity.tree, identity.actualMain]);
  assert.deepEqual(cleanup.gitStatus, []);
  assert.deepEqual([cleanup.bindingBefore, cleanup.bindingAfter], [exact.binding[1], exact.firstBindingAfter[1]]);
  assert.deepEqual(cleanup.fixtures.map((item) => item.scenario), overview.outcomes.map((item) => item.scenario));
  for (const row of cleanup.fixtures) {
    assert.deepEqual([row.active, row.listeners, row.residual, row.browserClose, row.gatewayExit], [[], [], [], 0, 0]);
  }
  assert.equal(cleanup.fixtures[3].coordinatorClosed, true);
  assert.deepEqual([browserPid.browserPid, browserPid.matchedLive], [29032, []]);
  return { scenario: 'selection-os-mouse', result: limitation, dispositionSha256: exact.disposition[1] };
}

async function confirmPanCorrection() {
  const pinned = {
    focusedOverview: ['runs/initial-focused/overview.json', '5c924d1190b6156924f462063aa4b74df9af8e5c96891cff3aa0a07bbcc467f6'],
    focusedCleanup: ['runs/initial-focused/terminal-cleanup.json', '87239884843492f33d32a5b1521cea4ed4290601f3d723a2dbac298edd1ace9f'],
    preservationOverview: ['runs/initial-preservation/overview.json', '0637af1af39bc9742fd3146db7ea81868803e0cb01d26f8d8248ae1e355ef9b6'],
    preservationCleanup: ['runs/initial-preservation/terminal-cleanup.json', 'e08108b67192c4c4f9887f8c5730a2523b880e508f300dc5d6acee86844951e8'],
    panFailure: ['runs/initial-preservation/pan-reset/run.json', '3331a28b5c2bba593b172b1ed07b701c96d2ba908c00d2a7a7c75fcbc8f23381'],
    finalCleanup: ['final-terminal-cleanup.json', '100a9c6a087a251d8eb624830fe50de9418e98b1f4c712332634886612406126'],
  };
  assert.deepEqual(Object.keys(panCorrectionReceipts).sort(), Object.keys(pinned).sort());
  const receipts = {};
  for (const [key, [name, sha256]] of Object.entries(pinned)) {
    const path = resolve(evidence, name);
    assert.equal(resolve(panCorrectionReceipts[key].path), path);
    assert.equal(panCorrectionReceipts[key].sha256, sha256);
    const bytes = await readFile(path);
    assert.equal(digest(bytes), sha256, key + ' original evidence changed');
    receipts[key] = JSON.parse(bytes);
  }

  const approvalPath = join(evidence, 'pan-correction1-root-approval.json');
  assert.equal(resolve(panCorrectionApproval.path), approvalPath);
  assert(/^[a-f0-9]{64}$/.test(panCorrectionApproval.sha256 ?? ''), 'Root correction approval still pending');
  const rawApproval = await readFile(approvalPath);
  assert.equal(digest(rawApproval), panCorrectionApproval.sha256);
  assert.deepEqual(JSON.parse(rawApproval), {
    status: 'ROOT_APPROVED_PAN_FIXTURE_CORRECTION1',
    head: identity.head, tree: identity.tree, actualMain: identity.actualMain,
    preparedManifestSha256: correctedManifest, previousContinuationAdmissionSha256: continuationAdmissionHash,
    preservationOverviewSha256: pinned.preservationOverview[1], fixtureCorrectionBatch: 1, caseOrder: correctedCases,
  });
  assert.equal(alreadyUsed, 0);
  const { focusedOverview, focusedCleanup, preservationOverview, preservationCleanup, panFailure, finalCleanup } = receipts;
  for (const [overview, terminal, scenarios] of [
    [focusedOverview, focusedCleanup, ['duplicate', 'reload', 'hidden', 'script-geometry', 'node-drag']],
    [preservationOverview, preservationCleanup, ['shared', 'script', 'decisions', 'pan-reset']],
  ]) {
    assert.deepEqual([overview.head, overview.tree, overview.actualMain], [identity.head, identity.tree, identity.actualMain]);
    assert.deepEqual(overview.outcomes.map((row) => row.scenario), scenarios);
    assert.deepEqual(terminal.fixtures.map((row) => row.scenario), scenarios);
    assert(terminal.allClosed);
    assert.deepEqual([terminal.bindingBefore, terminal.bindingAfter],
      ['30301a845a772e816da4bdfe4816766e81278fe58dcfd8b3ca4ee249925da81f',
       '30301a845a772e816da4bdfe4816766e81278fe58dcfd8b3ca4ee249925da81f']);
    for (const row of terminal.fixtures) {
      assert.deepEqual([row.active, row.listeners, row.residual, row.browserClose, row.gatewayExit], [[], [], [], 0, 0]);
    }
  }
  for (const row of [...focusedOverview.outcomes, ...preservationOverview.outcomes.slice(0, 3)]) {
    assert(row.result.startsWith('PASS_') && !row.failure && !row.error && !row.cleanupError);
  }
  assert.deepEqual(preservationOverview.outcomes[3], panFailure);
  assert.equal(panFailure.result, null);
  assert.equal(panFailure.failure.message, 'Error: Pan release generated and suppressed its own trusted click');
  assert(!panFailure.cleanupError && finalCleanup.allClosed);
  return { approvalSha256: panCorrectionApproval.sha256, originalPreservationOverviewSha256: pinned.preservationOverview[1],
    fixtureCorrectionBatch: 1, cases: correctedCases };
}

async function run(cli, batch, requested) {
  frozenCheckout();
  assert(existsSync(cli));
  assert(requested.length && requested.every((item) => Object.hasOwn(scenarios, item)));
  assert.equal(new Set(requested).size, requested.length, 'No repeated fixture in one batch');
  const phases = ['clicks', 'focused', 'preservation'];
  const initial = phases.map((phase) => 'initial-' + phase);
  const corrections = ['correction1', 'correction2'];
  const selectedPhase = initial.indexOf(batch);
  const correctionNumber = corrections.indexOf(batch) + 1;
  assert(selectedPhase >= 0 || correctionNumber > alreadyUsed,
    'Use one first pass per phase or an unspent globally numbered correction batch');
  const required = (phase) => Object.keys(scenarios).filter((name) => scenarios[name].phase === phase);
  const administrativeRecord = await confirmOptionalMouseDisposition();
  const panCorrection = await confirmPanCorrection();
  const administrativelyCleared = new Set([administrativeRecord.scenario]);
  const passed = new Set();
  const casesPreviouslyTried = new Set();
  for (const name of [...initial, ...corrections]) {
    const path = join(evidence, 'runs', name, 'overview.json');
    if (!existsSync(path)) continue;
    const prior = await json(path);
    assert.equal(prior.head, identity.head);
    for (const row of prior.outcomes) {
      casesPreviouslyTried.add(row.scenario);
      assert(!row.result?.startsWith('REPRODUCED_'), 'Stop candidate after a reproduced product defect');
      if (!row.error && !row.failure && !row.cleanupError && row.result &&
          !row.gatewayForced && row.portClosed && row.gatewayExit?.code === 0 &&
          row.browserClose?.code === 0 && row.closedStore?.residue?.length === 0) passed.add(row.scenario);
    }
  }
  if (selectedPhase >= 0) {
    const phase = phases[selectedPhase];
    for (const previous of phases.slice(0, selectedPhase)) {
      assert(required(previous).every((name) => passed.has(name) || administrativelyCleared.has(name)),
        'Finish and inspect prior phase ' + previous);
    }
    assert.deepEqual(requested, required(phase).filter((name) => !passed.has(name)),
      'Execute every outstanding phase case once in the frozen order');
  } else {
    assert(correctionNumber === alreadyUsed + 1 ||
      existsSync(join(evidence, 'runs', 'correction' + (correctionNumber - 1), 'overview.json')),
      'Correction slots are globally ordered');
    assert(requested.some((name) => casesPreviouslyTried.has(name) && !passed.has(name)) &&
      requested.every((name) => !passed.has(name) &&
        scenarios[name].phase === scenarios[requested[0]].phase),
      'A correction resumes one affected phase with a failed fixture, preserving all prior passing fixtures');
  }
  const binding = await json(join(evidence, 'binding-before.json'));
  assert.deepEqual(await inspectCurrent(), binding, 'Before-run source/artifact mismatch');
  const output = join(evidence, 'runs', batch);
  await mkdir(join(evidence, 'runs'), { recursive: true });
  await mkdir(output);
  const outcomes = [];
  try {
    for (const scenario of requested) {
      const info = await runFixture(cli, output, scenario, binding);
      outcomes.push(info);
      if (info.error || info.gatewayForced || (info.origin && !info.portClosed) || info.gatewayExit?.code !== 0 ||
          info.browserClose?.code !== 0 || info.cleanupError ||
          info.result?.startsWith('REPRODUCED_')) break;
    }
  } finally {
    const after = await inspectCurrent();
    assert.deepEqual(after, binding, 'Fixture changed frozen source/build');
    await record(join(output, 'binding-after.json'), after);
    await record(join(output, 'overview.json'), { ...identity, cases: requested, outcomes, administrativelyCleared: [administrativeRecord], panCorrection });
  }
  if (outcomes.length !== requested.length || outcomes.some((row) => row.error || row.failure || row.result?.startsWith('REPRODUCED_') ||
      row.gatewayForced || !row.portClosed || row.gatewayExit?.code !== 0 || row.browserClose?.code !== 0 ||
      row.closedStore?.residue?.length !== 0 || row.cleanupError)) process.exitCode = 2;
}

async function gateway(output, scenario) {
  frozenCheckout();
  const bound = await json(join(evidence, 'binding-before.json'));
  assert.equal(bound.head, identity.head);
  const web = bound.artifacts['apps/web/dist'];
  const api = join(repo, 'apps/api/dist/main.js');
  assert.equal(digest(await readFile(api)), bound.apiEntrySha256);
  const scratch = await mkdtemp(join(output, 'gateway-store-'));
  for (const key of Object.keys(process.env)) {
    if (/^GG_|^(?:JEV_API_KEY|CODEX_HOME|CLAUDE_CONFIG_DIR|OLLAMA_HOST)$/i.test(key)) delete process.env[key];
  }
  Object.assign(process.env, {
    GG_DATA_DIR: scratch, GG_HOST: '127.0.0.1', GG_PORT: '0', GG_REQUIRE_API_KEY: 'false',
    GG_WEB_DIST: join(repo, 'apps/web/dist'), GG_GOBLIN_DIST: '', GG_SWAGGER_UI: 'false',
    GG_OLLAMA_ENABLED: 'false', GG_LOG_LEVEL: 'error',
    GG_CODEX_BINARY: join(scratch, 'missing-codex-provider.exe'),
    GG_CLAUDE_BINARY: join(scratch, 'missing-claude-provider.exe'),
    CODEX_HOME: join(scratch, 'empty-codex-home'),
    CLAUDE_CONFIG_DIR: join(scratch, 'empty-claude-config'),
  });
  const { main } = await import(pathToFileURL(api).href);
  const { app } = await main();
  try {
    const address = app.server.address();
    assert.equal(address.address, '127.0.0.1');
    assert(![4747, 4748].includes(address.port));
    const origin = 'http://127.0.0.1:' + address.port;
    const health = await fetch(origin + '/healthz');
    assert(health.ok);
    assert.equal(health.headers.get('x-graphgoblin-pid'), String(process.pid));
    const served = {};
    const names = ['index.html', ...Object.keys(web).filter((path) => /^assets\/.*\.(js|css)$/.test(path))];
    for (const name of names) {
      const url = origin + '/app/' + (name === 'index.html' ? '' : name);
      const response = await fetch(url);
      assert(response.ok, url);
      const hash = digest(Buffer.from(await response.arrayBuffer()));
      assert.equal(hash, web[name], url);
      served[name] = hash;
    }
    await record(join(output, 'gateway.json'), {
      ...identity, port: address.port, pid: process.pid, origin, scratch, served, apiEntrySha256: bound.apiEntrySha256,
    });
    if (scenario === 'protected-chat') {
      const domain = await import(pathToFileURL(join(repo, 'packages/domain/dist/index.js')).href);
      const definition = domain.enableChatAudio(
        domain.createSystemChatDefinition({ name: 'Gateway chat', harness: 'codex' }),
        { id: 'chat-normalize', kind: 'script', label: 'Fixture audio path', ui: { x: 160, y: -130 },
          config: { command: join(scratch, 'never-execute-audio-fixture'), cwd: 'workspace',
            stdin: 'thread', stdout: 'last-output' } },
      );
      const respond = definition.nodes.find((node) => node.id === 'respond');
      const envelope = definition.nodes.find((node) => node.id === 'chat-envelope');
      assert(respond && envelope && envelope.ui);
      respond.ui = { x: envelope.ui.x, y: envelope.ui.y - 300 };
      const loopList = await fetch(origin + '/loops');
      assert(loopList.ok);
      const chat = (await loopList.json()).items.find((loop) => loop.system?.audience?.kind === 'gateway');
      assert(chat?.id, 'Disposable gateway Chat was not seeded');
      const detail = await fetch(origin + '/loops/' + chat.id);
      assert(detail.ok);
      const previous = await detail.json();
      assert(previous.current && previous.draftToken);
      const response = await fetch(origin + '/loops/' + chat.id + '/draft', {
        method: 'PUT', headers: { 'content-type': 'application/json', 'if-match': '"' + previous.draftToken + '"' },
        body: JSON.stringify({ definition }),
      });
      assert.equal(response.status, 200, await response.clone().text());
      const staged = await response.json();
      await record(join(output, 'chat-public-seed.json'), { loopId: chat.id, previous, staged });
    }

    console.log('GG_QA_READY ' + origin);
    await new Promise((done) => {
      process.stdin.once('data', done);
      process.stdin.once('end', done);
      process.stdin.resume();
    });
  } finally {
    await app.close();
    process.stdin.pause();
    frozenCheckout();
    const residue = (await readdir(scratch)).filter((name) => /(?:\.lock|\.reclaim|-wal|-shm)$/i.test(name));
    await record(join(output, 'gateway-closed.json'), { ...identity, pid: process.pid, listening: app.server.listening, scratch, residue });
    assert(!residue.some((name) => /.(?:lock|reclaim)$/i.test(name)), 'Fixture ownership lock remains');
  }
}

switch (mode) {
  case 'before': await priorReadback(); break;
  case 'admit': await admitted(); break;
  case 'run': await run(resolve(argument), cases[0], cases.slice(1)); break;
  case 'gateway': await confirmPanCorrection(); await gateway(resolve(argument), cases[0]); break;
  case 'settle-closed-store': {
    const output = await realpath(resolve(argument));
    assert(relative(join(evidence, 'runs'), output).split(/[\\/]/).length === 2 &&
      !relative(join(evidence, 'runs'), output).startsWith('..'), 'Expected one fixture output directory');
    const run = await json(join(output, 'run.json'));
    assert(!run.gatewayForced && run.portClosed && await portClosed(Number(new URL(run.origin).port)));
    try {
      process.kill(run.gatewayPid, 0);
      throw new Error('Fixture PID still exists');
    } catch (error) { assert.equal(error.code, 'ESRCH'); }
    await settleClosedStore(output, run.gatewayCleanup);
    break;
  }
  default: throw new Error('Use before, admit, run or gateway');
}


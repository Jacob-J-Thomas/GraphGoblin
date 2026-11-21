import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

// Independent QA driver. This process never imports CodexHarness or the SDK.
const evidence = path.dirname(fileURLToPath(import.meta.url));
const checkout = 'G:/ggq/gg-i4-363-qa/GraphGoblin';
const source = path.join(checkout, 'packages/adapter-codex/src/structured.ts');
const expectedHead = '76beeb0f2e99343697578c2713ac06f80d59e7b5';
const expectedTree = '2544bc2913f9cec0d95a215ea631ab62c7985c1d';
const base = '02351e2fb932b3be44e7cc3fb3943a61d568226c';
const original = { mkdir: fsp.mkdir, rm: fsp.rm, mkdtemp: fsp.mkdtemp, randomBytes: crypto.randomBytes };
const git = (...args) => execFileSync('git', args, { cwd: checkout, windowsHide: true });
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const json = (name, value) => fs.writeFileSync(path.join(evidence, name), JSON.stringify(value, null, 2) + '\n');
const rawFile = path.join(evidence, 'raw/native-run-01.jsonl');
assert.equal(fs.existsSync(rawFile), false, 'Never overwrite a run');
let active;
const trace = (kind, detail = {}) => {
  const record = { at: new Date().toISOString(), case: active?.id ?? null, kind, ...detail };
  fs.appendFileSync(rawFile, JSON.stringify(record) + '\n');
};
const errorData = (error) => ({ name: error?.name, message: error?.message, code: error?.code, syscall: error?.syscall, path: error?.path, stack: error?.stack });
const predictions = [
  ['baseline-226', 'Native base mkdtemp fails ENAMETOOLONG before harness; no scratch remains.'],
  ['candidate-226-native-child', 'Native 226-character TMP reaches one local harness in an empty 249-character scratch; real child Node cwd works; structured value and usage survive; scratch removed.'],
  ['fresh-per-call', 'Two completions use distinct empty exclusive scratch paths and remove both; JSON fallback works.'],
  ['configured-precedence', 'Request directory wins, then option directory; no allocation/cleanup; markers survive; raw text/JSON fallback and execution options preserved.'],
  ['real-collision-then-success', 'Controlled random first name collides with actual directory; native EEXIST; second succeeds; sentinel preserved and only new scratch removed.'],
  ['four-real-collisions', 'Four distinct actual collisions yield four native EEXIST errors, no fifth random name, no harness/cleanup, four markers preserved.'],
  ['native-mkdir-error', 'Missing parent yields native ENOENT after one mkdir attempt, no retry/harness/cleanup.'],
  ['pre-aborted', 'Caller reason identity, no mkdir/mkdtemp/harness/cleanup.'],
  ['allocation-abort-cleanup-ok', 'Abort immediately after actual mkdir preserves reason, no harness; newly owned scratch removed.'],
  ['allocation-abort-cleanup-error', 'Same abort reason wins over injected cleanup failure; known residue manually recovered by QA.'],
  ['sync-harness-error-cleanup-ok', 'Synchronous start failure identity wins; native cleanup removes scratch.'],
  ['sync-harness-error-cleanup-error', 'Synchronous start failure identity wins over injected cleanup failure; known residue recovered.'],
  ['async-result-error-cleanup-ok', 'Asynchronous result failure identity wins; native cleanup removes scratch.'],
  ['async-result-error-cleanup-error', 'Asynchronous result failure identity wins over injected cleanup failure; known residue recovered.'],
  ['success-cleanup-error', 'Successful value survives injected cleanup failure; known residue recovered.'],
  ['cancel-resolve-cleanup-ok', 'Scratch exists until deferred cancel resolves; caller reason wins; one cancel then one native cleanup.'],
  ['cancel-reject-cleanup-ok', 'Scratch exists until deferred cancel rejects; cancel error wins over caller reason; one cancel then one native cleanup.'],
  ['cancel-resolve-cleanup-error', 'Caller reason wins after cancel settles despite cleanup failure; known residue recovered.'],
  ['cancel-reject-cleanup-error', 'Cancel error wins over caller reason and cleanup error; known residue recovered.'],
];
json('predictions.json', { writtenBeforeExecution: true, sourceOfExpectations: 'Issue #363 contract and independently selected public-method outcomes; author report treated as claims.', cases: predictions.map(([id, expected]) => ({ id, expected })) });

const candidateBytes = fs.readFileSync(source);
const baseBytes = git('show', `${base}:packages/adapter-codex/src/structured.ts`);
const baseSource = path.join(evidence, 'sources/base-structured.ts');
fs.writeFileSync(baseSource, baseBytes);
assert.equal(git('rev-parse', 'HEAD').toString().trim(), expectedHead);
assert.equal(git('rev-parse', 'HEAD^{tree}').toString().trim(), expectedTree);
assert.equal(git('rev-list', '--parents', '-n', '1', 'HEAD').toString().trim(), `${expectedHead} ${base}`);
assert.equal(git('status', '--porcelain=v1').toString().trim(), '');
assert.deepEqual(candidateBytes, fs.readFileSync(path.join(evidence, 'sources/candidate-structured.ts')));
const candidateText = candidateBytes.toString().replaceAll('\r\n', '\n');
const baseText = baseBytes.toString().replaceAll('\r\n', '\n');
assert.equal(candidateText.slice(candidateText.indexOf('function parseLoose')), baseText.slice(baseText.indexOf('function parseLoose')));
const options = (text) => text.slice(text.indexOf('export interface CodexStructuredOptions'), text.indexOf('\nasync function freshTempDir'));
assert.equal(options(candidateText), options(baseText));
const cliCandidate = fs.readFileSync(path.join(checkout, 'packages/adapter-codex/src/cli.ts'));
assert.equal(hash(cliCandidate), hash(git('show', `${base}:packages/adapter-codex/src/cli.ts`)));
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'win32');
const sourceBinding = {
  head: expectedHead, tree: expectedTree, soleParent: base,
  branch: git('branch', '--show-current').toString().trim(),
  beforeStatus: git('status', '--porcelain=v1').toString(),
  candidate: { path: source, sha256: hash(candidateBytes), gitBlob: git('rev-parse', 'HEAD:packages/adapter-codex/src/structured.ts').toString().trim() },
  base: { path: baseSource, sha256: hash(baseBytes), gitBlob: git('rev-parse', `${base}:packages/adapter-codex/src/structured.ts`).toString().trim(), provenance: 'Raw bytes captured with git show before execution; baseline copy imported, not a production edit.' },
  unchanged: { optionsInterface: true, parseLooseCompleteAndExportTail: true, cliTsSha256: hash(cliCandidate) },
  fixture: { path: fileURLToPath(import.meta.url), sha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))) },
  diffNameStatus: git('diff', '--name-status', base, expectedHead).toString(),
  lockSha256: hash(fs.readFileSync(path.join(checkout, 'pnpm-lock.yaml'))),
};
json('source-binding.json', sourceBinding);
fs.writeFileSync(path.join(evidence, 'raw/candidate.patch'), git('diff', '--binary', base, expectedHead));
json('run-input.json', { at: new Date().toISOString(), process: { version: process.version, platform: process.platform, arch: process.arch, execPath: process.execPath, argv: process.argv, cwd: process.cwd() }, sourceBinding, predictionsSha256: hash(fs.readFileSync(path.join(evidence, 'predictions.json'))) });
const { CodexStructured: Candidate } = await import(pathToFileURL(source).href);
const { CodexStructured: Baseline } = await import(pathToFileURL(baseSource).href);
const ownerParent = path.join(evidence, 'fixture-owned');
await original.mkdir(ownerParent);
const owner = path.join(ownerParent, `run-${original.randomBytes(5).toString('hex')}`);
await original.mkdir(owner);
const contained = (target) => {
  const absolute = path.resolve(String(target));
  const relative = path.relative(owner, absolute);
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `Unsafe fixture target ${absolute}`);
  return absolute;
};
const controlledCleanupFailure = new Error('Independent QA synthetic cleanup refusal');
const observations = { startedAt: new Date().toISOString(), sourceBinding, native: { version: process.version, platform: process.platform, execPath: process.execPath }, owner, cases: [], final: null };
const req = { prompt: 'Independent local structured QA', schema: { type: 'object', properties: { accepted: { type: 'boolean' } } } };
const savedEnv = Object.fromEntries(['TEMP', 'TMP', 'TMPDIR'].map((name) => [name, process.env[name]]));
function useTempRoot(root) {
  for (const name of ['TEMP', 'TMP', 'TMPDIR']) process.env[name] = root;
  assert.equal(os.tmpdir(), root);
  trace('temp-root-selected', { root, length: root.length });
}
function restore() {
  Object.assign(fsp, { mkdir: original.mkdir, rm: original.rm, mkdtemp: original.mkdtemp });
  crypto.randomBytes = original.randomBytes;
  syncBuiltinESMExports();
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
}
function hooks({ names, afterCreate, cleanupFailure = false } = {}) {
  let randomIndex = 0;
  if (names) crypto.randomBytes = (size) => {
    assert.equal(size, 4);
    assert(randomIndex < names.length, 'Unexpected additional random-name attempt');
    const hex = names[randomIndex++];
    active.randomNames.push(hex);
    trace('controlled-random-name', { hex, source: 'QA naming control only' });
    return Buffer.from(hex, 'hex');
  };
  fsp.mkdir = async (target, options) => {
    const absolute = contained(target);
    active.mkdirCalls.push({ path: absolute, options });
    trace('mkdir-attempt', { path: absolute, length: absolute.length, options });
    try {
      const result = await original.mkdir(target, options);
      active.created.push(absolute);
      trace('native-mkdir-success', { path: absolute });
      await afterCreate?.(absolute);
      return result;
    } catch (error) {
      active.mkdirErrors.push(errorData(error));
      trace('native-mkdir-error', { error: errorData(error) });
      throw error;
    }
  };
  fsp.mkdtemp = async (prefix, options) => {
    contained(prefix);
    active.mkdtempCalls.push({ prefix: String(prefix) });
    trace('mkdtemp-attempt', { prefix: String(prefix), prefixLength: String(prefix).length });
    try {
      const result = await original.mkdtemp(prefix, options);
      active.created.push(contained(result));
      return result;
    } catch (error) {
      trace('native-mkdtemp-error', { error: errorData(error) });
      throw error;
    }
  };
  fsp.rm = async (target, options) => {
    const absolute = contained(target);
    assert(active.created.includes(absolute), 'Allocator cannot clean a path it did not create');
    active.rmCalls.push({ path: absolute, options });
    active.order.push('cleanup');
    trace('allocator-cleanup', { path: absolute, options, syntheticFailure: cleanupFailure });
    if (cleanupFailure) throw controlledCleanupFailure;
    await original.rm(target, options);
    trace('native-cleanup-complete', { path: absolute, remains: fs.existsSync(absolute) });
  };
  syncBuiltinESMExports();
}
function harness({ result = { finalText: '{"accepted":true}' }, startError, resultError, onStart, cancel, hanging = false } = {}) {
  return {
    id: 'codex',
    preflight() { throw new Error('No provider/preflight permitted'); },
    resume() { throw new Error('No resume permitted'); },
    start(request, signal) {
      const directory = request.workingDirectory;
      active.harnessStarts.push({ request, signalAborted: signal.aborted, exists: fs.existsSync(directory), entries: fs.readdirSync(directory) });
      trace('local-harness-start', active.harnessStarts.at(-1));
      onStart?.(request, signal);
      if (startError) throw startError;
      return {
        sessionId: Promise.resolve('independent-local-harness'),
        events: hanging ? { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) } : { async *[Symbol.asyncIterator]() {} },
        result: hanging ? new Promise(() => {}) : resultError ? Promise.reject(resultError) : Promise.resolve(result),
        cancel: async () => {
          active.cancelCalls += 1;
          active.order.push('cancel called');
          trace('local-harness-cancel-called');
          await cancel?.();
        },
      };
    },
  };
}
async function rejected(promise, expected) {
  try { await promise; assert.fail('Expected rejection'); }
  catch (error) {
    if (expected instanceof Error) assert.equal(error, expected, 'Primary error identity');
    else assert.equal(error.code, expected);
    active.observedRejection = errorData(error);
    trace('expected-rejection', { error: errorData(error) });
  }
}
function noProvider() { assert.equal(active.harnessStarts.length, 0); }
function assertNewScratchRemoved() {
  assert(active.created.length > 0);
  for (const created of active.created) assert.equal(fs.existsSync(created), false, `Unexpected scratch leak ${created}`);
}
async function expectSyntheticResidue() {
  assert.equal(active.rmCalls.length, 1);
  assert.equal(active.created.length, 1);
  const scratch = contained(active.created[0]);
  assert.equal(fs.existsSync(scratch), true);
  assert.deepEqual(await fsp.readdir(scratch), []);
  active.expectedSyntheticResidue = scratch;
  trace('expected-synthetic-residue', { path: scratch, source: 'Injected cleanup refusal, not an allocator leak on successful native cleanup' });
}
async function one(id, tier, body) {
  active = { id, tier, status: 'RUNNING', expected: predictions.find(([name]) => name === id)?.[1], mkdirCalls: [], mkdirErrors: [], mkdtempCalls: [], rmCalls: [], created: [], harnessStarts: [], randomNames: [], cancelCalls: 0, order: [] };
  const root = path.join(owner, id);
  await original.mkdir(root);
  contained(root);
  active.root = root;
  useTempRoot(root);
  trace('case-start', { tier, expected: active.expected });
  try {
    await body(root);
    active.status = 'PASS';
  } catch (error) {
    active.status = 'FAIL';
    active.failure = errorData(error);
    trace('case-failure', { error: errorData(error) });
  } finally {
    restore();
    active.residueBeforeQaRecovery = active.created.filter((target) => fs.existsSync(target));
    if (active.status === 'PASS' && active.expectedSyntheticResidue) assert.deepEqual(active.residueBeforeQaRecovery, [active.expectedSyntheticResidue]);
    if (active.status === 'PASS' && !active.expectedSyntheticResidue) assert.deepEqual(active.residueBeforeQaRecovery, []);
    for (const target of active.residueBeforeQaRecovery) {
      const checked = contained(target);
      trace('qa-owned-residue-recovery-before', { target: checked, checkedWithin: owner });
      await original.rm(checked, { recursive: true, force: true });
      trace('qa-owned-residue-recovery-after', { target: checked, exists: fs.existsSync(checked) });
    }
    active.residueAfterQaRecovery = active.created.filter((target) => fs.existsSync(target));
    trace('case-finish', { status: active.status, residueBeforeQaRecovery: active.residueBeforeQaRecovery, residueAfterQaRecovery: active.residueAfterQaRecovery });
    observations.cases.push(active);
    json('observations.partial.json', observations);
    console.log(`${active.status} ${id}`);
    active = undefined;
  }
}
async function longRoot(root) {
  let target = root;
  assert(target.length < 225);
  while (target.length < 190) target = path.join(target, 'long-root-segment');
  target = path.join(target, 'x'.repeat(226 - target.length - 1));
  assert.equal(target.length, 226);
  contained(target);
  await original.mkdir(target, { recursive: true });
  useTempRoot(target);
  return target;
}

try {
  await one('baseline-226', 'Native Windows FS + unmodified base-source copy + local HarnessPort', async (root) => {
    const long = await longRoot(root);
    hooks();
    await rejected(new Baseline(harness()).complete(req, new AbortController().signal), 'ENAMETOOLONG');
    noProvider();
    assert.equal(active.mkdtempCalls.length, 1);
    assert.equal(active.mkdirCalls.length, 0);
    assert.equal(active.rmCalls.length, 0);
    assert.deepEqual(await fsp.readdir(long), []);
  });
  await one('candidate-226-native-child', 'Native Windows FS and actual Node child process + local HarnessPort; uncontrolled cryptographic name', async (root) => {
    const long = await longRoot(root);
    hooks();
    const local = harness({ result: { finalText: '{"ignored":true}', structured: { accepted: true, tier: 'local' }, usage: { inputTokens: 3, outputTokens: 2 } }, onStart(request) {
      const scratch = request.workingDirectory;
      assert.equal(path.dirname(scratch), long);
      assert.equal(scratch.length, 249);
      assert.match(path.basename(scratch), /^gg-structured-[a-f0-9]{8}$/);
      assert.deepEqual(fs.readdirSync(scratch), []);
      const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify({cwd:process.cwd(),version:process.version,platform:process.platform}))'], { cwd: scratch, encoding: 'utf8', timeout: 10000, windowsHide: true });
      active.nativeChild = { status: child.status, signal: child.signal, stdout: child.stdout, stderr: child.stderr, error: child.error && errorData(child.error) };
      trace('native-child-result', active.nativeChild);
      assert.equal(child.error, undefined);
      assert.equal(child.status, 0);
      assert.deepEqual(JSON.parse(child.stdout), { cwd: scratch, version: 'v22.23.4', platform: 'win32' });
    } });
    const result = await new Candidate(local).complete(req, new AbortController().signal);
    assert.deepEqual(result, { value: { accepted: true, tier: 'local' }, usage: { inputTokens: 3, outputTokens: 2 } });
    assert.equal(active.harnessStarts.length, 1);
    assert.equal(active.mkdirCalls.length, 1);
    assert.deepEqual(active.mkdirCalls[0].options, { mode: 0o700 });
    assert.deepEqual(active.rmCalls[0], { path: active.created[0], options: { recursive: true, force: true } });
    assertNewScratchRemoved();
    assert.deepEqual(await fsp.readdir(long), []);
  });
  await one('fresh-per-call', 'Native Windows FS + local HarnessPort; uncontrolled cryptographic names', async (root) => {
    hooks();
    const adapter = new Candidate(harness({ result: { finalText: '[1,"two"]' } }));
    for (let i = 0; i < 2; i++) assert.deepEqual((await adapter.complete(req, new AbortController().signal)).value, [1, 'two']);
    assert.equal(new Set(active.created).size, 2);
    assert.equal(active.harnessStarts.length, 2);
    assert(active.harnessStarts.every((start) => start.entries.length === 0));
    assert.equal(active.rmCalls.length, 2);
    assertNewScratchRemoved();
    assert.deepEqual(await fsp.readdir(root), []);
  });
  await one('configured-precedence', 'Native caller-owned fixture directories + local HarnessPort', async (root) => {
    const requested = path.join(root, 'request');
    const configured = path.join(root, 'option');
    for (const target of [requested, configured]) {
      await original.mkdir(target);
      await fsp.writeFile(path.join(target, 'marker.txt'), `preserve ${path.basename(target)}`);
    }
    hooks();
    let suppliedTempCalls = 0;
    const adapter = new Candidate(harness({ result: { finalText: 'independent raw reply' } }), { workingDirectory: configured, tempDir: async () => { suppliedTempCalls++; throw new Error('Must never allocate for configured cwd'); } });
    assert.equal((await adapter.complete({ ...req, workingDirectory: requested, model: 'local-model-identifier', effort: 'low' }, new AbortController().signal)).value, 'independent raw reply');
    assert.equal((await adapter.complete(req, new AbortController().signal)).value, 'independent raw reply');
    assert.deepEqual(active.harnessStarts.map((start) => start.request.workingDirectory), [requested, configured]);
    assert.deepEqual(active.harnessStarts[0].request.options, { sandbox: 'read-only', approval: 'never', networkAccess: false, webSearch: false });
    assert.equal(active.harnessStarts[0].request.model, 'local-model-identifier');
    assert.equal(active.harnessStarts[0].request.effort, 'low');
    assert.deepEqual(active.harnessStarts[0].request.turn, { prompt: req.prompt, outputSchema: req.schema });
    assert.equal(suppliedTempCalls, 0);
    assert.equal(active.mkdirCalls.length, 0);
    assert.equal(active.rmCalls.length, 0);
    for (const target of [requested, configured]) assert.equal(await fsp.readFile(path.join(target, 'marker.txt'), 'utf8'), `preserve ${path.basename(target)}`);
    active.preservedCallerDirectories = [requested, configured];
  });
  for (const count of [1, 4]) await one(count === 1 ? 'real-collision-then-success' : 'four-real-collisions', 'Controlled random-name selection; actual native mkdir EEXIST + native sentinel preservation + local HarnessPort', async (root) => {
    const names = ['c0111de1', 'c0111de2', 'c0111de3', 'c0111de4'];
    const existing = [];
    for (const name of names.slice(0, count)) {
      const directory = path.join(root, `gg-structured-${name}`);
      await original.mkdir(directory);
      await fsp.writeFile(path.join(directory, 'marker.txt'), `owned before adapter ${name}`);
      existing.push(directory);
    }
    hooks({ names: count === 1 ? [names[0], 'a110ca7e'] : names });
    const completion = new Candidate(harness()).complete(req, new AbortController().signal);
    if (count === 4) { await rejected(completion, 'EEXIST'); noProvider(); assert.equal(active.rmCalls.length, 0); }
    else { assert.deepEqual((await completion).value, { accepted: true }); assert.equal(active.harnessStarts.length, 1); assert.equal(active.rmCalls.length, 1); assertNewScratchRemoved(); }
    assert.equal(active.mkdirCalls.length, count === 4 ? 4 : 2);
    assert.equal(active.randomNames.length, count === 4 ? 4 : 2);
    assert.equal(active.mkdirErrors.length, count);
    assert(active.mkdirErrors.every((error) => error.code === 'EEXIST' && error.syscall === 'mkdir'));
    for (let i = 0; i < existing.length; i++) {
      assert.equal(await fsp.readFile(path.join(existing[i], 'marker.txt'), 'utf8'), `owned before adapter ${names[i]}`);
      assert.equal(active.rmCalls.some((call) => call.path === existing[i]), false);
    }
    active.collisionMarkersVerifiedBeforeFixtureTeardown = existing;
    trace('collision-markers-preserved', { directories: existing, rootEntries: await fsp.readdir(root) });
  });
  await one('native-mkdir-error', 'Native Windows missing-parent ENOENT, no fabricated errno', async (root) => {
    const absent = path.join(root, 'missing-parent');
    assert.equal(fs.existsSync(absent), false);
    useTempRoot(absent);
    hooks();
    await rejected(new Candidate(harness()).complete(req, new AbortController().signal), 'ENOENT');
    assert.equal(active.mkdirCalls.length, 1);
    assert.equal(active.mkdirErrors.length, 1);
    assert.equal(active.created.length, 0);
    assert.equal(active.rmCalls.length, 0);
    noProvider();
    assert.deepEqual(await fsp.readdir(root), []);
  });
  await one('pre-aborted', 'Public method + native allocation instrumentation', async () => {
    hooks();
    const controller = new AbortController();
    const reason = new Error('Independent caller aborted before allocation');
    controller.abort(reason);
    await rejected(new Candidate(harness()).complete(req, controller.signal), reason);
    assert.equal(active.mkdirCalls.length, 0);
    assert.equal(active.mkdtempCalls.length, 0);
    assert.equal(active.rmCalls.length, 0);
    noProvider();
  });
  for (const cleanupFailure of [false, true]) await one(`allocation-abort-cleanup-${cleanupFailure ? 'error' : 'ok'}`, 'Native exclusive mkdir; controlled post-allocation abort' + (cleanupFailure ? ' and cleanup rejection' : ''), async () => {
    const controller = new AbortController();
    const reason = new Error('Independent caller abort after native allocation');
    hooks({ cleanupFailure, afterCreate() { controller.abort(reason); } });
    await rejected(new Candidate(harness()).complete(req, controller.signal), reason);
    noProvider();
    assert.equal(active.mkdirCalls.length, 1);
    assert.equal(active.rmCalls.length, 1);
    if (cleanupFailure) await expectSyntheticResidue(); else assertNewScratchRemoved();
  });
  for (const mode of ['sync-harness', 'async-result']) for (const cleanupFailure of [false, true]) await one(`${mode}-error-cleanup-${cleanupFailure ? 'error' : 'ok'}`, 'Native exclusive mkdir; controlled local harness failure' + (cleanupFailure ? ' and cleanup rejection' : ''), async () => {
    const failure = Object.assign(new Error(`Independent ${mode} failure`), { code: 'QA_LOCAL_HARNESS_FAILURE' });
    hooks({ cleanupFailure });
    await rejected(new Candidate(harness(mode === 'sync-harness' ? { startError: failure } : { resultError: failure })).complete(req, new AbortController().signal), failure);
    assert.equal(active.harnessStarts.length, 1);
    assert.equal(active.mkdirCalls.length, 1);
    assert.equal(active.rmCalls.length, 1);
    if (cleanupFailure) await expectSyntheticResidue(); else assertNewScratchRemoved();
  });
  await one('success-cleanup-error', 'Native exclusive mkdir; controlled local harness success and cleanup rejection', async () => {
    hooks({ cleanupFailure: true });
    assert.deepEqual((await new Candidate(harness()).complete(req, new AbortController().signal)).value, { accepted: true });
    await expectSyntheticResidue();
  });
  for (const cancelFailure of [false, true]) for (const cleanupFailure of [false, true]) await one(`cancel-${cancelFailure ? 'reject' : 'resolve'}-cleanup-${cleanupFailure ? 'error' : 'ok'}`, 'Native exclusive mkdir; controlled local hanging session, deferred cancel settlement' + (cleanupFailure ? ' and cleanup rejection' : ''), async () => {
    let resolveStart;
    const started = new Promise((resolve) => { resolveStart = resolve; });
    let settleCancel;
    const pendingCancel = new Promise((resolve, reject) => { settleCancel = () => cancelFailure ? reject(cancelError) : resolve(); });
    const reason = new Error('Independent caller abort during harness');
    const cancelError = new Error('Independent harness cancel failure');
    const controller = new AbortController();
    hooks({ cleanupFailure });
    const local = harness({ hanging: true, onStart() { resolveStart(); }, async cancel() { try { await pendingCancel; } finally { active.order.push('cancel settled'); trace('local-cancel-settled', { rejects: cancelFailure }); } } });
    let outcomeSettled = false;
    const outcome = new Candidate(local).complete(req, controller.signal).then((value) => { outcomeSettled = true; return { kind: 'resolved', value }; }, (error) => { outcomeSettled = true; return { kind: 'rejected', error }; });
    try {
      await started;
      controller.abort(reason);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(outcomeSettled, false);
      assert.equal(active.cancelCalls, 1);
      assert.equal(active.rmCalls.length, 0);
      assert.equal(fs.existsSync(active.created[0]), true);
      trace('cancellation-pending-scratch-retained', { path: active.created[0], exists: true, cleanupCalls: 0 });
      settleCancel();
      const observed = await outcome;
      assert.equal(observed.kind, 'rejected');
      assert.equal(observed.error, cancelFailure ? cancelError : reason);
      active.observedRejection = errorData(observed.error);
      assert.equal(active.cancelCalls, 1);
      assert.deepEqual(active.order, ['cancel called', 'cancel settled', 'cleanup']);
      if (cleanupFailure) await expectSyntheticResidue(); else assertNewScratchRemoved();
    } finally { settleCancel(); await outcome; }
  });
} finally {
  restore();
  assert.deepEqual(fs.readFileSync(source), candidateBytes, 'Candidate remains immutable');
  assert.equal(git('rev-parse', 'HEAD').toString().trim(), expectedHead);
  assert.equal(git('rev-parse', 'HEAD^{tree}').toString().trim(), expectedTree);
  assert.equal(git('status', '--porcelain=v1').toString().trim(), '');
  const relative = path.relative(ownerParent, owner);
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && /^run-[a-f0-9]{10}$/.test(relative));
  trace('qa-fixture-owner-teardown-before', { owner, checkedWithin: ownerParent, entries: await fsp.readdir(owner) });
  await original.rm(owner, { recursive: true, force: true });
  trace('qa-fixture-owner-teardown-after', { owner, exists: fs.existsSync(owner) });
  observations.final = { completedAt: new Date().toISOString(), pass: observations.cases.filter((item) => item.status === 'PASS').length, fail: observations.cases.filter((item) => item.status === 'FAIL').length, predicted: predictions.length, executed: observations.cases.length, fixtureOwnerRemoved: !fs.existsSync(owner), sourceUnchanged: hash(fs.readFileSync(source)) === hash(candidateBytes), gitClean: git('status', '--porcelain=v1').toString() === '', lockSha256: hash(fs.readFileSync(path.join(checkout, 'pnpm-lock.yaml'))), limitations: ['No real Codex CLI/provider turn; local HarnessPort only.', 'Baseline loaded from exact Git base bytes as controlled copy.', 'Collision naming deterministic, EEXIST native.', 'Abort/cancel/failure scheduling controlled in this isolated process.', 'Injected cleanup failures intentionally leave known scratch until QA recovery.', 'No arbitrary/unlimited long-path support claim.', 'No full build, numerical coverage, browser, external reviewer, CI or final Astra gate.'] };
  json('observations.json', observations);
  console.log(JSON.stringify(observations.final));
  process.exitCode = observations.final.fail > 0 || observations.final.executed !== predictions.length ? 1 : 0;
}

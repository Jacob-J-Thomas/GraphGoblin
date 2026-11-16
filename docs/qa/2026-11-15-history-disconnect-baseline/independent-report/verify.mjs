import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync, lstatSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const reportDir = dirname(fileURLToPath(import.meta.url));
const batch = dirname(reportDir);
const [suffix = 'first', ...extra] = process.argv.slice(2);
assert.equal(extra.length, 0);
assert.match(suffix, /^[a-z0-9-]{3,48}$/);
const evidenceName = 'evidence-baseline-' + suffix;
const native = join(batch, 'runtime-419-native-preparation');
const execution = join(batch, 'runtime-419-execution-preparation');
const evidence = join(native, evidenceName);
const supervisor = join(batch, 'runtime-419-launch-execution-baseline-' + suffix);
const head = '98692c8a8c7b519e8c83e585e026d595cedc0550';
const tree = '9439a500040aa4763613549cca6235023916de58';
const merged381 = '154401c7b47c1e56b62a6daec50e2a3145ea967d';
const reviewed410 = '0d1b935988c4ff06f5091b645210b0cd88703a16';
const nodeSha = 'dccc52de28d8df2ee22d2062424f8c563070d95d8ad70c54c4bf01d590dec14f';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (file) => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const entries = {};
function inventory(file, expected) {
  const path = relative(batch, file).startsWith('..') ? file : relative(batch, file).replaceAll('\\', '/');
  const bytes = readFileSync(file);
  const actual = sha(bytes);
  if (expected) assert.equal(actual, expected, file);
  entries[path] = { sha256: actual, size: bytes.length };
  return actual;
}
function manifest(dir, expected, count) {
  const file = join(dir, 'SHA256SUMS.txt');
  inventory(file, expected);
  const lines = readFileSync(file, 'utf8').trim().split(/\r?\n/);
  assert.equal(lines.length, count);
  for (const line of lines) {
    const [, digest, filename] = /^([a-f0-9]{64})  ([\w.-]+)$/.exec(line) ?? [];
    assert.ok(filename, line);
    inventory(join(dir, filename), digest);
  }
}
manifest(native, 'd3f2254c321dc3f495d9e7374646151ff5a69a082b15af377ecc788db978a8d9', 4);
manifest(execution, '71491680388289a201bd656f15ce999cab5bbe15493292c03112e1ddc1e66a57', 10);
for (const file of ['runtime-419-post410-preflight.md', 'runtime-acceptance-map.md'])
  inventory(join(batch, file));
const preflight = json(join(supervisor, 'preflight.json'));
const result = json(join(supervisor, 'launch-result.json'));
const attempt = json(join(supervisor, 'launch-attempt.json'));
const launch = json(join(supervisor, 'launch.json'));
const exit = json(join(supervisor, 'child-exit.json'));
const close = json(join(supervisor, 'child-close.json'));
const launchAdmission = json(preflight.admissionPath);
const binding = json(preflight.bindingPath);
const build = json(binding.buildProof.buildReceipt.path);
const buildExit = json(build.exit.path);
const buildLaunch = json(build.launch.path);
const summary = json(join(evidence, 'summary.json'));
const runner = json(join(evidence, 'runner.json'));
for (const file of ['preflight.json', 'launch-result.json', 'launch-attempt.json', 'launch.json'])
  inventory(join(supervisor, file));
for (const [file, hash] of Object.entries({
  'child-exit.json': result.childExitSha256,
  'child-close.json': result.childCloseSha256,
  'stdout.log': result.stdoutSha256,
  'stderr.log': result.stderrSha256,
})) {
  assert.match(hash, /^[a-f0-9]{64}$/);
  inventory(join(supervisor, file), hash);
}
for (const file of ['runner.json', 'summary.json']) {
  const hash = result.evidenceSha256[file];
  assert.match(hash, /^[a-f0-9]{64}$/);
  inventory(join(evidence, file), hash);
}
inventory(preflight.admissionPath, preflight.admissionSha256);
inventory(preflight.bindingPath, launchAdmission.buildBinding.sha256);
inventory(join(execution, 'launch.ps1'), launchAdmission.launcherSha256);
for (const ref of [binding.buildProof.buildReceipt, build.launch, build.exit, build.log]) inventory(ref.path, ref.sha256);
inventory(build.admissionPath, build.admissionSha256);
for (const [file, digest] of Object.entries(build.tooling)) inventory(join(batch, file), digest);
inventory(launch.executable, nodeSha);
const buildAdmission = json(build.admissionPath);
const checkout = binding.checkout;
for (const [label, r] of Object.entries({
  buildAdmission, launchAdmission, binding, before: build.before, after: build.after,
  preflight: preflight.build, closing: result.closingBuild,
})) {
  assert.deepEqual([r.head, r.tree, r.actualMain, r.actualMainTree], [head, tree, head, tree], label);
}
assert.equal(launchAdmission.state, 'root-admitted');
assert.equal(buildAdmission.state, 'root-admitted-build');
assert.equal(launchAdmission.stopExactSupervisorOnDeadline, false);
assert.equal(launchAdmission.evidenceName, evidenceName);
assert.equal(launchAdmission.receiptDirectory, supervisor);
assert.equal(launchAdmission.baselineEvidence, null);
assert.deepEqual(build.rawExit, buildExit);
assert.equal(buildExit.pid, buildLaunch.pid);
assert.equal(buildExit.exitCode, 0);
assert.equal(buildExit.signal, null);
assert.equal(build.command, 'pnpm.cmd build --force');
assert.equal(build.cleanAfter, true);
assert.equal(build.before.clean, true);
assert.deepEqual(build.before, build.after);
assert.equal(build.admissionSha256, binding.input.admissionSha256);
assert.equal(binding.buildProof.exitCode, 0);
assert.equal(build.nodeSha256, nodeSha);
assert.equal(binding.nodeSha256, nodeSha);
assert.equal(binding.nodeVersion, 'v22.23.4');
assert.equal(binding.artifactInventorySha256, build.artifacts.inventorySha256);
for (const r of [buildAdmission, build, launchAdmission, binding.input])
  assert.deepEqual([r.merged381, r.merged410, r.phase], [merged381, head, 'baseline']);
assert.deepEqual(preflight.build, result.closingBuild);
assert.deepEqual(preflight.harness, result.closingHarness);
assert.equal(preflight.bindingPath, launchAdmission.buildBinding.path);
assert.equal(preflight.launcherSha256, launchAdmission.launcherSha256);
assert.equal(result.phase, 'baseline');
assert.equal(result.wrapperStatus, 'matrix-finished-for-review');
assert.deepEqual(result.childExit, exit);
assert.equal(result.evidence, evidence);
assert.equal(result.harnessResult, 'assertions-met');
for (const file of ['preflight-error.json', 'supervision-error.json', 'supervisor-deadline.json', 'closing-error.json'])
  assert.equal(existsSync(join(supervisor, file)), false, file);
assert.equal(exit.schema, 'gg419-native-child-exit/v1');
assert.equal(close.schema, 'gg419-native-child-close/v1');
assert.equal(exit.deadlineExpired, false);
assert.equal(exit.creationError, null);
assert.equal(launch.creationError, null);
assert.equal(exit.creationUtc, launch.creationUtc);
assert.ok(Date.parse(launch.creationUtc) < Date.parse(exit.exitTimeUtc));
assert.ok(Date.parse(exit.exitTimeUtc) <= Date.parse(close.closedAtUtc));
assert.equal(exit.exitCode, 0);
assert.equal(close.exitCode, 0);
assert.ok(Number.isInteger(exit.pid) && exit.pid > 0);
for (const receipt of [launch, close, runner.runner, summary.runner]) assert.equal(receipt.pid, exit.pid);
assert.equal(launch.executable, binding.nodePath);
assert.equal(summary.runner.exe, launch.executable);
assert.equal(summary.runner.node, binding.nodeVersion);
assert.deepEqual(launch.arguments, ['--expose-gc', join(native, 'run.mjs'), 'baseline', checkout, evidenceName]);
assert.deepEqual(attempt.arguments, launch.arguments);
assert.deepEqual(attempt.environmentKeys, ['SystemRoot', 'TEMP', 'TMP', 'WINDIR']);
assert.equal(attempt.executable, launch.executable);
assert.equal(attempt.evidence, evidence);
assert.equal(launch.evidence, evidence);
assert.equal(launch.nodeOptionsPresent, false);
assert.equal(close.stdoutBytes, readFileSync(join(supervisor, 'stdout.log')).length);
assert.equal(close.stderrBytes, readFileSync(join(supervisor, 'stderr.log')).length);
assert.equal(close.stdoutBytes, 0);
assert.equal(close.stderrBytes, 0);
for (const r of [runner, summary]) {
  assert.equal(r.checkout, checkout);
  assert.equal(r.evidenceDir, evidence);
  assert.equal(r.phase, 'baseline');
}
assert.equal(summary.result, 'assertions-met');
assert.equal(summary.error, undefined);

const git = (...args) => execFileSync('git.exe', ['-C', checkout, ...args], {
  encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, maxBuffer: 32 * 1024 * 1024,
});
assert.equal(git('rev-parse', 'HEAD', 'HEAD^{tree}', 'refs/remotes/origin/main').trim(), [head, tree, head].join('\n'));
assert.equal(git('show', '-s', '--format=%P', head).trim(), [merged381, reviewed410].join(' '));
assert.equal(git('rev-parse', reviewed410 + '^{tree}').trim(), tree);
assert.equal(git('status', '--porcelain=v1', '--untracked-files=all', '--no-ahead-behind').trim(), '');
const index = git('rev-parse', '--path-format=absolute', '--git-path', 'index').trim().replaceAll('/', '\\');
assert.equal(index, preflight.build.indexPath);
inventory(index, binding.indexSha256);
assert.equal(binding.indexSha256, buildAdmission.indexSha256);
assert.equal(binding.indexSha256, preflight.build.indexSha256);

function pathsGroupedByHash(files, expectedSize) {
  assert.equal(Object.keys(files).length, expectedSize);
  for (const [path, digest] of Object.entries(files)) {
    const absolute = join(checkout, path);
    assert.equal(relative(checkout, absolute).replaceAll('\\', '/'), path);
    assert.ok(lstatSync(absolute).isFile(), path);
    assert.equal(sha(readFileSync(absolute)), digest, path);
  }
}
const sourceSample = new Set([
  'apps/api/src/index.ts', 'apps/api/src/container.ts', 'apps/api/src/run-history.ts',
  'apps/api/src/routes/runs.ts', 'apps/api/src/routes/system.ts',
  'apps/api/src/plugins/auth.ts', 'apps/api/src/plugins/errors.ts',
  'packages/engine/src/run-manager.ts', 'packages/engine/src/errors.ts',
  'packages/contracts/src/thread.ts', 'packages/infrastructure/src/sqlite/runs.ts',
  'packages/infrastructure/src/sqlite/run-decoding.ts', 'packages/infrastructure/src/sqlite/events.ts',
  'apps/api/package.json', 'packages/contracts/package.json', 'packages/domain/package.json',
  'packages/engine/package.json', 'packages/infrastructure/package.json', 'pnpm-lock.yaml',
]);
const headFiles = git('ls-tree', '-r', '-z', head).split('\0').filter(Boolean).map((line) => {
  const [, blob, name] = /^100(?:644|755) blob ([a-f0-9]{40})\t([\s\S]+)$/.exec(line) ?? [];
  assert.ok(name, line);
  if (sourceSample.has(name)) {
    const file = join(checkout, name);
    const bytes = readFileSync(file);
    const calculated = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
    assert.equal(calculated, blob, name);
    inventory(file, binding.sourceFiles[name]);
  }
  return name;
});
const tracked = git('ls-files', '-z').split('\0').filter(Boolean);
assert.deepEqual(tracked.sort(), headFiles.sort());
assert.deepEqual(Object.keys(binding.sourceFiles).sort(), headFiles);
assert.equal(headFiles.length, preflight.build.sourceFiles);
for (const path of sourceSample) assert.ok(headFiles.includes(path), path);
const outputPaths = [];
function collectOutput(basePath) {
  for (const entry of readdirSync(join(checkout, basePath), { withFileTypes: true })) {
    const path = basePath + '/' + entry.name;
    if (entry.isDirectory()) collectOutput(path);
    else {
      assert.ok(entry.isFile(), path);
      outputPaths.push(path);
    }
  }
}
assert.equal(binding.outputRoots.length, 13);
assert.deepEqual(preflight.build.outputRoots, binding.outputRoots);
for (const root of binding.outputRoots) collectOutput(root);
assert.deepEqual(outputPaths.sort(), Object.keys(binding.outputFiles).sort());
assert.equal(outputPaths.length, build.artifacts.outputFiles);
pathsGroupedByHash(binding.dependencyFiles, build.artifacts.dependencyFiles);
assert.equal(Object.keys(binding.workspaceLinks).length, build.artifacts.workspaceLinks);
for (const [path, target] of Object.entries(binding.workspaceLinks)) {
  assert.ok(lstatSync(join(checkout, path)).isSymbolicLink(), path);
  assert.equal(realpathSync(join(checkout, path)), join(checkout, target), path);
}
const loaded = ['api', 'routes', 'history', 'auth', 'errors', 'system', 'contracts', 'domain', 'testing', 'fastify', 'zodProvider'];
assert.deepEqual(Object.keys(summary.bindings).sort(), loaded.sort());
assert.deepEqual(runner.bindings, summary.bindings);
for (const [name, { file, sha256 }] of Object.entries(summary.bindings)) {
  const map = ['fastify', 'zodProvider'].includes(name) ? binding.dependencyFiles : binding.outputFiles;
  assert.equal(map[relative(checkout, file).replaceAll('\\', '/')], sha256, name);
  inventory(file, sha256);
}

function step(c, event, section = {}) {
  const found = c.trace.filter((item) => item.event === event &&
    Object.entries(section).every(([field, value]) => item[field] === value));
  assert.equal(found.length, 1, c.requestId + ' ' + event + ' ' + JSON.stringify(section));
  return found[0];
}
function traceChecks(c) {
  assert.deepEqual(c.trace.map(({ step }) => step), c.trace.map((_, i) => i + 1));
  const handlers = c.trace.filter((item) => item.event === 'handler-entry');
  if (handlers.length) {
    const start = step(c, 'handler-entry');
    const product = step(c, 'product-handler-entry');
    const end = step(c, 'handler-settled');
    assert.ok(start.step < product.step && product.step < end.step);
    const snapshots = c.listenerSnapshots;
    assert.equal(snapshots[0].at, 'handler-entry');
    assert.equal(snapshots.at(-1).at, 'handler-settled');
    const watched = ['request:close', 'request:aborted', 'request:end', 'request:error',
      'response:close', 'response:finish', 'response:error', 'socket:close', 'socket:error'];
    for (const snapshot of [snapshots[0], snapshots.at(-1)]) {
      assert.deepEqual(snapshot.observed.map((entry) => entry.target + ':' + entry.event), watched);
      assert.ok(snapshot.observed.every((entry) => entry.added === 0));
    }
    for (const operation of c.operations) {
      const { stage, afterClose, error, rows, last } = operation;
      const enters = step(c, 'operation-entered', { stage });
      const settles = step(c, 'operation-settled', { stage });
      assert.ok(product.step < enters.step && enters.step < settles.step && settles.step < end.step, stage);
      assert.equal(afterClose, enters.afterClose, stage);
      const db = c.trace.find((item) => item.event === 'sqlite-returned' && item.stage === stage);
      if (!error) assert.ok(db, stage);
      if (db) {
        assert.ok(enters.step < db.step && db.step < settles.step, stage);
        assert.equal(db.rows, rows, stage);
        assert.equal(db.last, last, stage);
        if (rows > 0) assert.equal(db.first + rows - 1, last, stage);
      }
    }
  } else {
    assert.equal(c.listenerSnapshots.length, 0);
    assert.equal(c.operations.length, 0);
  }
}
function pages(c) {
  return c.operations.filter(({ stage }) => stage === 'boundary' || stage.startsWith('page-'));
}
function opStages(c) {
  return c.operations.map(({ stage }) => stage);
}
function wire(r) {
  const bytes = Buffer.from(r.bodyBase64, 'base64');
  assert.equal(bytes.toString('base64'), r.bodyBase64);
  assert.equal(sha(bytes), r.bodySha256);
  return JSON.parse(bytes);
}
const cold = summary.history.cold;
const checked = summary.history.checked;
const badEvent = summary.history['bad-event'];
const badCheckpoint = summary.history['bad-checkpoint'];
const ordinaryRunRows = cold.tail - 700;
assert.ok(Number.isInteger(ordinaryRunRows) && ordinaryRunRows > 0 && ordinaryRunRows < 128);
for (const [name, fixture] of Object.entries(summary.history)) {
  assert.equal(fixture.tail, ordinaryRunRows + 700, name);
  assert.equal(fixture.target, fixture.tail - 17, name);
  assert.match(fixture.beforeReadSha256, /^[a-f0-9]{64}$/);
  assert.equal(fixture.beforeReadSha256, fixture.afterReadSha256);
}
assert.equal(cold.checkpoint, undefined);
assert.equal(checked.checkpoint, ordinaryRunRows + 181);
assert.equal(badEvent.damagedEvent, ordinaryRunRows + 190);
assert.equal(badCheckpoint.checkpoint, ordinaryRunRows + 181);
function pageBudget(fixture, at) {
  const rows = [];
  const checkpoint = fixture.checkpoint <= at ? fixture.checkpoint : undefined;
  if (checkpoint) rows.push({ stage: 'boundary', args: [fixture.id, checkpoint - 1, 1], rows: 1, last: checkpoint });
  let after = checkpoint ?? 0;
  for (let i = 1; after < at; i++) {
    const limit = Math.min(128, at - after);
    const returned = Math.min(limit, fixture.tail - after);
    rows.push({ stage: 'page-' + i, args: [fixture.id, after, limit], rows: returned,
      ...(returned ? { last: after + returned } : {}) });
    if (returned === 0) break;
    after += returned;
  }
  return rows;
}
function checkPages(c, plan) {
  const actual = pages(c);
  assert.deepEqual(actual.map(({ afterClose, error, ...read }) => read), plan);
  return actual.map(({ stage, args, rows, last, afterClose }) => ({ stage, after: args[1], limit: args[2], rows, last, afterClose }));
}
const readOrder = ['ownership', 'initial', 'checkpoint'];
const disconnectPlan = [
  ['closed-before-handler', 'before-handler', cold, readOrder],
  ['closed-during-owner', 'ownership', cold, readOrder.slice(1)],
  ['closed-during-initial', 'initial', cold, readOrder.slice(2)],
  ['closed-during-checkpoint', 'checkpoint', checked, ['boundary']],
  ['closed-during-boundary', 'boundary', checked, []],
  ['closed-during-page', 'page-2', cold, []],
  ['closed-at-yield', 'yield-1', cold, []],
  ['closed-page-rejects', 'page-2', cold, []],
];
const disconnects = {};
for (const [name, held, fixture, metadataAfter] of disconnectPlan) {
  const c = summary.cases[name];
  traceChecks(c);
  assert.equal(c.stageReached, held);
  assert.equal(c.client.error.code, 'ECONNRESET');
  assert.equal(c.response, undefined);
  assert.equal(c.trace.some(({ event }) => event === 'response-finish'), false);
  const hold = step(c, 'barrier-entered', { stage: held });
  const destroy = step(c, 'client-destroy');
  const observed = step(c, 'response-close');
  const release = step(c, 'barrier-released', { stage: held });
  const settled = step(c, 'handler-settled');
  assert.ok(hold.step < destroy.step && destroy.step < observed.step &&
    observed.step < release.step && release.step < settled.step);
  assert.equal(hold.responseFinished, false);
  assert.equal(hold.socketDestroyed, false);
  assert.equal(observed.responseFinished, false);
  assert.equal(observed.responseDestroyed, true);
  assert.equal(observed.socketDestroyed, true);
  assert.equal(release.reason, 'transport close observed');
  const special = ['before-handler', 'yield-1'].includes(held);
  assert.deepEqual(observed.active, special ? [] : [held]);
  const reject = name === 'closed-page-rejects';
  const plan = pageBudget(fixture, fixture.target);
  const checkedPlan = reject ? plan.slice(0, 2) : plan;
  assert.deepEqual(opStages(c), [...readOrder, ...checkedPlan.map(({ stage }) => stage)]);
  assert.deepEqual(c.operations[2].args, [fixture.id, fixture.target]);
  if (!special) {
    const operation = step(c, 'operation-entered', { stage: held });
    const sqlite = step(c, 'sqlite-returned', { stage: held });
    const done = step(c, 'operation-settled', { stage: held });
    assert.ok(operation.step < sqlite.step && sqlite.step < hold.step && release.step < done.step);
  } else if (held === 'before-handler') {
    assert.ok(release.step < step(c, 'product-handler-entry').step);
    assert.equal(step(c, 'product-handler-entry').socketDestroyed, true);
  } else {
    const pageDone = step(c, 'operation-settled', { stage: 'page-1' });
    const scheduled = step(c, 'replay-yield-scheduled');
    const callback = step(c, 'replay-yield-callback');
    assert.ok(pageDone.step < scheduled.step && scheduled.step < callback.step && callback.step < hold.step);
    assert.match(scheduled.source, /historicalThread.*run-history\.js:/);
  }
  const reads = checkPages(c, checkedPlan);
  const pagesAfter = reads.filter((op) => op.afterClose && op.stage !== 'boundary').map(({ stage }) => stage);
  const expectedPagesAfter = reject ? []
    : checkedPlan.filter(({ stage }) => stage.startsWith('page-')).slice(held === 'page-2' ? 2 : held === 'yield-1' ? 1 : 0)
      .map(({ stage }) => stage);
  assert.deepEqual(pagesAfter, expectedPagesAfter);
  const after = c.operations.filter((op) => op.afterClose).map(({ stage }) => stage);
  assert.deepEqual(after, [...metadataAfter, ...expectedPagesAfter]);
  for (const { stage, afterClose } of c.operations) {
    const entered = step(c, 'operation-entered', { stage });
    assert.equal(entered.step > observed.step, afterClose);
    if (afterClose) assert.ok(entered.step > release.step);
  }
  if (reject)
    assert.match(c.operations.at(-1).error.message, /qa419-synthetic-repository-error/);
  else assert.ok(c.operations.every((op) => op.error === undefined));
  if (held === 'page-2') {
    assert.ok(Number.isFinite(c.responsiveness.healthMs) && c.responsiveness.healthMs >= 0 &&
      c.responsiveness.healthMs < 3000);
    assert.ok(Number.isFinite(c.responsiveness.currentReadMs) && c.responsiveness.currentReadMs >= 0 &&
      c.responsiveness.currentReadMs < 5000);
  }
  disconnects[name] = { held, client: c.client, activeAtClose: observed.active,
    order: { hold: hold.step, destroy: destroy.step, close: observed.step, release: release.step, settled: settled.step },
    pages: reads, after, dataPageCountAfterClose: pagesAfter.length, writes: c.writesAfterClose,
    sends: c.attemptedSendsAfterClose, errors: c.errors, logs: c.logs, responsiveness: c.responsiveness };
}

const positivePlan = [
  ['historical-seed', cold, 0],
  ['historical-first-event', cold, 1],
  ['historical-two-pages', cold, 129],
  ['historical-cold', cold, cold.target],
  ['historical-completed-input', cold, cold.target],
  ['historical-checkpoint', checked, checked.target],
  ['historical-before-checkpoint', checked, checked.checkpoint - 1],
  ['historical-past-tail', cold, cold.tail + 33],
  ['historical-before-bad-event', badEvent, badEvent.damagedEvent - 1],
  ['historical-before-bad-checkpoint', badCheckpoint, badCheckpoint.checkpoint - 1],
  ['current', checked, undefined],
];
const positives = {};
for (const [name, fixture, at] of positivePlan) {
  const c = summary.cases[name];
  traceChecks(c);
  assert.deepEqual(c.response, summary.positives[name]);
  assert.equal(c.response.status, 200);
  assert.match(c.response.contentType, /^application\/json\b/);
  const body = wire(c.response);
  assert.equal(body.run.id, fixture.id);
  assert.ok(step(c, 'handler-settled').step < step(c, 'response-finish').step);
  assert.equal(step(c, 'response-finish').responseFinished, true);
  assert.deepEqual(c.writesAfterClose, []);
  assert.deepEqual(c.attemptedSendsAfterClose, []);
  assert.ok(c.operations.every((op) => !op.afterClose && !op.error));
  const plan = at === undefined ? [] : pageBudget(fixture, at);
  assert.deepEqual(opStages(c), at === undefined ? ['ownership', 'current'] : [...readOrder, ...plan.map(({ stage }) => stage)]);
  if (at !== undefined) assert.deepEqual(c.operations[2].args, [fixture.id, at]);
  const checked = checkPages(c, plan);
  if (name === 'historical-completed-input') {
    const end = step(c, 'input-end');
    assert.ok(end.step < step(c, 'product-handler-entry').step);
    assert.equal(end.inputComplete, true);
    assert.equal(end.inputAborted, false);
    assert.equal(end.socketDestroyed, false);
    assert.equal(end.responseFinished, false);
    assert.deepEqual(c.response, summary.positives['historical-cold']);
  }
  positives[name] = { at, status: c.response.status, wireSha256: c.response.bodySha256, pages: checked };
}

const negativePlan = [
  ['owner-key-missing', 401, 'UNAUTHORIZED', []],
  ['wrong-scope', 403, 'FORBIDDEN', []],
  ['other-owner', 404, 'RUN_NOT_FOUND', ['ownership']],
  ['missing-run', 404, 'RUN_NOT_FOUND', ['ownership']],
  ['negative-query', 400, 'VALIDATION_FAILED', []],
  ['unsafe-query', 400, 'VALIDATION_FAILED', []],
  ['extra-query', 400, 'VALIDATION_FAILED', []],
  ['corrupt-event', 500, 'STORED_EVENT_INVALID', [...readOrder, 'page-1', 'page-2']],
  ['corrupt-checkpoint', 500, 'STORED_RUN_INVALID', readOrder],
  ['connected-generic-error', 500, 'INTERNAL_ERROR', [...readOrder, 'page-1']],
];
const negatives = {};
for (const [name, status, code, stages] of negativePlan) {
  const c = summary.cases[name];
  traceChecks(c);
  const body = wire(c.response);
  assert.equal(c.response.status, status);
  assert.equal(body.status, status);
  assert.equal(body.code, code);
  assert.match(c.response.contentType, /^application\/problem\+json\b/);
  assert.doesNotMatch(JSON.stringify(body), /qa419-invalid-json|qa419-synthetic-repository-error/);
  assert.deepEqual(opStages(c), stages);
  assert.equal(step(c, 'response-finish').responseFinished, true);
  assert.ok(c.operations.every((op) => !op.afterClose));
  if (name === 'connected-generic-error') assert.ok(c.logs.some((line) =>
    line.msg === 'unhandled error' && line.error?.message === 'qa419-synthetic-repository-error'));
  if (name.startsWith('corrupt-')) {
    const failing = c.operations.at(-1);
    assert.equal(failing.error.code, 'HISTORY_UNREADABLE');
    assert.equal(failing.error.name, name === 'corrupt-event' ? 'InvalidStoredRunEventError' : 'UnreadableRunHistoryError');
    assert.equal(c.trace.some((item) => item.event === 'sqlite-returned' && item.stage === failing.stage), false);
  }
  negatives[name] = { status, code, stages, pages: pages(c), wireSha256: c.response.bodySha256,
    repositoryError: c.operations.at(-1)?.error, logs: c.logs };
}
assert.deepEqual(Object.keys(summary.cases).sort(),
  [...Object.keys(disconnects), ...Object.keys(positives), ...Object.keys(negatives)].sort());
assert.deepEqual(Object.keys(summary.positives).sort(), Object.keys(positives).sort());
assert.equal(new Set(Object.values(summary.cases).map(({ requestId }) => requestId)).size, 29);
assert.equal(summary.transport.bound.address, '127.0.0.1');
assert.ok(summary.transport.bound.port > 0 && ![4747, 4748].includes(summary.transport.bound.port));
assert.equal(summary.transport.ownsOnlyThisListener, true);
const cleanup = summary.cleanup;
const store = join(evidence, 'store');
assert.equal(cleanup.fastify, 'closed');
assert.equal(cleanup.container, 'closed');
assert.deepEqual(cleanup.sockets, { clients: 0, server: 0 });
assert.equal(cleanup.remainingListener, null);
assert.equal(cleanup.collectionPasses, 2);
assert.equal(cleanup.error, undefined);
assert.equal(cleanup.empty, true);
assert.deepEqual(cleanup.remainingStoreFiles, []);
assert.deepEqual(readdirSync(store), []);
assert.equal(realpathSync(store), store);
assert.ok(cleanup.files.includes(join(store, 'graphgoblin.db')));
assert.ok(cleanup.files.every((path) => /^graphgoblin\.db(?:-wal|-shm)?$/.test(relative(store, path))));
assert.ok(Number.isInteger(cleanup.probe.pid) && cleanup.probe.pid > 0);
assert.deepEqual(cleanup.probe.exit, { code: 0, signal: null });
assert.deepEqual(cleanup.probe.close, cleanup.probe.exit);
assert.equal(cleanup.probe.stdout.trim(), 'qa-exclusive-open-ok ' + cleanup.files.length);
assert.equal(cleanup.probe.stderr, '');
assert.equal(cleanup.probe.error, undefined);
assert.equal(cleanup.probe.stdinError, undefined);
assert.deepEqual(summary.storeOwnership.map(({ file }) => file),
  ['graphgoblin.lock', 'graphgoblin.db.graphgoblin.lock'].map((file) => join(store, file)));
for (const lock of summary.storeOwnership) {
  assert.equal(lock.pid, exit.pid);
  const lockUtc = Number((BigInt(lock.windowsCreationTime) - 116444736000000000n) / 10000n);
  assert.equal(lockUtc, Date.parse(exit.creationUtc));
}

const file = fileURLToPath(import.meta.url);
inventory(file);
process.stdout.write(JSON.stringify({
  phase: 'baseline', disposition: 'reproduced-post-close-replay', checkout, head, tree, reviewed410, merged381,
  sourceSample: [...sourceSample],
  process: { build: buildExit, launch, exit, close }, sourceAndBuild: preflight.build,
  transport: summary.transport, disconnects, positives, negatives, history: summary.history, cleanup,
  loaded: summary.bindings, inputAndReceiptChecksums: entries,
}, null, 2) + '\n');

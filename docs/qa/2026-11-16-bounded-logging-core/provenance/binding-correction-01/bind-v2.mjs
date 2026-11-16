import assert from 'node:assert/strict';
import { lstat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { admitRef, batch, checkedRef, checkSource, identity, json, launcherSource, loadModule, openContext, suite, verifyManifest } from '../launcher-438-candidate-freeze-root-tools/freeze.mjs';

const [planPath, planSha, sourceSha, compilerReceiptSha, ...extra] = process.argv.slice(2);
assert.equal(extra.length, 0, 'Usage: bind.mjs <root plan> <plan hash> <source-build hash> <compile receipt hash>');
const context = await openContext(planPath, planSha);
const { plan, job, opening, build, refs, buildReceipt, compiler, node, git, ps, planRef } = context;
const sourceRef = await admitRef({ path: join(job.directory, 'source-build.json'), sha256: sourceSha }, batch);
const source = await json(sourceRef.path);
assert.equal(source.schema, 'gg410-reviewed-build-binding/v1');
for (const key of ['head', 'tree', 'actualMain', 'actualMainTree', 'indexSha256'])
  assert.equal(source[key], opening[key], key);
assert.equal(source.checkout, job.checkout);
assert.equal(source.nodePath, node.path);
assert.equal(source.nodeSha256, node.sha256);
assert.equal(source.nodeVersion, 'v22.23.4');
assert.deepEqual(source.input, {
  phase: 'candidate', merged381: job.input.merged381,
  admissionPath: plan.buildAdmission.path, admissionSha256: plan.buildAdmission.sha256,
});
assert.deepEqual(source.buildProof, {
  buildReceipt, log: build.log, exitReceipt: refs.exit, exitCode: 0,
});
assert.equal(build.log.bytes, (await lstat(refs.log.path)).size, 'Exact build log byte count');
assert.equal(source.sourceFiles[launcherSource], plan.launcherSourceSha256);
const sourceFile = await checkSource(context);

const artifacts = {
  outputRoots: source.outputRoots, outputFiles: source.outputFiles, runtimeEntries: source.runtimeEntries,
  dependencyFiles: source.dependencyFiles, workspaceLinks: source.workspaceLinks,
  inventorySha256: source.artifactInventorySha256,
  counts: { outputRoots: source.outputRoots.length, outputFiles: Object.keys(source.outputFiles).length },
};
assert.equal(artifacts.inventorySha256, build.artifacts.inventorySha256);
for (const [key, count] of Object.entries(artifacts.counts)) assert.equal(count, build.artifacts[key], key);
assert.equal(Object.keys(artifacts.dependencyFiles).length, build.artifacts.dependencyFiles);
assert.equal(Object.keys(artifacts.workspaceLinks).length, build.artifacts.workspaceLinks);

const launcherBuildReceipt = await admitRef({ path: join(plan.compileDirectory, 'receipt.json'), sha256: compilerReceiptSha }, batch);
const compiled = await json(launcherBuildReceipt.path);
assert.equal(compiled.schema, 'gg438-candidate-compiler-receipt/v1');
assert.equal(compiled.complete, true);
assert.deepEqual(compiled.opening, opening);
assert.deepEqual(compiled.closing, opening);
assert.deepEqual(compiled.plan, planRef);
assert.deepEqual(compiled.buildReceipt, buildReceipt);
assert.deepEqual(compiled.compiler, compiler);
assert.deepEqual(compiled.source, sourceFile);
assert.deepEqual(compiled.node, node);
assert.deepEqual(compiled.git, git);
assert.deepEqual(compiled.ps, ps);
assert.equal(compiled.cwd, job.checkout);
const launcherBuildExit = await admitRef(compiled.rawExit, batch);
assert.equal(launcherBuildExit.path, join(plan.compileDirectory, 'exit.json'));
const rawExit = await json(launcherBuildExit.path);
assert.deepEqual(rawExit, compiled.result);
assert.equal(rawExit.schema, 'gg438-candidate-compiler-exit/v1');
assert(rawExit.pid > 0 && rawExit.pid === compiled.pid && rawExit.spawnedAt && rawExit.closedAt);
assert.equal(rawExit.exitCode, 0);
assert.equal(rawExit.signal, null);
assert.equal(rawExit.observedExit.exitCode, 0);
assert.equal(rawExit.observedExit.signal, null);
assert.equal(rawExit.timedOut, false);
assert(!rawExit.spawnError && !rawExit.closeAmbiguous && !rawExit.launchReceiptError);
const launcher = await admitRef(compiled.executable, batch);
assert.equal(launcher.path, join(plan.compileDirectory, 'GraphGoblin.exe'));
assert.deepEqual(compiled.argv, [
  '/nologo', '/target:winexe', '/optimize+', '/platform:x64', '/reference:System.Windows.Forms.dll',
  '/reference:System.Web.Extensions.dll', '/out:' + launcher.path, sourceFile.path,
]);
assert.equal(rawExit.spawnfile, compiler.path);
assert.deepEqual(rawExit.spawnargs, [compiler.path, ...compiled.argv]);
const rawStreams = {};
for (const channel of ['stdout', 'stderr']) {
  const stream = compiled[channel];
  assert.equal(stream.path, join(plan.compileDirectory, channel + '.raw'));
  assert.equal(stream.bytes, (await lstat(stream.path)).size);
  assert(stream.endedAt && stream.writeClosedAt && !rawExit[channel].error);
  assert.equal(stream.endedAt, rawExit[channel].endedAt);
  assert.equal(stream.writeClosedAt, rawExit[channel].writeClosedAt);
  rawStreams[channel] = await admitRef(stream, batch);
}

const { manifest, rows } = await verifyManifest(context);
assert.equal(plan.privateFixture.path, join(batch, 'launcher-438-candidate-private-fixture-root.json'));
const privateFixture = await admitRef(plan.privateFixture, batch);
const acl = await json(privateFixture.path);
assert.equal(acl.schema, 'gg438-owned-private-fixture-root/v1');
assert.equal(acl.path, suite);
assert(acl.protectedInheritance && acl.afterSddl && acl.at);
assert.deepEqual(acl.expectedPrincipals, [acl.ownerSid, 'S-1-5-18', 'S-1-5-32-544']);
assert.equal(acl.sealedFilesUnchanged, rows.size + 1);
assert.equal(acl.sharedBatchAclChanged, false);
assert.equal(acl.ownerResourcesChanged, false);

const example = await json(rows.get('admission.example.json').path);
assert.equal(example.schema, 'gg438-native-candidate-admission/v4');
const cfg = { ...example, attempt: plan.attempt };
const fromManifest = {
  runnerSha256: 'run.mjs', bindingModuleSha256: 'binding.mjs',
  controlsModuleSha256: 'controls.mjs', nativeModuleSha256: 'native.mjs',
};
for (const [key, path] of Object.entries(fromManifest))
  assert.equal(cfg[key], rows.get(path).sha256, 'V4 example/manifest mismatch ' + key);
const common = await checkedRef(join(batch, 'runtime-410-build-preparation', 'common.mjs'), cfg.artifactCommonSha256, batch);
const artifactModule = await checkedRef(join(batch, 'runtime-410-build-preparation', 'artifacts.mjs'), cfg.artifactModuleSha256, batch);
const { collectArtifacts } = await loadModule(artifactModule.path);
const { verify } = await loadModule(rows.get('binding.mjs').path);
assert.equal(cfg.contract.path, join(batch, 'launcher-438-final-contract.md'));
assert.equal(cfg.stdio.path, join(batch, 'launcher-438-stdio-preparation', 'ObserveStdio.compile-check.exe'));
const contract = await admitRef(cfg.contract, batch);
const stdio = await admitRef(cfg.stdio, batch);
const v3Rows = {
  'inventory.mjs': '8dcb53f991b13d815bd97bcae7046aa73a8d90efae20c491ec84b35935bb03d1',
  'binding.mjs': 'd807d1f993f126684362f3764fd38987822ea793b0d735af47fb01beb38dd3fb',
  'workload.mjs': '4419c0577ac7c0bc2a2d94986ca018c8c162065e8e0036c3b86520ede17acb8d',
  'windows.mjs': 'f9cfdf993c15f7e53db1caf6837b29b3073c533804623fa08c77c6f5e3a20cd5',
};
const v3 = [];
for (const [name, sha256] of Object.entries(v3Rows))
  v3.push(await checkedRef(join(batch, 'launcher-438-native-preparation-v3', name), sha256, batch));
const qualified = await checkedRef(join(batch, 'launcher-438-stdio-control-root-review', 'readback.json'),
  'dc5c9a06c4f122a784783a3327ee89036a515b4eed7ccf5eae8d65cd8f245024', batch);
const controlReadback = await json(qualified.path);
assert(controlReadback.verdict.fiveControlsQualified && controlReadback.verdict.recordedProcessesGone);
assert.equal(controlReadback.currentBindings.hashes.observerExe.sha256, stdio.sha256);

for (const folder of ['receipts', 'attempts']) {
  await assert.rejects(lstat(join(suite, folder, cfg.attempt)), { code: 'ENOENT' });
}
const binding = {
  schema: 'gg438-native-source-build/v1', mode: 'candidate',
  checkout: job.checkout, merged436: plan.merged436, head: opening.head, tree: opening.tree,
  actualMain: opening.actualMain, actualMainTree: opening.actualMainTree, indexSha256: opening.indexSha256,
  git, node, launcher, launcherBuildReceipt, launcherBuildExit, launcherBuildStdout: rawStreams.stdout,
  launcherBuildStderr: rawStreams.stderr, buildReceipt, buildLog: refs.log, buildExit: refs.exit,
  sourceBuild: sourceRef, sourceFiles: source.sourceFiles, artifacts, powerShell: ps, v4Manifest: manifest,
  privateFixtureReceipt: privateFixture, stdioQualification: qualified,
};
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
await save(plan.bindingOutput, binding);
cfg.binding = await checkedRef(plan.bindingOutput, undefined, batch);

// Reuse the final V4 opening verifier. No runner or provider is invoked here.
const readback = await verify({
  cfg, binding, collectArtifacts, common, path: planRef.path, digest: planRef.sha256,
  dependencies: [manifest, ...rows.values(), ...v3, qualified, stdio, contract, privateFixture, sourceRef,
    launcherBuildReceipt, launcherBuildExit, rawStreams.stdout, rawStreams.stderr],
});
assert.deepEqual(await identity(context), opening);
await admitRef(compiler, undefined, true);
await admitRef(ps, undefined, true);
await admitRef(buildReceipt, batch);
const proposal = {
  ...cfg, schema: 'gg438-native-candidate-admission-proposal/v1',
  intendedSchema: cfg.schema, state: 'proposed',
  freeze: planRef, v4Manifest: manifest, wrapper: rows.get('launch.ps1'), powerShell: ps,
  privateFixtureReceipt: privateFixture, stdioQualification: qualified, sourceBuildReadback: readback,
};
await save(plan.qaDraftOutput, proposal);
const proposalRef = await checkedRef(plan.qaDraftOutput, undefined, batch);
console.log(JSON.stringify({ binding: cfg.binding, nativeProposal: proposalRef, readback }));


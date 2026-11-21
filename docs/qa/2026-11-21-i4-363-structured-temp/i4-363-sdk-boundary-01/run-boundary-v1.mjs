import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
const evidence = path.dirname(fileURLToPath(import.meta.url));
const checkout = 'G:/ggq/gg-i4-363-qa/GraphGoblin';
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const dump = (name, value) => fs.writeFileSync(path.join(evidence, name), JSON.stringify(value, null, 2) + '\n');
const git = (...args) => execFileSync('git', args, { cwd: checkout, windowsHide: true }).toString();
const beforeEnv = Object.fromEntries(['TEMP', 'TMP', 'TMPDIR', 'CODEX_HOME', 'NODE_OPTIONS'].map((key) => [key, process.env[key]]));
const priorQaManifest = path.join(path.dirname(evidence), 'i4-363-independent-01/manifest.json');
const priorQaManifestHash = hash(fs.readFileSync(priorQaManifest));
assert.equal(priorQaManifestHash, 'e4047b7378b612194b3f47ed11e19aac3f2c4d8f80f81c1b46524116ee844c9b');
const head = '76beeb0f2e99343697578c2713ac06f80d59e7b5';
assert.equal(git('rev-parse', 'HEAD').trim(), head);
assert.equal(git('rev-parse', 'HEAD^{tree}').trim(), '2544bc2913f9cec0d95a215ea631ab62c7985c1d');
assert.equal(git('status', '--porcelain=v1'), '');
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'win32');
const sources = {
  structured: path.join(checkout, 'packages/adapter-codex/src/structured.ts'),
  harness: path.join(checkout, 'packages/adapter-codex/src/harness.ts'),
  client: path.join(checkout, 'packages/adapter-codex/src/client.ts'),
  options: path.join(checkout, 'packages/adapter-codex/src/options.ts'),
  sdk: fs.realpathSync(path.join(checkout, 'packages/adapter-codex/node_modules/@openai/codex-sdk/dist/index.js')),
  sdkTypes: fs.realpathSync(path.join(checkout, 'packages/adapter-codex/node_modules/@openai/codex-sdk/dist/index.d.ts')),
  sdkPackage: fs.realpathSync(path.join(checkout, 'packages/adapter-codex/node_modules/@openai/codex-sdk/package.json')),
  managedPatch: path.join(checkout, 'patches/@openai__codex-sdk@0.160.0.patch'),
  isolationTest: path.join(checkout, 'packages/adapter-codex/src/isolation.test.ts'),
  lock: path.join(checkout, 'pnpm-lock.yaml'),
  fixture: path.join(evidence, 'sdk-case-v1.mjs'),
  fakeCli: path.join(evidence, 'fake-cli-v1.mjs'),
  driver: fileURLToPath(import.meta.url),
};
const binding = Object.fromEntries(Object.entries(sources).map(([key, source]) => [key, { path: source, sha256: hash(fs.readFileSync(source)) }]));
for (const [key, source] of Object.entries(sources)) if (!['fixture', 'fakeCli', 'driver'].includes(key)) fs.copyFileSync(source, path.join(evidence, 'sources', `${key}${path.extname(source)}`));
const sdkPackage = JSON.parse(fs.readFileSync(sources.sdkPackage, 'utf8'));
assert.equal(sdkPackage.version, '0.160.0');
const sdkSource = fs.readFileSync(sources.sdk, 'utf8');
assert(sdkSource.includes('const schemaDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-output-schema-"));'));
assert(sdkSource.includes('windowsHide: true'));
dump('source-binding.json', { at: new Date().toISOString(), head, tree: git('rev-parse', 'HEAD^{tree}').trim(), parent: git('rev-list', '--parents', '-n', '1', 'HEAD').trim(), sdkVersion: sdkPackage.version, existingManagedPatch: 'windowsHide only', sources: binding });
const predictions = [
  { id: 'short-control', expected: 'Real CodexStructured and default CodexHarness use real pinned SDK. Empty short TEMP succeeds via harmless CLI; listing and turn markers exist; --output-schema file is read and matches schema; scratch and SDK schema directory removed.' },
  { id: 'long-226', expected: 'Adapter exclusive mkdir succeeds and MCP listing marker proves empty 249-character scratch. SDK output-schema mkdtemp template is 253 characters; expect native ENAMETOOLONG text normalized as harness failure, no CLI turn marker, owned scratch removed and TEMP empty.' },
];
dump('predictions.json', { writtenBeforeBehavior: true, mainProcessEnvWillNotBeMutated: true, noRuntimeOrBuiltinMonkeypatch: true, cases: predictions });
const ownedParent = fs.realpathSync('G:/ggq');
const owner = path.join(ownedParent, `gg-i4-363-sdk-${crypto.randomBytes(5).toString('hex')}`);
fs.mkdirSync(owner);
const checkOwned = (target) => {
  const absolute = path.resolve(target);
  const relative = path.relative(owner, absolute);
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  return absolute;
};
const cwd = path.join(owner, 'cwd');
const home = path.join(owner, 'home');
fs.mkdirSync(cwd); fs.mkdirSync(home);
fs.writeFileSync(path.join(home, 'config.toml'), '# Empty QA-owned CODEX_HOME; harmless CLI only.\n');
const loader = fs.realpathSync(path.join(checkout, 'apps/api/node_modules/tsx/dist/loader.mjs'));
const schema = { type: 'object', properties: { fixture: { type: 'string' }, ok: { type: 'boolean' } }, required: ['fixture', 'ok'], additionalProperties: false };
const observations = { startedAt: new Date().toISOString(), head, owner, checkedParent: ownedParent, processCwd: cwd, processCwdLength: cwd.length, codexHome: home, codexHomeLength: home.length, sources: binding, cases: [], cleanup: [], noProvider: true, noRuntimeMutation: true };
dump('run-input.json', { at: new Date().toISOString(), execPath: process.execPath, node: process.version, platform: process.platform, sources: binding, predictionsSha256: hash(fs.readFileSync(path.join(evidence, 'predictions.json'))), owner, cwd, home, loader, schema });
try {
  for (const prediction of predictions) {
    const caseRoot = path.join(owner, prediction.id);
    fs.mkdirSync(caseRoot);
    let temp = path.join(caseRoot, 'tmp');
    if (prediction.id === 'long-226') {
      while (temp.length < 190) temp = path.join(temp, 'native-temp-segment');
      temp = path.join(temp, 'x'.repeat(226 - temp.length - 1));
      assert.equal(temp.length, 226);
    }
    checkOwned(temp);
    fs.mkdirSync(temp, { recursive: true });
    const config = { id: prediction.id, checkout, temp, cwd, schema, fakeCli: sources.fakeCli, listingFile: path.join(evidence, 'raw', `${prediction.id}.listing.json`), turnFile: path.join(evidence, 'raw', `${prediction.id}.turn.json`), stateFile: path.join(evidence, 'raw', `${prediction.id}.state.json`) };
    const configPath = path.join(evidence, 'raw', `${prediction.id}.config.json`);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    const childEnv = {};
    for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE']) if (process.env[key] !== undefined) childEnv[key] = process.env[key];
    Object.assign(childEnv, { TEMP: temp, TMP: temp, TMPDIR: temp, CODEX_HOME: home, USERPROFILE: home });
    const args = ['--import', pathToFileURL(loader).href, '--conditions=development', sources.fixture, configPath];
    const child = spawnSync(process.execPath, args, { cwd, env: childEnv, windowsHide: true, timeout: 30000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    fs.writeFileSync(path.join(evidence, 'raw', `${prediction.id}.stdout.txt`), child.stdout ?? '');
    fs.writeFileSync(path.join(evidence, 'raw', `${prediction.id}.stderr.txt`), child.stderr ?? '');
    const entry = { id: prediction.id, expected: prediction.expected, temp, tempLength: temp.length, expectedScratchLength: path.join(temp, 'gg-structured-00000000').length, sdkSchemaDirTemplate: path.join(temp, 'codex-output-schema-XXXXXX'), sdkSchemaDirTemplateLength: path.join(temp, 'codex-output-schema-XXXXXX').length, sdkSchemaFileTemplateLength: path.join(temp, 'codex-output-schema-XXXXXX', 'schema.json').length, invocation: { executable: process.execPath, args, cwd, envKeys: Object.keys(childEnv) }, child: { status: child.status, signal: child.signal, error: child.error && { name: child.error.name, message: child.error.message, code: child.error.code } }, state: fs.existsSync(config.stateFile) ? JSON.parse(fs.readFileSync(config.stateFile, 'utf8')) : null, status: 'RUNNING' };
    observations.cases.push(entry);
    try {
      assert.equal(child.error, undefined);
      assert.equal(child.status, 0);
      assert(entry.state?.outcome, 'Child fixture must reach public-method result');
      const state = entry.state;
      assert.deepEqual(state.tempEntriesBefore, []);
      assert.deepEqual(state.tempEntriesAfter, []);
      assert.equal(state.listingExists, true);
      assert.deepEqual(state.listing.entries, []);
      assert.equal(path.dirname(state.listing.cwd), temp);
      assert.match(path.basename(state.listing.cwd), /^gg-structured-[a-f0-9]{8}$/);
      assert.equal(state.scratchExistsAfter, false);
      if (prediction.id === 'short-control') {
        assert.equal(state.outcome.kind, 'resolved');
        assert.deepEqual(state.outcome.result.value, { fixture: 'sdk-boundary', ok: true });
        assert.equal(state.turnExists, true);
        assert.deepEqual(state.turn.schema, schema);
        assert.equal(path.dirname(state.turn.schemaDir), temp);
        assert.equal(state.schemaDirExistsAfter, false);
        assert.equal(state.turn.requestedCwd, state.listing.cwd);
      } else {
        assert.equal(state.tempLength, 226);
        assert.equal(state.listing.cwdLength, 249);
        assert.equal(entry.sdkSchemaDirTemplateLength, 253);
        assert.equal(entry.sdkSchemaFileTemplateLength, 265);
        assert.equal(state.outcome.kind, 'rejected');
        assert.equal(state.outcome.error.code, 'HARNESS_TURN_FAILED');
        assert.match(state.outcome.error.message, /ENAMETOOLONG.*mkdtemp/s);
        assert(state.outcome.error.message.includes(entry.sdkSchemaDirTemplate));
        assert.equal(state.turnExists, false);
      }
      entry.status = 'PASS';
    } catch (error) {
      entry.status = 'FAIL';
      entry.verificationFailure = { name: error.name, message: error.message, stack: error.stack };
    }
    dump('observations.partial.json', observations);
    console.log(`${entry.status} ${entry.id}: ${entry.state?.outcome?.kind ?? 'setup failed'}`);
  }
} finally {
  const relative = path.relative(ownedParent, owner);
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && /^gg-i4-363-sdk-[a-f0-9]{10}$/.test(relative));
  observations.cleanup.push({ phase: 'before', owner, absoluteContainmentCheckedWithin: ownedParent, createdExclusivelyByThisDriver: true, entries: fs.readdirSync(owner) });
  fs.rmSync(owner, { recursive: true, force: true });
  observations.cleanup.push({ phase: 'after', owner, exists: fs.existsSync(owner) });
  const afterEnv = Object.fromEntries(['TEMP', 'TMP', 'TMPDIR', 'CODEX_HOME', 'NODE_OPTIONS'].map((key) => [key, process.env[key]]));
  assert.deepEqual(afterEnv, beforeEnv);
  assert.equal(hash(fs.readFileSync(priorQaManifest)), priorQaManifestHash);
  assert.equal(git('rev-parse', 'HEAD').trim(), head);
  assert.equal(git('status', '--porcelain=v1'), '');
  for (const [key, source] of Object.entries(sources)) assert.equal(hash(fs.readFileSync(source)), binding[key].sha256, `Unchanged source ${key}`);
  observations.final = { at: new Date().toISOString(), pass: observations.cases.filter((item) => item.status === 'PASS').length, fail: observations.cases.filter((item) => item.status === 'FAIL').length, behaviorCasesExecuted: observations.cases.length, expectedCases: 2, mainProcessEnvUnchanged: true, sourceUnchanged: true, checkoutClean: true, originalQaManifestUnchanged: priorQaManifestHash, ownerRemoved: !fs.existsSync(owner) };
  dump('observations.json', observations);
  console.log(JSON.stringify(observations.final));
  process.exitCode = observations.final.fail > 0 || observations.cases.length !== 2 ? 1 : 0;
}

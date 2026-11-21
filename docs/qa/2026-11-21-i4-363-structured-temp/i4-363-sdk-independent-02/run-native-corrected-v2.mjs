import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'native-corrected-01');
const checkout = 'G:/ggq/gg-i4-363-sdk-qa/GraphGoblin';
const q = path.dirname(path.dirname(out));
const head = '7d8467439b9850a555b92ab4b96b58c8b8b78388';
const parent = '76beeb0f2e99343697578c2713ac06f80d59e7b5';
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
const json = (name, data) => fs.writeFileSync(path.join(out, name), JSON.stringify(data, null, 2) + '\n');
const git = (...args) => execFileSync('git', args, { cwd: checkout, windowsHide: true });
assert.equal(git('status', '--porcelain=v1').toString(), ''); assert.equal(git('rev-parse', 'HEAD').toString().trim(), head);
assert.equal(git('rev-parse', 'HEAD^{tree}').toString().trim(), '00f6f08cebc0e83b257e52e4781f5c85a6c52c1c');
assert.equal(git('rev-list', '--parents', '-n', '1', 'HEAD').toString().trim(), `${head} ${parent}`);
assert.equal(git('branch', '--show-current').toString().trim(), '');
assert.equal(process.version, 'v22.23.4'); assert.equal(process.platform, 'win32');
const oldManifest = path.join(q, 'i4-363-sdk-boundary-01/manifest.json');
assert.equal(hash(fs.readFileSync(oldManifest)), '49b577d1a6776ad8c0cd6ca429b5eeec9e70bd56984b03d738c88c4d6c552bc3');
const sdk = fs.realpathSync(path.join(checkout, 'packages/adapter-codex/node_modules/@openai/codex-sdk/dist/index.js'));
const sdkBytes = fs.readFileSync(sdk); assert.equal(hash(sdkBytes), 'ec7471535be310cabbb8f256faa80a1101e46b84b41d42cae40a3e36a9a5feb7');
const oldSdk = fs.readFileSync(path.join(q, 'i4-363-sdk-boundary-01/sources/sdk.js'), 'utf8');
assert.equal(sdkBytes.toString(), oldSdk.replace('"codex-output-schema-"', '"gg-schema-"'));
const newPatchHash = '119554c3f7cb39db6b24dbb75e9d51fede75171d04aec0114d31356b79693760';
const oldPatchHash = '3d897be4ca6f078ed158b30bb1a58bc02e1e689560dc658e8bd2d93d27b7338d';
const lock = fs.readFileSync(path.join(checkout, 'pnpm-lock.yaml'), 'utf8');
assert.equal(lock.split(newPatchHash).length - 1, 3); assert.equal(lock.replaceAll(newPatchHash, oldPatchHash), git('show', `${parent}:pnpm-lock.yaml`).toString());
assert.deepEqual(fs.readFileSync(path.join(checkout, 'packages/adapter-codex/src/structured.ts')), git('show', `${parent}:packages/adapter-codex/src/structured.ts`));
const requireSdk = createRequire(sdk); const cliPackage = requireSdk.resolve('@openai/codex/package.json');
const requireCli = createRequire(cliPackage); const nativePackage = requireCli.resolve('@openai/codex-win32-x64/package.json');
const nativeBinary = path.join(path.dirname(nativePackage), 'vendor/x86_64-pc-windows-msvc/bin/codex.exe');
const sources = { sdk, nativeBinary, patch: path.join(checkout, 'patches/@openai__codex-sdk@0.160.0.patch'), lock: path.join(checkout, 'pnpm-lock.yaml'), structured: path.join(checkout, 'packages/adapter-codex/src/structured.ts'), harness: path.join(checkout, 'packages/adapter-codex/src/harness.ts'), client: path.join(checkout, 'packages/adapter-codex/src/client.ts'), options: path.join(checkout, 'packages/adapter-codex/src/options.ts'), case: path.join(path.dirname(out), 'source-case-v2.mjs'), fakeCli: path.join(path.dirname(out), 'harmless-cli-v1.mjs'), driver: fileURLToPath(import.meta.url) };
const binding = Object.fromEntries(Object.entries(sources).map(([name, file]) => [name, { path: file, sha256: hash(fs.readFileSync(file)) }]));
for (const [name, file] of Object.entries(sources)) if (!['nativeBinary', 'case', 'fakeCli', 'driver'].includes(name)) fs.copyFileSync(file, path.join(out, 'sources', `${name}${path.extname(file)}`));
for (const relative of ['decision-177.md', 'i4-363-sdk-root-freeze.json', 'i4-363-sdk-author-01/REPORT.md', 'i4-363-sdk-author-01/source-binding.json', 'i4-363-sdk-author-01/managed-patch-readback.json']) { const target = path.join(out, 'sources/input', relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(q, relative), target); }
json('source-binding.json', { at: new Date().toISOString(), head, parent, tree: git('rev-parse', 'HEAD^{tree}').toString().trim(), detached: true, checkout, node: process.version, sdkVersion: JSON.parse(fs.readFileSync(path.join(path.dirname(sdk), '../package.json'))).version, sources: binding, prefixOnlyInstalledChange: true, windowsHideRetained: sdkBytes.toString().includes('windowsHide: true'), threeLockReferencesOnly: true, originalAllocatorUnchanged: true });
const predictions = [];
// Only the one authorized corrected native pair. Harmless cases are not rerun.
for (const root of ['short', '226']) predictions.push({ id: `native-${root}-success`, tier: 'native', root, mode: 'success', expected: 'Actual bundled Codex native CLI accepts SDK schema and cwd and sends one local Responses request with matching JSON schema; returns synthetic structured proof; schema/scratch removed, sentinels preserved, all observed children exit. No live entitlement claim.' });
json('predictions.json', { beforeBehaviorExecution: true, cases: predictions, longExpected: { temp: 226, adapterScratch: 249, sdkSchemaDir: 243, sdkSchemaFile: 255 }, fixtureRecoveryBudget: 'At most one separately archived corrected attempt for the native pair only; no automatic retry in this driver.' });
const ownerParent = fs.realpathSync('G:/ggq'); const owner = path.join(ownerParent, `gg363q2-${crypto.randomBytes(5).toString('hex')}`); fs.mkdirSync(owner);
const within = (target) => { const resolved = path.resolve(target); const rel = path.relative(owner, resolved); assert(rel && !rel.startsWith('..') && !path.isAbsolute(rel)); return resolved; };
const loader = fs.realpathSync(path.join(checkout, 'apps/api/node_modules/tsx/dist/loader.mjs'));
const schema = { type: 'object', properties: { proof: { type: 'string' }, ok: { type: 'boolean' } }, required: ['proof', 'ok'], additionalProperties: false };
const beforeEnv = JSON.stringify(Object.fromEntries(['TEMP', 'TMP', 'TMPDIR', 'CODEX_HOME'].map((key) => [key, process.env[key]])));
const observations = { head, owner, sourceBinding: binding, expectedCases: 2, cases: [], cleanup: [] };
json('run-input.json', { at: new Date().toISOString(), node: process.version, executable: process.execPath, owner, schema, loader, sourceBinding: binding, predictionsSha256: hash(fs.readFileSync(path.join(out, 'predictions.json'))) });
try {
  for (const prediction of predictions) {
    const root = path.join(owner, prediction.id); fs.mkdirSync(root); const home = path.join(root, 'home'); const cwd = path.join(root, 'cwd'); fs.mkdirSync(home); fs.mkdirSync(cwd); fs.writeFileSync(path.join(home, 'config.toml'), '[features]\nplugins=false\n');
    let temp = path.join(root, 'tmp'); if (prediction.root === '226') { while (temp.length < 190) temp = path.join(temp, 'owned-temp-segment'); temp = path.join(temp, 'x'.repeat(226 - temp.length - 1)); assert.equal(temp.length, 226); }
    within(temp); fs.mkdirSync(temp, { recursive: true });
    const sentinelNames = ['gg-schema-SENTINEL', 'gg-structured-sentinel']; const sentinels = [];
    for (const name of sentinelNames) { const folder = path.join(temp, name); fs.mkdirSync(folder); const file = path.join(folder, 'm'); const text = `QA-owned independent sentinel ${name}`; fs.writeFileSync(file, text); sentinels.push({ path: file, text }); }
    const plain = path.join(temp, 'sentinel.txt'); fs.writeFileSync(plain, 'independent plain sentinel'); sentinels.push({ path: plain, text: 'independent plain sentinel' });
    const config = { ...prediction, checkout, temp, cwd, schema, sentinelNames, sentinels, fakeCli: sources.fakeCli, listFile: path.join(out, 'raw', `${prediction.id}.listing.json`), turnFile: path.join(out, 'raw', `${prediction.id}.turn.json`), stateFile: path.join(out, 'raw', `${prediction.id}.state.json`) };
    const configFile = path.join(out, 'raw', `${prediction.id}.config.json`); fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
    const env = {}; for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE']) if (process.env[key] !== undefined) env[key] = process.env[key];
    Object.assign(env, { TEMP: temp, TMP: temp, TMPDIR: temp, CODEX_HOME: home, USERPROFILE: home, HOME: home, APPDATA: home, LOCALAPPDATA: home });
    const args = ['--import', pathToFileURL(loader).href, '--conditions=development', sources.case, configFile];
    const child = spawnSync(process.execPath, args, { cwd, env, windowsHide: true, timeout: 40000, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    fs.writeFileSync(path.join(out, 'raw', `${prediction.id}.stdout.txt`), child.stdout ?? ''); fs.writeFileSync(path.join(out, 'raw', `${prediction.id}.stderr.txt`), child.stderr ?? '');
    const row = { ...prediction, process: { pid: child.pid, status: child.status, signal: child.signal, error: child.error && { code: child.error.code, message: child.error.message } }, invocation: { executable: process.execPath, args, cwd, envKeys: Object.keys(env) }, state: fs.existsSync(config.stateFile) ? JSON.parse(fs.readFileSync(config.stateFile)) : null, status: 'RUNNING' }; observations.cases.push(row);
    try {
      assert.equal(child.error, undefined); assert.equal(child.status, 0); const state = row.state; assert(state && !state.fixtureFailure, state?.fixtureFailure?.message);
      assert(state.children.length >= 2); assert(state.children.every((entry) => entry.pid > 0 && entry.exited)); assert.deepEqual(state.liveHandles, []);
      assert.equal(state.schemaDirExistsAfter, false); assert.equal(state.scratchExistsAfter, false);
      assert(state.sentinelContents.every((entry) => entry.actual === entry.expected));
      const namespaces = state.after.filter((name) => name.startsWith('gg-schema-') || name.startsWith('gg-structured-')).sort(); assert.deepEqual(namespaces, [...sentinelNames].sort());
      const read = prediction.tier === 'harmless' ? state.turn : state.requests[0]; assert(read); assert.deepEqual(read.schema, schema); assert.equal(read.schemaText, JSON.stringify(schema));
      const scratch = prediction.tier === 'harmless' ? state.turn.cwd : read.scratch; const entries = prediction.tier === 'harmless' ? state.turn.cwdEntries : read.scratchEntries; assert.deepEqual(entries, []);
      if (prediction.root === '226') { assert.equal(scratch.length, 249); assert.equal(read.schemaDirLength, 243); assert.equal(read.schemaFileLength, 255); }
      if (prediction.mode === 'success') { assert.equal(state.outcome.kind, 'resolved'); assert.deepEqual(state.outcome.value.value, { proof: 'sdk363', ok: true }); }
      if (prediction.mode === 'error') { assert.equal(state.outcome.kind, 'rejected'); assert.equal(state.outcome.error.code, 'HARNESS_TURN_FAILED'); assert(state.children.some((entry) => entry.exitCode === 7)); }
      if (prediction.mode === 'abort') { assert.equal(state.outcome.kind, 'rejected'); assert.equal(state.outcome.error.name, 'AbortError'); assert.equal(state.abortObservation.schemaFileExists, true); assert.equal(state.abortObservation.scratchExists, true); }
      if (prediction.tier === 'native') { assert.equal(state.requests.length, 1); assert.deepEqual(state.unexpectedRequests, []); assert.deepEqual(state.requests[0].body.text.format.schema, schema); assert(state.children.some((entry) => path.resolve(entry.executable).toLowerCase() === path.resolve(nativeBinary).toLowerCase() && entry.exitCode === 0)); }
      else { assert.equal(state.requests.length, 0); assert.equal(state.listing.entries.length, 0); }
      row.status = 'PASS';
    } catch (e) { row.status = 'FAIL'; row.failure = { name: e.name, message: e.message, stack: e.stack }; }
    json('observations.partial.json', observations); console.log(`${row.status} ${row.id}: ${row.state?.outcome?.kind ?? 'setup failed'}`);
  }
} finally {
  observations.cleanup.push({ phase: 'before', owner, checkedWithin: ownerParent, createdExclusive: true, children: fs.readdirSync(owner) });
  const rel = path.relative(ownerParent, owner); assert(/^gg363q2-[a-f0-9]{10}$/.test(rel)); fs.rmSync(owner, { recursive: true, force: true }); observations.cleanup.push({ phase: 'after', ownerExists: fs.existsSync(owner) });
  assert.equal(JSON.stringify(Object.fromEntries(['TEMP', 'TMP', 'TMPDIR', 'CODEX_HOME'].map((key) => [key, process.env[key]]))), beforeEnv);
  assert.equal(git('status', '--porcelain=v1').toString(), ''); assert.equal(git('rev-parse', 'HEAD').toString().trim(), head);
  for (const [name, file] of Object.entries(sources)) assert.equal(hash(fs.readFileSync(file)), binding[name].sha256);
  assert.equal(hash(fs.readFileSync(oldManifest)), '49b577d1a6776ad8c0cd6ca429b5eeec9e70bd56984b03d738c88c4d6c552bc3');
  observations.final = { at: new Date().toISOString(), pass: observations.cases.filter((row) => row.status === 'PASS').length, fail: observations.cases.filter((row) => row.status === 'FAIL').length, executed: observations.cases.length, expected: 2, parentTempEnvUnchanged: true, checkoutClean: true, sourceUnchanged: true, fixtureOwnerRemoved: !fs.existsSync(owner), originalNegativePacketManifestUnchanged: true };
  json('observations.json', observations); console.log(JSON.stringify(observations.final)); process.exitCode = observations.final.fail || observations.final.executed !== 2 ? 1 : 0;
}

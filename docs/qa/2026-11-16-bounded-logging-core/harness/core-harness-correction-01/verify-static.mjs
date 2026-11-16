// Static source and admission check only. Neither V4 module is imported or evaluated.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const batch = await realpath(join(here, '..'));
const suite = join(batch, 'launcher-438-candidate-qa-preparation');
const runtime = join(batch, '..', '..', '.claude', 'codex-runs', 'GraphGoblin', 'runtime',
  'node-v22.23.4-win-x64', 'node.exe');
const SHA = /^[a-f0-9]{64}$/u;
const oldNativeSha = 'becbc4311c441e5b3472c0450ae76366452ca7c461f822361d465c37c4b79ece';
const controlsSha = '07b4670201aa225ed787fcfc549c4a6bc18f6498691317df66f212dff533b69e';
const originalSeal = '8f6b1ca1fc856f8e05bf7176c02e53cd7e0fa1023954e4ba49c82b0e11de3a4b';
const before = '  return { env, run, cim, closeStore };';
const after = '  return { env, run, runPowerShell, cim, closeStore };';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const [mode, manifestPin, admissionPath, admissionPin, ...extra] = process.argv.slice(2);
assert.equal(process.platform, 'win32');
assert.equal(process.version, 'v22.23.4');
assert.equal(await realpath(process.execPath), await realpath(runtime));
assert(!Object.keys(process.env).some((name) => name.toUpperCase() === 'NODE_OPTIONS'));
assert.deepEqual(process.execArgv, []);
assert.deepEqual(extra, []);
if (mode === '--proposal') assert.equal(process.argv.length, 3);
else assert(mode === '--applied' && SHA.test(manifestPin) && SHA.test(admissionPin),
  'Use --proposal or --applied <manifest SHA> <absolute admission JSON> <admission SHA>');

async function ordinary(path, expected) {
  assert.equal(await realpath(path), resolve(path), path);
  const stat = await lstat(path);
  assert(stat.isFile() && stat.nlink === 1, path);
  const bytes = await readFile(path);
  if (expected) assert.equal(digest(bytes), expected, path);
  return bytes;
}

const manifestPath = join(suite, 'SHA256SUMS.txt');
const manifest = await ordinary(manifestPath, mode === '--proposal' ? originalSeal : manifestPin);
const suiteRefs = new Map();
for (const row of manifest.toString('utf8').trimEnd().split(/\r?\n/u)) {
  const entry = /^([a-f0-9]{64})  ([a-zA-Z0-9.-]+)$/u.exec(row);
  assert(entry && !suiteRefs.has(entry[2]), 'Malformed or duplicate V4 manifest line');
  assert.notEqual(entry[2], '.');
  assert.notEqual(entry[2], '..');
  const refPath = join(suite, entry[2]);
  suiteRefs.set(entry[2], { sha256: entry[1], bytes: await ordinary(refPath, entry[1]) });
}
assert.equal(suiteRefs.size, 11);
assert.equal(suiteRefs.get('controls.mjs').sha256, controlsSha);
const nativeSource = suiteRefs.get('native.mjs').bytes.toString('utf8');
const controls = suiteRefs.get('controls.mjs').bytes;
let proposed;
if (mode === '--proposal') {
  assert.equal(digest(nativeSource), oldNativeSha);
  assert.equal(nativeSource.split(before).length, 2);
  proposed = nativeSource.replace(before, after);
} else {
  assert.equal(nativeSource.split(after).length, 2);
  assert.equal(digest(nativeSource.replace(after, before)), oldNativeSha, 'Installed native file has additional source edits');
  proposed = nativeSource;
}
const proposedSha = digest(proposed);
const exports = after.slice(after.indexOf('{') + 2, after.indexOf('}') - 1).split(', ');
assert(proposed.includes(after));
const calls = [...controls.toString('utf8').matchAll(/\bnative\.([a-zA-Z]\w*)\(/gu)].map((match) => match[1]);
assert.deepEqual(calls, ['runPowerShell', 'runPowerShell', 'run']);
for (const name of calls) assert(exports.includes(name), name);
assert.match(proposed, /async function runPowerShell\(label, source, options = \{\}\)/u);
assert.match(proposed, /childEnv: \{ \.\.\.env, \.\.\.options\.extraEnv \}, timeout: 9000, reapReadOnly: true, input: options\.input/u);
const example = JSON.parse(suiteRefs.get('admission.example.json').bytes);
const expectedNativeInExample = mode === '--proposal' ? oldNativeSha : proposedSha;
assert.equal(example.nativeModuleSha256, expectedNativeInExample);
const modulePins = {
  runnerSha256: 'run.mjs', controlsModuleSha256: 'controls.mjs', bindingModuleSha256: 'binding.mjs',
};
for (const [field, file] of Object.entries(modulePins)) assert.equal(example[field], suiteRefs.get(file).sha256);

let admitted;
if (mode === '--applied') {
  assert(isAbsolute(admissionPath) && resolve(admissionPath) === admissionPath);
  const rel = relative(batch, admissionPath);
  assert(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep));
  const admission = JSON.parse(await ordinary(admissionPath, admissionPin));
  assert.equal(admission.schema, 'gg438-native-candidate-admission/v4');
  assert.equal(admission.mode, 'candidate');
  assert.equal(admission.state, 'root-admitted');
  assert.match(admission.attempt, /^candidate-attempt-(?:[2-9]|[1-9][0-9]+)$/u);
  for (const [field, file] of Object.entries(modulePins)) assert.equal(admission[field], suiteRefs.get(file).sha256);
  assert.equal(admission.nativeModuleSha256, proposedSha);
  assert.deepEqual(admission.v4Manifest, { path: manifestPath, sha256: manifestPin });
  for (const sub of ['receipts', 'attempts'])
    await assert.rejects(lstat(join(suite, sub, admission.attempt)), { code: 'ENOENT' });
  admitted = { path: admissionPath, sha256: admissionPin, attempt: admission.attempt };
}

const syntax = [];
for (const [file, source] of [
  ['native.mjs', proposed], ['controls.mjs', controls], ['run.mjs', suiteRefs.get('run.mjs').bytes],
]) {
  const check = spawnSync(process.execPath, ['--input-type=module', '--check'], {
    input: source, encoding: 'utf8', windowsHide: true, timeout: 10_000,
  });
  assert.equal(check.error, undefined);
  assert.equal(check.signal, null);
  assert.equal(check.status, 0, file + ': ' + check.stderr);
  syntax.push({ file, exitCode: check.status });
}
console.log(JSON.stringify({
  schema: 'gg438-v4-control-api-static-readback/v1',
  mode, originalNativeSha256: oldNativeSha, correctedNativeSha256: proposedSha,
  verifiedSuiteManifestSha256: digest(manifest), verifiedManifestRows: suiteRefs.size,
  methods: exports, calls, syntax, ...(admitted ? { admitted } : {}),
  exercisedProduct: false, nativeAttempts: 0,
}, null, 2));


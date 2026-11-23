import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  realpathSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [checkout] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const helper = join(checkout, 'tooling', 'scripts', 'windows-launcher-evidence.mjs');
const { CASES, DIRECTORY_VARIABLE: dirVar, ID_VARIABLE: idVar, LIMITS,
  openWindowsLauncherEvidence } = await import(pathToFileURL(helper).href);
const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim();
const lab = mkdtempSync(join(realpathSync.native(tmpdir()), 'gg-i1-cli-qa-'));
const runner = join(lab, 'runner');
mkdirSync(runner);
const token = randomUUID().replaceAll('-', '');
const canary = (kind) => 'qa496-' + kind + '-' + token;
const safeEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  ['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'COMSPEC'].includes(key.toUpperCase())));
const release = {
  ownerVerified: true, release: 'drained-pid-listener-leases', releaseFailure: null,
};
const tool = { tool: 'node', mode: 'inline-script', outcome: 'exit-zero', exitCode: 0,
  errorCode: null, signal: null, killed: false, timeoutMs: null, elapsedMs: 1,
  stdoutBytes: 0, stderrBytes: 0, diagnostic: 'none' };
const outputKeys = (raw) => raw.split('\n')
  .filter((line) => /^(?:dir|id|status)=/.test(line))
  .map((line) => line.split(/=(.*)/s).slice(0, 2));
const pathsFor = (raw) => {
  const lines = raw.trimEnd().split('\n');
  const start = lines.findIndex((line) => line.startsWith('paths<<'));
  return start < 0 ? [] : lines.slice(start + 1, lines.indexOf(lines[start].slice(7), start + 1));
};
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
function processCall(command, env, extra = []) {
  const result = spawnSync(process.execPath, [helper, command, ...extra], {
    env: {...safeEnv, ...env}, cwd: checkout, encoding: 'utf8', timeout: 20000, windowsHide: true,
  });
  assert.ifError(result.error);
  return {code: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim()};
}
function initialize(name, override = {}) {
  const outputFile = join(lab, name + '.init');
  const env = {
    GITHUB_REPOSITORY: 'Jacob-J-Thomas/GraphGoblin',
    GITHUB_WORKFLOW_REF: 'Jacob-J-Thomas/GraphGoblin/.github/workflows/ci.yml@refs/heads/main',
    GITHUB_JOB: 'windows-launcher', GITHUB_RUN_ID: '90496', GITHUB_RUN_ATTEMPT: '2',
    GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: base,
    GG_TEST_EVIDENCE_EVENT_HEAD: base, RUNNER_OS: 'Windows', RUNNER_ARCH: 'X64',
    ImageVersion: '20261117.196.1', RUNNER_TEMP: runner, GITHUB_OUTPUT: outputFile, ...override,
  };
  const result = processCall('init', env);
  const outputs = existsSync(outputFile)
    ? Object.fromEntries(outputKeys(readFileSync(outputFile, 'utf8'))) : {};
  return {
    env, name, ...result, ...outputs,
    manifest: outputs.dir ? join(outputs.dir, 'manifest.json') : null,
    observations: outputs.dir ? join(outputs.dir, 'observations.ndjson') : null,
  };
}
function finalize(setup, state = 'success', override = {}) {
  const outputFile = join(lab, setup.name + '.final');
  const env = {
    ...setup.env, [dirVar]: setup.dir, [idVar]: setup.id, GITHUB_OUTPUT: outputFile,
    GG_TEST_EVIDENCE_INSTALL_OUTCOME: 'success', GG_TEST_EVIDENCE_BUILD_OUTCOME: 'success',
    GG_TEST_EVIDENCE_NATIVE_OUTCOME: state, ...override,
  };
  const result = processCall('finalize', env);
  const paths = existsSync(outputFile) ? pathsFor(readFileSync(outputFile, 'utf8')) : [];
  const statePath = join(setup.dir, 'result.json');
  const body = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null;
  return { ...result, paths, body };
}
function fresh(name) {
  const setup = initialize(name);
  assert.equal(setup.code, 0, setup.stderr);
  assert.ok(setup.dir && setup.id);
  return setup;
}
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const openRecord = (id, seq = 1) =>
  ({ seq, at: new Date().toISOString(), type: 'recorder-open', evidenceId: id });
const writeRecords = (file, records) =>
  writeFileSync(file, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
const claims = [];
const check = async (name, probe) => {
  try {
    const evidence = await probe();
    claims.push({name, pass: true, evidence});
  } catch (error) {
    claims.push({name, pass: false, error: error.message, evidence: error.details});
  }
};
const demand = (condition, message, details) => {
  if (!condition) throw Object.assign(new Error(message), { details });
};
const fileReceipt = (file) => ({ bytes: lstatSync(file).size, sha256: sha(file) });
async function recordComplete(setup, { duplicateTrials = false, duplicateAlias = false } = {}) {
  const env = { [dirVar]: setup.dir, RUNNER_TEMP: runner };
  let closer;
  const recorder = openWindowsLauncherEvidence({
    env, repoRoot: checkout, log: () => {}, onExit: (close) => { closer = close; },
  });
  assert.equal(recorder.state, 'recording');
  for (const label of CASES) {
    await recorder.observeTest(label, async () => {
      if (label !== 'lock-contention') recorder.record('child', { child: 1, ...tool });
      if (label === 'lock-contention') {
        for (const trial of [1, 2, 3])
          recorder.record('contention', {
            trial: duplicateTrials ? 1 : trial, contenders: 8, acquired: 1, refused: 7, other: 0,
          });
      }
      if (label === 'checkout-alias') {
        for (const kind of ['junction', 'dir']) {
          recorder.record('alias', { kind, observedLinkType: kind === 'junction' ? 'Junction' : 'SymbolicLink',
            reparsePoint: true, directory: true, targetMatched: true, failureStage: null,
            failureCode: null, disposition: 'unlinked', unlinkFailure: null });
          for (const spelling of ['direct', 'alias'])
            recorder.record('alias-round', { kind, spelling: duplicateAlias ? 'alias' : spelling, ...release });
        }
      }
    })();
  }
  closer();
}
await check('CLI arguments and init missing runner temp', () => {
  const extra = processCall('init', {}, ['unexpected']);
  const bad = processCall('init', {});
  assert.equal(extra.code, 2);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /runner-temp-missing/);
  return {extra, bad};
});
await check('init runner temp inside checkout / junction / glob', () => {
  const junction = join(lab, 'runner-junction');
  const glob = join(lab, 'glob[probe]');
  mkdirSync(glob);
  symlinkSync(runner, junction, 'junction');
  try {
    const results = [checkout, junction, glob].map((root, index) =>
      initialize('bad-init-' + index, { RUNNER_TEMP: root }));
    assert.deepEqual(results.map((result) => [result.code, result.dir]), [[1, undefined], [1, undefined], [1, undefined]]);
    return results.map(({code, stderr}) => ({code, stderr}));
  } finally {
    unlinkSync(junction);
  }
});
await check('exact CLI init manifest and complete supported suite', async () => {
  const setup = fresh('complete');
  const binding = read(setup.manifest).binding;
  assert.equal(binding.checkout.matchesSha, true);
  assert.equal(binding.checkout.headMatchesEventHead, true);
  assert.deepEqual(binding.unavailable, []);
  assert.equal(binding.runId, '90496');
  assert.equal(binding.runAttempt, '2');
  await recordComplete(setup);
  const out = finalize(setup);
  assert.equal(out.code, 0);
  assert.equal(out.body.status, 'complete');
  assert.deepEqual(out.body.missing, []);
  assert.deepEqual(out.paths, [setup.manifest, join(setup.dir, 'result.json'), setup.observations]);
  return {binding, members: out.paths.map(fileReceipt), records: out.body.observations.records};
});
await check('missing observation positive, failed and skipped native statuses remain distinct', () => {
  const outcomes = ['success', 'failure', 'skipped'].map((state) =>
    finalize(fresh('manifest-only-' + state), state));
  assert.deepEqual(outcomes.map((out) => [out.code, out.body.status, out.body.observations.state, out.paths.length]),
    [[1, 'incomplete', 'absent', 2], [0, 'native-failed', 'absent', 2], [0, 'not-run', 'absent', 2]]);
  return outcomes.map(({code, body, paths}) => ({code, status: body.status, uploaded: paths.length}));
});
await check('init refuses unrelated path and finalizer refuses bad ID', () => {
  const setup = fresh('mismatched-id');
  const out = finalize(setup, 'skipped', { [idVar]: randomUUID() });
  assert.equal(out.code, 1);
  assert.match(out.stderr, /unowned/);
  assert.deepEqual(out.paths, []);
  assert.equal(out.body, null);
  return out;
});
await check('unsafe files and unexpected entries never reach output', () => {
  const outside = join(lab, 'outside');
  const privateDir = join(lab, 'private-dir');
  mkdirSync(privateDir);
  writeFileSync(outside, canary('outside'));
  writeFileSync(join(privateDir, 'private.txt'), canary('linked-store'));
  const initial = sha(outside);
  const responses = [];
  for (const file of ['manifest.json', 'observations.ndjson']) {
    const setup = fresh('hardlink-' + file);
    const target = join(setup.dir, file);
    if (existsSync(target)) unlinkSync(target);
    linkSync(outside, target);
    try {
      const out = finalize(setup, 'failure');
      assert.equal(out.code, 1);
      assert.match(out.stderr, /hard-link/);
      assert.deepEqual(out.paths, []);
      assert.equal(out.body, null);
      responses.push({file, stderr: out.stderr});
    } finally {
      unlinkSync(target);
    }
  }
  const linked = fresh('linked-directory');
  symlinkSync(privateDir, linked.observations, 'junction');
  try {
    const out = finalize(linked, 'failure');
    assert.equal(out.code, 1);
    assert.match(out.stderr, /link/);
    assert.deepEqual(out.paths, []);
    responses.push({file: 'junction', stderr: out.stderr});
  } finally {
    unlinkSync(linked.observations);
  }
  const extra = fresh('extra-store');
  writeFileSync(join(extra.dir, 'private.sqlite'), canary('store'));
  const out = finalize(extra, 'failure');
  assert.equal(out.code, 1);
  assert.match(out.stderr, /unexpected-entry/);
  assert.deepEqual(out.paths, []);
  assert.equal(sha(outside), initial);
  return responses.concat({ file: 'extra-store', stderr: out.stderr, outsideHash: initial });
});
await check('malformed, duplicate-key, repeated sequence, truncated and oversized observations', () => {
  const verdicts = [];
  for (const scenario of ['bad-json', 'duplicate-key', 'repeated-sequence', 'truncated', 'oversized']) {
    const setup = fresh(scenario);
    const line = JSON.stringify(openRecord(setup.id));
    const payloads = {
      'bad-json': '{error' + canary('bad-json') + '\n',
      'duplicate-key': line.replace('{', '{"type":"' + canary('duplicate') + '",') + '\n',
      'repeated-sequence': [line, line, ''].join('\n'),
      'truncated': line,
      'oversized': Buffer.alloc(LIMITS.observationBytes + 1, 65),
    };
    writeFileSync(setup.observations, payloads[scenario]);
    const out = finalize(setup, 'failure');
    assert.equal(out.code, 1);
    assert.ok(!out.paths.includes(setup.observations));
    assert.ok(out.body === null || out.body.observations.state === 'rejected');
    verdicts.push({scenario, reason: out.body?.observations.reason ?? out.stderr, uploaded: out.paths.length});
  }
  return verdicts;
});
await check('manifest tampering rejects unknown fields and duplicate keys', () => {
  const outcomes = ['extra', 'duplicate'].map((mode) => {
    const setup = fresh('manifest-' + mode);
    const original = readFileSync(setup.manifest, 'utf8');
    writeFileSync(setup.manifest, mode === 'extra'
      ? original.replace('{', '{"path":"C:\\\\qa-private\\\\' + canary('manifest') + '",')
      : original.replace('{', '{"state":"' + canary('duplicate-manifest') + '",'));
    const out = finalize(setup, 'skipped');
    return {mode, code: out.code, status: out.body?.status, rawCanaryAllowed: out.paths.includes(setup.manifest),
      preflight: fileReceipt(setup.manifest), stderr: out.stderr};
  });
  demand(outcomes.every((out) => out.code !== 0 && !out.rawCanaryAllowed),
    'Tampered original manifest elected for upload', outcomes);
  return outcomes;
});
await check('wrong event head cannot be admitted as complete evidence', async () => {
  const setup = initialize('checkout-mismatch', { GG_TEST_EVIDENCE_EVENT_HEAD: '1'.repeat(40) });
  if (setup.code !== 0) return {initCode: setup.code, stderr: setup.stderr};
  await recordComplete(setup);
  const out = finalize(setup);
  const binding = read(setup.manifest).binding;
  demand(out.body?.status !== 'complete' || out.code !== 0,
    'Known wrong event head accepted as complete', {code: out.code, status: out.body?.status,
      headMatchesEventHead: binding.checkout.headMatchesEventHead, matchesSha: binding.checkout.matchesSha});
});
await check('one repeated contention trial cannot satisfy three trials', async () => {
  const setup = fresh('repeated-trials');
  await recordComplete(setup, {duplicateTrials: true});
  const out = finalize(setup);
  demand(out.body?.status !== 'complete' || out.code !== 0,
    'Three rows for trial 1 accepted as three distinct trials',
    {code: out.code, status: out.body?.status, counters: out.body?.observations.byType});
});
await check('one repeated alias spelling cannot satisfy both teardown paths', async () => {
  const setup = fresh('repeated-alias-rounds');
  await recordComplete(setup, {duplicateAlias: true});
  const out = finalize(setup);
  demand(out.body?.status !== 'complete' || out.code !== 0,
    'Repeated alias spellings accepted as alias plus direct release',
    {code: out.code, status: out.body?.status, counters: out.body?.observations.byType});
});
await check('byte canonicality rejects UTF-8 BOM prefix and duplicate recorder header', () => {
  const results = ['bom', 'duplicate-header'].map((scenario) => {
    const setup = fresh(scenario);
    const header = openRecord(setup.id);
    writeRecords(setup.observations, scenario === 'bom' ? [header] : [header, openRecord(setup.id, 2)]);
    if (scenario === 'bom') {
      writeFileSync(setup.observations,
        Buffer.concat([Buffer.from([239, 187, 191]), readFileSync(setup.observations)]));
    }
    const out = finalize(setup, 'failure');
    return {scenario, code: out.code, observations: out.body?.observations.state,
      retained: out.paths.includes(setup.observations)};
  });
  demand(results.every((result) => !result.retained), 'Noncanonical streams elected for upload', results);
  return results;
});
await check('real Node parent/child exit, no recorder path, typed output, symlink state and overflow', () => {
  const setup = fresh('native-control');
  const suite = join(lab, 'fixture.mjs');
  const fixture = join(lab, 'owned-Aa427b');
  const linked = join(fixture, 'alias-Aa427b');
  mkdirSync(fixture);
  const outside = join(lab, 'linked-canary');
  mkdirSync(outside);
  writeFileSync(join(outside, 'private.sqlite'), canary('linked'));
  symlinkSync(outside, linked, 'junction');
  const code = [
    "import { execFile } from 'node:child_process';",
    "import { test } from 'node:test';",
    "import { promisify } from 'node:util';",
    "import { openWindowsLauncherEvidence } from " + JSON.stringify(pathToFileURL(helper).href) + ";",
    "const record = openWindowsLauncherEvidence();",
    "const execute = record.observeExecFile(promisify(execFile));",
    "test('independent synthetic output and failed child', record.observeTest('installer', async () => {",
    "  record.fixture('alias-link', process.env.QA_LINK);",
    "  for(let row=0;row<1400;row++) record.record('child', {child:row, ...JSON.parse(process.env.QA_FIELDS)});",
    "  await execute(process.execPath, ['-e', " + JSON.stringify(
      "if (process.env." + dirVar + " !== undefined) process.exit(99); " +
      "process.stdout.write(process.env.QA_STDOUT); process.stderr.write(process.env.QA_ENV); process.exit(7)") + "]);",
    "}));",
  ].join('\n');
  writeFileSync(suite, code);
  try {
    const proc = spawnSync(process.execPath, ['--test', suite], {
      cwd: checkout, encoding: 'utf8', timeout: 20000, windowsHide: true, env: {
        ...safeEnv, RUNNER_TEMP: runner, [dirVar]: setup.dir, QA_LINK: linked,
        QA_STDOUT: canary('stdout'), QA_ENV: canary('env'), QA_FIELDS: JSON.stringify(tool),
      },
    });
    assert.ifError(proc.error);
    writeFileSync(join(here, 'synthetic-node-tap.log'), proc.stdout + proc.stderr);
    assert.equal(proc.status, 1);
    assert.match(proc.stdout, /"failureExit":7/);
    assert.match(proc.stdout, /"exitCode":7/);
    const out = finalize(setup, 'failure');
    assert.equal(out.code, 0, out.stderr);
    assert.equal(out.body.status, 'native-failed');
    assert.equal(out.body.observations.closed, true);
    assert.ok(out.body.observations.omittedRecords > 0);
    const observed = readFileSync(setup.observations, 'utf8').trimEnd().split('\n').map(JSON.parse);
    assert.equal(observed.filter((row) => row.type === 'overflow').length, 1);
    assert.ok(observed.some((row) => row.type === 'fixture-state' && row.state === 'link'));
    assert.ok(out.paths.every((file) => lstatSync(file).isFile() && lstatSync(file).nlink === 1));
    for (const file of out.paths) {
      assert.ok(!readFileSync(file, 'utf8').includes(token));
      assert.ok(!readFileSync(file, 'utf8').includes(lab));
    }
    return {testExit: proc.status, evidenceExit: out.code, state: out.body.status,
      observations: out.body.observations, evidenceFiles: out.paths.map(fileReceipt)};
  } finally {
    unlinkSync(linked);
  }
});
const summary = {
  node: process.version, source: {base, helper: fileReceipt(helper)}, fixtureRoot: lab,
  passed: claims.filter((item) => item.pass).length, total: claims.length, claims,
};
writeFileSync(join(here, 'cli-controls.json'), JSON.stringify(summary, null, 2) + '\n');
for (const claim of claims) console.log((claim.pass ? 'PASS ' : 'FAIL ') + claim.name);
console.log(summary.passed + '/' + summary.total);
process.exitCode = summary.passed === summary.total ? 0 : 1;


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
function instrument(setup, now) {
  const scopedEnv = {[dirVar]:setup.dir, RUNNER_TEMP:runner};
  let close;
  const rec = openWindowsLauncherEvidence({
    env:scopedEnv, repoRoot:checkout, log: () => {}, now,
    onExit: (callback) => {close = callback;},
  });
  assert.equal(rec.state, 'recording');
  return {rec, close};
}
await check('genuine overflow can count omitted rejections, but rejects a count beyond the sum', () => {
  const setup = fresh('genuine-overflow');
  const {rec, close} = instrument(setup);
  rec.record('invalid-first');
  for (let child = 1; child <= 1300; child++) {
    rec.record('child', {case:'installer', subtest:0, child, ...tool});
  }
  for (let index = 0; index < 4; index++) rec.record('invalid-after-overflow');
  close();
  const rows = readFileSync(setup.observations, 'utf8').trimEnd().split('\n').map(JSON.parse);
  const closer = rows.at(-1);
  assert.equal(closer.type, 'recorder-closed');
  assert.equal(closer.rejected, 5);
  const visible = rows.filter((row) => row.type === 'rejected').length;
  // A short rejection can still fit after the first overflow of a larger record.
  assert.ok(visible >= 1 && visible < closer.rejected);
  assert.equal(rows.filter((row) => row.type === 'overflow').length, 1);
  assert.ok(closer.omittedRecords >= closer.rejected - visible);
  const accepted = finalize(setup, 'failure');
  assert.equal(accepted.code, 0, accepted.stderr);
  assert.equal(accepted.body.status, 'native-failed');
  assert.equal(accepted.body.observations.state, 'valid');
  assert.equal(accepted.body.observations.rejected, visible);
  assert.equal(accepted.paths.length, 3);
  const bad = fresh('overclaim-above-total');
  rows[0].evidenceId = bad.id;
  const overclaim = visible + closer.omittedRecords + 1;
  rows[rows.length - 1].rejected = overclaim;
  writeRecords(bad.observations, rows);
  const denied = finalize(bad, 'failure');
  assert.equal(denied.code, 1);
  assert.equal(denied.body.status, 'native-failed');
  assert.equal(denied.body.observations.state, 'rejected');
  assert.equal(denied.body.observations.reason, 'lifecycle');
  assert.equal(denied.paths.length, 2);
  assert.ok(!denied.paths.includes(bad.observations));
  return {closerOmissions:closer.omittedRecords, accepted:{records:rows.length, closerRejected:5, visibleRejected:visible},
    denied:{overclaim, reason:denied.body.observations.reason, selectedFiles:denied.paths.length}};
});
const summary = {
  node: process.version, source: {base, helper: fileReceipt(helper)}, fixtureRoot: lab,
  passed: claims.filter((item) => item.pass).length, total: claims.length, claims,
};
writeFileSync(join(here, 'cli-controls.json'), JSON.stringify(summary, null, 2) + '\n');
for (const claim of claims) console.log((claim.pass ? 'PASS ' : 'FAIL ') + claim.name);
console.log(summary.passed + '/' + summary.total);
process.exitCode = summary.passed === summary.total ? 0 : 1;





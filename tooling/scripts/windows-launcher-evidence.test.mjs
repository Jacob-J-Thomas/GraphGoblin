import { test } from 'vitest';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  CASES,
  DIRECTORY_VARIABLE,
  EvidenceRefusal,
  FILES,
  ID_VARIABLE,
  LIMITS,
  Recorder,
  aliasStage,
  bindingRequirements,
  childFields,
  classifyDiagnostic,
  describeBinding,
  describeCommand,
  errorCodeOf,
  failureFields,
  finalizeEvidence,
  fixtureId,
  initializeEvidence,
  isExpectedOwnershipRefusal,
  main,
  missingRequirements,
  observeCheckout,
  openWindowsLauncherEvidence,
  parseManifest,
  parseObservations,
  pathState,
  readBounded,
  summarize,
  validateRecord,
  verifyEvidenceDirectory,
  writeOutputs,
} from './windows-launcher-evidence.mjs';

const helper = fileURLToPath(new URL('./windows-launcher-evidence.mjs', import.meta.url));
const execute = promisify(execFile);
// Preserve disposable fixture directories for inspection; no repository files are changed.
const temporary = (prefix = 'gg-496-evidence-') =>
  realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
const SHA = (digit) => digit.repeat(40);
const CANARY = 'GG_496_PRIVATE_CANARY_7f3a';
const github = {
  GITHUB_REPOSITORY: 'Jacob-J-Thomas/GraphGoblin',
  GITHUB_WORKFLOW_REF: 'Jacob-J-Thomas/GraphGoblin/.github/workflows/ci.yml@refs/pull/510/merge',
  GITHUB_JOB: 'windows-launcher',
  GITHUB_RUN_ID: '44200000001',
  GITHUB_RUN_ATTEMPT: '2',
  GITHUB_EVENT_NAME: 'pull_request',
  GITHUB_REF: 'refs/pull/510/merge',
  GITHUB_SHA: SHA('c'),
  GG_TEST_EVIDENCE_EVENT_HEAD: SHA('b'),
  GG_TEST_EVIDENCE_EVENT_BASE: SHA('a'),
  RUNNER_OS: 'Windows',
  RUNNER_ARCH: 'X64',
  ImageVersion: '20261111.196.1',
};
/** A shallow merge checkout: HEAD is the merge of the event head into the event base. */
const mergeGit = (args) =>
  args[0] === 'rev-parse'
    ? `${SHA('c')}\n`
    : `tree ${SHA('d')}\nparent ${SHA('a')}\nparent ${SHA('b')}\nauthor A <a@b> 1 +0000\n\n` +
      `Merge\nparent ${SHA('e')}\n`;
const refused = (reason) => (error) => {
  assert.ok(error instanceof EvidenceRefusal, String(error));
  assert.equal(error.reason, reason);
  return true;
};

function initialized(extra = {}) {
  const runnerTemp = temporary('gg-496-runner-');
  const env = { RUNNER_TEMP: runnerTemp, ...github, ...extra };
  const { directory, evidenceId, manifest } = initializeEvidence({ env, git: mergeGit });
  return { runnerTemp, directory, evidenceId, manifest, env };
}

function recorderFor({ runnerTemp, directory }, options = {}) {
  const env = { RUNNER_TEMP: runnerTemp, [DIRECTORY_VARIABLE]: directory };
  const log = [];
  let close;
  const recorder = openWindowsLauncherEvidence({
    env,
    log: (line) => log.push(line),
    onExit: (handler) => (close = handler),
    ...options,
  });
  return { recorder, env, log, close: () => close?.() };
}

/** A node:test-shaped context whose subtests run immediately. */
const context = () => ({
  name: 'fixture',
  test: (_name, body) => Promise.resolve(body?.(context())).catch(() => undefined),
});

/** Ordinary synthetic receipts with the same fields as the native contention trial. */
function passingContention(trial) {
  const seededToken = '00000000-0000-4000-8000-000000000001';
  const ownerToken = '00000000-0000-4000-8000-000000000002';
  const pid = 100 + trial * 10;
  return [
    ...Array.from({ length: 5 }, (_, index) => ({
      type: 'ownership-result',
      trial,
      pid: pid + index,
      status: index === 0 ? 'acquired' : 'refused',
      seededToken,
      ownerToken: index === 0 ? ownerToken : null,
      markerToken: null,
      operation: null,
      errorCode: null,
      diagnostic: index === 0 ? 'acquired' : index === 1 ? 'store-unverified' : 'store-held',
    })),
    { type: 'contention', trial, contenders: 5, acquired: 1, refused: 4, other: 0 },
    {
      type: 'ownership-check',
      trial,
      liveOwners: 1,
      recordedPid: pid,
      recordedToken: ownerToken,
      recordedOwnerMatched: true,
      seededMarker: 'absent',
    },
    {
      type: 'ownership-cleanup',
      trial,
      released: 1,
      main: 'absent',
      guard: 'absent',
      staging: 0,
      unrelatedIntact: true,
    },
  ];
}

/**
 * Every required observation of a passing native run, produced through the public API. Like the
 * real suite, lock contention spawns its contenders directly and has no observed `execFile` child.
 */
async function passingSuite(
  recorder,
  fixture,
  { trials = [1, 2, 3], spellings = ['alias', 'direct'], receipts = passingContention } = {},
) {
  const run = recorder.observeExecFile(() => Promise.resolve({ stdout: '', stderr: '' }));
  for (const name of CASES)
    await recorder.observeTest(name, async (t) => {
      recorder.fixture(name === 'bounded-logs' ? 'logs' : 'contention', fixture);
      if (name !== 'lock-contention')
        await run('C:\\Windows\\System32\\icacls.exe', ['x'], { timeout: 1000 });
      if (name === 'checkout-alias')
        for (const kind of ['junction', 'dir'])
          await t.test(kind, async () => {
            await run('C:\\a\\GraphGoblin.exe', ['--config', 'x', '--ensure-gateway']);
            for (const spelling of spellings)
              recorder.record('alias-round', {
                kind,
                spelling,
                ownerVerified: true,
                release: 'drained-pid-listener-leases',
                releaseFailure: null,
              });
            recorder.record('alias', {
              kind,
              observedLinkType: kind === 'dir' ? 'SymbolicLink' : 'Junction',
              reparsePoint: true,
              directory: true,
              targetMatched: true,
              failureStage: null,
              failureCode: null,
              disposition: 'unlinked',
              unlinkFailure: null,
            });
          });
      if (name === 'lock-contention')
        for (const trial of trials)
          for (const { type, ...fields } of receipts(trial)) recorder.record(type, fields);
    })(context());
}

const finalizeEnv = ({ runnerTemp, directory, evidenceId }, native = 'success') => ({
  RUNNER_TEMP: runnerTemp,
  [DIRECTORY_VARIABLE]: directory,
  [ID_VARIABLE]: evidenceId,
  GG_TEST_EVIDENCE_INSTALL_OUTCOME: 'success',
  GG_TEST_EVIDENCE_BUILD_OUTCOME: 'success',
  GG_TEST_EVIDENCE_NATIVE_OUTCOME: native,
});
const lines = (path) =>
  readFileSync(path, 'utf8')
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line));

test('expected ownership wording never accepts a structured filesystem or cleanup failure', () => {
  for (const error of [
    'another GraphGoblin process holds this store',
    'Store ownership could not be verified (malformed owner record)',
  ]) {
    const refusal = {
      status: 'refused',
      pid: 123,
      error,
      code: null,
      operation: null,
      markerToken: null,
      failures: [],
    };
    assert.equal(isExpectedOwnershipRefusal(refusal), true);
    for (const operation of ['recovery-marker-unlink', 'staging-marker-unlink']) {
      const compound = {
        ...refusal,
        error: `${error}; cleanup also failed`,
        failures: [{ code: 'EPERM', operation, markerToken: randomUUID() }],
      };
      const original = structuredClone(compound);
      assert.equal(isExpectedOwnershipRefusal(compound), false);
      assert.deepEqual(compound, original, 'the primary refusal and failure details survive');
    }
    for (const extra of [
      { status: 'acquired' },
      { error: null },
      { error: 'unexpected refusal' },
      { code: 'EPERM' },
      { operation: 'stale-marker-unlink' },
      { markerToken: randomUUID() },
      { failures: null },
    ])
      assert.equal(isExpectedOwnershipRefusal({ ...refusal, ...extra }), false);
  }
});

test('bounds keep the three flat files within 256 KiB', () => {
  assert.ok(
    LIMITS.manifestBytes + LIMITS.resultBytes + LIMITS.observationBytes <= LIMITS.totalBytes,
  );
  assert.deepEqual(Object.values(FILES).sort(), [
    'manifest.json',
    'observations.ndjson',
    'result.json',
  ]);
});

test('ownership failure and cleanup receipts retain only bounded identities and closed diagnostics', () => {
  const common = {
    seq: 2,
    at: '2026-11-20T06:00:00.000Z',
    case: 'lock-contention',
    subtest: 0,
    trial: 1,
  };
  const token = randomUUID();
  const records = [
    {
      ...common,
      type: 'ownership-result',
      pid: 123,
      status: 'refused',
      seededToken: token,
      ownerToken: null,
      markerToken: token,
      operation: 'stale-marker-unlink',
      errorCode: 'EPERM',
      diagnostic: 'filesystem',
    },
    {
      ...common,
      type: 'ownership-error',
      pid: 123,
      index: 0,
      operation: 'recovery-marker-unlink',
      code: 'EBUSY',
      markerToken: token,
    },
    {
      ...common,
      type: 'ownership-check',
      liveOwners: 1,
      recordedPid: 123,
      recordedToken: token,
      recordedOwnerMatched: true,
      seededMarker: 'absent',
    },
    {
      ...common,
      type: 'ownership-cleanup',
      released: 1,
      main: 'absent',
      guard: 'absent',
      staging: 0,
      unrelatedIntact: true,
    },
  ];
  for (const record of records) {
    assert.equal(validateRecord(record), true);
    assert.equal(validateRecord({ ...record, path: CANARY }), false);
  }
  assert.equal(validateRecord({ ...records[0], markerToken: CANARY }), false);
  assert.equal(validateRecord({ ...records[1], operation: CANARY }), false);
  assert.equal(validateRecord({ ...records[1], index: 8 }), false);
  const setup = initialized();
  const { recorder, close } = recorderFor(setup);
  for (const { seq: _seq, at: _at, type, ...fields } of records) recorder.record(type, fields);
  close();
  const retained = lines(join(setup.directory, FILES.observations));
  for (const record of records) assert.ok(retained.some((value) => value.type === record.type));
  assert.ok(!JSON.stringify(retained).includes(CANARY));
});

test('records validate only known types with exactly their typed fields', () => {
  const child = {
    seq: 4,
    at: '2026-11-17T19:16:23.257Z',
    type: 'child',
    case: 'launcher',
    subtest: 1,
    child: 2,
    tool: 'launcher',
    mode: 'ensure-gateway',
    outcome: 'exit-nonzero',
    exitCode: 1,
    errorCode: null,
    signal: null,
    killed: false,
    timeoutMs: 30_000,
    elapsedMs: 15_120,
    stdoutBytes: 0,
    stderrBytes: 180,
    diagnostic: 'startup-timeout',
  };
  assert.equal(validateRecord(child), true);
  for (const broken of [
    { ...child, diagnostic: CANARY },
    { ...child, errorCode: `E${'A'.repeat(70)}` },
    { ...child, extra: 1 },
    { ...child, seq: 0 },
    { ...child, at: 'yesterday' },
    { ...child, type: 'unknown' },
    { ...child, type: { toString: () => 'child' } },
    { ...child, exitCode: 1.5 },
    { ...child, killed: 'no' },
    Object.fromEntries(Object.entries(child).filter(([key]) => key !== 'signal')),
  ])
    assert.equal(validateRecord(broken), false);
  for (const value of [null, [], 'child', 4]) assert.equal(validateRecord(value), false);
});

test('child commands map to closed tool and mode names without copying arguments', () => {
  const cases = [
    [['C:\\W\\Microsoft.NET\\csc.exe', ['/out:x']], 'compiler', 'compile'],
    [['C:\\W\\powershell.exe', ['-EncodedCommand', CANARY]], 'powershell', 'encoded-script'],
    ['powershell.exe', 'powershell', 'script'],
    ['C:\\W\\System32\\icacls.exe', 'system-tool', 'acl'],
    ['C:\\W\\System32\\whoami.exe', 'system-tool', 'user'],
    [['C:\\i\\NativeChecks.exe', ['--bounded-log-checks']], 'native-checks', 'bounded-log-checks'],
    [
      ['C:\\i\\NativeChecks.exe', ['--cleanup-deadline-checks', CANARY]],
      'native-checks',
      'cleanup-deadline-checks',
    ],
    [
      ['C:\\i\\NativeChecks.exe', ['--work-deadline-checks', CANARY]],
      'native-checks',
      'work-deadline-checks',
    ],
    [['C:\\i\\NativeChecks.exe', ['C:\\x.exe', 'y.json']], 'native-checks', 'relaunch-checks'],
    [
      ['C:\\i\\GraphGoblin.exe', ['--config', CANARY, '--ensure-gateway']],
      'launcher',
      'ensure-gateway',
    ],
    [
      ['C:\\i\\fixture.exe', ['--ensure-gateway', '--stamp-shortcut']],
      'launcher',
      'stamp-shortcut',
    ],
    [['C:\\i\\fixture.exe', [CANARY]], 'launcher', 'other'],
    [
      ['C:\\n\\node.exe', ['--input-type=module', '-e', 's', 'file:///instance-identity.js']],
      'node',
      'module-import',
    ],
    [['/usr/bin/node', ['--input-type=module', '-e', CANARY]], 'node', 'inline-script'],
    [['node', ['x/instance-identity.js', '--store-state']], 'node', 'store-state'],
    [['node.exe', ['x/instance-identity.js']], 'node', 'identity'],
    [['node.exe', ['apps/api/dist/main.js']], 'node', 'gateway'],
    [['node.exe', 'not-an-array'], 'node', 'other'],
    ['git', 'other', 'other'],
  ];
  for (const [input, tool, mode] of cases) {
    const [file, args] = Array.isArray(input) ? input : [input, []];
    const described = describeCommand(file, args);
    assert.deepEqual(described, { tool, mode }, String(file));
    assert.doesNotMatch(JSON.stringify(described), /CANARY/);
  }
});

test('stderr becomes a closed diagnostic class and its text never leaves the classifier', () => {
  const known = {
    'GraphGoblin did not become ready within 15 seconds. Inspect gateway.log': 'startup-timeout',
    'Port 4830 belongs to an unrelated or differently configured service': 'foreign-listener',
    'The listening gateway does not belong to this startup attempt.': 'foreign-gateway',
    'another GraphGoblin process is acquiring this store; let its startup finish':
      'store-acquiring',
    'another GraphGoblin process holds this store; check its port': 'store-held',
    'The store is held or its ownership could not be verified': 'store-held',
    'Store ownership could not be verified (malformed or incomplete owner record)':
      'store-unverified',
    'Port 1 is occupied but the configured GraphGoblin gateway is not ready: x':
      'listener-not-ready',
    'GraphGoblin could not start because its log folder is in use: another': 'destination-in-use',
    'its log folder is unsafe or unavailable.': 'destination-unavailable',
    'could not load its application modules. A startup diagnostic was written':
      'import-failed-logged',
    'could not load its application modules, and no startup diagnostic': 'import-failed-unlogged',
    'GraphGoblin failed during startup. A startup diagnostic naming': 'startup-failed-logged',
    'GraphGoblin failed during startup, and no startup diagnostic': 'startup-failed-unlogged',
    'GraphGoblin exited during startup with an unrecognized status (exit code 9).': 'unknown-exit',
    'The read-only identity check exceeded its work budget.': 'helper-timeout',
    'Windows could not start an isolated launcher check.': 'helper-containment',
    'Windows could not confirm that all processes for this launcher check stopped. another GraphGoblin process holds this store':
      'helper-cleanup-unconfirmed',
    'The Node 22 runtime, launcher configuration or store ownership could not be checked.':
      'helper-refused',
    'The configured Node runtime could not be started.': 'helper-unavailable',
    'The ownership helper returned an invalid result.': 'helper-invalid',
    'The read-only launcher check returned an invalid or oversized response.': 'helper-invalid',
    'Could not establish whether port 4831 is free.': 'port-unknown',
    'The existing gateway is still releasing its store.': 'still-releasing',
    'Windows could not start the configured Node runtime for the gateway.': 'spawn-failed',
    'Another GraphGoblin launcher is still checking port 4830.': 'launch-busy',
    'The gateway answers but its built web app is unavailable.': 'gateway-incomplete',
    'The configured checkout is not built: apps/api/dist/windows-log/guard.js':
      'configuration-refused',
    'Launcher Environment must contain GG_* string overrides only.': 'configuration-refused',
    'Node was not found. Install Node 22': 'installer-refused',
    '#< CLIXML\r\n<Objs Version="1.1.0.1">': 'powershell-error-record',
  };
  for (const [stderr, diagnostic] of Object.entries(known))
    assert.equal(classifyDiagnostic(`${stderr} ${CANARY}`), diagnostic, stderr);
  assert.equal(classifyDiagnostic(`${CANARY} arbitrary output`), 'unclassified');
  assert.equal(classifyDiagnostic(Buffer.from('log folder is in use')), 'destination-in-use');
  assert.equal(classifyDiagnostic(''), 'none');
  assert.equal(classifyDiagnostic(undefined), 'unavailable');
  assert.equal(classifyDiagnostic(42), 'unavailable');
  // Only the first 4 KiB is inspected.
  assert.equal(classifyDiagnostic(`${'x'.repeat(4096)}log folder is in use`), 'unclassified');
});

test('child, failure, path and identifier projections keep only typed facts', () => {
  const description = { tool: 'launcher', mode: 'ensure-gateway' };
  const timedOut = Object.assign(new Error(CANARY), {
    code: null,
    signal: 'SIGTERM',
    killed: true,
    stdout: 'é',
    stderr: Buffer.from(CANARY),
  });
  assert.deepEqual(
    childFields({ ok: false, value: timedOut, description, timeout: 30_000, elapsedMs: 30_001.6 }),
    {
      ...description,
      outcome: 'signal',
      exitCode: null,
      errorCode: null,
      signal: 'SIGTERM',
      killed: true,
      timeoutMs: 30_000,
      elapsedMs: 30_002,
      stdoutBytes: 2,
      stderrBytes: CANARY.length,
      diagnostic: 'unclassified',
    },
  );
  const fields = (value, ok = false, timeout) =>
    childFields({ ok, value, description, timeout, elapsedMs: -5 });
  assert.equal(fields({ stdout: '', stderr: '' }, true).outcome, 'exit-zero');
  assert.equal(fields({ code: 0 }).outcome, 'exit-zero');
  assert.deepEqual(
    [fields({ code: 3221225477 }).outcome, fields({ code: 3221225477 }).exitCode],
    ['exit-nonzero', 3221225477],
  );
  assert.deepEqual(
    [fields({ code: 'ENOENT' }).outcome, fields({ code: 'ENOENT' }).errorCode],
    ['spawn-error', 'ENOENT'],
  );
  assert.equal(fields({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }).outcome, 'error');
  assert.deepEqual(
    [fields({ code: CANARY, signal: CANARY }).errorCode, fields({ code: CANARY }).signal],
    [null, null],
  );
  const hostile = new Proxy(
    {},
    {
      get() {
        throw new Error(CANARY);
      },
    },
  );
  const projected = fields(hostile, false, -1);
  assert.deepEqual(
    [projected.outcome, projected.timeoutMs, projected.elapsedMs, projected.stdoutBytes],
    ['error', null, 0, null],
  );
  assert.equal(projected.diagnostic, 'unavailable');

  const assertion = failureFields(Object.assign(new Error(CANARY), { code: 'ERR_ASSERTION' }));
  assert.deepEqual(assertion, {
    failureKind: 'assertion',
    failureCode: 'ERR_ASSERTION',
    failureExit: null,
    failureSignal: null,
  });
  assert.equal(failureFields({ name: 'AssertionError' }).failureKind, 'assertion');
  assert.deepEqual(failureFields({ code: 1 }), {
    failureKind: 'child-exit',
    failureCode: null,
    failureExit: 1,
    failureSignal: null,
  });
  assert.equal(failureFields({ code: null, signal: 'SIGTERM' }).failureKind, 'child-signal');
  assert.equal(failureFields({ code: 'EPERM' }).failureKind, 'system');
  assert.equal(failureFields(new Error(CANARY)).failureKind, 'other');
  assert.equal(failureFields(hostile).failureKind, 'other');
  assert.equal(failureFields(undefined, 2).failureKind, 'subtests');
  assert.equal(failureFields(undefined).failureKind, null);
  assert.equal(errorCodeOf({ code: 'EBUSY' }), 'EBUSY');
  assert.equal(errorCodeOf({ code: 'unknown' }), null);
  assert.equal(aliasStage('alias-cold-wrong-settings-config'), 'alias-cold-wrong-settings-config');
  assert.equal(aliasStage('direct-release'), 'direct-release');
  assert.equal(aliasStage(CANARY), 'unrecognized');
  assert.equal(aliasStage(undefined), 'unrecognized');

  assert.equal(fixtureId('C:\\repo\\.tmp\\windows-launcher-logs-lXI0me'), 'lXI0me');
  assert.equal(fixtureId('/tmp/junction-AbC123'), 'AbC123');
  assert.equal(fixtureId('/tmp/ab$def'), 'unrecognized');
  assert.equal(fixtureId('abcdef'), 'unrecognized');

  const root = temporary();
  const directory = join(root, 'directory');
  mkdirSync(directory);
  writeFileSync(join(root, 'file'), 'x');
  symlinkSync(directory, join(root, 'link'), 'junction');
  assert.deepEqual(pathState(directory), { state: 'directory', errorCode: null });
  assert.deepEqual(pathState(join(root, 'file')), { state: 'file', errorCode: null });
  assert.deepEqual(pathState(join(root, 'link')), { state: 'link', errorCode: null });
  assert.deepEqual(pathState(join(root, 'absent')), { state: 'absent', errorCode: null });
  assert.deepEqual(pathState(`${root}\0x`), {
    state: 'unavailable',
    errorCode: 'ERR_INVALID_ARG_VALUE',
  });
});

test('the evidence directory must be an owned canonical child of runner temp outside the checkout', () => {
  const { runnerTemp, directory } = initialized();
  assert.equal(verifyEvidenceDirectory(directory, runnerTemp), directory);
  assert.match(basename(directory), /^windows-launcher-evidence-[A-Za-z0-9]{6}$/);
  for (const path of [
    'relative/windows-launcher-evidence-abcdef',
    `${directory}*`,
    `${directory}\n`,
    7,
  ])
    assert.throws(() => verifyEvidenceDirectory(path, runnerTemp), refused('invalid-path'));
  assert.throws(
    () => verifyEvidenceDirectory(directory, undefined),
    refused('runner-temp-missing'),
  );
  assert.throws(
    () => verifyEvidenceDirectory(directory, 'relative'),
    refused('runner-temp-missing'),
  );
  const temporaryLink = join(temporary(), 'runner-temp-link');
  symlinkSync(runnerTemp, temporaryLink, 'junction');
  assert.throws(
    () => verifyEvidenceDirectory(directory, temporaryLink),
    refused('runner-temp-unsafe'),
  );
  assert.throws(
    () => verifyEvidenceDirectory(directory, join(directory, FILES.manifest)),
    refused('runner-temp-unsafe'),
  );
  assert.throws(
    () => verifyEvidenceDirectory(join(runnerTemp, 'windows-launcher-evidence-absent'), runnerTemp),
    refused('missing'),
  );
  const elsewhere = temporary();
  const linked = join(runnerTemp, 'windows-launcher-evidence-linked');
  symlinkSync(elsewhere, linked, 'junction');
  assert.throws(() => verifyEvidenceDirectory(linked, runnerTemp), refused('link'));
  const file = join(runnerTemp, 'windows-launcher-evidence-afile1');
  writeFileSync(file, 'x');
  assert.throws(() => verifyEvidenceDirectory(file, runnerTemp), refused('not-directory'));
  // A path through a linked ancestor is not the canonical evidence directory.
  assert.throws(
    () => verifyEvidenceDirectory(join(temporaryLink, basename(directory)), runnerTemp),
    refused('not-canonical'),
  );
  const outside = join(temporary(), 'windows-launcher-evidence-abcdef');
  mkdirSync(outside);
  assert.throws(() => verifyEvidenceDirectory(outside, runnerTemp), refused('outside-runner-temp'));
  const nested = join(directory, 'windows-launcher-evidence-nested');
  mkdirSync(nested);
  assert.throws(() => verifyEvidenceDirectory(nested, runnerTemp), refused('outside-runner-temp'));
  const misnamed = join(runnerTemp, '.windows-launcher-evidence-abcdef');
  mkdirSync(misnamed);
  assert.throws(() => verifyEvidenceDirectory(misnamed, runnerTemp), refused('unexpected-name'));
  assert.throws(
    () => verifyEvidenceDirectory(directory, runnerTemp, runnerTemp),
    refused('inside-checkout'),
  );
  mkdirSync(join(directory, 'checkout'));
  assert.throws(
    () => verifyEvidenceDirectory(directory, runnerTemp, join(directory, 'checkout')),
    refused('inside-checkout'),
  );
});

test('initialization binds the run and the shallow merge checkout and never records invalid values', () => {
  const { directory, manifest, evidenceId } = initialized();
  assert.deepEqual(readdirSync(directory), [FILES.manifest]);
  assert.equal(manifest.state, 'initialized');
  assert.match(evidenceId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(JSON.parse(readFileSync(join(directory, FILES.manifest), 'utf8')), manifest);
  const { binding } = manifest;
  assert.deepEqual(binding.unavailable, []);
  assert.deepEqual(
    [binding.runId, binding.runAttempt, binding.eventHead, binding.eventBase, binding.imageVersion],
    ['44200000001', '2', SHA('b'), SHA('a'), '20261111.196.1'],
  );
  assert.deepEqual(binding.checkout, {
    state: 'observed',
    head: SHA('c'),
    tree: SHA('d'),
    parents: [SHA('a'), SHA('b')],
    matchesSha: true,
    headMatchesEventHead: null,
    baseParentMatchesEventBase: true,
    headParentMatchesEventHead: true,
  });

  const hostile = initialized({
    GITHUB_REPOSITORY: `x/y ${CANARY}`,
    GITHUB_REF: `refs/heads/${CANARY}\n`,
    GG_TEST_EVIDENCE_EVENT_HEAD: CANARY,
    ImageVersion: undefined,
  });
  assert.doesNotMatch(readFileSync(join(hostile.directory, FILES.manifest), 'utf8'), /CANARY/);
  assert.deepEqual(hostile.manifest.binding.unavailable, [
    'repository',
    'ref',
    'eventHead',
    'imageVersion',
  ]);
  assert.equal(hostile.manifest.binding.checkout.headParentMatchesEventHead, null);

  const runnerTemp = temporary('gg-496-runner-');
  const push = initializeEvidence({
    env: {
      RUNNER_TEMP: runnerTemp,
      ...github,
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REF: 'refs/heads/main',
      GG_TEST_EVIDENCE_EVENT_HEAD: SHA('c'),
      GG_TEST_EVIDENCE_EVENT_BASE: '',
    },
    git: () => {
      throw new Error('git unavailable');
    },
  }).manifest.binding;
  assert.equal(push.eventBase, null);
  assert.deepEqual(push.unavailable, ['checkout']);
  assert.deepEqual(
    [push.checkout.state, push.checkout.matchesSha, push.checkout.headMatchesEventHead],
    ['unavailable', null, null],
  );
  const pushed = describeBinding(
    { ...github, GITHUB_EVENT_NAME: 'push', GG_TEST_EVIDENCE_EVENT_HEAD: SHA('c') },
    mergeGit,
  );
  assert.deepEqual(
    [pushed.checkout.headMatchesEventHead, pushed.checkout.baseParentMatchesEventBase],
    [true, null],
  );

  assert.deepEqual(
    observeCheckout(() => `tree ${SHA('d')}\n`).state,
    'unavailable',
    'a non-SHA head is unavailable',
  );
  assert.equal(
    observeCheckout((args) => (args[0] === 'rev-parse' ? SHA('c') : 'tree x\n')).state,
    'unavailable',
  );
  // The real repository checkout, including CI's shallow merge checkout, is observable.
  const real = initializeEvidence({ env: { RUNNER_TEMP: temporary('gg-496-runner-') } }).manifest;
  assert.equal(real.binding.checkout.state, 'observed');
  assert.match(real.binding.checkout.head, /^[0-9a-f]{40}$/);

  assert.throws(
    () => initializeEvidence({ env: { RUNNER_TEMP: runnerTemp }, repoRoot: runnerTemp }),
    refused('inside-checkout'),
  );
  assert.throws(() => initializeEvidence({ env: {} }), refused('runner-temp-missing'));
});

test('the recorder appends typed records, rejects invalid ones and never follows a planted file', async () => {
  const setup = initialized();
  const outside = join(temporary(), 'outside.txt');
  writeFileSync(outside, CANARY);
  const { recorder, env, log, close } = recorderFor(setup);
  assert.equal(recorder.state, 'recording');
  assert.equal(DIRECTORY_VARIABLE in env, false, 'the variable is removed before any child');
  assert.match(log[0], /"state":"recording"/);
  const fixture = temporary();
  await passingSuite(recorder, fixture);
  recorder.record('child', { case: 'launcher', subtest: 0, diagnostic: CANARY });
  recorder.record('not-a-type', { value: CANARY });
  recorder.record('cleanup', { action: 'gateway-drain', result: 'drained', count: null, seq: 9 });
  recorder.record('cleanup', { action: 'gateway-drain', result: 'drained', count: 10n });
  close();
  close();
  assert.equal(recorder.record('cleanup', {}), null, 'records after close are ignored');
  const path = join(setup.directory, FILES.observations);
  const text = readFileSync(path, 'utf8');
  assert.doesNotMatch(text, /CANARY/);
  const records = lines(path);
  assert.deepEqual(
    records.filter((record) => record.type === 'rejected').map((record) => record.recordType),
    ['child', 'unknown', 'cleanup', 'cleanup'],
  );
  assert.equal(records[0].type, 'recorder-open');
  assert.equal(records.at(-1).type, 'recorder-closed');
  assert.deepEqual(records.at(-1), {
    ...records.at(-1),
    written: records.length - 1,
    rejected: 4,
    omittedRecords: 0,
    omittedBytes: 0,
  });
  assert.ok(records.every((record) => validateRecord(record)));
  const states = records.filter((record) => record.type === 'fixture-state');
  assert.deepEqual(new Set(states.map((record) => record.state)), new Set(['directory']));
  assert.equal(readFileSync(outside, 'utf8'), CANARY);

  // A planted file or link at the observation name is refused, not opened for writing.
  for (const plant of ['hard-link', 'junction']) {
    const again = initialized();
    const target = join(again.directory, FILES.observations);
    if (plant === 'hard-link') linkSync(outside, target);
    else symlinkSync(temporary(), target, 'junction');
    const opened = recorderFor(again);
    assert.equal(opened.recorder.state, 'refused');
    assert.match(opened.log[0], /"state":"refused","reason":"exists"/);
  }
  assert.equal(readFileSync(outside, 'utf8'), CANARY);
});

test('the recorder is disabled without the variable and refuses unowned destinations', () => {
  const disabled = openWindowsLauncherEvidence({ env: {}, log: assert.fail });
  assert.equal(disabled.state, 'disabled');
  const empty = { [DIRECTORY_VARIABLE]: '' };
  assert.equal(openWindowsLauncherEvidence({ env: empty }).state, 'disabled');
  assert.equal(DIRECTORY_VARIABLE in empty, false);
  const reasons = [];
  const attempt = (env) =>
    openWindowsLauncherEvidence({
      env,
      log: (line) => reasons.push(JSON.parse(line).reason),
      onExit: () => undefined,
    }).state;

  const missing = initialized();
  const manifest = join(missing.directory, FILES.manifest);
  const original = readFileSync(manifest);
  const unowned = join(missing.runnerTemp, 'windows-launcher-evidence-zzzzzz');
  mkdirSync(unowned);
  assert.equal(
    attempt({ RUNNER_TEMP: missing.runnerTemp, [DIRECTORY_VARIABLE]: unowned }),
    'refused',
  );
  writeFileSync(join(unowned, FILES.manifest), `{"schema":"other","evidenceId":"${CANARY}"}`);
  assert.equal(
    attempt({ RUNNER_TEMP: missing.runnerTemp, [DIRECTORY_VARIABLE]: unowned }),
    'refused',
  );
  const invalid = join(missing.runnerTemp, 'windows-launcher-evidence-yyyyyy');
  mkdirSync(invalid);
  writeFileSync(join(invalid, FILES.manifest), Buffer.from([0xff, 0xfe]));
  assert.equal(
    attempt({ RUNNER_TEMP: missing.runnerTemp, [DIRECTORY_VARIABLE]: invalid }),
    'refused',
  );
  const linked = join(missing.runnerTemp, 'windows-launcher-evidence-xxxxxx');
  mkdirSync(linked);
  linkSync(manifest, join(linked, FILES.manifest));
  assert.equal(
    attempt({ RUNNER_TEMP: missing.runnerTemp, [DIRECTORY_VARIABLE]: linked }),
    'refused',
  );
  assert.equal(
    attempt({ RUNNER_TEMP: missing.runnerTemp, [DIRECTORY_VARIABLE]: temporary() }),
    'refused',
  );
  const owned = initialized();
  assert.equal(
    attempt({ RUNNER_TEMP: owned.runnerTemp, [DIRECTORY_VARIABLE]: owned.directory }),
    'recording',
  );
  assert.deepEqual(reasons, [
    'manifest-missing',
    'manifest-invalid',
    'manifest-invalid',
    'hard-link',
    'outside-runner-temp',
    undefined,
  ]);
  assert.deepEqual(readFileSync(manifest), original);
});

test('capacity overflow is reported once and the closing records still fit', () => {
  const setup = initialized();
  const { recorder, close } = recorderFor(setup);
  const fixture = temporary();
  for (let index = 0; index < 13; index++) recorder.fixture('logs', fixture);
  for (let index = 0; index < LIMITS.records + 50; index++)
    recorder.record('cleanup', {
      case: 'bounded-logs',
      subtest: 1,
      action: 'gateway-drain',
      result: 'drained',
      count: null,
    });
  close();
  const path = join(setup.directory, FILES.observations);
  const records = lines(path);
  const overflow = records.filter((record) => record.type === 'overflow');
  assert.equal(overflow.length, 1);
  const closed = records.at(-1);
  assert.equal(closed.type, 'recorder-closed');
  assert.ok(closed.omittedRecords > 50 && closed.omittedBytes > 0);
  assert.equal(closed.written, records.length - 1);
  assert.equal(records.filter((record) => record.type === 'fixture-state').length, 12);
  assert.ok(records.length <= LIMITS.records);
  assert.ok(statSync(path).size <= LIMITS.observationBytes);
  const outcome = finalizeEvidence({ env: finalizeEnv(setup) });
  assert.equal(outcome.status, 'incomplete');
  assert.ok(outcome.result.missing.includes('records-omitted'));
  const total = readdirSync(setup.directory).reduce(
    (sum, name) => sum + statSync(join(setup.directory, name)).size,
    0,
  );
  assert.ok(total <= LIMITS.totalBytes, `${total} bytes`);
});

test('a write failure stops recording with one marker and never throws into the suite', () => {
  // An invalid descriptor fails validation before any system call can reach another file.
  const log = [];
  let recorder;
  assert.doesNotThrow(() => {
    recorder = new Recorder({
      fd: -1,
      state: 'recording',
      log: (line) => log.push(line),
      evidenceId: randomUUID(),
    });
  });
  assert.equal(recorder.state, 'write-failed');
  assert.deepEqual(JSON.parse(log[0]), {
    evidence: 'windows-launcher-export',
    state: 'write-failed',
    errorCode: 'ERR_OUT_OF_RANGE',
  });
  recorder.record('cleanup', {
    case: 'launcher',
    subtest: 0,
    action: 'gateway-drain',
    result: 'drained',
    count: null,
  });
  recorder.close();
  assert.equal(log.length, 1);
});

test('real child processes are observed by exit, signal and spawn error with byte counts only', async () => {
  const setup = initialized();
  const { recorder, close } = recorderFor(setup);
  const run = recorder.observeExecFile(execute);
  const settled = [];
  await recorder.observeTest('launcher', async () => {
    const ok = run(process.execPath, ['-e', `process.stdout.write(${JSON.stringify(CANARY)})`]);
    assert.equal(typeof ok.child?.pid, 'number', 'the original promise is returned');
    settled.push(await ok);
    const failing = run(process.execPath, [
      '-e',
      `process.stderr.write(${JSON.stringify(CANARY)}); process.exit(3)`,
    ]);
    await assert.rejects(failing, (error) => error.code === 3 && error.stderr === CANARY);
    await assert.rejects(
      run(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { timeout: 300 }),
      (error) => error.killed === true,
    );
    await assert.rejects(run(join(temporary(), 'missing-gg-binary'), []), { code: 'ENOENT' });
  })(context());
  close();
  assert.equal(settled[0].stdout, CANARY, 'callers still receive the full output');
  const children = lines(join(setup.directory, FILES.observations)).filter(
    (record) => record.type === 'child',
  );
  assert.deepEqual(
    children.map((record) => [
      record.child,
      record.outcome,
      record.exitCode,
      record.signal,
      record.killed,
    ]),
    [
      [1, 'exit-zero', 0, null, false],
      [2, 'exit-nonzero', 3, null, false],
      [3, 'signal', null, 'SIGTERM', true],
      [4, 'spawn-error', null, null, false],
    ],
  );
  assert.deepEqual(children.map((record) => [record.stdoutBytes, record.stderrBytes]).slice(0, 2), [
    [CANARY.length, 0],
    [0, CANARY.length],
  ]);
  assert.equal(children[2].timeoutMs, 300);
  assert.equal(children[1].diagnostic, 'unclassified');
});

test('test outcomes record subtests, failures and markers while preserving the thrown error', async () => {
  const setup = initialized();
  const { recorder, log, close } = recorderFor(setup);
  const run = recorder.observeExecFile((file) =>
    file === 'fail.exe'
      ? Promise.reject(
          Object.assign(new Error(CANARY), { code: 1, stderr: 'log folder is in use' }),
        )
      : Promise.resolve({ stdout: '', stderr: '' }),
  );
  await recorder.observeTest('bounded-logs', async (t) => {
    assert.equal(t.name, 'fixture', 'other context members are forwarded');
    await t.test('passes', async () => run('ok.exe', []));
    await t.test('fails', async () => {
      await run('fail.exe', ['--ensure-gateway']).catch(() => undefined);
      assert.equal(1, 2);
    });
    await t.test('no body');
  })(context());
  const thrown = new Error(CANARY);
  await assert.rejects(
    recorder.observeTest('installer', async () => {
      throw thrown;
    })(),
    (error) => error === thrown,
  );
  // A thrown non-error is still a typed failure, never a failing record without a kind.
  await assert.rejects(
    recorder.observeTest('launcher', async () => {
      throw undefined;
    })(),
    (error) => error === undefined,
  );
  close();
  const records = lines(join(setup.directory, FILES.observations));
  assert.equal(records.filter((record) => record.type === 'rejected').length, 0);
  const ends = records.filter((record) => record.type === 'case-end');
  assert.deepEqual(
    ends.map((record) => [record.case, record.subtest, record.result, record.failureKind]),
    [
      ['bounded-logs', 1, 'pass', null],
      ['bounded-logs', 2, 'fail', 'assertion'],
      ['bounded-logs', 0, 'fail', 'subtests'],
      ['installer', 0, 'fail', 'other'],
      ['launcher', 0, 'fail', 'other'],
    ],
  );
  assert.equal(ends[2].failedSubtests, 1);
  const markers = log.filter((line) => line.includes('windows-launcher-observation'));
  assert.equal(markers.length, 5, 'failed ends plus the last child of the failed subtest');
  assert.match(markers[1], /"diagnostic":"destination-in-use"/);
  assert.doesNotMatch(
    log.join('\n') + readFileSync(join(setup.directory, FILES.observations)),
    /CANARY/,
  );
  const child = records.find((record) => record.type === 'child' && record.subtest === 2);
  assert.deepEqual([child.exitCode, child.mode], [1, 'ensure-gateway']);
});

test('a real node:test suite records through process exit and keeps its failing exit', () => {
  const setup = initialized();
  const suite = join(temporary(), 'evidence.acceptance.mjs');
  const fixture = temporary();
  writeFileSync(
    suite,
    `import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { openWindowsLauncherEvidence } from ${JSON.stringify(pathToFileURL(helper).href)};
const evidence = openWindowsLauncherEvidence();
const execute = evidence.observeExecFile(promisify(execFile));
test('installer', evidence.observeTest('installer', async (t) => {
  evidence.fixture('installer', ${JSON.stringify(fixture)});
  await t.test('child cannot see the evidence variable', async () => {
    await execute(process.execPath, ['-e', 'process.exit(process.env.${DIRECTORY_VARIABLE} === undefined ? 0 : 9)']);
  });
  await t.test('failing child', async () => {
    await execute(process.execPath, ['-e', 'process.stderr.write(process.env.GG_ENV_CANARY); process.exit(5)']);
  });
}));
test('logs', evidence.observeTest('bounded-logs', async () => {
  console.log(process.env.GG_ENV_CANARY);
  assert.equal(1, 2);
}));
`,
  );
  const run = (extra) =>
    spawnSync(process.execPath, ['--test', suite], {
      encoding: 'utf8',
      timeout: 60_000,
      windowsHide: true,
      env: { ...process.env, GG_ENV_CANARY: CANARY, ...extra },
    });
  const recorded = run({ RUNNER_TEMP: setup.runnerTemp, [DIRECTORY_VARIABLE]: setup.directory });
  assert.equal(recorded.status, 1, recorded.stderr);
  assert.match(recorded.stdout, /# fail 3/);
  assert.match(
    recorded.stdout,
    /windows-launcher-observation.*"case":"installer".*"result":"fail"/,
  );
  const path = join(setup.directory, FILES.observations);
  assert.doesNotMatch(readFileSync(path, 'utf8'), /CANARY/);
  const records = lines(path);
  assert.equal(records.at(-1).type, 'recorder-closed', 'the exit handler closed the file');
  const children = records.filter((record) => record.type === 'child');
  assert.deepEqual(
    children.map((record) => [record.subtest, record.exitCode]),
    [
      [1, 0],
      [2, 5],
    ],
  );
  assert.equal(children[1].stderrBytes, CANARY.length);
  assert.deepEqual(
    records
      .filter((record) => record.type === 'fixture-state')
      .map((record) => [record.kind, record.state]),
    [['installer', 'directory']],
  );
  const outcome = finalizeEvidence({ env: finalizeEnv(setup, 'failure') });
  assert.equal(outcome.status, 'native-failed');
  assert.equal(outcome.exitCode, 0, 'the native step already carries the failure');
  assert.equal(outcome.result.cases.installer.result, 'fail');
  assert.equal(outcome.result.cases['bounded-logs'].result, 'fail');
  assert.equal(outcome.upload.length, 3);

  // The ordinary local command needs no evidence directory and keeps the same result.
  const local = run({});
  assert.equal(local.status, 1, local.stderr);
  assert.match(local.stdout, /# fail 3/);
  assert.doesNotMatch(local.stdout, /"state":"(?:recording|refused)"/);
});

test('finalize distinguishes complete, incomplete, failed and not-run evidence', async () => {
  const complete = initialized();
  const { recorder, close } = recorderFor(complete);
  await passingSuite(recorder, temporary());
  close();
  const outcome = finalizeEvidence({ env: finalizeEnv(complete) });
  assert.deepEqual([outcome.status, outcome.exitCode, outcome.result.missing], ['complete', 0, []]);
  assert.deepEqual(
    outcome.upload,
    [FILES.manifest, FILES.result, FILES.observations].map((name) =>
      join(complete.directory, name),
    ),
  );
  const result = JSON.parse(readFileSync(join(complete.directory, FILES.result), 'utf8'));
  assert.deepEqual(result, outcome.result);
  assert.deepEqual(result.steps, { install: 'success', build: 'success', native: 'success' });
  assert.throws(
    () => finalizeEvidence({ env: finalizeEnv(complete) }),
    refused('unexpected-entry'),
    'a second finalize never overwrites the result',
  );

  const manifestOnly = initialized();
  const incomplete = finalizeEvidence({ env: finalizeEnv(manifestOnly) });
  assert.deepEqual(
    [incomplete.status, incomplete.exitCode, incomplete.result.missing],
    ['incomplete', 1, ['observations-absent']],
  );
  assert.equal(incomplete.upload.length, 2);
  assert.equal(finalizeEvidence({ env: finalizeEnv(initialized(), 'skipped') }).status, 'not-run');
  assert.equal(
    finalizeEvidence({ env: finalizeEnv(initialized(), 'cancelled') }).status,
    'native-failed',
  );
  const unknown = finalizeEvidence({ env: finalizeEnv(initialized(), CANARY) });
  assert.deepEqual([unknown.status, unknown.result.steps.native], ['incomplete', 'unknown']);

  // A partial recording (process killed before close) uploads truthfully as unfinished.
  const partial = initialized();
  const open = recorderFor(partial);
  await open.recorder.observeTest('launcher', async () => undefined)(context());
  const killed = finalizeEvidence({ env: finalizeEnv(partial, 'failure') });
  assert.equal(killed.status, 'native-failed');
  assert.equal(killed.result.observations.closed, false);
  assert.equal(killed.upload.length, 3);
  const passedWithoutClose = initialized();
  const unclosed = recorderFor(passedWithoutClose);
  await passingSuite(unclosed.recorder, temporary());
  assert.deepEqual(finalizeEvidence({ env: finalizeEnv(passedWithoutClose) }).result.missing, [
    'recorder-closed',
    'fixture-states',
  ]);
});

test('complete contention evidence needs every contender, live owner match and final cleanup', async () => {
  const change = (type, fields) => (rows) =>
    rows.map((row) => (row.type === type ? { ...row, ...fields } : row));
  const scenarios = [
    ['totals only', (rows) => rows.filter((row) => row.type === 'contention')],
    ['missing contender', (rows) => rows.slice(1)],
    ['duplicate contender', change('ownership-result', { pid: 123 })],
    ['different seed', (rows) => [{ ...rows[0], seededToken: randomUUID() }, ...rows.slice(1)]],
    ['missing owner token', change('ownership-result', { ownerToken: null })],
    ['filesystem code', change('ownership-result', { errorCode: 'EPERM' })],
    ['filesystem operation', change('ownership-result', { operation: 'stale-marker-unlink' })],
    ['marker failure', change('ownership-result', { markerToken: randomUUID() })],
    ['unexpected diagnostic', change('ownership-result', { diagnostic: 'other' })],
    ['missing owner check', (rows) => rows.filter((row) => row.type !== 'ownership-check')],
    [
      'duplicate owner check',
      (rows) => [...rows, rows.find((row) => row.type === 'ownership-check')],
    ],
    ['wrong case', change('ownership-check', { case: 'launcher', subtest: 0 })],
    ['wrong subtest', change('ownership-check', { subtest: 1 })],
    ['wrong trial', change('ownership-check', { trial: 4 })],
    ['owner not live', change('ownership-check', { liveOwners: 0 })],
    ['owner not matched', change('ownership-check', { recordedOwnerMatched: false })],
    ['different owner PID', change('ownership-check', { recordedPid: 999 })],
    ['different owner token', change('ownership-check', { recordedToken: randomUUID() })],
    ['seeded marker remains', change('ownership-check', { seededMarker: 'present' })],
    ['missing cleanup', (rows) => rows.filter((row) => row.type !== 'ownership-cleanup')],
    ['not released', change('ownership-cleanup', { released: 0 })],
    ['main remains', change('ownership-cleanup', { main: 'present' })],
    ['guard remains', change('ownership-cleanup', { guard: 'present' })],
    ['staging remains', change('ownership-cleanup', { staging: 1 })],
    ['unrelated file changed', change('ownership-cleanup', { unrelatedIntact: false })],
  ];
  for (const [name, alter] of scenarios) {
    const setup = initialized();
    const { recorder, close } = recorderFor(setup);
    await passingSuite(recorder, temporary(), {
      receipts: (trial) =>
        trial === 1 ? alter(passingContention(trial)) : passingContention(trial),
    });
    close();
    const outcome = finalizeEvidence({ env: finalizeEnv(setup) });
    assert.deepEqual(
      [outcome.status, outcome.exitCode, outcome.result.observations.state, outcome.result.missing],
      ['incomplete', 1, 'valid', ['contention-trials']],
      name,
    );
    assert.equal(outcome.upload.length, 3, name);
  }
});

test('structured cleanup failures remain readable and downloadable with the native failure', async () => {
  for (const native of ['success', 'failure']) {
    const setup = initialized();
    const { recorder, close } = recorderFor(setup);
    await passingSuite(recorder, temporary(), {
      receipts: (trial) => [
        ...passingContention(trial),
        {
          type: 'ownership-error',
          trial,
          pid: 100 + trial * 10 + 1,
          index: 0,
          operation: 'recovery-marker-unlink',
          code: 'EPERM',
          markerToken: randomUUID(),
        },
      ],
    });
    close();
    const original = readFileSync(join(setup.directory, FILES.observations));
    const outcome = finalizeEvidence({ env: finalizeEnv(setup, native) });
    assert.deepEqual(
      [outcome.status, outcome.exitCode, outcome.result.observations.state, outcome.result.missing],
      [
        native === 'success' ? 'incomplete' : 'native-failed',
        native === 'success' ? 1 : 0,
        'valid',
        ['contention-trials'],
      ],
    );
    assert.equal(outcome.upload.length, 3);
    assert.deepEqual(readFileSync(join(setup.directory, FILES.observations)), original);
  }
});

test('required observations name every missing case, alias, contention and fixture state', () => {
  const missing = missingRequirements(
    summarize([
      { seq: 1, type: 'case-start', case: 'launcher', subtest: 0 },
      { seq: 2, type: 'case-start', case: 'launcher', subtest: 1 },
      { seq: 3, type: 'case-end', case: 'launcher', subtest: 1, result: 'fail' },
      { seq: 4, type: 'case-end', case: 'launcher', subtest: 0, result: 'fail' },
      { seq: 5, type: 'child', case: 'launcher', outcome: 'exit-nonzero' },
      { seq: 6, type: 'fixture', kind: 'logs', fixture: 'abcdef' },
      {
        seq: 7,
        type: 'alias',
        kind: 'dir',
        targetMatched: true,
        disposition: 'retained-release-unverified',
      },
      { seq: 8, type: 'alias-round', kind: 'dir', release: 'failed' },
      { seq: 9, type: 'contention', acquired: 2 },
      { seq: 10, type: 'rejected', recordType: 'child' },
    ]),
  );
  for (const name of [
    'recorder-closed',
    'records-rejected',
    'installer-start',
    'installer-pass',
    'installer-children',
    'launcher-pass',
    'launcher-subtests',
    'alias-junction',
    'alias-dir',
    'alias-dir-release',
    'contention-trials',
    'fixture-states',
  ])
    assert.ok(missing.includes(name), name);
  for (const name of ['launcher-start', 'launcher-children', 'lock-contention-children'])
    assert.ok(!missing.includes(name), name);
  assert.ok(missing.includes('lock-contention-start') && missing.includes('bounded-logs-children'));
});

test('invalid observation bytes are rejected whole and never uploaded', () => {
  const evidenceId = '0d4f8c56-8f43-4b52-9b77-4fd1a9c2d001';
  const open = `{"seq":1,"at":"2026-11-17T19:16:23.257Z","type":"recorder-open","evidenceId":"${evidenceId}"}`;
  const cleanup = (seq) =>
    `{"seq":${seq},"at":"2026-11-17T19:16:23.257Z","type":"cleanup","case":"launcher","subtest":0,"action":"gateway-drain","result":"drained","count":null}`;
  const cases = {
    encoding: Buffer.concat([Buffer.from(`${open}\n`), Buffer.from([0xff, 0x0a])]),
    // A byte-order mark carries no data, but it is not the recorder's canonical output.
    'byte-order-mark': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`${open}\n`)]),
    'incomplete-line': `${open}\n${cleanup(2)}`,
    'too-many-records': `${open}\n${cleanup(2)}\n`.repeat(LIMITS.records),
    'oversized-record': `${open}\n${'x'.repeat(LIMITS.recordBytes)}\n`,
    'malformed-record': `${open}\n${CANARY}\n`,
    'invalid-record': `${open}\n${cleanup(2).replace('"type":"cleanup"', `"type":"${CANARY}","type":"cleanup"`)}\n`,
    'out-of-order': `${open}\n${cleanup(3)}\n${cleanup(2)}\n`,
    unbound: `${cleanup(1)}\n`,
  };
  for (const [reason, content] of Object.entries(cases))
    assert.deepEqual(
      parseObservations(Buffer.from(content), evidenceId),
      { state: 'rejected', reason, records: [] },
      reason,
    );
  assert.equal(parseObservations(Buffer.from(''), evidenceId).reason, 'unbound');
  assert.equal(parseObservations(Buffer.from(`${open}\n`), evidenceId).state, 'valid');
  // Whitespace changes keep the parsed value but are not the recorder's canonical bytes.
  assert.equal(
    parseObservations(Buffer.from(`${open}\n${cleanup(2).replace(',', ', ')}\n`), evidenceId)
      .reason,
    'invalid-record',
  );

  const setup = initialized();
  writeFileSync(
    join(setup.directory, FILES.observations),
    `{"seq":1,"at":"2026-11-17T19:16:23.257Z","type":"recorder-open","evidenceId":"${setup.evidenceId}"}\n${CANARY}\n`,
  );
  const outcome = finalizeEvidence({ env: finalizeEnv(setup) });
  assert.deepEqual(
    [outcome.status, outcome.exitCode, outcome.result.observations.state],
    ['incomplete', 1, 'rejected'],
  );
  assert.ok(!outcome.upload.some((path) => path.endsWith(FILES.observations)));
  assert.doesNotMatch(readFileSync(join(setup.directory, FILES.result), 'utf8'), /CANARY/);
  const failed = initialized();
  writeFileSync(join(failed.directory, FILES.observations), `${CANARY}\n`);
  assert.deepEqual(
    [finalizeEvidence({ env: finalizeEnv(failed, 'failure') }).exitCode],
    [1],
    'rejected bytes fail even when the native step already failed',
  );
});

test('finalize refuses links, hard links, oversized and unowned files without writing or following', () => {
  const outside = join(temporary(), 'outside-store.db');
  writeFileSync(outside, CANARY);
  const check = (prepare, reason, native = 'success') => {
    const setup = initialized();
    const env = finalizeEnv(setup, native);
    prepare(setup, env);
    const result = join(setup.directory, FILES.result);
    const planted = existsSync(result) ? readFileSync(result) : null;
    assert.throws(() => finalizeEvidence({ env }), refused(reason));
    // Nothing is written: no result appears and a planted one keeps its bytes.
    assert.deepEqual(existsSync(result) ? readFileSync(result) : null, planted, reason);
  };
  check(({ directory }) => linkSync(outside, join(directory, FILES.observations)), 'hard-link');
  check(
    ({ directory }) => symlinkSync(temporary(), join(directory, FILES.observations), 'junction'),
    'link',
  );
  check(({ directory }) => mkdirSync(join(directory, FILES.observations)), 'not-file');
  check(
    ({ directory }) =>
      writeFileSync(join(directory, FILES.observations), 'x'.repeat(LIMITS.observationBytes + 1)),
    'oversized',
  );
  check(
    ({ directory }) => writeFileSync(join(directory, 'gateway.log'), CANARY),
    'unexpected-entry',
  );
  check(({ directory }) => writeFileSync(join(directory, FILES.result), '{}'), 'unexpected-entry');
  check((_setup, env) => {
    env[ID_VARIABLE] = randomUUID();
  }, 'unowned');
  check((_setup, env) => {
    env[DIRECTORY_VARIABLE] = temporary();
  }, 'outside-runner-temp');
  check((_setup, env) => {
    delete env[DIRECTORY_VARIABLE];
  }, 'invalid-path');
  assert.equal(readFileSync(outside, 'utf8'), CANARY);
  assert.equal(readBounded(join(temporary(), 'absent'), 10), null);
});

test('step outputs use a random delimiter for multi-line paths', () => {
  const output = join(temporary(), 'output');
  writeOutputs(output, { status: 'complete', paths: 'a\nb' });
  const text = readFileSync(output, 'utf8');
  const [, delimiter] = /^paths<<(gg_evidence_[0-9a-f]{32})$/m.exec(text);
  assert.equal(text, `status=complete\npaths<<${delimiter}\na\nb\n${delimiter}\n`);
  assert.doesNotThrow(() => writeOutputs(undefined, { status: 'x' }));
});

test('the CLI initializes and finalizes through step outputs and reports refusals', async () => {
  const runnerTemp = temporary('gg-496-runner-');
  const output = join(temporary(), 'output');
  const summary = join(temporary(), 'summary.md');
  const messages = [];
  const io = {
    stdout: (line) => messages.push(['out', line]),
    stderr: (line) => messages.push(['err', line]),
  };
  assert.equal(
    main(['init'], {
      env: { RUNNER_TEMP: runnerTemp, GITHUB_OUTPUT: output, ...github },
      git: mergeGit,
      ...io,
    }),
    0,
  );
  const values = Object.fromEntries(
    readFileSync(output, 'utf8')
      .trim()
      .split('\n')
      .map((line) => line.split('=')),
  );
  assert.match(basename(values.dir), /^windows-launcher-evidence-/);
  const env = {
    ...finalizeEnv({ runnerTemp, directory: values.dir, evidenceId: values.id }),
    GITHUB_OUTPUT: output,
    GITHUB_STEP_SUMMARY: summary,
  };
  const { recorder, close } = recorderFor({ runnerTemp, directory: values.dir });
  await passingSuite(recorder, temporary());
  close();
  assert.equal(main(['finalize'], { env, ...io }), 0);
  assert.match(readFileSync(output, 'utf8'), /status=complete\npaths<<gg_evidence_/);
  assert.match(
    readFileSync(summary, 'utf8'),
    /Status: `complete`[\s\S]*\| installer \| pass \| 1 \|/,
  );
  assert.equal(main(['finalize'], { env, ...io }), 1);
  assert.deepEqual(messages.at(-1), [
    'err',
    'Windows launcher evidence finalize refused: unexpected-entry.',
  ]);
  assert.equal(main(['init'], { env: {}, ...io }), 1);
  assert.equal(main(['finalize', 'extra'], io), 2);
  assert.equal(main([], io), 2);
  const incomplete = initialized();
  assert.equal(main(['finalize'], { env: finalizeEnv(incomplete), ...io }), 1);
  assert.match(messages.at(-1)[1], /"status":"incomplete".*"observations-absent"/);
  const failing = {
    ...io,
    stdout: () => {
      throw new Error('closed stdout');
    },
  };
  assert.equal(main(['finalize'], { env: finalizeEnv(initialized()), ...failing }), 1);
  assert.match(messages.at(-1)[1], /refused: unavailable\.$/);
});

test('the CLI entry runs natively and reports usage and the real checkout', () => {
  const run = (args, env = {}) =>
    spawnSync(process.execPath, [helper, ...args], {
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
      env: { ...process.env, ...env },
    });
  const usage = run([]);
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /Usage: windows-launcher-evidence\.mjs init\|finalize/);
  const runnerTemp = temporary('gg-496-runner-');
  const initializedRun = run(['init'], { RUNNER_TEMP: runnerTemp, GITHUB_OUTPUT: '' });
  assert.equal(initializedRun.status, 0, initializedRun.stderr);
  assert.match(initializedRun.stdout, /"state":"initialized"/);
  const [directory] = readdirSync(runnerTemp);
  const manifest = JSON.parse(readFileSync(join(runnerTemp, directory, FILES.manifest), 'utf8'));
  assert.equal(manifest.binding.checkout.state, 'observed');
});

// Correction of #496 root 1: evidence preparation can never skip the native command.

const workflowFile = fileURLToPath(new URL('../../.github/workflows/ci.yml', import.meta.url));

/** One job's steps from ci.yml: each step's keys and one level of `env` and `with` entries. */
function workflowSteps(job) {
  const source = readFileSync(workflowFile, 'utf8').split('\n');
  const start = source.indexOf(`  ${job}:`);
  assert.ok(start >= 0, job);
  const end = source.findIndex(
    (line, index) => index > start && /^ {2}[a-z][a-z0-9-]*:$/.test(line),
  );
  const steps = [];
  let key;
  for (const line of source.slice(start, end < 0 ? undefined : end)) {
    const entry = /^ {6}(- | {2})([a-z-]+):(?: (.*))?$/.exec(line);
    const nested = /^ {10}([A-Za-z0-9_-]+): (.*)$/.exec(line);
    if (entry) {
      if (entry[1] === '- ') steps.push({});
      key = entry[2];
      steps.at(-1)[key] = entry[3] ?? {};
    } else if (nested && typeof steps.at(-1)?.[key] === 'object')
      steps.at(-1)[key][nested[1]] = nested[2];
  }
  return steps;
}

const truthy = (value) => value !== '' && value !== false && value !== null;

/** GitHub expression semantics for the forms the job uses; any other form fails the test. */
function evaluate(source, context) {
  const body = /^\$\{\{ (.+) \}\}$/.exec(source)?.[1];
  assert.ok(body, `not a single expression: ${source}`);
  const tokens = body.match(/'[^']*'|&&|\|\||==|!=|!|[a-z]+\(\)|[A-Za-z_][\w.-]*|\S/g);
  let at = 0;
  const primary = () => {
    const token = tokens[at++];
    if (token === '!') return !truthy(primary());
    if (token.startsWith("'")) return token.slice(1, -1);
    if (token.endsWith('()')) {
      const name = token.slice(0, -2);
      assert.ok(Object.hasOwn(context.status, name), token);
      context.statusChecked = true;
      return context.status[name];
    }
    const [root, id, field, name] = token.split('.');
    if (root === 'github') return '';
    assert.ok(root === 'steps' && ['outcome', 'outputs'].includes(field), token);
    return field === 'outcome' ? (context.outcomes[id] ?? '') : (context.outputs[id]?.[name] ?? '');
  };
  const binary = (operand, operators, combine) => () => {
    let left = operand();
    while (operators.includes(tokens[at])) {
      const operator = tokens[at++];
      left = combine(operator, left, operand());
    }
    return left;
  };
  const comparison = binary(
    primary,
    ['==', '!='],
    (operator, a, b) => (operator === '==') === (a === b),
  );
  const and = binary(comparison, ['&&'], (_operator, a, b) => (truthy(a) ? b : a));
  const or = binary(and, ['||'], (_operator, a, b) => (truthy(a) ? a : b));
  const value = or();
  assert.equal(at, tokens.length, source);
  return value;
}

/**
 * The steps that run, with their evaluated environment, when the given steps end with `failure`
 * or `cancelled`. A step without `if`, or whose `if` has no status function, carries GitHub's
 * implicit `success()`. Every step that runs keeps the outputs given for it, even one that fails.
 */
function schedule(steps, { end = {}, outputs = {} } = {}) {
  const context = { outcomes: {}, outputs: {}, status: {} };
  const ran = {};
  steps.forEach((step, index) => {
    const id =
      step.id ?? (step.uses?.startsWith('actions/upload-artifact') ? 'upload' : `#${index}`);
    const earlier = Object.values(context.outcomes);
    const cancelled = earlier.includes('cancelled');
    const failed = earlier.includes('failure');
    context.status = { always: true, cancelled, failure: failed, success: !cancelled && !failed };
    context.statusChecked = false;
    const condition = step.if === undefined ? true : truthy(evaluate(step.if, context));
    if (!condition || (!context.statusChecked && !context.status.success)) {
      context.outcomes[id] = 'skipped';
      return;
    }
    const env = Object.fromEntries(
      Object.entries(step.env ?? {}).map(([name, value]) => [
        name,
        value.startsWith('${{') ? evaluate(value, context) : value,
      ]),
    );
    context.outcomes[id] = end[id] ?? 'success';
    context.outputs[id] = outputs[id] ?? {};
    ran[id] = { env, run: step.run };
  });
  const outcomes = Object.values(context.outcomes);
  return {
    outcomes: context.outcomes,
    ran,
    conclusion: outcomes.includes('failure')
      ? 'failure'
      : outcomes.includes('cancelled')
        ? 'cancelled'
        : 'success',
  };
}

test('the Windows job runs the exact native command after a successful build whatever evidence preparation does', () => {
  const steps = workflowSteps('windows-launcher');
  const commands = Object.fromEntries(
    steps.filter((step) => step.id).map((step) => [step.id, step.run]),
  );
  assert.deepEqual(
    [
      commands.install,
      commands.build,
      commands.sqlite_paths,
      commands.database_config,
      commands.native,
    ],
    [
      'pnpm install --frozen-lockfile',
      'pnpm build',
      'pnpm --filter @graphgoblin/infrastructure exec vitest run src/sqlite/db.test.ts --maxWorkers=1',
      'pnpm --filter @graphgoblin/api exec vitest run src/config.test.ts --maxWorkers=1',
      'pnpm test:windows-launcher',
    ],
  );
  assert.ok(
    steps.every((step) => !('continue-on-error' in step)),
    'no step hides a failure',
  );
  const prepared = () => {
    const setup = initialized();
    return {
      setup,
      outputs: {
        evidence: { dir: setup.directory, id: setup.evidenceId },
        finalize: { paths: 'x' },
      },
    };
  };
  const ran = (result) => Object.keys(result.ran);
  const finalizeFrom = (result, setup) =>
    finalizeEvidence({ env: { RUNNER_TEMP: setup.runnerTemp, ...result.ran.finalize.env } });

  const nominal = prepared();
  const passing = schedule(steps, nominal);
  assert.deepEqual(ran(passing).slice(3), [
    'install',
    'build',
    'sqlite_paths',
    'database_config',
    'evidence',
    'native',
    'finalize',
    'upload',
  ]);
  assert.equal(passing.ran.native.env[DIRECTORY_VARIABLE], nominal.setup.directory);
  assert.equal(passing.conclusion, 'success');

  // A failed preparation, even one that left outputs, still runs the native command after a
  // successful build, keeps its outcome, hands the suite no folder, uploads nothing and fails.
  for (const native of ['success', 'failure']) {
    const failedPrepare = prepared();
    const result = schedule(steps, { ...failedPrepare, end: { evidence: 'failure', native } });
    assert.deepEqual(ran(result).slice(3), [
      'install',
      'build',
      'sqlite_paths',
      'database_config',
      'evidence',
      'native',
    ]);
    assert.equal(result.ran.native.run, 'pnpm test:windows-launcher');
    assert.equal(result.outcomes.native, native);
    assert.deepEqual([result.outcomes.finalize, result.outcomes.upload], ['skipped', 'skipped']);
    assert.equal(result.conclusion, 'failure');
    const suite = { ...result.ran.native.env, RUNNER_TEMP: failedPrepare.setup.runnerTemp };
    assert.equal(openWindowsLauncherEvidence({ env: suite, log: assert.fail }).state, 'disabled');
  }

  // A failed checkout or Node setup runs nothing further and publishes nothing.
  for (const setupStep of ['#0', 'node']) {
    const result = schedule(steps, { ...prepared(), end: { [setupStep]: 'failure' } });
    assert.ok(
      !['sqlite_paths', 'database_config', 'evidence', 'native', 'finalize', 'upload'].some(
        (id) => id in result.ran,
      ),
    );
  }

  // After a failed install or build the prepared folder still uploads truthful not-run metadata.
  for (const failing of ['install', 'build']) {
    const { setup, outputs } = prepared();
    const result = schedule(steps, { outputs, end: { [failing]: 'failure' } });
    assert.deepEqual(
      [
        result.outcomes.sqlite_paths,
        result.outcomes.database_config,
        result.outcomes.native,
        'finalize' in result.ran,
        'upload' in result.ran,
      ],
      ['skipped', 'skipped', 'skipped', true, true],
    );
    const outcome = finalizeFrom(result, setup);
    assert.equal(outcome.status, 'not-run');
    assert.equal(outcome.result.steps[failing], 'failure');
    assert.deepEqual(
      outcome.upload.map((path) => basename(path)),
      [FILES.manifest, FILES.result],
    );
  }

  // The focused native checks run after a successful build, the second under GitHub's implicit
  // success(), so it is skipped once the first fails. A failed check fails the job yet still
  // prepares evidence and runs the exact native command with its folder, then finalizes and
  // uploads; a cancelled check starts no evidence preparation, native work or upload.
  for (const [check, focused] of [
    ['sqlite_paths', ['sqlite_paths']],
    ['database_config', ['sqlite_paths', 'database_config']],
  ]) {
    const { setup, outputs } = prepared();
    const failed = schedule(steps, { outputs, end: { [check]: 'failure' } });
    assert.deepEqual(ran(failed).slice(3), [
      'install',
      'build',
      ...focused,
      'evidence',
      'native',
      'finalize',
      'upload',
    ]);
    assert.deepEqual(
      [failed.outcomes.sqlite_paths, failed.outcomes.database_config],
      check === 'sqlite_paths' ? ['failure', 'skipped'] : ['success', 'failure'],
    );
    assert.equal(failed.ran.native.run, 'pnpm test:windows-launcher');
    assert.equal(failed.ran.native.env[DIRECTORY_VARIABLE], setup.directory);
    assert.equal(failed.outcomes.native, 'success');
    assert.equal(failed.conclusion, 'failure');

    const cancelled = schedule(steps, { outputs, end: { [check]: 'cancelled' } });
    assert.deepEqual(ran(cancelled).slice(3), ['install', 'build', ...focused]);
    assert.deepEqual(
      ['evidence', 'native', 'finalize', 'upload'].map((id) => cancelled.outcomes[id]),
      ['skipped', 'skipped', 'skipped', 'skipped'],
    );
    assert.equal(cancelled.conclusion, 'cancelled');
  }

  // A failed or cancelled native step is finalized and uploaded; its outcome sets the status.
  for (const [native, conclusion] of [
    ['failure', 'failure'],
    ['cancelled', 'cancelled'],
  ]) {
    const { setup, outputs } = prepared();
    const result = schedule(steps, { outputs, end: { native } });
    assert.ok('upload' in result.ran);
    assert.equal(result.conclusion, conclusion);
    assert.equal(finalizeFrom(result, setup).status, 'native-failed');
  }

  // A refusal publishes no paths and nothing is uploaded; an incomplete result still uploads.
  const refusal = schedule(steps, {
    end: { finalize: 'failure' },
    outputs: { evidence: { dir: 'd' } },
  });
  assert.equal(refusal.outcomes.upload, 'skipped');
  assert.ok('upload' in schedule(steps, { ...prepared(), end: { finalize: 'failure' } }).ran);
});

// Correction of #496 root 2: only the exact manifest bytes `init` wrote are accepted.

test('finalize and the recorder accept only the exact manifest init wrote, at every depth', () => {
  const tampered = {
    'unknown top-level field': (text) => text.replace('{\n', `{\n  "path": "C:\\\\${CANARY}",\n`),
    'duplicate key': (text) => text.replace('{\n', `{\n  "state": "${CANARY}",\n`),
    'unknown nested field': (text) =>
      text.replace('"matchesSha"', `"note": "${CANARY}",\n      "matchesSha"`),
    'changed limit': (text) => text.replace('"records": 1024', '"records": 4096'),
    'changed file name': (text) =>
      text.replace('"result": "result.json"', '"result": "gateway.log"'),
    'byte-order mark': (text) => `\uFEFF${text}`,
    'other whitespace': (text) => `${JSON.stringify(JSON.parse(text))}\n`,
    'CRLF line ends': (text) => text.replaceAll('\n', '\r\n'),
    'listed but available value': (text) =>
      text.replace('"unavailable": []', '"unavailable": [\n    "runId"\n  ]'),
    'contradicting derived comparison': (text) =>
      text.replace('"matchesSha": true', '"matchesSha": false'),
    'canary in a bound value': (text) =>
      text.replace('"runAttempt": "2"', `"runAttempt": "${CANARY}"`),
    'number for a string': (text) => text.replace('"runAttempt": "2"', '"runAttempt": 2'),
    'canary as a parent': (text) => text.replace(`        "${SHA('a')}"`, `        "${CANARY}"`),
    'unvalidated Node version': (text) =>
      text.replace(/"node": "v[^"]+"/, `"node": "v22.0.0-${CANARY}"`),
    'other state': (text) => text.replace('"state": "initialized"', '"state": "finalized"'),
  };
  for (const [name, change] of Object.entries(tampered)) {
    const setup = initialized();
    const path = join(setup.directory, FILES.manifest);
    const original = readFileSync(path, 'utf8');
    const changed = change(original);
    assert.notEqual(changed, original, name);
    writeFileSync(path, changed);
    assert.throws(() => parseManifest(readFileSync(path)), refused('manifest-invalid'), name);
    assert.throws(
      () => finalizeEvidence({ env: finalizeEnv(setup, 'skipped') }),
      refused('manifest-invalid'),
      name,
    );
    assert.deepEqual(readdirSync(setup.directory), [FILES.manifest], `${name}: nothing written`);
    assert.equal(recorderFor(setup).recorder.state, 'refused', name);
  }

  // The bytes init wrote parse back to the same manifest.
  const genuine = initialized();
  assert.deepEqual(
    parseManifest(readFileSync(join(genuine.directory, FILES.manifest))),
    genuine.manifest,
  );

  // Legitimately unavailable values stay valid and are uploaded, and leave the binding unverified.
  const runnerTemp = temporary('gg-496-runner-');
  const sparse = initializeEvidence({
    env: { RUNNER_TEMP: runnerTemp, GITHUB_EVENT_NAME: 'pull_request' },
    git: () => {
      throw new Error('git unavailable');
    },
  });
  assert.deepEqual(sparse.manifest.binding.unavailable, [
    'repository',
    'workflowRef',
    'job',
    'runId',
    'runAttempt',
    'ref',
    'sha',
    'eventHead',
    'eventBase',
    'runnerOs',
    'runnerArch',
    'imageVersion',
    'checkout',
  ]);
  const notRun = finalizeEvidence({
    env: finalizeEnv(
      { runnerTemp, directory: sparse.directory, evidenceId: sparse.evidenceId },
      'skipped',
    ),
  });
  assert.equal(notRun.status, 'not-run');
  assert.deepEqual(notRun.result.missing, [
    'observations-absent',
    'binding-identity',
    'binding-unverified',
  ]);
  assert.ok(notRun.upload.some((path) => path.endsWith(FILES.manifest)));

  // Through the real CLI: an unknown manifest field is refused and no path is published.
  const child = initialized();
  const manifest = join(child.directory, FILES.manifest);
  writeFileSync(
    manifest,
    readFileSync(manifest, 'utf8').replace('{\n', `{\n  "path": "${CANARY}",\n`),
  );
  const output = join(temporary(), 'output');
  const finalized = spawnSync(process.execPath, [helper, 'finalize'], {
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
    env: {
      ...process.env,
      ...finalizeEnv(child, 'skipped'),
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: '',
    },
  });
  assert.equal(finalized.status, 1, finalized.stderr);
  assert.match(finalized.stderr, /finalize refused: manifest-invalid\./);
  assert.equal(existsSync(output), false, 'no step outputs');
  assert.doesNotMatch(finalized.stdout + finalized.stderr, /CANARY/);
});

// Correction of #496 root 3: contradictions and repeats never count as complete evidence.

test('complete evidence needs a verified revision binding and a known contradiction is never complete', async () => {
  const run = async (extra, { git = mergeGit, native = 'success' } = {}) => {
    const runnerTemp = temporary('gg-496-runner-');
    const env = { RUNNER_TEMP: runnerTemp, ...github, ...extra };
    const { directory, evidenceId } = initializeEvidence({ env, git });
    const { recorder, close } = recorderFor({ runnerTemp, directory });
    await passingSuite(recorder, temporary());
    close();
    return finalizeEvidence({ env: finalizeEnv({ runnerTemp, directory, evidenceId }, native) });
  };
  const push = {
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_WORKFLOW_REF: 'Jacob-J-Thomas/GraphGoblin/.github/workflows/ci.yml@refs/heads/main',
    GG_TEST_EVIDENCE_EVENT_HEAD: SHA('c'),
    GG_TEST_EVIDENCE_EVENT_BASE: '',
  };
  assert.equal((await run(push)).status, 'complete');
  assert.equal((await run({})).status, 'complete', 'pull-request merge checkout');
  for (const [extra, missing, git] of [
    [{ ...push, GG_TEST_EVIDENCE_EVENT_HEAD: SHA('f') }, ['binding-contradiction']],
    [
      { ...push, GITHUB_SHA: SHA('f'), GG_TEST_EVIDENCE_EVENT_HEAD: SHA('f') },
      ['binding-contradiction'],
    ],
    [{ GG_TEST_EVIDENCE_EVENT_BASE: SHA('e') }, ['binding-contradiction']],
    [{ GG_TEST_EVIDENCE_EVENT_HEAD: SHA('e') }, ['binding-contradiction']],
    [{ GG_TEST_EVIDENCE_EVENT_HEAD: 'not-a-sha' }, ['binding-unverified']],
    [
      {},
      ['binding-unverified'],
      () => {
        throw new Error('git unavailable');
      },
    ],
  ]) {
    const outcome = await run(extra, { git });
    assert.deepEqual(
      [outcome.status, outcome.exitCode, outcome.result.missing],
      ['incomplete', 1, missing],
    );
    assert.equal(outcome.upload.length, 3, 'the valid observations are still uploaded');
  }
  // A failed native run keeps its honest status and its valid observations.
  const failed = await run(
    { ...push, GG_TEST_EVIDENCE_EVENT_HEAD: SHA('f') },
    { native: 'failure' },
  );
  assert.deepEqual(
    [failed.status, failed.exitCode, failed.result.missing, failed.upload.length],
    ['native-failed', 0, ['binding-contradiction'], 3],
  );
  const checkout = (values) => ({
    matchesSha: true,
    headMatchesEventHead: null,
    baseParentMatchesEventBase: null,
    headParentMatchesEventHead: null,
    ...values,
  });
  assert.deepEqual(
    bindingRequirements({
      event: 'pull_request',
      checkout: checkout({ baseParentMatchesEventBase: false }),
    }),
    ['binding-contradiction', 'binding-unverified'],
  );
  assert.deepEqual(
    bindingRequirements({ event: 'push', checkout: checkout({ headMatchesEventHead: true }) }),
    [],
  );

  // Through the real CLI on the real checkout: a push whose event head differs from the checked
  // out commit records the contradiction and cannot finalize as complete.
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const runnerTemp = temporary('gg-496-runner-');
  const output = join(temporary(), 'output');
  const cli = (command, env) =>
    spawnSync(process.execPath, [helper, command], {
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
      env: { ...process.env, GITHUB_STEP_SUMMARY: '', GITHUB_OUTPUT: output, ...env },
    });
  const init = cli('init', {
    RUNNER_TEMP: runnerTemp,
    // An identified push run, so the contradiction is the only missing binding requirement.
    ...github,
    ...push,
    GITHUB_EVENT_NAME: 'push',
    GITHUB_SHA: head,
    GG_TEST_EVIDENCE_EVENT_HEAD: '1'.repeat(40),
  });
  assert.equal(init.status, 0, init.stderr);
  const values = Object.fromEntries(
    readFileSync(output, 'utf8')
      .trim()
      .split('\n')
      .map((line) => line.split('=')),
  );
  const { checkout: observed } = JSON.parse(
    readFileSync(join(values.dir, FILES.manifest), 'utf8'),
  ).binding;
  assert.deepEqual([observed.matchesSha, observed.headMatchesEventHead], [true, false]);
  const recording = recorderFor({ runnerTemp, directory: values.dir });
  await passingSuite(recording.recorder, temporary());
  recording.close();
  const final = cli(
    'finalize',
    finalizeEnv({ runnerTemp, directory: values.dir, evidenceId: values.id }),
  );
  assert.equal(final.status, 1, final.stderr);
  assert.match(final.stdout, /"status":"incomplete".*"missing":\["binding-contradiction"\]/);
});

test('the recorder states each once-per-run fact once and writes its own lifecycle records', async () => {
  const setup = initialized();
  const { recorder, close } = recorderFor(setup);
  await passingSuite(recorder, temporary());
  const alias = {
    case: 'checkout-alias',
    subtest: 1,
    kind: 'junction',
    observedLinkType: 'Junction',
    reparsePoint: true,
    directory: true,
    targetMatched: true,
    failureStage: null,
    failureCode: null,
    disposition: 'unlinked',
    unlinkFailure: null,
  };
  const repeats = [
    [
      'contention',
      {
        case: 'lock-contention',
        subtest: 0,
        trial: 1,
        contenders: 5,
        acquired: 1,
        refused: 4,
        other: 0,
      },
    ],
    [
      'alias-round',
      {
        case: 'checkout-alias',
        subtest: 1,
        kind: 'junction',
        spelling: 'alias',
        ownerVerified: true,
        release: 'drained-pid-listener-leases',
        releaseFailure: null,
      },
    ],
    ['alias', alias],
    ['case-start', { case: 'installer', subtest: 0 }],
    ['recorder-open', { evidenceId: setup.evidenceId }],
    ['recorder-closed', { written: 1, rejected: 0, omittedRecords: 0, omittedBytes: 0 }],
    ['overflow', { firstOmittedSeq: 1 }],
    ['rejected', { recordType: 'child' }],
    ['fixture-state', { fixture: 'abcdef', kind: 'logs', state: 'directory', errorCode: null }],
  ];
  for (const [type, fields] of repeats)
    assert.equal(recorder.record(type, fields).type, 'rejected', type);
  close();
  const records = lines(join(setup.directory, FILES.observations));
  assert.deepEqual(
    records.filter((record) => record.type === 'rejected').map((record) => record.recordType),
    repeats.map(([type]) => type),
  );
  const count = (type) => records.filter((record) => record.type === type).length;
  assert.deepEqual(
    [count('recorder-open'), count('recorder-closed'), count('contention'), count('alias')],
    [1, 1, 3, 2],
  );
  const outcome = finalizeEvidence({ env: finalizeEnv(setup) });
  assert.deepEqual(
    [outcome.status, outcome.exitCode, outcome.result.observations.state, outcome.result.missing],
    ['incomplete', 1, 'valid', ['records-rejected']],
  );
});

test('repeated contention trials and alias spellings never stand in for distinct ones', async () => {
  for (const [options, expected] of [
    [{ trials: [1, 1, 1] }, ['records-rejected', 'contention-trials']],
    [
      { spellings: ['alias', 'alias'] },
      ['records-rejected', 'alias-junction-release', 'alias-dir-release'],
    ],
    [{ trials: [1, 2, 4] }, ['contention-trials']],
  ]) {
    const setup = initialized();
    const { recorder, close } = recorderFor(setup);
    await passingSuite(recorder, temporary(), options);
    close();
    const outcome = finalizeEvidence({ env: finalizeEnv(setup) });
    assert.deepEqual(
      [outcome.status, outcome.exitCode, outcome.result.missing],
      ['incomplete', 1, expected],
      JSON.stringify(options),
    );
  }
  // Only single-owner trials of the contention case and verified, drained rounds of the
  // checkout-alias case count, each once.
  const trial = (number, extra = {}) =>
    passingContention(number).map((record) => ({
      ...record,
      case: 'lock-contention',
      subtest: 0,
      ...(record.type === 'contention' ? extra : {}),
    }));
  assert.deepEqual(
    summarize([
      ...trial(1),
      ...trial(2, { case: 'installer' }),
      ...trial(3, { acquired: 2, refused: 3 }),
      ...trial(3, { refused: 3, other: 1 }),
      ...trial(3, { contenders: 1, refused: 0 }),
      ...trial(4),
    ]).contention,
    [1, 4],
  );
  const round = (spelling, extra = {}) => ({
    type: 'alias-round',
    case: 'checkout-alias',
    subtest: 1,
    kind: 'junction',
    spelling,
    ownerVerified: true,
    release: 'drained-pid-listener-leases',
    releaseFailure: null,
    ...extra,
  });
  assert.deepEqual(summarize([round('alias'), round('direct')]).aliases.junction.released, [
    'alias',
    'direct',
  ]);
  assert.deepEqual(
    summarize([
      round('alias', { ownerVerified: false }),
      round('direct', { case: 'launcher' }),
      round('alias', { release: 'no-gateway-spawned' }),
    ]).aliases.junction.released,
    [],
  );
});

test('nested subtests are numbered across their case and count once their start and end pair', async () => {
  const setup = initialized();
  const { recorder, close } = recorderFor(setup);
  await recorder.observeTest('launcher', async (t) => {
    await t.test('outer', async (inner) => inner.test('nested', async () => undefined));
    await t.test('second', async () => undefined);
  })(context());
  close();
  const records = lines(join(setup.directory, FILES.observations));
  assert.deepEqual(
    records.filter((record) => record.type === 'case-start').map((record) => record.subtest),
    [0, 1, 2, 3],
  );
  const { launcher } = summarize(records).cases;
  assert.deepEqual(
    [launcher.subtestsStarted, launcher.subtestsPassed, launcher.subtestsUnpaired],
    [3, 3, 0],
  );
  const unpaired = summarize([
    { type: 'case-start', case: 'launcher', subtest: 0 },
    { type: 'case-start', case: 'launcher', subtest: 1 },
    { type: 'case-end', case: 'launcher', subtest: 2, result: 'pass' },
    { type: 'case-end', case: 'launcher', subtest: 0, result: 'pass' },
  ]);
  assert.deepEqual(
    [
      unpaired.cases.launcher.subtestsStarted,
      unpaired.cases.launcher.subtestsPassed,
      unpaired.cases.launcher.subtestsUnpaired,
    ],
    [1, 0, 2],
  );
  assert.ok(missingRequirements(unpaired).includes('launcher-subtests'));
});

test('a stream that breaks the recorder lifecycle or repeats a fact is rejected whole', () => {
  const evidenceId = '0d4f8c56-8f43-4b52-9b77-4fd1a9c2d001';
  const line = (seq, type, fields) =>
    JSON.stringify({ seq, at: '2026-11-17T19:16:23.257Z', type, ...fields });
  const open = line(1, 'recorder-open', { evidenceId });
  const closed = (seq, written, extra = {}) =>
    line(seq, 'recorder-closed', {
      written,
      rejected: 0,
      omittedRecords: 0,
      omittedBytes: 0,
      ...extra,
    });
  const trial = (seq, number, extra = {}) =>
    line(seq, 'contention', {
      case: 'lock-contention',
      subtest: 0,
      trial: number,
      contenders: 5,
      acquired: 1,
      refused: 4,
      other: 0,
      ...extra,
    });
  const round = (seq) =>
    line(seq, 'alias-round', {
      case: 'checkout-alias',
      subtest: 1,
      kind: 'junction',
      spelling: 'alias',
      ownerVerified: true,
      release: 'drained-pid-listener-leases',
      releaseFailure: null,
    });
  const start = (seq) => line(seq, 'case-start', { case: 'launcher', subtest: 1 });
  const overflow = (seq) => line(seq, 'overflow', { firstOmittedSeq: seq - 1 });
  const rejection = (seq) => line(seq, 'rejected', { recordType: 'child' });
  const parse = (...rows) => parseObservations(Buffer.from(`${rows.join('\n')}\n`), evidenceId);
  // Closed with matching counts, unclosed partial evidence and a counted overflow stay valid.
  assert.equal(parse(open, trial(2, 1), closed(3, 2)).state, 'valid');
  assert.equal(parse(open, trial(2, 1), trial(3, 2)).state, 'valid');
  assert.equal(
    parse(
      open,
      rejection(3),
      overflow(5),
      closed(6, 3, { rejected: 2, omittedRecords: 1, omittedBytes: 90 }),
    ).state,
    'valid',
  );
  for (const [reason, rows] of [
    ['lifecycle', [open, line(2, 'recorder-open', { evidenceId })]],
    ['lifecycle', [open, closed(2, 1), trial(3, 1)]],
    ['lifecycle', [open, closed(2, 1), closed(3, 2)]],
    ['lifecycle', [open, trial(2, 1), closed(3, 1)]],
    ['lifecycle', [open, rejection(2), closed(3, 2)]],
    ['lifecycle', [open, overflow(3), overflow(5)]],
    ['lifecycle', [open, overflow(3), closed(4, 2)]],
    ['lifecycle', [open, closed(2, 1, { omittedRecords: 1, omittedBytes: 90 })]],
    ['duplicate-fact', [open, trial(2, 1), trial(3, 1)]],
    ['duplicate-fact', [open, round(2), round(3)]],
    ['duplicate-fact', [open, start(2), start(3)]],
    ['invalid-record', [open, trial(2, 1, { refused: 7 })]],
    ['invalid-record', [open, overflow(3).replace('"firstOmittedSeq":2', '"firstOmittedSeq":1')]],
    [
      'invalid-record',
      [
        open,
        line(2, 'case-end', {
          case: 'launcher',
          subtest: 0,
          result: 'pass',
          elapsedMs: 1,
          failedSubtests: 0,
          failureKind: 'assertion',
          failureCode: null,
          failureExit: null,
          failureSignal: null,
        }),
      ],
    ],
    [
      'invalid-record',
      [
        open,
        line(2, 'alias', {
          case: 'checkout-alias',
          subtest: 2,
          kind: 'dir',
          observedLinkType: 'unobserved',
          reparsePoint: null,
          directory: null,
          targetMatched: false,
          failureStage: null,
          failureCode: null,
          disposition: 'unlinked',
          unlinkFailure: null,
        }),
      ],
    ],
  ])
    assert.deepEqual(parse(...rows), { state: 'rejected', reason, records: [] }, rows.join('\n'));
});

// Correction 02 of #496: complete evidence names an identified run, and a closer's rejected count
// agrees with the stream.

const pushRun = {
  GITHUB_EVENT_NAME: 'push',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_WORKFLOW_REF: 'Jacob-J-Thomas/GraphGoblin/.github/workflows/ci.yml@refs/heads/main',
  GG_TEST_EVIDENCE_EVENT_HEAD: SHA('c'),
  GG_TEST_EVIDENCE_EVENT_BASE: '',
};

/** A run initialized with `extra` over `github`, recorded passing unless skipped, and finalized. */
async function recordedRun(extra, native = 'success') {
  const runnerTemp = temporary('gg-496-runner-');
  const env = { RUNNER_TEMP: runnerTemp, ...github, ...extra };
  const { directory, evidenceId, manifest } = initializeEvidence({ env, git: mergeGit });
  if (native !== 'skipped') {
    const { recorder, close } = recorderFor({ runnerTemp, directory });
    await passingSuite(recorder, temporary());
    close();
  }
  const outcome = finalizeEvidence({
    env: finalizeEnv({ runnerTemp, directory, evidenceId }, native),
  });
  return {
    unavailable: manifest.binding.unavailable,
    outcome: [outcome.status, outcome.exitCode, outcome.result.missing, outcome.upload.length],
  };
}

test('complete evidence needs every run identity value, while runner diagnostics may be unavailable', async () => {
  // Identified push and pull-request runs stay complete without the runner OS, architecture and
  // image; a push has no event base.
  for (const event of [pushRun, {}]) {
    const run = await recordedRun({
      ...event,
      RUNNER_OS: '',
      RUNNER_ARCH: undefined,
      ImageVersion: 'x',
    });
    assert.deepEqual(run, {
      unavailable: ['runnerOs', 'runnerArch', 'imageVersion'],
      outcome: ['complete', 0, [], 3],
    });
  }

  // A missing or malformed identity value keeps a verified, passing run incomplete with one
  // marker, and its valid files are still uploaded.
  const identity = {
    repository: ['GITHUB_REPOSITORY', 'GraphGoblin'],
    workflowRef: ['GITHUB_WORKFLOW_REF', 'refs/heads/main'],
    job: ['GITHUB_JOB', 'windows launcher'],
    runId: ['GITHUB_RUN_ID', '0'],
    runAttempt: ['GITHUB_RUN_ATTEMPT', '2a'],
    event: ['GITHUB_EVENT_NAME', 'Push'],
    ref: ['GITHUB_REF', 'main'],
  };
  for (const [name, [variable, malformed]] of Object.entries(identity))
    for (const value of ['', malformed])
      assert.deepEqual(
        await recordedRun({ ...pushRun, [variable]: value }),
        { unavailable: [name], outcome: ['incomplete', 1, ['binding-identity'], 3] },
        `${variable}=${JSON.stringify(value)}`,
      );

  // Several missing values are one marker, and a known contradiction keeps its own diagnosis.
  const anonymous = await recordedRun({
    ...pushRun,
    GITHUB_RUN_ID: '',
    GITHUB_RUN_ATTEMPT: '',
    GITHUB_JOB: '',
    GG_TEST_EVIDENCE_EVENT_HEAD: SHA('f'),
  });
  assert.deepEqual(anonymous.outcome, [
    'incomplete',
    1,
    ['binding-identity', 'binding-contradiction'],
    3,
  ]);

  // A failed or skipped native step keeps its own status and its valid files.
  const unidentified = { ...pushRun, GITHUB_RUN_ID: '' };
  assert.deepEqual((await recordedRun(unidentified, 'failure')).outcome, [
    'native-failed',
    0,
    ['binding-identity'],
    3,
  ]);
  assert.deepEqual((await recordedRun(unidentified, 'skipped')).outcome, [
    'not-run',
    0,
    ['observations-absent', 'binding-identity'],
    2,
  ]);
});

test('through the real CLI, a verified run without its run ID keeps its files and is not complete', async () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const runnerTemp = temporary('gg-496-runner-');
  const cli = (command, output, env) =>
    spawnSync(process.execPath, [helper, command], {
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
      env: { ...process.env, GITHUB_STEP_SUMMARY: '', GITHUB_OUTPUT: output, ...env },
    });
  const results = [];
  for (const runId of ['44200000001', '']) {
    const output = join(temporary(), 'output');
    const init = cli('init', output, {
      RUNNER_TEMP: runnerTemp,
      ...github,
      ...pushRun,
      GITHUB_SHA: head,
      GG_TEST_EVIDENCE_EVENT_HEAD: head,
      GITHUB_RUN_ID: runId,
    });
    assert.equal(init.status, 0, init.stderr);
    const values = Object.fromEntries(
      readFileSync(output, 'utf8')
        .trim()
        .split('\n')
        .map((line) => line.split('=')),
    );
    const { binding } = JSON.parse(readFileSync(join(values.dir, FILES.manifest), 'utf8'));
    const recording = recorderFor({ runnerTemp, directory: values.dir });
    await passingSuite(recording.recorder, temporary());
    recording.close();
    const finalOutput = join(temporary(), 'output');
    const final = cli(
      'finalize',
      finalOutput,
      finalizeEnv({ runnerTemp, directory: values.dir, evidenceId: values.id }),
    );
    const { status, missing } = JSON.parse(final.stdout);
    const [, , paths] = /^paths<<(\S+)\n([\s\S]*?)\n\1$/m.exec(readFileSync(finalOutput, 'utf8'));
    results.push({
      exit: final.status,
      comparisons: [binding.checkout.matchesSha, binding.checkout.headMatchesEventHead],
      unavailable: binding.unavailable,
      status,
      missing,
      files: paths.split('\n').map((path) => basename(path)),
    });
  }
  const files = [FILES.manifest, FILES.result, FILES.observations];
  assert.deepEqual(results, [
    {
      exit: 0,
      comparisons: [true, true],
      unavailable: [],
      status: 'complete',
      missing: [],
      files,
    },
    {
      exit: 1,
      comparisons: [true, true],
      unavailable: ['runId'],
      status: 'incomplete',
      missing: ['binding-identity'],
      files,
    },
  ]);
});

test("a closer's rejected count must equal the stream's unless it also counts omitted records", async () => {
  const evidenceId = '0d4f8c56-8f43-4b52-9b77-4fd1a9c2d001';
  const line = (seq, type, fields) =>
    JSON.stringify({ seq, at: '2026-11-17T19:16:23.257Z', type, ...fields });
  const open = line(1, 'recorder-open', { evidenceId });
  const closed = (seq, written, extra) =>
    line(seq, 'recorder-closed', {
      written,
      rejected: 0,
      omittedRecords: 0,
      omittedBytes: 0,
      ...extra,
    });
  const rejection = (seq) => line(seq, 'rejected', { recordType: 'child' });
  const overflow = (seq) => line(seq, 'overflow', { firstOmittedSeq: seq - 1 });
  const omitted = { omittedRecords: 1, omittedBytes: 60 };
  const parse = (...rows) => parseObservations(Buffer.from(`${rows.join('\n')}\n`), evidenceId);
  // Equal counts, and a rejection that was itself the omitted record, are the recorder's output.
  assert.equal(parse(open, rejection(3), closed(4, 2, { rejected: 1 })).state, 'valid');
  assert.equal(parse(open, overflow(4), closed(5, 2, { rejected: 1, ...omitted })).state, 'valid');
  for (const rows of [
    [open, closed(2, 1, { rejected: 1 })],
    [open, rejection(3), closed(4, 2, { rejected: 2 })],
    [open, overflow(4), closed(5, 2, { rejected: 2, ...omitted })],
  ])
    assert.deepEqual(
      parse(...rows),
      { state: 'rejected', reason: 'lifecycle', records: [] },
      rows.join('\n'),
    );

  // A real passing recording whose closer claims a rejection it never wrote is never complete and
  // its observations are not uploaded; a failed native step keeps its own status.
  for (const native of ['success', 'failure']) {
    const setup = initialized();
    const { recorder, close } = recorderFor(setup);
    await passingSuite(recorder, temporary());
    close();
    const path = join(setup.directory, FILES.observations);
    const records = lines(path);
    assert.deepEqual([records.at(-1).rejected, records.at(-1).omittedRecords], [0, 0]);
    records.at(-1).rejected = 1;
    writeFileSync(path, records.map((record) => `${JSON.stringify(record)}\n`).join(''));
    const outcome = finalizeEvidence({ env: finalizeEnv(setup, native) });
    const { state, reason, rejected } = outcome.result.observations;
    assert.deepEqual(
      [outcome.status, outcome.exitCode, state, reason, rejected, outcome.upload.length],
      [native === 'success' ? 'incomplete' : 'native-failed', 1, 'rejected', 'lifecycle', 0, 2],
    );
  }
});

test('a genuine overflow that omits rejections stays valid partial evidence', async () => {
  const cleanup = {
    case: 'bounded-logs',
    subtest: 0,
    action: 'gateway-drain',
    result: 'drained',
    count: null,
  };
  for (const [native, status, exitCode] of [
    ['success', 'incomplete', 1],
    ['failure', 'native-failed', 0],
  ]) {
    const setup = initialized();
    const { recorder, close } = recorderFor(setup);
    await passingSuite(recorder, temporary());
    recorder.record('child', { case: 'launcher', subtest: 0, diagnostic: CANARY });
    for (let index = 0; index < LIMITS.records; index++) recorder.record('cleanup', cleanup);
    // Past capacity these rejections are counted but omitted.
    for (let index = 0; index < 3; index++) recorder.record('child', { diagnostic: CANARY });
    close();
    const records = lines(join(setup.directory, FILES.observations));
    const closer = records.at(-1);
    assert.equal(records.filter((record) => record.type === 'rejected').length, 1);
    assert.equal(closer.rejected, 4);
    assert.ok(closer.omittedRecords >= 3);
    const outcome = finalizeEvidence({ env: finalizeEnv(setup, native) });
    const { observations } = outcome.result;
    assert.deepEqual(
      [
        outcome.status,
        outcome.exitCode,
        observations.state,
        observations.closed,
        observations.rejected,
        observations.omittedRecords,
        outcome.result.missing,
        outcome.upload.length,
      ],
      [
        status,
        exitCode,
        'valid',
        true,
        1,
        closer.omittedRecords,
        ['records-omitted', 'records-rejected'],
        3,
      ],
    );
    assert.ok(Object.values(outcome.result.cases).every((entry) => entry.result === 'pass'));
  }
});

test('a rejection the recorder could not stamp is neither written nor counted', async () => {
  let failAfter = 0;
  const now = () => {
    if (failAfter > 0 && --failAfter === 0) throw new RangeError('clock unavailable');
    return new Date();
  };
  const setup = initialized();
  const { recorder, close } = recorderFor(setup, { now });
  await passingSuite(recorder, temporary());
  // The invalid record's own timestamp succeeds; the clock then fails while stamping its rejection.
  failAfter = 2;
  assert.equal(recorder.record('child', { diagnostic: CANARY }), null);
  close();
  const records = lines(join(setup.directory, FILES.observations));
  assert.deepEqual(
    [records.filter((record) => record.type === 'rejected').length, records.at(-1).rejected],
    [0, 0],
  );
  const outcome = finalizeEvidence({ env: finalizeEnv(setup) });
  assert.deepEqual(
    [outcome.status, outcome.exitCode, outcome.result.observations.state],
    ['complete', 0, 'valid'],
  );
});

// Final audit of #496: a rejection marker's `recordType` is a primitive string from the closed set
// of record types or `unknown`, when written and when read. No other value is converted to a key.

test('a rejection marker names a requested record-type string, and unknown for any other value', async () => {
  const setup = initialized();
  const { recorder, close } = recorderFor(setup);
  await passingSuite(recorder, temporary());
  const requested = [
    ['child', 'child'],
    ['rejected', 'rejected'],
    ['not-a-type', 'unknown'],
    [Object('child'), 'unknown'],
    [['child'], 'unknown'],
    [{ toString: () => 'cleanup' }, 'unknown'],
    [Object.create(null), 'unknown'],
    [42, 'unknown'],
    [null, 'unknown'],
  ];
  for (const [index, [type, recordType]] of requested.entries()) {
    const marker = recorder.record(type, {});
    assert.deepEqual([marker?.type, marker?.recordType], ['rejected', recordType], `${index}`);
    assert.equal(validateRecord(marker), true, `${index}`);
  }
  close();
  const records = lines(join(setup.directory, FILES.observations));
  assert.deepEqual(
    records.filter((record) => record.type === 'rejected').map((record) => record.recordType),
    requested.map(([, recordType]) => recordType),
  );
  assert.equal(records.at(-1).rejected, requested.length);
  const outcome = finalizeEvidence({ env: finalizeEnv(setup) });
  const { state, rejected } = outcome.result.observations;
  assert.deepEqual(
    [outcome.status, outcome.exitCode, state, rejected, outcome.result.missing, outcome.upload],
    [
      'incomplete',
      1,
      'valid',
      requested.length,
      ['records-rejected'],
      [FILES.manifest, FILES.result, FILES.observations].map((name) => join(setup.directory, name)),
    ],
  );
});

test('the reader refuses a rejection marker whose record type is not a supported string', () => {
  const at = '2026-11-17T19:16:23.257Z';
  const marker = (recordType) => ({ seq: 2, at, type: 'rejected', recordType });
  for (const recordType of ['child', 'cleanup', 'rejected', 'recorder-open', 'unknown'])
    assert.equal(validateRecord(marker(recordType)), true, recordType);
  for (const [index, recordType] of [
    Object('child'),
    ['child'],
    [['child']],
    { toString: () => 'child' },
    Object.create(null),
    1,
    true,
    null,
    'not-a-type',
    'toString',
    '__proto__',
    'Child',
    '',
  ].entries())
    assert.equal(validateRecord(marker(recordType)), false, `${index}`);

  const evidenceId = '0d4f8c56-8f43-4b52-9b77-4fd1a9c2d001';
  const parse = (recordType) =>
    parseObservations(
      Buffer.from(
        [
          { seq: 1, at, type: 'recorder-open', evidenceId },
          marker(recordType),
          {
            seq: 3,
            at,
            type: 'recorder-closed',
            written: 2,
            rejected: 1,
            omittedRecords: 0,
            omittedBytes: 0,
          },
        ]
          .map((record) => `${JSON.stringify(record)}\n`)
          .join(''),
      ),
      evidenceId,
    );
  for (const recordType of ['child', 'unknown']) {
    const parsed = parse(recordType);
    assert.equal(parsed.state, 'valid', recordType);
    assert.equal(parsed.records[1].recordType, recordType);
  }
  for (const recordType of [['child'], [['child']], { 0: 'child' }, 1, null, 'not-a-type'])
    assert.deepEqual(
      parse(recordType),
      { state: 'rejected', reason: 'invalid-record', records: [] },
      JSON.stringify(recordType),
    );
});

test('finalize never uploads observations whose rejection marker holds a structured record type', async () => {
  for (const [native, status] of [
    ['success', 'incomplete'],
    ['failure', 'native-failed'],
  ]) {
    const setup = initialized();
    const { recorder, close } = recorderFor(setup);
    await passingSuite(recorder, temporary());
    recorder.record('child', { diagnostic: CANARY });
    close();
    const path = join(setup.directory, FILES.observations);
    const records = lines(path);
    const marker = records.find((record) => record.type === 'rejected');
    assert.equal(marker.recordType, 'child');
    marker.recordType = ['child'];
    writeFileSync(path, records.map((record) => `${JSON.stringify(record)}\n`).join(''));
    const outcome = finalizeEvidence({ env: finalizeEnv(setup, native) });
    const { state, reason } = outcome.result.observations;
    assert.deepEqual(
      [outcome.status, outcome.exitCode, state, reason, outcome.result.missing, outcome.upload],
      [
        status,
        1,
        'rejected',
        'invalid-record',
        ['observations-rejected'],
        [FILES.manifest, FILES.result].map((name) => join(setup.directory, name)),
      ],
      native,
    );
  }
});

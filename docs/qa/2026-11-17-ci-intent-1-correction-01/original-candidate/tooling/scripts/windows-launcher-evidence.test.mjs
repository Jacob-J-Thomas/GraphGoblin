import { test } from 'vitest';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
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
  childFields,
  classifyDiagnostic,
  describeBinding,
  describeCommand,
  errorCodeOf,
  failureFields,
  finalizeEvidence,
  fixtureId,
  initializeEvidence,
  main,
  missingRequirements,
  observeCheckout,
  openWindowsLauncherEvidence,
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

/**
 * Every required observation of a passing native run, produced through the public API. Like the
 * real suite, lock contention spawns its contenders directly and has no observed `execFile` child.
 */
async function passingSuite(recorder, fixture) {
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
            for (const spelling of ['alias', 'direct'])
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
        for (let trial = 1; trial <= 3; trial++)
          recorder.record('contention', {
            trial,
            contenders: 5,
            acquired: 1,
            refused: 4,
            other: 0,
          });
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
    'The configured Node runtime did not answer the read-only identity/ownership check.':
      'helper-timeout',
    'The Node 22 runtime, launcher configuration or store ownership could not be checked.':
      'helper-refused',
    'The configured Node runtime could not be started.': 'helper-unavailable',
    'The ownership helper returned an invalid result.': 'helper-invalid',
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
  const recorder = new Recorder({ fd: -1, state: 'recording', log: (line) => log.push(line) });
  assert.doesNotThrow(() => recorder.record('recorder-open', { evidenceId: randomUUID() }));
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
  close();
  const records = lines(join(setup.directory, FILES.observations));
  const ends = records.filter((record) => record.type === 'case-end');
  assert.deepEqual(
    ends.map((record) => [record.case, record.subtest, record.result, record.failureKind]),
    [
      ['bounded-logs', 1, 'pass', null],
      ['bounded-logs', 2, 'fail', 'assertion'],
      ['bounded-logs', 0, 'fail', 'subtests'],
      ['installer', 0, 'fail', 'other'],
    ],
  );
  assert.equal(ends[2].failedSubtests, 1);
  const markers = log.filter((line) => line.includes('windows-launcher-observation'));
  assert.equal(markers.length, 4, 'failed ends plus the last child of the failed subtest');
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

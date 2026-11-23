// QA459C candidate aggregation. Not product code. Read-only over the private records; derives
// path-scrubbed case-results.json and acceptance-map.json. Never overwrites.
// node qa459c-aggregate.mjs --out <dir> --baseline <dir> --scratch <dir> --checkout <dir>
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const option = (name) => process.argv[process.argv.indexOf(name) + 1];
const out = option('--out');
const baseline = option('--baseline');
const scratch = option('--scratch');
const checkout = option('--checkout');
for (const name of ['case-results.json', 'acceptance-map.json']) if (existsSync(join(out, name))) throw new Error(`${name} exists; never overwritten`);

const roots = [[scratch, '<scratch>'], [checkout, '<checkout>'], [out, '<out>'], [baseline, '<baseline>'], [homedir(), '<home>']];
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function scrub(value) {
  if (typeof value === 'string') {
    let text = value;
    for (const [path, token] of roots) {
      const back = path.replace(/\//g, '\\');
      for (const form of [back.replace(/\\/g, '\\\\'), back, path.replace(/\\/g, '/')]) text = text.replace(new RegExp(escapeRegExp(form), 'gi'), token);
    }
    return text.replace(new RegExp(escapeRegExp(userInfo().username), 'gi'), '<user>');
  }
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)]));
  return value;
}
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const only = (dir) => {
  const names = readdirSync(dir);
  if (names.length !== 1) throw new Error(`expected exactly one run in ${dir}`);
  return names[0];
};

// ---------- F3 ----------
const f3RunId = only(join(out, 'private', 'runs'));
const f3Dir = join(out, 'private', 'runs', f3RunId);
const f3Run = json(join(f3Dir, 'run.json'));
const base = json(join(baseline, 'case-results.json'));
const INTENDED = ['Q08', 'Q09', 'Q10', 'Q11', 'Q12', 'Q13', 'Q15'];
const f3Cases = f3Run.cases.map(({ id }) => {
  const record = json(join(f3Dir, id, 'case.json'));
  const o = record.observed;
  const b = base.cases.find((item) => item.id === id);
  const controlsPassed = record.controls.filter((item) => item.pass).length;
  const intended = INTENDED.includes(id);
  const expectedRaw = intended ? 'DIFFERED-FROM-PREDICTION' : 'MATCHED-PREDICTION';
  const accepted = record.correctedContract === 'CONFORMS' && controlsPassed === 11 && record.controls.length === 11 && record.status === expectedRaw;
  return {
    id,
    name: record.name,
    category: record.category,
    responses: {
      identity: { bytes: record.responses.identity.bytes, sha256: record.responses.identity.sha256 },
      ownership: record.responses.ownership.map(({ text, ...rest }) => rest),
      realProducerOutputs: record.responses.realProducerOutputs.map(({ text, ...rest }) => rest),
    },
    baselineObserved: { run: b.run, driver: b.driver, code: b.observed.code, authorizedFreshGateway: b.observed.authorizedFreshGateway, ownershipCalls: b.observed.ownershipCalls, status: b.status, correctedContract: b.correctedContract },
    baselinePrediction: record.baselinePrediction,
    correctedExpectation: record.correctedExpectation,
    observed: {
      authorizedFreshGateway: o.authorizedFreshGateway,
      gatewayMainMarkers: o.gatewayMarkers.length,
      code: o.code,
      childExit: o.childExit,
      identityCalls: o.identityCalls,
      ownershipCalls: o.ownershipCalls,
      ownershipSampleMs: o.helperRuns.filter((item) => item.kind === 'ownership').map((item) => item.ms),
      realProducerExits: o.realProducerEvents.map((item) => ({ code: item.code, signal: item.signal, bytes: item.bytes })),
      ensureElapsedMs: o.ensureElapsedMs,
      message: o.message,
      lockReported: o.lock !== null,
      canariesChecked: o.canariesChecked.length,
      canariesFound: o.canariesFound,
      storePreserved: o.storePreserved,
      ownerRecordPreserved: o.ownerRecordPreserved,
      logFolderEmptyAfter: Array.isArray(o.logDirAfter) && o.logDirAfter.length === 0,
      helperRootsExitedNaturallyZero: o.helperRootsExitedNaturallyZero,
      portFreeAfter: o.portFreeAfter,
      sentinelAlive: o.sentinelAlive,
      port: o.port,
    },
    controlsPassed: `${controlsPassed}/${record.controls.length}`,
    failedControls: record.controls.filter((item) => !item.pass).map((item) => item.name),
    failedPredictionChecks: record.predictionChecks.filter((item) => !item.pass).map((item) => item.name),
    failedContractChecks: record.correctedContractChecks.filter((item) => !item.pass).map((item) => item.name),
    rawStatus: record.status,
    correctedContract: record.correctedContract,
    intendedPredictionDifference: intended,
    expectedRawStatus: expectedRaw,
    candidateAcceptance: accepted ? 'ACCEPTED' : 'NOT-ACCEPTED',
  };
});
const q09 = readFileSync(join(f3Dir, 'Q09', 'responses', 'ownership-1.bin'));
const f3 = {
  runId: f3RunId,
  driver: 'baseline driver/v2 (unchanged)',
  runStatus: f3Run.status,
  setupFaults: f3Run.setupFaults,
  rawSummary: f3Run.summary,
  ports: { reservation: f3Run.ports, used: [...new Set(f3Cases.map((item) => item.observed.port))] },
  sentinel: { aliveAtTeardown: f3Run.sentinel.aliveAtTeardown, teardown: f3Run.sentinel.teardown.kind, teardownSignal: f3Run.sentinel.teardown.signal },
  preflight: { exit: f3Run.preflight.exit, setup: f3Run.preflight.result?.setup ?? null },
  counts: {
    cases: f3Cases.length,
    correctedContractConforms: f3Cases.filter((item) => item.correctedContract === 'CONFORMS').length,
    correctedContractViolates: f3Cases.filter((item) => item.correctedContract === 'VIOLATES').length,
    controlsPassed: f3Cases.reduce((sum, item) => sum + Number(item.controlsPassed.split('/')[0]), 0),
    controlsTotal: f3Cases.reduce((sum, item) => sum + Number(item.controlsPassed.split('/')[1]), 0),
    rawMatchedPrediction: f3Cases.filter((item) => item.rawStatus === 'MATCHED-PREDICTION').length,
    rawDifferedFromPrediction: f3Cases.filter((item) => item.rawStatus === 'DIFFERED-FROM-PREDICTION').length,
    rawSetupFault: f3Cases.filter((item) => item.rawStatus === 'SETUP-FAULT').length,
    differedIds: f3Cases.filter((item) => item.rawStatus === 'DIFFERED-FROM-PREDICTION').map((item) => item.id),
    differedExactlyIntended: JSON.stringify(f3Cases.filter((item) => item.rawStatus === 'DIFFERED-FROM-PREDICTION').map((item) => item.id)) === JSON.stringify(INTENDED),
    authorizedFreshGatewayStartPath: f3Cases.filter((item) => item.observed.authorizedFreshGateway).length,
    refusedBeforeGatewayStart: f3Cases.filter((item) => !item.observed.authorizedFreshGateway).length,
    malformedAuthorizedFreshGateway: f3Cases.filter((item) => item.observed.authorizedFreshGateway && !['Q01', 'Q02', 'Q03', 'Q04'].includes(item.id)).length,
    privacyCanaryLeaks: f3Cases.reduce((sum, item) => sum + item.observed.canariesFound.length, 0),
    storeNotPreserved: f3Cases.filter((item) => !item.observed.storePreserved).length,
    accepted: f3Cases.filter((item) => item.candidateAcceptance === 'ACCEPTED').length,
    distinctClosedMessages: [...new Set(f3Cases.map((item) => item.observed.message))].length,
  },
  q09Payload: { bytes: q09.length, sha256: createHash('sha256').update(q09).digest('hex'), utf8: q09.toString('utf8'), matchesBaselineOriginal: createHash('sha256').update(q09).digest('hex') === '9fb5d4511478937a531fcb52fe399c2d424b54b50dae94afac971a4ea3da6889' && q09.length === 37 },
  cases: f3Cases,
};
f3.distinctClosedMessages = [...new Set(f3Cases.map((item) => item.observed.message))];

// ---------- F4 ----------
const f4RunId = only(join(out, 'private', 'f4'));
const f4Run = json(join(out, 'private', 'f4', f4RunId, 'run.json'));
const f4Result = json(join(out, 'private', 'f4', f4RunId, 'f4-result.json'));
const f4 = {
  runId: f4RunId,
  status: f4Run.status,
  seam: f4Result.seam,
  cleanupMilliseconds: f4Result.cleanupMilliseconds,
  binding: { launcherSourceSha256: f4Run.inputs.launcherSource.sha256, launcherGitBlob: f4Run.checkout.launcherGitBlob, harnessSourceSha256: f4Run.inputs.harnessSource.sha256, assemblySha256: f4Run.assembly.sha256, assemblyBytes: f4Run.assembly.bytes, compilerSha256: f4Run.compile.compiler.sha256, compileExit: f4Run.compile.exit, compileArgs: f4Run.compile.args },
  execution: { exit: f4Run.execution.exit, watchdog: f4Run.execution.watchdog, ms: f4Run.execution.ms },
  summary: f4Run.summary,
  cases: f4Result.cases.map((item) => ({ id: item.id, name: item.name, purpose: item.purpose, expectedResult: item.expectedResult, actualResult: item.actualResult, trace: item.trace, samples: item.samples, observations: item.observations, wallMs: item.wallMs, checks: item.checks.map((check) => ({ name: check.name, pass: check.pass })), verdict: item.verdict })),
};

// ---------- native ----------
const nativeRunId = only(join(out, 'private', 'native'));
const nativeRun = json(join(out, 'private', 'native', nativeRunId, 'run.json'));
const native = {
  runId: nativeRunId,
  status: nativeRun.status,
  existingSubtest: "tooling/scripts/windows-launcher.acceptance.mjs: 'bounded Windows logs: stale entry, closed outcomes, one writer per root, legacy writer and unsafe names' > 'native closed outcomes, launcher pair bounds and NUL stdio checks'",
  sources: nativeRun.sources,
  assembly: nativeRun.assembly,
  compile: { exit: nativeRun.compile.exit, args: nativeRun.compile.args, compilerSha256: nativeRun.compile.compiler.sha256 },
  entries: nativeRun.entries.map((item) => ({ id: item.id, mode: item.mode, expectation: item.expectation, exit: item.exit, signal: item.signal, timedOut: item.timedOut, ms: item.ms, stdout: item.stdout, stderr: item.stderr, verdict: item.verdict })),
  isolatedTempManagedLogNames: nativeRun.isolatedTempManagedLogNames,
  summary: nativeRun.summary,
  grouping: 'Each mode is one grouped native control that exits non-zero at its first failing internal Check; only mode verdicts are counted.',
};

// ---------- bindings ----------
const build = json(join(out, 'setup', 'f3-build-record.json'));
const results = {
  schema: 'qa459c-candidate-case-results/1',
  phase: 'independent #459 D166 corrected-source (candidate) behavioral QA; not hosted CI, general review, owner acceptance or merge permission',
  candidate: { head: '37803eeef9f55c2a316289aa502798025a7873be', tree: '647d297990837f7f21e0054c5be15a0109fab2f1', parent: '2164cd11624c88d66ae64d1ac86ae26505a6c1ea', target: '47ca4640793a81efa5bec661dba25627de314774' },
  sources: f3Run.sources,
  f3Assemblies: { launcher: build.outputs.launcherAssembly, harness: build.outputs.harnessAssembly, compilerSha256: build.compiler.sha256, compileSteps: build.steps.map((step) => ({ label: step.label, exit: step.exit, stdout: step.stdout, stderr: step.stderr })) },
  frozenInputs: {
    f3DriverV2Manifest: sha(join(baseline, 'driver', 'v2', 'MANIFEST.sha256')),
    f3DriverFileHashesAtRun: f3Run.driver,
    f4FreezeRecord: sha(join(out, 'f4', 'freeze-v1.json')),
    f4Manifest: sha(join(out, 'f4', 'v1', 'MANIFEST.sha256')),
    nativeFreezeRecord: sha(join(out, 'native', 'freeze-v1.json')),
    nativeManifest: sha(join(out, 'native', 'v1', 'MANIFEST.sha256')),
  },
  baselineReference: { caseResultsSha256: sha(join(baseline, 'case-results.json')), conforms: base.counts.conformsToCorrectedContract, violates: base.counts.violatesCorrectedContract, executions: base.counts.caseExecutions },
  f3,
  f4,
  native,
};
writeFileSync(join(out, 'case-results.json'), JSON.stringify(scrub(results), null, 2) + '\n');

// ---------- acceptance map ----------
const item = (id, claim, evidence, verdict, tier) => ({ id, claim, evidence, verdict, tier });
const f4Case = (id) => f4.cases.find((c) => c.id === id);
const nativeEntry = (id) => native.entries.find((e) => e.id === id);
const map = {
  schema: 'qa459c-candidate-acceptance-map/1',
  candidate: results.candidate,
  rule: 'Candidate F3 acceptance requires every case correctedContract CONFORMS, all 11 per-case controls passing and no setup fault. Raw status still compares with baseline predictions; Q08-Q13 and Q15 are expected DIFFERED-FROM-PREDICTION corrections.',
  f3: [
    item('F3-1', 'All 16 frozen cases conform to the D166 corrected contract', `${f3.counts.correctedContractConforms}/16 CONFORMS`, f3.counts.correctedContractConforms === 16 ? 'PASS' : 'FAIL', 'native public Gateway.Ensure path'),
    item('F3-2', 'All 11 controls pass in every case', `${f3.counts.controlsPassed}/${f3.counts.controlsTotal}`, f3.counts.controlsPassed === 176 && f3.counts.controlsTotal === 176 ? 'PASS' : 'FAIL', 'native'),
    item('F3-3', 'No setup fault', `run ${f3.runStatus}; setupFaults ${f3.setupFaults.length}; raw SETUP-FAULT ${f3.counts.rawSetupFault}`, f3.setupFaults.length === 0 && f3.counts.rawSetupFault === 0 && f3.runStatus === 'COMPLETED' ? 'PASS' : 'FAIL', 'native'),
    item('F3-4', 'Exactly Q08-Q13 and Q15 differ from baseline predictions (intended corrections); the other nine match and conform', `differed ${f3.counts.differedIds.join(',')}`, f3.counts.differedExactlyIntended && f3.counts.rawMatchedPrediction === 9 ? 'PASS' : 'FAIL', 'native'),
    item('F3-5', 'Malformed responses no longer reach the gateway-start path', `start path ${f3.counts.authorizedFreshGatewayStartPath} (Q01-Q04 valid only); malformed starts ${f3.counts.malformedAuthorizedFreshGateway}`, f3.counts.malformedAuthorizedFreshGateway === 0 ? 'PASS' : 'FAIL', 'native; marker = start-path admission, not readiness'),
    item('F3-6', 'Q15 invalid escape now refuses as helper-invalid after one sample', `code ${f3Cases.find((c) => c.id === 'Q15').observed.code}, samples ${f3Cases.find((c) => c.id === 'Q15').observed.ownershipCalls}`, f3Cases.find((c) => c.id === 'Q15').observed.code === 'helper-invalid' ? 'PASS' : 'FAIL', 'native'),
    item('F3-7', 'Q10 duplicate-name held retry retains store-held, lock and guidance', `code ${f3Cases.find((c) => c.id === 'Q10').observed.code}`, f3Cases.find((c) => c.id === 'Q10').candidateAcceptance === 'ACCEPTED' ? 'PASS' : 'FAIL', 'native'),
    item('F3-8', 'Actual producer output stays compatible (Q04 free, Q06 held/unverified)', `Q04 ${f3Cases.find((c) => c.id === 'Q04').observed.code}; Q06 ${f3Cases.find((c) => c.id === 'Q06').observed.code} with ${f3Cases.find((c) => c.id === 'Q06').observed.ownershipCalls} producer samples`, ['Q04', 'Q06'].every((id) => f3Cases.find((c) => c.id === id).candidateAcceptance === 'ACCEPTED') ? 'PASS' : 'FAIL', 'native'),
    item('F3-9', 'Q09 replays the exact escaped-name payload', `${f3.q09Payload.bytes} bytes, sha256 ${f3.q09Payload.sha256}`, f3.q09Payload.matchesBaselineOriginal ? 'PASS' : 'FAIL', 'byte identity'),
    item('F3-10', 'Privacy, record and resource preservation', `canary leaks ${f3.counts.privacyCanaryLeaks}; stores not preserved ${f3.counts.storeNotPreserved}`, f3.counts.privacyCanaryLeaks === 0 && f3.counts.storeNotPreserved === 0 ? 'PASS' : 'FAIL', 'native text/file evidence; not visual dialog QA'),
  ],
  f4: [
    ...f4.cases.map((c) => item(`F4-${c.id}`, c.purpose, `returned ${c.actualResult}, order ${c.trace}, samples ${c.samples.join(',')}`, c.verdict, 'deterministic shared-decision observation through the product seam')),
    item('F4-bind', 'Seam is the product method compiled from the committed source; source/harness/assembly bound', `Launcher.cs ${f4.binding.launcherSourceSha256}; harness ${f4.binding.harnessSourceSha256}; assembly ${f4.binding.assemblySha256}`, f4.binding.compileExit === 0 && f4.cleanupMilliseconds === 2000 ? 'PASS' : 'FAIL', 'binding'),
  ],
  native: native.entries.map((e) => item(`NATIVE-${e.id}`, `Maintained NativeChecks ${e.mode}`, `exit ${e.exit}, ${e.ms} ms`, e.verdict, 'grouped native control')),
  sourceIntegrationOnly: [
    { id: 'SRC-1', claim: 'false from AwaitCleanup maps to helper-cleanup-unconfirmed', source: 'Launcher.cs:986-1000', tier: 'SOURCE-ONLY (not observed; no fault seam authorized)' },
    { id: 'SRC-2', claim: 'held guidance retained when an inconclusive retry ends helper-cleanup-unconfirmed', source: 'Launcher.cs:1241-1247', tier: 'SOURCE-ONLY for the cleanup-unconfirmed branch; the store-held retention branch was observed natively in F3 Q07/Q10' },
    { id: 'SRC-3', claim: 'job disposal, child disposal and pending-I/O completion transfer follow the recorded decision and cannot upgrade it', source: 'Launcher.cs:995-1000', tier: 'SOURCE-ONLY' },
    { id: 'SRC-4', claim: 'ownership is parsed once, from raw decoded output before Trim, by the strict reader', source: 'Launcher.cs:953-960, 1254-1332, 1337', tier: 'source plus native F3 outcomes' },
    { id: 'SRC-5', claim: 'identity keeps its existing padding behavior', source: 'Launcher.cs:1161-1162', tier: 'source plus native F3 Q03 and N2' },
  ],
};
map.verdict = [...map.f3, ...map.f4, ...map.native].every((entry) => entry.verdict === 'PASS') ? 'PASS' : 'HOLD';
map.counts = { f3Replay: f3.counts.cases, f4Timing: f4.cases.length, native: native.entries.length };
writeFileSync(join(out, 'acceptance-map.json'), JSON.stringify(scrub(map), null, 2) + '\n');
console.log(JSON.stringify({ verdict: map.verdict, f3: f3.counts, f4: f4.summary, native: native.summary }));

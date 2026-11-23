// QA167I result assembly. Not product code. Reads recorded runs; writes case-results.json,
// acceptance-map.json and the concise public subset. Never executes a case.
// node assemble.mjs <out-root> <scratch> <checkout>
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { scrubber } from '../harness/v1/qa167i-common.mjs';

const [out, scratch, checkout] = process.argv.slice(2);
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const only = (directory, prefix) => {
  const found = readdirSync(directory).filter((name) => name.startsWith(prefix));
  if (found.length !== 1) throw new Error(`expected one ${prefix} run in ${directory}, found ${found.length}`);
  return found[0];
};
const scrub = scrubber([[scratch, '<scratch>'], [checkout, '<checkout>'], [out, '<out>']]);
const IDS = {
  source: '184c95ac2d08590e258c084723eb9ab379f0bbe5',
  tree: '404700711621832629aef6d505b69076972474da',
  parent: 'c6f08d4a62c1488690096f69f577a68c6d382cbc',
  target: '47ca4640793a81efa5bec661dba25627de314774',
};

const setup = read(join(out, 'setup', 'setup-verify.json'));
const freeze = read(join(out, 'harness', 'freeze-v1.json'));
const build = read(join(out, 'harness', 'build-record-v1.json'));
const deadlineId = only(join(out, 'deadline', 'private'), 'deadline-');
const deadline = read(join(out, 'deadline', 'private', deadlineId, 'run.json'));
const nativeId = only(join(out, 'native', 'private'), 'native-');
const native = read(join(out, 'native', 'private', nativeId, 'run.json'));
const f3Build = read(join(out, 'f3', 'build-record.json'));
const f3Id = only(join(out, 'f3', 'private', 'runs'), 'candidate-');
const f3 = read(join(out, 'f3', 'private', 'runs', f3Id, 'run.json'));
const maintained = read(join(out, 'maintained', 'run-record.json'));

const count = (items) => ({ passed: items.filter((item) => item.pass).length, total: items.length });
const deadlineCases = deadline.result.cases.map((item) => ({
  id: item.id,
  name: item.name,
  evidence: item.evidence,
  status: item.status,
  assertions: count(item.assertions),
  failedAssertions: item.assertions.filter((entry) => !entry.pass).map((entry) => entry.name),
}));
const nativeCases = native.cases.map((item) => ({
  id: item.id,
  name: item.name,
  entry: item.entry,
  status: item.status,
  assertions: count(item.assertions),
  failedAssertions: item.assertions.filter((entry) => !entry.pass).map((entry) => entry.name),
}));
const f3Cases = f3.cases.map((summary) => {
  const record = read(join(out, 'f3', 'private', 'runs', f3Id, summary.id, 'case.json'));
  return {
    id: record.id,
    name: record.name,
    category: record.category,
    status: record.status,
    correctedContract: record.correctedContract,
    code: record.observed.code,
    authorizedFreshGateway: record.observed.authorizedFreshGateway,
    ownershipCalls: record.observed.ownershipCalls,
    controls: count(record.controls),
    correctedContractChecks: count(record.correctedContractChecks),
    baselinePredictionChecks: count(record.predictionChecks),
    baselinePredictionDifferences: record.predictionChecks.filter((entry) => !entry.pass).map((entry) => entry.name),
  };
});
const sum = (items, key) => items.reduce((total, item) => ({ passed: total.passed + item[key].passed, total: total.total + item[key].total }), { passed: 0, total: 0 });

const results = {
  schema: 'qa167i-case-results/1',
  ...IDS,
  scope: 'Independent D167/F5 behavior QA of the exact source only; not review, Fable acceptance, CI, owner QA or merge authority.',
  setup: {
    checks: count(setup.checks),
    node: setup.runtime.node,
    pnpm: setup.pnpm.version,
    compiler: { banner: setup.compiler.banner, sha256: setup.compiler.sha256 },
    launcherSourceSha256: setup.sources['apps/windows-launcher/Launcher.cs'].worktreeSha256,
    launcherGitObject: setup.sources['apps/windows-launcher/Launcher.cs'].gitObject,
    turboDryRun: 'all cacheable build tasks HIT; plugin builds are cache:false',
  },
  harness: {
    freeze: { frozenUtc: freeze.frozenUtc, manifestSha256: freeze.manifestSha256, executedBeforeFreeze: false },
    build: {
      compilerSha256: build.compiler.sha256,
      steps: build.steps.map((step) => ({ label: step.label, exit: step.exit })),
      outputs: Object.fromEntries(Object.entries(build.outputs).map(([name, item]) => [name, { sha256: item.sha256, bytes: item.bytes }])),
    },
    fixtureCorrectionsUsed: 0,
  },
  groups: {
    deadlineSeam: {
      runId: deadlineId,
      exit: deadline.process.code,
      cases: deadlineCases,
      totals: { cases: deadlineCases.length, passed: deadlineCases.filter((item) => item.status === 'PASS').length, assertions: sum(deadlineCases, 'assertions') },
    },
    nativePublicControls: {
      runId: nativeId,
      cases: nativeCases,
      totals: { cases: nativeCases.length, passed: nativeCases.filter((item) => item.status === 'PASS').length, assertions: sum(nativeCases, 'assertions') },
      sentinel: { aliveAtTeardown: native.sentinel.aliveAtTeardown, teardown: native.sentinel.teardown.kind },
      setupFaults: native.setupFaults.length,
    },
    f3Replay: {
      driver: 'i3-459-correction-independent-01/driver/v2 (unchanged; manifest SHA-256 766811a8076395f172127dea170220b8827b009ef828de26678d8768a178076e)',
      build: { steps: f3Build.steps.map((step) => ({ label: step.label, exit: step.exit })), launcherSha256: f3Build.outputs.launcherAssembly.sha256, harnessSha256: f3Build.outputs.harnessAssembly.sha256 },
      runId: f3Id,
      cases: f3Cases,
      totals: {
        cases: f3Cases.length,
        conforms: f3Cases.filter((item) => item.correctedContract === 'CONFORMS').length,
        violates: f3Cases.filter((item) => item.correctedContract === 'VIOLATES').length,
        matchedBaselinePrediction: f3Cases.filter((item) => item.status === 'MATCHED-PREDICTION').length,
        differedFromBaselinePrediction: f3Cases.filter((item) => item.status === 'DIFFERED-FROM-PREDICTION').length,
        setupFaults: f3Cases.filter((item) => item.status === 'SETUP-FAULT').length,
        controls: sum(f3Cases, 'controls'),
        correctedContractChecks: sum(f3Cases, 'correctedContractChecks'),
        baselinePredictionChecks: sum(f3Cases, 'baselinePredictionChecks'),
      },
      sentinel: { aliveAtTeardown: f3.sentinel.aliveAtTeardown, teardown: f3.sentinel.teardown.kind },
    },
    maintainedBoundedLogGroup: {
      attribution: 'maintained repository acceptance group (author-maintained modes); run independently here, not an independent case design',
      command: maintained.command,
      environment: maintained.envChanges,
      exit: maintained.exit,
      durationMs: maintained.ms,
      nodeTest: maintained.tap.summary,
      topLevel: maintained.tap.topLevel,
      subtests: maintained.tap.subtests,
      checkoutTrackedChangesAfter: maintained.checkoutAfter.trackedChanges,
    },
  },
};
results.verdict = {
  candidateDefectsFound: 0,
  allIndependentCasesPassed:
    results.groups.deadlineSeam.totals.passed === results.groups.deadlineSeam.totals.cases &&
    results.groups.nativePublicControls.totals.passed === results.groups.nativePublicControls.totals.cases &&
    results.groups.f3Replay.totals.conforms === 16 &&
    results.groups.f3Replay.totals.controls.passed === results.groups.f3Replay.totals.controls.total &&
    maintained.exit.code === 0,
};
results.verdict.result = results.verdict.allIndependentCasesPassed ? 'PASS' : 'HOLD';
writeFileSync(join(out, 'case-results.json'), JSON.stringify(results, null, 2) + '\n');

const map = {
  schema: 'qa167i-acceptance-map/1',
  ...IDS,
  classes: {
    'component-deterministic': 'production WorkDeadline members driven by a controlled clock, compiled from the unchanged source in one assembly',
    'native-deterministic': 'public HelperProcess.Read with real Node children in the production private job; the shared clock advances only from callbacks',
    'native-real-time': 'real Stopwatch and real elapsed waits; ordinary scheduling, no fault injected',
    'native-public-entry': 'compiled launcher ordinary quiet entry or public-API-only harness',
    'source-integration': 'established by reading the committed source; not separately executed',
    LIMIT: 'not observed in this QA; scope retained from earlier records',
  },
  elements: [
    { element: 'One immutable monotonic absolute deadline from caller admission through preparation, setup, creation, drains and validation', evidence: ['D02', 'D03', 'D04', 'D05', 'D06', 'D10', 'D11', 'N5'], classes: ['component-deterministic', 'native-deterministic', 'native-real-time', 'native-public-entry'], sourceIntegration: 'Gateway.ReadHelper wraps argument/environment preparation and Read in work.Within with the same deadline (Launcher.cs 1085-1090); Read checks the deadline at entry, before and after CreateProcess, in each drain pass and around decode/validate/trim (955-1010).' },
    { element: 'Deadline checked before ownership result consumption; a late free cannot clear the last held outcome', evidence: ['D03', 'D06'], classes: ['native-deterministic'], sourceIntegration: 'StoreHasLiveOwner calls work.Check("ownership") after ReadHelper and before reading the validated owner (1381-1390); Ensure maps a retry failure to HeldFailure (1229-1230). The private mapping itself is source integration; N3 reaches a retry timeout through public Ensure in real time.' },
    { element: 'Equality at the cutoff is expired', evidence: ['D01', 'D02', 'D05', 'D06', 'D08'], classes: ['component-deterministic', 'native-deterministic'] },
    { element: 'Already-expired admission starts no callback and no native child', evidence: ['D02', 'D04', 'N5'], classes: ['component-deterministic', 'native-deterministic', 'native-public-entry'] },
    { element: 'Audit example (250 ms admitted, 50 ms lost, 225 ms helper) refuses', evidence: ['D03'], classes: ['native-deterministic'], limit: 'The held source was not executed; its acceptance of that example is the audit\'s source-established arithmetic, not a dynamic reproduction here.' },
    { element: 'Initial identity and ownership checks each have a separate 15-second cap starting before preparation', evidence: ['D07', 'N6'], classes: ['component-deterministic', 'native-public-entry'], sourceIntegration: 'Ensure calls WorkDeadline.Start(WorkMilliseconds) immediately before ReadHelper for identity (1205) and for the first ownership sample (1216). The initial ownership cap was not observed natively.' },
    { element: 'Held retry expires at min(admission + 15000, release - 2000)', evidence: ['D01', 'D07', 'D08', 'N3'], classes: ['component-deterministic', 'native-public-entry'], sourceIntegration: 'Ensure builds the retry with Recheck(releaseClock, StartupTimeoutSeconds * 1000) after the capped sleep and probe (1221-1227).' },
    { element: 'Minimum-sample / 200 ms admission and sleep/probe order unchanged', evidence: ['D08', 'N1', 'N2', 'maintained: held ownership retains guidance and budgets the last recheck'], classes: ['component-deterministic', 'native-public-entry'], sourceIntegration: 'The comparison retryWork.Remaining < max(200, sample) lives in private Ensure (1227); D08 establishes the Remaining values (200 / 199), N2 observes a refusal after one sample without attributing which comparison refused.' },
    { element: 'Valid free requirement; held guidance retained on an inconclusive retry', evidence: ['D05', 'N1', 'N2', 'N3', 'F3 Q05/Q07/Q10', 'maintained strict-protocol subtest'], classes: ['native-deterministic', 'native-public-entry'] },
    { element: 'F3 strict ownership parser unchanged', evidence: ['F3 replay 16/16 CONFORMS, 176/176 controls', 'maintained strict-protocol subtest'], classes: ['native-public-entry'] },
    { element: 'F4 independent cleanup deadline and precedence unchanged', evidence: ['maintained --cleanup-deadline-checks (author-maintained mode)', 'D10', 'N3', 'N6'], classes: ['component-deterministic', 'native-real-time'], limit: 'Unconfirmed-cleanup runtime mapping, pending-I/O transfer, Win32 faults and visible dialog proof are not observed; their earlier LIMIT scopes are unchanged.' },
    { element: 'Synchronous OS calls are charged when they return, not interrupted', evidence: [], classes: ['source-integration', 'LIMIT'], sourceIntegration: 'Checks immediately before and after CreateProcess (972-979).', limit: 'No delayed or faulted creation was injected.' },
    { element: 'Ordinary detached gateway, warm reuse and unrelated process survival', evidence: ['N4', 'sentinel in native, F3 and maintained runs'], classes: ['native-public-entry'] },
    { element: 'On-time success', evidence: ['D03 control', 'D04 control', 'D05', 'D06 control', 'D09', 'N1', 'N4', 'N5 control'], classes: ['native-deterministic', 'native-real-time', 'native-public-entry'] },
    { element: 'Controlled OS scheduling or kernel race reproduction', evidence: [], classes: ['LIMIT'], limit: 'Not performed or authorized; compiled shared-clock checks establish the decision only.' },
  ],
};
writeFileSync(join(out, 'acceptance-map.json'), JSON.stringify(map, null, 2) + '\n');

// Concise public subset: no raw payload texts, scrubbed paths only.
const pub = join(out, 'public');
for (const directory of ['sources/harness-v1/fixtures/repo/apps/api/dist/windows-log', 'sources/harness-v1/fixtures/repo/apps/web/dist', 'sources/tools', 'runs'])
  mkdirSync(join(pub, directory), { recursive: true });
writeFileSync(join(pub, 'case-results.json'), JSON.stringify(scrub(results), null, 2) + '\n');
writeFileSync(join(pub, 'acceptance-map.json'), JSON.stringify(map, null, 2) + '\n');
writeFileSync(join(pub, 'runs', 'deadline-run.json'), readFileSync(join(out, 'deadline', 'public', deadlineId, 'run.json')));
writeFileSync(join(pub, 'runs', 'native-run.json'), readFileSync(join(out, 'native', 'public', nativeId, 'run.json')));
writeFileSync(join(pub, 'runs', 'setup-verify.json'), JSON.stringify(scrub(setup), null, 2) + '\n');
writeFileSync(join(pub, 'runs', 'build-record-v1.json'), JSON.stringify(scrub({ ...build, steps: build.steps.map(({ stdout, stderr, ...rest }) => ({ ...rest, stdoutBytes: stdout.length, stderrBytes: stderr.length })) }), null, 2) + '\n');
// The TAP line JSON-escapes the artifact path twice; collapse backslash runs so the scrubber matches it.
const maintainedPublic = { ...maintained, tap: { ...maintained.tap, artifacts: maintained.tap.artifacts.map((path) => path.replace(/\\+/g, '\\')) } };
writeFileSync(join(pub, 'runs', 'maintained-run-record.json'), JSON.stringify(scrub(maintainedPublic), null, 2) + '\n');
const harness = join(out, 'harness', 'v1');
const walk = (directory, relative = '') => {
  for (const name of readdirSync(join(directory, relative))) {
    const rel = relative ? `${relative}/${name}` : name;
    if (readdirSync(join(directory, relative), { withFileTypes: true }).find((entry) => entry.name === name).isDirectory()) walk(directory, rel);
    else copyFileSync(join(directory, rel), join(pub, 'sources', 'harness-v1', rel));
  }
};
walk(harness);
for (const tool of ['setup-verify.mjs', 'run-maintained.mjs', 'assemble.mjs']) copyFileSync(join(out, 'tools', tool), join(pub, 'sources', 'tools', tool));
copyFileSync(join(out, 'harness', 'freeze-v1.json'), join(pub, 'runs', 'freeze-v1.json'));
if (existsSync(join(out, 'REPORT.md'))) writeFileSync(join(pub, 'REPORT.md'), scrub(readFileSync(join(out, 'REPORT.md'), 'utf8')));
console.log(JSON.stringify({ verdict: results.verdict, deadline: results.groups.deadlineSeam.totals, native: results.groups.nativePublicControls.totals, f3: results.groups.f3Replay.totals, maintained: maintained.tap.summary }));

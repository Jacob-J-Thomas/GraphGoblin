// QA459I aggregation. Not product code and not a driver: it only reads preserved private run
// records and writes scrubbed machine-readable projections (case-results.json, acceptance-map.json).
// node qa459i-aggregate.mjs --out <out> --checkout <checkout> --scratch <scratch>
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const option = (name) => process.argv[process.argv.indexOf(name) + 1];
const out = option('--out');
const checkout = option('--checkout');
const scratch = option('--scratch');
const RUN1 = 'baseline-20261121T042951Z-e1e0e8';
const RUN2 = 'baseline-20261121T043159Z-5ff66d';
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const roots = [[scratch, '<scratch>'], [checkout, '<checkout>'], [out, '<out>'], [homedir(), '<home>']];
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
const load = (run, id) => JSON.parse(readFileSync(join(out, 'private', 'runs', run, id, 'case.json'), 'utf8'));
const runRecord = (run) => JSON.parse(readFileSync(join(out, 'private', 'runs', run, 'run.json'), 'utf8'));
const run1 = runRecord(RUN1);
const run2 = runRecord(RUN2);

function summarize(record, run, driver) {
  const o = record.observed;
  return {
    id: record.id,
    name: record.name,
    category: record.category,
    run,
    driver,
    responses: {
      identity: { bytes: record.responses.identity.bytes, sha256: record.responses.identity.sha256 },
      ownership: record.responses.ownership.map(({ text, ...rest }) => rest),
      realProducerOutputs: record.responses.realProducerOutputs.map(({ text, ...rest }) => rest),
    },
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
      ensureElapsedMs: o.ensureElapsedMs,
      message: o.message,
      lockReported: o.lock !== null,
      canariesFound: o.canariesFound,
      storePreserved: o.storePreserved,
      ownerRecordPreserved: o.ownerRecordPreserved,
      logFolderEmptyAfter: Array.isArray(o.logDirAfter) && o.logDirAfter.length === 0,
      helperRootsExitedNaturallyZero: o.helperRootsExitedNaturallyZero,
      portFreeAfter: o.portFreeAfter,
      sentinelAlive: o.sentinelAlive,
      port: o.port,
    },
    controlsPassed: `${record.controls.filter((item) => item.pass).length}/${record.controls.length}`,
    failedPredictionChecks: record.predictionChecks.filter((item) => !item.pass).map((item) => item.name),
    failedContractChecks: record.correctedContractChecks.filter((item) => !item.pass).map((item) => item.name),
    status: record.status,
    correctedContract: record.correctedContract,
  };
}

const ids = run1.cases.map((item) => item.id);
const authoritative = ids.map((id) => (id === 'Q06' ? summarize(load(RUN2, 'Q06'), RUN2, 'v2') : summarize(load(RUN1, id), RUN1, 'v1')));
const superseded = [summarize(load(RUN1, 'Q06'), RUN1, 'v1')];
const count = (list, predicate) => list.filter(predicate).length;
const executions = [...ids.map((id) => load(RUN1, id)), load(RUN2, 'Q06')];

const caseResults = {
  schema: 'qa459i-case-results/1',
  phase: 'independent #459 D166 correction BASELINE QA (held head); not candidate QA',
  held: { head: run1.checkout.head, tree: run1.checkout.tree, target: '47ca4640793a81efa5bec661dba25627de314774', parent: '11214dadbde049af01dd0280b9b701ad10a0f50a' },
  sources: run1.sources,
  assemblies: { launcher: run1.assemblies.launcher.sha256, harness: run1.assemblies.harness.sha256, launcherSource: run1.assemblies.launcherSourceAtBuild },
  driverManifests: {
    v1: sha(join(out, 'driver', 'v1', 'MANIFEST.sha256')),
    v2: sha(join(out, 'driver', 'v2', 'MANIFEST.sha256')),
  },
  runs: [
    { runId: RUN1, driver: 'v1', startUtc: run1.startUtc, endUtc: run1.endUtc, status: run1.status, setupFaults: run1.setupFaults.length, summary: run1.summary, driverHashes: run1.driver },
    { runId: RUN2, driver: 'v2', startUtc: run2.startUtc, endUtc: run2.endUtc, status: run2.status, setupFaults: run2.setupFaults.length, summary: run2.summary, driverHashes: run2.driver, purpose: 'single corrective re-execution of Q06 after the v2 expectation correction' },
  ],
  counts: {
    casesDefined: ids.length,
    caseExecutions: executions.length,
    runLevelSetupFaults: run1.setupFaults.length + run2.setupFaults.length,
    driverAssumptionCorrections: 1,
    authorizedFreshGatewayStartPath: count(authoritative, (item) => item.observed.authorizedFreshGateway),
    refusedBeforeGatewayStart: count(authoritative, (item) => !item.observed.authorizedFreshGateway),
    matchedPrediction: count(authoritative, (item) => item.status === 'MATCHED-PREDICTION'),
    conformsToCorrectedContract: count(authoritative, (item) => item.correctedContract === 'CONFORMS'),
    violatesCorrectedContract: count(authoritative, (item) => item.correctedContract === 'VIOLATES'),
    malformedAuthorizedFreshGateway: count(authoritative, (item) => item.observed.authorizedFreshGateway && !item.correctedExpectation.authorizes),
    privacyCanaryLeaksAcrossExecutions: executions.reduce((sum, item) => sum + item.observed.canariesFound.length, 0),
    storeNotPreservedAcrossExecutions: count(executions, (item) => !item.observed.storePreserved),
    distinctClosedMessages: [...new Set(executions.map((item) => scrub(item.observed.message).replace(/<scratch>\\runs\\[^\\]+\\Q\d\d\\/g, '<case>\\')))],
  },
  cases: authoritative,
  supersededExecutions: superseded.map((item) => ({ ...item, note: 'v1 expectation required >=2 ownership samples; observed 1 because the actual producer sample took 3,375 ms. Retained unchanged; superseded for the expectation only by the v2 re-execution.' })),
};
writeFileSync(join(out, 'case-results.json'), JSON.stringify(scrub(caseResults), null, 2) + '\n');

const byId = Object.fromEntries(authoritative.map((item) => [item.id, item]));
const verdict = (list) => (list.every((id) => byId[id].correctedContract === 'CONFORMS') ? 'BASELINE-CONFORMS' : list.every((id) => byId[id].correctedContract === 'VIOLATES') ? 'BASELINE-VIOLATES' : 'BASELINE-MIXED');
const entry = (id, requirement, cases, note) => ({ id, requirement, cases, baseline: verdict(cases), observed: cases.map((c) => `${c}: ${byId[c].observed.authorizedFreshGateway ? 'gateway start path reached' : 'refused before start'}, ${byId[c].observed.code}`), note });
const acceptance = {
  schema: 'qa459i-acceptance-map/1',
  phase: 'BASELINE (held 2164cd11); candidate QA PENDING; not a PASS, review sign-off, owner acceptance or merge permission',
  verdict: 'BASELINE CHARACTERIZED',
  F3: [
    entry('F3-1', 'A valid in-budget free response authorizes the ordinary fresh gateway start path', ['Q01', 'Q02', 'Q03', 'Q04'], 'Controls; must remain on the candidate.'),
    entry('F3-2', 'A valid held response refuses with closed held guidance and the lock, without a fresh start', ['Q05', 'Q06'], 'Controls; Q06 is the actual producer.'),
    entry('F3-3', 'Legal JSON whitespace, field order, \\u and path escaping and producer output stay valid', ['Q02', 'Q04', 'Q05', 'Q06'], 'Controls.'),
    entry('F3-4', "The identity helper's existing padding behavior is preserved", ['Q03'], 'Control.'),
    entry('F3-5', 'JavaScript-only syntax cannot authorize a start; initial invalid output is helper-invalid', ['Q08'], 'F3 audit example reproduced at the compiled public path.'),
    entry('F3-6', 'Non-JSON whitespace between tokens cannot authorize a start', ['Q13'], 'Malformed syntax.'),
    entry('F3-7', 'Duplicate decoded member names are rejected', ['Q09'], 'Conflicting state fields reproduce the audit example.'),
    entry('F3-8', 'Outer non-JSON whitespace is rejected (raw decoded response validated before trimming)', ['Q11', 'Q12'], 'Leading U+00A0 and trailing U+000C.'),
    entry('F3-9', 'Unknown fields are rejected', ['Q14'], 'Held baseline already refuses through its field count.'),
    entry('F3-10', 'Invalid string escapes are rejected; initial invalid output is helper-invalid', ['Q15'], 'Held baseline refuses as store-held (no start); the diagnostic differs from the corrected contract.'),
    entry('F3-11', 'Trailing non-whitespace material is rejected', ['Q16'], 'Held baseline already refuses.'),
    entry('F3-12', 'An inconclusive retry after held keeps the held reason, lock and full guidance', ['Q07'], 'Control.'),
    entry('F3-13', 'A malformed retry after held cannot authorize a start; held guidance is retained', ['Q10'], 'Duplicate-name retry reaches the start path on the held baseline.'),
  ],
  crossCutting: [
    { id: 'X-1', requirement: 'No raw helper output, stderr canary or response canary in LauncherFailure.Message, Program.Present text or LauncherLog.Build record', executions: executions.length, leaks: caseResults.counts.privacyCanaryLeaksAcrossExecutions, baseline: caseResults.counts.privacyCanaryLeaksAcrossExecutions === 0 ? 'BASELINE-CONFORMS' : 'BASELINE-VIOLATES' },
    { id: 'X-2', requirement: 'Driver-owned owner record and unrelated store sentinel stay byte-identical; no gateway.log/launcher.log written', executions: executions.length, notPreserved: caseResults.counts.storeNotPreservedAcrossExecutions, baseline: caseResults.counts.storeNotPreservedAcrossExecutions === 0 ? 'BASELINE-CONFORMS' : 'BASELINE-VIOLATES' },
    { id: 'X-3', requirement: 'Unrelated same-executable sentinel survives; owned port free after each case; helper roots exit naturally with 0', executions: executions.length, baseline: executions.every((item) => item.observed.sentinelAlive && item.observed.portFreeAfter && item.observed.helperRootsExitedNaturallyZero) ? 'BASELINE-CONFORMS' : 'BASELINE-VIOLATES' },
    { id: 'X-4', requirement: 'API lock as an independent boundary', baseline: 'LIMIT', note: 'Not exercised: the fixture gateway main script never opens a store. A reached start path is not store mutation, and none is claimed.' },
  ],
  F4: { status: 'SOURCE-ONLY', note: 'No timing seam exists at the held head; no fake API, simulated race or OS reproduction. See REPORT.md F4 section.' },
  candidate: { status: 'PENDING', note: 'Separately dispatched after an immutable corrected commit; uses driver v2 for F3 plus the product shared deterministic observation/clock seam at 1,999/2,000/2,001 ms and a deadline-crossing poll for F4.' },
};
writeFileSync(join(out, 'acceptance-map.json'), JSON.stringify(scrub(acceptance), null, 2) + '\n');
console.log(JSON.stringify(caseResults.counts, null, 1));
console.log(acceptance.F3.map((item) => `${item.id} ${item.baseline}`).join('\n'));

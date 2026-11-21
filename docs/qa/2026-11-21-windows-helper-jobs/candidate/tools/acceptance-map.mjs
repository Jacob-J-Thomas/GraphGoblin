// GraphGoblin #459 independent native QA: machine-readable acceptance map. Every PASS criterion is
// re-derived from the referenced candidate assertions (any failing or missing assertion => FAIL);
// LIMIT criteria carry their reason. Referenced run files are bound by sha256.
// Usage: node acceptance-map.mjs <five-intents qa root> <output json>
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [root, output] = process.argv.slice(2);
const sha = (relative) => createHash('sha256').update(readFileSync(join(root, relative))).digest('hex');
const LANES = {
  'baseline-formal': 'i3-459-native-qa/baseline/baseline-20261121T013403Z-b281ea',
  matched: 'i3-459-native-qa-candidate/matched/candidate-20261121T014803Z-3edac9',
  'job-host': 'i3-459-native-qa-candidate/job-host/candidate-20261121T015345Z-4619c4',
  ext: 'i3-459-native-qa-candidate/ext/candidate-20261121T020839Z-081d57',
  'ext-baseline': 'i3-459-native-qa-candidate/ext-baseline/baseline-20261121T021033Z-3c576e',
};
const CANDIDATE_LANES = ['matched', 'job-host', 'ext'];
const caseCache = new Map();
const loadCase = (lane, id) => {
  const key = `${lane}/${id}`;
  if (!caseCache.has(key)) caseCache.set(key, JSON.parse(readFileSync(join(root, LANES[lane], 'cases', `${id}.json`), 'utf8')));
  return caseCache.get(key);
};
const files = Object.fromEntries(
  Object.entries(LANES).flatMap(([lane, dir]) => [[`${lane}/run.json`, sha(`${dir}/run.json`)], [`${lane}/summary.json`, sha(`${dir}/summary.json`)]]),
);
for (const extra of [
  'i3-459-native-qa/MANIFEST-SHA256.txt',
  'i3-459-native-qa/REPORT.md',
  'i3-459-native-qa/coordinator-verified.json',
  'i3-459-native-qa/coordinator-count-correction.md',
  'i3-459-native-qa-candidate/analysis.json',
  'i3-459-native-qa-candidate/maintained-control/maintained-helper-checks.json',
  'i3-459-native-qa-candidate/private-raw/RAW-INDEX.json',
  'i3-459-native-qa-candidate/public-leak-scan.json',
  'i3-459-native-qa-candidate/public/setup-exploration/out-1.nest-explore.json',
  'i3-459-native-qa-candidate/public/setup-exploration/out-2.nest-explore.json',
  'i3-459-native-qa-candidate/public/setup-exploration/quota-1.quota-explore.json',
  'i3-459-native-qa-candidate/public/driver/qa459-ext-vs-baseline.diff',
  'i3-459-native-qa-candidate/public/driver/qa459-ext-v1-frozen.sha256',
  'i3-459-native-qa-candidate/public/driver/baseline-driver-copy-initial.sha256',
])
  files[extra] = sha(extra);

// [id, criterion (ADR-0086 / brief), evidence refs "lane:case:assertion[,assertion]", status override, note]
const P = (id, criterion, refs, note = null) => ({ id, criterion, refs, note });
const L = (id, criterion, reason, refs = []) => ({ id, criterion, refs, limit: reason });
const CRITERIA = [
  P('C01', 'Baseline evidence intact: all 345 manifest entries match; formal summary is 10 controls / 10 expected baseline failures / 0 setup faults (coordinator recount; original 9/11 headline preserved)', [], 'Verified by sha256sum -c of i3-459-native-qa/MANIFEST-SHA256.txt (345 OK, file set equal) and recount of baseline-formal/summary.json.'),
  P('C02', 'Unchanged baseline driver on the candidate (detached host, --job-exit-code 3762750553): every requirement and control passes; every expected baseline failure flips', [
    'matched:*',
  ], '20/20 candidate-pass; 23/23 baseline expected-failure assertions flip to pass; 66/66 baseline-passing assertions still pass; 0 setup faults.'),
  P('C03', 'Compatible enclosing job via the existing --launcher-host job option (driver libuv job: kill-on-close, silent breakaway)', ['job-host:*'], '20/20 candidate-pass with the same assertions and job-exit code.'),
  P('C04', 'Compatible explicit enclosing job (kill-on-close, no breakaway, no UI limits, verified nestable from inside): nested helper succeeds; helper tree is a member of the enclosing job', [
    'ext:ext-compatible-job-success:identity-accepted,helper-nested-in-enclosing-job,root-natural-zero,short-both-quiesced-before-exit,short-none-quiesced-before-exit',
  ]),
  P('C05', 'Helper owns a private kill-on-close job assigned at creation: every helper root is already in a job at its first witnessed instruction (handshake); detached, PowerShell-created and nested descendants are collected with it', [
    'matched:deadline-running-root:identity-1-terminated-by-launcher,ps-query-terminated-by-launcher,ps-nested-terminated-by-launcher,held-stdout-terminated-by-launcher',
    'ext:ext-compatible-job-deadline:identity-1-terminated-by-launcher,ps-query-terminated-by-launcher,ps-nested-terminated-by-launcher,held-stdout-terminated-by-launcher,held-none-terminated-by-launcher',
  ], 'Helper roots inAnyJob at handshake: candidate 23/23 (matched), 23/23 (job-host), 12/12 (ext); baseline 0/26. Atomicity of PROC_THREAD_ATTRIBUTE_JOB_LIST assignment itself is an API property (see C27).'),
  P('C06', 'Selected 15,000 ms initial work cap: deadline refusals return helper-timeout after the full window and within 15 s + 2 s + slack', [
    'matched:deadline-running-root:helper-timeout,first-check-bound',
    'matched:held-stdout-root-exits:helper-timeout,first-check-bound',
    'matched:held-stderr-root-exits:helper-timeout,first-check-bound',
    'matched:no-pipe-root-exits:helper-timeout,first-check-bound',
    'ext:ext-compatible-job-deadline:helper-timeout,work-window-honoured',
  ], 'Launcher elapsed 15,128-15,157 ms; first job termination 15,106-15,124 ms after launcher start. Four sequential 5 s probes refuse inside 15-18 s in the maintained control (see C24).'),
  P('C07', 'Two-second cleanup allowance and explicit termination code 0xE0470459 whenever the launcher terminates its job', [
    'ext:ext-compatible-job-deadline:cleanup-within-allowance',
    'ext:ext-stdout-over-cap-running:identity-1-terminated-by-launcher',
  ], 'Every launcher-collected termination carries 3762750553: matched 9/9, job-host 9/9, ext 6/6. Launcher exit 11-50 ms after the first termination. The code assertion is not applied to creator death (C10).'),
  P('C08', 'Both EOFs and zero active processes required for success; ordinary short-lived members (pipe-holding and no-pipe) quiesce inside the window', [
    'matched:eof-short-child:identity-accepted,short-child-natural-before-exit,root-natural-zero',
    'matched:no-pipe-short-child:short-child-quiesced-before-exit,short-child-natural',
    'matched:held-stdout-root-exits:helper-timeout,held-stdout-terminated-by-launcher,root-keeps-natural-exit',
    'matched:held-stderr-root-exits:helper-timeout,held-stderr-terminated-by-launcher,root-keeps-natural-exit',
    'matched:no-pipe-root-exits:helper-timeout,held-none-terminated-by-launcher,root-keeps-natural-exit',
  ]),
  P('C09', 'Caller stdio is never held by the helper tree (explicit handle list: NUL stdin and two private pipe writers only)', [
    'matched:deadline-running-root:caller-eof-at-launcher-exit',
    'matched:held-stderr-root-exits:caller-eof-at-launcher-exit',
    'matched:no-pipe-root-exits:caller-eof-at-launcher-exit',
    'ext:ext-creator-death-helper-ready:caller-eof-at-launcher-exit',
    'ext:ext-creator-death-root-exited:caller-eof-at-launcher-exit',
  ], 'Caller EOF after launcher exit: max 0 ms (matched, job-host, 21 invocations each), max 4 ms (ext); baseline had 4 invocations pending until teardown. Handle-level enumeration of the helper tree was not collected.'),
  P('C10', 'Creator death at acknowledged points (helper-ready; root-exited with descendants ready): exact launcher handle terminated, harness job held open, helper tree ends within 2 s by the private job, before any harness teardown', [
    'ext:ext-creator-death-helper-ready:boundary-reached-launcher-killed,identity-1-ended-with-creator,ps-query-ended-with-creator,ps-nested-ended-with-creator,held-stdout-ended-with-creator,held-none-ended-with-creator,harness-open-and-empty-after-cleanup',
    'ext:ext-creator-death-root-exited:boundary-reached-launcher-killed,root-keeps-natural-exit,held-stdout-ended-with-creator,held-none-ended-with-creator,harness-open-and-empty-after-cleanup',
  ], 'All 7 helper-tree processes ended 4-6 ms after the launcher was killed with OS-assigned kill-on-close exit code 0 (no 0xE0470459 assertion: the launcher never called TerminateJobObject). Baseline: all survived.'),
  P('C11', 'Job accounting with observer handles retained and after they close (open harness job; the private job\'s own accounting is launcher self-observation)', [
    'ext:ext-compatible-job-success:accounting-empty-with-and-without-observers',
    'ext:ext-compatible-job-deadline:accounting-empty-harness-open',
  ], 'Active processes 0 with witness handles retained and again after closing them, totals unchanged. Success with retained observer handles also holds in every base-suite success case.'),
  P('C12', 'Incompatible enclosing job (in-job probe: nested and plain creation refused with 1816): refusal before the first helper exists, actionable helper-containment diagnostic, unrelated sentinel and job sibling survive', [
    'ext:ext-incompatible-job-cold:helper-containment,refused-before-first-helper,actionable-containment-diagnostic,prompt-refusal,no-gateway-spawn,job-sibling-alive,sentinel-alive',
  ], 'Exactly one process (the launcher) added to the enclosing job across the click; refusal in 138 ms (formal run). Baseline refused with helper-unavailable.'),
  P('C13', 'Warm click on an incompatible host refuses even with a live matching gateway; the existing gateway stays directly callable', [
    'ext:ext-incompatible-job-warm-click:cold-exit-zero,warm-click-refuses,gateway-still-callable,job-sibling-alive,sentinel-alive',
  ]),
  L('C14', 'Outer job with a verified effective UI restriction that prevents nesting', 'Not constructible on this host: every UI restriction (each of the 8 flags and 0xFF) reads back effective from inside the job, yet nested CreateProcess(JOB_LIST) and AssignProcessToJobObject succeed on Windows 11 10.0.26300. Nesting failed only when the inner job also had UI restrictions (error 50), which the candidate\'s private job never has. The launcher inside an all-UI-restricted job behaved as the verified capability predicts (nested helper ran, sibling survived). The verified incompatible host for C12/C13 is an active-process-limited job instead.', [
    'ext:ext-ui-restricted-job:ui-restriction-effective,outcome-matches-host-capability,job-sibling-alive,sentinel-alive',
  ]),
  P('C15', 'Concurrent drain: unread-stderr deadlock removed (1 MiB stderr flood then valid result succeeds); stderr is discarded and never forwarded', [
    'matched:stderr-flood-success:identity-accepted,root-natural-zero,within-work-budget,stderr-sentinel-private',
  ]),
  P('C16', 'Stdout retention capped at 256 KiB: exactly 262,144 bytes accepted; 262,145 refused helper-invalid; oversize from a running root refused inside the work window with job termination', [
    'ext:ext-stdout-at-cap-valid:identity-accepted,root-natural-zero',
    'ext:ext-stdout-cap-plus-one:helper-invalid,prompt,root-ended-before-launcher-exit',
    'ext:ext-stdout-over-cap-running:helper-invalid,refused-before-deadline,identity-1-terminated-by-launcher,no-helper-bytes-forwarded',
  ]),
  P('C17', 'Strict UTF-8 and complete stage-protocol validation inside the work window (helper-invalid)', [
    'matched:invalid-utf8-stdout:helper-invalid,refused',
    'matched:malformed-stdout:helper-invalid,refused',
    'ext:ext-strict-utf8-ownership:helper-invalid,lock-unchanged',
  ], 'An invalid byte inside an otherwise valid held ownership answer refuses helper-invalid on the candidate; the lenient baseline reported store-held.'),
  P('C18', 'Held retry reserve: stalled recheck keeps the held reason and full advice inside the release wait; no recheck or unbudgeted final query when the 2 s reserve cannot fit the measured sample; clean held-to-free start', [
    'matched:held-store-recheck-stalls:store-held-retained,release-wait-bound,store-state-2-terminated-by-launcher,ps-query-terminated-by-launcher,lock-unchanged',
    'matched:held-store-too-little-time:single-ownership-sample,no-unbudgeted-final-query,prompt-after-single-sample,store-held,lock-unchanged',
    'matched:held-store-to-free:exit-zero,one-gateway-spawn,held-then-free,lock-unchanged',
    'job-host:held-store-recheck-stalls:store-held-retained,release-wait-bound',
    'job-host:held-store-too-little-time:single-ownership-sample,no-unbudgeted-final-query',
  ], 'Stalled recheck: store-held 7,039 ms after the first sample (bound 10,500); stderr keeps the lock location and the full refusal advice. Too little time: 1 sample, exit 29 ms after it.'),
  P('C19', 'Closed outcome taxonomy observed natively: helper-containment, helper-unavailable, helper-timeout, helper-refused (natural nonzero, child exit retained), helper-invalid', [
    'ext:ext-incompatible-job-cold:helper-containment',
    'matched:creation-failure:helper-unavailable,prompt-refusal,no-helper-started',
    'matched:privacy-refused:helper-refused,root-natural-one',
    'matched:deadline-running-root:helper-timeout',
    'matched:malformed-stdout:helper-invalid',
  ], 'helper-cleanup-unconfirmed and full decision-point precedence: see C25/C26.'),
  P('C20', 'Stderr privacy: synthetic sentinel never reaches launcher stdout/stderr, launcher.log(.1) or gateway.log; diagnostics carry no exception text', [
    'matched:privacy-refused:stderr-sentinel-private',
    'matched:privacy-success:identity-accepted,stderr-sentinel-private',
    'matched:stderr-flood-success:stderr-sentinel-private',
    'ext:ext-incompatible-job-cold:actionable-containment-diagnostic',
  ], 'Privacy leak lists are empty in every case of every candidate lane. Native dialog rendering was not exercised (quiet mode): see C29.'),
  P('C21', 'Gateway independence: separate detached launch survives its launcher, warm reuse keeps the same PID, caller EOF prompt, untouched by helper cleanup', [
    'matched:quick-success-fixture-gateway:cold-exit-zero,one-gateway-spawn,warm-reuse-same-gateway,caller-eof-prompt',
    'matched:real-cold-warm-reuse:cold-exit-zero,gateway-exact-handle,warm-reuse-same-pid,caller-eof-prompt',
    'job-host:real-cold-warm-reuse:cold-exit-zero,gateway-exact-handle,warm-reuse-same-pid,caller-eof-prompt',
    'ext:ext-incompatible-job-warm-click:gateway-still-callable',
  ], 'Gateway job membership is identical to baseline (fixture gateway inAnyJob=false; real gateway inAnyJob=true, unexplained on both).'),
  P('C22', 'Sentinel survival: the same-executable sentinel (also the WMI-queried process) and unrelated job siblings survive every case', [
    'matched:deadline-running-root:sentinel-alive',
    'matched:held-store-recheck-stalls:sentinel-alive',
    'ext:ext-creator-death-helper-ready:sentinel-alive',
    'ext:ext-incompatible-job-cold:job-sibling-alive',
    'ext:ext-ui-restricted-job:job-sibling-alive',
  ], 'Run sentinel alive in every sample: 41/41 (matched), 41/41 (job-host), 27/27 (ext); released by the driver (47) only after the run.'),
  P('C23', 'Real unmodified API/helper and WMI controls: direct identity/free/held outputs, cold gateway start, warm reuse, held refusal for a live owner', [
    'matched:real-helper-direct-timing:identity-digest,store-free,store-held-live-owner',
    'matched:real-cold-warm-reuse:cold-exit-zero,warm-reuse-same-pid',
    'matched:real-held-store:store-held,lock-unchanged,no-gateway-spawn,owner-alive',
    'job-host:real-helper-direct-timing:identity-digest,store-free,store-held-live-owner',
    'job-host:real-held-store:store-held,lock-unchanged,no-gateway-spawn,owner-alive',
    'matched:deadline-running-root:real-query-ran',
  ], 'Cold 7,878 ms / warm 1,794 ms; held refusal 4,292 ms (baseline 7,938 ms with its extra post-deadline sample). First-WMI-after-boot provenance: unknown (not established); these are fresh-process measurements with prior WMI use unknown.'),
  P('C24', 'Maintained native control NativeChecks --helper-checks (unmodified, compiled into scratch): clean, slow, flood, short-member, invalid/oversize/nonzero/perpetual-flood outcomes, four stream modes cleanup-confirmed with 0xE0470459, four sequential 5 s probes refuse at the 15 s cap', [], 'Exit 0 in 32,375 ms with the passed marker; cleanup-confirmed in 2,586-2,607 ms for both/stdout/stderr/neither (2.5 s fixture budget + cleanup).'),
  L('C25', 'helper-cleanup-unconfirmed at the 2 s expiry and transfer of SafeHandle/OVERLAPPED/event/buffer to a completion owner', 'Setup-failure branch. No native fixture can keep a job member alive or a cancelled pipe read pending beyond 2 s after TerminateJobObject without kernel-level interference. Evidence limited to source inspection (Launcher.cs HelperProcess.Read finally block and Pipe.TransferCompletion) and the maintained control\'s cleanup-confirmed path.'),
  L('C26', 'Full decision-point precedence (cleanup-unconfirmed, retained held guidance, expired work, natural nonzero, invalid)', 'Observed individually (C18, C19); the cross-precedence among simultaneous causes, especially with cleanup-unconfirmed, is only source-inspected.'),
  L('C27', 'Other containment setup-failure branches: CreateJobObject/SetInformationJobObject, attribute-list, pipe ACL/creation/connect, client-PID mismatch, remote-client rejection, EntryPointNotFound on pre-Windows 10; atomic assignment before user code', 'Not natively inducible on this Windows 11 host without fault injection into the product. Evidence: source inspection and positive maintained CheckCapability on a compatible host. The incompatible enclosing job exercises only the CreateProcess-refusal branch.'),
  L('C28', 'Staged installation validates attribute capability before replacing configuration or shortcuts', 'Not exercised. --validate-install requires a full Chrome PWA configuration. By design CheckCapability only creates the job and attribute list, so it cannot detect a host that later refuses creation; click-time refusal is covered by C12/C13.'),
  L('C29', 'Native dialog rendering, concurrent clicks, oversized/flood diagnostics in the dialog, Windows Server and fresh-runner hosts, replacement-owner lock identity, store-acquiring/store-unverified via the launcher, real-WMI mismatch/missing/unverified identities', 'Out of this pass (quiet mode only; one Windows 11 host). Unchanged from the baseline report\'s uncovered list except the items this pass added.'),
  L('C30', 'First-WMI-after-boot (cold WMI) measurement', 'Provenance unknown: no boot-time or first-use evidence was collected (avoided broad environment collection). All real-lane timings are fresh-process measurements with prior WMI use unknown.'),
  L('C31', 'WMI service and provider sessions stay outside the helper job', 'The queried process (sentinel) and the gateway are witnessed outside the job (C21, C22). The WMI service process was not witnessed: that needs system process enumeration, which this QA avoids. Provider sessions were not used.'),
];

function judge(refs) {
  const results = [];
  for (const ref of refs) {
    const [lane, id, list] = ref.split(':');
    if (id === '*') {
      const summary = JSON.parse(readFileSync(join(root, LANES[lane], 'summary.json'), 'utf8'));
      results.push({ ref, pass: summary.cases.every((item) => item.verdict === 'candidate-pass' && item.setupFaults.length === 0), detail: `${summary.cases.filter((item) => item.verdict === 'candidate-pass').length}/${summary.cases.length} candidate-pass` });
      continue;
    }
    const item = loadCase(lane, id);
    for (const assertionId of list.split(',')) {
      const assertion = item.assertions.find((entry) => entry.id === assertionId);
      results.push({ ref: `${lane}:${id}:${assertionId}`, kind: assertion?.kind ?? null, pass: assertion?.pass === true && item.setupFaults.length === 0, caseVerdict: item.verdict });
    }
  }
  return results;
}

// Criteria without case references are bound to explicit file checks.
const FILE_CHECKS = {
  C01: () => {
    const coordinator = JSON.parse(readFileSync(join(root, 'i3-459-native-qa/coordinator-verified.json'), 'utf8'));
    const summary = JSON.parse(readFileSync(join(root, LANES['baseline-formal'], 'summary.json'), 'utf8'));
    const verdicts = summary.cases.reduce((acc, item) => ((acc[item.verdict] = (acc[item.verdict] ?? 0) + 1), acc), {});
    const manifestLines = readFileSync(join(root, 'i3-459-native-qa/MANIFEST-SHA256.txt'), 'utf8').split('\n').filter(Boolean).length;
    return [
      { ref: 'file:i3-459-native-qa/MANIFEST-SHA256.txt sha256 == coordinator-verified.manifestSha256', pass: files['i3-459-native-qa/MANIFEST-SHA256.txt'] === coordinator.manifestSha256 },
      { ref: 'file:i3-459-native-qa/REPORT.md sha256 == coordinator-verified.reportSha256 (original preserved)', pass: files['i3-459-native-qa/REPORT.md'] === coordinator.reportSha256 },
      { ref: `file:manifest entries ${manifestLines} == 345`, pass: manifestLines === 345 },
      { ref: `baseline-formal summary verdicts ${JSON.stringify(verdicts)} == 10 control / 10 expected failure, 0 setup faults`, pass: verdicts['baseline-control-pass'] === 10 && verdicts['expected-baseline-failure-observed'] === 10 && summary.cases.every((item) => item.setupFaults.length === 0) },
    ];
  },
  C24: () => {
    const record = JSON.parse(readFileSync(join(root, 'i3-459-native-qa-candidate/maintained-control/maintained-helper-checks.json'), 'utf8'));
    return [{ ref: 'file:maintained-control/maintained-helper-checks.json status 0 and passed marker', pass: record.status === 0 && record.passedMarker === true, detail: { status: record.status, elapsedMs: record.elapsedMs, sources: record.sources } }];
  },
};

const criteria = CRITERIA.map((criterion) => {
  const evidence = [...judge(criterion.refs), ...(FILE_CHECKS[criterion.id]?.() ?? [])].map((entry) =>
    entry.ref.startsWith('file:') || entry.ref.startsWith('baseline-formal summary') ? { ...entry, candidateRelevant: true } : entry,
  );
  if (!criterion.limit && evidence.length === 0) throw new Error(`${criterion.id} has no evidence`);
  const candidateEvidence = evidence.filter((entry) => entry.candidateRelevant || CANDIDATE_LANES.some((lane) => entry.ref.startsWith(`${lane}:`)));
  if (!criterion.limit && candidateEvidence.length === 0) throw new Error(`${criterion.id} has no candidate evidence`);
  let status;
  if (criterion.limit) status = 'LIMIT';
  else status = candidateEvidence.every((entry) => entry.pass) ? 'PASS' : 'FAIL';
  return { id: criterion.id, criterion: criterion.criterion, status, note: criterion.note ?? null, limit: criterion.limit ?? null, evidence };
});
const counts = criteria.reduce((acc, item) => ((acc[item.status] = (acc[item.status] ?? 0) + 1), acc), {});
const map = {
  schema: 'gg459-native-qa-acceptance-map/1',
  issue: 459,
  candidate: { commit: '11214dadbde049af01dd0280b9b701ad10a0f50a', tree: '409fc7e0fcefd23b68541926ad72cfbfe70d5244', target: '47ca4640793a81efa5bec661dba25627de314774', launcherSourceSha256: 'bf66facfd104accb6da0f0a9200a994252d88efa560bd7be04be3f7139c24078', jobTerminationCode: '0xE0470459 (3762750553), apps/windows-launcher/Launcher.cs:713' },
  baseline: { formalRun: 'baseline-20261121T013403Z-b281ea', manifestSha256: '9935375eead2daed98b5c73e1af5126c7e276b984fcc3b7c47b019865496a5fe', manifestEntriesVerified: 345, recount: { controls: 10, expectedBaselineFailures: 10, setupFaults: 0 } },
  drivers: {
    baselineOriginal: { version: 'qa459 baseline', qa459DriverSha256: '3cea01be736353899bd706665cc8e22ac6f26376ba5c3c4ba71b0874b69f7b7a', qa459CasesSha256: '963fcfeaddc41f4eca59cc5a4ede2f85bdb7d17bc1d41eba3d34c0819a381753', witnessSourceSha256: '9c1795fd57105d9ce296e963f6b15359c9a3497f130b7c51ecb43665f12c21ad', usedBy: ['matched', 'job-host'] },
    extension: { version: 'qa459-ext/1', qa459DriverSha256: '87d92c569cb7e7e4edc3b341f78b4b8d24500ebf34be25db2635d4cf884bdaf0', qa459ExtCasesSha256: 'a9e28614aa39b3b2081026c1db57670a9cd84bc42f6891c8feedba736154cef4', qa459CasesSha256: '963fcfeaddc41f4eca59cc5a4ede2f85bdb7d17bc1d41eba3d34c0819a381753', witnessSourceSha256: '32e226cfdbcc737c9435f8fd6c0f9591756477e7e08ac393831e92c995b9f4ac', helperFixtureSha256: 'c192098d39d5ac4cb342eead9daf8ddc31782771631e12986c224064f6ba45cb', readmeSha256: '727ad703ff15023341c2462f16dc27a5ea5d152a2a26a3477036519e3092d94b', usedBy: ['ext', 'ext-baseline'] },
  },
  runs: Object.fromEntries(Object.entries(LANES).map(([lane, dir]) => [lane, { dir, runJsonSha256: files[`${lane}/run.json`], summarySha256: files[`${lane}/summary.json`] }])),
  files,
  counts,
  criteria,
  verdict: counts.FAIL ? 'HOLD' : 'PASS',
  verdictScope: 'Independent native QA at the exact candidate commit/tree for the criteria marked PASS. LIMIT criteria are documented boundaries of this QA, not product failures.',
};
writeFileSync(output, JSON.stringify(map, null, 2) + '\n');
console.log(JSON.stringify({ counts, verdict: map.verdict, failing: criteria.filter((item) => item.status === 'FAIL').map((item) => ({ id: item.id, failed: item.evidence.filter((entry) => !entry.pass) })) }, null, 1));

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { format, resolveConfig } from 'prettier';
const here = new URL('.', import.meta.url),
  root = fileURLToPath(new URL('../../../../', here)).replace(/[\\/]$/, '');
const config = (await resolveConfig(fileURLToPath(new URL('README.md', here)))) ?? {};
const load = async (n) => JSON.parse(await readFile(new URL(n, here), 'utf8'));
async function files(url = here, prefix = '') {
  let out = [];
  for (const f of await readdir(url, { withFileTypes: true })) {
    const name = prefix + f.name;
    if (f.isDirectory()) out.push(...(await files(new URL(f.name + '/', url), name + '/')));
    else out.push(name);
  }
  return out.sort();
}
const names = await files();
for (const name of names.filter((n) => /\.(json|txt|md)$/.test(n) && !n.endsWith('.mjs.txt'))) {
  let s = await readFile(new URL(name, here), 'utf8');
  s = s
    .replaceAll(root, '<repo>')
    .replaceAll(root.replaceAll('\\', '/'), '<repo>')
    .replaceAll(JSON.stringify(root).slice(1, -1), '<repo>')
    .replace(/C:[\\/]+Users[\\/]+[^\\/\s"']+/gi, '<user>')
    .replace(/[\\/]+Users[\\/]+[^\\/\s"']+/gi, '<user>');
  await writeFile(new URL(name, here), s);
}
const commands = [];
for (const name of names.filter((n) => n.endsWith('-command.json'))) {
  try {
    const c = await load(name);
    if (c.step) commands.push(c);
  } catch {}
}
commands.sort((a, b) => a.startedUtc.localeCompare(b.startedUtc));
await writeFile(
  new URL('commands.json', here),
  await format(JSON.stringify(commands), { ...config, parser: 'json' }),
);
const served = await load('served-results.json'),
  merge = await load('merge-results.json'),
  bg = await load('background-results.json'),
  comparison = await load('served-comparison.json'),
  host = await load('host-before.json'),
  wait = await load('host-wait.json'),
  beforeBuild = await load('host-before-build.json'),
  cleanup = await load('cleanup-manifest.json'),
  edge = await load('edge-results.json');
const head = '86e96bbc7f99a65cbf26d6feb7fb9fc0b2f61f60';
const cell = (x) =>
  String(x ?? '')
    .replaceAll('|', '\\|')
    .replace(/\s+/g, ' ')
    .trim();
const short = (x) => {
  let s = typeof x === 'string' ? x : JSON.stringify(x);
  return cell(s?.length > 250 ? s.slice(0, 247) + '...' : s);
};
const rows = (records, evidence) =>
  records
    .filter((c) => c.id !== 'environment')
    .map(
      (c) =>
        '| ' +
        [
          c.id,
          c.steps,
          c.expected,
          c.verdict === 'FAIL'
            ? c.actual.error.split('\n')[0] +
              '; initial request only, no refetch started within 5000 ms.'
            : short(c.actual),
          c.verdict,
          '[' + c.id + '](' + evidence + ')',
        ]
          .map(cell)
          .join(' | ') +
        ' |',
    )
    .join('\n');
const tableHeader =
  '| Check | Steps | Expected | Actual | Result | Evidence |\n| --- | --- | --- | --- | --- | --- |';
const compareRows = comparison.comparisons
  .map((c) => {
    const old = c.round4PreflightServerMs.length
      ? Math.max(...c.round4PreflightServerMs).toFixed(1)
      : 'No logged completion';
    const now = c.round5PreflightServerMs.length
      ? Math.max(...c.round5PreflightServerMs).toFixed(1)
      : 'Controlled route; see Edge timing';
    const delta =
      typeof c.responseDifference === 'object'
        ? c.responseDifference.maxDeltaMs.toFixed(1) + ' ms'
        : 'Not numerically measurable';
    return (
      '| ' +
      [
        c.id,
        'FAIL; 5000 ms assertion',
        old +
          (c.round4UncompletedPreflightRequests
            ? ' (' + c.round4UncompletedPreflightRequests + ' unfinished)'
            : ''),
        c.round5Verdict,
        now,
        delta,
      ].join(' | ') +
      ' |'
    );
  })
  .join('\n');
const gateRows = commands
  .map(
    (c) =>
      '| ' +
      [
        c.command,
        c.exitCode === 0 ? 'PASS' : 'FAIL (retained)',
        c.durationSeconds.toFixed(2) + ' s',
        '[' + c.log + '](' + c.log + '); [' + c.step + ' command](' + c.step + '-command.json)',
      ]
        .map(cell)
        .join(' | ') +
      ' |',
  )
  .join('\n');
const allNames = new Set([
  ...(await files()),
  'README.md',
  'final-audit.json',
  'format-command.json',
  'format.log.txt',
]);
const artifactLinks = [...allNames]
  .sort()
  .map((n) => '- [' + n + '](' + n + ')')
  .join('\n');
const text = [
  '# WP-F2b independent QA, round 5 (#204)',
  '',
  'Verdict: **PASS for #204 on ' +
    head +
    '**. One full served replay passed **27/27 behavioral cases**, with no retry. All fifteen round-4 failures passed. The editor merge checks satisfied the requested behavior at 1440 and 390 px. The existing model-picker spec remains red on exactly four known #205 cases, recorded below.',
  '',
  'This is current-head, fake-only evidence. The replay uses the built API and web, Edge and native CLIs compiled only from tooling fixtures. The supplementary matrix uses public HTTP fault/state injection; its F1 profile expectations are copied from the signed-off F1 audit and are labelled historical expectations, not fresh CLI classification results. No paid provider turns or owner instance/store access occurred.',
  '',
  '## Environment and host conditions',
  '',
  '- Detached worktree codex-qa-wp-f2b; HEAD confirmed before admission and each command. Dependencies were already installed. Node v22.14.0 first on PATH; pnpm.cmd invoked through PowerShell. Edge ' +
    served[0].actual.edge +
    '. Ports: 5860 served replay, 5861 merge matrix, 5862 corrected background checks, 5863 built Edge spec API, 5864 control, 5865–5866 additional fake API instances.',
  '- Before builds/tests: Get-Process counted ' +
    host.processCountBefore +
    ' processes / ' +
    host.nodesBefore.length +
    ' Node processes, then ' +
    host.processCountAfter +
    ' / ' +
    host.nodesAfter.length +
    '. The first 12-sample CPU measurement lasted ' +
    host.durationSeconds.toFixed(2) +
    ' s and reported approximately 100% CPU. An independent os.cpus measurement lasted 61.83 s and also reported 100%.',
  '- Two attempts to inventory Node command lines were denied by the host CIM permissions. PIDs, memory and accessible CPU times were recorded; suite ownership cannot be attributed from the unavailable command lines. This is a host limitation, not a claim that the other processes were identified as test suites.',
  '- Waited ' +
    wait.elapsedSeconds.toFixed(2) +
    ' s for a quieter host (15-minute limit plus final sampling overhead). The final minute averaged ' +
    wait.windows.at(-1).meanPercent +
    '%, maximum ' +
    wait.windows.at(-1).maxPercent +
    '%; it did not meet the recording criterion (mean below 50%, maximum below 80%). Before build: ' +
    beforeBuild.processCount +
    ' processes; the approved ports were free. Proceeded once, sequentially, retaining all failures. No timeout was raised.',
  '- Build: 11/11 tasks passed, ' +
    commands.find((c) => c.step === 'build').durationSeconds.toFixed(2) +
    ' s. Served replay: ' +
    commands.find((c) => c.step === 'served').durationSeconds.toFixed(2) +
    ' s versus 329.64 s in round 4. All ' +
    comparison.apiPreflight.count +
    ' completed current replay preflight responses took ' +
    comparison.apiPreflight.minMs.toFixed(1) +
    '–' +
    comparison.apiPreflight.maxMs.toFixed(1) +
    ' ms; round 4 recorded a 9003.4 ms maximum. This is measured improvement, not a waiver under D-032.',
  '',
  'Evidence: [initial host sample](host-before.json), [CPU minute](host-cpu.json), [process inventory limitation](process-before.json), [fifteen-minute wait](host-wait.json), [before-build inventory](host-before-build.json), [commands](commands.json).',
  '',
  '## Full served replay: one invocation',
  '',
  'Ran the committed round-3 replay in full through an evidence copy with only timing listeners and combined-log retention added. QA_ONLY was unset. Reversing every observation insertion reproduces the original source hash: [source audit](execution-source-audit.json), [exact executed source](executed-observed-served-checks.mjs.txt), [observation edits](served-observation-edits.json). No case body, assertion, timeout, route, fixture or retry was changed. Later evidence-only formatting of the replayable .mjs files does not replace the retained exact execution snapshots.',
  '',
  tableHeader,
  rows(served, 'served-results.json'),
  '',
  'Native fixture request agreement: [14 captured synthetic turn requests](served-fixture-requests.json). Readiness probes are no-turn operations. [Combined logs from both actual API processes](served-api.log.txt), [per-case Edge/Node timings](served-timings.json), [native process exits](served-lifecycle.json).',
  '',
  '## Every round-4 failure compared',
  '',
  'All fifteen pass now. Durations below compare Fastify server response times for preflight requests correlated with the case. Old attribution windows run from the captured loop’s first editor GET to the next loop creation; completions can outlast the assertion. An unfinished old request has no measured response duration: no numerical delta is invented. Current Edge responseEnd timings, intentional route delays, case duration and original errors are in [the full comparison](served-comparison.json); [historical request extraction](round4-request-baseline.json) records its source hash and attribution method.',
  '',
  '| Case | Round 4 / wait | R4 max preflight ms | Round 5 | R5 max preflight ms | Difference |',
  '| --- | --- | --- | --- | --- | --- |',
  compareRows,
  '',
  '## Merged editor in Edge, 1440 and 390 px',
  '',
  '“Failed” here means a completed typed unready state such as transport; it is not a new enum. “Unavailable” means a failed HTTP lookup. The matrix covers ready, client-only checking, unknown, CLI missing/outdated, auth, quota and transport. No unknown/quota/transport profile invents sign-out when authenticated is absent. Eighteen signed-off F1 profile expectations are each shown through the current editor at both widths, including explicit sign-out, empty output, errno/auth wording, ranked status diagnostics and missing capabilities. This verifies the editor’s use of the supplied state/problem, not a fresh native classifier pass.',
  '',
  'Initial matrix: **60 PASS, 2 FAIL**. Both failures were test setup errors: non-bubbling synthetic visibilitychange events never reached the window listener. The initial request completed in about 6–7 ms, but no second request began within the unchanged 5000 ms wait. The original failures remain failures in [merge results](merge-results.json) and [merge log](merge.log.txt). The reason and exact external-event correction are in [setup correction](background-setup-correction.json). The two focused corrected checks passed once each, with no timeout change; the full served replay was not rerun.',
  '',
  tableHeader,
  rows(merge, 'merge-results.json'),
  '',
  'Corrected external-event setup checks:',
  '',
  tableHeader,
  rows(bg, 'background-results.json'),
  '',
  'Visual inspection confirmed the phone dialog remains within 390 px and the supported policy/fallback states are readable through normal dialog scrolling. The native select’s long selected label is clipped inside its control; its full options and help remain available. Smaller captures suffice: all retained PNGs are below 118 KB. [Phone ready policy during recheck](background-ready-390.png), [desktop failed policy while Retry is pending](background-failed-retry-1440.png), [phone lookup failure notice](lookup-unavailable-390.png).',
  '',
  '## Affected tests, gates and docs',
  '',
  '- Web: 88/88 tests in the two harness-switch files, ClaudePolicyField, model field and editor model picker files.',
  '- API: 46/46 tests in harness-switch, model-readiness, nested-readiness and readiness-evidence.',
  '- Edge model-picker: 4 passed, 4 failed, zero retries/flaky cases. The four failures are the known #205 cases: catalog model/effort (dark and light), saved model removal, and catalog failure/default picker. They address controls outside Advanced; #204 keeps them under Advanced. Current #204 Claude-to-Codex persistence and cached-catalog publication/recovery cases pass. See [Edge JSON](edge-results.json), [Edge log](edge.log.txt), and linked error contexts in the artifact list.',
  '- Full coverage was not run, as explicitly permitted for this round; no new independent percentage is claimed. Full claude-harness/readiness spec files were not rerun: requested editor states/policy paths are covered by the two-width served matrix and affected component files. No schema/route/dependency change was made by QA, so generated-doc and license gates were not required.',
  '- The resolved docs 06/09 editor-visible statements match the current observations. No mismatching sentence was found. The #204 Upgrade note names rebuilding API/web together with the regenerated client; ecosystemDefault is a required boolean. [Documentation comparison](documentation-check.json), [merge-parent identity and upgrade evidence](merge-source-check.json). Native parser/admission prose is not re-certified by the controlled editor profiles.',
  '',
  '| Exact command | Result | Duration | Evidence |',
  '| --- | --- | --- | --- |',
  gateRows,
  '',
  'Windows Turbo cache-access warnings are retained in successful build/typecheck/lint logs; they did not change task exits. Dependency-cruiser reports one no-orphans warning for packages/infrastructure/drizzle.config.ts, with zero errors. Root format:check FAILED only on the pre-existing untracked round-4/README.md and round-4/report.mjs; neither was modified in this round. Current round-5 evidence has its own formatting check. The gate table records these failures, the auxiliary initial matrix failure and known Edge failures as failures.',
  '',
  '## Process cleanup and retained stores',
  '',
  'Every owned API/E2E process exit was observed, every recorded PID was absent at closeout, and all three programmatic Edge apps report closed. Seven owned temporary directories remain: six stores and the Edge output directory. QA-COMMON explicitly says Codex QA must “never delete directories (list them for the orchestrator)”; none was deleted. Exact relative names, sizes and process checks are in [cleanup manifest](cleanup-manifest.json), produced by [read-only inventory](cleanup-inventory.ps1). Existing round-4 stores were neither changed nor included.',
  '',
  '## Evidence record',
  '',
  'Every retained artifact is linked below. The exact executed-source text copies precede any evidence formatting; observations are not regenerated as historical runs. JSON/log local user paths are stripped. [Final audit](final-audit.json) hashes every other retained file after final formatting, checks links/paths and verifies no tracked or index changes. It excludes its own bytes from self-hashing explicitly.',
  '',
  artifactLinks,
  '',
  '## QA-COMMON report',
  '',
  '1. **Verdict:** PASS for WP-F2b #204 at ' +
    head +
    '. The required single replay is 27/27; merge behavior is covered at both widths. All fifteen prior load-class failures now pass; none was waived.',
  '2. **Defects:** No new #204 product defect found. Root formatting fails on two untouched pre-existing round-4 evidence files (minor workspace hygiene, outside the tested product). Two auxiliary test setup failures are preserved and corrected in focused checks. Four known #205 Edge failures remain outside this bolt; the full model-picker spec is not green.',
  '3. **Coverage of criteria:** #204 compatible defaults/switch directions, disabled entries/failure retention, and save/reopen/native fake adapter request agreement: tested and passed. Inheritance, effort-only rules, initial waiting, known failures, cancellation, no extra lookups, undo, policy reset, catalog toolbar/API defense and recovery: tested and passed. Merge readiness/policy behavior and eighteen editor-visible F1 profiles at both widths: tested and passed, with the stated HTTP-injection boundary. Live providers, native F1 classifier re-admission and full coverage: not run in this bounded round.',
  '4. **Report path and evidence folder:** docs/qa/2026-10-22-wp-f2b-qa/round-5/README.md; folder docs/qa/2026-10-22-wp-f2b-qa/round-5/. Detached codex-qa-wp-f2b; evidence uncommitted, ready for orchestrator commit. Production files and index untouched; no commit made. Seven temporary directories await orchestrator removal after the confirmed process exits.',
  '5. **Observations outside scope:** Known #205 Advanced-control expectations; denied host Node command-line inventory; Turbo cache-access warnings, one no-orphans warning and the pre-existing round-4 formatting failure. D-024 supersedes old owner-acceptance wording. No owner acceptance gate was applied and no owner instance/store was accessed.',
  '',
].join('\n');
await writeFile(new URL('README.md', here), await format(text, { ...config, parser: 'markdown' }));
for (const name of (await files()).filter((n) => n.endsWith('.json'))) {
  try {
    await writeFile(
      new URL(name, here),
      await format(await readFile(new URL(name, here), 'utf8'), { ...config, parser: 'json' }),
    );
  } catch {}
}
console.log('Report written with ' + allNames.size + ' artifact links.');

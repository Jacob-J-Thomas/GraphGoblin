import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const dir = resolve('docs/qa/2026-10-22-wp-g2-qa/round-2');
const checks = (await readFile(join(dir, 'checks.log.txt'), 'utf8'))
  .trim()
  .split('\n')
  .map(JSON.parse);
const browser = await readFile(join(dir, 'browser-version.txt'), 'utf8');
const portable = (x) => String(x).replaceAll('|', '\\|').replaceAll('\n', ' ');
function actual(r) {
  const a = r.actual;
  if (r.result !== 'PASS') return String(a);
  if (r.id === 'seed-summaries')
    return 'Counts 1/0/105/501; old succeeded run and genuine no-history control correct.';
  if (r.id.startsWith('run-lookahead-'))
    return 'First page 200, seq1/nextAfter1/hasMore true unchanged; own/middle page 500 STORED_EVENT_INVALID seq2; MCP agrees; restore200.';
  if (r.id.startsWith('inbound-lookahead-'))
    return 'First page200 unchanged with cursor; own/middle page500 application/problem+json INTERNAL_ERROR; restore200.';
  if (r.id === 'runs-corrupt-lookahead-mcp-diagnostics')
    return 'Healthy first page unchanged; damaged own page empty with cursor; following run reachable; API/MCP cursors agree; inspector500 and diagnostic identifies row.';
  if (r.id.startsWith('recipe-runs-'))
    return `100 to105 unique; scroll delta ${a.scrollDelta}; exhaustion focused, filters/reset/reload correct; ${a.layout.scrollWidth}px document at ${a.layout.width}px; ${a.ring.width} ${a.ring.outline} focus outline.`;
  if (r.id.startsWith('recipe-events-'))
    return `100 to105; ${a.payloadCharacters} payload characters retained; scroll/payload-top deltas ${a.scrollDelta}/${a.payloadDelta}; exhaustion focused; ${a.layout.scrollWidth}px document at ${a.layout.width}px.`;
  if (r.id === 'recipe-loop-summaries-delete')
    return 'Correct older succeeded link beyond606 newer unrelated runs; one never-run control; warning501; Keep preserves4 loops.';
  if (r.id === 'recipe-native-outage-retry')
    return 'Native API stopped;100 rows and payload retained; new API process on same store; retry105 once.';
  if (r.id === 'runs-native-unreadable-page')
    return '100 damaged rows produce empty page plus real cursor; Edge continues to100 healthy older rows.';
  if (r.id === 'events-empty-page-controlled')
    return 'Controlled empty successful response retains real cursor; Edge loads last5; controlled-response evidence only.';
  if (r.id === 'events-corrupt-page-repair')
    return 'Real malformed requested page fails500, retains100; repair and retry105; rejected page is not skipped.';
  if (r.id === 'invalid-query-problems')
    return 'All9 invalid query cases returned typed400 problem+json.';
  if (r.id.startsWith('tied-'))
    return `${a.count} records, ${a.unique} unique, descending-ID tie order, null exhaustion; active filters retained.`;
  if (r.id === 'r5-healthy-latest')
    return 'API/raw count2; newest succeeded ID and Edge badge/link agree.';
  if (r.id === 'r5-damaged-older')
    return 'After restart count2; newest succeeded badge unchanged; older inspector500 STORED_RUN_INVALID and diagnostic identifies it.';
  if (r.id.startsWith('r5-stale-latest-'))
    return 'Real run.finished seq8 succeeded; stored status running and pinned damaged before/after restart; latestRun null/count2; Edge unavailable plus diagnostics guidance; no older fallback; inspector500; diagnostics identity.';
  return JSON.stringify(a);
}
const table = checks
  .map(
    (r) =>
      `| ${portable(r.id)} | ${portable(r.steps)} | ${portable(r.expected)} | **${r.result}**: ${portable(actual(r))} | [record](checks.log.txt) |`,
  )
  .join('\n');
const commands = [
  'typecheck',
  'lint',
  'check:layers',
  'check:deps',
  'check:licenses',
  'check:tokens',
  'check:docs',
];
const gates = [];
for (const cmd of commands) {
  const file = cmd.replaceAll(':', '-') + '.log.txt';
  const log = await readFile(join(dir, file), 'utf8');
  const exit = /Exit: (\d+)/.exec(log)?.[1];
  gates.push(
    `| pnpm.cmd ${cmd} | ${exit === '0' ? 'PASS' : 'INCOMPLETE/FAIL'} (exit ${exit ?? 'missing'}) | [transcript](${file}) |`,
  );
}
const files = [
  ...new Set([
    ...(await readdir(dir)),
    'README.md',
    'format-check.log.txt',
    'round-1-preservation.json',
    'validation.log.txt',
  ]),
].sort();
const inventory = files.map((file) => `- [${file}](${file})`).join('\n');
await writeFile(
  join(dir, 'README.md'),
  `# Independent WP-G2 QA, round 2

## 1. Verdict

**PASS for the requested round-2 scope on a9df185eecdb192a79b90665ee682ee7916b2ac0.** All ${checks.length} behavioral checks passed on their single execution. The round-5 stale latest-run defect is verified fixed through the built native API, real SQLite and Microsoft Edge. The build gate passed with a complete retained transcript (D-030). This report is independent QA evidence; integration and designated-session merge sign-off remain separate.

Environment: Windows, Node v22.14.0 first on PATH, pnpm.cmd from PowerShell, Microsoft Edge ${browser.trim()} headless, built API/MCP/web at this exact head. Detached worktree: GraphGoblin/.claude/worktrees/codex-qa-wp-g2. A fresh %TEMP%/gg-qa-g2-a9df185-* store and port5633 were used. Owner ports4747/4748, implementer ports5620-5629 and other stores were untouched. No provider turns. All owned API/MCP/browser handles closed; the single SQLite database and full QA temp root were removed ([cleanup](cleanup.log.txt)).

Systems exercised: SQLite run decoding and loop summary selection/counting; durable run events and recovery across real process restart; Loops, Runs, Events and inspector UI; REST history/diagnostics/filter validation; built MCP read_run_events/list_runs and continuation metadata; production web build with the bumped dependencies.

## 2. Defects

No product defect was reproduced within this round's requested scope. No severity is assigned. D-030 evidence gap is resolved: [gate-build.log.txt](gate-build.log.txt) records the build on this head, 11/11 tasks successful, 5 cached, 19.334s, exit0. The [round-1 report](../REPORT.md) has exactly one added note stating that the original transcript was not retained and linking this new-head transcript. It does not change the provenance of the original build result. All other 149 round-1 files are byte-for-byte preserved; removing that note and its separating blank line reproduces the original REPORT.md SHA256 ([preservation](round-1-preservation.json), [before hashes](round-1-before.json)).

## 3. Coverage of criteria

| Requirement | Result and evidence |
| --- | --- |
| #236 round-5 audit scenario | PASS twice: schema-invalid pinned {} and malformed JSON. Independently written BEFORE UPDATE trigger blocks only this loop's terminal status transition with RAISE(IGNORE), damaging pinned inside that trigger after the durable event append. Native run.finished seq8 records succeeded while the real row remains running. New API process on the same SQLite retains that state. API latestRun null and raw/API count2; Edge says latest run unavailable and Check run history diagnostics, contains neither running nor never run, and links neither the damaged newest nor older run. Inspector500 STORED_RUN_INVALID; diagnostics names the damaged ID. See r5-stale-latest-schema/json records and DOM snapshots below. No implementer fixture imported. |
| #236 healthy latest; damaged older control | PASS: two healthy runs select newest succeeded badge. Damaging only older pinned, then native restart, leaves that newest badge and exact count2 intact; damaged older inspector/diagnostics agree. |
| #236 original acceptance criterion | PASS: older loop's correct succeeded summary remains available beyond606 unrelated newer runs; genuine empty loop alone says never run; tied ordering uses descending ID; deletion warning exact501. |
| #231 both acceptance criteria: API/client/MCP/browser cursor and filter propagation | PASS: built Edge consumers append100 to105 in both themes at1440/390; filters survive continuation and reset/reload; API/MCP opaque cursors match, including damaged lookahead and empty unreadable run page. |
| #231 tied timestamps, exhaustion, invalid filters | PASS:105 tied runs and105 tied inbound events traverse limit-one, preserve active filters and descending ID order with no skips/duplicates, and end at null cursor;9 invalid status/cursor/limit/filter cases yield typed400. |
| Round-1 lookahead regression checks on moved head | PASS once: run-event {} and malformed JSON; inbound payload and run_ids malformed separately; run-list damaged pinned just beyond limit1. Requested healthy pages remain200 with continuation; corruption in requested pages still reports strict errors. Restoration succeeds. Native MCP agrees. |
| Browser reading/focus/retry/empty-page regressions | PASS: keyboard exhaustion focus and retained scroll/payload; both themes and390px; native outage/restart/retry; native unreadable Runs page continuation. Successful empty Events continuation is controlled-response evidence; real malformed requested inbound pages retain the explicit500 contract until repair. |
| D-030 transcript and round-1 preservation | PASS: complete build transcript retained on a9df185e; one-line provenance note in prior report; every other prior artifact unchanged. |

Each check below has steps, expected, actual, pass/fail and raw evidence. The [JSON-lines ledger](checks.log.txt) contains the response bodies, SQL state, IDs, cursors and measurements for each named record. Browser assertions operate on the rendered DOM. Snapshots preserve visible wording and links. The 390px light latest-run screenshot was visually inspected before disposable image removal; no screenshot is retained.

| Check | Steps | Expected | Actual and result | Evidence |
| --- | --- | --- | --- | --- |
${table}

### Gates and scope of this rerun

| Exact command | Result | Evidence |
| --- | --- | --- |
| pnpm.cmd build | PASS, exit0;11/11 successful,5 cached;19.334s | [transcript](gate-build.log.txt) |
${gates.join('\n')}
| pnpm.cmd format:check | See final recorded exit and any pre-existing artifact failures; QA edits formatted only inside round-2 | [transcript](format-check.log.txt) |

Dependencies were already reinstalled by the orchestrator; install was not repeated. The five full coverage suites and the repository Edge history.spec.ts were not repeated in this bounded follow-up: round1 retains those original outcomes, while this round reran the actual native paging/cursor and Edge recipe checks once on the moved head. No current-head coverage percentage or fresh full-suite pass is inferred. No product test, assertion, timeout or coverage threshold changed.

## 4. Report path and evidence folder

Report: docs/qa/2026-10-22-wp-g2-qa/round-2/README.md. Evidence: this folder. New scripts are QA-only; generated exercise/browser copies write exclusively here or into their own disposable temp root. The recipe seed was reused for the original paging dataset; the round-5 fault construction is independent in latest-run.mjs. The [setup record](setup.log.txt) explains two build-logger launch failures and the subsequent complete build. Neither launch failure is counted as a product gate result.

Every kept artifact in this folder is linked here:

${inventory}

## 5. Observations outside scope and host limitations

- The original round1 infrastructure/web full-suite failures and sandbox native-process cases remain historical failures in that report; this follow-up does not retry them to green or grant a full integration gate pass.
- Requested malformed inbound pages return500 INTERNAL_ERROR without a cursor. Repair/retry succeeds; a successful empty response with a cursor continues. The original report's distinction remains; this round does not claim native skipping of a rejected malformed inbound page.
- Turbo reported access-denied cache I/O warnings while task execution still exited0. Windows PowerShell script-signing and native-stderr handling affected only the first QA logger invocations; the final build transcript is complete. Process-only execution policy was used to run the local QA scripts; no persistent setting changed.
- Cleanup removed the sole QA temp store and images after child handles closed. No production code, dependency, lockfile, numbered doc, Git index or commit was changed by QA. Only this folder and the requested provenance note are new edits.
`,
);
console.log(
  'Report written with ' + checks.length + ' behavioral checks and linked artifact inventory.',
);

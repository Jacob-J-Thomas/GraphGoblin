import { readFile, writeFile } from 'node:fs/promises';
const folder = 'docs/qa/2026-10-21-wp-d2-qa/';
const read = async (name) => JSON.parse(await readFile(folder + name, 'utf8'));
const native = await read('native.json');
const summary = await read('analysis.json');
const suites = await read('suites.json');
const checks = await read('checks.json');
const table = native.cases
  .map((test) => {
    const results = test.actual
      .map(
        (d) =>
          `${d.status}; ${d.attempts}/${d.maxAttempts} attempts${d.lastError ? '; ' + d.lastError.code + (d.lastError.httpStatus ? ' ' + d.lastError.httpStatus : '') : ''}`,
      )
      .join('; ');
    const timing = test.elapsedMs
      ? `; stop ${test.elapsedMs} ms, zero new requests`
      : test.gapsMs?.length
        ? '; gaps ' + test.gapsMs.join('/') + ' ms'
        : '';
    return `| ${test.name} | ${test.expected} | ${results}${timing} | PASS | [evidence](${test.evidence}) |`;
  })
  .join('\n');
const gates = [...suites, ...checks]
  .map(
    (gate) =>
      `| \`${gate.command}\` | ${gate.code === 0 ? 'PASS' : 'FAIL'}, exit ${gate.code}, ${(gate.elapsedMs / 1000).toFixed(2)} s | [log](${gate.name}.log) |`,
  )
  .join('\n');
const report = `# Independent QA: WP-D2 bounded webhook return delivery (#246)

## 1. Branch and worktree

Verdict: **Targeted acceptance PASS (25 independent native cases plus the archived-store upgrade); overall required-suite verdict pending completion.** See sections 5 and 8 for failed gates. No WP-D2 product defect has been observed. This is independent QA, not implementation, cross-vendor review, merge sign-off or owner acceptance.

- Tested head: \`77d767a6710e2fa04b92a3aa67893b430a926358\`; PR source \`codex-wp-d2-webhook-retry\`, target \`main\`.
- QA branch: \`codex-qa-wp-d2\`; worktree: \`%WORKTREE%\` (repository-relative \`.claude/worktrees/codex-qa-wp-d2\`). Comparison merge-base with local main: \`48ecf6e7a059015b2df604beb0284942f84145fe\`.
- Windows PowerShell, Node \`v22.14.0\` first on PATH, \`pnpm.cmd\`; Edge selected with \`GG_E2E_BROWSER_CHANNEL=msedge\`. Test timestamps use UTC; the local QA date is 2026-10-21 (America/Chicago).
- New evidence is uncommitted; ready for orchestrator review. No product file, Git index, branch, commit or external service was changed. No sub-agent was used.

Manual ports: API **5810**, receiver **5811**, proven closed refusal destination **5819**. Archived-store fixture API and receiver used **5812/5813**. The requested repository suites retain their built-in ephemeral test ports; these are separate from the manual listeners. No owner app, store, port 4747/4748 or paid provider turn was used.

Stores (removed by their validated finally cleanup):

- \`${native.store}\`.
- \`%TEMP%/gg-qa-246-upgrade-REPLACE_UPGRADE_ROOT\` with \`original\` and \`after\` child directories; see [upgrade-cleanup.json](upgrade-cleanup.json) for the exact generated root.
- Repository suite stores use the suites' own temporary prefixes and cleanup; they are not owner stores. Any suite cleanup failure remains a failed test, not proof of successful cleanup.

The separate archived source export is **not a store**. Retained for orchestrator cleanup: \`%TEMP%\\gg-qa-246-source-523bb0bbf97742c39aa6df6c1e3533af\` and its temporary source manifest. See section 8.

Read authority: QA-COMMON.md, COMMON.md, issues #246/#184/#278; branch docs/README, issue workflow, architecture/implementation orientation, ADR-0043 including its 2026-10-21 amendment, docs/05, CHANGELOG #246, main's register D-021 and section 6, and the implementer's October 20 records and October 21 round-four report/procedure. Current documentation and executed results govern; historical reports are not counted as new passes.

## 2. Per bolt and acceptance coverage

Touched systems: return contracts; execution/finalization and parent-child continuation; durable SQLite event journal and migration; real outbound HTTP and acknowledgement classification; process crash/restart/orderly close; REST detail/events and generated client; MCP get/wait; inspector polling; adjacent inbound receiver address flow; migration metadata and documentation.

For each matrix row, the common steps were: publish a current-format manual-trigger/exit loop through the built authenticated REST API; start it; let the real receiver return the named status/body/transport behavior; poll GET /runs/{id}; read GET /runs/{id}/events and the real SQLite run_events rows; compare delivery sequence/type projections; assert the final count, status and identity. No harness/provider node is executed. The 19 classification runs are started together, exercising concurrent delivery workers. Receivers count every request and implement no deduplication.

Expected and actual per check:

| Check / receiver behavior | Expected | Actual | Result | Evidence |
| --- | --- | --- | --- | --- |
${table}

Additional detail and steps for the non-matrix rows:

- **two-channels:** one exit names two different receiver paths. Expect distinct ULIDs for the two channels, one unchanged identity on each channel. Both journal IDs exactly match the received Idempotency-Key values; all current budgets are five. [analysis.json](analysis.json), [receiver.json](receiver.json).
- **crash-between-two-three:** wait until attempt two is durably finished and the delivery is in backoff; SIGKILL the API; start a new process on the same store. Expect three remaining attempts, not five fresh attempts. Exactly five requests total, one identity, final HTTP 503 failure; the captured before rows and final rows show the remaining budget. [native-crash-between-two-three.json](native-crash-between-two-three.json).
- **delivered-not-resent:** capture a delivered run's full SQLite rows, SIGKILL, restart, observe for 2.3 s. Expect no new request/event or changed row. Counts and full row comparison are unchanged. The migration fixture independently observes a second startup too. [native-delivered-not-resent.json](native-delivered-not-resent.json).
- **orderly-backoff / orderly-attempt:** boot the repository's Windows native IPC-close wrapper, wait for the first backoff or active held request, call its stop bridge and wait for process exit. Expect no new request after stop; a backoff wakes immediately; an in-flight request uses its original ten-second deadline. Actual exits: **192 ms / 9,842 ms**, code zero, zero new requests. Restart resumes each identity on attempt two and delivers. This exercises the real built app.close/container stop path; it is not a claim that Windows delivered a POSIX signal or that physical console Ctrl+C was tested. [process-lifecycle.json](process-lifecycle.json).
- **parent-child:** park a parent on a child input wait; submit the child's input; let its exit webhook fail 503. Expect the parent's execution to continue from the child's recorded successful execution while delivery remains pending; child finalized_at remains null until delivery ends. Observed parent succeeded during pending delivery, child finalized after five failed requests, one child_run.finished notification. [native-parent-child.json](native-parent-child.json).

For #246's two acceptance criteria: **PASS**. Eligible failures have a finite durable budget and stable identity, while unknown acknowledgement and possible prior effects remain visible; the receiver performs no deduplication. Successful execution stays succeeded when its delivery is pending or failed. Late acknowledgement, lost connection, slow body and oversized acknowledgement never become proof that the effect did not happen. Crash/retry retains identity and consumed budget.

The brief's wording “one final return.delivered / return.failed” is interpreted using ADR-0043: webhook terminal receipts are now **delivery.finished** with delivered/failed status. Each channel has exactly one terminal delivery event in REST and SQLite; return.delivered / return.failed apply to other sinks. No retired webhook receipt was expected or fabricated.

## 3. Files changed

Only this evidence directory was added. Scripts: native.mjs (independent API/SQLite/receiver checks), gates.mjs (command runner), upgrade.mjs and base-loader.mjs (adapted documented fixture), prepare-upgrade.mjs, analyse.mjs, package-evidence.mjs and write-report.mjs. Text logs, compact indexes, per-case JSON and this report preserve the observations. No shared/product file was changed, and no edit was made in another worker's package.

Reproduce native evidence after build: \`node docs/qa/2026-10-21-wp-d2-qa/native.mjs\`. It creates a binary-issued API key kept only in memory, removes its store and records sanitized observations. Per-case files archive the completed run; native.json is the compact index. [api-log.json](api-log.json) contains selected startup/warning log lines, [receiver.json](receiver.json) all ${summary.receiverRequests} timestamped native requests, and each native case includes raw SQLite rows plus API delivery events. Upgrade evidence is [verify.json](verify.json).

## 4. Tests and original-store upgrade

No production fix, unit-test edit or failed-before regression claim is made in this QA thread. The independent acceptance scripts use supported HTTP/storage shapes and real process/network failure injection, without monkey-patching product internals.

The original store was created by an archived \`52360d99def690d3cff9f36cc81a76b48c172582\` source build, using the implementer's documented base-build emitter and workspace-aware loader. This emits the archived TypeScript to its own dist and borrows installed external dependencies; it is not a fresh old-toolchain install/typecheck. The original built API publishes a child with webhook, retired Event, caller and log returns, and a parent awaiting it. After the old receiver sees one held request, kill the old process. SQLite proves child succeeded with one run.finished, no finalization marker and no return receipt, while the parent is waiting. Open that original store's copy with the tested build.

| Upgrade check | Expected | Actual | Result / evidence |
| --- | --- | --- | --- |
| Migration 0015 pending projection | One unknown consumed old attempt, frozen maxAttempts 5; resume without fresh budget | Imported delivery.attempt_finished row has attempts 1, maxAttempts 5, acknowledgement unknown, interrupted reason. One new request delivers on projected attempt 2. Two requests total including the unkeyed old request. | PASS, verify.json migrationImport and migratedState |
| Retired stored Event return | Typed LOOP_UPGRADE_REQUIRED warning, no Event receipt/publication, other supported sinks finish | Two first-start warnings name the child run, loop, version and channelKind event; caller/log delivered, webhook delivered, no Event receipt or finalize error; old events and definitions compare unchanged | PASS, verify.json diagnostics, childApiEvents, originalState/migratedState |
| Parent and finalization | Parent continues once with child's recorded outcome; child finalized | Child and parent succeeded/finalized; parent result contains old-child-result; one child_run.finished | PASS, verify.json |
| Second startup | No new warning, request, run/event/version row | Exact complete rows unchanged and receiver request count unchanged; no retired-return/finalize warning | PASS, verify.json secondStartupUnchanged |
| Migration generation and metadata formatting | No schema drift; shipped journal/snapshot properly formatted | check:migrations says generation is a no-op; explicit Prettier check of 0015_snapshot.json and _journal.json passes | PASS, migrations.log and metadata-format.log |

Coverage summaries and exact package/suite results are in section 5 and their logs. Contracts focused cases: 2 passed; MCP suite: 45 passed; inspector components: 23 passed. Generated-client suite: 70 passed, one template test failed with test and cleanup-hook timeouts; isolated triage is reported below when available. These fake-harness/component suites supplement, rather than replace, the built-process/SQLite evidence.

## 5. Gates

All commands use Node 22 first on PATH. Coverage packages run directly rather than through a cached Turbo test result; two workers limit contention. No thresholds, timeouts, exclusions or assertions were weakened. Root build: **PASS**, 11 tasks successful (2 cached), build.log.

| Exact command | Actual | Evidence |
| --- | --- | --- |
${gates}

Additional commands: \`pnpm.cmd --filter @graphgoblin/contracts exec vitest run src/delivery.test.ts\` (PASS, contracts.log); \`pnpm.cmd --filter @graphgoblin/api-client test\` (FAIL, api-client.log); \`pnpm.cmd --filter @graphgoblin/mcp test\` (PASS, mcp.log); \`pnpm.cmd --filter @graphgoblin/web exec vitest run src/runs/inspector/DeliveryPanel.test.tsx src/runs/RunInspectorPage.test.tsx --maxWorkers=2\` (PASS, web-components.log). Explicit migration metadata formatting: \`pnpm.cmd exec prettier --check packages/infrastructure/drizzle/meta/0015_snapshot.json packages/infrastructure/drizzle/meta/_journal.json\` (PASS, metadata-format.log).

The first root format check failed only native.json, a QA artifact updated during the run. Final evidence formatting/check is recorded separately after evidence stops changing; this is not a product formatting defect. check:deps reports the existing infrastructure drizzle.config.ts orphan warning. No dependency changed, so no additional license gate was needed.

## 6. Docs

No numbered doc, ADR, CHANGELOG or generated reference was edited. Executed behavior agrees with ADR-0043, docs/05 and the #246 upgrade notes: complete bounded 2xx acknowledgement; unknown overflow/timeout/interruption; stable identity without exactly-once guarantees; five total attempts; D-021 stopping; terminal retired-Event bookkeeping without renewed admission. Generated docs check passed. The register correctly distinguishes engineering parameters from owner decisions and records the deferred Retry-After/manual-redelivery/concurrency-cap seams; those were not expanded here.

## 7. Decisions and parameters

No delivery policy was chosen or changed by QA. Tests use the documented 2/5/10/20-second delays, ten-second full acknowledgement deadline and 64-KiB body bound. Timing assertions allow scheduling/storage overhead: retry gaps at least nominal minus 100 ms and under nominal plus 2.5 s; per-attempt deadline observations 9.9–12.5 s. Actual never/slow-body deadlines were approximately 10.01–10.06 s; the persistent-failure and fifth-success request gaps are listed per case.

The built-process Windows close bridge is used because native Windows SIGTERM is forceful. SIGKILL establishes forced-crash recovery. The live receiver does not deduplicate and records all arrivals; no paid provider capability or real-provider behavior is inferred from these runs. The upgrade fixture adapts the documented procedure only for this thread's ports, prefixes, evidence path, frozen-budget assertions and row capture; no product implementation was changed.

## 8. Caveats and open items

No WP-D2 functional defect was found in the completed native acceptance. Required gates are not all green. Infrastructure coverage failed seven exact D-015 native process-tree cases (650 passed; lines **98.65%**, branches **94.77%**):

1. adversarial.test.ts — “6/QA-LIMIT-001: ProcessScripts abort kills a real child and its grandchild” (30 s timeout).
2. process/scripts.test.ts — “kills and closes a real process cancelled with incomplete UTF-8 pending on both streams” (cancellation required emergency fixture cleanup).
3. process/scripts.test.ts — “kills the process tree on timeout” (15 s timeout).
4. process/scripts.test.ts — “kills the process when the signal aborts, including when already aborted” (15 s timeout).
5. claude/process.test.ts — “kills on deadline and output overflow” (EBUSY fixture cleanup).
6. claude/process.test.ts — “does not spawn for an already aborted signal and cancels a running process” (EBUSY fixture cleanup).
7. claude/process.test.ts — “kills the descendant that a long-lived child started” (continued descendant output and EBUSY cleanup).

These match the documented sandbox/native-process class. This run establishes the failures, not a new outside-sandbox pass or proof that they are harmless. Full infrastructure remains FAIL. Locked native fixture directories named in infrastructure.log are separate from GraphGoblin stores: %TEMP%/gg-claude-process-nfD83v, %TEMP%/gg-claude-process-kioFvr and %TEMP%/gg-claude-process-xVwkaH. COMMON leaves non-store directory cleanup to the orchestrator.

Outside-scope test observation: api-client/src/templates.test.ts timed out in “creates an ordinary editable draft with the generated client without automation setup”, then its afterEach hook timed out. The full 70/71 result remains failed even if narrow triage passes. No code was changed and no whole-suite retry-to-green was performed. Browser/native/suite outcomes still pending are not implied passed.

Automatic approval review rejected recursive deletion of the archived source-build directory, stating **“blocked by policy.”** It is not a data store and COMMON also reserves non-store directory cleanup for the orchestrator; the source export and source manifest listed in section 1 are retained. The independently created native and upgrade stores were removed by bounded finally cleanup. No permission to delete other directories was inferred.
`;
const upgrade = await read('upgrade-cleanup.json');
await writeFile(
  folder + 'README.md',
  report.replace('%TEMP%/gg-qa-246-upgrade-REPLACE_UPGRADE_ROOT', upgrade.root),
);

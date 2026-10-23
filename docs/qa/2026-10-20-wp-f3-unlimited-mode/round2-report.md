# WP-F3 / #243 round 2 report

## 1. Branch and worktree

Branch: `codex-wp-f3-unlimited-mode`. Worktree:
`<local>/source/repos/GraphGoblin/.claude/worktrees/codex-wp-f3-unlimited-mode`.
Base HEAD: `624aaa9cd4699b20f8330a0cee0b4a7d736c88db`. No commit, staging, push,
merge, rebase, stash or branch switch. Final boundary verification is recorded in round2-boundary-check.txt; closing checks
are recorded in round2-final-checks.log.

## 2. Per bolt

#243 (B45), parent #306 (U17), intent #288: required B1/D-027 and N1 implemented.
There is no default run deadline. Omitted deadlines decode and migrate to null; authored
numbers remain intact. Editor and Settings show No run deadline; the inspector says
Run deadline: none. Limited suggests 3600 seconds. Explicit Unlimited visits/passes
retain their warning and visits retain the existing default 10.

N1 restores both 16,384-character message/reasoning and successful tool-output detail
slices. The full final result is preserved. HARNESS_OUTPUT_LIMIT remains the stream
resource failure. An additional regression caught clearing a Limited deadline removing
its numeric field; a draft now keeps that field editable until blur. Clearing the
suggestion and saving 5 seconds passes unit and real Edge checks.

The accepted transport retry, F4 classification and D2 child-cancellation condition are
unchanged. #270 and deferred allowance recovery remain outside scope.

## 3. Files changed

[Exact round-2 line ranges](round2-changed-line-ranges.md) compare the worktree at this
round's start with its current contents, including Round 1 timer assertions restored
to the original no-default-deadline behavior. They identify every changed shared file.

Runtime changes cover contracts, SQL 0015, Claude protocol detail, the execution-limit
field, Settings and inspector. Fixture/golden/generated-client changes follow the null
default. Numbered docs, three guides, ADR-0047, CHANGELOG, plan and owner recipe agree.
No Round 2 changes touch run-manager.ts, inference retry, API admission/readiness or
NodeEditorDialog.tsx. Migration number/journal/snapshot are not renumbered.

New evidence artifacts: this report, round2-changed-line-ranges.md,
round2-deadline-evidence.md, round2-migration-before-after.json and round2 result JSONs.
Individual commands and their original failures remain in the round2-*.log files.
The historical Round 1 report is retained with a supersession banner.

## 4. Tests

[Deadline and detail evidence](round2-deadline-evidence.md) distinguishes public-port
engine checks, full libSQL historical-store tests, supplementary exact-SQL SQLite checks,
Edge and native qualification.

Before: the schema-default test failed; both one-day wait/restart tests received failed
instead of waiting; item detail retained 20,000 characters instead of 16,384. Exact old
SQL pinned 3600 for an omitted setting. A later numeric-edit regression also failed
before the draft-state fix. Each failure log is preserved.

After: a default run remains waiting after advancing 24 hours, with and without restart,
then succeeds after its observed signal. An authored 5-second parent deadline fails
RUN_DEADLINE_EXCEEDED and cancels its awaited child. An old store's omitted deadline is
pinned null on existing runs, queued events and saved admission intents; authored 5 and
null remain intact. Item details are bounded while finalText retains all 20,000 characters.
Focused results: contracts 6 passed; engine 19 passed; infrastructure 94 passed;
presentation 6 passed, including deadline replacement. Final Edge feature specs: 2 passed.

| Package        | Final / reporting tests     | Lines              | Branches           | Initial qualification                                                      |
| -------------- | --------------------------- | ------------------ | ------------------ | -------------------------------------------------------------------------- |
| contracts      | 264 passed (264)            | 99.73% (379/380)   | 95.00% (190/200)   | Passed                                                                     |
| domain         | 591 passed (591)            | 98.47% (2005/2036) | 95.78% (2272/2372) | Passed                                                                     |
| engine         | 593 passed (593)            | 97.94% (2287/2335) | 92.59% (1902/2054) | Two stale timer assertions corrected; full final pass                      |
| adapter-codex  | 97 passed; 5 skipped (102)  | 98.79% (328/332)   | 94.72% (323/341)   | Five existing live skips                                                   |
| infrastructure | 26 failed; 632 passed (658) | 97.53% (2020/2071) | 94.00% (1647/1752) | Initial 649 passed / 9 failed; native/process and timing failures retained |
| web            | 1508 passed (1508)          | 98.92% (7057/7134) | 94.94% (7262/7649) | Initial 1368 passed / 4 failed, plus 5 worker-start errors                 |
| api-client     | 71 passed (71)              | 100.00% (246/246)  | 99.36% (157/158)   | Initial 70 passed / 1 template timing failure                              |
| api            | 719 passed; 6 skipped (725) | 97.90% (1773/1811) | 92.93% (1262/1358) | Initial 717 passed / 2 failed / 6 live skips                               |

All eight packages exceed 90 percent lines and branches. Reporting passes do not erase
the initial failed qualifications listed above. The infrastructure reporting command
remains failed with 26 failed tests; its fresh coverage still exceeds policy.

The initial broad commands remain failed even if an additional reporting run passes.
Reporting runs enable coverage.reportOnFailure without changing thresholds, exclusions,
assertions or timeouts. Full reruns were needed because Vitest suppressed coverage on
failure; they are not retry-to-green. The engine rerun followed correction of stale
Round 1 timer-count expectations.

## 5. Gates

Node 22.14.0; pnpm.cmd from PowerShell in this worktree only.

- Final typecheck, lint and production build passed after the numeric-edit fix.
- docs:generate, generated API-client update and check:docs passed.
- check:layers, check:deps, check:tokens and check:migrations passed. The dependency
  check retains its existing orphan Drizzle-config warning.
- Initial format:check failed on formatting of fixtures/result JSON. Changed files and
  evidence were formatted; final format and diff results are in round2-final-checks.log.
- Initial three-spec Edge run: 9 passed, 1 definition-pin status-refresh assertion
  failed. The two updated feature specs passed again after the final build. One
  intermediate attempt failed a stale expected-3600 assertion while correctly saving
  5; the assertion was corrected and both feature specs passed. No product timeout
  was changed and the original unrelated Edge failure remains qualified.
- Native fake-CLI runner failed before the API listened within its existing 30-second
  startup budget: ECONNREFUSED, process still alive, no whitelisted stderr code. No
  native turn scenarios ran in this attempt. Round 1 native success is historical,
  not current qualification of the full runner. A separate filtered `stall` scenario,
  which the failed full attempt never reached, then passed after coverage completed:
  native fake PID exited in 72 ms after Cancel; an authored 5-second deadline failed
  RUN_DEADLINE_EXCEEDED. Its startup and HTTP budgets were unchanged. Native startup was thereby observed;
  one targeted success scenario then passed (null default pin, ten-visit default cap,
  more than 20 unlimited fake turns and bounded cancellation). The initial full native
  command remains failed; no quota/transport/unknown scenario was repeated in this round.

## 6. Docs

Updated docs/04, docs/05, docs/06 cutoff audit, guides 02/03/06, ADR-0047 and CHANGELOG
including upgrade notes. No existing loop or run gains a deadline; authored numbers
remain. Generated API references use default null. The plan identifies D-027 and the
historical Round 1 checkpoint; new evidence is separate.

[Owner QA README](README.md) remains self-contained: Node 22, build, isolated gg-wp-f3-
TEMP store, explicit data/DB paths, ports 5900-5909, native fake CLI, visible defaults,
Unlimited visits/passes, authored deadline, cancellation and guarded cleanup. All five
PowerShell blocks parse. It also supplies controlled overnight/migration/detail commands.
Owner acceptance is not reinstated as a merge gate; independent review and QA remain.

## 7. Decisions and parameters

D-027 rejects a finite default because it would newly stop overnight human waits,
long heartbeats and polling workflows. runDeadlineSeconds is nullable().default(null).
3600 is a Limited-mode suggestion, not an owner-approved default. maxNodeVisits keeps
its existing 10 default; null is explicit Unlimited for visits/passes. Authored deadlines
start at first execution and include waits, pauses and restart downtime, excluding queue.

The 16 KiB ASCII / 16,384-character per-item detail slice is a durable event-storage and
inspector bound; it does not truncate final results or stop execution. The 4 MiB stream
bound remains a typed HARNESS_OUTPUT_LIMIT failure. No cost, token, usage or provider-turn
budget is introduced. The accepted single transport retry remains positively unsubmitted
and retriable only; cancel first, fresh turn event, uncertain attempt provenance.

## 8. Caveats and open items

Independent QA and orchestrator review remain. Migration 0015 collides with other open
branches; the orchestrator renumbers in landing order as directed, not in this worktree.

Observed outside scope, retained for follow-up:

- WP-F3-R2-NATIVE-STARTUP: the initial full runner did not listen within 30 seconds.
  After coverage finished, isolated stall and default-pin/over-20-turn scenarios passed
  with unchanged budgets. Cancellation took 72 ms for the stalled PID and 49 ms for the
  over-20-turn loop. The initial startup failure remains an environment qualification;
  independent QA should run the complete matrix in its own isolated environment.
- WP-F3-R2-PROCESS-CONTROL: infrastructure native process-tree cancellation/confirmation
  failures and locked standard fixture directories remain D-015 qualifications. No
  unknown process was killed; a CIM inventory request was denied by the sandbox.
- WP-F3-R2-INSPECTOR-STATUS: definition-pins.spec.ts:82 did not see a succeeded header,
  although captured context showed run.finished succeeded in event 14 and Run deadline:
  none. The header still said running at done. No inspector-status workaround was made.
- WP-F3-R2-BROAD-SUITES: original web undo/focus/routing/worker failures, API child-restart
  and poll-depth failures, client template timing failure and upgrade timeouts remain
  failed qualifications; reporting passes do not erase them.

No owner app/store, main-checkout build, paid provider turn or installed-runtime change.
Final boundary checks confirmed unchanged protected files, base HEAD and an empty index.
Closing TEMP and format checks are recorded in round2-final-checks.log. Coverage, test-results and report
directories are left for the orchestrator under COMMON.md.

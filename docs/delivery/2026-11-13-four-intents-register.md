# Four-intent delivery register — 2026-11-13

## Authority, scope and order

The owner authorized backlog reconciliation followed by I08, bounded runtime recovery, Claude Code integration and launcher delivery, with the Claude plugin alongside I08. The [scoped dispatch record](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/279#issuecomment-6872558885) records the instruction and retained gates. This extends the earlier release for the named work only; the older I08 hold is historical.

Baseline: `b3b5e1874a8252cc01c065d18fef42cbfbe075b4`, including merged PR #457. The owner checkout was clean. Separate PR #460 and issue #458 retain their explicit owner merge hold and incident workflow; this batch does not merge or modify them. Recheck target drift before each integration.

| Lane                             | Scope                                                                                       | Sequence and state                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| I08 authoring                    | #290; #311/#312/#313; #64, #323, #125, #221, #237, #207, #209, #273, #208, #228, #229, #235 | First lane. Begin with #228/#229; conditional reproduction precedes corrective editor changes.                     |
| Claude Code plugin               | #455; #344 shared builder-output safety prerequisite                                        | Alongside I08. Builder safety precedes shared assembly.                                                            |
| Runtime correctness and recovery | #361, #381 incorporating #414, #410, #419                                                   | After engineering delivery of the first two lanes.                                                                 |
| Launcher delivery                | #435, #436, #438, #456                                                                      | After runtime recovery. #456 requires its written architecture plan and human plan approval before implementation. |

#409/#434/#437 remain optional owning-path follow-ups, not blanket dispatch. #407/#452 are narrow gate prerequisites only if a current reproduction establishes need. Full installers, the remaining macOS/distribution epics, broad mobile editing, themes, additional providers, attachments and post-1.0 quota handling remain parked. A lane can advance after its engineering gates without claiming outstanding human acceptance complete.

## Preserved gates and boundaries

- Follow [issue workflow](../15-issue-workflow.md) and AGENTS.md. Project Node 22.23.4 satisfies the supported runtime floor; every gate runs through pnpm. Coverage thresholds, exclusions, retries and timeouts are not weakened to obtain green results.
- Use isolated implementation, opposite-family review, separate behavior QA, current-head CI, and a fresh independent Astra auditor at `max` effort. The final verdict names the full head and target SHA. New changes or integration context need confirmation from that auditor. An interrupted or refused review has no verdict.
- Preserve the earlier register's D-029/D-035 mechanism: at most three adversarial scans per PR, counting vendor review and final audit together, never reset with another head or agent. Batch findings by root cause, preserve dispositions, and use a targeted correction review when needed. At the cap, the documented completion path still requires fixing known in-scope blockers, independent behavior QA and green CI; it never turns a known defect into acceptance.
- Implementation, review, QA, CI, audit, merge, human QA and closure are separate states. Keep explicit owner-only closure obligations and use `Part of` references. Agent evidence never completes the human step. Product ambiguity and genuinely unavailable verification go to the owner as concrete decisions; routine testable behavior remains pipeline work.
- Preserve conditional reproductions, existing approved plans, and protected issues/relationships listed in #279. `plan-approved` is human-only. Owner authorization does not bypass tool permissions.
- Do not alter the owner checkout, installed application, credentials, real store or ports 4747/4748. Use disposable data and alternate loopback ports. Preserve existing worktrees, including the separate #460 incident branch.
- No public marketplace release, personal Claude installation, paid overages or model substitution is included. Distinguish scripted provider boundaries, real CLI/tool loading, native-platform behavior and live-model judgment in evidence.
- Serialize full local build/coverage/browser suites between workers. Focused checks can run independently; load-related failures are recorded rather than retried into a claimed first-pass success.

## Reconciliation completed

The fresh inventory had 158 open issues. Reconciliation closed 18 records, leaving 140; every remaining non-epic has a gate or parking marker. See [reconciliation evidence](../qa/2026-11-13-backlog-reconciliation/README.md).

- Fifteen retirement reports were closed as obsolete after the accepted #280/#338 cutover: #131, #132, #133, #136, #138, #139, #141, #142, #143, #144, #145, #146, #148, #149 and #153. Each records removal evidence and its surviving ordinary-loop boundary.
- #134 was closed as completed because the surviving installed-template package fault path has sanitized 503 handling and regression coverage. #400 was closed as completed because the browser assertions now use the delivered failure classification and dynamic event count.
- #414 was closed as a native duplicate of #381 after #381's body was updated and read back with the public stack/path exposure criteria. This is consolidation, not a completed fix.
- Seventeen delivered issues remain open for owner acceptance or closure and were removed from implementation pickup: #33, #116, #185, #187, #205, #240, #255, #256, #265, #276, #319, #322, #325, #439, #440, #441 and #449. Their original acceptance/history remains intact.
- #421 remains open: #454 addresses the confirmed draining-to-503-to-disconnect case, while the stopped-response wording and corresponding assertion need separate disposition. #453 retains the unexplained historical measurement failure despite added diagnostics and portability fixes. Unrelated follow-ups were parked or retained for refinement.
- The owner cold-launched desktop and taskbar shortcuts on the installed #460 incident candidate. Those observations are recorded without converting the broader #276/#325 lifecycle obligations or #460's separate merge hold into completion.

The old I01–I07 result remains 59/59 engineering implementations merged, with its separate acceptance obligations and historical integrated-test limitations. Reconciliation does not declare those seven intents accepted.

## Initial work packages

| Package                       | Implementer       | Review                         | QA                      | Audit                    | Current state                                                              |
| ----------------------------- | ----------------- | ------------------------------ | ----------------------- | ------------------------ | -------------------------------------------------------------------------- |
| I08 validation: #228/#229     | GPT-6.1 Sol xhigh | Claude Opus 5.5 xhigh, pending | Separate agent, pending | Fresh Astra max, pending | Dispatched after reconciliation; baseline reproductions retained.          |
| Plugin output ownership: #344 | GPT-6.1 Sol xhigh | Claude Opus 5.5 xhigh, pending | Separate agent, pending | Fresh Astra max, pending | Dispatched alongside I08; plugin #455 follows its safe assembly primitive. |

No implementation PR in this new batch has a review verdict or merge authorization from an auditor at this checkpoint. Exact heads, target tips, commands, CI links, scan counts and finding dispositions will be added as each package reaches those gates.

## Runtime refinement

#381 now distinguishes recognized authored expression/mutation/patch failures from unexpected engine or infrastructure faults. Deterministic authored failures are typed and non-resumable with useful bounded author diagnostics; public new failure records omit implementation stack traces and paths, while genuine diagnostics remain in server logs. Preserve cancellation, deadline, script and inference classification. Do not classify arbitrary exceptions as deterministic author errors or rewrite historical records.

#361 rejects malformed dedupe identities before admission without introducing normalization collisions. #410 removes current waits from terminal projections while preserving event history. #419 propagates real HTTP disconnection into historical replay and stops between pages without truncating successful reads. Each requires a current public-interface reproduction and corresponding real SQLite/HTTP evidence before completion.

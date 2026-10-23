# Round 2 deadline and item-detail evidence

These are controlled component checks, separate from independent QA and native process
qualification. All commands ran in this worktree with Node 22.14.0 and pnpm.cmd.

| Requirement                                       | Before                                                                                     | After                                                                                                         | Evidence                                                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Omitted deadline survives over an hour of waiting | After advancing 24 hours, the run was failed instead of waiting, with and without recovery | Both runs remain waiting, pin null, accept the observed signal and succeed                                    | round2-before-long-wait.log; round2-focused-engine.log; round2-coverage-engine-final.log; packages/engine/src/unlimited.test.ts       |
| Authored 5-second deadline cancels children       | New authored scenario retains deadline enforcement                                         | A waiting parent fails RUN_DEADLINE_EXCEEDED after advancing six seconds; its awaited child becomes cancelled | Engine test `cancels awaited child work when the parent deadline expires`; focused 19 passed and full 593 passed                      |
| Existing historical run gains no deadline         | Exact round-1 SQL pins 3600 for an omitted setting                                         | Exact current SQL pins null; authored 5 stays 5; run, queued-event and saved webhook pins agree               | round2-migration-before-after.json; full libSQL historical fixture in packages/infrastructure/src/sqlite/definition-pins.test.ts      |
| Item storage bound preserves full final output    | New detail regression failed because 20,000 characters were stored per item                | Message, reasoning and tool-output item details are 16,384 characters; finalText stays all 20,000 characters  | round2-before-storage-detail.log; packages/infrastructure/src/claude/protocol.test.ts; protocol cases passed in focused and full runs |

The SQL before/after artifact uses exact migration text and SQLite in memory with the
minimal historical columns needed by that migration. The shipped-migration Vitest fixture
also exercises the full libSQL historical store, including immutable snapshot copying,
run and event pins, saved intents, authored null/5 and idempotence. No owner store is used.

The native runner attempted the built API with its native fake CLI and an isolated
`gg-wp-f3-` store on 5900-5909. It failed before listening within the unchanged 30-second
startup budget (ECONNREFUSED), so native cancellation and five-second expiry are not
qualified by the initial full native attempt. Preserve that failure for independent QA; do not
infer a current native pass from round 1's historical success.

Edge on the production build: both `unlimited-mode.spec.ts` cases passed (default
No run deadline, Limited suggestion, saved null, inspector none, Settings and Unlimited
passes). Across the three selected specs, nine passed and one definition-pin UI status
assertion failed. Its captured timeline includes `run.finished succeeded`, while the
header still says running at done; this is an unresolved inspector refresh observation,
not a deadline expiry. The initial failure log is preserved in round2-edge.log. Later Playwright invocations replace the test-results directory.

Final focused infrastructure result: 94 passed, including full historical libSQL fixture,
authored null/5 preservation, and bounded item details with complete finalText.

The Limited-input replacement regression failed before the draft-state fix, then all
six presentation tests passed. The first updated browser attempt confirmed 5 was saved,
but failed a stale assertion still expecting 3600; that assertion was corrected to 5.
The logs preserve this test mistake separately from product and environment failures.

After all coverage commands completed, a separate filtered stall scenario (not reached
by the failed full attempt) passed with the same startup/HTTP budgets. The native fake
CLI PID was gone within 72 ms of Cancel; an authored 5-second run failed
RUN_DEADLINE_EXCEEDED. See round2-native-stall.log. The full default-cap / over-20-turn
native scenario remains unqualified by the initial startup failure.

Once the stall scenario demonstrated native API startup, one targeted success scenario
also passed: the omitted deadline pinned null, the default ten-visit cap held, and an
Unlimited fake loop exceeded 20 turns then cancelled. See round2-native-success.log.
This is current positive native evidence with the initial startup failure retained;
no startup/test timeout was changed and no full-suite retry was performed.

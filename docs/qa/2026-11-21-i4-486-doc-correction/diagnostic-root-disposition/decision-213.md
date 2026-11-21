# D213 — Retain unresolved PWA observations without a speculative production correction

Authority: the owner's delegated blocker decisions, with catalogue/rework at consolidated owner sign-off. This is a coordinator disposition under the accepted bounded-scope/review process, not a CI waiver, owner acceptance or human plan approval.

## Decision and evidence

D212's bounded diagnosis is complete. The [original Linux CI diagnosis](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/553#issuecomment-7067769486) and [two local diagnostic invocations](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/553#issuecomment-7067985393) remain separate evidence. Original run44934348117 remains FAILED, with Browser487 passed/1 skipped/1 failed. No ordinary CI retry was run.

The Windows diagnostics used source29e plus six disclosed observation files, the same Edge158.0.4370.33 and Playwright1.63.0, unchanged original test deadlines/assertions and zero retries. The isolated target passed in6,274ms. The second invocation's first two predecessors passed; cold offline reload then failed because it showed Cannot reach the GraphGoblin API instead of You are offline. Playwright replaced the worker before the target passed in6,296ms. Across both invocations: five records, four passed/one failed. The second invocation is not a successful same-worker sequence comparison.

Both target records captured the complete expected first dirty veto and second APPLY/exclusive/COMMIT/activation/controller/reload transaction. These successes cannot fill the original Linux trace's missing protocol observations. The original missed-reload cause remains unresolved. The new offline-banner observation is instrumented Windows evidence, not a proven pristine product defect. No flakiness, reset-handler root cause, pre-existing product defect or direct #486 regression is asserted. Exact unchanged web-source identity excludes a direct web edit only.

Selected disposition:

1. No production correction is justified by the current causal evidence. Preserve the two completed diagnostic invocations; do not expand into repeated attempts, speculative PWA redesign or changed timeout/oracle behavior in the authored-engine-diagnostics PR.
2. Preserve the original missed-reload observation and missing failure-stage evidence in parked [#555](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/555). Preserve the distinct instrumented offline-banner mismatch in parked [#556](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/556). Open/closed duplicate searches and related closed #47/#55/#56 snapshots are retained. No shared root cause is known, so two bounded outcomes are tracked separately. These are outside the26-issue denominator and are not dispatched.
3. Continue the already-required static correction review after Claude's reset, then the real preplanned evidence miniarchive and mandatory final candidate verification. Full current-head/current-target ordinary CI including Browser, numeric coverage, native replay and independent Astra MAX scan3 remain prerequisites. Neither these local passes nor issue creation authorizes merge. A later green candidate does not erase the old failure or establish its cause.
4. If final ordinary CI repeats a related failure or new evidence establishes an introduced/reproducible defect, reopen the engineering disposition before acceptance. Do not use these parked issues to waive a red gate or conceal contrary evidence. Any warranted correction needs the appropriate tests, independent QA and opposite-family correction review before final scan3.

## Why and alternatives

- Chosen: retain observed negative evidence, avoid an unsupported runtime change, preserve durable investigation outcomes, and require the actual final candidate to satisfy every technical gate. The current change's web source is unchanged; both local observed transactions worked; the historic failing stage remains unknown.
- Rejected: report the target fixed, the full sequence passed or CI green. The source-bound records directly contradict each statement.
- Rejected: call the failure flaky/pre-existing solely from unchanged web bytes or local passes. Those do not exclude indirect runtime/environment effects or reproduce Linux.
- Rejected: repeat the same test until green, raise deadlines, remove the banner assertion, or accept either banner. That changes the evidence/oracle rather than identifying a cause.
- Rejected: speculative production changes to update activation or offline classification. They expand the #486 contract without an established defect/cause and could weaken voice-draft safety.
- Rejected: discard the separate offline observation or merge both observations into one presumed root cause. The causal relationship is unestablished.
- Rejected: count follow-up creation as completion of those investigations or of #486. Final CI/review/merge and the parked work remain distinct.

## QA and cleanup record

Reproduction report SHA256 `6ee184e2969f62844a923d4c411ee00643e900af68c19fa5a400034952eb7fa8`;67-member seal `20d5be8f684906bf94e783a3cc2ce0b05f54de0a12160a185109384f4cbed1f8`, fully verified by root. Source/oracle proofs, all preparation failures (two install commands/two build commands), observer errors and first-body/cleanup logging limitations remain original. The error handlers added for the target were not exercised because both target runs passed.

The isolated diagnostic index, delivery29e and Claude author67 remain unchanged; only the new diagnostic worktree contains the disclosed uncommitted observation patch. Two process-local memory databases used trusted test mode and fake harnesses. No reusable task store/key was found.23 recorded task PIDs, exact task command-line matches and owned listeners were absent after normal teardown. Random scratch suffixes were unobserved before automatic removal and are not invented. The bounded credential/image inspection is not exhaustive assurance. D208's earlier nonrevoked-store-key policy is not silently applied to these separate runs.

Engineering remains20/26 and3/5intents. #364/486 final gates remain open; intent5 remains unadmitted until intent4 engineering completes. Consolidated owner decision review/QA, held#460 and separate Mac#501 remain unchanged.

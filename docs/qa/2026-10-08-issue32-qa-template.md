# Issue #32 QA template ledger

**Status: partial delivery; issue #32 remains open.** The current runtime has no enforced evidence-only isolation. The template can be configured and saved as a draft, but it cannot produce accepted QA evidence. The issue update records this boundary and the remaining acceptance work: [issue update](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/32#issuecomment-6067115149).

## Current product boundary

The run path is metadata-only and blocked before repository checkout or any QA/adversary model turn. No proof is created or pushed; no issue is reopened or relabeled. The only repository effect permitted by the design is one fixed, idempotent explanatory comment on the original linked issue; this behavior has not yet received native GitHub acceptance in this delivery. No isolation override exists. Positive proof production and rework behavior are covered only by injected unit tests, not by an actual isolated run. There is no native QA pass to claim.

Publishing the parent starts its poll; without an initial cutoff it may admit older eligible merged pull requests, one per poll. While isolation is unavailable, each admitted candidate creates a failed no-turn attempt, permanently consumes its merge and linked-issue attempt, and may post the fixed explanation. Keep the parent unpublished until enforced isolation is available.

## Verification recorded so far

- **API coverage:** 1,293 passed, 4 skipped; statements 94.06%, branches 90.65%, functions 96.05%, lines 95.76%. The local receipt is `.tmp/aidlc-delivery-2026-10-06/issue32-final-integrated-api-coverage.log`.
- **Web tests:** 1,123 passed; all four coverage metrics exceed 90%. The full web run completed in 403.86 seconds; lines 98.40% and branches 93.04%.
- **Build, typecheck, lint, template checks, and generated-doc checks:** passed on integrated source `362cc2652276179693b4904d387b84ac18012bd6`. Receipts are `issue32-final-integrated-{build,typecheck,lint,templates,docs}.log` in the same local evidence directory.
- **Formatting, layers, dependency boundaries, licences, design tokens, and contrast:** passed. Formatting required working-tree line-ending normalization of two files with no semantic diff. Dependency checks used Node 22 and retained the existing non-error Drizzle orphan warning. These results are package gates, not final release acceptance.
- **Opus code review:** report `opus32-code-full-80c21b9-review.md` found one P2 disclosure finding. The gallery and guide now disclose older-merge polling, attempt consumption, and the possible comment; this is a copy-only fix for root review, not a runtime cutoff. F2 extends #140's poll-starvation scope; F3 and F4 are deferred for root triage. No Opus re-review is recorded yet.
- **Browser preflight:** failed before any template creation because the preview helper could not resolve a required asset path. No gallery workflow or instance creation occurred, so there is no browser acceptance result.
- **Native and Codex verification:** pending. No final integrated native QA acceptance is recorded here.

These are implementation and package checks; they do not demonstrate enforced isolation or a successful QA run.

## Bounded browser review and repairs

The later bounded browser review completed with eight accepted inspection receipts in `opus3132-browser-overlay-v1-20261009T010639.896Z.evidence.json`. Admission preserved the original seven-of-eight preflight and its keyboard failure, plus a separate zero-write keyboard supplement; no missing preflight receipt was fabricated. All four permitted creations were consumed, and final effects remained six loops, zero runs, zero turns, and zero denials. The preview was stopped before the following source repairs; there is no post-repair browser rerun to claim.

Two introduced UI findings are fixed in source: the saved QA parent editor now carries the isolation and permanent-attempt warning through its owner-scoped template instance and labels graph readiness separately; pending requirements checks retain keyboard focus and reject duplicate activation. Focused mock-server verification passed 29 tests: three API origin/ownership cases, eight saved-editor identity/readiness cases, and 18 gallery/validation cases including pending success/failure, duplicate activation, and a deliberate focus move. API, web, and regenerated API-client source typechecks passed. The first editor run failed only because its test expected a warning to use the shared component's `alert` role; warnings use polite `status`, and the corrected assertion passed. Full post-repair API coverage subsequently passed 1,302 tests with four skips (statements 94.13%, branches 90.75%, functions 96.06%, lines 95.83%); web coverage passed 1,134 tests in 100 files (97.49%, 93.08%, 97.61%, 98.40%). The full build, generated-client drift check and generated-doc check passed. Actual post-repair browser acceptance remains pending. The overlapping canvas/unclear route finding stays deferred to #124/#125. Receipt fields initialized to false were a helper reporting limitation, not product findings; originals and failure evidence remain unchanged.

Installed Opus 5.5 accepted the two repairs in `opus32-ui-repair-review-v1-review.md`. It inspected current worktree source, but its file scope prevented reading the external diff/hash manifest; root and the implementer separately checked the frozen hashes. This source review ran no browser or tests. The uncommon metadata-loading/failure readiness wording is deferred to #148; stale-settings error presentation requires no change. The earlier full/targeted review dispositions are #140 and #143–#145.

## Historical failure, superseded

An earlier combined API checkpoint first had stale migration/catalog fixtures and five tests that timed out while another coverage job was active. Those five unchanged cases passed when rerun in isolation. A later checkpoint passed 1,149 tests with 2 skipped but failed the branch threshold at 89.32%; most uncovered branches were inherited paused #31 review/shared code. That checkpoint predates the current integrated receipt above and is not the current API coverage result. Keep it in the history; do not present it as a current pass or a current failure.

## Remaining acceptance

- Complete root's source-repair verification and final independent code reviews. Retain the bounded pre-repair browser result above and its limits; no additional browser creation budget is authorized.
- Complete the bounded native read-only metadata/admission and no-turn refusal checks, including the single-comment behavior if exercised. Keep all credentials out of receipts.
- Keep positive isolation, proof creation, adversary assessment, and rework acceptance open until an enforced isolation runtime is independently verified. Do not add a test-only override or claim success from injected unit tests.

## Deferred scope

Session continuity #33, context projection/input preview #38, default spacing #124, and saved node/line routes #125 remain deferred. This ledger does not authorize a merge, production run, provider call, GitHub write, or local-install update.

## Final child source and browser evidence update

This update supersedes the earlier pending post-repair source/browser statements above; it does not close #32. Source `9dcc66c6e09d73ec1b587390301f11a7ab1b1725` retains the fixed unavailable isolation boundary: no QA/adversary turns, checkout, proof/push, reopen or relabel. Positive QA, demonstrated evidence isolation and rework remain unmet acceptance.

Full post-repair API coverage passed 1,302 tests with four skips (statements/branches/functions/lines: 94.13%/90.75%/96.06%/95.83%); web passed 1,134 tests (97.49%/93.08%/97.61%/98.40%). Build, generated client/docs and the recorded repository gates passed. Installed Opus full/targeted and UI-repair source reviews are accepted. Independent GPT-6.1 Sol reviewed this exact child against `e69930419e733446c8ba5942f5714a3fb30a74d4`; `sol32-independent-9dcc66c-review.md` records no new FIX-IN-PR blocker. The independent Sol fallback was explicitly authorized after GitHub review quota exhaustion.

Actual Opus browser repair review passed saved QA-parent warning/readiness after reload and the saved review-parent case. The focus supplement failed before duplicate/completion actions because its CSS `[role="dialog"]` assertion cannot recognize the product's native dialog with an implicit role. The completed active-element busy check and retained focused `Checking…` screenshot support pending focus. Duplicate activation and completion remain unobserved in the browser; existing focused success/failure/duplicate/focus-move unit tests passed in the recorded full verification. Preserve both failed bridge results. `opus32-ui-focus-v1-reconciliation.md` explains the precise assertion and reporting limits; it does not convert either run to a browser pass.

`preview32-ui-repair-v1-final-state.json` records two consumed read-only prerequisite checks, four retained instances/six loops, zero new creates/publishes/inputs/runs/model turns, no denied requests and preserved parent drafts. Original stores and consumed evidence remain preserved; no further repair-check budget remains.

Native boundary acceptance is complete on executable source 9dcc66c. A genuine packaged poll discovered the exact merged scratch PR and admitted one QA attempt. It finalized with TEMPLATE_ISOLATION_UNAVAILABLE, with only run.queued and run.failed events, zero node/model/child starts, no checkout/proof/reopen/relabel effects, and one exact fixed explanatory issue comment. The original helper timed out because it read finalizedAt from a RunRecord that does not expose that field; the failed helper and all consumed counters remain preserved. Read-only SQL and authenticated authority verified actual finalization. The one remaining restart poll rediscovered the same merge and started no new run or comment. The accepted supplement records two cumulative polls, one admission, one comment, unchanged prior run/event/graph/session records and remote refs, and the same consumed attempt. Evidence: issue32-first-poll-readonly-inspection.json and issue32-native-restart-supplement-v1.result.json in the primary delivery archive. This verifies refusal and deduplication only; positive isolated QA and proof/rework acceptance remain unavailable.

Follow-ups remain #140/#143–#145 and #148/#149. #148 covers origin metadata loading/failure wording; #149 is the currently unreachable controller/history rework visit-key mismatch and must precede future positive-QA enablement. #33/#38 and #124/#125 remain deferred. #32 stays open as a partial delivery; this update claims no isolated QA pass or proof/rework acceptance.

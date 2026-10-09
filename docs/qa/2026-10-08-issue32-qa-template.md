# Issue #32 QA template ledger

**Status: partial delivery; issue #32 remains open.** The current runtime has no enforced evidence-only isolation. The template can be configured and saved as a draft, but it cannot produce accepted QA evidence. The issue update records this boundary and the remaining acceptance work: [issue update](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/32#issuecomment-6067115149).

## Current product boundary

The run path is metadata-only and blocked before repository checkout or any QA/adversary model turn. No proof is created or pushed; no issue is reopened or relabeled. The only repository effect permitted by the design is one fixed, idempotent explanatory comment on the original linked issue; this behavior has not yet received native GitHub acceptance in this delivery. No isolation override exists. Positive proof production and rework behavior are covered only by injected unit tests, not by an actual isolated run. There is no native QA pass to claim.

## Verification recorded so far

- **API coverage:** 1,293 passed, 4 skipped; statements 94.06%, branches 90.65%, functions 96.05%, lines 95.76%. The local receipt is `.tmp/aidlc-delivery-2026-10-06/issue32-final-integrated-api-coverage.log`.
- **Web tests:** 1,123 passed; all four coverage metrics exceed 90%. The full web run completed in 403.86 seconds; lines 98.40% and branches 93.04%.
- **Build, typecheck, lint, template checks, and generated-doc checks:** passed on integrated source `362cc2652276179693b4904d387b84ac18012bd6`. Receipts are `issue32-final-integrated-{build,typecheck,lint,templates,docs}.log` in the same local evidence directory.
- **Formatting, layers, dependency boundaries, licences, design tokens, and contrast:** passed. Formatting required working-tree line-ending normalization of two files with no semantic diff. Dependency checks used Node 22 and retained the existing non-error Drizzle orphan warning. These results are package gates, not final release acceptance.
- **Native, browser, Codex, and Opus verification:** pending. No final integrated browser or native QA acceptance is recorded here.

These are implementation and package checks; they do not demonstrate enforced isolation or a successful QA run.

## Historical failure, superseded

An earlier combined API checkpoint first had stale migration/catalog fixtures and five tests that timed out while another coverage job was active. Those five unchanged cases passed when rerun in isolation. A later checkpoint passed 1,149 tests with 2 skipped but failed the branch threshold at 89.32%; most uncovered branches were inherited paused #31 review/shared code. That checkpoint predates the current integrated receipt above and is not the current API coverage result. Keep it in the history; do not present it as a current pass or a current failure.

## Remaining acceptance

- Complete root's final integrated browser and independent code reviews. Record their actual outcome and limits; do not convert skipped or unavailable checks into passes.
- Complete the bounded native read-only metadata/admission and no-turn refusal checks, including the single-comment behavior if exercised. Keep all credentials out of receipts.
- Keep positive isolation, proof creation, adversary assessment, and rework acceptance open until an enforced isolation runtime is independently verified. Do not add a test-only override or claim success from injected unit tests.

## Deferred scope

Session continuity #33, context projection/input preview #38, default spacing #124, and saved node/line routes #125 remain deferred. This ledger does not authorize a merge, production run, provider call, GitHub write, or local-install update.

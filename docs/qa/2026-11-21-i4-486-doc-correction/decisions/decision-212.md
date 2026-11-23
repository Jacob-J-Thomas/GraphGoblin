# D212 — Diagnose the failed browser gate; allow only the bounded static correction review before final CI

Authority: the owner delegated blocker decisions with reasons and rejected alternatives catalogued for consolidated sign-off, while preserving all AIDLC review, QA and merge gates. This is an agent decision under that authority, not a human plan-approved label or owner QA completion.

## Evidence and decision

PR #553 head `29e165e14fdda138300ba2a34585ddd47268b475`, tree `d50fb576f1ef4498cb30e52521198575d6d0ebd4`, targets main `a60843a9050b3a203726db84f6abf1f45b8bc694`. Ordinary CI run44934348117 attempt1 FAILED: Browser487 passed/1 skipped/1 failed; the other five jobs passed. No whole-run verified.json exists and none may be synthesized from partial receipts.

The sealed diagnosis establishes that the second Update click did not reload. The later /worker/reset error happened after fixture disposal and masked that earlier body timeout. The visible verification-failure transition is consistent with the page's15-second timeout, but the actual protocol stage is unresolved. Exact web-source identity with main excludes a direct web-source change, not indirect runtime effects, an existing bug or scheduling effects. Calling it flaky or harmless would exceed the evidence.

1. Run one source-bound, instrumented reproduction of the exact case in a new disposable worktree. If it passes without reproducing the failure, permit one bounded sequence including the three immediately preceding PWA cases. Preserve current semantic assertions, test deadlines, zero retries, both body and cleanup failures, exact browser/platform identity, task-owned resource cleanup and all failed attempts. Do not change production behavior or repeat ordinary CI unchanged. Root will disposition actual new evidence before any fix.
2. After the announced Claude quota reset, the already-required actual Fable5.2/xhigh **targeted D209/D211 static correction review** may run with its independent static QA, exact source/index binding, format/diff checks, existing source QA and explicitly partial current CI evidence. The two recovery sentences and one artifact attribute do not depend on the failed PWA runtime assertion for their narrow static review. The old dispatcher's all-six-jobs prerequisite was an orchestration choice, not authorization to invent a passing CI record. Preserve that dispatcher and prepare a new explicitly scoped revision admitting the real failed-run evidence. Give the reviewer the failure and its unresolved limit.
3. This does not authorize general scan3, final sign-off, merge or intent5 admission. Full current-head/current-target ordinary CI, native verification and fresh Astra MAX general scan3 remain required for #486. Exactly two general scans have been consumed. No fourth general scan or extra review budget is granted. If a new production correction becomes necessary, it needs its appropriate tests, independent QA and opposite-family correction review before final scan3.
4. The corrective evidence miniarchive was planned before this failure. After actual correction-review acceptance, archive the complete truthful provider, QA, failed-run/diagnostic disposition and integration evidence, then execute required ordinary CI on that real final candidate. This is not permission for dummy commits or unchanged reruns. A later green candidate does not erase this failure or establish its cause; the unresolved failure remains explicitly recorded. A reproduced product defect cannot be waived by a later pass.

## Why and alternatives

- Chosen: diagnose the actual failed behavior, advance independent bounded static review when Claude resets, and retain every final executable and review gate. This avoids a circular dependency between the preplanned review archive and its final candidate validation without treating partial CI as green.
- Rejected: rerun the unchanged CI until green. That gives no causal evidence and would conceal the known failed attempt.
- Rejected: increase timeouts, weaken the second-click reload oracle or call unchanged web source proof of flakiness. The retained evidence supports none of those changes.
- Rejected: speculative PWA production repair before observing the stalled protocol stage. Several causes remain compatible with the trace.
- Rejected: substitute an OpenAI reviewer, enable paid overages or silently change Claude effort. Existing model requirements and quota policy remain.
- Rejected: use this decision to admit intent5 early or consume Astra scan3 with known failed required checks. Ordered delivery and the stable final-review gate remain.

## Required QA/sign-off evidence and limits

Diagnosis: `G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-553-browser-diagnosis-01/REPORT.md`, SHA256 `cf9455e5c77f97af47d33a4b714650e6574e666e917c0cfe9c1df02434de18f6`;87-member seal `430913442d6b5b3725e6e4c2d39bd6071c0cd7d6a9dbb8cc3d0af4d31fdda2fb`, independently read and verified by root. Partial success report: https://github.com/Jacob-J-Thomas/GraphGoblin/pull/553#issuecomment-7067634339, exact readback retained. It remains partial and CI remains failed.

Before dispatch, the new guard must verify clean29e/tree, full static-QA seal, exact five-success/one-failure run/head/target/tree binding and the actual canonical338-record native receipt's partial status. Before final delivery, record diagnostic outcomes and disposition, actual bounded Claude result, miniarchive proofs, all-success final CI, native replay, fresh scan3 and current-target signed merge. Owner decision acceptance and post-merge human QA remain distinct.

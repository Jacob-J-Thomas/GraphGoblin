# Issue #31: review template verification ledger

Scope: generic GitHub review/fix template, building on #28 and #30. The template uses current repository permissions, exact heads, literal native gate arguments, bounded fresh review/fix sessions and durable human input. Context/session work #33/#38 and layout #124/#125 remain deferred.

## Deterministic evidence

Runtime checkpoint0033adb:993 API tests passed,4 existing/platform skips,45 files passed; coverage93.67% statements,90.19% branches,95.72% functions,95.40% lines. Changed contracts:245 passed;99.77% statements,99.14% branches,100% functions,99.76% lines. Source typecheck, full lint and owned-file formatting passed. The full web suite on the earlier unchanged review settings UI passed1120 tests with all metrics above90%.

The focused168-case suite includes six composed tests using actual API routes, RunManager, PollTriggers, SQLite and the private support stdin boundary. Git/GitHub/model operations in those tests are injected and inert. They verify human inputs and their authorization, durable full/capped waits, timeout distinction, moved-head refusal and exact-head deduplication across restart. These tests do not establish native provider, GitHub or operating-system behavior.

Additional boundary tests verify authentic implementation lineage at attempts2/3, permanently consumed fixer-pushed heads across a missing node.finished record, mapped started-visit/config and signed-journal matching, strict original claim refusal and explicit bot author allowlisting. Both newly imported shared helpers are included in the support closure hash; changing either invalidates the binding. No generic engine, session-continuity or new public-route framework was added.

## Scoped source-review repair F1

The pre-review gate now waits only for required CI checks on the exact head. Native GitHub approvals, mergeability and clean readiness remain fresh merge-time requirements. A timed-out CI snapshot cannot permanently veto an authentic human merge after CI becomes ready; the recorded local gate must still have passed, the workspace must remain clean on the same head, and current authorization and ordinary protection checks still apply.

New inert regressions cover approval-required AI review before native approval, native readiness refusal at merge, same-head human merge after a CI timeout and restart, and continued refusal for incomplete CI, failed local gates and changed heads. A composed case uses actual REST input, RunManager, SQLite, private support stdin and restart to merge after CI recovers with zero model turns and one local gate. Source syntax/type/lint and focused verification are recorded in the repair receipt; root owns combined gates and native acceptance.

## Completed child verification

The repaired #30 planner contract is integrated. Executable source at `e69930419e733446c8ba5942f5714a3fb30a74d4` passed 1,018 API tests with four existing/platform skips; statements/branches/functions/lines are 93.74%/90.30%/95.72%/95.48%. Contracts and web coverage exceed 90% on every metric. Build, typecheck, lint, template validation, generated docs and formatting passed. Root regenerated the API client separately; those generated files are not part of this documentation edit.

Installed Opus 5.5 accepted the full source review and targeted CI/merge-readiness repair. Independent GPT-6.1 Sol reviewed this exact child against `b91fcee3ec2ce080b7a6edb38f7e958cdb9e997c`, finding no new FIX-IN-PR blocker. The user explicitly authorized independent Sol review after the recorded GitHub review quota exhaustion. Follow-ups are [#140](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/140), [#141](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/141), [#142](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/142), and [#146](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/146).

The bounded combined review/QA gallery inspection is accepted with its preserved preflight and keyboard-supplement limits. A later actual Opus browser inspection also passed the saved review parent: ordinary graph readiness and no QA isolation warning. Canvas layout remains deferred to #124/#125. The separate QA32 focus helper failure and its evidence limits do not constitute a review-template defect.

Authentic native v3 acceptance passed on the same executable source. The private-scratch PR #3 reached its persisted capped wait, then the restarted service deduped one poll and accepted a real REST human merge input (`input.received` sequence 60, `run.woken` sequence 61). The continuation made zero model start/resume attempts and one ordinary merge command. The exact approved head was `df118c763d5a72b70204c21cf9b41363a3b4c9bc`; the resulting merge commit is `3bd18385c1f39ebb9a53ac37001e9a6440e2ad08`. The run succeeded and finalized, the service stopped, and the temporary continuation key was revoked. Receipt: `.tmp/aidlc-delivery-2026-10-06/issue31-native-continuation-v3.receipt.json` in the primary evidence directory. This is scratch-workflow acceptance; it did not merge GraphGoblin's feature branch to main.

Earlier failed helper/continuation evidence remains preserved. In particular, overflow/recovery attempts and the prerequisite failure caused by a helper rejecting real Git prerequisite commands are not native passes. The fresh v3 wait and continuation receipts establish the accepted result without rewriting that history.

## Remaining gate

Current-head CI and root's final child acceptance remain pending after the documentation/generated-client update. Merge only this child into the feature branch after those checks pass. The feature-to-main PR must remain unmerged for owner validation. Existing #26/#29/#97 live budgets are not repeated; owner data and installation remain unchanged.

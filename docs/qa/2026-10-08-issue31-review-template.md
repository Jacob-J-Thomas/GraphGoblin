# Issue #31: review template verification ledger

Scope: generic GitHub review/fix template, building on #28 and #30. The template uses current repository permissions, exact heads, literal native gate arguments, bounded fresh review/fix sessions and durable human input. Context/session work #33/#38 and layout #124/#125 remain deferred.

## Deterministic evidence

Runtime checkpoint0033adb:993 API tests passed,4 existing/platform skips,45 files passed; coverage93.67% statements,90.19% branches,95.72% functions,95.40% lines. Changed contracts:245 passed;99.77% statements,99.14% branches,100% functions,99.76% lines. Source typecheck, full lint and owned-file formatting passed. The full web suite on the earlier unchanged review settings UI passed1120 tests with all metrics above90%.

The focused168-case suite includes six composed tests using actual API routes, RunManager, PollTriggers, SQLite and the private support stdin boundary. Git/GitHub/model operations in those tests are injected and inert. They verify human inputs and their authorization, durable full/capped waits, timeout distinction, moved-head refusal and exact-head deduplication across restart. These tests do not establish native provider, GitHub or operating-system behavior.

Additional boundary tests verify authentic implementation lineage at attempts2/3, permanently consumed fixer-pushed heads across a missing node.finished record, mapped started-visit/config and signed-journal matching, strict original claim refusal and explicit bot author allowlisting. Both newly imported shared helpers are included in the support closure hash; changing either invalidates the binding. No generic engine, session-continuity or new public-route framework was added.

## Remaining gates

- Integrate the repaired #30 planner output schema and verify the resulting source and build.
- Run Codex and installed Opus source reviews, then fix or link findings by root cause.
- Run the combined review/QA gallery browser session and bounded real scratch workflow acceptance.
- Current-head CI and production packaging; merge only this child to the feature branch after acceptance.

The final feature-to-main PR must remain unmerged for owner validation. The existing #26/#29/#97 live budgets are not repeated. Owner data and installation remain unchanged.

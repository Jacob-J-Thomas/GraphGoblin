# D227 supporting implementation handoff

Disposition: SUPPORTING SOURCE COMPLETE; PRODUCT UNACCEPTED; ACTUAL CLAUDE CRITIQUE PENDING.

The worker changed exactly the nine paths authorized by decision-227.md. Production UI/code, dependency files, backend, original Claude acceptance fixture, Git index, commits, provider state and publication were not changed by this worker. Actual Claude retains authorship of all production changes. Root separately advanced the local production-only checkpoint from 56e3a48bbe4b652c1d74b55cc61985ff91884075 to 9a895ce29a53e568b540bfd7de1a0e8fb37fa5f9 (tree 95432fa2bb20be353227445f59fabaf69903d9f5); the supporting delta remains unstaged over that checkpoint.

## Exact source

- Original nine complete files: original-source/.
- Final nine complete files: final-source/.
- Exact Git supporting delta: supporting.diff.
- Full before/after hashes for nine supporting files and final hashes for all 22 candidate-source files: source-before-after-manifest.json.
- Preservation proof: preservation-verification.json. All 13 non-owned files from the D226 frozen 20-file candidate still match byte for byte, including all five actual-Claude production files. The original claude-harness.spec.ts remains e509374ea3e05cba35232ab0f59559b31f810a4c2c2fe5d228a5bf3ab07936f0.
- inspector-truthfulness.spec.ts differs by exactly the approved two comment lines; the strict byte replacement check preserves every other byte. The comment establishes browser response completion plus two animation frames and explicitly does not claim React Query consumption.

## Changed paths and purpose

| Path | Change |
| --- | --- |
| apps/web/src/runs/RunInspectorPage.corrective.test.tsx | Preserve INTERNAL_ERROR literal type without any; restrict the obsolete-node assertion to the header's position text while leaving recovery options available. |
| apps/web/src/runs/run-header-status.test.ts | Three C1 cases: old outcome behind cold hint; gaps versus contiguous accepted coverage; new marker at/beyond hint and fresh agreeing terminal receipt behavior. |
| apps/web/src/runs/run-header-store.test.tsx | Two cases: new/evicted slot takes only the negative device cursor, not cached status or receipts; recovered credential scope refuses previous authority. |
| apps/web/src/runs/useRunHeaderStatus.test.tsx | Two cases: cold acknowledged resume stays neutral despite older fresh observation; fresh matching terminal receipt settles without streamed suffix or finalization. |
| apps/web/src/runs/useRunEvents.test.tsx | Three cases: same-key recovery retires old stream/buffer callbacks; held old attempt-follower result is cancelled/ignored; a valid same-scope cleanup batch still advances cursor and supersession. |
| apps/web/src/api/queries.reconnect.test.tsx | Six cases through actual useRun/API-client/QueryClient hooks: successful matching receipt, foreign-run response, cancelled late 200/404 responses, and definitive 404 versus 500 evidence behavior. Generalized only the test mount helper's return type to support combined query/header hooks. |
| docs/09-frontend-and-pwa.md | Describe bounded provider evidence, run-read receipts, credential generation retirement, source-qualified terminal nodes and negative-only cold cursors. |
| CHANGELOG.md | State the same user-visible behavior and unchanged persistent format/polling. |
| apps/web/e2e/inspector-truthfulness.spec.ts | Exact two-line explanatory comment correction only. |

## Validation

Node v22.23.4 was first on PATH; existing pnpm and dependencies only; TMP/TEMP G:/ggq/gg-i5-d227-support-scratch. No full coverage, build or browser execution.

The initial six-file invocation ran 92 tests: 90 passed and two new HTTP404/500 fixture assertions failed. Those assertions immediately read the React Query observer error after refetch resolved, before its observer notification arrived. The failed JSON/log and exact failing query fixture source are retained. The fixture correction awaits the same error assertion with existing waitFor; no assertion, timeout, retry, request or budget allowance was changed. The changed query file then passed 37/37. The other five unchanged test sources already passed 55/55 on the same production bytes. Thus all 92 cases, including 16 new cases, have passing evidence across scoped invocations; there was no single final 92-case rerun.

- Initial output: focused-tests.json and focused-tests.log.txt; failed source: failed-fixture-source/queries.reconnect.test.tsx.
- Corrected query output: query-fixture-corrected-tests.json and query-fixture-corrected-tests.log.txt.
- Full web typecheck: pnpm.cmd --filter @graphgoblin/web typecheck, exit 0; web-typecheck.log.txt.
- Scoped lint for all seven supporting TypeScript/TSX paths: exit 0; scoped-lint.log.txt.
- git diff --check: exit 0.
- Exact commands, counts, failure disposition and limits: validation.json.

An initial evidence-only seal assertion assumed CRLF in the original E2E fixture, which is LF-only. It stopped before generating the manifests. The corrected newline-aware checker passed strict byte preservation. No source changed during either evidence attempt; seal-attempt-01.log.txt retains this disposition.

## Limits and next owner

These are controlled selector/registry/hook/jsdom checks. They are not the separately owned 31-case public QA, actual browser acceptance, full coverage, product review, audit, CI/native checks, publication or merge. No production defect was attributed by this worker. The fresh actual Claude opposite-family critique must review this exact supporting.diff and source manifest. Root owns integration, all further product gates and any production correction through the actual-Claude route. No known product failure is waived and the failed author terminal remains unchanged.

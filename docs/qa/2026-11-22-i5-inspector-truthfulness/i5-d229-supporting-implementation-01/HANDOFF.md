# D229 supporting implementation handoff

Status: SUPPORTING SOURCE COMPLETE; PRODUCT UNACCEPTED; ACTUAL CLAUDE TARGETED CORRECTION REVIEW PENDING.

Exactly seven permitted supporting paths changed over clean unsigned 3168250645fe37bced7ace6a664c82fd137b1196, tree 920a5471f4dc7c374cbfe724984bd7615da395d9. This worker changed no production, actual-Claude selector unit, E2E, dependency, backend, persistence or configuration bytes, and performed no index/staging, commit, provider, account or publication action. Actual Claude retains authorship of all production changes. D228's visible pre-edit CHANGES REQUIRED critique is preserved as a completed negative review; its subsequent author terminal remains budget-stopped without a completed handoff. That critique does not approve this new GPT support delta.

## Changes and desired outcomes

| Supporting path | Change and evidence scope |
| --- | --- |
| apps/web/src/api/api-key.test.tsx | One new cross-tab same-key recovery generation test; a repeated unchanged storage notification starts no further generation. Existing replacement, forgetting, focus, key entry and stream recovery controls remain. |
| apps/web/src/api/api-key-fetch.test.ts | Four added cases: old same-key 401 with/without cancellation cannot reject recovered credentials; a new matching request still rejects; cancellation alone does not suppress a matching current-generation 401; a retired anonymous 401 cannot reject a new anonymous generation. Existing explicit-bearer mismatch, anonymous, matching401 and non401 controls remain. |
| apps/web/src/api/queries.reconnect.test.tsx | Rewrite S2 cold foreign-response test to require read error and no cache installation. Add warm same-status/sequence case with a genuine A receipt: foreign B cannot replace A's cached row or alter its entry/receipts; a later correct same-ID read recovers normally. Existing cancelled200/404 and live404/500 controls remain. |
| apps/web/src/runs/RunInspectorPage.corrective.test.tsx | S3 keeps the qualified-node absence assertion and adds absence of active /^at / text. Add rendered R2-1 proof: an agreeing cached terminal row has no provider receipt while the fresh GET is held, so witnessed terminal evidence must show event-qualified success with no cached node; current matching read then supplies a qualified node. |
| apps/web/src/api/ApiKeyPanel.test.tsx (new) | Six public rendered cases: quiet visible-panel same-key recovery reads the parked run once; warm/empty caches with held old200/401 requests retire the old request, start one fresh-generation GET and survive the old response before fresh convergence; an already accepted same-key save causes no refresh. Actual401 uses the real app API client. From submission onward the test only releases held bodies, with no injected query refresh or new SSE payload. All streams resume after acknowledged cursor3, which stays3. |
| docs/09-frontend-and-pwa.md | Document event-qualified unread agreement, wrong-ID rejection before cache installation, cancellation-before-active-refresh on same-key recovery, and generation-qualified late401 handling. |
| CHANGELOG.md | Describe those same four behaviors without changing the recorded persistence/polling/action boundaries. |

Thirteen cases were added in total, plus correction/strengthening of existing assertions. S1's selector implementation and unit expectation were already changed by actual Claude and remain read-only. S5/S6/S7 retain their prior accepted/no-change dispositions and bounded limits.

## Exact artifacts and preservation

- original-source/: complete six existing supporting files before edits; source-before.json records the optional new file as absent.
- candidate-original-source/: all23 original candidate files reconstructed from immutable 316825 Git blobs and checked against the exact D228 manifest d8b5b678c8ea427bb0cda377a298bc0f449d31ecbc355e28e5cb2df68072807a. Original blobs equal the bytes verified on admission.
- final-source/: complete seven final supporting files.
- supporting.diff: exact six tracked deltas plus a standard new-file patch for ApiKeyPanel.test.tsx; no index mutation was used to include it.
- source-before-after-manifest.json: before/after bytes and hashes for all seven supporting paths and final hashes for the 25-file candidate union.
- preservation-verification.json: all23 original blobs verified; all18 non-owned current candidate files unchanged, including every production file and the actual-Claude run-header-status.test.ts; index bytes, HEAD/tree, lock and package metadata preserved.
- Both E2E fixtures remain unchanged: inspector-truthfulness.spec.ts 22dcfccc086503b3bff266f9606cf4af60c51cf1869d45256a13c2667e27c7b7; original claude-harness.spec.ts e509374ea3e05cba35232ab0f59559b31f810a4c2c2fe5d228a5bf3ab07936f0.

## Validation and retained failure

Node v22.23.4 was first on PATH; existing pnpm/dependencies only; owned TMP/TEMP G:/ggq/gg-i5-d229-support-scratch. Independent QA explicitly released its execution slot before these checks. No full coverage, build, browser or broad product scan was run by this worker.

The focused seven-file invocation passed95/95, including the five supporting test paths and the read-only actual-Claude selector/header-hook controls. Initial full web typecheck passed. First scoped lint failed only require-await in the new unchanged-accepted-key test's async act callback. Its exact source and failed output are retained in failed-lint-source/ApiKeyPanel.test.tsx and scoped-lint.log.txt. Added an explicit microtask await so that callback completes notification work before checking unchanged reads; no assertion, timeout, retry or request changed. The changed panel file then passed6/6. Corrected scoped lint and final full web typecheck both passed.

Final validation-source parity: six unchanged focused files account for89 passes; the final corrected panel file accounts for6 passes. All95 final cases have passing scoped evidence, without another entire95-case rerun. Final typecheck/lint bind the final bytes. pnpm prettier --check passed all exact seven permitted paths without changes; no formatter changed source after the final tests. git diff --check passed. Commands, source qualification, exits and limits are in validation.json.

All worker execution sessions are CLOSED: focused79801 exit0; initialtypes63040 exit0; firstlint47571 exit1 retained; correctedpanel94943 exit0; correctedlint80654 exit0; finaltypes22115 exit0. The separate Prettier check completed exit0. No worker test/type/lint/browser/build/provider process remains running from this task.

## Limits and remaining owner

This is controlled public React/router/provider/API-client/QueryClient/FakeApi/SSE jsdom evidence plus direct credential-wrapper controls. It is not actual browser/backend/provider acceptance or the separately owned independent QA. No production defect was attributed by this worker. New defects remain actual-Claude production obligations.

Root owns the final candidate freeze, full relevant coverage/checks, independent built-browser QA, fresh AstraMAX final audit3, current-head/current-target CI/native evidence, signed merge and ordinary gates. Actual Claude targeted correction review of this exact final GPT delta remains required on the ordinary subscription after the fixed reset; no further API call or budget renewal occurred or is implied. Owner QA/acceptance and deployment remain separate. #416 then #420 retain their order after this pair's delivery.

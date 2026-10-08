# #99 exit primitives — verification

## Scope and preserved behavior

Exit predicates use one Noul, Choice or Score answer, an explicit expression/classifier/LLM evaluator, and a separate matching rule. Noul expressions require a strict boolean; Choice matches declared option IDs; Score compares exact fractional rubric indexes. Provider Noul requires authored true/false criteria. Classifier confidence rejection and the optional LLM self-reported confidence gate are always nonmatches, including when the requested match is false. Existing context rendering and session behavior are unchanged; #33 and #38 remain deferred.

Criteria keep authored order. A match at the last permitted iteration can finish before the implicit cap; provider failures there remain failures. Explicit limits, returns, subloop behavior and the single loop-back are preserved. Evaluation records evidence without writing a decision output or adding answer ports.

Definitions and exports move to format 3 through an explicit offline cutover. Runtime accepts only the current contract. Thread schema 1 and session rows are unchanged. A mechanically captured format-2 schema keeps the retained format-1 converter independent of current schemas. Missing historical facts remain unknown; the archive preserves originals. Unresolved provider criteria or ambiguous boolean expressions refuse conversion atomically, as do all nonterminal runs and unresolved affected failed-run dispositions.

## Executable backend checks

Initial frozen backend verification (2026-10-08): contracts 189, infrastructure 347, Jev adapter 34, Codex adapter 84, domain 340, engine 505 and API 426 tests pass; opt-in provider tests remain skipped. Every changed package passes all four 90% coverage thresholds. API live tests were explicitly disabled. Domain/engine/API and contracts/infrastructure/adapter typechecks and lint pass. API-client 45 tests and MCP 29 tests pass with all four coverage thresholds; their types pass. The backend ten-package build, layer rules, Node 22 dependency rules and license allowlist pass. Dependency analysis retains one existing Drizzle orphan warning.

Offline CLI acceptance initially passes 10 tests with 2 Windows file-symlink privilege skips; directory-junction refusal is covered. Root compared all twelve frozen snapshot files against the source commit/provenance hashes and confirmed equality. Attempting capture from current format 3 refuses without changing those files. Frozen snapshot formatting also passes without modification.

Coverage and scenario matrices cover boolean result/match combinations, classifier and LLM minimum boundaries, raw versus rejected evidence, fractional scores, invalid/missing/nonfinite responses, capability admission, safe provider errors, cancellation, order, final-iteration behavior, returns, fixed context and full-thread question rendering. Client and reference generation use the new contract.

## Independent pre-review findings

Runtime Sol independently reviewed Contract Sol's conversion/history code. Two root causes were accepted in scope before publication: filtered JSONata nodes can change a boolean result to undefined or an object; early conversion of error criteria dropped known provider/model identity. Root additionally evaluated missing-operand relational expressions and found the same boolean-proof root cause applies to `missing > 2` and similar comparisons. The converter must conservatively require an explicit provably boolean rewrite, and error history must preserve recorded identity while retaining null for unavailable facts. The final batch passes 357 domain tests and 21 focused SQLite upgrade tests. Domain coverage is 96.46% statements, 93.78% branches, 95.68% functions and 97.65% lines; domain/infrastructure typechecks, relevant lint and formatting pass. Root rebuilt all ten backend packages and reran offline CLI acceptance (10 pass, 2 host symlink skips) plus generated-doc freshness successfully. No contract or frozen snapshot changed for these repairs.

Contract Sol independently reviewed Runtime Sol's synthetic QA helpers. Root required successful attested browser preflight, successful result accounting rather than requested-call counting, and bounded subprocess termination/output. These helpers are verification infrastructure, not product features. The preview uses only disposable synthetic data and fake provider ports; no owner data or native judgment is available there. Separate built-app Edge acceptance must establish save/reload behavior.

## Test transport incident

The first API regression run selected the real TypeSafe adapter because an old test injected the removed legacy exit-decider seam. One request using the synthetic fixture value `test-key` received an authentication rejection. No owner credential or owner content was used; there was no retry. The fixture now injects its mocked transport through the selected classifier registry, the deterministic classifier suite guards external fetches, and a regression executes a default fake Noul exit while all fetch calls throw. Subsequent checks used fakes or loopback only. This is not native-provider acceptance evidence.

## Editor and initial built-app checks

The frozen web slice passes 1,096 tests across 97 files, with coverage of 97.68% statements, 93.43% branches, 98.27% functions and 98.58% lines; package typecheck/lint and eight focused regressions pass. Root review found that ordinary Choice-match edits could silently retarget the match to the first option. Normalization now runs only on explicit variant transitions, preserves invalid authored values for repair, exposes removable unavailable Choice IDs, and initializes new predicates as Noul expressions. Error/skipped evidence preserves available identity and diagnostic codes.

The complete eleven-package build passes. The first new Edge attempt failed during test discovery before running any scenarios: importing the API testing barrel directly into the Playwright runner loaded Fastify under an incompatible module path (`createError is not a function`). The harness is being repaired to keep fake-provider creation in the existing isolated server process. This is recorded as a failed verification attempt, not a product failure or passing browser evidence.

## Remaining candidate gates

Restacking onto the integrated feature, combined source/generation/format checks, affected Edge acceptance, normal Codex review and installed Opus code/actual-browser QA remain pending at this checkpoint. The feature-to-main PR remains unmerged for final owner acceptance. The installed data directory has not been changed by this child. #123, #124 and #125 are separate deferred presentation/layout work.

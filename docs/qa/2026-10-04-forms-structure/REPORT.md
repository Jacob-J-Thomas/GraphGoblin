# Issue #53 structural form verification

The worktree is `codex-i53-forms-structure`. The initial implementation is committed as `a5a8134`; the PR #58 review corrections are committed as `343c8d3`. Verification uses the project's unit tests and its isolated Edge E2E API, with ephemeral ports and temporary data directories.

## Changes

1. **Unparsed row text and stored errors.** `apps/web/src/forms/fields/structure.tsx` gives array and record rows stable identities. `parse-errors.ts` snapshots and repaths errors before a structural change: removed rows lose their errors, surviving array descendants shift, and record renames move the exact value path. Exact record paths protect sibling keys containing dots. `SchemaForm.tsx` updates its report reference immediately so adjacent shifted errors cannot overwrite each other before React renders. Every stored change goes through `onParseError`, preserving the editor store's blocking issues. `CodeEditor.tsx` updates accessible attributes when a surviving row changes position, without recreating its editor or losing text.
2. **Duplicate record keys.** `fields/structure.tsx` refuses a rename to another committed key. The key input retains its draft text, marks itself invalid, associates an inline error with the input, and keeps both committed values. A correction commits normally. The error is derived from the draft against the current committed keys, so removing the conflicting row clears it. Entering a collision announces the conflicting key once through the collection status region; continued typing while invalid does not repeat it, and re-entering after a correction announces again. On blur a still-refused key reverts to its committed name with a polite announcement explaining the collision; an available draft commits. The error is associated by aria-describedby and has no duplicate alert role. A rejected rename leaves any unparsed value and its stored issue under the original committed key.
3. **Collection focus and announcements.** `fields/collection.tsx` focuses the new row's first control in a cancellable animation frame after mounting, including StrictMode view recreation and returns focus to Add after removal. The collection itself is the safe fallback when an invalid array still exceeds its maximum and Add remains disabled. Each collection contains an initially empty polite, atomic status region; repeated actions replace its message node. A second Enter after removal can add an item but cannot remove another one.
4. **Blank expressions and exact templates.** `fields/text.tsx` omits optional blank JSONata expressions and normalizes required blank expressions to the empty string for schema validation, retaining the exact typed document in the editor. `CodeField.tsx` hides blank-expression previews, uses the schema's message when present, and provides Required only as a fallback. Its initial help is quiet and becomes an alert after editing. Liquid templates save exactly as typed, including empty required values and whitespace; only exactly empty optional template input means absent. `packages/domain/src/syntax.ts` rejects supplied blank expressions with "expression is required; a blank expression is not valid". Empty and whitespace-only templates are valid, including script arguments, HTTP header values, mutate set templates, and appended messages. Contracts schemas and parsing defaults are unchanged.
5. **Hidden fields and external resets.** Nested and root union switches, optional-union unset, and optional-object Remove clear the removed subtree through the parse-error channel. External array resets resynchronize row identities when the item count changes, retaining unique keys and correct names on later Add and Remove. `Row` data-field stays unchanged.

Docs/09, guide 02, and docs/03 describe the resulting behavior. The stale-row known-limitation sentence was removed. No row-spacing restyle, dependency, threshold, exclusion, route, or generated schema change is included.

## Initial issue failing-first evidence

The initial regression run used the unchanged production source. It had **11 web failures and one pass**, plus **three domain failures and three existing passes**. The S24 test was the web pass. Each baseline failure below corresponds to a regression test from the initial implementation. The Liquid blank-source expectations in this historical run were corrected by M1 below; they are not the current behavior.

| Regression                                  | Observed baseline failure                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Remove an unparsed exit criterion           | Parsing the surviving editor text threw `Expected property name or '}'`; it still held `{broken`.       |
| Remove and shift nested array errors        | `items.0.value` still held `{removed`, and three old error paths remained instead of two shifted paths. |
| Remove an unparsed variable                 | Expected no issues; received a `FIELD_UNPARSED` issue for the removed variable.                         |
| Rename an unparsed variable                 | Expected `{keep`; received the last valid string schema, losing the text.                               |
| Rename C to existing A                      | The second key input disappeared: `Unable to find a label with the text of: Env key 2`.                 |
| Add an array item                           | Expected Args 3 to have focus; Add retained focus.                                                      |
| Remove the middle array item                | Expected Add to have focus; the reused Remove button retained focus.                                    |
| Remove the last array item                  | Expected Add to have focus; the document body had focus.                                                |
| Add a record entry                          | Expected the new key input to have focus; Add retained focus.                                           |
| Blank optional form source                  | Expected no `optional` property; received the whitespace string.                                        |
| Editor validation of nonbreaking whitespace | Expected `EXPRESSION_INVALID` for heartbeat Until; no such issue was present.                           |
| Domain ASCII space source                   | Expected required-source issues for JSONata and Liquid; received only a JSONata compilation issue.      |
| Domain tab/newline source                   | Expected required-source issues for JSONata and Liquid; received only a JSONata compilation issue.      |
| Domain nonbreaking-space source             | Expected two required-source issues; received no syntax issues.                                         |

Supplementary checks cover dotted keys, numeric-key ordering, rejected renames with unparsed JSON, and focus when Add remains disabled. These were added after the initial failing-first run.

## S24 and shared files

**S24 passed without a fix.** The regression in `apps/web/src/forms/structure.test.tsx` mounts Settings and Variables, causes a draft conflict, reloads the server draft, and checks maxIterations 7, the new variable name/schema, and cleared parse errors. Later edits keep the server values and update only the intended fields. The existing `key={generation}` behavior is sufficient.

**Shared files: none.** No files outside forms, domain, the forms E2E spec, and documentation changed. In particular, editor/store.ts, editor/model.ts, other editor components, online/PWA modules, API code, infrastructure, API-client, and settings code were not edited. `Row` and its `data-field` attribute are unchanged.

## PR #58 review failing-first evidence

New tests ran against the committed production source: **11 web failures and one pass**, plus **three domain failures and six passes**. The passing web case protects the existing immediate parse-error reference update; temporarily removing that update made it fail, and the original source was restored immediately.

| Review item                | Observed failure before correction                                                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 templates               | Empty required template displayed Required; single-space template was replaced by `''`. Domain produced TEMPLATE_INVALID for empty and single-space script/inference/mutation templates. |
| m1 StrictMode Add          | New Args 1 did not have focus after its view was recreated.                                                                                                                              |
| m2 stale collision         | Removing A left the surviving draft marked aria-invalid=true.                                                                                                                            |
| m3 quiet required help     | Blank expression still rendered a preview on mount. The combined whitespace/schema-message regression also exposed the duplicate-error path after document retention was fixed.          |
| m4 identical unparsed rows | With the reference update removed: expected `{same`, received `2`. With the committed update restored the survivor retains its text and stored error.                                    |
| m5 nested union            | Expected no issues after switching When; FIELD_UNPARSED remained for criteria.0.jsonSchema.                                                                                              |
| m5 optional object         | Expected no issues after Remove; FIELD_UNPARSED remained for options.value.                                                                                                              |
| m5 root union              | Expected no issues after switching Kind; FIELD_UNPARSED remained for value.                                                                                                              |
| n1 external reset          | Survivor editor was a different DOM node after removal and had valid `2` instead of `{keep`.                                                                                             |
| n2 expression message      | Received the old omit-optional-blank-source message rather than the requested expression-specific wording.                                                                               |
| n3 document retention      | Expected typed space/tab/newline, received `''`.                                                                                                                                         |
| n5 single announcement     | Collision help still had role=alert as well as aria-describedby.                                                                                                                         |

Supplementary cases cover an available key draft committing on blur, optional-union unset, external array shrink then Add, optional blank-expression omission, and the real API's validate/import/publish behavior for both valid templates and invalid required expressions. The review unit suite has 14 tests; the domain syntax suite has nine.

## Review gate results

| Gate                                                  | Result                                                                                                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd typecheck`                                  | Pass, 20/20 tasks, including tests and fixtures.                                                                                                    |
| `pnpm.cmd lint`                                       | Pass, 11/11 tasks, zero lint warnings after moving guarded row-identity reconciliation before child rendering.                                      |
| `pnpm.cmd format:check`                               | Pass, all matched files follow Prettier formatting.                                                                                                 |
| `pnpm.cmd check:layers`                               | Pass.                                                                                                                                               |
| `pnpm.cmd check:tokens`                               | Pass, 96 files.                                                                                                                                     |
| `pnpm.cmd check:contrast`                             | Pass, zero failing enforced pairs in both themes.                                                                                                   |
| `pnpm.cmd check:licenses`                             | Pass, 225 packages.                                                                                                                                 |
| `pnpm.cmd check:docs`                                 | Pass, generated references are current; regeneration unnecessary.                                                                                   |
| `pnpm.cmd --filter @graphgoblin/web test:coverage`    | Pass, 313 tests in 40 files.                                                                                                                        |
| `pnpm.cmd --filter @graphgoblin/domain test:coverage` | Pass, 178 tests in 15 files.                                                                                                                        |
| `pnpm.cmd --filter @graphgoblin/api test`             | Pass, 251 tests; two existing opt-in cases skipped (LIVE and PERF), 16 passed files and two skipped files.                                          |
| `pnpm.cmd build`                                      | Pass, 11/11 tasks; includes the production web app and service worker.                                                                              |
| `pnpm.cmd --filter @graphgoblin/web test:e2e`         | Pass in Edge (msedge), 95 passed and one existing LIVE case skipped, 6.0 minutes; all ten form E2E cases passed and teardown completed with exit 0. |
| `check:deps` with Node 22.14.0                        | Pass, 389 modules and 1,412 dependencies; zero errors and two existing orphan configuration warnings.                                               |

| Package | Statements         | Branches           | Functions        | Lines              |
| ------- | ------------------ | ------------------ | ---------------- | ------------------ |
| Web     | 98.99% (2464/2489) | 95.54% (1780/1863) | 99.14% (815/822) | 99.76% (2149/2154) |
| Domain  | 98.73% (862/873)   | 96.82% (640/661)   | 96.02% (145/151) | 99.21% (754/760)   |

The focused form run passed 65 tests in five files, including SchemaForm, JsonSchemaForm, introspection, the 16 original structural tests (with S24), and all 14 review cases. No dependency, coverage threshold, or exclusion changed. The first review domain coverage run found a new HTTP-header fixture missing the heartbeat's required stopping condition; adding maxBeats corrected the fixture and the isolated rerun passed. Turbo cache-access warnings were nonfatal. All review logs and Edge traces are written under Temp; no root log files remain.

## Decisions and limits

- Shared domain syntax validation is the smallest rule that reaches editor validation and API publishing while preserving contracts parsing of existing fixtures. Form edits omit optional blank expressions and exactly empty optional templates. Imports or raw API drafts containing a supplied blank expression must be corrected before publishing; supplied empty templates remain valid.
- Stable rows preserve local editor text even without an external parse-error store. Stored paths still move through the existing reporting channel so FIELD_UNPARSED retention and external Discard remain compatible.
- The API E2E checks raw ASCII and nonbreaking whitespace, required blank-expression validation/import/publish, valid empty-template validation/import/publish, actual saved values after a refused rename, and successful Publish after unparsed rows are removed.
- During the initial implementation, one domain coverage run under concurrent load hit the existing 10 ms runtime-eval test: it returned `expression exceeded 10ms` before the expected unsafe-regex rejection. A subsequent isolated run passed all 175 tests without changing the test or timeout.
- During the initial implementation, the first full Edge run had 92 passes, one skipped live test, and one new assertion failure: the API correctly returned 422 LOOP_INVALID, but the test expected `issues` instead of the problem response's documented `errors`. The test assertion was corrected without an API or runtime change.
- The existing live-service E2E is outside this form task and remains skipped unless LIVE=1. Human product review and the scheduled implementation/adversarial reviews remain with the orchestrator.

## Acceptance evidence

- [x] **Met: parse-error and text ownership.** Removal, rename, nested shifts, dotted keys, numeric ordering, and stored FIELD_UNPARSED regressions pass; the core tests failed before the fix.
- [x] **Met: duplicate-key refusal.** Typed key retained while editing, live collision checks, blur revert announced, accessible inline description without a duplicate alert, both values preserved, correction accepted, and unparsed value unchanged; API draft values agree in Edge.
- [x] **Met: focus and announcements.** Add including StrictMode, middle/last Remove, repeated Enter, record actions, and a disabled-Add fallback pass; Edge checks actual focus and polite live-region messages.
- [x] **Met: blank expressions and exact templates.** Optional expression omission, schema errors for required blank expressions, exact template spacing/empty values, shared domain checks, and API import/validation/publishing regressions are covered.
- [x] **Met: existing semantics.** SchemaForm, JsonSchemaForm, introspection, unset handling, JSON spacing/retention, accessible names, and unchanged Row data-field are verified by the full web suite.
- [x] **Met: documentation.** Docs/09, guide 02, and docs/03 updated; the known-limitation sentence is removed and generated references are up to date.
- [x] **Met: gates.** Final review gate results are recorded above; the existing live-service test remains explicitly skipped without LIVE=1.
- [x] **Met: S24 re-verification.** Reload refreshes mounted Settings and Variables, clears parse errors, and preserves the new server values during subsequent edits; no fix was needed.
- [x] **Not applicable: row-spacing restyle.** Reserved for #8; both themes retain the existing normal/narrow record widths of 265px/165px.

## Final key collision announcements

The collection's polite status region announces `Key "A" already exists` once when a key input enters a collision. Typing another colliding key while it remains invalid does not replace the announcement node. Leaving the error state and entering it again announces afresh, even for the same key. Blur restores the committed key and explains why: `Reverted key to "C": "A" already exists`. The input retains aria-describedby, has no duplicate alert, keeps focus during collision announcements, and preserves all committed values.

Before the source change, the new transition test failed because the status region was empty; the strengthened blur test failed because it received only `Reverted key to "C"`. Both then passed, and the complete review test file passed all 15 cases, including StrictMode. Docs/09 describes the added feedback. The report now identifies the earlier review corrections as committed in 343c8d3.

The initial full web coverage run had 310 passes and four 20-second timeouts in the existing EditorPage.restore.test.tsx (one case) and EditorPage.test.tsx (three cases). Each affected file then passed alone: one restore test and all 27 EditorPage tests. A complete coverage rerun with `--maxWorkers=1` passed all 314 tests in 40 files, in 934.80 seconds under the machine's concurrent workload. No timeout, coverage threshold, exclusion, or editor test changed.

| Metric     | Web coverage       |
| ---------- | ------------------ |
| Statements | 98.95% (2468/2494) |
| Branches   | 95.50% (1783/1867) |
| Functions  | 99.14% (816/823)   |
| Lines      | 99.72% (2152/2158) |

The final correction passed typecheck (20/20 tasks), lint (11/11 tasks, zero lint warnings), and build (11/11 tasks). Turbo's cache-access warnings were nonfatal. The Edge command using `-- forms.spec.ts` selected all 96 cases: 95 passed and the existing LIVE case was skipped, in 3.4 minutes. Listing tests with the filename passed directly selected the intended ten form cases; the focused run is recorded below. All commands ran in this worktree, with logs and browser traces under Temp.

The focused Edge form run passed all 10 cases in 30.5 seconds and completed teardown with exit 0. Final format:check passed, all matched files follow Prettier formatting, and git diff --check is clean. Git status contains only the intended field, review test, docs/09, and this report. No root log files remain. No shared editor, API, or infrastructure files changed.

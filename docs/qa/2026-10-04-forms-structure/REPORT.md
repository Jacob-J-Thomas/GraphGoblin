# Issue #53 structural form verification

The worktree is `codex-i53-forms-structure`. Changes remain uncommitted. Verification uses the project's unit tests and its isolated Edge E2E API, with ephemeral ports and temporary data directories.

## Changes

1. **Unparsed row text and stored errors.** `apps/web/src/forms/fields/structure.tsx` gives array and record rows stable identities. `parse-errors.ts` snapshots and repaths errors before a structural change: removed rows lose their errors, surviving array descendants shift, and record renames move the exact value path. Exact record paths protect sibling keys containing dots. `SchemaForm.tsx` updates its report reference immediately so adjacent shifted errors cannot overwrite each other before React renders. Every stored change goes through `onParseError`, preserving the editor store's blocking issues. `CodeEditor.tsx` updates accessible attributes when a surviving row changes position, without recreating its editor or losing text.
2. **Duplicate record keys.** `fields/structure.tsx` refuses a rename to another committed key. The key input retains its draft text, marks itself invalid, associates an inline error with the input, and keeps both committed values. A correction commits normally. A rejected rename leaves any unparsed value and its stored issue under the original committed key.
3. **Collection focus and announcements.** `fields/collection.tsx` focuses the new row's first control after mounting and returns focus to Add after removal. The collection itself is the safe fallback when an invalid array still exceeds its maximum and Add remains disabled. Each collection contains an initially empty polite, atomic status region; repeated actions replace its message node. A second Enter after removal can add an item but cannot remove another one.
4. **Blank authored source.** `fields/text.tsx` treats empty or whitespace-only Liquid and JSONata input as blank, clears optional fields, and preserves nonblank source spacing. `CodeField.tsx` suppresses optional blank previews and shows Required for blank required source. `packages/domain/src/syntax.ts` rejects all supplied blank sources before execution through `validateLoop`, which both the editor and API import. Contracts schemas and parsing defaults are unchanged. The baseline already rejected ordinary ASCII blank JSONata through compilation, but nonbreaking whitespace escaped that check; Liquid whitespace also escaped validation. The explicit shared rule covers these cases consistently.

Docs/09, guide 02, and docs/03 describe the resulting behavior. The stale-row known-limitation sentence was removed. No row-spacing restyle, dependency, threshold, exclusion, route, or generated schema change is included.

## Failing-first evidence

The initial regression run used the unchanged production source. It had **11 web failures and one pass**, plus **three domain failures and three existing passes**. The S24 test was the web pass. Each baseline failure below corresponds to a new regression test.

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

## Gate results

| Gate                                                  | Result                                                                                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm.cmd typecheck`                                  | Pass, 20/20 tasks; includes tests and fixtures.                                                                                                        |
| `pnpm.cmd lint`                                       | Pass, 11/11 tasks, after removing two unnecessary async test markers and correcting three ref names.                                                   |
| `pnpm.cmd format:check`                               | Pass, all matched files follow Prettier formatting.                                                                                                    |
| `pnpm.cmd check:layers`                               | Pass.                                                                                                                                                  |
| `pnpm.cmd check:tokens`                               | Pass, 96 files.                                                                                                                                        |
| `pnpm.cmd check:contrast`                             | Pass, zero failing enforced pairs in both themes.                                                                                                      |
| `pnpm.cmd check:licenses`                             | Pass, 225 packages.                                                                                                                                    |
| `pnpm.cmd check:docs`                                 | Pass, generated references up to date; no regeneration needed.                                                                                         |
| `pnpm.cmd --filter @graphgoblin/web test:coverage`    | Pass, 299 tests in 39 files.                                                                                                                           |
| `pnpm.cmd --filter @graphgoblin/domain test:coverage` | Pass, 175 tests in 15 files.                                                                                                                           |
| `pnpm.cmd build`                                      | Pass, 11/11 tasks including the production web app and service worker.                                                                                 |
| `pnpm.cmd --filter @graphgoblin/web test:e2e`         | Pass in Edge (msedge): 93 passed, one existing LIVE=1 test skipped, 2.6 minutes. Output was redirected to Temp; server teardown completed with exit 0. |
| `check:deps` with Node 22.14.0                        | Pass, 388 modules and 1,404 dependencies, zero errors and two orphan-file warnings for existing configuration files.                                   |

| Package | Statements         | Branches           | Functions        | Lines              |
| ------- | ------------------ | ------------------ | ---------------- | ------------------ |
| Web     | 98.86% (2429/2457) | 95.32% (1752/1838) | 99.13% (806/813) | 99.71% (2119/2125) |
| Domain  | 98.73% (862/873)   | 96.81% (638/659)   | 96.02% (145/151) | 99.21% (754/760)   |

The focused run passed 51 tests, including all 16 structural regressions and the requested existing SchemaForm, JsonSchemaForm, and introspection suites. No threshold or exclusion changed. Turbo emitted nonfatal cache-access warnings; its requested tasks passed. All 15 temporary root log files were copied to Temp and removed individually; subsequent logs and E2E output live in Temp.

## Decisions and limits

- Shared domain syntax validation is the smallest rule that reaches editor validation and API publishing while preserving contracts parsing of existing fixtures. Form edits omit optional blanks; imports or raw API drafts containing a supplied blank must be corrected before publishing.
- Stable rows preserve local editor text even without an external parse-error store. Stored paths still move through the existing reporting channel so FIELD_UNPARSED retention and external Discard remain compatible.
- The API E2E checks raw ASCII and nonbreaking whitespace, actual saved values after a refused rename, and successful Publish after unparsed rows are removed.
- One earlier domain coverage run under concurrent load hit the existing 10 ms runtime-eval test: it returned `expression exceeded 10ms` before the expected unsafe-regex rejection. A subsequent isolated run passed all 175 tests without changing the test or timeout.
- The first full Edge run had 92 passes, one skipped live test, and one new assertion failure: the API correctly returned 422 LOOP_INVALID, but the test expected `issues` instead of the problem response's documented `errors`. The test assertion was corrected without an API or runtime change.
- The existing live-service E2E is outside this form task and remains skipped unless LIVE=1. Human product review and the scheduled implementation/adversarial reviews remain with the orchestrator.

## Acceptance evidence

- [x] **Met: parse-error and text ownership.** Removal, rename, nested shifts, dotted keys, numeric ordering, and stored FIELD_UNPARSED regressions pass; the core tests failed before the fix.
- [x] **Met: duplicate-key refusal.** Typed key retained, accessible inline error, both values preserved, correction accepted, and unparsed value unchanged; API draft values agree in Edge.
- [x] **Met: focus and announcements.** Add, middle/last Remove, repeated Enter, record actions, and a disabled-Add fallback pass; Edge checks actual focus and polite live-region messages.
- [x] **Met: blank source.** Optional omission, required error, preserved nonblank spacing, shared editor/domain checks, and raw API publishing rejection pass.
- [x] **Met: existing semantics.** SchemaForm, JsonSchemaForm, introspection, unset handling, JSON spacing/retention, accessible names, and unchanged Row data-field are verified by the 299 passing web tests.
- [x] **Met: documentation.** Docs/09, guide 02, and docs/03 updated; the known-limitation sentence is removed and generated references are up to date.
- [x] **Met: gates.** All required gates pass, including 93 Edge tests; the existing live-service test remains explicitly skipped without LIVE=1.
- [x] **Met: S24 re-verification.** Reload refreshes mounted Settings and Variables, clears parse errors, and preserves the new server values during subsequent edits; no fix was needed.
- [x] **Not applicable: row-spacing restyle.** Reserved for #8; both themes retain the existing normal/narrow record widths of 265px/165px.

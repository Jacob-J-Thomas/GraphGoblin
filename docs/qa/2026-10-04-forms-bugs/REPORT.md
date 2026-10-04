# Issue #51 development and verification report

## Root causes and changes

1. **Array data loss.** `useController` subscribes to its exact field path. An array parent therefore retained its earlier snapshot after children changed, and Add/Remove replaced the current array with that snapshot. `useField` now reads through a non-exact `useWatch` subscription while keeping controller registration, change handling, and the unset sentinel. The removal audit also found that `JsonText` kept its initial text when indexed JSON rows received a different value; parsed editors now follow changed values, preserve accepted JSON spacing, and retain unparsed text until fixed or discarded.
2. **Record collapse.** The flex row combined a full-width Input with a shrinking JSON editor. The key's `w-1/3` also conflicted with the shared Input's `w-full`. Record rows now use a `minmax(0, 1fr)` grid: key and remove button on the first row, value across the full second row. Accessible names and field paths remain unchanged; only semantic token styles are used.
3. **Empty optional preview.** `CodeField` always evaluated empty source without knowing that `StringField` treated it as absent. The schema's optional flag now reaches `CodeField`; exactly empty optional Liquid/JSONata values omit the preview and use the editor's unattached border. Required expressions, whitespace-only supplied expressions, and malformed source retain their errors. JSON editors already clear optional blank input without an expression preview.

## Failing-first evidence

Production fixes were applied only after the first tests ran on the original source. The forced baseline build used the current worktree, with no cached production output.

| Regression                           | Observed failure before the corresponding fix                                             |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| Script args edit, then Add           | Expected `['{{ vars.value }}', 'edited second', '']`; received `['--version', 'old', '']` |
| Nested decision route edit, then Add | Expected description `edited`; received `old`                                             |
| Empty optional Liquid/JSONata        | Expected no preview; found a preview element (two unit failures)                          |
| Edge array autosave                  | After Add, expected Args 1 `{{ vars.value }}`; received `--version`                       |
| Edge record width, both themes       | Expected content width above 200px; received 31.5px                                       |
| Edge empty heartbeat, both themes    | Expected zero previews; found one displaying the compile error                            |
| JSON record remove earlier row       | Saved schema was boolean, but editor still displayed the removed string schema            |
| JSON array remove earlier row        | Saved value was edited, but editor still displayed the removed first value                |

The first unit run had 4 new failures and 172 passes. The baseline forms Edge suite had 5 failures. The subsequent removal audit had 2 failures and 14 passes before the JSON synchronization change.

## Touched-system audit

- Script args and nested decision routes: edit/add/remove unit regressions; Edge args autosave/API equality and reload. Decision strategy/expose-to checkbox arrays retain their existing tests.
- Script env and exit-code records: edit/add/rename/remove unit coverage, plus Edge env editing in the node properties panel. Record actions already committed the whole latest record; the exact-path stale parent subscription primarily affected nested array/object edits.
- Variables: real declaration-schema edit/add/remove tests, JSON synchronization tests, and Edge pointer/keyboard/API save checks at 380px and 280px in dark and light.
- Loop settings: source inspection finds no array/record setting; existing schema rendering, default handling, clearing, and editor tests cover them.
- Trigger input schema: edited as one JSON value, rather than array rows; nested array-schema editing, malformed JSON, and optional clearing tested. Existing `JsonSchemaForm` tests cover submitted input arrays.
- Conditions/mappings: optional heartbeat Until, wait signal Filter, and mutate truncate Where; required decision JSONata, mutate expression value, and exit return mapping. Empty, whitespace, valid, malformed, and cleared values are covered. Empty Liquid remains valid under `TemplateSchema`; required Liquid retains its preview and schema semantics.
- Existing `FIELD_UNPARSED` storage/remount/discard tests, unset tests, accessible names, and `data-field` assertions remain intact.
- No reorder control exists in these shared collection forms.

## Final gates

All requested gates pass on the final code:

| Command                                                 | Result                                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm.cmd typecheck`                                    | Pass, all 20 tasks; includes tests and fixtures                        |
| `pnpm.cmd lint`                                         | Pass, all 11 tasks                                                     |
| `pnpm.cmd format:check`                                 | Pass                                                                   |
| `pnpm.cmd --filter @graphgoblin/web test:coverage`      | Pass, 188 tests across 31 files                                        |
| `pnpm.cmd check:layers`                                 | Pass                                                                   |
| `pnpm.cmd check:tokens`                                 | Pass, 88 files checked                                                 |
| `pnpm.cmd check:contrast`                               | Pass, zero failing enforced pairs                                      |
| `pnpm.cmd check:licenses`                               | Pass, 225 packages checked                                             |
| `pnpm.cmd check:docs`                                   | Pass, generated references up to date                                  |
| `pnpm.cmd build`                                        | Pass, all 11 tasks                                                     |
| `pnpm.cmd --filter @graphgoblin/web test:e2e`           | Pass, 26 passed and the existing live test skipped; Edge 154.0.4258.53 |
| `check:deps` through the prescribed Node 22.14.0 binary | Pass, exit 0                                                           |

Web coverage: **statements 98.49% (1961/1991), branches 94.06% (1394/1482), functions 98.71% (689/698), lines 99.42% (1715/1725)**. Web is the only changed runtime package. There are 16 added unit cases and five added Edge cases; existing tests were not rewritten.

In both themes the record's editable content increased from **31.5px to 265px** in the 380px panel; it remains **165px** in the constrained 280px panel. Pointer entry, keyboard entry, API draft equality, and absence of record clipping passed at these widths. The full Edge run completed in 58 seconds and the server teardown completed with exit 0.

The final E2E command adds only `--output` pointing to a temporary directory and `GG_FORMS_QA_PHASE=after` for the requested screenshots. Earlier lint ran while Playwright was creating temporary JavaScript trace resources under `test-results`, so it reported generated-resource errors; lint passed after the browser run ended, without ignore changes or directory removal. A required-condition test fixture, Testing Library option types, and test navigation were corrected during verification. Turbo occasionally reported a nonfatal cache I/O access warning; its requested tasks completed successfully.

## Decisions, deviations, and review limits

- GitHub issue retrieval returned HTTP 401. The full supplied issue copy was read instead.
- This branch serves node properties in a 380px side panel and contains no node dialog component. Real node properties were tested, but the concurrent node-dialog worktree cannot be verified here. The reviewer should check the shared record grid inside that dialog after integration.
- The narrow test constrains the containing panel to 280px; it is a container-width check, not a claim that the entire editor supports a mobile viewport.
- The existing live Codex E2E requires `LIVE=1` and is skipped; these form fixes need no external-service invocation. Human product review remains due under the issue's `human-in-the-loop` gate.
- No dependencies, thresholds, exclusions, contracts, routes, or generated reference files changed. No commit, Git index action, branch change, publication, directory cleanup command, or owner-server operation was performed.
- Review the broader subscription's render behavior in large forms and the JSON value synchronization alongside stored parse errors. The added tests verify unparsed text retention, external discard, accepted spacing, and parsed-row removal; existing indexed parse-error path bookkeeping is unchanged.

## Files changed

`apps/web/src/forms/fields/shared.tsx`, `fields/json.tsx`, `fields/structure.tsx`, `fields/text.tsx`, `CodeField.tsx`; `SchemaForm.test.tsx`, new `JsonText.test.tsx`; new `apps/web/e2e/forms.spec.ts`; `docs/09-frontend-and-pwa.md`, `docs/guide/02-build-a-loop.md`; this QA report, README, and ten screenshots.

# #235 UI implementation — Claude phase 1 handoff

Status: **phase 1 complete; not ready for merge, not accepted.** Built Edge, screenshots, the full gate, the independent GPT review, behaviour QA, CI and the Astra audit are still pending. Nothing was staged, committed or pushed.

- Model and effort: Claude Opus 5.5 (`claude-opus-5-5`) at `xhigh`, as recorded in `launch.json`.
- Worktree: `C:/Users/98jak/.codex/worktrees/gg-20261114-i08-input/GraphGoblin`, on branch `codex/gg-20261114-i08-input`.
- HEAD (unchanged): `839932e62f8132d7a201119e8acfe591cefa369c`.
- Runtime: Node v22.23.4 for every command. `pnpm.cmd exec node --version` reported v22.23.4.

## Changed files (working tree; no staging)

| File                                             | sha256                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `apps/web/src/forms/JsonSchemaForm.tsx`          | `809d4b5ce5abcdfaddb7985a205d349c8fcdf3d52195594b4e5ce941ff869fdd` |
| `apps/web/src/forms/JsonSchemaForm.test.tsx`     | `cfe51a042dc6c5a21c2e4d53c4f07adf6a2d41a0c6a650496fd61b7de3533413` |
| `apps/web/src/runs/new/NewRunPage.test.tsx`      | `f8779cfb1cdac312410c59800eb507ffc0859adb77deb276c141a0ae65f41338` |
| `apps/web/src/runs/inspector/WaitPanel.test.tsx` | `bc5052978c4dcb3dd7166f454c2d85c06c7da3e0b5cd812fdc76c34ab5934a37` |
| `apps/web/e2e/form-controls.spec.ts`             | `9a299829db75169ebdf22e73f5fa3e5c3473b2ca1e8157f7f75c0f6c21b397f8` |
| `docs/09-frontend-and-pwa.md`                    | `d712b8dd96b6373e33f2d58c381e4f9b98c992997efd256ca23dda8cb7b2db47` |
| `docs/guide/03-run-and-observe.md`               | `cefc8427df349994fc144b9c2e1c8faab3684c02cf7df58ab89ba05f8a74e96d` |
| `CHANGELOG.md`                                   | `e1eac59490cc0e048245f912379e01efccfecde0df32751146b8cdf772f81b4d` |

- The full tracked diff is in `final-tracked.diff` (sha256 `e44c4b20…f9034`).
- `RunLauncher.tsx`, `WaitPanel.tsx`, the API, contracts and storage are unchanged. There is no migration.
- I did not touch the untracked `docs/qa/2026-11-14-i08-u22-baseline/`. It still has 31 files, and their per-file hashes are in `u22-baseline-manifest.sha256`. Nothing here claims that those reports are fixed.

Exact `git status --porcelain=v1`:

```
 M CHANGELOG.md
 M apps/web/e2e/form-controls.spec.ts
 M apps/web/src/forms/JsonSchemaForm.test.tsx
 M apps/web/src/forms/JsonSchemaForm.tsx
 M apps/web/src/runs/inspector/WaitPanel.test.tsx
 M apps/web/src/runs/new/NewRunPage.test.tsx
 M docs/09-frontend-and-pwa.md
 M docs/guide/03-run-and-observe.md
?? docs/qa/2026-11-14-i08-u22-baseline/
```

## UI decisions and why

### What I kept from the GPT proposal

- An absent map entry means untouched or omitted.
- Cleared text becomes `""` and is checked against its schema.
- A blank or incomplete number shows "`<title>`: enter a number". Blank JSON shows "invalid JSON".
- The raw editor is `undefined` until edited, and then parses exactly what was typed.
- The empty-string enum member is labelled `""`.
- "Not set" stores `undefined`.
- The wording is **Omit**, with the accessible name "Omit `<title>`". This follows the EventsPage "Clear" / "Clear type filter" pattern.
- Focus moves to the control before the button unmounts.
- I kept the e2e scaffold.

### What I revised, and why

1. **Size of the Omit control.** The proposal used `Button ghost sm`, which is 32 px high, or 44 px on a coarse pointer. The label line is only 16.9 px (13 px × 1.3). So the input jumped down about 15 px (27 px on touch) on the first keystroke, jumped back on Omit, and the documented 6 px label-to-control gap (docs/09 §Form controls) broke.
   - The control is now a ghost text button drawn 20 px high with `-my-0.5`. Its layout height (16 px) fits the label line.
   - It uses the design-system `touch-target` utility to give a 44 px target on coarse pointers.
   - It keeps the ghost look (no chrome until hover, semibold, `text-default`) and the standard focus ring.
   - It meets WCAG 2.5.8 through the spacing exception.
2. **Position next to the JSON tag.** Omit now sits _before_ the JSON tag, so the tag never moves. In the proposal the tag shifted left when Omit appeared.
3. **Placeholders.** The default shows only while the field is absent. Cleared text shows the placeholder `""`.
   - Ajv here has no `useDefaults`, so a default hint on a field that will send `""` misstates the request. docs/09 states that nothing shows a value it would not send.
   - Without this, `""` and absent looked identical apart from the button. `""` is also how the enum labels the empty string.
4. **Omit in the raw JSON editor.** It is offered only when the schema accepts no input (`validateJson(schema, null).ok`, or no schema). This is the raw-editor equivalent of "required fields must not acquire an omission escape".
5. **`badInput` handling.** The proposal attached the `onInput` `badInput` handler to text inputs too. It now applies only to number inputs.
6. **Keyboard.** The order is label, Omit, control, so Shift+Tab from the field reaches Omit, and Enter or Space puts the field back to absent with focus on it. No new controls appear on untouched fields. Required fields never get Omit. Choices keep **Not set**.

### Known trade-offs to check in phase 2

- **Touch target overlap.** On a coarse pointer, the 44 px target box extends about 7.5 px over the top-right of the input below. There is only 16 + 16.9 + 6 px between the fields, so a 44 px box cannot fit without overlap. `touch-target` makes the same trade for Switch and IssueBadge.
- **Focus-ring clearance.** By calculation, the ring clears the input by about 0.45 px on text rows and about 1.25 px on JSON rows.
- **Omit discards the typed text.** A toggle that keeps the text but excludes it was rejected as heavier than the brief allows.
- **Not changed (pre-existing):** the raw editor's `{}` placeholder, and the fact that a text field cannot send `null` for `string|null`.

## Acceptance matrix

Phase 1 evidence is component and fake-API tests through public behaviour.

| Criterion                                                 | Phase 1 evidence                                                                                                                     | Pending (phase 2)                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Untouched optional fields absent                          | Form test "keeps untouched…" sends `{}`. The New run and Wait body tests check keys with `toStrictEqual`.                            | Edge request bodies                                   |
| Explicit empty text present and follows its schema        | `note: ''` is sent. A `minLength` error shows. A required `name: ''` is accepted. Both consumer bodies carry `''`.                   | Edge bodies and readback                              |
| Numeric and JSON blanks validated                         | Tests: required/optional number blank, JSON blank and whitespace, raw blank                                                          | Edge                                                  |
| Native number intermediate                                | jsdom `validity.badInput` simulation, using the repo's existing pattern                                                              | Edge `-` key with `badInput === true`                 |
| `null`/`""`/`0`/`false` through New run and Wait (bodies) | NewRunPage and WaitPanel fake-API body tests. No raw input → no `input` on New run and `null` on Wait. Raw `null` and `""` are kept. | Real API bodies and persisted `result` readback (e2e) |
| Minimal return to absence (wording, placement, focus)     | Click and keyboard tests, focus, placeholder restored, button gone                                                                   | Layout-stability and keyboard/click e2e, screenshots  |
| Required fields: no omission escape                       | Required text, number and JSON fields offer no Omit. The raw editor offers none when the schema refuses `null`.                      | e2e `Omit reason` has count 0                         |
| Empty enum distinct from Not set                          | Segmented control and select: `Not set`, `""`, …                                                                                     | Screenshot                                            |
| Raw states distinct                                       | Raw test across 6 submissions: untouched, `null`, blank refused, whitespace refused, `""`, `0`, `false`, omitted                     | —                                                     |
| Existing validation and submission unchanged              | All earlier cases in 5 files pass (94/94)                                                                                            | Full gate                                             |

**Mutation proof** (logs `02`, `03-*`, `05`):

- The HEAD form fails 7 of 17 form tests and 2 of 14 consumer tests.
- Each design decision is caught by its own tests: no `badInput` handler, default placeholder always shown, raw Omit always shown, plain `''` enum label, Omit on required fields, no focus move, blank number omitted.
- After every mutation I restored the final file and confirmed its hash.

## Commands and results

Logs are in `logs/`. Every run used Node v22.23.4 and `pnpm.cmd`, from `apps/web` unless noted.

- `00` — `vitest run` on the 3 focused files against the supplied proposal: **25/25 pass**. This was my starting point.
- `01` — `vitest run src/forms/JsonSchemaForm.test.tsx` after my changes: **17/17 pass on the first run**.
- `02`, `03-M1…M7`, `05` — mutation runs, failing as intended (see above).
- `04` — 3 focused files: **31/31 pass on the first run**.
- `06` and `12` — `prettier --check` on the 8 changed files (from the root): **pass, first time and final**.
- `07` — `eslint` on the 5 changed TS/TSX files: **pass, first run**.
- `08` — `pnpm.cmd run typecheck` (`tsc -p tsconfig.json --noEmit`, including `e2e/`): **pass, first run**.
- `09` — indirect consumers `RunInspectorPage.test.tsx` and `EditorPage.test.tsx`: **63/63 pass**.
- `10` — diagnostic coverage of `JsonSchemaForm.tsx` alone, with no threshold overrides and reports written outside the repo: **100% statements, lines and functions; 96.5% branches**.
  - The uncovered branches are pre-existing lines 54, 63, 103, 239, 310, 320 and 464. None is in a changed line.
  - This is not the package gate.
- `11` — final run of all 5 files: **94/94 pass**.

None of my own runs failed apart from the intended mutation failures. I did not run a root build, check or coverage, or any browser or native process, because the heavy slot is owned elsewhere.

## Remaining work (phase 2 and the separate gates)

1. **Build, then run the new Edge e2e case.** `pnpm build`, then the Edge e2e `form-controls.spec.ts`, including the new case "New run and Wait send the supplied input and omit untouched or reset fields (#235)". It is edited and typechecked but **not run**. It checks:
   - the `-` key with `badInput` and its error;
   - the `""` placeholder;
   - required `reason` has no Omit;
   - the field offset is unchanged when Omit appears and after Omit;
   - the Omit box lies above the input;
   - keyboard Omit on New run and click Omit on Wait;
   - request bodies at `/loops/:id/runs` and `/runs/:id/input`;
   - the persisted `result` equals `{started, answered}`.

   Also rerun the rest of `form-controls.spec.ts`.

2. **Edge screenshots** in light and dark at 1280 and 390 px, for both New run and the Wait card:
   - untouched form;
   - edited optional text with Omit and `""`;
   - JSON property with Omit before the JSON tag;
   - keyboard focus ring on Omit, confirming no overlap with the input;
   - number error after `-`;
   - raw editor with Omit (no schema or signal wait), and raw editor without Omit (schema refuses `null`).
3. **Coarse-pointer emulation.** A tap at the input's centre should focus it. Judge whether the ~7.5 px overlap of the target box on the input's top-right corner is acceptable.
4. **Forced-colors mode.** Check that the Omit button stays visible and its focus outline shows.
5. **Gates.** `pnpm check`, including web coverage of at least 90% for lines and branches. Then CI, the independent GPT review, behaviour QA, and the fresh Astra max audit.
6. **Closure.** The issue requires owner product acceptance before closure. The eventual PR must use "Part of #235", not a closing keyword.

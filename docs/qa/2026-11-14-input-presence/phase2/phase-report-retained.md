# #235 UI implementation — Claude phase 2 report

**Status: phase 2 complete with a correction; NOT ready for merge, NOT accepted.** Independent GPT review, independent QA,
current-head full CI and the fresh Astra max audit are all still pending. Nothing was staged, committed, pushed or published.

- **Model / effort:** Claude Sonnet 5.5, model id `claude-sonnet-5-5`. The brief asked for `xhigh`. I cannot verify the effective
  effort from inside the session; the per-turn metadata I could see read `reasoning_effort 30`. Root should trust its launch
  config, not this line. I am an implementer, not an independent reviewer; no review scan was consumed. No subagents.
- **Worktree / branch:** `C:/Users/98jak/.codex/worktrees/gg-20261114-i08-input/GraphGoblin`, `codex/gg-20261114-i08-input`.
- **HEAD (unchanged):** `f3254bb19b2507cc45e8b7af6b9dc599e402a656`. No rebase, no staging.
- **Runtime:** Node v22.23.4 confirmed (`node --version` and `pnpm.cmd exec node --version`) before every pnpm command.
- **Backend / browser:** the repository's own e2e backend (real API, **in-memory** store, fake harness, **ephemeral loopback port**)
  and the installed Edge (`channel: msedge`). No owner app/store, credentials, ports 4747/4748, MacSSH or provider calls.

## Result in one paragraph

The phase 1 UI was behaviourally right (omission, `""`/`null`/`0`/`false`, `-` badInput, required refusal, empty enum vs Not set,
real request + persisted result on both entry points), **but its coarse-pointer touch target was a real wrong-action / data-loss
defect, as feared**: with real touch input, a tap inside the displayed input, over a band about 44 px wide and 7 px deep at its
top-right, invoked **Omit** and discarded the typed text. A first correction (a bounded hit box) looked right in geometry and was
**still wrong under real taps**. The final correction removes the invisible hit box and adds 6 px under the label row of optional
fields on a coarse pointer only. After it, **0 of 2,992 grid taps** (plus all named taps and a 256-tap e2e grid) omitted a field by
a tap on a control, and a tap on the drawn button still omits. The cost is stated below (the coarse Omit target is the drawn 20 px
button, under the repo's 44 px convention). Details and every first failure follow.

## Source and build identity

| Item                                    | sha256                                                             |
| --------------------------------------- | ------------------------------------------------------------------ |
| `apps/web/src/forms/JsonSchemaForm.tsx` | `c386b53cd1fed7c743f8c85a75f3bde90282fd53df5ca16fead848bf3433dec0` |
| `apps/web/e2e/form-controls.spec.ts`    | `d2ee7878147051611050e6f00318b83a9e46a01b3c546d68c5b57faaeadd5187` |
| `docs/09-frontend-and-pwa.md`           | `58b874abdfdf5b11ca2b76bdce2ed623a251548d81ff20aa4c858f075d8f8ab0` |
| `final-phase2-tracked.diff` (vs HEAD)   | `47ee5c20d3087d696726e0828c362275579bec717415640c0098b923b0c6bd70` |
| manifest of `apps/web/dist` (no `.map`) | `a3ac69c45a32a0172041798ade4ffb4e05c3c32e1ca99b5dd5468988da582e54` |

Phase 1's hashes for the two files at HEAD were `809d4b5c…` (`JsonSchemaForm.tsx`) and `9a299829…` (spec); the other files are
unchanged from HEAD. `git status`: three ` M` files plus the untracked baseline bundle, nothing staged. `git diff HEAD --stat`:
3 files, 106 insertions, 10 deletions.

**Build-identity chain.** `pnpm.cmd build` (11/11 tasks) was run on the final tree; the dist manifest hash is identical to the build the
full Edge suite ran on (`logs/34-dist-hashes-final.txt` equals `logs/43-dist-hashes-final2.txt`, `cmp` clean). Between the full Edge
run and the final tree I changed only formatting (before) and comments + docs (after); the bundle is byte-identical across both.
Web-package coverage ran on `JsonSchemaForm.tsx` `a70017f2…`; the final file differs from it by a comment only (see "Gates").

## First failures, and every correction

All first failures were preserved (`logs/`, `first-failure/`, `second-failure/`, `mutation/`).

1. **First full `form-controls.spec.ts` run (Edge, retries 0): 6 passed, 1 failed** (`logs/02-*`, `first-failure/`).
   The edited #235 case reached its last step and failed there: `locator.check: strict mode violation` —
   `getByRole('radio', { name: 'No' })` resolved to **two** radios, `Not set` and `No` (substring match). Everything before it passed
   (the `""` placeholder, `-` with `badInput === true`, no-shift Omit, keyboard Omit). **Cause: a phase 1 test locator defect.**
   Fix: `exact: true`. No assertion was weakened.
2. **Same case, after the fix: `check()` timed out** (`logs/03-*`, `second-failure/`): the segmented radio is visually hidden
   (`sr-only`), so the label intercepts pointer events. Fix: click the visible label (a real pointer action), then assert the radio
   is checked. (The repo's other specs drive these radios by keyboard or label.) Passed (`logs/04-*`).
3. **Real touch evidence reproduced the data-loss defect** (`logs/05-touch-overlap-candidate.*`, driver `touch-overlap.mjs`).
   On the phase 1 form, on a coarse pointer, at 390 and 1280 px, on both New run and Wait, for a text and a JSON field: the
   `::after` box was 44 × 44 px and lay **7.55 px (text) / 6.75 px (JSON) over the input** (`elementFromPoint` agreed: 308 / 270
   points of the input owned by the button). **Real taps** (`page.touchscreen.tap`) at +1, +4, +7 and +9 px under the Omit, and in
   the top-right corner, **omitted the field and lost "typed text"**. The Opus handoff's calculation was right.
4. **Correction attempt 1 (rejected on evidence).** A bounded coarse hit box (44 × 36 px, 13 px above and 3 px below the button) made
   the geometry clean (0 owned points, 1.45 px clear of both neighbours) but **real taps still omitted fields inside the input,
   up to 8 px deep (57 of 528 grid taps), and 21 taps inside the _previous_ field's bottom 6 px**
   (`logs/12-*`, `tap-map-fix1-current-*`). Cause: Chromium's tap adjustment moves a tap that lands just under a button onto it,
   even over a text field, and the firing pattern is not monotonic (e.g. +3..+5 px fire, +0..+2 px do not), so no geometric
   box can be trusted. The halo did not depend on the CDP touch radius (0.5 and 8 identical; 16 smaller).
5. **Variants compared on real taps before touching source** (`tap-map.mjs`, CSS injected on coarse, 528 taps each): plain 20 px
   button, 17 fired (≤5 px deep); +2 px under the row, 10 fired (≤3 px); **+3 px, 0; +4 px, 0; +8 px, 0**.
6. **Correction attempt 2 (final).** Remove `touch-target` from Omit; give the label row of every field that _can_ show Omit
   `pointer-coarse:pb-1.5` (6 px, always present, so Omit appearing still moves nothing). Fine pointers are untouched. Chosen 6 px, not
   the 3–4 px minimum, for margin (the threshold is in CSS px and shrinks when a user zooms out).
7. **Wording correction** (comment + docs only): my first comment said taps "within about 5 px of the button"; the data says taps up to
   5 px _inside the field_ fired at the original gap and none did from 7.5 px. Corrected after the coverage run.

**Correction-batch accounting (brief: at most two).** UI corrections: attempt 1 (rejected) and attempt 2 (final). Test-only corrections:
the two spec edits in items 1–2, a phase 1 locator/pointer defect found by the first Edge run. Root may count these as three. I
stopped at attempt 2 because it resolved the defect; no material defect remains that I know of.

## Final source diff (summary; full diff in `final-phase2-tracked.diff`)

- `JsonSchemaForm.tsx`: `touch-target` removed from `OMIT_BUTTON`; new `OMIT_ROW = 'pointer-coarse:pb-1.5'` applied to the label row
  of `!required` fields and to the raw editor's row when `rawOptional`; comments explain why. No API/format change.
  `RunLauncher.tsx` and `WaitPanel.tsx` unchanged.
- `form-controls.spec.ts`: the two locator fixes, and a new Edge case, **`with a coarse pointer (#235)`**: 390×844, `hasTouch`;
  asserts a ≥ 8 px gap from Omit to the field, no layout shift, then **128 real taps per field** (text and JSON) over the top 14 px
  of the field across and beyond the button's width — none may omit — then a tap on Omit omits.
- `docs/09`: the Form controls "Where" bullet and the Touch bullet no longer promise a 44 px Omit target and state the measured cause.

## What I looked at (screenshots, actually viewed)

`screenshots/before-head/` (HEAD form) and `screenshots/after/` (final), New run and Wait, 1280 (fine) and 390 (coarse), light and dark,
states: untouched, edited, keyboard focus on a text Omit, focus on a JSON Omit, `-` number error, raw editor with Omit
(no schema) and without Omit (schema refuses `null`), plus `ring-*` padded focus crops and `zoom-*` 4× crops of the ring against the
input edge. I viewed a representative set in both themes at both widths. Findings:

- The Omit sits right-aligned in the label row, before the JSON tag; the tag never moves; labels are not clipped; the `""`
  placeholder is distinct from an untouched field; required `reason` has no Omit and shows "reason is required"; `Not set` and `""`
  are distinct segments; the `-` number shows "number: enter a number"; invalid fields still offer Omit.
- **Layout stability, measured not eyeballed:** form height is identical untouched vs edited (390: 1982 = 1982 HEAD, 2066 = 2066
  final device px at dsf 2), and `gap-probe` shows a 0.00 px shift when Omit appears at every width/pointer. The 1280 fine-pointer
  screenshots are the **same pixel dimensions** as HEAD. The coarse 390 form is 84 device px (42 CSS px) taller, i.e. 7 optional rows
  × 6 px.
- Label-to-control gap: fine **6.00 px** (JSON 6.81), coarse optional **12.00 px** (JSON 12.81), required fields unchanged (7.11).
- **Focus ring:** fully visible, 4× crops show clear space to the input edge in light and dark; `ring-clip.mjs` found **no
  overflow-clipping ancestor and no page horizontal scroll in 16 configurations**. One crop looked clipped at the form's top edge; that
  was my element-screenshot bounds, not the page (padded crops and the geometry check prove it).
- An early screenshot comparison looked identical before/after at 390; it was my driver (element taller than the viewport), found by
  comparing file dimensions, and fixed (2600 px viewport) before I relied on any image. The superseded images are in
  `screenshots/superseded/`.

## Keyboard and coarse-pointer activation (real input)

- **Keyboard:** Shift+Tab from the field reaches Omit (focus verified), Enter omits, focus lands on the field; Tab order unchanged
  (edited e2e case, both entries; `ring-clip` focuses Omit by keyboard in 16 configs).
- **Coarse pointer, final build** (`touch-overlap.mjs`, 8 configs: New run/Wait × 390/1280 × text/JSON): all 10 taps on the input
  or the previous field's bottom kept the text and focused the input; all 3 taps inside the drawn button (two corners and the
  centre) omitted. `tap-map.mjs`: **2,992 taps, 0 wrong omissions** (New run 1280 text/JSON at x-step 3: 704 each; Wait 390
  text/JSON 528 each; New run 390 text with a **fresh page per tap** 528).
- **Mutation proof of the new e2e case:** against a disposable build of the HEAD form (`mutation/dist-head`) it fails — first on the
  gap assertion (`4.45` vs `≥ 8`); with that assertion removed from a temporary copy (deleted afterwards) **54 real taps on the text field wrongly omit it** (the 56 in the diff header counts two bracket lines)
  (`mutation/*.log`). The source file was restored and its hash verified (`mutation/restored.sha256`).

## The brief's verification list, on the final build

| Item                                               | Evidence                                                                                                                                                                                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Empty enum vs Not set                              | `logs/44-enum-check-final.log` (real Edge requests + persisted results, both entries; segmented and select): untouched → `{}`; `""` members → `{"seg":"","many":""}` sent **and persisted**; member then Not set → `{}`                                                              |
| Preserved `""` / `null` / `0` / `false`            | e2e case: body `{message:'', title:'ok', reason:'', number:0, metadata:null, approved:false}` on `POST /loops/:id/runs` (`.input`) and `POST /runs/:id/input` (`{waitId,input}`); `GET /runs/:id` `result` `toEqual {started: input, answered: input}`. Passed in runs 04, 20 and 35 |
| Required omission refusal                          | `Omit reason` count 0 (e2e); required `reason` shows "reason is required" with no Omit (screenshots); raw editor offers no Omit when the schema refuses `null` (`rawreq-*`)                                                                                                          |
| Malformed `-`                                      | e2e: `validity.badInput === true`, then "number: enter a number" on both entries (also screenshots)                                                                                                                                                                                  |
| Real request + persisted result, both entry points | as above; `waitId` read from the API before answering                                                                                                                                                                                                                                |

## Forced colours — what is and is not proven

- `page.emulateMedia({ forcedColors: 'active' })` flips the media query **and** the computed styles (`logs/07-*`,
  `forced-probe.mjs`): the Omit's `border: transparent` becomes a visible **1 px `rgb(255,255,255)` border at rest**, and keyboard focus
  gives a **2 px solid `rgb(26,235,255)` outline, 2 px offset** (the author green outline otherwise).
- **The screenshots taken under that emulation do not paint the forced palette** (they show the author theme). They are kept only in
  `screenshots/MEDIA-ONLY-forced-palette-not-painted/` and are **not** visual evidence. A first forced set used a context option that did
  not even match the media query (`screenshots/INVALID-forced-not-applied/`). **No real OS High Contrast rendering was tested.**

## Deviations and residual risks root should weigh (not hidden)

1. **Coarse Omit target is the drawn 41.8 × 20 px button, not 44 px.** The repo's rule (docs/09 Touch) says coarse controls are ≥ 44 px
   and its `responsive.spec.ts` `smallTargets` check would flag an Omit shown on a coarse pointer — that test never edits a field, so
   Omit never appears there and it passes (run `logs/36-*`). A 44 px target cannot fit: there are 16 + 16.9 + 6 px between fields, and
   any real tap hit box reaches an adjacent control because Chromium adds a roughly 7 px adjustment halo (measured). I make **no WCAG
   2.5.8 / 2.5.5 conformance claim**; the height is under 24 px and whether the spacing exception applies is a calculation I did not
   verify with a tool. This is a product trade for root/owner: safe tap on the field vs a bigger Omit.
2. **Evidence is emulated Chromium touch (CDP, default tap area), Edge only.** Real fingers (larger contact area), Android Chrome, iOS
   Safari and browser zoom-out were not tested. At a 16 px CDP radius the halo shrank rather than grew, but I did not characterise real
   devices. The margin (10.5 px vs a measured 7.5 px threshold) is the mitigation.
3. **Coarse optional rows are 6 px taller each.** Layout change for touch users of New run and Wait only (fine pointers byte-identical).
4. The new e2e case asserts a CSS spacing invariant (≥ 8 px) in addition to the tap grid, so a deliberate spacing change will need it updated.
5. Omit still **discards the typed text** (a keep-the-text toggle remains rejected as heavier than the brief allows).
6. Not changed (pre-existing, as in phase 1): the raw editor's `{}` placeholder; a text field cannot send `null` for `string|null`.

## Gates run in this phase (all serial, Node v22.23.4)

| Gate                                                             | Result                                                                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd build` (11 tasks), final tree                          | pass (`logs/34-*`, `logs/43-*`); also run on the candidate before any change (`logs/01-*`)                                                  |
| Full `form-controls.spec.ts`, Edge, `--retries=0`, final dist    | **8/8 pass** (`logs/35-*`); first run 6/7 (see failures)                                                                                    |
| `responsive.spec.ts` "screens … fit" + "coarse … at least 44 px" | 4/4 pass, dark and light (`logs/36-*`)                                                                                                      |
| Focused unit tests: form, New run, Wait (+ Inspector, Editor)    | 94/94 on 5 files before the comment edit (`logs/37-*`); 31/31 on the 3 touched files on the final tree (`logs/52-*`)                        |
| Whole web-package coverage (`vitest run --coverage`)             | **196 files, 2,460 tests pass; branches 94.07%, functions 97.01%, lines 98.51%**; thresholds and `vitest.config.ts` unchanged (`logs/38-*`) |
| `prettier --check`, 8 touched files                              | pass; first run flagged two TS wraps (applied with `--write`, only line wrapping changed) (`logs/30-*`, `logs/40-*`)                        |
| ESLint, 5 touched TS files; web package `pnpm run lint`          | pass (`logs/41-*`, `logs/54-*`)                                                                                                             |
| `pnpm run typecheck` (web)                                       | pass, rerun on the final tree (`logs/42-*`)                                                                                                 |

Coverage ran on `a70017f2…`; after it I changed one comment in `JsonSchemaForm.tsx` and one docs sentence, then re-ran prettier, ESLint,
typecheck, the build (identical bundle) and the touched unit files. I did **not** repeat the 18-minute whole-package coverage for a
comment; the current-head CI gate will.

**Not run, per the brief:** the unchanged native Windows infrastructure fixtures; `pnpm check` end to end; the broader Edge suite
(final CI runs it); decision/other form e2e files that this change does not reach. Other e2e files that load New run or Wait
(`live`, `loop-lifecycle`, …) were not run individually.

## Pending gates (nothing here is a merge claim)

1. Independent GPT adversarial review.
2. Independent QA.
3. Current-head full CI (including the full Edge suite and `pnpm check`).
4. Fresh Astra max audit.
5. Owner product acceptance (issue #235 closure needs it; the PR must say "Part of #235"). Root still needs to format Markdown in the untracked baseline bundle and commit; I did not touch it.

## Cleanup

- Every driver and the Playwright runner stop their own server and Edge in a `finally`; the e2e server also shuts down when its stdin
  closes (a driver crash left no orphan, checked). Final scan (`logs/51-owned-processes-final.txt`, `drivers/owned-processes.ps1`):
  **no e2e server, vitest, Playwright or `msedge` process remains** (0 `msedge.exe`); the only matches were pre-existing review-runner
  processes from other sessions and my own shell. The owner API (PID 19500) and the other sessions' processes were never touched;
  ports 4747/4748 were not used (the backend uses ephemeral ports).
- `apps/web/test-results` removed. `apps/web/coverage`, `dist`, `dist-goblin` are git-ignored build outputs of my runs.
- The temporary mutation spec copy was deleted; `git status` shows only the three intended files plus the untracked baseline bundle.
- **`docs/qa/2026-11-14-i08-u22-baseline` unchanged:** 31 files, `cmp` of per-file sha256 lists before and after is identical
  (`logs/00-baseline-bundle-hashes-initial.txt`, `logs/50-baseline-bundle-hashes-final.txt`). It claims nothing about old reports.

## Artifact index (this folder)

`report.md` (this), `result.json`, `final-phase2-tracked.diff`, `drivers/` (repeatable, see `drivers/README.md`), `logs/` (numbered in run
order; `05`/`11`/`19` touch, `12`/`14`/`15`/`17`/`18` tap maps, `13` radius test, `23` gap probe, `26` ring clip, `44` enum check,
`35` full Edge run), `first-failure/`, `second-failure/`, `mutation/`, `screenshots/{before-head,after,superseded,
MEDIA-ONLY-forced-palette-not-painted,INVALID-forced-not-applied}`.

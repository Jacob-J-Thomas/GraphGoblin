# #209 loop names: Claude UI phase 1 handoff

Status: phase 1 implemented and focused checks passed. **Not ready for merge.** Pending: phase-2
browser/visual/native runs, full root gates, independent opposite-family (OpenAI) review of this UI,
separate touched-systems QA, complete CI and the fresh Astra max audit. Root owns integration and
the combined atomic PR ("Part of #209"; no closing keyword).

## Identity

- Model: Claude Opus 5.5 (`claude-opus-5-5`). Requested effort: xhigh. The session cannot observe
  its own reasoning-effort setting, so treat "xhigh" as requested, not verified.
- Worktree: `C:/Users/98jak/.codex/worktrees/gg-20261114-loop-names/GraphGoblin`, branch
  `codex/gg-20261114-loop-names`, HEAD `fddadabf8d838098da003cf7fa072050f179445d` (frozen backend),
  baseline main `b3b5e1874a8252cc01c065d18fef42cbfbe075b4`. Node `v22.23.4`, pnpm via the repo.
- Nothing staged, committed, pushed, restacked or stashed by me. No issue/PR writes. No backend
  files, QA records (`docs/qa/2026-11-14-loop-names/`), owner checkout/service/store, ports
  4747/4748 or other worktrees touched. `git stash list` shows one pre-existing entry from another
  branch (`codex/github-triggers-29`), not mine.

## Backend defect for root (not edited)

`pnpm check:deps` fails on the frozen backend commit with a circular import entirely inside
`packages/infrastructure/src/sqlite`:
`db.ts:7 → store-format.ts:10 (import { loopNameKey } from './loop-names.js') → loop-names.ts:3
(import type { SqliteTransaction } from './db.js') → db.ts`. `.dependency-cruiser.cjs` sets
`tsPreCompilationDeps: true`, so the type-only import counts. `loop-names.ts` does not exist at the
baseline; `packages/` is unchanged from HEAD in this worktree. This blocks `pnpm check` (and CI),
not the UI. Log: `check-deps.log`. Suggested owner fix (backend's call): move `loopNameKey` or the
transaction type so the cycle disappears.

## Changed files (working tree, SHA-256 in `source-sha256.txt`)

UI source: `apps/web/src/lib/loop-names.ts` (new), `components/loop-name-conflict.tsx` (new),
`editor/NameConflictNotice.tsx` (new), `editor/EditorPage.tsx`, `editor/EditorToolbar.tsx`,
`editor/LoopSettingsPanel.tsx`, `editor/save-status.ts`, `editor/store.ts`, `editor/useAutosave.ts`,
`loops/LoopsPage.tsx`, `loops/TemplateGallery.tsx`.
Unit/consumer tests and fixture: `lib/loop-names.test.ts` (new), `loops/loop-names.test.tsx` (new),
`editor/EditorPage.name-conflict.test.tsx` (new), `src/__fixtures__/fake-api.ts` (models the API's
admission rule on POST /loops, PUT draft, import with `?name`, template draft; seeded `addLoop`
rows are not checked).
E2E (unrun, phase 2): `e2e/loop-names.spec.ts` (new), `e2e/fixtures.ts` (`uniqueLoopName`,
`publishEventLoop`), `template-gallery.spec.ts`, `edge-routes.spec.ts`, `forms.spec.ts`,
`form-controls.spec.ts`, `decision-routes.spec.ts`, `device-draft-format.spec.ts`,
`node-json.spec.ts`, `node-placement.spec.ts`, `issue-170-qa.spec.ts`, `prereview.spec.ts`,
`routing.spec.ts`, `loop-back-topology.spec.ts`, `responsive.spec.ts`.
Docs: `docs/09-frontend-and-pwa.md` (new "Loop names (#209)" section plus cross-references),
`docs/guide/02-build-a-loop.md` (new "Loop names" section; import text corrected),
`docs/guide/09-templates.md`, `docs/guide/07-troubleshooting.md`, `CHANGELOG.md` (frontend sentence
added inside the existing #209 entry; its upgrade note is unchanged).

## UI behaviour chosen

Shared rules: the refusal is read only from code `LOOP_NAME_CONFLICT` plus a non-blank string
`suggestedName`. Every surface names the refused name, states the rule ("Names that differ only in
letter case or spacing count as the same name."), keeps what existed, and the retry is always a
user submission. No automatic retry, no automatic copy, no global redesign; existing primitives
(`Alert`, `HelpText`, `Input`, `Button`, `FIELD_ROW`) and tokens only. `400 LOOP_NAME_INVALID` keeps
the ordinary error text. The client mirrors the API key (`trim`, `\s+`→space, `toLowerCase`) only to
decide whether a field still holds the refused name.

- **Create**: field-level error under **New loop name** (`role="alert"`, `aria-invalid`,
  `aria-describedby`) and **Use “suggestion”**, which only replaces the text and refocuses the
  field. Guidance follows the text (hides when changed, returns if retyped). Create/Enter retries.
- **Import**: the parsed upload is held unchanged; a full-width region **Import under another
  name** (own line, so the Create form never shifts) shows a warning and a naming form
  (**Name for the imported loop**, prefilled with the suggestion, focused and selected; **Import as
  new loop**, **Cancel**). Retry = `loops.import(client, originalDocument, { name })`. Raced names
  show under the field as an alert with the fresh suggestion; focus stays put. Other failures keep
  the form; "check the loop list" only when the request may have committed (no answer/5xx).
  Cancel focuses the file picker; a new file starts over.
- **Template copy**: a refused **Use** creates nothing; the card's action area becomes the same
  naming form (**Name for the new draft**, **Create draft**, **Cancel**) under the gallery's single
  in-flight guard. Create draft sends the existing body `name`. Cancel restores and focuses **Use**.
- **Editor rename**: store `nameConflict`; save label **Not saved: name in use** with the warning
  icon; polite notice **Another loop already has this name** (distinct title, copy and actions from
  **The draft changed on the server**). It says where edits are kept and that the server keeps the
  previous name/draft. Actions: **Use “suggestion”** (its own undo step; focus → save status),
  **Edit name** (expands Loop settings, focuses/selects **Name**, which is `aria-invalid` and
  described without a second announcement), **Try again** (same name once, `aria-busy`; repeat
  refusal adds "It was still in use when tried again."). While the name is the refused one,
  autosave mirrors to the device but sends nothing; the leave-editor save is skipped; Publish
  refuses with a specific message. Accepted save or any load clears it; reopening restores the
  device copy and its save asks again. Inside the node dialog (page inert) the notice appears
  without Edit name; taking the suggestion there focuses the dialog title.
- **Stale draft precedence**: unchanged `DRAFT_CONFLICT` flow; it clears any name guidance; an
  Overwrite that then meets the name shows the name notice instead.

Defect found and fixed during phase 1: taking the suggestion within 1 s of typing merged into the
name-typing undo step (Undo dropped the typing too). Now the suggestion closes the open step first.

Observation for root/QA (backend behaviour, not changed): the suggestion derives from the attempted
name, so a raced retry of "X copy" is refused with "X copy copy" (the backend's own test shows the
same). The UI displays it as given.

## Acceptance matrix (phase 1 evidence)

| Criterion                                                                                                    | Evidence now                                                      | Pending                                       |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------- |
| Create rejects case/whitespace-equivalent names with guidance; original unchanged                            | `loops/loop-names.test.tsx` Create cases                          | `e2e/loop-names.spec.ts` test 1               |
| Rename rejects; authored text and device draft retained; server loop/ID/draft unchanged                      | `EditorPage.name-conflict.test.tsx` cases 1, 6                    | e2e test 2 (incl. reload)                     |
| Import 409 with suggestion; retry sends original document + `name` query; distinct IDs; same graph           | `loops/loop-names.test.tsx` Import cases (body deep-equal, query) | e2e test 3; `edge-routes`/`forms` fixtures    |
| Template repeat: catalog and original unchanged; explicit name or accepted suggestion creates distinct draft | `loops/loop-names.test.tsx` template cases                        | `template-gallery.spec.ts` repeated-copy test |
| Suggestion can race; correction and deliberate retry without duplicates                                      | raced-suggestion cases (Create, Import, Template)                 | e2e (live race not scripted; unit-level only) |
| `DRAFT_CONFLICT` distinct from name conflict                                                                 | editor case 4                                                     | e2e test 4 (two tabs)                         |
| No automatic retry / no duplicate creation                                                                   | request counts in all unit cases; held autosave                   | e2e request counts                            |
| Guidance clears after resolution and navigation                                                              | Create edit-away case; editor cases 2, 6                          | e2e tests 1–2                                 |
| Narrow screen keyboard/focus                                                                                 | focus assertions in unit tests                                    | e2e test 5 (360 px), gallery 390/320 px       |
| Existing duplicates: manual repair/reset only                                                                | docs (guide, doc 09, CHANGELOG note unchanged)                    | —                                             |

## Commands and results (logs in this directory)

- `node --version` → v22.23.4.
- `pnpm --filter @graphgoblin/web typecheck`: first run failed (`LoopsPage.tsx` exactOptionalPropertyTypes on `{ templateId, name }`; fixed). Later e2e typecheck failed on `interface Detail` with Playwright `toMatchObject` (fixed with a type alias). Final: pass (`typecheck-web-final.log`).
- Existing suites before new tests (`src/loops`, `api/templates`, `EditorPage.conflict`): 4 files, 44 passed (`vitest-existing-1.log`).
- New unit/consumer tests: `lib` + `loops/loop-names`: 12 passed first run. Editor name tests: first run 3 failed (device wording asserted before the device write answered; undo-coalescing defect above; ambiguous "Loops" link), all fixed; then 6 passed.
- Affected suites `src/editor src/loops src/api src/drafts src/runs/new src/lib src/components`: 99 files, 1082 passed (`vitest-affected-1.log`).
- Other write-route consumers (`app/OwnerChatSummary`, `events/EventsPage`, `forms/EarlierNodeOutputs`, `forms/structure`, `settings/VoiceSetupSheet`): 5 files, 123 passed.
- Final focused rerun after formatting: 11 files, 155 passed (`vitest-final-focused.log`).
- ESLint: changed files first run 1 error (unnecessary non-null assertion; fixed); `pnpm --filter @graphgoblin/web lint` final pass.
- Prettier: first check flagged 8 files; formatted; final `prettier --check` on all changed files passes.
- `pnpm check:tokens` pass, `pnpm check:layers` pass, `pnpm check:deps` **fails on the backend cycle above** (no web violation).
- Guide fences unchanged (20 before/after), so `apps/api/src/guide-examples.test.ts` inventory is unaffected (not run; backend test).
- Not run (by instruction): root build/check/coverage, full web coverage, served API, any browser suite.

## E2E fixture audit (static; one shared in-memory gateway for the whole run)

Method: enumerated every loop-creating site (`/loops`, `/loops/import`, template drafts, UI
Create/Import/Use, editor renames, `publishLoop`/`publishEventLoop`) and resolved names through
helpers, defaults and top-level `for`/`describe` loops; `/apps` and `claudeInstance` sites use
per-test stores and were excluded. Collisions fixed while keeping each test's purpose:
`crossingLoop()` default (edge-routes), `decisionLoop()` (decision-routes), `forms ${kind}`,
`controls ${kind}`, `JSON ${kind}`, `Placement ${kind}`, `QA170 ${kind}`, `server work`
(device-draft-format, per-case literal), `Synthetic cron setup` (per `from`), routing and
loop-back `openGraph` fixtures, responsive seeds (`responsive sweep/child/dialogs/editor/keyboard`,
`touch zoom layout`, dense graph), and `publishEventLoop`'s `Browser Events`.
`uniqueLoopName(base)` appends `[<testId tail>-<n>]`, keeping the readable base so substring
`getByText` ready markers still match; exact-name assertions use the returned value.
Template tests: the first test still creates the template's own name; the pending-guard and
failed-creation tests now use the Review and Implementation templates (free names) with the same
assertions; the repeated-copy test seeds/locates the taken Starter name, asserts the 409 leaves
catalog/original/loop set unchanged, then creates one typed-name and one accepted-suggestion copy
and compares graphs without names; the fresh API copy uses an explicit name. Imports at
edge-routes (~518) and forms (~293) now assert the 409, then import the unchanged export with
`?name=` and keep their route/whitespace-template assertions (nodes/edges equality added).
`forms.spec.ts` raw import (~337) keeps its unique name and its EXPRESSION_INVALID assertions.
Residual risk: a missed helper would fail loudly at fixture creation (`409 LOOP_NAME_CONFLICT`
instead of 201) in phase 2; treat that as a fixture-naming defect.

## Phase-2 plan (browser/visual/native)

Run on the combined head after root's build, in the heavy slot (Edge, `pnpm build` then
`pnpm --filter @graphgoblin/web test:e2e`), retries 0:

1. `e2e/loop-names.spec.ts` (Create equivalent name → 409 → Use suggestion → Enter creates distinct ID; rename → notice, device draft survives reload, both server loops unchanged, Edit name focus, distinct name saves under same ID; UI import 409 → focused prefilled field → Enter sends the identical body with `?name=` → distinct ID, same nodes/edges; two-tab stale draft shows DRAFT_CONFLICT first, Overwrite then shows the name notice; 360 px keyboard order and no sideways scroll for Create guidance and the import form).
2. `e2e/template-gallery.spec.ts` in full (first copy, guard on Review, failure/retry on Implementation, repeated-copy naming, 390/320 px naming form keyboard order and containment, QA copy).
3. Every modified spec in full (`edge-routes`, `forms`, `form-controls`, `decision-routes`, `device-draft-format`, `node-json`, `node-placement`, `issue-170-qa`, `prereview`, `routing`, `loop-back-topology`, `responsive`), then the whole suite once to surface any missed shared-gateway name.
4. Visual: screenshots in both themes at 360, 768, 1024, 1440 px of the Create guidance, the import region, a template card's naming form and the editor notice (page and node dialog); confirm warning tokens, focus rings, wrapping of long (120-char) names and suggestions (buttons ellipsize with full accessible names), and forced-colours legibility.
5. Native/served API spot checks: real `409` problem bodies through the built app (suggested names, raced suggestion via a second client creating the suggested name between refusal and retry), `400 LOOP_NAME_INVALID` text, and an upgrade start against a store with an equivalent pair (startup refusal per CHANGELOG; repair in the previous build).
6. Screen reader spot check (NVDA or Narrator with Edge): alert vs polite status announcements, no double announcement on the editor Name field, focus after Use suggestion / Cancel / Edit name.

Then: opposite-family review of the UI diff, independent touched-systems QA (positive/negative per
surface, file-store API matrix, real Edge), full CI, Astra max whole-PR audit.

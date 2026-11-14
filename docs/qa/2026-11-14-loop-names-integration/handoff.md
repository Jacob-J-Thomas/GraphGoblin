# #209 + #235 integration: Claude phase 3 handoff (bounded integration checks)

Status: **all UI, test and docs checks I was asked to run passed on the integrated build, and I changed no source
file.** I did find **four failing backend-side tests** (two files, `apps/mcp` and `packages/api-client`). They fail
because of #209's name rule and are byte-identical to the #209 parent, so the merge did not cause them. They are in the
frozen GPT backend's test layer, so I report them and did not fix them (details in "Backend-side failures").
**Not merge-ready.** Nothing was committed, pushed, staged, stashed, restacked or written to an issue or PR.
Correction batches used: **0 of 1**.

## Identity and environment

- Model: Claude Sonnet 5.5 (`claude-sonnet-5-5`). Effort requested: xhigh. I cannot observe my own effort setting, so
  treat "xhigh" as requested, not verified.
- Worktree `C:/Users/98jak/.codex/worktrees/gg-20261114-loop-names/GraphGoblin`, branch `codex/gg-20261114-loop-names`.
  Admission HEAD `c427287b41a4e1b67a397ab4e03e228c6ea62450` (tree `3d32c7eaad229efad6a896721cbe60cc289726d5`),
  parents `512200ce1b4c779bc7edcbf6d59e5a890dc0837c` (#209 + responsive fixture fix) and
  `1ae90e2b35c2f2365efad4118e5cebf98ad1d3fd` (#235 input correction + main cee2 + plugin work). Clean at start
  (`git-status-start.txt`, 0 lines) and clean at the end (0 lines). HEAD, tree and the tracked-file hash
  (`f89751f5141ec6c2de10eb750b4f96d37e16c92605c569197e4fc3a2bc7846ba`, per-file sha256 of every tracked file) are
  identical at start and end.
- Node `v22.23.4` (project runtime), pnpm `12.8.1`, Playwright `1.63.0`, Vitest `5.0.3`, Microsoft Edge `157.0.4341.46`
  (real `msedge` channel, the Windows default; `GG_E2E_BROWSER_CHANNEL` unset), Windows 11 (10.0.26300), headless.
  Playwright config unchanged: `retries: 0`, `workers: 1`, `timeout: 60 s`, `expect.timeout: 10 s`. No threshold,
  timeout, retry or coverage rule was changed.
- Everything I wrote is under this directory. `events.jsonl`, `latest.md`, `launch.json` belong to the launcher;
  `report.md` and `result.json` are the runner's. Phase 1 and phase 2 evidence was not touched.

## 1. Seam inspection (what I verified and how)

I compared the merge against both parents with `git` only (no checkout).

- **Merge base** is `9748714c` (main at #461). Files changed on both sides, so merged by Git or by root: six only:
  `CHANGELOG.md`, `docs/09-frontend-and-pwa.md`, `docs/decisions/README.md` (the three root resolved by hand),
  `docs/07-api-and-streaming.md`, `apps/web/e2e/form-controls.spec.ts`, `apps/web/e2e/responsive.spec.ts` (all three
  auto-merged).
- **Every other changed file survives untouched.** All 63 files only #209 changed are byte-identical (same blob) to
  `512200ce`, and all 356 files only the #235/main side changed are byte-identical to `1ae90e2b`. So every #209 UI
  source behavior (`loop-name-conflict.tsx`, `NameConflictNotice.tsx`, `EditorPage.tsx`, `EditorToolbar.tsx`,
  `LoopSettingsPanel.tsx`, `store.ts`, `useAutosave.ts`, `save-status.ts`, `lib/loop-names.ts`, `LoopsPage.tsx`,
  `TemplateGallery.tsx`, the fake API's admission, the api-client and the backend) and every #235 source behavior
  (`JsonSchemaForm.tsx` numeric reset through `badInput`, input presence, Omit, the coarse 44 x 44 px geometry, and their
  unit tests) is present as its parent wrote it. No product file is a hybrid.
- **Auto-merged specs.** For both `form-controls.spec.ts` and `responsive.spec.ts` the changed-line set of HEAD against the
  other parent hashes identically to each parent's own delta from the merge base (4 of 4 comparisons match;
  `deltas/auto-merge-line-set-check.txt`). Nothing from either side was dropped or duplicated, and
  `git merge-tree` of the parents reproduces both files exactly.
- **Docs.** The three hand-resolved files differ from a fresh automatic merge only by the removal of conflict markers
  (`deltas/head-vs-automerge-with-conflict-markers.stat.txt`: 3 files, 3 insertions, 13 deletions). `CHANGELOG.md` keeps
  both Unreleased entries (#209, #235) and the plugin entries; `docs/decisions/README.md` indexes ADR-0072 and ADR-0073,
  and both files exist; `docs/09` keeps #209's Errors paragraph (name refusal, "Loop names" cross-reference) and #235's
  Where paragraph (input presence, Omit, geometry, the badInput check), plus both Regression and Touch additions.
  Prettier passes on all of them.
- **Fixture names.** The #209 spec fixes survive: `form-controls.spec.ts` `createLoop` builds its loop through
  `uniqueLoopName`, and `responsive.spec.ts` `seedDialogs` returns the generated `name` and the all-nine-dialog test
  passes it to `openDraftTab` (the 512200ce fix). `uniqueLoopName` keeps the readable base at the start, which is what the
  sweep's substring ready markers need. I compared the old and the new template-copy test: IDs, graph (`graphOf`, name
  removed), request body (`{ name }`), catalog and original-copy unchanged assertions are all still there and stricter
  than before; nothing was weakened. #235 added four tests with literal names (`controls run form` pre-existing,
  `explicit input presence`, `omit incomplete number`, `coarse omit`). Each test runs once, in one project, with no
  retries, and a static scan of every literal loop name in `apps/web/e2e` finds **0** groups that ADR-0073's comparison
  (trim, collapse whitespace, lowercase) would treat as equal (`literal-loop-name-scan.txt`, 69 sites). Limits of that
  scan: it matches `approvalLoop('…')` and `…, name: '…'` forms only.

## 2. Build

- First `pnpm build` (05:46:28) **failed** in `@graphgoblin/plugin-codex#build`: `Unsafe plugin output destination
…\apps\plugin-codex\dist\marketplace: ".graphgoblin-plugin-output.json" is not owned by this builder`. Cause:
  environment, not source. The directory was git-ignored output of my own phase 2 build, made by the old plugin builder,
  which wrote no ownership inventory. The new builder from main (#344) refuses to replace it, exactly as the
  CHANGELOG "Upgrade notes" for #344 say. Log kept: `logs/01-build-first-attempt-plugin-codex-stale-output.log`.
- Action: I **moved** that 6-file directory aside, not deleted, to `moved-aside/plugin-codex-dist-marketplace-from-phase2-build/`
  (sha256 list beside it), then rebuilt. This is the documented remedy. Any other worktree with an older built
  `dist/marketplace` will hit the same refusal locally; a clean CI checkout will not.
- Second `pnpm build`: exit 0, **12 of 12 tasks** successful, 9 replayed from the Turbo cache (contracts, domain, engine,
  both adapters, infrastructure, api, api-client, mcp: same inputs as the first attempt), web executed fresh
  (`cache miss`), plugin-codex and plugin-claude force-executed (`logs/02-build.log`). New in this workspace: the
  Claude plugin assembled.
- Output listing hashes (sha256 of the sorted `sha256sum` list of every file; lists in `build-listings/`):
  `apps/web/dist` 28 files `37d2177e…47dd2`; `apps/web/dist-goblin` 28 files `e45aea7d…0d652`;
  `apps/api/dist` 306 files `bbb1b757…e13c`; `packages/infrastructure/dist` 293 files `fb734ebe…20f9`
  (full values in `build-sha256.txt`). I re-hashed after every later run: **unchanged**
  (`build-sha256-final.txt`). The Playwright runs use the built web `dist` served by `e2e/server.ts`; the API under test
  is run from TypeScript source there, as always.

## 3. Browser runs (real Edge, retries 0, run once, first results kept)

Both used `pnpm --filter @graphgoblin/web test:e2e <files>` with **no** literal `--` before the spec arguments; Playwright
listed exactly the files I named.

| Run                 | Selection                                                                                               | Result                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `e2e-selection-1/`  | all of `form-controls.spec.ts` (9), `loop-names.spec.ts` (5), `template-gallery.spec.ts` (11)           | **25 passed**, 0 failed, 0 skipped, 0 flaky, max retry 0, 72.1 s |
| `e2e-responsive-1/` | `responsive.spec.ts`, `--grep` for the all-nine-dialog test and the coarse-pointer test, dark and light | **4 passed**, 0 failed, 34.0 s                                   |

The 4 responsive cases: `responsive dark|light > all nine node dialogs fit their controls at 360 and 768 px` (the two cases
fixed in 512200ce) and `responsive dark|light > on a coarse pointer the controls are at least 44 px` (the #235
Omit coverage). The coarse case reached `/app/runs/new?loop=…` and `/app/runs/{id}` with the generated names, filled the
input, and measured **Omit input = 44 x 44 px on New run and on Wait in both themes** (`e2e-responsive-1/touch-target-attachments/`
and `run.log`), tapped it, and the field emptied. The form-controls coarse test (`with a coarse pointer (#235)`, 24.3 s)
also passed inside the 25.

I did not rerun the 472-case suite or any native matrix, as instructed. No source or class changed, so I took no new
screenshots; the parent #235 images and the #209 naming images remain evidence of their own source.

## 4. Component, unit and static checks

- **Related unit tests**, `vitest related --run` seeded with the 12 changed UI source files (`unit-related/seed-source-files.txt`:
  `JsonSchemaForm.tsx`, `loop-name-conflict.tsx`, `EditorPage.tsx`, `EditorToolbar.tsx`, `LoopSettingsPanel.tsx`,
  `NameConflictNotice.tsx`, `save-status.ts`, `store.ts`, `useAutosave.ts`, `lib/loop-names.ts`, `LoopsPage.tsx`,
  `TemplateGallery.tsx`): **95 test files, 1,256 tests, all passed**, 0 skipped, 509 s, exit 0 (`unit-related/`, file list
  `files-run.txt`). It includes `JsonSchemaForm.test.tsx` (20), `NewRunPage.test.tsx` (9), `WaitPanel.test.tsx` (5),
  `loops/loop-names.test.tsx` (9), `EditorPage.name-conflict.test.tsx` (6), `lib/loop-names.test.ts` (3), `useAutosave.test.tsx` (11),
  `LoopsPage.test.tsx` (21), `TemplateGallery.test.tsx` (10), `EditorPage.test.tsx` (37), `store.test.ts` (41).
  Limit: `related` follows imports of those 12 files. Tests that import only `__fixtures__/fake-api.ts` (the #209 admission
  rule) and none of them are not in this set; they are unchanged since the phase 2 full run. This is **not** a coverage run
  and no historical coverage is claimed for this head.
- `pnpm typecheck` (web): exit 0. `pnpm lint` (web, `eslint .`): exit 0.
- `prettier --check` on the **227** files either parent changed (apps/web, docs, CHANGELOG, mcp, plugins, tooling, api-client,
  contracts, in 8 batches; list `prettier-files.txt`): all formatted. Raw QA JSON/JS is `.prettierignore`d by design.
- `check:tokens` OK (229 files). `check:layers` OK. `check:deps` exit 0, 0 errors and 4 `no-orphans` warnings (the same 4 as
  phase 2).

## Backend-side failures (not mine to fix; for root and GPT)

I extended the integration check to the other packages that call the real in-process API, because #209 changes what that
API accepts. Results (`logs/14`, `15`, `16`, first failures kept; one unchanged recheck of both files in `logs/17`
reproduced the same four):

| Package                                       | Result                                                           |
| --------------------------------------------- | ---------------------------------------------------------------- |
| `@graphgoblin/mcp` (12 files)                 | 11 passed, **1 file failed**: 58 passed, **1 failed**, 2 skipped |
| `@graphgoblin/api-client` (11 files)          | 10 passed, **1 file failed**: 100 passed, **3 failed**           |
| `@graphgoblin/plugin-claude` / `plugin-codex` | 8 passed / 9 passed, 1 skipped (live)                            |

The four failures are all `LOOP_NAME_CONFLICT` (409) raised by the new admission rule against fixture names reused in one
shared in-process app:

1. `apps/mcp/src/mcp.test.ts:226`, "describes a draft-only loop and maps lookup failures to coded tool errors":
   `t.publishLoop({ ...minimalLoop(), name: 'Twin' })` after `'twin'`. This test needs two loops whose names differ only
   by case in order to reach `AMBIGUOUS_LOOP_NAME` (`apps/mcp/src/tools.ts` `resolveLoop`). Under ADR-0073 the API can
   no longer create that pair for one owner, so the test premise is gone and the branch is unreachable through the API.
2. `packages/api-client/src/contract.test.ts:196` ("preserves typed run pages including opaque cursors"), `:314`
   ("streams run events over SSE…") and `:375` ("preserves catalog error paths…"): they reuse `minimalLoop()` (`minimal`)
   and `waitLoop` (`wait-for-input`) that earlier tests in the same file already created. Mechanical.

Why this is not the merge: `git diff 512200ce HEAD -- apps/api packages apps/mcp/src/mcp.test.ts apps/mcp/src/tools.ts`
is empty, and both failing test files are the same blob on both parents (`deltas/backend-test-failures-identity.txt`), while
the admission code is only on the #209 side. So `512200ce` alone has the same four failures. I inferred this from byte
identity and did not check out or run the parent. GPT's own README for the backend slice reports focused matrices only
and says the combined change "needs the full repository gates", so the final Linux CI will meet these.

What I did **not** do, as instructed: change any of it. Minimal corrections I would propose, for GPT or root:

- `contract.test.ts`: give the three tests their own names (for example `{ ...minimalLoop(), name: 'typed run pages' }`);
  no behavior change.
- `mcp.test.ts`: decision needed. Either (a) keep `AMBIGUOUS_LOOP_NAME` covered by a unit test over a stubbed
  `loops.list` in `units.test.ts` and have this test use one name, or (b) delete the now-unreachable branch and its
  doc text in `tools.ts` and `docs/07`. Option (b) removes covered lines, so the package's 90 percent gate needs a look.

Not run here and therefore **unknown**: `apps/api` and `packages/infrastructure` suites, the `tooling` built-app
acceptance suites, `apps/web/scripts` tests, and root `pnpm check`. I ran the other in-process-API consumers I could find
(`grep` for `createTestApp`: all 8 `apps/mcp` test files, all 3 `api-client` files; `plugin-codex/live.test.ts` is
live-gated and skipped).

## 5. Fixture failures versus product failures

- Product (web UI or UI logic): **none** in any run.
- Fixture/test failures: the four above, in backend-side tests, pre-existing on the #209 parent. Zero fixture failures in
  the web e2e or unit selections; the two responsive fixture-name failures from phase 2 stay fixed (re-run: pass).
- Environment: one (stale plugin-codex output, above). I retried, loosened or skipped no test, apart from one unchanged
  rerun of the two backend-side files that had failed (`logs/17`), which reproduced the same four failures.

## 6. Source hashes and precise deltas

- `source-sha256.txt`: sha256 of 54 changed files (web, docs/09, docs/07, decisions, CHANGELOG, api-client, contracts,
  sqlite) at HEAD, taken from the clean tree. Whole-tree hash is above.
- `deltas/head-vs-parent1-209-ui-docs.stat.txt` (HEAD against #209: 10 files, +1,163 / -39, which is exactly the #235 and plugin
  delta in web, docs and decisions) and `deltas/head-vs-parent2-235-ui-docs.stat.txt` (HEAD against #235/main: 48 files,
  +2,329 / -205, which is exactly #209's). Full patches of the five shared files against each parent:
  `deltas/head-vs-parent{1,2}-shared-files.diff`.

## 7. Cleanup and quiescence

- Everything I started has exited: the e2e gateways (Playwright global setup, ephemeral ports), Playwright-launched Edge,
  Vitest workers. I used no native gateway and no fixed port, never 4747 or 4748, no provider and no credentials.
- `process-final.txt` (06:06): `msedge.exe` count 0 (baseline 0); `node.exe` count 33 (baseline 33); listener
  address:port sets identical to the start (`ports-baseline-start.txt` against `ports-final.txt`); no new node listener.
  The owner API on `127.0.0.1:4747` is PID 19500, the same PID as at the start, and I never touched it. The one
  `node.exe` matching my process pattern is PID 25812, the Codex host daemon created 11 Nov and listed in my start
  baseline, so it is not mine.
- Removed my git-ignored `apps/web/test-results` (5 small files; the two touch-target JSON files were copied here first).
  Nothing else was deleted. `git status` shows 0 changed or untracked files. The one stash entry (`codex/github-triggers-29`)
  is not mine and I did not touch it.

## Remaining gates (no merge-ready claim)

1. Root to decide the four backend-side test failures above (GPT's tests; mechanical for api-client, a decision for the MCP
   ambiguity test). Any change moves the head, so the web evidence here then needs only a proportionate recheck (the web
   source would be unchanged).
2. The frozen integrated build needs separate independent UI QA, and the full Linux CI (package and root gates, browser job).
3. Claude review of the GPT backend, GPT review of the Claude UI, and the fresh whole-PR Astra max audit, within 3 scans.
4. Owner #209 acceptance, explicitly required by the issue body; this is not a labels question as the old phase 2 handoff
   said. Parent #235 acceptance and the later actual-main ancestry integration stay with root.
5. Still not exercised by anyone in this phase: real assistive-technology speech, and any Safari/Firefox engine (as in phase 2).

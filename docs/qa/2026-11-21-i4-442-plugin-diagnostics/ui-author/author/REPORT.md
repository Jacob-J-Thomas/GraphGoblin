# #442 UI author report — Codex plugin scope notice in Settings (D175)

Author: Claude Code, Opus 5.5 (`claude-opus-5-5`), xhigh, run `i4-442-ui-author-02`.
Status: **implemented, uncommitted, ready for independent opposite-family (GPT) UI review.**
This is author evidence only; it is not review, browser QA, CI or acceptance.

## Base and scope

- Checkout: `G:/ggq/gg-i4-442-plugin-diagnostics/GraphGoblin`, HEAD
  `5b0d806c75d409c33a57ea54ffda45e2f89bc500`, tree `8e24c697b40eb1a4ab4cd81f481fce53494a2ce7`
  (matches `Q/i4-442-backend-root-freeze.json`). Working tree was clean at start.
- Nothing committed, staged, pushed or published. No issue, owner service, store, configuration,
  plugin, provider or model call touched. No agent spawned. No dependency or lockfile change; no
  install was run (dependencies were already present).
- Runtime: project Node `v22.23.4` (`~/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64`
  first on PATH), pnpm `12.8.1` (`00-node-version.txt`).
- Prior attempt `i4-442-ui-author-01` ended at `usage_limit_reached` before any work; it was read
  only and left unchanged. Nothing from it was reused.

### Files changed (all uncommitted, all owned by this worker)

| File (final SHA-256)                                                                   | Change                                                                  |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `apps/web/src/settings/sections/PreflightSection.tsx` (`69afe7f0…6f29e5`)              | +24 lines: import, `NOTICE_COMMAND`, `CodexPreflight`, one gated line    |
| `apps/web/src/settings/sections/PreflightSection.test.tsx` (`a60b0729…945c61`)         | new `Codex plugin scope notice` block (9 cases); notice checks in 4 existing tests |
| `apps/web/src/settings/SettingsPage.test.tsx` (`ba895a8e…71fc70`)                      | 2 Settings integration tests                                            |

Full final patch: `author/10-final-uncommitted.patch` (SHA-256
`ed049f0dadacc9aaca6680825d78e9ff76dac0f08df1294b6e5e840c2ee95de7`, 273 insertions, 4 deletions).

The seven frozen backend/docs files were not edited; their SHA-256 values still equal the root
receipt (see "Frozen bytes" below). The shared text is imported from the existing public export
`CODEX_PLUGIN_OBSERVABILITY_NOTICE` of `@graphgoblin/domain`; it is not duplicated.

## What the user sees

In **Settings → Harness preflight**, the Codex row reads, top to bottom:

1. unchanged readiness badge (`Ready`, `Sign-in needed`, …), `codex`, version;
2. unchanged server problems, if any, in their existing failure/warning tone list;
3. new: one muted small paragraph with the exact shared text, the two inventory commands set
   as inline code:

   > Loaded plugin tools are not verified by this check. Inspect `codex plugin list --json` and
   > `codex mcp list --json` in the worker directory; neither proves every enabled plugin loaded.
   > Verify the expected tool in the worker before relying on it.

**Retry preflight**, the "Rechecking…"/"Offline" status, the loading view and the
"Could not load preflight" error view are unchanged. Claude, Ollama and any other harness rows
never show the notice; a result list without Codex shows none.

## Copy and layout reasoning

- **Exact shared copy, no new words.** The row renders `CODEX_PLUGIN_OBSERVABILITY_NOTICE`
  verbatim, so Settings, `--preflight` and `GET /system/preflight` make one identical claim and
  the docs' quotation ("The Codex Settings card also says **Loaded plugin tools are not verified
  by this check.**") holds. It states the scope of *this check*; it does not say any plugin is
  broken, and it offers the inventory commands as investigation, with their stated limit.
- **Commands as code without duplicating text.** The constant is split on a capture group
  (`/(codex [a-z]+ list --json)/`); odd parts render in `<code>`, the rest as text. The DOM text
  is byte-for-byte the constant (tested). If the constant's wording later changes so that no
  command matches, it degrades to plain prose rather than breaking. Monospace makes the two
  commands recognisable and easy to select; `<code>` adds no accessible-name change.
- **Muted paragraph, mirroring the existing Claude scope note.** The card already states what a
  readiness result does *not* establish for Claude ("Adapter model listings do not confirm
  account access. Preflight never starts a model turn.") as `text-xs text-muted` text inside
  the harness row. The Codex notice is the same kind of statement, so it uses the same
  treatment and placement (after problems, inside the row). It is information, not status.
- **Why not `Alert`.** `Alert` renders `role="status"` (a polite live region) with a tinted box
  and icon. A static scope note is not a status change; the card already owns exactly one live
  region (Rechecking…/Offline), which docs/09 and the existing test rely on; and a tinted info/
  warn box under **Ready** reads as a problem with Codex, contradicting the unchanged badge.
- **Why not a badge or the problems list.** A second badge beside **Ready** would look like a
  measured plugin state. Problems are rendered in the readiness tone and mean "fix this"; D175
  explicitly declined overloading `problems`, and a Ready row has no problem list at all.
- **Shown for every Codex state, after any problems.** The sentence describes the check's scope,
  which is the same whatever the result, exactly like the Claude note (shown in every state).
  Keeping it constant means the row's layout does not jump between rechecks, and the brief asks
  for it "alongside the unchanged readiness badge, authentication problems and Retry". The real
  problem always comes first in its failure/warning tone; the notice follows, muted, outside
  the list, so it neither hides nor competes with the error. The numbered docs/CHANGELOG
  describe the Settings notice in the Codex card without a readiness condition. This differs
  deliberately from the system report, where `plugins.codex` is a counted `warn` row and is
  emitted only after a passing Codex check; in Settings it is descriptive text, not a check
  result. If review prefers Ready-only gating, it is a one-condition change (mutation M3 below
  shows the tests pin the chosen behaviour).
- **No new data, request or control.** `CodexPreflight` takes no props and uses no hook; it is
  selected only by `harness === 'codex'` from the existing `/harness/preflight` result. No
  contract field, query, probe, link or plugin setting was added. Not a plugin manager.
- **Accessibility.** Ordinary `<p>` inside the Codex `<li>`, read in order after the badge,
  name, version and problems; no `aria-live`, no hidden text, meaning carried by words rather
  than colour; contrast token `text-muted` is the one already used by the Claude note. Inline
  code wraps at spaces on narrow widths (no `nowrap`).

## Tests added (author tests; not independent acceptance)

Component (`PreflightSection.test.tsx`, jsdom + FakeApi, existing `/harness/preflight` route):

- **Ready plus notice**: Codex `Ready` badge keeps `data-state="ready"` and the good tone; exactly
  one notice, inside the Codex row, whole text `=== CODEX_PLUGIN_OBSERVABILITY_NOTICE`, the two
  commands are the only `<code>` parts; muted, not in a bad/warn-tone ancestor, not `sr-only` or
  `aria-hidden`; the row has no problem list; the card has no `alert` and still exactly one
  `status`; Retry enabled; the only request made is `GET /harness/preflight`.
- **Failures stay first and visible** (`it.each` over all six non-ready states): badge label,
  `data-state` and tone unchanged; the server problem is visible in its existing tone list;
  that list holds exactly one item and no plugin text; the notice is in the row, outside the
  list and after it in document order.
- **Non-Codex exclusion**: Codex + Claude + Ollama + `other`: one notice, in the Codex row only;
  each other row keeps its own state and contains no notice or "plugin" text. A Claude-auth +
  Ollama-transport list with no Codex shows no notice. The existing per-state Claude test now
  also asserts no notice/"plugin" text in every Claude state.
- **Retry/query unchanged**: Retry issues exactly one more `GET /harness/preflight` (request
  list is exactly two of them); during the recheck the status says "Rechecking…", Retry is
  disabled, the badge stays `ready` and the notice stays; a recheck that returns Codex `auth`
  shows **Sign-in needed** and the full sign-in problem with the notice after it.
- Existing tests extended: the recheck test (notice kept while rechecking, absent in the
  "Could not load preflight" view and after recovering with a Claude-only result); first-load
  test (no notice while loading); offline test (last Codex result keeps its notice).

Settings integration (`SettingsPage.test.tsx`, full `/settings` route):

- Ready Codex row shows **Ready** and the notice; it is the only notice on the whole page; the
  seeded `other` row keeps **Unknown** and "not logged in" without the notice.
- Codex `auth`: preflight shows **Sign-in needed** and the problem in the failure tone; the
  catalog keeps "Enabled in catalog. Codex readiness: Sign-in needed." and Defaults keeps
  "Codex readiness: Sign-in needed. See Harness preflight below."; the notice appears once, in
  the preflight Codex row, outside its problem list, and not in Model catalog or Defaults.

## Checks run (chronological; every attempt retained in `author/`)

| # | Check | Result | Evidence |
| - | ----- | ------ | -------- |
| 00 | `node --version`, `pnpm --version` with project PATH | v22.23.4, 12.8.1 | `00-node-version.txt` |
| 01 | Baseline before edits: focused Vitest (PreflightSection + SettingsPage) | pass, 2 files, 48 tests | `01-baseline-focused-tests.log` |
| 02 | First post-change focused Vitest | pass, 59 tests (+11) | `02-focused-tests-attempt1.log` |
| 03 | `pnpm run typecheck` (web: `tsc -p tsconfig.json --noEmit`) | pass | `03-typecheck-web.log` |
| 04 | `eslint --max-warnings 0` on the 3 touched files | pass | `04-eslint-touched.log` |
| 05 | `prettier --check` on the 3 touched files | pass | `05-prettier-touched.log` |
| 06 | Mutation checks, 9 mutants of the component (below) | 9/9 detected; file restored, SHA-256 verified | `06-mutation-summary.log`, `mutations/*.json` |
| 07 | Post-mutation edit: comment-only diff vs mutation-tested bytes; 2 extra assertions in existing tests | — | `07-post-mutation-component-diff.txt` |
| 08 | Final bytes: state/hashes, focused Vitest, typecheck, ESLint, Prettier | all pass, 59 tests | `08-final-*.log` |
| 09 | Focused V8 coverage, `--coverage.include=src/settings/sections/PreflightSection.tsx`, repo thresholds (90%) unchanged | pass: statements 100, branches 96.42 (27/28), functions 100, lines 100 | `09-focused-coverage.log`, `09-coverage-preflight/` |

No gate check failed in this run, so there is no failed-and-corrected gate attempt to keep (the
mutant failures above are intended). One read-only review command failed and was redone: a
`git diff --no-index` with Bash process substitution returned `Could not access
'/proc/856/fd/63'`; the same comparison was made with `git show HEAD:… | diff -u -`. The one
uncovered branch (line 45, Claude `models?.length` false path) is pre-existing code from
`84d641a`, not this change. Coverage output went to the evidence folder; nothing was written
into the repository. Not run, by instruction (root-serialized): full build, browser/Playwright
suites, full regression, package-wide `test:coverage`, `pnpm check`.

### Mutation results (all run on bytes `e10cba49…`; only a comment changed afterwards)

| Mutant | Change to the component | Failing tests |
| ------ | ----------------------- | ------------- |
| M1 no-notice | gated line removed | 12 (all notice tests, both Settings cases) |
| M2 every-harness | notice on every row | 10 (Claude per-state ×7, exclusion, recheck, Settings `other` row) |
| M3 ready-only | shown only when `p.ok` | 8 (6 non-ready, Retry→auth, Settings sign-in) |
| M4 warn-tone | `text-status-warn-fg` instead of muted | 1 (Ready quiet-note test) |
| M5 live-region | `role="status"` on the notice | 3 (existing recheck test's single status, Ready, Retry) |
| M6 no-code | commands as plain text | 1 (Ready test) |
| M7 visually-hidden | `sr-only` added | 1 (Ready test, class check) |
| M8 before-problems | notice above the problem list | 6 (non-ready order checks) |
| M9 copy-drift | "not verified" → "not checked" | 12 (every exact-text match) |

## Frozen bytes

The seven backend/docs files equal `Q/i4-442-backend-root-freeze.json` before and after this
work (`08-final-state.log`): readiness.ts `5C05…44ED`, preflight.ts `2C73…3860`,
preflight.test.ts `552C…2532`, docs/06 `63C3…F958`, docs/11 `182D…7CF7A`,
guide/07 `8C22…5778`, CHANGELOG `90EF…20DA`. HEAD/tree unchanged; nothing staged.

## Unresolved limits and hand-offs

- **docs/09 not updated (not my file).** `docs/09-frontend-and-pwa.md` lines 1064–1071 describe
  the Harness preflight rows ("Claude rows add … and state that listings do not confirm account
  access") but not the Codex row's notice. Suggested sync for the docs owner/root: "Codex rows
  add the fixed plugin scope notice (loaded plugin tools are not verified by this check), muted,
  after any problems, in every state; it is not a problem and makes no request." docs/06, docs/11,
  the troubleshooting guide and the CHANGELOG already describe the Settings notice consistently
  with this implementation.
- **Every-state display is a design choice.** The Settings notice shows for every Codex state,
  unlike the system report's success-only `plugins.codex` row (reasoning above). Reviewers may
  prefer Ready-only; that is a one-condition change and M3 shows which tests would need updating.
- **jsdom limits.** Vitest runs with `css: false`, so `toBeVisible` cannot see Tailwind classes;
  hidden/tone states are asserted by class (M4, M7). Real rendering, contrast, wrapping at narrow
  widths/200% zoom (`e2e/responsive.spec.ts` checks Settings for sideways scroll) and screen
  reader order need the separate browser QA. The e2e `readiness.spec.ts` uses one strict
  `getByRole('status')` in this card; the notice adds no status, but that suite was not run.
- **Command code spans depend on the constant's wording.** If the shared text stops containing
  `codex <word> list --json`, the commands render as plain prose (no text is lost or changed).
- Author tests are not independent review, browser acceptance, CI or the designated audit.
  #439, #442 and owner acceptance remain open; no issue was touched.

## Status

Ready for independent opposite-family (GPT) UI review, then browser QA, current-target CI and
the final designated audit. All changes are uncommitted in the three owned files listed above.

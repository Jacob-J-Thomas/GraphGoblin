**Verdict: APPROVE.** I found no introduced root causes that block merge. This is formal review 1 of 3 and does not replace the AstraMAX gate, independent QA or current-target CI.

## Source and base
- **Candidate:** `b45807f033601a53919f2c9e16e0de751971a518`. The worktree's `HEAD` points to `refs/heads/codex/gg-i4-448-preflight`, and that ref holds this SHA.
- **Base:** `02351e2fb932b3be44e7cc3fb3943a61d568226c`. I checked the base side in the separate base-commit worktree (`G:/ggq/gg-i4-448-baseline`):
  - Startup at `container.ts:212-229` built the same catalog inline.
  - Offline preflight at `preflight.ts:644` read only the stored rows.
  - The new shared function `projectStartupModelCatalog` did not exist.
- **Changed files:** all seven files in the worktree match `candidate.diff` exactly.

## What I checked against the contract
- **Shared function** (`settings.ts:457-468`): this is the startup code at the base, moved unchanged. It is pure: it lists stored rows first, then adds any shipped seed whose exact `(harness, model)` pair is missing. Seeds are added in shipped order. It never changes or replaces a stored object, so stored metadata and `enabled: false` win.
  - Order does not matter for lookups. Each pair is unique in storage (`upsert` conflicts on `[harness, model]`), and every caller looks up by exact pair.
  - It is exported through the existing `@graphgoblin/infrastructure/sqlite` entry (`index.ts:20`, `export *`). The API reaches it only through that entry, so it stays within the layer rules.
- **Startup** (`container.ts:222`): the behaviour is unchanged. `DEFAULT_MODEL_CATALOG` is still imported and used at lines 204, 213 and 611.
- **Offline preflight** (`preflight.ts:645`): it reads through the same read-only `handle.db` view, then applies the shared function.
  - It is only called once the store is current with zero pending migrations (`runPreflight` line 366).
  - The missing-store, broken, unsupported and pending-migration paths are untouched.
  - The close lifecycle is unchanged: `runPreflight` is awaited before `sources.close()`.
  - Nothing in the change writes, migrates, seeds or refreshes.
- **Read-only catalog checks:** in a current, migrated store, both paths look up codex/claude rows in the same projected catalog. Startup reads the stored rows with `readPreMigrationModelCatalog` and preflight with `list()`; the two differ only in availability data on `ollama` rows.
- **D172 policy is preserved:**
  - `validateHarnessDefaults` (`model-resolution.ts:135-191`) returns only `invalid` issues. `MODEL_DISABLED` counts as `unavailable` (line 118), so startup does not refuse a disabled default.
  - A disabled Codex default stays WARN (`preflight.ts:280`); a disabled Claude default stays FAIL (`preflight.ts:417`).
  - `isAllowed` refuses disabled rows (`settings.ts:601`).
  - `seed()` keeps `enabled` as stored (its update sets only `displayName`, `efforts` and `defaultEffort`).
- **Tests can tell the fix from the old behaviour:**
  - Pure tests: the `custom`/`gpt-6-luna` row would catch matching on model name only; the frozen inputs would catch any mutation; the stored row's disabled state and restricted efforts would catch seeds overriding stored data.
  - API tests: the restricted-efforts case (`['high']` with `low`, where shipped Opus includes `low`) and the disabled Codex WARN case would catch seeds overriding stored data.
  - The retained counterfactual log (`original-stored-only-control.log`) shows the three positive cases fail against the old stored-only read.
  - The WAL test proves the bytes are unchanged and the WAL file survives.
- **Docs and CHANGELOG:** the statements are accurate against the source. No route or schema changed, so no generated docs or ADR are needed.

## Introduced findings
None.

## Optional pre-existing follow-ups (not blockers; check for duplicate issues before filing)
1. **P3 `preflight/codex-default-effort-unchecked`** — `checkDefaultModel` (`preflight.ts:265-289`) only checks that a Codex model is listed and enabled. Startup also refuses an unsupported effort. So `--preflight` exits 0 with "ready to start" for `gpt-5.5`/`none`, and startup then refuses with `EFFORT_UNSUPPORTED`. The new test records this as current behaviour (`preflight-catalog.test.ts:203-211`). Changing it is a preflight policy change, which D172 excludes from #448.
2. **P3 `docs11/claude-disabled-default`** — the Default model row in the doc 11 table (line 175) lists "in the catalog but disabled" under warn. The actual result for a disabled Claude default is FAIL. The new paragraph mentions only the Codex warning, so the table stays misleading. Adding one clause would fix it.
3. **P3 `preflight/pending-migration-catalog`** — with migrations pending, offline preflight checks against the shipped catalog only (`preflight.ts:366`) and calls it "the default catalog seeded on first start". Startup, for a current store, still checks stored rows first through `readPreMigrationModelCatalog`. The two can still disagree on this path; the new doc paragraph correctly limits itself to migrated stores.
4. **Owner decision needed: `startup-admission/stale-harness-metadata`** — startup and now preflight judge `source: 'harness'` rows by their stored efforts before refresh. The same startup's `seed()` (`settings.ts:490-515`) then overwrites those efforts with the shipped values.
   - An upgrade that adds an effort can't be used as a process default until after one start with a different default.
   - An upgrade that removes an effort lets startup accept a default that the refresh then removes.
   - The contract explicitly chose stored-first metadata, so this is not a finding against this PR.

## Limits
- **Not run by me:** I worked read-only with Read/Glob/Grep only and ran no commands or tests. All execution evidence comes from the author's logs.
- **Commit binding:** I could not run `git status` or `git diff`, so I have not proved the working tree is clean or that the commit tree equals the worktree. I also did not recompute the manifest's SHA-256 hashes.
- **Issue text:** I did not read #448 live. The contract comes from the brief, D172 and line 136 of the delivery register.
- **Still open and not passing:**
  - The cleanup failure (EBUSY) in the `catalog.test.ts` case. It also fails at the base, though on `catalog.db` rather than `catalog.db-wal`, and no cause is established.
  - The failures from the interrupted package-wide infrastructure run.
  - Full coverage, current-target CI, independent QA and AstraMAX.
- **Startup proof:** the tests drive `createContainer`/`runPreflightCli` in-process. They do not prove the built public startup or CLI.
- **Issue closure:** #448 stays open for the owner to close; the commit correctly uses "Part of", not "Closes".
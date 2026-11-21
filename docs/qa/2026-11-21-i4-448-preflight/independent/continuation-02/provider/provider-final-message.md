# #448 independent QA: final report (continuation 02, Claude Opus 5.5)

## Verdict

**CONDITIONAL PASS.**

- **Runtime:** candidate `b45807f` does what #448 asks. Nothing in the native evidence calls for a runtime change.
- **One current blocker, documentation only:** the CHANGELOG sentence #448 adds, and the existing docs/11:157 sentence, both say "database and WAL bytes" stay unchanged. The evidence shows that a read-only open can create an **empty `-wal` and a 32 KiB `-shm`** when a WAL-mode store has no `-wal` file. Replacement wording is in §7.
- **Two failed tiers stay failed:**
  - C12: infrastructure focused suite, 55 passed / 1 failed.
  - C13: native close/EBUSY probe.
  - Both match an existing failure class. Neither is a #448 product regression.
- **Gaps:**
  - C09 and C10: parity with the base binary rests on source comparison only; the base binary was never run.
  - C15: live provider entitlement is out of scope.

## 1. What this report is

- **No new executions.** I only read files. I ran no commands, builds or tests, made no product calls or provider turns, and edited nothing.
- **Source of results.** Every native result cited here comes from QA session 01 (`Q/i4-448-independent-01`, 2026-11-21 09:00–09:17Z). Paths below are relative to that folder.
- **How QA01 ended.** It hit its usage quota, so it never produced a verdict:
  - `provider/result.json` records `is_error: true`, `api_error_status: 429`, `api_error: usage_limit_reached` and `terminal_reason: api_error`.
  - `provider/exit.json` records code 1.
  - The `subtype: "success"` field is a wrapper value, not a result.
  - `observations/criteria.json` is that session's per-criterion assessment, not a final verdict. This report gives the verdict; the original files are unchanged.
- **Not a review.** This is not a formal general review and doesn't reset the review budget. Both formal reviews are used up; the fresh GPT/Astra final audit is scan 3.

## 2. Code and build checks (C01)

- **Branches.** The QA branch `codex/gg-i4-448-qa` is still at `b45807f033601a53919f2c9e16e0de751971a518`, the worktree HEAD. The author branch `codex/gg-i4-448-preflight` is at `083d7264`; according to review-02's `b.patch`, it changes only the docs/11 table.
- **Clean tree.** Index and worktree were clean at 08:50:43Z and again at 09:16:34Z. The lockfile blob `92a751db…` is the same at base and head.
- **Runtime.** Node v22.23.4, pnpm 12.8.1.
- **Build.** One `pnpm build`: "12 successful, 12 total", **5 of them cache replays**, exit 0. It was not a fully uncached build.
- **Built output.** The built files call `projectStartupModelCatalog` at `settings.js:382`, `preflight.js:429` and `container.js:80`. The `apps/api/dist/main.js` SHA-256 `3160ac2a…` is the same in run-01, run-02 and the final state.
- **Diff.** 7 files, +393/−10. Nothing under `apps/web` changed.

## 3. Exact counts

These come from each run's `summary.json`. This corrects C14's "30 each".

| | run-01 | run-02 |
|---|---|---|
| Owned API child processes | **29** = 17 offline P cases + 12 startup (G0 plus S01–S11) | **30** = 18 P + 12 startup (G0 plus S01–S11) |
| Exit code 0 / exit code 1 | 13 / 16 | 14 / 16 (P18 is the extra exit 0) |
| Timed out | 0 | 0 |
| Still running (driver record) | none | none |
| Driver cases (pass / fail) | 40 (18 / 22) | 42 (41 / 1) |
| Checks (failed) | 515 (49) | 580 (1) |

- **Startup children.** There are 11 named startup scenarios plus the G0 first-run start: 12 startup child processes per run, not 11.
- **Exit records vs. process absence.** Exit codes and zero timeouts are the driver's own records. They don't prove that no process was left. That comes separately from two other records:
  - `binding/git-state-after.txt` at 09:16:34Z: `owned_process_refs=0`, `owner_port_listeners=0`.
  - `commands/30-cleanup.log`: both scratch roots removed after their nonces were checked (259 and 274 files), 27 test-suite TEMP leftovers removed, exit 0.
- **Stray wait loop.** The leftover bash wait loop (process tree from PID 40164, 4 PIDs) appears only in the QA01 provider event log (9 mentions), not in the cleanup log. I didn't trace it again.
- **Focused test tiers** are counted separately and not added together:
  - API: 61/61, exit 0.
  - Infrastructure: 55 passed / 1 failed, exit 1.

## 4. Per-criterion results

| ID | Result | Key evidence | Introduced by #448? |
|---|---|---|---|
| C01 | PASS | binding/*, commands/01-build.* | n/a |
| C02 | PASS | dist-binding.txt; run-02 M01 (9/9), P01, S01, S06 | Yes (the intended change) |
| C03 | PASS | run-02 P01, P02, P03, P18; fixtures-run-02/reverify.json | Yes (intended) |
| C04 | **Data unchanged: PASS. Sidecar wording: OPEN (docs-only blocker)** | §5 | Behaviour existed before; the CHANGELOG sentence is new; docs/11:157 existed before |
| C05 | PASS | run-02 S01, S02; reverify | Yes (parity) |
| C06 | PASS | P04, P05, P10, P11, S03, S04, S09, M01 | Kept as before |
| C07 | PASS | P04/P05 raw stdout, S03, S04, M03 | Kept as before (D172) |
| C08 | PASS | P06–P09, S05–S08 | Kept as before |
| C09 | PASS + GAP | P13–P17, S11, binding/unchanged-paths.txt | Kept as before |
| C10 | PASS + GAP | run-02 M02; author original-stored-only-control.log | Yes (intended) |
| C11 | PASS, plus a test-hygiene finding | fake-cli-invocations.jsonl, ollama-recorder-requests.json, 20-api-focused.fetch-guard.jsonl | Hygiene issue existed before |
| C12 | **FAILED TIER** (API passes, infrastructure fails) | commands/20-\*, 21-\*; author focused-infrastructure-02.log, baseline-catalog-single-case.log | Same class existed before |
| C13 | **FAILED TIER** (native cleanup, not a product criterion) | run-01/M04.json, run-02/M04.json | Same class existed before |
| C14 | PASS, with the count correction | §3 | n/a |
| C15 | GAP (out of scope) | none | n/a |
| C16 | PASS | candidate-vs-base.stat | n/a |

**Notes by criterion:**

- **C02.** Both the preflight and startup call sites use the same pure function. M01 shows stored rows keep their order, the input is not mutated, the call is idempotent and only missing (harness, model) pairs are added.
- **C03.** Preflight exits 0 with Database, Default model and Claude default model all ok. After P01 and P03 the stores still have 11 rows, with Terra and Opus absent.
- **C05.** The gateway starts and listens; healthz reports the owned child's PID. Both seeds show as enabled. `/system/model-defaults` equals GG_DEFAULTS. `/system/preflight` reports ok for the database and both default-model checks. The drained exit is 0. Stored rows go from 11 to 13; the migration ledger and format marker are unchanged, and no existing `enabled` flag changed. S02 covers rows missing only in the WAL, with the store inside GG_DATA_DIR.
- **C06.** A disabled stored row with the same seed ID stays a single, disabled row, both offline and after startup. A stored Claude effort list of `[high]` wins: `low` fails offline (P10) and is refused at startup with EFFORT_UNSUPPORTED (S09), while `high` passes (P11).
- **C07.**
  - Codex disabled default (P04): `WARN … is in the model catalog but disabled`, exit 0.
  - Claude disabled default (P05): `FAIL The configured Claude model is disabled`, exit 1.
  - At startup (S03/S04): the gateway boots and the row stays `enabled:false`. Validation reports MODEL_DISABLED as a warning and `publishable` is false. Publish is refused with 422 LOOP_INVALID. A run is accepted (202), then fails with EVALUATION_UNAVAILABLE / MODEL_DISABLED, and the fake CLIs see no model turn.
  - M03: `isAllowed` is false, `resolveHarnessModel` returns unavailable / MODEL_DISABLED, and `validateHarnessDefaults` returns `[]`.
  - D175 is about #442 plugin diagnostics and doesn't affect any of this.
- **C08.**
  - Offline, all four invalid cases fail with exit 1: unknown model, wrong harness, wrong family, and Claude effort `none`.
  - At startup, the gateway refuses with EVALUATION_INVALID_CONFIGURATION plus the matching code: MODEL_NOT_IN_CATALOG, MODEL_HARNESS_MISMATCH (twice) or EFFORT_UNSUPPORTED. DB bytes and logical rows are unchanged.
  - There is an existing mismatch: offline preflight accepts Codex `gpt-5.5` with effort `none` (P12 ok), while startup refuses it (S10). That is parked as #545.
- **C09.**
  - First run with no store (P13/P14): nothing is created.
  - Store format 3 (P15): FAIL with reset guidance.
  - File that isn't SQLite (P16): SQLITE_NOTADB FAIL.
  - Pending migration (P17): `1 migration(s) pending` WARN, ledger unchanged.
  - Startup on store format 3 (S11): refused.
  - GAP: "unchanged from base" rests on these files having identical blobs: `db.ts`, `store-format.ts`, `readiness.ts`, `model-resolution.ts`, `config.ts`, `serve.ts`, `main.ts`, plus two small hunks. The base binary was never run.
  - P17 also shows that preflight uses the shipped catalog for a store with pending migrations. That branch of the code is unchanged by #448 and is parked as #546.
- **C10.** With the candidate code path, both default-model checks pass. With a stored-only catalog, both fail. The startup validator with stored rows only reports MODEL_NOT_IN_CATALOG for both Codex and Claude; with the projection it reports nothing. GAP: this comparison was run on the candidate build, not the base binary.
- **C11.**
  - Fake CLIs: 154 calls (22 each of 7 probe kinds), none refused, so no model turn was attempted.
  - Ollama stand-in: 22 requests, all `GET /api/tags`.
  - Children ran with an empty environment and scratch USERPROFILE, HOME, APPDATA, LOCALAPPDATA and TEMP, on temporary ports.
  - Hygiene finding: the API test run made 10 attempts to reach the default `127.0.0.1:11434/api/tags`, all blocked by the recorder.
  - PID 35168 appears both as run-02's S01 gateway and in the blocked-fetch log. The PID number was reused. S01 exited (code 0) in the run that ended at 09:06:08Z, and the blocked fetches happened from 09:07:56 to 09:08:07Z during the test run.
- **C12.** The failing infrastructure test is `catalog.test.ts` "reads current-format base catalog before discovery migrations…", which fails with EBUSY when unlinking `catalog.db`.
  - The author's candidate run shows 55/1 on the same test (EBUSY on `catalog.db-wal`). The fixed baseline single-case run shows 1 failed / 9 skipped (EBUSY on `catalog.db`).
  - #448 doesn't change that file, and the test doesn't call `projectStartupModelCatalog`; it calls `readPreMigrationModelCatalog`. Its `rm` has no `.catch`, unlike the test just before it.
  - The cause is not established. The failure has not gone away.
- **C13.** M04 unlinks files immediately after closing native connections.
  - Run-01: files from both the libsql writer and the read-only client were still EBUSY after 1.25 s (2 failed checks).
  - Run-02: the writer's files were released by 250 ms. The read-only client's files were EBUSY at 0, 250 and 1000 ms, then removable straight after an explicit `gc()`.
  - The node:sqlite writer releases its files immediately.
- **C16.** No browser or UI code changed.

## 5. C04: what is and isn't established

**Established** (run-02; run-01 agrees wherever its strict check could be evaluated):

- **Stored data unchanged.** These all held in every case where a store file existed, plus M02, all 3 M05 probes and the S05–S11 startup refusals:
  - DB file SHA-256 unchanged.
  - Logical hash, catalog-row hash and row count unchanged.
  - Migration ledger, format marker and schema_version/user_version unchanged.
  - No rollback journal created.
- **Missing seeds are not written.** After P01 and P03 the store still has 11 rows, with Terra and Opus absent. Only an ordinary startup (S01) seeded it to 13.
- **An existing WAL is left byte-for-byte identical:** P03 (16,512 B, no checkpoint, no frames) and P18 (the 0-byte WAL left by P01).
- **Empty sidecar files are created.** 13 of 18 P cases started with no `-wal`: P01, P02, P04–P12, P15 and P17. Each ended with a 0-byte `-wal` (SHA-256 `e3b0c442…`, i.e. empty) and a 32,768-byte `-shm`, and both files remained after the process exited.
  - The other 5: P03 and P18 already had a WAL; P13 and P14 had no store; P16 was not SQLite.
  - The same happened in M02 and the 7 startup refusals: 21 entries in `summary.emptyWalCreatedByOfflineReaders`.
  - Run-01 failed exactly the same 13 P cases plus M02 and S05–S11 on its strict "WAL bytes/presence unchanged" check. That is 47 of its 49 failed checks; the other 2 are M04.
- **It isn't caused by the projection.** M05 gets the same 0-byte `-wal` and 32 KiB `-shm` from each of these on its own:
  - the built `openReadOnlyDatabaseClient`;
  - the built `guardCurrentStore` (the unchanged guard that startup and preflight share);
  - Node's own SQLite in `readOnly` mode (SQLite 3.53.4).
- **Zero WAL frames means nothing reached the stored data through the WAL.** That still doesn't amount to "no WAL created".

**Not established:**

- Any claim that no new sidecar file appears. That claim is contradicted.
- Base-binary behaviour. The behaviour likely predates #448 (unchanged source plus M05), but the base binary was never run.
- Behaviour on non-Windows systems, Docker volumes, read-only directories or filesystems, or restricted permissions.
- How often real stores have no `-wal`. Here, G0's drained gateway exit left a 650,992-byte `-wal` and a 32 KiB `-shm`. The fixtures with no `-wal` were produced by the QA's own checkpoint and close.
- How a later writer behaves with an empty `-wal` already in place. This was not specifically tested.

**The run-02 rewording is not a hidden fix.**

- The run-02 driver's `walChecks` function (lines 332–351) says outright that it now accepts "absent or 0 bytes" and records `walCreatedEmpty`.
- Run-01 is kept as it was, and criteria.json graded C04 PASS+GAP, not PASS.
- Even so, run-02's 41/42 must not be read as confirming the "WAL bytes unchanged" wording.
- I'm refining one original interpretation: run-01's failures were not wrong expectations. They were correct observations against the documented claim, which mixed up "no data written" with "no file created".

## 6. Current blocker vs. older, bounded findings

- **Current blocker (documentation only, within #448's scope).** The CHANGELOG sentence is new in #448. docs/11:157 is older, but it sits in the section #448 extends. The fact that root has parked related issues doesn't excuse new text on an invariant #448 touches.
- **Older findings, not #448 blockers:**
  - **#545:** Codex effort is checked at startup but not in offline preflight (P12 vs S10).
  - **#546:** stores with pending migrations use the shipped catalog in preflight (P17). On the startup side, per source, `container.ts:220` applies the projection when the guard reports `current`.
  - **#262:** model retirement and stale-metadata policy; not touched.
  - C12 EBUSY, C13 native close, and the C11 test fetches to the default Ollama port.
  - The empty-sidecar behaviour itself. If root wants literally no new files, that means changing the shared read-only open, which is a separate decision outside #448.

## 7. Proposed wording

I wrote the wording below. Root applies it after this verdict, and the independent GPT reviewer gives it a final check. None of it is applied yet.

**7a. CHANGELOG: replace the #448 entry**

```
- Offline `--preflight` admits missing shipped model seeds in memory using the same stored-first
  catalog projection as startup (#448). Existing stored metadata and disabled rows retain
  precedence, with the existing warning/refusal policy. Preflight does not seed, refresh or
  migrate the store; database bytes, stored rows and an existing WAL remain unchanged. SQLite's
  read-only open may create or update `-shm` and, if a WAL-mode store has no `-wal`, create an
  empty one (no frames, so no stored data).
  **Upgrade:** rebuild the API. No schema, stored format or reset change.
```

**7b. docs/11 line 157: replace the paragraph** (it stays one source line)

> `apps/api/src/preflight.ts` runs a fixed list of checks and reports each as `ok`, `warn` (works, but something is missing or is set up on first start), or `fail` (runs will not work until it is fixed). Nothing in it changes stored state or starts a harness session: an existing store is inspected through the same read-only connection as startup's guard, so a refused or healthy store keeps its database bytes, stored rows and any existing write-ahead log bytes. SQLite's read-only open may still create or update the `-shm` shared-memory index and, if a WAL-mode store has no `-wal` file, create an empty one; it holds no frames, so no stored data changes.

**7c. Table, Default model row** (relative to `083d7264`; the warn cell stays the same, so only the Codex warning and the Claude failure are covered, as now)

- **fail (recommended):** `Codex model is missing; a configured Claude default has a missing, unknown, wrong-family or disabled model, or a missing or unsupported effort`
- **ok (optional):** `Codex model is in its enabled catalog; a configured Claude default is the exact enabled model with a supported effort (no Claude default: not checked)`

Evidence for this wording:

- With Codex-only GG_DEFAULTS, the P12 output has no Claude default model row (`preflight.ts:410–411`).
- A disabled Claude default fails (P05), as do a wrong-family Claude model (P08) and an unsupported Claude effort (P09, P10). A disabled Codex default warns (P04).
- A missing Claude effort and an unknown Claude model rest on source only (`preflight.ts:413–416`); no native case ran them.
- The fail cell matches review 2's suggested rewording.
- Root re-runs the formatter to fix table padding.

**7d. Follow-up issues, to align after the verdict**

- **#546 is inaccurate as written.** Replace its line with:
  `- Never create, migrate, seed, refresh or alter the inspected database, and never write WAL frames or change an existing WAL; preserve the SQLite reader-sidecar exception (`-shm` updates, and an empty `-wal` beside a WAL-mode store that had none) and failure closure of unsupported formats.`
- **#545 has no literal "never create" clause.** An optional matching edit:
  `- Preserve read-only database/WAL behavior (no WAL frames; an existing WAL unchanged), stored enabled preferences, existing harness readiness separation and the documented SQLite reader-sidecar exception (`-shm`, and an empty `-wal` where none existed).`

## 8. Remaining limits and root gates

- **Test environment.** Windows only. Fake CLIs and a local Ollama stand-in; no live entitlement and no browser.
- **Fake Claude binary.** The `claude.exe` hash differs between runs (`bbdc2723…` and `98b4ae3c…`) but comes from the same `.cs` source (`1a5b48a2…`). Both runs passed its self-test: version check exits 0, a model turn is refused with 86.
- **Author records.** The raw output of the author's interrupted, wrongly scoped test run was not fully kept.
- **Publication draft.** I did not recompute the 51 hash checks in `Q/i4-448-publication-01`.
- **Root gates still open:**
  1. Apply or decide the wording in §7 and create the documentation-only head.
  2. Independent GPT final review of that wording.
  3. Fresh Astra final audit (scan 3).
  4. CI on the current head and target.
  5. Owner-only closure of #448.

I closed, published and approved nothing.
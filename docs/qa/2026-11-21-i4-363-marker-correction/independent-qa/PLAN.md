# #363 F3 independent behavior QA — PLAN (written before any QA execution)

Written 2026-11-21 (UTC ~11:55) by the independent Claude Code Opus 5.5 QA context. This is not the
author, not a formal review and not a fourth general scan. No sign-off, merge or acceptance is
inferred from anything here.

## Bound inputs (verified read-only before this plan)

| Item | Value |
| --- | --- |
| QA checkout | `G:/ggq/gg-i4-363-sdk-qa/GraphGoblin` (worktree, detached). Pre-state clean at `7d8467439b9850a555b92ab4b96b58c8b8b78388`; authorized `git checkout --detach` done at 2026-11-21T11:43:30Z |
| HEAD / tree / parent | `b1cdd20463f6dbbd4e55cae0109395db724a778f` / `65443d7d6be5eb7c1a4f98579c017692f00a5a2c` / `55c9a5497f9e4a6e7f9ebeaa29283e3898170683`; status and index empty after checkout |
| `schema-cli.mjs` | 3006 B, SHA-256 `80a342d89d5601e3b9c6ab1acaa2874fac48ea63d0028cc77c56da54b7cedf03`, blob `ef5bf953` |
| `sdk-schema-case.mjs` | 4669 B, SHA-256 `8bddd500a108d3275472c6dbaaad6d3dccbb1120ede9752556017cf1e46ef7b2`, blob `dec377a5` |
| `sdk-schema.test.ts` | 7949 B, SHA-256 `2050e1298e84323fd026c8af5d953697562894ba5de3f0db8863d6caa629058a`, blob `9c006f74` |
| Diff parent→HEAD | Only these 3 files; byte-identical to root-freeze `source.patch` and author `candidate.diff` (SHA-256 `32258c10…d4c7`) |
| 7d84→HEAD under `patches/`, `pnpm-lock.yaml`, `package.json`, adapter | No changes to patch/lock/package.json; adapter changes = 3 fixture/test files + the inherited #547 JSDoc files `isolation.ts`/`options.ts` |
| Installed SDK | `@openai/codex-sdk@0.160.0` (patched store copy `…_p_aa5745971a3ae54b1fe34d68f9e04906`), `dist/index.js` SHA-256 `ec7471535be310cabbb8f256faa80a1101e46b84b41d42cae40a3e36a9a5feb7` (= expected) |
| SDK patch / lock | `119554c3f7cb39db6b24dbb75e9d51fede75171d04aec0114d31356b79693760` / `bcc908d0f7aa32ba4a64302a9f74284c1a0679e2372ca1ba83176af5b5bbcce2` |
| Node / pnpm | v22.23.4 at `C:\Users\98jak\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64\node.exe` (SHA-256 `dccc52de…c14f`); pnpm 12.8.1 (= `packageManager`) |
| Governing inputs | Hashes in `preflight/input-hashes.txt` (Astra F3 report = `01a66800…45ae`, the hash D190 cites). Previous `i4-363-sdk-independent-02` 139-file hash snapshot in `preflight/independent-02-hashes-before.txt`; it will be re-hashed at the end and never written |

Source reading (actual code, not the author report): the corrected CLI opens `${record}.${pid}.${uuid}.pending`
with `wx`/0600, writes the full JSON, closes, optionally publishes pause metadata by its own
write/close/rename, waits up to 3000 ms for the release file, then `renameSync`s to the final marker.
The corrected host wraps observation in try/catch/finally, aborts in abort mode *or* on any
observation error, awaits SDK work, polls `process.kill(record.pid, 0)` up to 3000 ms **only when a
record was parsed**, writes state, and rethrows the original observation error. The installed SDK
spawns `codexPathOverride` (= host `process.execPath`) with `signal`, removes all child listeners in
its `finally`, and removes the `gg-schema-` directory before `run()` settles.

## Independence design

My own driver (`drivers/qa-driver.mjs`) spawns the **unmodified** checkout host
`packages/adapter-codex/src/fixtures/sdk-schema-case.mjs`, which imports the actual installed SDK
and injects the actual corrected `schema-cli.mjs` producer into the SDK child via `NODE_OPTIONS`.
My driver supplies its own roots, config files, child environment, TEMP construction, strict-schema
object (different key order from the maintained test, so bytes are distinguishable), sentinels and
expectations, and makes its own native observations from outside the host. It does not import or
call the author's replay or the maintained test.

**External publication hold.** The host passes through all parent environment variables except
`NODE_OPTIONS`/`NODE_V8_COVERAGE`. In the X cases the driver runs the host **without**
`publicationBarrier` and sets `GG_SCHEMA_PAUSE_FILE`/`GG_SCHEMA_RELEASE_FILE` to the driver's own
paths. The real producer then pauses before its final rename, and the real host observer is the
plain abort observer that polls only for the final marker. The driver, not the host, holds and
releases the barrier.

## Instruments and their limits (declared tiers)

- **T1 host state:** the host's own `state.json`/stdout, which is the fixture's self-report.
- **T2 driver-native filesystem:** `lstat`/`readdir`/raw bytes/SHA-256 from the driver process.
  "Closed" sibling: open with raw libuv `UV_FS_O_EXLOCK` (0x10000000, share mode 0). It succeeds
  only if no other handle is open. Validated by control C1. If C1 fails, "closed" falls back to
  source-order evidence only, and the report says so.
- **T3 driver `process.kill(pid,0)`:** libuv `OpenProcess` + `GetExitCodeProcess`. It cannot prove
  identity on its own and is conservative under PID reuse.
- **T4 scoped CIM:** an owned, pre-warmed PowerShell 5.1 probe (`drivers/cim-probe.ps1`). It queries
  `Win32_Process` only by explicit PID or `ParentProcessId=<owned host PID>`, plus
  `Get-NetTCPConnection`/`Get-NetUDPEndpoint -OwningProcess` for owned PIDs. Read-only.
- **Not available:** the host never receives a public `ChildProcess` handle, because the SDK owns
  it and removes its listeners. SDK work settlement (AbortError) alone is **not** treated as proof
  of termination.

## Finite case list (each run exactly once; no retries; no repetition loops)

Driver run `run-01`: 2 instrument controls + 11 host cases = 13 items, in this order.

| ID | Config | Predicted outcome |
| --- | --- | --- |
| C1 | EXLOCK control on a driver-owned scratch file | Held normal fd → EXLOCK open fails `EBUSY`; after close → succeeds |
| C2 | kill0/CIM control: owned `node -e` sleeper with a scratch marker argument | Alive: kill0 true, CIM parent = driver PID and command line has the marker. After handle kill + exit: kill0 ESRCH, CIM empty |
| M1–M3 | short TEMP × success/error/abort | **success:** resolved `{"ok":true}`. **error:** rejected, message contains `Controlled schema fixture failure` and `code 7`. **abort:** rejected `AbortError` with `schemaPresentAtAbort` true. **All three:** host exit 0, no signal, empty stderr; `schemaText` = my schema bytes exactly; schema dir `gg-schema-[A-Za-z0-9]{6}` directly under my TEMP; `schemaPath` = dir/`schema.json`; dir removed after; `workSettled` true; `childAliveAfter` false; T3+T4 child absent; TEMP listing and all sentinels byte-identical; driver TEMP/TMP/TMPDIR/HOME/USERPROFILE unchanged; one record, no `.pending` residue; `actualTemp` = my TEMP |
| M4–M6 | 226-char TEMP × success/error/abort | As M1–M3, plus schemaDirectory length **243** and schemaPath length **255** |
| M7 | Maintained barrier config (`publicationBarrier: true`); host self-releases | Exit 0, empty stderr. `publicationWindow` = {finalMarkerExists false, observerWaiting true (a literal in source, so not evidence), workSettled false, pendingFileExistsAfter false}, with `pendingRecord` deep-equal to `record`. AbortError, child absent T3+T4, no `.pending`/`.pause` residue |
| M8 | `observerFault: 'read'` | Exit **1** (positive expectation). Stderr contains the original `ENOENT … schema-record.json`, and the thrown error is not AbortError. `observationError` {Error, ENOENT}; outcome AbortError; `childAliveAfter` false; schema dir removed; T3+T4 child absent; marker absent |
| M9 | `observerFault: 'parse'` | Exit **1** (positive expectation). Stderr contains the original `SyntaxError` message; `observationError` name SyntaxError; outcome AbortError; `childAliveAfter` false; marker bytes exactly `{` (1 B); T3+T4 child absent |
| X1 | abort, external hold, then driver release | **During hold** (≥2 samples ≥250 ms apart): final marker ENOENT; my pause metadata parses; pending sibling parses, pid = CLI pid, `schemaText` = my bytes, size stable, EXLOCK open succeeds (closed); `schema.json` exists in TEMP with my bytes (so SDK cleanup has not run); child kill0 alive; CIM child parent = host PID, Name `node.exe`, command line has `exec --experimental-json` and `--output-schema <schemaPath>`; exactly one child of host; no TCP/UDP endpoints for host/child; host alive; no `state.json`; host stdout empty. **After release:** final-marker bytes SHA-256 = held-sibling bytes; exit 0, empty stderr; AbortError; `schemaPresentAtAbort` true; `record` deep-equal held sibling; `workSettled` true; `childAliveAfter` false; schema dir removed; pending absent; T3+T4 child absent |
| X3 | abort, external hold, then driver creates an **empty** final marker (exact F3 window state: open, no write) instead of releasing | Exit **1** (positive expectation). Stderr has original `SyntaxError: Unexpected end of JSON input`, not AbortError. Outcome AbortError, so abort happened. `workSettled` true. Host `record` undefined, so **host `childAliveAfter`/`schemaDirectoryExistsAfter` predicted undefined** (a limit of the host self-check). Driver T3+T4: child absent; held schema dir absent; TEMP listing unchanged. Predicted residue: pending sibling + my pause file remain in root, because the CLI is terminated before its `finally` |

X2 is intentionally not used. Overlap: M1–M9 mirror the 9 maintained test scenarios with my own
config. X1 overlaps M7 by criterion (publication window) but with external hold and native
observation. X3 overlaps M9 by criterion (parse fault) but the fault comes from outside the host
and uses the F3 empty-marker input. Per the brief, X3 is the only new independent negative. It is
needed because the maintained fault controls are injected by the code under test and never present
an empty marker. The old-source counterfactual is **not** re-run; it stays the author-controlled
case.

Hard caps: each host case is killed by its owned handle at 9000 ms (the host's own limits are
3000 ms + 3000 ms). X hold release cap is host spawn + 2300 ms. In X1, if the CIM probe has not
answered by then, the driver releases anyway and labels the late results as post-release.

Maintained tier (once): `pnpm --filter @graphgoblin/adapter-codex exec vitest run src/sdk-schema.test.ts`
with task TEMP. Predicted 9/9 passed. No typecheck/lint/coverage/build (left to the author and CI);
no installs.

## Owned processes, paths and cleanup

- **Owned processes:** driver node; per case 1 host node (spawn handle) and 1 SDK child node (bound by record pid + CIM parent = host PID + command line under the case root); 1 PowerShell CIM probe (spawn handle; stopped by stop-file); C2 sleeper; vitest/pnpm tree (its own children). Kill only by owned handle. A child is killed only if CIM shows parent = owned host and the command line contains the case root. No kill from lists. Ports 4747/4748 and owner services/stores are untouched.
- **Env:** driver/vitest TEMP/TMP/TMPDIR = `G:/ggq/qa-scratch/i4-363-marker-qa/<run>/tmp`, set per process only. Host env = allowlist (PATH, PATHEXT, SYSTEMROOT, WINDIR, COMSPEC, NUMBER_OF_PROCESSORS, PROCESSOR_ARCHITECTURE) + per-case TEMP/TMP/TMPDIR + synthetic HOME/USERPROFILE/APPDATA/LOCALAPPDATA/CODEX_HOME under the case root (+ the 2 hold variables for X cases).
- **Evidence:** only under this directory, in `run-01/` (`run-02/` only for a single diagnosed correction; never overwrite). Scratch: only `G:/ggq/qa-scratch/i4-363-marker-qa`. At the end the driver writes a manifest of each case root. Root files are copied into evidence. The scratch subtree is then removed only after realpath-prefix and no-reparse-point checks.
- **Final checks:** CIM for all recorded PIDs plus a read-only command-line filter for my scratch/driver paths → expect none; checkout `git status` clean and HEAD unchanged; independent-02 hashes unchanged.

## Stop / correction rules

An unmet prediction is reported as observed, with raw evidence. At most one bounded driver
correction is allowed, and only after a written diagnosis that a driver/instrument defect (not
product/fixture behavior) caused it. Corrections go in a new `run-02` that keeps `run-01` intact.
No product or test source edits. No author checkout access beyond reading its evidence. No
commit/push/GitHub/agents/provider/Codex/HTTP calls.

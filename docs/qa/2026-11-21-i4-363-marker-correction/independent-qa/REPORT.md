# #363 F3 independent behavior QA (D190, D-035/D-042 completion path)

**Result in this finite scope:** the corrected fixture at `b1cdd204` met every declared criterion
check, and every outcome matched its prediction:

- My independent driver ran 11 host cases with **422/422** criterion checks, **5/5** declared predictions and **11/11** observations.
- Both instrument controls passed, as did the final process sweep (driver exit 0).
- The maintained focused suite passed **9/9** (exit 0).

The three expected-fault cases (M8, M9, X3) exited with code 1. This matches positive expectations
declared in the PLAN; it is not a generic pass.

This is behavior QA evidence only. It is not a review, a fourth general scan, Astra sign-off, merge
approval or acceptance. Context: actual Claude Code, Opus 5.5 (`claude-opus-5-5`), xhigh per
`spec.json`, in a fresh independent QA context. I am not the author.

## Bindings

| Item | Observed |
| --- | --- |
| QA checkout | `G:/ggq/gg-i4-363-sdk-qa/GraphGoblin`, a worktree. Pre-state detached and clean at `7d8467439b9850a555b92ab4b96b58c8b8b78388`. Authorized `git checkout --detach b1cdd20463f6dbbd4e55cae0109395db724a778f` at 2026-11-21T11:43:30Z |
| HEAD / tree / parent | `b1cdd204…` / `65443d7d6be5eb7c1a4f98579c017692f00a5a2c` / `55c9a5497f9e4a6e7f9ebeaa29283e3898170683` (from `git cat-file`; re-verified by the driver at runtime and again afterwards) |
| Change set | parent→HEAD touches only the 3 fixture/test files. That diff is byte-identical to root-freeze `source.patch` and author `candidate.diff` (SHA-256 `32258c107846be747d177235310f193c27e2fdedde785563ce2f90ac4739d4d7`). 7d84→HEAD has no change under `patches/`, `pnpm-lock.yaml` or `package.json` |
| `schema-cli.mjs` | 3006 B, `80a342d89d5601e3b9c6ab1acaa2874fac48ea63d0028cc77c56da54b7cedf03` (= receipt) |
| `sdk-schema-case.mjs` | 4669 B, `8bddd500a108d3275472c6dbaaad6d3dccbb1120ede9752556017cf1e46ef7b2` (= receipt) |
| `sdk-schema.test.ts` | 7949 B, `2050e1298e84323fd026c8af5d953697562894ba5de3f0db8863d6caa629058a` (= receipt) |
| Installed SDK | `@openai/codex-sdk` 0.160.0. The host's actual `import.meta.resolve` from the fixture directory gives `node_modules/.pnpm/@openai+codex-sdk@0.160.0_p_aa5745971a3ae54b1fe34d68f9e04906/…/dist/index.js`, SHA-256 `ec7471535be310cabbb8f256faa80a1101e46b84b41d42cae40a3e36a9a5feb7` (= expected) |
| Patch / lock | `119554c3f7cb39db6b24dbb75e9d51fede75171d04aec0114d31356b79693760` / `bcc908d0f7aa32ba4a64302a9f74284c1a0679e2372ca1ba83176af5b5bbcce2`, unchanged before and after |
| Runtime | Node v22.23.4 at `C:\Users\98jak\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64\node.exe` (SHA-256 `dccc52de28d8df2ee22d2062424f8c563070d95d8ad70c54c4bf01d590dec14f`). Inside `pnpm exec`, pnpm 12.8.1 also reported v22.23.4 at that path. PowerShell 5.1.26100.9818 for CIM |
| Inputs read | AGENTS.md, docs/README, docs/15, five-intents register (D-035/D-042 path), `decision-190.md`, Astra F3 `REPORT.md` (SHA-256 `01a66800…45ae`, the value D190 cites; preserved unchanged), root-freeze `receipt.json`, and the author REPORT/predictions/replay logs (for limits only). All hashes are in `preflight/input-hashes.txt` |

## Method and independence

I read the actual corrected source, the parent source and the installed SDK `dist/index.js` rather
than relying on the author's report. My driver (`drivers/qa-driver.mjs`) spawns the **unmodified**
checkout host `sdk-schema-case.mjs`. That host imports the actual installed SDK, which spawns
`node.exe` with the actual corrected `schema-cli.mjs` injected through `NODE_OPTIONS`. My driver
supplies its own case roots and config files, an allow-listed child environment, my own 226-character
TEMP construction, and my own strict schema. The schema has the same constraints as the
maintained one, with different key order, so the bytes are attributable:
`{"additionalProperties":false,"properties":{"ok":{"type":"boolean"}},"required":["ok"],"type":"object"}`.
It also supplies five sentinels per case and its own expectations. The driver never imports or calls
the author replay or the maintained test.

**External publication hold (X cases).** The host forwards parent environment variables except
`NODE_OPTIONS`/`NODE_V8_COVERAGE`. So I ran the host *without* `publicationBarrier` and set
`GG_SCHEMA_PAUSE_FILE`/`GG_SCHEMA_RELEASE_FILE` to my own paths. The real producer paused before its
final rename while the real host ran its plain abort observer. My driver, not the host, decided when
to release. The PLAN (`PLAN.md`, mtime 2026-11-21T11:50:23Z) was written before any execution. The
driver started at 11:58:32.775Z.

Evidence tiers:

- **T1:** host self-report (`state.json` and stdout).
- **T2:** driver-native filesystem (lstat, readdir, raw bytes, SHA-256). A raw libuv `UV_FS_O_EXLOCK` open (share mode 0) proves no open handle.
- **T3:** driver `process.kill(pid, 0)`.
- **T4:** a scoped, owned, pre-warmed CIM probe (`drivers/cim-probe.ps1`). It queries Win32_Process by explicit PID or `ParentProcessId` of an owned host, plus TCP/UDP endpoints for owned PIDs. Read-only.

## Criteria results

| Criterion (brief / D190) | Evidence | Result |
| --- | --- | --- |
| **Pause before final rename:** final marker absent, complete closed sibling JSON, observer still waiting and SDK work unsettled; then release gives a valid record, abort, SDK settlement, child absence, schema cleanup and pending cleanup | **X1** (T2/T3/T4 + T1). Pause seen 180 ms after host spawn, released at +2029 ms. Two samples 1847 ms apart each showed: final marker `ENOENT`; sibling `schema-record.json.32588.<uuid>.pending` complete (838 B, SHA-256 `6c072827…d262`, unchanged, parses, pid = child); **EXLOCK open succeeded, so no open handle (closed)**; the SDK `gg-schema-OYrcNr/schema.json` still present with my 103 bytes, so SDK cleanup had not run and `run()` had not settled; child kill0 alive; host alive; no `state.json`; 0 B host stdout. CIM during the hold (ended at +913 ms process / +2010 ms network, both before release): child 32588 is `node.exe`, parent = owned host 9700, command line `exec --experimental-json … --output-schema <my schema path> --config "approval_policy=\"never\""`; the host's only non-conhost child is 32588; the child has no non-conhost children; 0 TCP / 0 UDP endpoints for host and child. After release: marker visible at +2059 ms with **bytes identical to the held sibling** (SHA-256 `6c072827…`); host exit 0 at +2082 ms with empty stderr; AbortError; `schemaPresentAtAbort` true; record deep-equal to the held sibling; `workSettled` true; host `childAliveAfter` false; schema dir removed; pending path absent; driver kill0 ESRCH (child and host); CIM empty for both PIDs and their children. **M7** (the maintained self-releasing barrier, T1+T2): window `finalMarkerExists:false, workSettled:false, pendingFileExistsAfter:false`, `pendingRecord` equal to the final record; no residue; child absent | **Met** |
| **Observer ENOENT and malformed JSON, separately:** abort, settle, report the original fault without masking it | **M8** (read): exit 1. Stderr carries the original `Error: ENOENT: no such file or directory, open '…\schema-record.json'` (stack at `sdk-schema-case.mjs:78:27`, errno −4058) and no AbortError text. State `observationError {Error, ENOENT}`, outcome AbortError, `workSettled` true, `childAliveAfter` false, schema dir removed, marker absent. **M9** (parse): exit 1. Stderr carries the original `SyntaxError: Expected property name or '}' in JSON at position 1 (line 1 column 2)` at `:78:21`. Marker bytes are exactly `{` (1 B). Same settlement and absence results. Both: driver kill0 ESRCH and CIM absent for host and child. **X3** (the one new independent negative): during my hold I created a **0-byte final marker** (the exact F3 open-before-write state) instead of releasing. The real observer, with no `observerFault` config, threw `SyntaxError: Unexpected end of JSON input` at `:78:21`, aborted and settled: AbortError, `workSettled` true, exit 1, original error in stderr and no AbortError text | **Met** |
| **Short + 226 success/error/abort:** strict schema bytes, 243/255 lengths, sentinels, parent environment, no extra external calls | **M1–M6:** host exit 0, no signal, empty stderr. **Success:** resolved `{"ok":true}`. **Error:** `Codex Exec exited with code 7: Controlled schema fixture failure`. **Abort:** AbortError with `schemaPresentAtAbort` true. `schemaText` is exactly my bytes. Directory names match `gg-schema-[A-Za-z0-9]{6}` directly under my TEMP. 226-char TEMP gives schemaDirectory **243** and schemaPath **255** (M4–M6). Before/after TEMP listings are identical in both host and driver views. All 5 sentinels (including `gg-schema-QAKEEP` inside the SDK namespace and one outside TEMP) are byte-identical. Driver TEMP/TMP/TMPDIR/HOME/USERPROFILE/APPDATA/LOCALAPPDATA/NODE_OPTIONS are unchanged, and `actualTemp` = my TEMP. The recorded SDK argv is exactly `--experimental-json --sandbox read-only --cd <root> --skip-git-repo-check --output-schema <path> --config approval_policy="never"`: no model, baseUrl, apiKey or other config. One record per case and no residue | **Met** |
| **The fixture proves its own termination, not just work settlement** | In every record-bearing case (M1–M9, X1), the host polls `process.kill(record.pid, 0)` after `await work` and reports `childAliveAfter:false`. The record pid is written by the child itself (`process.pid`). Independently, for all 11 children: driver kill0 ESRCH and CIM showed no process for that PID and no child of the dead host. In X1/X3 the identity was bound while alive (CIM parent = owned host, exact SDK command line) before absence was observed. Instrument control C2 shows both T3 and T4 detect a live owned process and then its absence | **Met, with limit O2** |

## Case ledger (run-01, each run exactly once; real native PIDs)

| Case | Host PID | SDK child PID | Exit / signal | Host ms | Final marker after |
| --- | ---: | ---: | --- | ---: | --- |
| M1 short success | 36680 | 20532 | 0 / null | 213 | 842 B `d9e63b13…` |
| M2 short error | 31544 | 12928 | 0 / null | 196 | 834 B `0cab30f2…` |
| M3 short abort | 29972 | 10236 | 0 / null | 226 | 834 B `ad6d41ac…` |
| M4 226 success | 7956 | 40356 | 0 / null | 237 | 1308 B `0dfb648d…` |
| M5 226 error | 43120 | 44668 | 0 / null | 233 | 1306 B `37fe242e…` |
| M6 226 abort | 44408 | 39104 | 0 / null | 194 | 1306 B `96d493ef…` |
| M7 maintained barrier | 21280 | 36704 | 0 / null | 247 | 838 B `ad82464d…` |
| M8 observer ENOENT | 31696 | 42052 | **1** / null (expected) | 231 | absent (host unlinked it) |
| M9 observer malformed | 19068 | 30656 | **1** / null (expected) | 194 | 1 B `{` |
| X1 external hold → release | 9700 | 32588 | 0 / null | 2082 | 838 B = held sibling |
| X3 external hold → 0-byte marker | 32760 | 22560 | **1** / null (expected) | 2189 | 0 B (injected) |

Other owned PIDs:

- driver 38176
- CIM probe 45964 (stopped by its stop file, exit 0)
- C2 sleeper 43556 (killed via its owned handle, close `SIGTERM`)
- conhost.exe children of the X1 host and child: 44528, 31812
- conhost.exe children of the X3 host and child: 17400, 33364

Per-case `result.json` files hold every check and observation. They also include the exact spawn
command, cwd and environment, before/after listings, sentinel hashes and a full root manifest.
`host-stdout.log`/`host-stderr.log` and the top-level root files are preserved under each case.

## Controls

- **C1 EXLOCK instrument:** with a normal handle held, the EXLOCK open failed `EBUSY`. After close it succeeded. So the X1/X3 "closed" checks were scored as criteria.
- **C2 kill0/CIM instrument:** an owned `node -e` sleeper (PID 43556) showed kill0 alive and CIM parent = driver 38176 with its marker in the command line. After its owned-handle kill it showed ESRCH and CIM empty.
- **Positive and negative behavior controls:**
  - M1–M7 and X1 are positive.
  - M8, M9 and X3 are negative. Each declared exit 1 with the original error, with abort, settlement and absence.
- **Old-source counterfactual not re-run.** The author's controlled old open-before-write case (parse failure, exit 1, helper already absent) remains the author-controlled observation. X3 covers the F3 input against the *corrected* observer only.

## Maintained tier

`pnpm --filter @graphgoblin/adapter-codex exec vitest run src/sdk-schema.test.ts --reporter=verbose`
ran once with TEMP/TMP/TMPDIR = `G:\ggq\qa-scratch\i4-363-marker-qa\vitest-01\tmp`: **9/9 passed**,
exit 0, 3.24 s. The test's own roots were removed, leaving TEMP empty (`maintained-vitest-01.log`).
Overlap: maintained tests 1–9 cover the same scenarios as M1–M9, but with their own config. X1
overlaps M7, and X3 overlaps M9, by criterion only.

## Observations (non-blocking, recorded for the separate review/coordinator)

- **O1:** `publicationWindow.observerWaiting` is the literal `true` in source. The host's T1 evidence for "waiting" therefore comes only from where it is recorded in the loop. X1 provides the independent native evidence that the observer was waiting and the work unsettled.
- **O2:** The host checks child termination and schema-directory cleanup **only when a record was parsed** (`if (record)`). In X3 (empty marker) the host reported AbortError and settlement, but `record`, `childAliveAfter` and `schemaDirectoryExistsAfter` were all `undefined`, as predicted. Child absence and schema cleanup there come only from my driver (T2/T3/T4). The maintained fault controls avoid this by pre-reading the record before injecting the fault. The atomic producer should not itself produce an empty or partial final marker. D190's requirement (abort and await settlement on observation failure) was met.
- **O3:** When the child is terminated while paused before rename (X3), the CLI's `finally` does not run. Its `.pending` sibling and the pause file therefore remain in the case root, not in TEMP, as predicted. This needs the test-only barrier plus an external fault; the maintained `afterEach` removes roots.
- **O4:** Under this launcher, each host node and SDK child node had a `conhost.exe` child. All were gone after exit: the post-exit CIM `ParentProcessId` queries for each host and child returned empty, scored as an observation check. The final sweep did not target conhost PIDs.

## Gaps and limits

- I do not claim any natural OS race, observed orphan or probabilistic reproduction. Each case ran once, with no retries and no repetition loops. The author's preserved first-harness assertion failure (expecting the old helper alive) and the original Astra CHANGES_REQUIRED stay as recorded.
- kill0 cannot prove identity on its own and is conservative under PID reuse. CIM is point-in-time. The host never has a public `ChildProcess` handle, because the SDK owns the handle and calls `removeAllListeners()`. I did not inspect live handles.
- Network evidence: TCP/UDP endpoint queries (point-in-time) for the host and child exist only for the X1/X3 holds. For M1–M9, "no extra external calls" rests on the exact SDK argv, the `node.exe` child identity, the harmless fixture source and the absence of a provider configuration.
- The hold window is bounded by the host's unchanged 3000 ms observer deadline (actual holds: 1849 ms in X1, 1965 ms in X3).
- Not run here: typecheck, lint, coverage, build, the full adapter suite, CI, native Codex or provider, and non-Windows hosts. These stay with the author, CI and the root.

## Deviations and slips (truthful record)

1. During preflight, a `git diff … > /tmp/qa363-commit.diff` wrote one transient file to Git Bash `/tmp` (= `C:\Users\98jak\AppData\Local\Temp`, outside the G: task scratch). I deleted it in the same command and verified it was absent.
2. The `cmd=` header in `finalize-scratch.log` mislabels that process's environment. Actual: `TEMP=<this evidence dir>`, and TMP was inherited from the Bash tool wrapper. The script makes no temp files. The log was not overwritten.
3. The Bash tool wrapper exports the system TEMP/TMP for each shell. All QA node processes (driver, hosts, SDK children, probe, vitest) received explicit G: overrides. The read-only inspection commands (git, sha256sum, PowerShell syntax check and post-vitest sweep) ran with the wrapper defaults.
4. Before the driver ran, I ran plain `git status` several times in the QA worktree; this may refresh the index's cached stat data, with no content change. The driver used `--no-optional-locks`. HEAD, index and status were unchanged at the end.
5. The driver process exited about 15 s after writing its ledger (11:58:57.7Z → 11:59:12.8Z), because an un-cancelled 15 s `stopProbe` race timer kept it alive. The probe had already closed with exit 0 at 11:58:57.7Z. This had no effect on the evidence.

## Cleanup (scoped, owned only)

- **Processes:** no host or child needed a kill; every case exited on its own. The only kill was the C2 sleeper, by its owned handle. The probe stopped itself via its stop file.
- **Final driver sweep:** by PID for all 23 recorded non-probe PIDs, plus a scratch command-line filter. Zero remaining case or child processes. The only matches were the wrapper `bash.exe` chain and the driver itself. The post-vitest sweep likewise found only this call's own wrapper chain.
- **Ports:** 4747/4748, owner services and stores, home, credentials and the author checkout were untouched.
- **Scratch:** `drivers/finalize-scratch.mjs` verified the realpath and found no reparse points. It manifested 203 entries (129 files) to `scratch-manifest-final.json`, copied the 35 raw probe request/response files to `run-01-probe-raw/`, then removed only `G:\ggq\qa-scratch\i4-363-marker-qa`. Sibling scratch directories, including the author's `i4-363-marker`, were untouched.
- **QA checkout:** left detached and clean at `b1cdd204` (`post-checkout-state.txt`).
- **Preserved packet:** `i4-363-sdk-independent-02` is byte-unchanged; its 139-file hash lists before and after are identical, `940cba74…78c`.

## Hashes (SHA-256)

Drivers:

- `drivers/qa-driver.mjs`: `178cfda51ec840cd5a84ee91004cade0a67c1754855f9afee7495bf5b412a816`
- `drivers/cim-probe.ps1`: `01c2d460798f503566b3353bf954f977dcaf25c6a478ebbcfec48b454a59f82b`
- `drivers/finalize-scratch.mjs`: `54414046fdfd48dcf3b161baffe608f8e31f22a7642793a11c8a854a0cfb7e3f`

Key artifacts:

- `PLAN.md`: `4b9ade3a3f1dde07b5f00a980fc68f7179492374e369635566cbb84638642399`
- `run-01/summary.json`: `0331bf3a7eaee9b4e15b7a1f6ef9ba20dc5f797fc40ec7ad9b7d74f44e663bbe`
- `run-01/ledger.json`: `11c75c0a0e3f60abc011237c363deb157953987bf3033cd79785ba4992d846e0`
- `run-01/preflight.json`: `26d9f305a6d99f78bfc84c935b1d8c7627f57b429548480c227a9ca903680791`
- `X1 result.json`: `73b2bec34d4f329b2ff8b255faa05fa5d5ed1d9daafc89c30427aeecba1d0aa6`
- `X3 result.json`: `0e373719c032a2ee4c9eb0158957d56bf52f119a73f7d021ac9e222d0b1da75e`
- `maintained-vitest-01.log`: `97bf6cc1c511f479371b7dc5b4f4f519d178f383f6cc7fc98e211f81b4e292a6`

`SHA256SUMS.json` lists every file in this packet except itself and the harness-owned `provider/` directory.

Commands:

- `run-01.command.txt`: the driver command.
- `maintained-vitest-01.log`: the pnpm commands.
- `finalize-scratch.log`: the cleanup command (header caveat in deviation 2).

## Status of other gates (unchanged by this QA)

- The original three general-scan outcomes stand. Astra final scan 3 remains **CHANGES_REQUIRED** (F3), preserved unchanged.
- The actual Fable bounded corrective review runs separately.
- Fresh exact-head/current-target CI, canonical native artifact verification and explicit coordinator completion remain open.
- No Astra re-sign-off, merge or acceptance is inferred.
- Issue #363 and PR #550 were not touched.

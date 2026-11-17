# Independent assessment: native behaviour QA 05 (receipt `c8bc55ca…`)

**Result: QA 05 is not a QA pass. The execution stopped partway through.** The driver halted at S4 `run-admitted` (one unmet criterion out of 142 recorded). The cause is the QA driver's own request, not the product: the driver started the draft run without the draft's `versionId`, and the docs say that returns 404. Every executed product check met its criteria, including the hostile-locale cold launch, which now passes. S5–S7 and S9 never ran, S8 was not admitted, and no fixture manifest exists. I am not claiming merge readiness.

I only read files: no repository, evidence, Git, remote, configuration or credential changes, no subprocesses, and no GUI action.

Citation roots used below:
- `R/` = `launcher/macos-independent-qa-transport-correction-05/receipt-c8bc55cacb944f7985574643b8fc2346/`
- `E/` = `R/evidence/`
- `D:` = line numbers in `launcher/macos-independent-qa-execution-preparation-03/gg456-native-qa.mjs`

## 1. Execution identity and transport/driver status

**Identity.** `R/admission.json` and `R/binding.json` record:
- head `18089bba…`, tree `c6781a4d…`, base `6d7fcc98…`
- build `6389524e…`, build result `2fe2c657…`
- driver `9be9a517…`, binding `5d4dbb98…`
- local/remote invoker `bccabc32…` / `61b02410…`
- run ID `7c5ae3c2`, ports 62241/62242, Node 22.22.2 `e67e9c66…`, macOS 26.6.2

The worktree branch ref is `18089bba…`, so the API source I read is the candidate's. On the Mac, the driver re-hashed itself, Node, the eight built files and the launcher source digest before acting (`D:842-857`; `E/admission.json`). Admission recorded `onStop: drain` and **`includeNodeMove: false`**.

**Transport** (`R/ssh-result.json`):
- SSH exited with code 1, no signal, at 22:15:08.905Z, with the upload finished.
- stdout was 132,261 B (cap 117 MB) and stderr 0 B; both streams reached EOF with no overflow.
- `launch.json` (exit `null`) is the pre-exit spawn record, so its null exit is not a contradiction.

**Driver** (`R/remote-result.json`):
- PID 49402 ran from 22:13:33.474Z and exited with code 1, no signal, at 22:15:08.803Z.
- Both streams reached EOF (stdout 216 B, stderr 0 B); `stop: null`, `killSent: false`.
- Descendants were "not inspected".

**Validation.** `R/validation.json` has `failure: null` and status `driver-and-evidence-captured`. That status covers:
- frame magic and a SHA-256 per frame
- name and size caps
- token/head/build/binding/driver binding
- `transportCode` equal to the SSH exit code
- evidence count and bytes, and scope and stage paths (`invoke-qa.mjs:133-166`)

There are 98 files totalling 116,281 B, and they match the local directory (13 named and 85 numbered).

**Per-process records.** All 29 persisted process records show an exit, `signal: null`, both EOFs, no overflow and no timeout. The only non-zero exits are `lsof` on 4748 returning 1 with no listener, which the driver accepts (`D:336`). Not persisted by design: the raw `ps -E` output (only `rawSha256`), process tables, and the drain exit poll (sequence 0046).

**Capture success versus product success.** Transport capture is complete and digest-verified. Exit code 1 is the driver's not-a-pass signal (`D:1399`), not a transport fault. The driver status is `stopped` with `unmet: 1` (`E/result.json`). This is not a QA pass.

## 2. Stages and assertions

| Stage | Status | Checks met | Key evidence |
|---|---|---|---|
| S0 | criteria met | 2/2 | `E/stage-S0-…json`; one pre-existing stage residue |
| S1 | criteria met | 25/25 | `E/stage-S1-…json`, `E/0008-install-a.*` |
| S2 | criteria met | 37/37 (21 hard, 16 soft) | `E/stage-S2-…json`, `E/0014`–`0019` |
| S3 | criteria met | 63/63 | `E/stage-S3-…json`, `E/0031`–`0043` |
| S4 | stopped after 9 ms | 1/2 | `E/stage-S4-…json` |
| Recovery | criteria met | 13/13 | `E/stage-R-recovery-drain-62241.json`, `E/0044`–`0047` |

### Product failures

None were observed in any executed path.

### Unmet criterion: S4 `run-admitted` (hard) — a driver/oracle defect, not a product failure

- `loop-created` returned 201 with `issues: []`. Then `POST /loops/{id}/runs {allowDraft:true}` returned **404 `LOOP_NOT_FOUND`**.
- `POST /loops` creates a draft-only loop with `currentVersionId: null` (`packages/infrastructure/src/sqlite/loops.ts:163-182,565-571`).
- The run route uses `body.versionId || loop.currentVersionId` (`apps/api/src/routes/runs.ts:96`). With no version ID, the engine looks for a published version and throws `LOOP_NOT_FOUND` "…has no published version" (`packages/engine/src/run-manager.ts:3362-3371`).
- The docs state exactly this behaviour and the correct request:
  - `docs/guide/03-run-and-observe.md:74`: "A loop with no published version returns 404 `LOOP_NOT_FOUND` … supply the draft's `versionId` … and set `allowDraft` true."
  - Also `docs/07-api-and-streaming.md:626` and `docs/guide/07-troubleshooting.md:252`.
  - The MCP tool passes the draft ID explicitly (`apps/mcp/src/tools.ts:161-168`).
- The driver omitted `versionId` (`D:1073`), and case-map C1 has carried that wrong binding since preparation 01/02. It was never exercised before because QA02 and QA03 both stopped in S2.
- **Evidence limit:** the check kept only the status and code, not the problem detail text, so the exact branch is inferred from source and docs rather than observed.

### Unexecuted paths

- **S4 remainder:** waiting run, no provider process, drain with an active run, relaunch as a new process, run retention, completion, loop retention, idle drain.
- **S5:** aliased-store install and concurrent A/A/B cold launch.
- **S6:** foreign listeners.
- **S7:** shell-held store, `store-blocked` timing and the launcher record.
- **S8:** moved runtime. It was not admitted, so even an uninterrupted run would not have covered it.
- **S9:** stopped fixture, manifest, owner diff, crash-report diff, and end-of-run checkout integrity.

### Oracle and fixture limitations

1. **S5 soft check will fail for a known reason.** `identical-saved-configuration` (`D:1124`) compares raw config bytes. Commit 18089 deliberately made key order arbitrary ("Configuration readers ignore member order", `apps/macos-launcher/Engine/Installation.swift:112-120`). The three retained configs show three different key orders at the same 332 bytes and identical values (`E/installed-a.json`, `installed-a-nfd.json`, `installed-a-case.json`). This soft check is therefore expected to fail as an oracle artifact, not a product defect.
2. **The "independent" fingerprint borrows one product value.** It uses the data directory as saved by the product (`D:937`). It is independent of the gateway, but not of the installer for that one value.
3. **The executables under test are not the pinned build products.** Each public install compiles a new executable (`718a…`, `b42f…`, `b6c5…`, each 725,576 B). None is the pinned build artifact (`a457a2…`, 725,816 B, `binding-readback.json`). Identity rests on the launcher source digest plus the receipt. This is expected; it is not a defect.
4. **Observation, with no criterion attached.** For the not-yet-existing store, the installer saved the data directory in NFD form (`…75cc88…`, `dataDirectoryBytesEqualInput: false`), and the API created it with that spelling. Behaviour is consistent across S1, S3 and the API. A shell user who types the NFC spelling is untested, and S7 would reuse the saved NFD value, so it won't test it either.

### Area-by-area assessment

**Lifecycle (established).**
- The launcher exits 0 in 1,591 ms cold and 424 ms warm.
- The gateway is detached: parent PID 1, `Ss`, its own process group, no tty, stdio `/dev/null`, cwd the canonical checkout.
- It survived launcher exit and two in-place updates.
- The recovery token drain returned 202 `draining`, never forced, and the port was refused at 253 ms with leases free and store-state `{"state":"free"}`.
- Survival after the SSH session ends is not exercised.

**Environment isolation (established).** The gateway environment is exactly the 13-name closed set (`E/cold-gateway-environment.filtered.json`):
- no canary values or canary-only names
- `HOME` from the password database
- `LANG=en_US.UTF-8`, and `LC_ALL` absent
- saved options override the canaries (`127.0.0.1`, port 62241, `false`/`false`)
- the exact NFD `GG_DB_URL`
- a log admission bound to `LauncherInstances/07d755df…`, inode 179124508

**Spelling and update (established).**
- Both the NFD spelling and, on the proven case-insensitive volume, the case variant were managed in-place updates.
- Each kept ID `07d755df…` and produced a new generation: inode 179124463 → 179125587 → 179126587.
- The receipt is settled and there is no new stage residue.
- The gateway's PID, birth, fingerprint and lease hashes were undisturbed, and the warm launch reused it.
- These are name-spelling variants, not Finder aliases.

**Not covered by this suite:** the real wait-run drain and retention, aliased-store contention, foreign listeners, the shell-held store, the moved runtime, and final disposition.

## 3. Hostile-locale cold launch

**Yes, it now passes on 18089/build05.**
- Environment (`E/0014-cold-canary.json`): `LC_ALL=ggcanary4ed4f295d57b`, `LANG=…/not-a-locale`, `HOME` unset, plus the full hostile set.
- Launcher PID 49524 exited 0 with both EOFs, 0 B on stderr, and the exact 60-byte envelope `{"version":1,"code":"open-management-running","port":62241}`.
- The gateway received the log admission document with unsorted members, so the formerly crashing path ran (`Diagnostics.swift:264-273`).
- All 37 S2 checks were met, including byte-exact shells and both entry assets (`/app/assets/index-C5U89dQm.js` matched), which is where QA03 stopped.

This is one observation. It is the only malformed-locale coverage in this suite:
- All installer runs used `LANG=en_US.UTF-8` (`E/0008`, `0031`, `0036`).
- S5's concurrent launches would use the normal environment (`D:881`).

Malformed-locale public install and concurrent malformed-locale cold launches are covered only by separate engineering acceptance 04:
- Its manifest records `installerLocale {LANG: en_US.UTF-8, LC_ALL: ggcanary17544768eaef}`.
- `004-public-install` exited 0 with both EOFs, the exact 43-byte installed text, and empty stderr.
- That record has no environment field. Binding the locale to that invocation rests on `tooling/scripts/macos-launcher.acceptance.mjs:708-711`.

## 4. Fixture disposition

**No `fixture-manifest.json` exists** (`E/result.json`: `fixtureManifest: null`). The observe and drain follow-up modes refuse to run without a `stopped-verified` manifest (`D:1427`). Fixture `7c5ae3c2` cannot be reused:
- its scope exists, which fails admission (`D:885`)
- there is no manifest
- the store holds a draft loop "QA wait 7c5ae3c2" whose ID was not retained

**Last evidenced state** (around 22:15:08.4–08.8Z):
- **App A:** `~/Applications/GraphGoblin QA ü-7c5ae3c2.app`, device 16777232, inode 179126587, ID `07d755df2eb34488b8154d8d88044f68`, executable `b6c5299b…`, config `4f08dab9…`.
- **Receipt:** `…/LauncherInstalls/07d755df….json`, inode 179126596, SHA-256 `33551f86…`.
- **Log directory:** `…/LauncherInstances/07d755df…`, inode 179124508.
- **Scope:** `~/Library/Caches/graphgoblin-456-qa-7c5ae3c2`, containing:
  - `evidence/`
  - `links/QA checkout ü 漢`
  - the NFD store with leases free and helper `free`
  - the scope's own inode, which was never recorded
- **Transport stage:** `~/Library/Caches/graphgoblin-456-qa-transport-c8bc55ca…`.

**Never created:** app B, B's receipt, the data alias, the contender, the runtime copy, and any aliases.

**Unknown:**
- this fixture's lock anchors
- LaunchServices registration
- the gateway log size after S2
- any process, port or store state after 22:15:08.8Z

The last positive process evidence is that PID 49530 was released. Port 62242 was checked only at admission.

**Pre-existing items, not from this run:**
- Stage residue `.graphgoblin-launcher-stage-0669c5da…`, inode 179009292. Its mtime of 21:59:59.074Z matches crash diagnosis 02.
- Three earlier QA apps, with their receipts and log directories.
- Two GraphGoblin crash reports.
- Owner listener PID 76881 on 4747, unchanged through S1 only.

**Would a successful manifest support moving to GUI observations?** It would be necessary but not sufficient. It is written before the S9 integrity wants (`D:1365-1371`), carries `notAPass: true`, and is a single snapshot in time. GUI work would also require:
- a `completed-all-criteria-met` result, or root's explicit acceptance of each unmet want
- a root hash-bound manifest
- a fresh observe immediately before each step
- the plan's prerequisites: B1, O0–O10, G0/G1, plus B2 hosted CI on the exact head for anything left to Swift tests

## 5. Smallest remaining GUI engineering sequence (owner physical input)

Each step should be bracketed by SSH observe and agent drain. G1 `open` is a readiness check only, not Finder or Dock evidence.

1. **G2 — Finder double-click, cold.**
   - Expect: a new gateway born after the click, with the manifest fingerprint and the closed environment under launchd.
   - The default browser connects to `127.0.0.1:P` within 10 s, and the launcher exits within about 11 s.
   - The owner sees one `/app/` tab.
2. **G3 — second double-click.** Expect the same PID and birth.
3. **G4 — real Finder alias.** Confirm it is an alias, not a symlink; the executable from A launches; same gateway.
4. **G5 — pin A to the Dock, then cold Dock click.** After a verified drain, the click gives a new PID born after the click.
   - Run retention and drain are objective once a corrected S4 passes, so the run/stop/history portion should not be re-tested in the GUI.
5. **G6 — retained pin and alias.** After an agent's same-path public update (new inode), click the existing Dock pin: no "?" icon, the launcher's text segment maps to the new generation, and a tab opens. Then double-click the alias made before the update once.
6. **G9 — remove the pin.** Then run X1 verified cleanup only on root authorization.

**Include only if root wants native routing evidence:** G7a (Dock reopen during a store-blocked wait raises the same panel with no second attempt) and one G8 Show Log in Finder. Key permutations, Quit permutations and accessibility details stay with the Swift tests, provided B2 actually runs them.

**Post-merge owner acceptance P1–P4 is separate.** It is tracked on #456/#326, and agent evidence cannot complete it.

## 6. Next step for the failed scenario (not authorized here)

1. **Driver correction (root-authorized).** Change only the S4 start body to the documented `{ versionId: made.json.draft.id, allowDraft: true }` and fix C1. Optionally retain the problem `detail` on 4xx responses.
2. **Fresh binding.** Bind a new run ID and token, and re-verify both ports.
3. **Pre-decide the S5 soft check.** Before rerunning, root should decide either to correct `identical-saved-configuration` to exact-value object equality or to accept its expected failure. Do not silently relax it.

**Status of other gates:** no CI has run at this source; the Swift coverage policy (no branch counters, no native waiver) is still open; and this assessment neither consumes, replaces nor resets the 2/3 formal-review budget or the final Astra scan.
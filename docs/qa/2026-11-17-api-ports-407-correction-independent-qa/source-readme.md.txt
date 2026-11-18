# #407 correction 01: independent behavior QA (Claude Opus 5.5, xhigh)

Role: independent behavior QA of the bounded D1/D2 correction. This is not a formal review scan or a merge approval. The #503 audit decision is still pending, and this QA does not waive it.

Result: **no defect found in scope.** On this Windows host, D1 (wildcard foreign listeners) behaves as corrected. D2 (spurious mkdir errors under two-worker contention) did not occur in a bounded native contention run. The real built API regression witness for held reservations through child bind, restart and settlement passed. The single coherent native witness passed on its first run, so no harness correction was used. POSIX behaviour remains pending hosted CI.

## Identity and provenance

- QA tree: `C:/Users/98jak/.codex/worktrees/gg-20261117-ports-407-qa/GraphGoblin`, HEAD `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1` plus the copied frozen correction.
- Frozen hashes: all 14 entries (13 sources plus `apps/api/dist/main.js` `3160AC2A…5325C`) match `corrected-frozen-sources.json`, both before QA (`01-sources-before.json`, 05:52Z) and after cleanup (`05-sources-after.json`, 06:08Z). Implementation-root paths are mapped onto the QA tree by `scripts/hash-sources.mjs`. The manifest's own SHA-256 `76c87372…c862` matches the value recorded in `corrected-frozen-verification.json`. `git status` and `git diff --stat` after QA are byte-identical to before (`01-git-status-before.txt`, `05-git-status-after.txt`).
- Host (`04-host-facts.txt`): Windows 10.0.26300.9974, Node v22.23.4 (the project runtime, first on PATH), `pnpm.cmd` 12.8.1, Vitest 5.0.3. The host TCP dynamic range is 49152-65535. Its excluded port ranges do not cover 63800-63819.
- No install or build was performed. The existing build was accepted only after its hash matched.
- Ordering:
  1. I read the brief, AGENTS.md, docs/README.md, docs/15, the original QA report, the original provider public report and the corrected README.
  2. I recorded the criteria (`00-criteria.md`, 05:51:48Z).
  3. I read the implementation (`api-port.ts`, the setup files, the unchanged fixture, and the docs and CHANGELOG diffs).
  4. I recorded the scenario design (`02-scenarios.md`, 05:57:40Z).
  5. I wrote the witness code (from 06:00Z) and ran it (06:05:55Z-06:06:17Z).

  I did not read the author's `api-port.test.ts`, the caller test diffs, or any author witness script or log, at any point.

## Exact commands and exit codes

| Step | Command (cwd) | Exit |
| --- | --- | --- |
| Source hashes, before | `node <ev>/scripts/hash-sources.mjs <ev>/01-sources-before.json` (QA tree root) | 0 |
| Port preflight | `node scripts/probe-ports.mjs preflight` (evidence folder) → `03-ports-preflight.json` | 0 (60/60 binds ok, no listeners) |
| Harness static check | esbuild transform and a filtered `tsc --noEmit` (`03-harness-static-check.txt`) | Syntax ok. 4 type-only `exactOptionalPropertyTypes` complaints in the QA files |
| **Native witness r1** | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-witness.ps1 -Run r1-witness`, which runs `pnpm.cmd exec vitest run --reporter=verbose --maxWorkers=2 src/qa407c/` in `apps/api` (receipt `r1-witness/vitest.json`, log `r1-witness/vitest.log`) | **0**: 2 files, 8/8 tests |
| Source hashes, after | as above → `05-sources-after.json` | 0 |
| Final ports / processes | `node scripts/probe-ports.mjs final` → `06-ports-final.json`; `scripts/node-procs.ps1` → `06-node-procs-final.json` | 0; 0 QA node processes |
| Offline D2 re-derivation | `node scripts/reanalyze-d2.mjs r1-witness` → `07-d2-offline-reanalysis.json` | 0 |

The witness used the actual `apps/api/vitest.config.ts`, including both global setups and `api-ports.setup.ts`, with `pool: forks` and two workers. TEMP and TMP were redirected to a QA-owned empty folder (`work/r1-witness/tmp`), so the run's `gg-api-ports-*` root could be observed. The run also set `GG_TEST_PORT_START=63800` and `GG_TEST_PORT_COUNT=20`. Both workers reported the same injected root, `…\work\r1-witness\tmp\gg-api-ports-hSoxht`, from different pids (52708 and 30536). Witness sources are preserved in `qa-tests/`.

## Criteria and results

| ID | Criterion | Result | Kind | Evidence |
| --- | --- | --- | --- | --- |
| K1 | Foreign listener on `0.0.0.0`, Node default `listen(port)`, explicit dual-stack `::` or `127.0.0.1` is never granted; the sentinel is preserved | **PASS** | native | `r1-witness/D1-B-result.json`. Single-port reservations of 63804-63807 are each refused with the exhaustion error. 20 range scans of 63804-63810 returned 63808 ×13, 63809 ×1 and 63810 ×6, never 63804-63807, and none failed. All six sentinel processes stayed alive and afterwards answered `foreign:<mode>:<their own pid>`. All exited 0 without being forced. |
| K2 | Probe listeners are closed when the grant returns | **PASS** | native | After the grant on 63810, fresh `127.0.0.1`, `0.0.0.0` and `::` binds all succeeded. |
| K3 | Real built API skips a foreign `0.0.0.0` port, and IPv4 loopback traffic still reaches the foreign listener | **PASS** | native, real API | `K9-A-result.json`. The fixture on range 63802-63803 got 63803. While the API child ran, `127.0.0.1:63802` returned `foreign:0.0.0.0:45652` and `127.0.0.1:63803/loops` returned the API's 401 problem JSON. The foreign sentinel was alive and answering at the end and exited 0. |
| K4 | D2: two real workers contend for one port with distinctive ownership; zero duplicate live grants and zero unexpected filesystem errors | **PASS** | native | See the D2 section. |
| K5 | A stale or repeated release, or a release after marker replacement, never changes the replacement; the port stays reserved | **PASS** | a: native; b, c: controlled | `GEN-B-result.json`. a: L1's repeated release resolved and left generation 2 (live UUID) byte-identical; the port stayed reserved. b: after the lease's own UUID was replaced inside generation 1, `release()` rejected `ENOENT` (rename), and the replacement stayed in place with no `released` marker; the port stayed reserved. c: generation 1 was removed externally and re-issued to a new lease with a new UUID. The stale release rejected `ENOENT`, the new marker was untouched, the port stayed blocked, and the new owner's release resolved. |
| K6 | A crashed or incomplete newest generation stays reserved | **PASS** | a: native, cross-process; b: controlled | a: worker B abandoned a lease on 63814 (the same on-disk state as a crashed holder), and worker A (pid 52708) was refused on 63814 (`K6a-A-result.json`). b: generation 1 `released` with an empty generation 2 was refused, and no generation 3 was created. |
| K7 | Genuine ACL/permission errors stay visible | **PASS** | native Windows ACL | `ACL-B-result.json`. a: with `icacls <slot> /deny <user>:(AD)` active, the reservation rejected with the raw `EPERM: operation not permitted, mkdir '…\63817\2'`, which was not treated as exhaustion. After `/remove:d` it granted generation 2 again. b: with AD denied on a held generation, `release()` rejected with raw `EPERM … rename '…\<uuid>' -> '…\released'`. The second call returned the same promise and the same rejection; nothing was retried. The `icacls` outputs show each `(DENY)(AD)` ACE and its removal. |
| K8 | Numeric generation order | **PASS** | native + controlled | Native D2 ran to generation 979 contiguously, crossing 9→10 and 99→100. Controlled: with generations 1-10 all released, the grant was generation 11, and it released cleanly. |
| K9 | Held from grant through child bind, kill and restart, released only after settlement | **PASS** | native, real built API | See the K9 timeline. |
| K10 | Global teardown removes the run-owned root after the workers stop; no leaks | **PASS** | native | The redirected TEMP was empty immediately after the run (`r1-witness/temp-after.json`, 0 entries), including the abandoned-lease and ACL-touched generations. There were 0 QA node processes (`r1-witness/processes-after.json`), and the after and final port probes were ok. |
| P1-P4 | Hashes, ports, budget, controlled vs native | **PASS** | process | 14/14 hashes before and after; ports 63800-63819 only, with preflight and final ok; one witness run and 0 harness corrections; kinds listed per row. |

### D2: two-worker one-port contention (port 63800, 8 s per worker, fully overlapping)

From the raw per-worker logs `r1-witness/D2-grants-{A,B}.json` and `D2-summary-{A,B}.json`. The in-test merge is `D2-analysis.json`, and the independent offline re-derivation is `07-d2-offline-reanalysis.json`.

| Measure | Worker A (pid 52708) | Worker B (pid 30536) | Total |
| --- | --- | --- | --- |
| Reservation attempts | 3,701 | 3,569 | **7,270** |
| Grants | 498 | 481 | **979** |
| Exhaustion refusals | 3,203 | 3,088 | 6,291 |
| Unexpected reservation errors | 0 | 0 | **0** |
| Release errors | 0 | 0 | **0** |
| Harness filesystem errors | 0 | 0 | 0 |

- Distinctive ownership: each grant recorded the worker role and pid, the generation, its UUID marker and QPC times (`process.hrtime.bigint()`) at grant, release call and release completion. At grant and again just before release, the slot's newest generation had to contain exactly that worker's single UUID. After release, the worker's own generation had to contain exactly `released`. All 979 grants passed all three checks.
- Exclusivity: there were 979 unique generations and 979 unique UUIDs with no duplicates, contiguous 1..979 on disk, every one ending as `released`. Every generation has a grant, and every grant has a generation on disk. Of 239,538 cross-worker pairs, none had overlapping `[grant, release call]` intervals. Generation order equals time order. There were 960 cross-worker handovers, with a minimum handover gap of 4.62 ms.
- Informational: one pair overlaps on the wider `[grant, release completion]` window (`07-d2-reldone-overlap-detail.json`). A's grant of generation 819 came 6.83 ms after B's release call for generation 818, and 0.126 ms before B's own rename callback resolved. That is causally consistent: generation 819 can only be created after `818/released` exists. It is not a double grant.
- Bounded latency: maximum refusal 21.19 ms; maximum grant 28.87 ms.
- Original record, raw only (the original N6 protocol with deletion): 25 `EPERM` mkdir errors across 17,490 attempts and 1,881 grants. The harnesses differ (this one does on-disk ownership checks per grant), so I derive no rate comparison. The structural point holds: the corrected protocol never deletes a directory during the run, so the delete-pending `EPERM` path the original QA identified is absent, and the native count here was zero.

### K9 timeline (real built API; QPC ms relative to A's `dispose()` start)

| Event | Time |
| --- | --- |
| Fixture reserved 63803 with no child started; B refused (exhaustion) although `127.0.0.1:63803` was bindable | before child bind |
| child1 ready; A SIGKILLs it; `listening(63803)` false; B refused although bindable | while stopped |
| child2 ready on the same port 63803 (authenticated readiness); B refused | after restart |
| A `dispose()` starts | 0.00 |
| B refused (exhaustion) | +6.70 |
| B refused (exhaustion) | +20.94 |
| A's child2 `close` | +22.13 |
| A's `dispose()` resolves | +32.86 |
| B wins 63803 (`127.0.0.1:63803` not listening at win; B's release resolved) | +35.34, i.e. 13.21 ms after child close |

All polling attempts were exhaustion refusals and none were unexpected (`K9-B-result.json`, `K9-B-attempts.json`, `K9-A.jsonl`, `K9-B.jsonl`).

## Native bind matrix on this host (context for D1, `D1-B-result.json`)

| Foreign listener | `127.0.0.1` bind | `0.0.0.0` bind | dual-stack `::` bind | Helper |
| --- | --- | --- | --- | --- |
| `0.0.0.0` | ok | EADDRINUSE | ok | refused |
| default `listen(port)` (`[::]` dual) | ok | ok | EADDRINUSE | refused |
| explicit `::` dual-stack | ok | ok | EADDRINUSE | refused |
| `127.0.0.1` | EADDRINUSE | ok | ok | refused |
| `::` ipv6Only | ok | ok | ok | granted (observation) |
| `::1` | ok | ok | ok | granted (observation) |

Each probe detects only its matching form, so all three serial probes are needed. Under the original 127.0.0.1-only probe, the first three rows would have been granted. This confirms that K1 discriminates the correction.

## Controlled faults vs native proof

- Native proof: K1, K2, K3, K4, K5a, K6a (cross-process), K7a, K7b (real Windows ACLs), K8 (D2 generations to 979), K9 and K10.
- Controlled (QA injected state into the run's own coordination root): K5b (marker replaced in place), K5c (generation removed externally), K6b (incomplete newest generation), K8 (generations 1-10 pre-created).
- Not exercised natively: the IPv6-unavailable fallback, because IPv6 is available on this host. By static read only: `::` is probed last, after both IPv4 probes; `EAFNOSUPPORT`, `EPROTONOSUPPORT` and `EADDRNOTAVAIL` count as "no conflict" only for `::`; every other error, and every IPv4 error, rejects. The author's fallback evidence remains controlled-fault evidence.

## Defects

None found within the brief's scope.

## Observations (not defects)

1. A failed release is final for the run (K7b). `release()` memoises its rejection, and after the cause is removed a further call still returns the same rejection, so the generation stays reserved for the rest of the run and `fixture.dispose()` would keep rejecting. This is visible and conservative, matching "no source retry". On a narrow range, one release failure can exhaust that range for the run.
2. A crashed or abandoned holder keeps its port for the rest of the run, also across processes (K6a). This is unchanged from the original O2.
3. IPv6-only `[::]` and `[::1]` foreign listeners are granted. They do not receive `127.0.0.1` traffic: both sentinels still answered on `::1` afterwards, and the fixture uses `127.0.0.1` literally. A client that resolves `localhost` to `::1` would reach them instead.
4. On this host a dual-stack `[::]` bind succeeded beside a foreign `[::]` ipv6Only listener (matrix row 5).
5. Generations accumulate per port for the whole run: 979 directories on one port after 8 s of saturation. Each claim lists the whole slot. No latency problem was measured at that size (maxima above).
6. On Windows, probes now listen briefly on `0.0.0.0` and `[::]`, that is, on all interfaces; the previous probe was loopback-only. Probe servers destroy any accepted socket and close at once. I did not inspect whether a Windows Defender Firewall first-listen prompt can appear for a `node.exe` without a firewall rule, because no settings were inspected (unverified).
7. K3 caveat: the fixture's own scan starts at a random offset, so whether A's fixture probed 63802 before taking 63803 was not recorded. Each of B's six exhaustion results on 63802-63803 did require 63802 to be refused by the probe, because no lease was held on 63802 at those times. The D1 path in the API range is therefore exercised natively.
8. Harness log artefact: in `r1-witness/K9-A.jsonl`, the `foreign-ready`, `child1-ready` and `child2-ready` rows carry the foreign or child pid in the row's `pid` field (event data overwrote the worker pid). No assertion depends on that field.

## POSIX and other hosts (pending)

- On non-win32 platforms the helper probes only `127.0.0.1`.
- Linux (analysis, not verified here): a listening wildcard socket blocks a more specific bind even with `SO_REUSEADDR`, so the D1 class is not expected there.
- macOS/BSD (analysis, unverified; Mac use was excluded by the brief): libuv sets `SO_REUSEADDR` on Unix TCP binds, and BSD-derived stacks allow a same-user specific-address bind beside an existing wildcard listener in that case. The D1 class may therefore persist on macOS. If macOS is a supported development host, it needs its own hosted or native check.
- The generation and rename protocol was not exercised on POSIX. Hosted CI remains pending.

## Explicit limits

- One Windows host, one coherent witness run (two workers, 8 tests). The contention was bounded to 8 s per worker with two workers only, and there was no stress-until-green. Zero unexpected errors in 7,270 attempts is strong evidence but not proof of absence.
- Cross-process ordering assumes `process.hrtime.bigint()` (QueryPerformanceCounter) is consistent across processes on one host; `Date.now()` is used only for readability.
- Not rerun, by the brief's budget: the broad API coverage run (the author reports 2,086 passed, 16 skipped, 95.33% lines and 90.70% branches; I did not re-verify these), the author's helper tests, and the touched callers (`serve`, `history-cleanup`, `shutdown-*`), which were checked by reading only in the original QA.
- Not exercised: watch mode, multiple Vitest projects, Turbo-level `test`, grandchild socket inheritance, Windows excluded port ranges (none overlap the assigned range), foreign listeners owned by a different Windows user (by reading, `canBind` would surface a raw `EACCES` rather than skip), simultaneous invocations sharing a range (out of the stated contract), and real providers (none used).
- The QA harness files are disposable and are not lint- or type-clean (`03-harness-static-check.txt`).

## Budget, cleanup and preservation

- Budget: one coherent native witness (r1), first attempt exit 0, 0 of 1 allowed harness corrections used, no reruns.
- QA witness files were removed from `apps/api/src/qa407c/` by exact name and the empty folder was removed. `git status` is unchanged, including ignored paths under `apps/api/src`. The redirected TEMP was empty after the run (teardown removed the coordination root) and the empty folder was removed. Rendezvous files are kept as evidence in `work/r1-witness/sync/`; there were no `ABORT-*` files. Both deny ACEs were removed, as the `icacls` after-outputs show, before teardown deleted the root. Final ports 63800-63819 are ok, and no QA node processes remain. The only other write was made by Vitest itself: it updated its git-ignored results cache `apps/api/node_modules/.vite/vitest/da39a3ee…/results.json` (798 bytes, file-order and duration metadata). That cache already held the original QA's `src/qa407/*` entries, and this run added `src/qa407c/qa407c-{a,b}.test.ts` entries. I left it as Vitest wrote it rather than edit a tool-managed file. No tracked file and no frozen file changed.
- Preserved and verified read-only: the original independent QA folder `i1-ports-407-independent-claude-qa` matches all 135 of its `SHA256SUMS.json` entries. The provider public report `i1-ports-407-qa-claude-01/provider-final-message.md` has SHA-256 `e2870890…c9ae` and mtime 2026-11-18T05:18:44Z, which predates this session; it was read, not written. This QA's own provider-stream folder was not touched.
- Not done (by the brief): no stage, commit or push; no issues, merge or review requests; no subagents; no owner store, settings, providers, Mac or SSH; ports 4747/4748 and other lanes untouched.

## Index

`SHA256SUMS.json` lists every file in this folder except itself.

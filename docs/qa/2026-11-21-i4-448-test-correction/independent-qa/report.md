# #448 D194 independent corrective QA: report

**Verdict: PASS for the corrected test file, by all four criteria.** The limits are listed below. This is the separate Claude Opus 5.5/xhigh behaviour QA; it is neither the author's run nor the Fable review. Only the test-only correction was assessed. Hosted CI at the exact head and current target, canonical native verification, root/coordinator completion and the owner-only #448 closure remain open. This QA does not complete them.

| Criterion | Result | Basis |
| --- | --- | --- |
| C1: the isolated file makes no outbound attempts; four startup paths are retained | **PASS** | Deliberate attempts are blocked by each guard layer alone (01c, 01d). The real F1 discovery path is caught when Ollama is enabled and absent with the candidate setting (02a/02b). The ordinary file run records 0 attempts in two replicates (03a/03b). There are exactly 4 `container.start()` paths (03b) |
| C2: D194 storage contract on genuine SQLite files | **PASS** | Independent before/after snapshots of the actual candidate run show absent→0 B, 0 B→0 B and frozen 8,272 B→identical (03b). My real-preflight scenarios S1/S2a/S2b/S3 match the contract (04). The verbatim helper agrees with my predicate on 19/19 real-file controls, including real SQLite frames and checkpoints (04) |
| C3: the original strict predicate rejects the observed absent→empty transition | **PASS** | The parent's verbatim statement rejects 4/4 captured absent→0 B transitions: 2 from S1 and 2 from the actual candidate test run. It accepts 6/6 unchanged cases. The candidate helper accepts all 10 (05) |
| C4: scope, preservation and cleanup | **PASS** | The checkout is clean and detached at the candidate, with its prior branch preserved. The author checkout is unchanged. Both original seals re-verify. No owned process remains. Owned scratch was removed after inventory (06/06b) |

## Binding

- **Candidate.** `446da9ce32b2304f17c53b5ff09af559f35dd3cf`, tree `53af2676…`, parent `cc0a52cf…`. The only delta is `apps/api/src/preflight-catalog.test.ts`: blob `a187acae…`, SHA-256 `a67356cd6773b265df80ced4e26a9c1f17cd0fe0c48f2d4cb286ddc315c611ae`. The parent blob `582e28ee…` has SHA-256 `14b1532e…4b71`.
- **QA checkout** `G:/ggq/gg-i4-448-qa/GraphGoblin`.
  - Before: clean on `codex/gg-i4-448-qa` at `b45807f0`. Only ignored build/install output was present, and no foreign process referenced it.
  - Steps: I fetched `codex/gg-i4-448-preflight` from the read-only author checkout with automatic GC and maintenance disabled. FETCH_HEAD was the candidate, and I then ran `checkout --detach`.
  - After: HEAD, tree, parent and file hash are verified. Status and index are empty. Branch `codex/gg-i4-448-qa` is still at `b45807f0` (`commands/00a–00c`, with an erratum noted below).
- **Dependencies.** No package, lockfile or config path differs between `b45807f0` and the candidate. The existing install was reused and nothing was installed.
- **Runtime.**
  - Node `v22.23.4` from the project runtime, first on PATH.
  - `C:/nvm4w/nodejs/pnpm.cmd` 12.8.1, which matches `packageManager`.
  - Vitest 5.0.3 and tsx 4.23.15.
  - TEMP/TMP `G:/ggq/qa-scratch/i4-448-test-independent-01`.
  - `npm_config_update_notifier=false` was set per process.
  - No `GG_*` variables were inherited.

## C1: isolation of the new file

**Instrumentation** (`driver/v2/guard.cjs`, loaded by `NODE_OPTIONS=--require` into every Node process and Vitest fork). Each event is appended synchronously.

- **L1, API layer.** It covers fetch, WebSocket/EventSource, `net.Socket#connect`, http/https/tls, dns and dgram. Each is rejected before the original is called. IPC/named pipes, `data:` fetch, IP-literal `lookup`, `listen`, filesystem access and child processes are passed through and counted.
- **L2, handle layer.** `process.binding` `tcp_wrap` connect/connect6, `udp_wrap` send/connect and `cares_wrap` getaddrinfo/queries return `UV_EACCES`.
- **Native, supplementary.** `tcp-poll.ps1` records every TCP row and UDP endpoint owned by the runner's descendants.

Results:

- **01c (L1+L2) and 01d (L2 only), controlled.** All seven deliberate attempt types were rejected: fetch, `http.get`, `net.connect`, `tls.connect`, `dns.lookup`, `dns.promises.lookup` and UDP send. This held in the parent and in a forked child, whose guard was inherited. In-process TCP and UDP honeypots accepted 0 connections and received 0 datagrams. The forwarding checks for `data:` fetch and named-pipe round trips succeeded. In 01d, L1 was disabled and every attempt failed with `EACCES` at the libuv/c-ares layer, so each layer blocks on its own.
- **02a, controlled: real F1 path with Ollama enabled.** This used the parent commit's environment shape with `GG_OLLAMA_URL` pointed at my honeypot, so port 11434 was never targeted. `createContainer(...).start()` produced exactly one blocked `GET http://127.0.0.1:50396/api/tags`, 86 ms after start. Its stack is `ollama/http.ts:66` ← `discovery.ts:80` ← `services.ts:74/100/154`. The honeypot accepted 0 connections. The poller recorded the honeypot's LISTEN row, which shows it can see sockets owned by the process tree.
- **02b, controlled: `GG_OLLAMA_ENABLED='false'`.** The config read `ollamaEnabled:false`. There were 0 attempts over the full 6 s wait after start plus 0.5 s, and 0 honeypot connections.
- **03a, native, guard only.** The ordinary single-file command passed **14/14** in 10.80 s with exit code 0.
  - The guard was installed in the Vitest parent (PID 12608) and its fork (13340, child of 12608). Both recorded **0 blocked and 0 attempted** operations.
  - The poller tracked cmd, pnpm.exe, the node parent and fork, and the product's lock-check PowerShell and conhost. It took 19 samples and found **0 TCP or UDP rows**.
- **03b, native, guard plus passive observers.** It passed **14/14** with **0 attempts** and 0 TCP/UDP rows.
  - `startup-chat-audio-probe` fired **exactly 4 times**. Each came from `chat-audio.ts:213` ← `container.ts:267` ← `container.ts:559`. Line 559 is `await cleanupAudio(true)`, inside `start()` and immediately before `ollama.start()` on line 560.
  - Two came from test line 160 (positive codex and claude starts) and two from test line 292 (disabled codex WARN and claude FAIL starts). The refusal cases did not start.
- The historical ten requests came from a different three-file run. They are not attributed to this file, and that run was not repeated.

## C2: storage contract on genuine SQLite files

**In the actual candidate run (03b, native).** My observer took 60 independent synchronous snapshots (`readdirSync`, sizes, SHA-256, DB header and WAL parse with checksum validation), including `-shm`. All 81 helper reads byte-match the independent snapshot taken at the same moment.

| Candidate test (fixture) | Before | After preflight and reads | My predicate |
| --- | --- | --- | --- |
| initially absent WAL (`xDeZzo`) | DB `c749672c…` only; **no `-wal`, no `-shm`** | DB identical; **`-wal` 0 B** + 32 KiB `-shm` created (2 samples) | accept |
| initially empty WAL (`mgEqiU`) | DB `c749672c…`, `-wal` 0 B, no `-shm` | DB identical, `-wal` 0 B, `-shm` created | accept |
| WAL-backed store (`UYpKlA`) | DB `7bd5d622…`, `-wal` 8,272 B (2 frames, both checksum-valid, 1 commit) | DB and WAL byte-identical; `-shm` changed | accept |
| tests 1–10 | DB plus a pre-existing 0 B `-wal` and `-shm` (left by the in-process `fixture()`) | unchanged | accept for every sample |

On the negative-control test (`ECME4W`), my predicate agrees with all 8 designed transitions. It rejects the DB byte flip, the removed empty WAL, real frames on an absent or empty WAL, a WAL byte flip, WAL removal and truncation to 0, and it accepts absent→empty. My parser independently found that the flipped WAL's checksum-valid frame prefix fell from 2 to 1.

**My independent real-preflight scenarios (04, native product code and real SQLite, with fixtures I controlled).** Each store was built by the production writer in a child process that exited. The real `runPreflightCli` ran in its own child process. Observations were taken before, immediately after (in the child) and after the child exited. Rows were read with Node's bundled SQLite 3.53.4 from private copies.

| Scenario | Verified initial state | Result | Rows / migrations | Verbatim helper / mine / old strict |
| --- | --- | --- | --- | --- |
| S1 absent | WAL-mode header, **no `-wal`/`-shm` after the writer process exited**; no fallback copy was needed | exit code 0, `ok Database`, `ok Default model gpt-6.1-terra (codex)`; DB `c749672c…` identical; **`-wal` 0 B + `-shm` created**, also after exit | 12/30, identical; terra not stored | accept / accept / **reject** |
| S2a empty (written) | 0 B `-wal`, no `-shm` | WAL 0 B, identical | identical | accept / accept / accept |
| S2b empty (from a prior real reader) | S1's settled 0 B `-wal` + `-shm` | WAL and `-shm` identical | identical | accept / accept / accept |
| S3 frozen nonempty | 8,272 B WAL from a `node:sqlite` writer: 2 checksum-valid frames, 1 commit. Read alone, the DB file holds 13 rows including terra (`observations/07-s3-dbfile-alone.txt`) | the projection is accepted; DB `7bd5d622…` and WAL `26e1b8fb…` identical; `-shm` changed | 12/30 through the WAL, identical; terra deleted by the WAL frames | accept / accept / accept |

`GG_DATA_DIR` was never created by preflight.

**Control matrix (04, controlled).** Each control ran on a fresh disposable store. Both the candidate's verbatim `storeBytes`/`expectStoreUnchanged` (with Vitest's real `expect`) and my D194 predicate were applied.

- **Accepted by both, 5/5:**
  - P1: absent stays absent.
  - P2: absent becomes a 0 B file written by fs.
  - P3: absent becomes a 0 B `-wal` plus `-shm` created by a **real `node:sqlite` read-only reader**.
  - P4: empty stays empty.
  - P5: a nonempty WAL stays unchanged while a real reader changes `-shm`.
- **Rejected by both, 14/14:**
  - N01–N03 change the database: a page-2 byte flip, DB removal, and a real write followed by a clean close that checkpoints.
  - N04–N06 cover the absent or empty WAL: an empty WAL removed, and **real frames** added to an absent WAL and to an empty WAL.
  - N07–N10 change an existing nonempty WAL: a frame-page byte flip, removal, truncation to 0, and **2 more real frames appended** (16,512 B, 4 checksum-valid frames).
  - N11–N14 cover checkpoints and edge mutations: a **real TRUNCATE checkpoint** that changes the DB and empties the WAL, a 32-byte header-only WAL, a WAL salt-byte flip, and a DB flip with the WAL unchanged.
- Every designed intent was realized, and the helper agreed with my predicate on 19/19.

## C3: old-predicate control

In run 05, the parent's verbatim statement `expect(await storeBytes(dbFile)).toEqual(before);` was evaluated with `storeBytes` bound to captured after-maps. Those maps were reloaded from hash-verified blobs.

- It rejected all four observed absent→0 B transitions with `expected { …(2) } to deeply equal { …(1) }`:
  - S1, immediate and settled.
  - The actual candidate test `xDeZzo`, samples 2 and 3.
- It accepted the six unchanged cases: S2a, S2b and S3, each immediate and settled.
- The candidate helper accepted all ten.

The initial and resulting states were measured, not inferred. On this host, both the product reader and a `node:sqlite` reader created an empty WAL from an absent one.

## Native vs controlled evidence

| Native (real code, unmodified behaviour, passively observed) | Controlled (deliberately constructed) |
| --- | --- |
| 03a/03b: the ordinary `pnpm --filter @graphgoblin/api test src/preflight-catalog.test.ts` run of the candidate file, with outbound counters and storage snapshots | 01c/01d: deliberate outbound attempts against in-process honeypots |
| 04 S1–S3: the real `runPreflightCli` and production writer on real SQLite files | 02a/02b: real `container.start()` with `GG_OLLAMA_URL` redirected to a honeypot |
| Real SQLite frames and checkpoints in N03/N05/N06/N10/N11 and real readers in P3/P5 | The 04 fixtures and all 19 control mutations; 05, the old predicate applied to captured maps; the verbatim helper run outside the Vitest runner with Vitest's real `expect` |

## Failures, driver iterations and errata

- **01a failed (exit code 1) because of a driver fault in iteration v1.** L1 blocked the IP-literal `dns.lookup` that `net.Server#listen(0,'127.0.0.1')` performs, so the honeypot could not start. The source, output and error are retained (`driver/v1`, `commands/01a-*`).
- **v2 was the only fix.** It passes through IP-literal lookups while every hostname lookup stays blocked. All later runs used v2 without further faults. This was 2 of the 3 permitted driver iterations.
- Probe 00d attempted a CommonJS import of Vitest's `expect` and was refused. Probe 00e confirmed the ESM entry works. Both outputs are retained.
- Two spec drafts were written with broken backslashes by a heredoc. They were never executed and are kept as `driver/v1/specs/*.malformed-heredoc-unused`.
- `commands/00c-checkout.txt` echoes `-c core.longpaths=true`, but the executed command was `git -c gc.auto=0 checkout --detach …`. See `00c-checkout.ERRATUM.txt`.
- No test, threshold, timeout or product file was changed. No failed run was retried to reach a green result. 03a and 03b are replicates planned before either ran (PLAN amendment A1).

## Limits

- The guard covers Node processes only. pnpm.exe, cmd.exe, esbuild.exe and the product's data-dir-lock PowerShell are native processes. They are covered only by the poller, which scans processes every 1 s and TCP every 250 ms.
  - The poller missed some short-lived children. These include Vite's `cmd /c "net use"` in the Vitest parent, and the lock-check PowerShell in 03b, which 03a did track.
  - DNS resolved through the Windows DNS client service cannot be attributed to a process.
  - The poller's sensitivity was shown only with LISTEN rows, because no outbound connection was ever allowed.
- The guard blocks attempts before network access, so "0 attempts" means that no Node-level fetch, socket, DNS or UDP operation was made. The setting's behaviour against a live Ollama was not exercised, by design. Nothing was listening on 4747, 4748 or 11434 at post-check.
- L2 relies on `process.binding`, a deprecated internal API, which works on Node 22.23.4. The Vitest fork was terminated without exit hooks, so it has no exit summary. Its per-event log is complete, and its PID was confirmed absent.
- Evidence comes from a single Windows host. Non-Windows behaviour, restricted filesystems and sidecar behaviour from other SQLite builds were not covered. Some negative controls are filesystem mutations (byte flips, removal, truncation, header-only WAL); the others are genuine SQLite operations, as marked.
- The old predicate was evaluated as its verbatim statement with a substituted `storeBytes` binding. The parent's whole test file was not re-run, because no product or test mutation was permitted.
- Typecheck, lint, coverage, the historical 61-test run, broad suites, browser, real provider/CLI and GitHub were not run, as the brief directed. Author evidence, including the inconclusive finalizer-race counterfactual and the slow first run, is preserved unchanged: its seal re-verified 98/98.

## Preservation, processes and cleanup (06/06b)

- **Checkouts.** The QA checkout's HEAD, tree, parent and file hash match the candidate. Its status is empty and its staged and worktree diffs are empty. The prior branch is still at `b45807f0`. The author checkout is at the candidate, clean, with the same file hash.
- **Original evidence.** All 98 members of the `i4-448-test-author-01/evidence-seal.json` seal and both members of the Astra `hashes.json` seal match. The brief and spec hashes are unchanged. `provider/` was not touched.
- **Processes.** None of the 56 recorded PIDs (guard installs, poller-tracked processes, pollers and runner roots) is alive. The only processes whose command lines mention my markers are the launcher runner (PIDs 33404/30540) and my own tool shells.
- **SQLite binaries.** 61 SQLite blobs are retained locally as content-addressed `fixtures/blobs-03b-…` (37 files) and `fixtures/blobs-04-sqlite` (24 files); every name matches its SHA-256. They contain disposable fixture data only, with the test constant key and no credentials. The run-04 child outputs were copied to `observations/04-preflight-children/`.
- **Scratch.** The 20 owned scratch entries were inventoried with hashes in `observations/06-postchecks.json` and then removed: runner markers, the run-04 fixture tree `qa448-04-pDUsEP` and tsx's cache. The runner-owned `claude/` remains.

## Exact commands and files

- **Runner.** `node driver/v2/run-command.mjs driver/v2/specs/<id>.json`, with v1 used for 01a. Each `commands/<label>.{spec,receipt}.json` records:
  - the executed argv, cwd and environment;
  - the start and finish times, the exit code and the duration;
  - the candidate hash, HEAD and status before and after;
  - the guard and poller summaries.

  Raw `*.stdout.txt`, `*.stderr.txt`, `*.guard.jsonl` and `*.tcp.jsonl` are retained alongside.
- **03a/03b.** cwd is the repo root. The command is `cmd.exe /d /s /c "C:\nvm4w\nodejs\pnpm.cmd --filter @graphgoblin/api test src/preflight-catalog.test.ts --reporter=verbose --reporter=json --outputFile.json=<commands>/<label>.vitest.json"` with `NODE_OPTIONS=--require=<Q>\driver\v2\guard.cjs` and `QA448_GUARD_LAYERS=L1,L2`. 03b also sets `QA448_OBSERVE=1`.
- **02, 04 and 05.** cwd is `apps/api`. The command is `node [--expose-gc] --conditions=development --import tsx <Q>/driver/v2/<script>.mts`.
- **Analyses.** `observations/03-analysis.json`, `04-sqlite.json`, `05-old-predicate.json`, `06-postchecks.json` and `06b-cleanup.json`.
- **`07-s3-dbfile-alone.txt`.** A `node:sqlite` read of a scratch copy of the retained blob `7bd5d622…`. The copy and its scratch folder `qa448-07-dbonly` were removed afterwards, and only the runner-owned `claude/` remains in scratch.
- **Generated verbatim modules.** `driver/v2/generated/`. The candidate slice is lines 73–103 (slice SHA-256 `4c436210…`). The parent `storeBytes` is lines 72–85, plus its strict statement, which occurs 4 times in the parent.
- **Seal.** `seal.json` lists the SHA-256 of every file I wrote. It excludes `BRIEF.md`, `spec.json` and `provider/`.

#448 remains open for owner-only closure.

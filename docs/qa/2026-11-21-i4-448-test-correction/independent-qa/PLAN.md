# #448 D194 independent corrective QA: plan

Written 2026-11-21 before any execution, checkout change or driver run. Role: actual Claude Opus 5.5/xhigh behaviour QA, separate from the GPT author (`i4-448-test-author-01`) and Fable corrective review (`i4-448-test-fable-review-01`, running concurrently against the read-only author checkout). The scope is the corrected test file only. This is not a general review.

## Inputs read

- D194 (`decision-194.md`, `d194-catalog-entry.json`), final scan 3 report (`i4-551-final-astra-01/report.md`), author report (`i4-448-test-author-01/report.md`) and root freeze (`i4-448-test-root-freeze-01/receipt.json`).
- Brief SHA-256 `05344da2…d1a5` and spec SHA-256 `787bde5a…d915` were verified before planning. `BRIEF.md`, `spec.json` and `provider/` are read-only.

## Binding (verified read-only before planning)

| Item | Value |
| --- | --- |
| Candidate | `446da9ce32b2304f17c53b5ff09af559f35dd3cf` |
| Tree / parent | `53af267660277933a2dd57718b528b7849cea2fb` / `cc0a52cffe7e0bffb197c3f3342d370e2b1b9794` |
| Delta | `apps/api/src/preflight-catalog.test.ts` only, 128 insertions and 5 deletions. Blob `a187acae…`, SHA-256 `a67356cd…611ae` |
| QA checkout | `G:/ggq/gg-i4-448-qa/GraphGoblin`. Branch `codex/gg-i4-448-qa` at `b45807f0`. No tracked or untracked changes; only ignored build/install output. No foreign process references it |
| Dependencies | No `package.json`, lockfile, workspace or config path differs between `b45807f0` and the candidate. The existing install is reused; nothing is installed |
| Runtime | Node `v22.23.4` from `C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64`, first on PATH. `C:/nvm4w/nodejs/pnpm.cmd` 12.8.1 matches `packageManager`, so pnpm will not switch versions |
| TEMP/TMP | `G:/ggq/qa-scratch/i4-448-test-independent-01`. Its existing `claude/` subfolder is not mine and will not be touched |

## Step 0: bind the checkout (authorized)

1. Record the branch, HEAD, status and worktree git directory. Stop and report to root if the checkout is dirty.
2. Run `git -c gc.auto=0 -c maintenance.auto=false fetch --no-auto-gc --no-tags --no-recurse-submodules --no-write-commit-graph G:/ggq/gg-i4-448-preflight/GraphGoblin codex/gg-i4-448-preflight` with `GIT_OPTIONAL_LOCKS=0`. Verify that FETCH_HEAD is the candidate. The shared object store already holds the commit. Automatic GC is disabled so the shared repository is not repacked.
3. Run `git checkout --detach 446da9ce…`. Verify HEAD, tree, file SHA-256, a clean status and that branch `codex/gg-i4-448-qa` still points to `b45807f0`. Do not move or delete it.
4. Read the author checkout's HEAD and status only, with `GIT_OPTIONAL_LOCKS=0`, before and after the QA work.

## Instrumentation (own drivers in `driver/`; never in the repo)

- **Guard `guard.cjs`**, loaded by `NODE_OPTIONS=--require`, so every Node process in the tree inherits it, including Vitest's forks. It has two independent layers. Every event is appended synchronously because Vitest kills its fork without exit hooks.
  - **L1, API layer.** It wraps `globalThis.fetch`, `net.Socket.prototype.connect`, `http/https.request|get`, `tls.connect`, `dns.lookup`, `dns.promises.lookup`, `dns.resolve*` and `dgram` `send`/`connect`. It records the target and stack, then rejects synchronously before the original is called. Non-network behaviour passes through and is counted: `data:`/`blob:` fetch, path-based IPC/named-pipe `connect`, `listen`, filesystem and child processes.
  - **L2, handle layer**, if the capability probe confirms it. It wraps `process.binding('tcp_wrap').TCP.prototype.connect/connect6`, `udp_wrap` send and `cares_wrap.getaddrinfo`. These are the libuv/c-ares entry points below L1, and they return a UV error before any socket or resolver traffic occurs. L2 is proven separately with L1 disabled.
  - **Observers (passive).** One records each `lstat` of `<fixture>/data/chat-audio`. Only `container.start()` reaches that call, through `cleanupAudio(true)`, immediately before `ollama.start()`; this counts actual startup paths. Another takes synchronous independent snapshots (`readdirSync`, `statSync`, SHA-256 and SQLite header fields) of `gg-preflight-catalog-*` fixture directories whenever the test lists them and before its `afterEach` `rm`. These snapshots include `-shm`, which the helper ignores.
- **OS observer `tcp-poll.ps1`, native and supplementary.** It polls `Get-NetTCPConnection` every 250 ms and the driver's descendant PID set every second. It records any TCP row owned by that process tree, including pnpm.exe, which the Node guard cannot cover. DNS through the Windows DNS client service is not visible at this layer; L1 and L2 cover it.
- **Runner `run-command.ps1`.** It writes per-command stdout, stderr, the exact argv, environment deltas and a receipt with timestamps, exit code and node path/version. It records the candidate file SHA-256 before and after and the `git status` before and after. A receipt is never overwritten. `npm_config_update_notifier=false` is set per process so pnpm makes no update check.
- **SQLite driver `sqlite-qa.mts`.** It runs under `node --conditions=development --import tsx` with cwd `apps/api` and imports the production TypeScript through absolute file URLs. Nothing is placed in the repo. It is my own fixture design.
  - Each store is built by the production `openDatabase().migrate()` and `SqliteModelCatalog.seed()` in a **separate child process that exits**. Process exit releases every native handle, which avoids the finalizer race without copying. The driver then verifies the WAL-mode header (bytes 18/19 = 2) and the directory listing.
  - Real `runPreflightCli` runs in a child process under the guard. Observations are taken **before**, **immediately after** in the child and **settled** after child exit. Each records the listing, sizes, SHA-256, DB header, WAL header and frame count. Catalog and `__drizzle_migrations` rows are read by Node's bundled `node:sqlite`, a different SQLite build from the product's libsql, from snapshot copies so the reader cannot alter the observed files.
  - Real frames come from `node:sqlite` writers with `wal_autocheckpoint=0`.
  - The candidate helper is executed **verbatim**. Lines 73–103 (`storeBytes`, `expectStoreUnchanged`) are sliced from the frozen Git blob, hash-verified, and run with Vitest's real `expect`. The old predicate is the parent's verbatim `expect(await storeBytes(dbFile)).toEqual(before)`. My own contract predicate is derived from D194 and is independent of both.

## Runs (finite; at most 3 driver iterations for distinct instrumentation fixes)

| # | Run | Class | Expected |
| --- | --- | --- | --- |
| 00 | Capability probes: process.binding availability, `node:sqlite`, tsx import, standalone Vitest `expect` | probe | Recorded; it determines whether L2 is enabled |
| 01 | Guard self-check: deliberate fetch, http, net, tls, dns and dgram attempts at 127.0.0.1:9, `localhost` and a `.invalid` name, from the parent and a forked child. Repeated with L1 disabled to prove L2. Forwarding checks cover `data:` fetch and named-pipe IPC | controlled | Every attempt is recorded and blocked. Forwarded operations succeed. No OS TCP rows |
| 02 | Product-path control: `createContainer(...).start()` on my fixture with `GG_OLLAMA_URL=http://127.0.0.1:9`, Ollama default **enabled**, then with the candidate's `GG_OLLAMA_ENABLED=false` | controlled | Enabled: at least one blocked `/api/tags` attempt with a discovery stack. Disabled: zero. Port 11434 is never targeted |
| 03 | **Ordinary isolated file**: `pnpm.cmd --filter @graphgoblin/api test src/preflight-catalog.test.ts --reporter=verbose` plus JSON output, with the guard, observers and OS poll | native, instrumented | 14/14 pass. Zero blocked attempts in every process. Installation is logged in the Vitest parent and fork. Exactly four `start()` `chat-audio` probes. Independent snapshots satisfy D194 for each case |
| 04 | SQLite scenarios S1 verified-absent, S2 pre-existing empty and S3 frozen nonempty WAL, with real preflight | native product, controlled fixture | DB bytes identical. Rows and migrations are unchanged. S2/S3 WAL is present and identical. S1 WAL is absent or exactly empty; the actual state is reported |
| 04 | Observer control matrix on real files, in the same driver | controlled | Accepts: unchanged absent, absent→empty, empty→empty, nonempty unchanged with `-shm` change. Rejects: DB byte flip, real checkpoint into the DB, DB removal, empty WAL removed, real frames on absent/empty WAL, nonempty WAL byte change, removal, truncation and appended real frame, and a 32-byte header-only WAL |
| 05 | Old-predicate control against S1 observations reloaded from saved, hash-verified blobs | controlled | The old strict predicate rejects only when the absent→empty transition was actually observed. The candidate helper accepts. If S1 stays absent on this host, this is reported and not inferred |
| 06 | Post-checks: checkout status, file hash and branch, author checkout HEAD/status, process absence, owned scratch, retained SQLite blobs | check | Clean, unchanged and absent |
| 07 | Seal: SHA-256 of every file I wrote | seal | — |

Not run, per the brief: the historical 61-test or broad suites, the author's mutation experiments, typecheck/lint (already passing), browser, real provider or CLI, GitHub, and ports 4747/4748/11434. The historical ten requests from three files are not attributed to this file.

## Criteria and verdict rules

- **C1, isolation.** PASS requires: run 01 proves blocking on both layers; run 02 proves sensitivity to the actual F1 path and that the `false` setting closes it; run 03 records zero attempts and exactly four startup paths, with all 14 tests passing. Any attempt in run 03, or any of the four startups missing, is a FAIL. An instrumentation gap I cannot close is CONDITIONAL.
- **C2, storage contract.** PASS requires both real-preflight scenarios and run 03's independent snapshots to satisfy D194, and every matrix control to give the expected decision from both the verbatim helper and my predicate. A decision mismatch is a FAIL with the exact case.
- **C3, old-predicate control.** PASS requires the strict predicate to reject the actually observed absent→empty transition and the helper to accept it. If the transition is not observed natively, the result is CONDITIONAL and recorded factually.
- **C4, scope and preservation.** PASS requires the checkout to be clean at the candidate after QA. The source, the author checkout and the sealed evidence must be unchanged, with no owned processes left behind.

## Amendment A1 (16:2x UTC, after runs 00–02 and before run 03)

- Driver iteration v1→v2 (1 of 3) changed one thing. L1 had blocked `dns.lookup` of an IP literal, which `net.Server#listen(0,'127.0.0.1')` performs without any resolver traffic. That lookup is now forwarded and counted; every hostname lookup stays blocked. The v1 source, outputs and error are retained (`driver/v1`, `commands/01a-*`).
- Run 03 is split into two planned replicates of the same ordinary command. This is not a retry:
  - **03a** has the guard only (L1+L2) and no fs observers. It is the closest-to-ordinary execution and is used for the zero-attempt result.
  - **03b** adds the passive fs observers: startup `chat-audio` probes, independent store snapshots and helper-read hashes. It is used for the four startup paths and the in-test storage states, and it must also record zero attempts.
- Each replicate is a single execution. Failures are reported as observed.

A product defect or a repeated driver fault is reported exactly. Thresholds are not changed and failed runs are not retried until green. #448 owner closure, hosted CI, native and root completion remain outside this QA.

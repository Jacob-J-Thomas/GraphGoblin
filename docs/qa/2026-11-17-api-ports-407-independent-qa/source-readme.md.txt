# #407 independent behavior QA (Claude Opus 5.5, xhigh)

Role: independent behavior QA, not the implementer. This is not a formal review scan or merge approval. The global #503 audit remains blocking and QA cannot waive it.

- QA tree: `C:/Users/98jak/.codex/worktrees/gg-20261117-ports-407-qa/GraphGoblin`, HEAD `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1` plus the copied candidate.
- Host: Windows 10.0.26300 (Windows 11 Pro), Node v22.23.4 (project runtime prepended on PATH), pnpm 12.8.1, Vitest 5.0.3. Details in `08-host-facts.txt`.
- Native ports used: only 63800-63819. Every run probed the whole range before and after (`*/ports-*.json`). TEMP/TMP were redirected to a QA-owned folder for each run, so each run's coordination root and fixture directories could be observed directly.

## Provenance and ordering

1. Criteria (`00-criteria-before-author-tests.md`, recorded 2026-11-18T04:58:32Z) and scenarios (`01-scenarios-before-author-tests.md`, 05:00:38Z) were written before reading `api-port.test.ts`, the caller test diffs, the author witness files or the author README. The author README and witness files were never read.
2. Source hashes: before (`02-sources-before.json`), after the build (`05-sources-after-build.json`) and after cleanup (`11-sources-after.json`). All 13 candidate sources match the frozen manifest at every point. The independently rebuilt `apps/api/dist/main.js` matches the frozen hash `3160AC2A…5325C`.
3. Install: `pnpm install --frozen-lockfile` (exit 0, `03-install.*`, lockfile unchanged). Build: `pnpm turbo run build --filter=@graphgoblin/api` (exit 0, `04-api-build.*`; the API build was a cache miss and executed).

## Runs (exact commands; cwd `apps/api` unless noted)

All runs used the ACTUAL `apps/api/vitest.config.ts` (`globalSetup` + `setupFiles`) through `pnpm exec vitest run --reporter=verbose --maxWorkers=<n> <filter>`, driven by `run-vitest.sh <run> <start> <count> <workers> <filter>` or `scripts/s2-driver.mjs`. Disposable QA files lived in `apps/api/src/qa407/` and are preserved under `qa-tests/`.

| Run | Env range | Workers | Filter | Exit | Notes |
| --- | --- | --- | --- | --- | --- |
| r1-s1-two-worker | 63800/2 | 2 | src/qa407/qa407-s1 | 1 | First failure preserved: QA harness assertion (HC1) |
| r1b-s1-two-worker-corrected | 63800/2 | 2 | same | 1 | Second failure preserved: QA harness race (HC2) |
| r1c-s1-two-worker-corrected2 | 63800/2 | 2 | same | **0** | E2E witness 1 passes |
| r2-s2-foreign-failed-startup | 63804/3 | 1 | src/qa407/qa407-s2 (via `node scripts/s2-driver.mjs`, receipt `r2-s2-driver.*`) | 1 | S2a FAIL = defect D1; S2b and S2c pass |
| r3-n-local | 63810/1 (tests pass explicit sub-ranges 63810-63818) | 1 | src/qa407/qa407-n-local | 1 | N5 FAIL = defect D1; N1-N4 and N7 pass |
| r4-n6-stress | 63817/1 | 2 | src/qa407/qa407-n6 | 1 | Both workers FAIL = defect D2 |
| r5-n4-worker-crash | 63812/1 | 2 | src/qa407/qa407-n4crash | 1 | Expected: the intentional worker crash is a Vitest error; the observer test passes |
| 07-n5-native-bind-semantics | n/a (63813 only) | n/a | `node scripts/n5-native-bind-semantics.mjs` (cwd evidence folder) | 0 | Plain Node bind semantics, outside Vitest |

Each run folder holds `vitest.log`, `vitest.json` (receipt: command, cwd, start, end, exit), `*-observations.jsonl` (native observations written by the tests), `sync-files/`, `ports-before.json`, `ports-after.json`, `temp-after.txt` and `processes-after.json`.

## Criteria / result matrix

| ID | Criterion | Result | Native evidence |
| --- | --- | --- | --- |
| C1 | Invalid range fails clearly before any claim or child | **PASS** | r3 N1: 14 invalid env forms (`abc`, empty, blank, `63810x`, `-63810`, `70000`, `65535`+`2`, `63810.5`, `Infinity`, count `abc`/empty/`0`/`-1`/`1.5`). Each is refused by both `reserveApiPort()` and `createApiProcessFixture()` with "Invalid disposable API port range (GG_TEST_PORT_START=…, GG_TEST_PORT_COUNT=…)". Root and TEMP entries are unchanged. Nits: empty and blank are echoed as `0`; lenient spellings `' 63810 '`, `6.381e4` and `0xF942` are accepted as 63810 (observation only). |
| C2 | Exhaustion is clear and bounded | **PASS** | r1c: with both reservations held and no child bound, a third reserve fails in 1-2 ms with "No disposable API port is available in 63800-63801…". r3 N2: the multi-port and single-port forms fail in 0-1 ms. r2 S2a: "…in 63804-63806". |
| C3 | Distinct ports across ≥2 workers in one run | **PASS** (see D2) | r1c: pool 1 (pid 58120) and pool 2 (pid 12808) share one injected root and hold 63800 and 63801. r4 N6: 0 double grants in 1,881 grants under saturating two-worker contention. |
| C4 | Held until the owned child/listener settles | **PASS** | r1c: A's dispose started at …584. B's reserve attempts failed from …572 to …601. A's child closed at …605 and A's dispose resolved at …613. B won 63800 at …619, and the port was not listening at the win. r2 S2b/S2c (below). |
| C5 | Restart keeps ownership | **PASS** | r1c (and r1/r1b): A's child was SIGKILLed and the port stopped listening, but B's reserve was refused and A's marker was unchanged. A restarted on the same port to authenticated readiness with the same marker. r2 S2b: recovery in the same fixture after a failed start. |
| C6 | Existing foreign listeners refused and preserved | **FAIL (partial), D1** | Preserved in every case: the foreign listener was never closed or killed and answered after each run. Refused only for 127.0.0.1-bound foreign listeners (r2 S2a: 63806 never granted; r3 N5). **Not refused for wildcard listeners**: a pre-existing foreign `0.0.0.0:63805` process was granted to a fixture, the real built API child became ready on 127.0.0.1:63805, and `http://127.0.0.1:63805/` was answered by the API (404 problem JSON) instead of the foreign listener for the fixture's lifetime (r2 S2a). The same holds for Node's default dual-stack `::` (r3 N5; native bind semantics in `07-*`). |
| C7 | Stale cleanup cannot delete a replacement claim | **PASS** | r3 N3: (a) a memoised second `release()` after a replacement claim resolves without touching it, and the port stays blocked; (b) the whole claim was removed externally and replaced, and the stale `release()` rejects `ENOENT` while the replacement marker is intact; (c) concurrent duplicate releases both fulfil. Dead owner: a simulated marker (r3 N4) and a real SIGKILLed worker (r5) both stay reserved for the rest of the run (never reclaimed; O2). |
| C8 | Failed startup/cleanup is surfaced; no early release, no leak | **PASS** | r2 S2b: a foreign bind after the probe caused readiness to reject with "API child exited before GraphGoblin API listening: Error: listen EADDRINUSE … 127.0.0.1:63804", exit code 1. The claim was held while stolen and after the port became TCP-free, until the fixture was disposed, then the port was granted again. r2 S2c: a forced child-dispose failure made `fixture.dispose()` reject; the claim was retained while the child was still listening; a retry released it. r3 N7: a `mkdtemp` failure released the claim. |
| C9 | Actual setup wiring; run-owned root removed at close | **PASS** | Every run used the real config. Both workers saw the same `gg-api-ports-*` root under the redirected TEMP. An unwired module instance fails with "Disposable API ports require the API Vitest setup". After every run the redirected TEMP was empty, including after a worker crash (r5). |
| C10 | Cleanup and port release | **PASS** | Every run: no LISTENING rows in 63800-63819, all 60 binds ok, 0 QA node processes. Final: `12-ports-final.json` ok, `13-processes-final.json` count 0, QA paths removed, `git status` equals the initial state (`10-git-status-after.txt`). |
| L1 | Independent runs / unrelated dynamic allocations | Not promised; not tested as a positive | The host's TCP dynamic range is 49152-65535, which contains the assigned ranges. S2b shows that an unrelated post-probe bind is surfaced clearly. |

## Defects (recorded, not fixed)

### D1: wildcard foreign listeners are not refused on Windows; fixtures shadow their IPv4 loopback traffic (Medium-Low)

- Mechanism: `canBind()` probes only `127.0.0.1`. On this Windows host a 127.0.0.1 bind succeeds while another process listens on `0.0.0.0:P` or `[::]:P` (`07-n5-native-bind-semantics.log`), and the API child binds the same 127.0.0.1 address.
- Observed with the real built API (r2 S2a) and through the helper (r3 N5: `0.0.0.0` and `::` granted, `127.0.0.1` refused, `::1` granted without conflict).
- Exposure: Node's default `listen(port)` binds `::`, which is the most common foreign listener shape. The listener is not killed, but while the fixture runs, its 127.0.0.1 traffic goes to the fixture. This contradicts the outcome's "existing foreign listeners refused" and the new docs sentence "A TCP bind probe skips existing listeners".
- The base `freePort` used the same 127.0.0.1-only probe, so this behaviour existed before the change and is carried forward. Linux semantics differ and were not tested.

### D2: spurious `EPERM` from the claim `mkdir` under Windows contention (Medium)

- r4 N6: two workers contended for single port 63817 for 8 s each. There were 17,490 attempts, 1,881 grants and 0 double grants, but **25** reservation attempts (12 + 13) threw `EPERM: operation not permitted, mkdir '<root>\63817'` instead of skipping the port or reporting exhaustion. No release errors.
- Mechanism: `claim()` treats only `EEXIST` as "taken". When a peer's `rmdir` of the same claim directory is pending on Windows, `mkdir` returns `EPERM`, which propagates out of `reserveApiPort()` and `createApiProcessFixture()`.
- Effect: an intermittent fixture-creation failure under parallel workers on narrow ranges, the same symptom class #407 targets. Stress collisions were about 1.3% of release events at saturation; the frequency in a real API run was not measured. This failure mode is new with the claim-directory mechanism.

## Observations (not #407 defects)

- O1: the helper's `canBind` probe briefly listens on the candidate port, so a peer's TCP connect can land on it (HC2). This is harmless to fixtures, but it means a connect check cannot prove a port is free.
- O2: claims from a crashed worker are kept for the rest of the run (conservative, matching the global-setup comment). On a narrow range a crash can therefore exhaust later fixtures in the same run.
- O3 (behaviour from before this change): after a failed child cleanup, the fixture's `finally` still removes the data directory while the child is alive. In S2c the test ran 74 s in total, of which roughly 65-70 s were these retries (the directory survived), which is longer than the 60 s `afterEach` timeout in `shutdown-process.test.ts`.

## Explicit limits

- Windows host only; Linux/macOS bind semantics were not exercised.
- Two end-to-end witness variants (S1, S2) plus targeted local cases. I did not rerun the author's tests and did not run a touched-caller regression of `serve`, `history-cleanup` or the `shutdown-*` suites. That stayed within the brief's budget, and `serve.test.ts` also contains a `port: 0` listener that could land outside the assigned range. Caller behaviour (env range honoured; release after `close`) was checked by reading only.
- Not exercised: watch mode, multiple Vitest projects, Turbo-level `test`, grandchild socket inheritance, Windows excluded port ranges (`EACCES`), and real provider paths (none were used).
- Timing comparisons use `Date.now()` across processes on one host (ms resolution).
- QA files were disposable; they were not type-checked or linted.
- Not a review: no typecheck, lint, format or coverage of the candidate.
- Unrelated pre-existing `%TEMP%\gg-wp-c2-tests-5Wt3mX` (created 2026-11-10) was left untouched.

## Harness corrections

See `09-harness-corrections.md` (HC1-HC4). No candidate or implementation-tree file was edited.

## Index

`SHA256SUMS.json` lists every file in this folder except itself.

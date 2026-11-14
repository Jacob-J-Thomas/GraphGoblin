# PR #460 implementation review, pass 1 (candidate `4ba9031a`, static review only)

**Verdict: not ready to merge yet. One targeted correction pass is needed.** One finding blocks under the repair contract (F1), and it is a diagnostics problem, not a safety one. One test-validity fix is cheap and belongs in the same pass (F2). Ownership stays fail-closed throughout, and I found no safety, ownership, privacy or resource-lifetime blocker.

## Blocking under the repair contract

### F1. In most refusals where the store stays held, the last ownership retry times out and its error replaces the held-store guidance

- **Severity:** P2. Diagnostics and safety guidance are wrong; fail-closed behaviour is kept.
- **Where:** `apps/windows-launcher/Launcher.cs:356-367`, especially the catch at `:363-364`.
- **Introduced by this patch:** yes.
- **Trigger:**
  - Retries now get only the remaining release budget. The loop keeps starting a helper whenever any time is left after the 200 ms sleep and `Probe()`.
  - A real ownership helper against a live owner takes about 2–3 s (Node import plus the PowerShell/WMI query in `data-dir-lock.ts:95`). So the final retry usually starts with less time than it needs, gets killed, and throws a timeout.
  - A clean held ending needs the remaining time to fall into a window of about 200 ms. Roughly 90% of persistent-held refusals with the default 60 s setting therefore end through the catch path.
  - Real cases: a gateway serving the same store on another port, a manual `pnpm start`, or a drain that takes longer than `StartupTimeoutSeconds`.
- **Impact:**
  - The message becomes `<detail>: <path>. The launcher ownership check timed out after 640 ms (budget 640 ms …) … Check the configured runtime and system load, including PowerShell and Windows Management Instrumentation availability.`
  - It drops "No second gateway was started. Do not stop an unrelated process or delete an unverified lock." That is the safety instruction for exactly this case.
  - It points the owner at WMI and system load, which the new troubleshooting text says to check for ownership-stage timeouts.
  - It also makes killing a helper mid-WMI routine instead of rare, which orphans a short-lived PowerShell process. This is the #459 mechanism, now hit on a normal path.
- **Why no test catches it:** every held-refusal test uses `StartupTimeoutSeconds: 1` (`windows-launcher.acceptance.mjs:219,394,542`; the new held test at helper acceptance `:305`), so the retry loop never runs with real helpers. Existing regexes would still match because the detail is kept as a prefix. The QA run with S=2 used a fixture helper of about 150 ms and happened to finish cleanly.
- **Required outcome:**
  - After at least one valid `held` result, a retry that times out, fails or returns invalid output must end in the standard held refusal: the detail, "No second gateway was started", and the do-not-stop / do-not-delete guidance. The incomplete recheck's cause can be appended as metadata only.
  - Add a native test with S≥3 and a persistently held helper that takes about 700–1000 ms. Assert the held guidance appears and no gateway starts, whether or not the final retry timed out.
  - Skipping retries that can't finish in time is optional and not required.
  - Add a note to #459 that kills on the final retry are now routine.

## Should fix in the same pass (cheap)

### F2. The oversized-stdout test passes even without the oversize check

- **Severity:** P3 (test validity).
- **Where:** `tooling/scripts/windows-launcher-helper.acceptance.mjs:206`.
- **Introduced:** yes, new test.
- **Problem:** the first 256 KiB of the payload (`identity + 'PRIVATE_HELPER_OUTPUT'…`) is already invalid, so the regex rejects it anyway. Deleting `!stdout.Oversized &&` at `Launcher.cs:257` would still pass. `docs/10` and the contract both claim coverage of "oversized stdout with a valid prefix", so the claimed coverage isn't actually tested.
- **Required outcome:** pad with whitespace so the retained prefix is valid after `Trim()`. For example `identity + ' '.repeat(300_000) + 'PRIVATE…'`, or the ownership variant `{"state":"free"}` + padding with `startGateway=false`. Removing the oversize check must then fail the test.

## Non-blocking (optional or deferred)

- **`docs/10-testing-and-quality.md:3-9`:** the new paragraph opens with "also" but comes before the paragraph that introduces `pnpm test:windows-launcher`. Move it after that paragraph.
- **`Launcher.cs:209-210`:** `Drain` only catches `IOException` and `ObjectDisposedException`. Any other read failure surfaces through `Task.WaitAll` as a generic, stage-less `AggregateException` message. That still fails closed and is very unlikely on anonymous pipes. Optional.
- **New suite location:** it compiles into `%TEMP%`, not `.tmp/windows-launcher-*`, so CI uploads no artifacts when it fails. Optional.
- **Not demanded (preference or out of scope):** gateway readiness still uses `DateTime.UtcNow` (`:371`, unchanged code). Job-object or tree cleanup of helper descendants stays with #459. No API import split.

## Checked and found correct

- **.NET Framework pipe behaviour:**
  - `WaitForExit(int)` doesn't wait for EOF when the timeout isn't -1.
  - `Process.Close()` doesn't close the redirected streams, so pending drains survive disposal.
  - `FileStream` maps `ERROR_BROKEN_PIPE` to EOF.
  - `ReadAsync` on a synchronous pipe stream runs on thread-pool threads.
  - SafeHandle reference counting prevents `CloseHandle` from running during a pending `ReadFile`.
  - `Task.WaitAll` on the STA main thread uses a slim event on 4.5 and later.
  - The inherited-descendant test exercises all of this end to end.
- **Single budget:** one stopwatch covers process start, exit and EOF. The kill path handles both `InvalidOperationException` and `Win32Exception`, and only `exited && drained && exit 0 && !Oversized && !Failed && valid UTF-8 && regex` is accepted.
- **Privacy:** messages and the slow-success log contain only stage, timing, budget and byte counts. Parsing errors from `JavaScriptSerializer`, which used to echo raw content, are now sanitized.
- **Removed third ownership check:** safe. The API's exclusive lock and the launch/port mutexes still protect the store.
- **Budget arithmetic:** ≤ 300000 ms fits in an int. Existing tests with S=1 keep a 15 s helper floor. The docs and CHANGELOG describe behaviour accurately, apart from F1's effect on the troubleshooting guidance.
- **Other tests:** every public test except F2 fails if its guard is removed, including the UTF-8 `α` assertion and both directions of the inherited-pipe test.

## Remaining verification limits

- This review was read-only. I compiled and ran nothing, and I checked none of the evidence hashes.
- The browser functional regression CI job was still running at the checkpoint and is required before merge.
- Full local Windows coverage couldn't complete because of symlink/POSIX `EPERM` errors in unchanged infrastructure tests. Only the Linux CI coverage gate passed.
- No suite covers persistent held ownership with S>2 (F1).
- The wall-clock windows (15–19 s, under 8 s) may be flaky on slow runners.
- The historical stall's cause is still unproven, and nothing here establishes it.

**Next step:** one targeted correction pass for F1 and F2, then a focused re-review of those two changes plus the native suite and CI.

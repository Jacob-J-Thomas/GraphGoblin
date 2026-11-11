# Corrected guard and protected-PID verification

Date: 2026-11-10 (America/Chicago). Runtime: project Node `v22.23.4`, native Windows.
PR: [#457](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/457).

## Current outcome

The F1–F4 correction batch passed `pnpm test:windows-launcher`: **14 tests passed, zero failed or skipped**, 145.7 seconds. The final raw output is [guard-native.txt](guard-native.txt). The API's focused checks also passed **72/72**, retained in [guard-focused-tests.txt](guard-focused-tests.txt). This report records engineering QA; final opposite-family review, CI, merge and owner deployment remain separately recorded in the PR.

The corrected source was built in the isolated `windows-lock-guard-fix` worktree before this run. Source and built-module hashes below identify the tested bytes independently of the subsequent commit/cherry-pick.

## Superseded initial conclusion

The initial six scenario groups and native launcher checks passed on the first candidate, but they did not establish direct cross-process exclusion. The six contenders in the initial independent probe shared one process and were serialized by `acquiringPaths`; native launcher clicks used a Windows mutex.

A later independent five-process reproduction found **4, 3, 4 and 4 simultaneous owners** across four candidate trials. Successful holders remained alive until every contender reported. The unchanged baseline refused all five contenders for the same live-PID identity-mismatch seed. That was a P1 blocker: stale readers could unlink replacement `.reclaim` files during asynchronous identity probing. The [finding](cross-process-race-finding.md), [reproduction](cross-process-race.mjs), [raw results](cross-process-race-results.json) and [raw output](cross-process-race-output.txt) are retained. The initial [independent report](independent-qa.md) is historical, not current readiness evidence.

## Opus pass-one dispositions

[Claude Opus 5.5 pass one](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/457#issuecomment-6782912430) reviewed `84802cadd51daf1895787ebff410f3f7a4c184df`. All four findings are **FIX-IN-PR**.

| Finding                                                                               | Correction                                                                                                                                                                                                                                                                                                                                                         | Verification                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1: cross-process reclamation can replace a live owner                                | Publish a nonempty physical guard directory atomically, containing one immutable UUID-named marker with the matching token. A stale contender removes only the observed UUID marker, then attempts removal of the empty directory. A successor's different marker prevents removal/overwrite. Regular-file and malformed guards are refused rather than converted. | Three permanent trials, five independent built-API processes each; exactly one live acquisition in every trial, with all successful acquisitions held until every contender reported. On-disk PID matched the sole owner.                                               |
| F2: transient failure of the mandatory self-identity probe blocks startup too quickly | Two bounded self-identity attempts of 20 seconds each; cache only successful self identity. Foreign probes remain five seconds and fail closed. Exhaustion reports the specific reason and writes no ownership files.                                                                                                                                              | Focused unit checks cover retry, bounds, caching and failure. Final native startup/restart checks passed. No claim that an actual 40-second WMI outage was induced.                                                                                                     |
| F3: uncertainty is reported as if an owner were definitely live                       | Shared helper returns structured state and diagnostic detail; the launcher distinguishes a confirmed live owner from unverifiable/malformed ownership and retains inspection guidance.                                                                                                                                                                             | Native shared-database and matching-identity cases require live-owner wording; malformed, PID-only, inaccessible and regular-file-guard cases require unverifiable wording and preserve bytes/no gateway writes.                                                        |
| F4: no new-format regression against an actually inaccessible process                 | Discover a real system/service PID for which `Process.get_HasExited` produces Win32 error 5 while WMI can read `CreationDate`. Seed a different valid identity in both locks and UUID-directory guards. Discovery failure fails the test; it never silently skips.                                                                                                 | Selected `csrss.exe`, PID 1068. Read-only helper reported free and preserved fixture bytes. Gateway PID 17896 started successfully. The system process retained exactly the same creation identity afterward; no system-process signal or permission change was issued. |

## Final native matrix

| Behavior                                                                                                          | Result                    |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Concurrent cold launch, warm reuse and detached gateway lifetime                                                  | PASS                      |
| Wrong configuration/store and shared external database refusal                                                    | PASS                      |
| Normal drain and shell shortcut cold relaunch                                                                     | PASS                      |
| Native HWND metadata and cross-process relaunch                                                                   | PASS                      |
| Plain-health listener and eight repeated silent TCP listener refusals                                             | PASS                      |
| Malformed ownership, matching identity, PID-only record, inaccessible PID and old regular-file guard preservation | PASS                      |
| Reused live PID with former identity in both main locks and both directory guards                                 | PASS                      |
| Actual inaccessible system PID with queryable different creation identity                                         | PASS                      |
| Direct independent API contention: three trials × five contenders                                                 | PASS, one owner per trial |

The first native run of this batch used stale pre-F3 message assertions and reported three assertion mismatches while the expected refusals occurred. Those assertions were corrected; the clean final run above passed all 14 tests. Its original raw output remains outside the repository as `guard-native-initial.log` in the local QA directory.

## Tested byte identities

SHA-256:

| File                                              | Hash                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| `apps/api/src/data-dir-lock.ts`                   | `BD6DA825ABC58C694FF9895DFC9E9185716668925613804E0198E8B090AA4265` |
| `apps/api/src/windows-process-identity.ts`        | `EA44E331A9B0A3B42F2B7FC45C8456B5756AFE8512E97A6DA8948BD3950B237E` |
| `apps/api/src/instance-identity.ts`               | `6E1186EF65B905E54483AC30C5A183A8D6D44C0D676D428B746FC588F556C016` |
| `apps/windows-launcher/Launcher.cs`               | `E0D65FFA91DFC3F3F8D2E7A8C0F86E753288C5595BC54E9D83BD010D71EBB92B` |
| `tooling/scripts/windows-launcher.acceptance.mjs` | `D09EC249463C9375C685C237AEC9BE3394DB225C17D63D7E6DC5AF68974A36F6` |
| `apps/api/dist/data-dir-lock.js`                  | `C8DA8E336ACF9D66957CF6EA365869013CCBAC3331C889D9FA002CFD0770C794` |
| `apps/api/dist/windows-process-identity.js`       | `06BE670FD2587DA19751CF2E73A563246C6F59697D22D246FF82F5222D77D09B` |
| `apps/api/dist/instance-identity.js`              | `9D1A89B2ED60B4DAD4127F337A38AF8E98F337E9EF358E1C10F2C05744F3E9F6` |

## Scope and limits

No actual host reboot was performed. PID reuse was simulated using a different valid creation identity while the unrelated process remained alive, including an actual inaccessible Windows process. All acquired gateways, ownership files and ports belonged to disposable fixtures. The owner store and port 4747 were untouched. No provider turns, permission relaxation, system-process termination or data conversion occurred.

The new guard protocol can leave an ignored staging sibling if its creator dies before publication; this report does not claim automatic cleanup of all staging directories. Its ownership safety comes from immutable marker names and nonempty-directory publication, not from timestamp age or a second non-atomic content read.

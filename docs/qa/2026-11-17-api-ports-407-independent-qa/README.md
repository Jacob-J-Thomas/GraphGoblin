# Original independent behavior QA for #407

Claude Opus 5.5 xhigh tested the original candidate on Windows 11 with Node v22.23.4, pnpm 12.8.1, and Vitest 5.0.3. The isolated QA checkout matched the 13 frozen candidate sources, and its rebuilt API entry matched the implementation's hash. The tests ran through the real API Vitest setup with assigned ports 63800-63819. [Source receipts](05-sources-after-build.json), [host facts](08-host-facts.txt), [original implementation](../2026-11-17-api-ports-407-implementation/README.md)

## Original findings

- **D1, Windows wildcard listeners.** A built API fixture received port 63805 even though a separate process was already listening on `0.0.0.0`. IPv4 loopback requests reached the API while it ran. The local control also reproduced the mismatch for a dual-stack `::` listener. The foreign sentinels kept running. The original loopback-only probe carried this behavior forward from the baseline. [Built API witness](r2-s2-foreign-failed-startup/S2-observations.jsonl), [native bind matrix](07-n5-native-bind-semantics.log.txt)
- **D2, Windows claim contention.** Two workers competing for one port recorded **25 raw `EPERM` mkdir errors in 17,490 attempts**, with **1,881 grants**. The stress test recorded zero duplicate grants and zero release errors. The original claim-directory protocol introduced this failure path. [Per-worker counts](r4-n6-stress/N6-observations.jsonl), [failing Vitest run](r4-n6-stress/vitest.log.txt)

Both findings were open at the end of this QA round. The author correction and later independent correction QA have their own source bindings and outcomes. [Correction](../2026-11-17-api-ports-407-correction-01/README.md), [correction QA](../2026-11-17-api-ports-407-correction-independent-qa/README.md)

## Other observed behavior

Two actual workers held distinct ports in one Vitest run. Reservation held through child restart and settlement. Invalid and exhausted ranges were refused, and stale release preserved the replacement claim. The final port and process checks were clear. [Two-worker witness](r1c-s1-two-worker-corrected2/S1-observations.jsonl), [local cases](r3-n-local/N-observations.jsonl), [port cleanup](12-ports-final.json), [process cleanup](13-processes-final.json)

The first two witness attempts recorded QA harness failures. One assertion confused a replacement claim with the old claim. Another connection landed on a peer's brief bind probe. The original files and their later corrected witness are retained. [First failure](r1-s1-two-worker/vitest.log.txt), [second failure](r1b-s1-two-worker-corrected/vitest.log.txt), [harness correction record](09-harness-corrections.md.txt)

All 135 original artifacts and their seal are preserved. [Full raw report](source-readme.md.txt), [original seal](SHA256SUMS.json), [publication manifest](publication-manifest.json), [evidence index](../2026-11-17-api-ports-407/README.md)

# First private installer CLI behavior QA (#436)

This archive preserves one bounded Opus behavior QA run against the frozen #436 candidate, focused on the private `--validate-install` and `--stage-shortcut` commands. It is component evidence, not full QA acceptance, CI, formal review, owner acceptance, or #436 completion.

## Result

- Actual reviewer: Claude Opus 5.5 at xhigh effort; provider exit 0 means the report completed.
- The native harness executed 22 of 23 planned cases and recorded 298 of 300 checks passing. Twenty-one cases passed; C11a was the first failure. The stop rule left C11b unexecuted.
- C11a passed `C:rel-config\GraphGoblin.exe.json` from the child working directory and exited 0. The strict private path contract expected exit 1 and `Invalid staged launcher configuration path.` Root triage records F1 as `FIX-IN-PR`; the public PowerShell parameters may remain relative and keep their existing resolution behavior.
- The harness itself exited 2 because of a separate Windows PowerShell 5.1 post-processing error after the failed case was recorded. The `finally` path wrote the matrix outcome and receipts. This harness error is distinct from C11a.

The external [private-path correction packet](../2026-11-16-installer-private-path-correction/README.md) records the narrow implementation and focused regression. At this archive checkpoint its independent regression was pending; this Opus run does not verify the correction.

## Evidence and limits

`full-report.md.txt` is the report byte-for-byte. `launch.json`, `exit.json`, `provider-final-message.md.txt`, and `root-triage.json` retain the safe launch/result and disposition provenance. `work-evidence.zip` is a local archive made from the complete owned `work/` directory. It contains 106 files totaling 369,996 uncompressed bytes; the pre-archive walk found no filesystem reparse points. `work-member-inventory.json` maps each original relative path to its ZIP member and verifies byte length and SHA-256 for every member. This ZIP was generated locally for evidence preservation; it is not a GitHub artifact.

The fixtures used inert Node, ChromeProxy, and final-EXE canaries. The run did not use a real Node process, Chrome, a browser/PWA, an owner profile, or an owner store. It did not use ETW, directly observe named mutexes, or automate UI dialogs. It was not the public 32-case installer matrix or rollback QA.

`events.jsonl`, `result.json`, and `stderr.log` are excluded; provider-private event/result data is not published, and stderr is empty. `latest.md` is omitted because it is byte-identical to the retained `provider-final-message.md`. No files from `work/` are copied separately; use the ZIP and its per-member inventory.

See `source-copy-map.json` and `SHA256SUMS.txt` for source provenance and packet hashes.

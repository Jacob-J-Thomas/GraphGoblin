# #435 hosted Windows old-source baseline

The Windows job reproduced silent helper execution and native cold refusal on both a real junction and a real Windows directory symlink. Both reparse points had their expected native types and neither alias started a gateway. The job failed the intended candidate-positive assertions. [Windows job 133039259616](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43787801176/job/133039259616) · [Exact decoded job log](windows-job.decoded.log)

## Build identity

PR #492 run 43787801176, attempt 1, Windows job 133039259616 built synthetic merge `07738c4dfe978d19669e4505e8fed5ae440825ea`. Its parents were post-#419 main `9fa8b2474c7290adb800c5e26be73511095cae25` and test-only head `08e60a0ae6d6b7cae853326825365760166f3ad3`. Its tree `1796a01ad3b9abe39e4e9775cc6ae339897e6b37` matched that head. The head changed only `tooling/scripts/windows-launcher.acceptance.mjs`, verified at SHA-256 `4cac8f617ebe4d96e8b54c4ba0bfe3c5a4647e284480b97f77fe0e847281c4ee`. The identity helper source matched the target at SHA-256 `6e1186ef65b905e54483ac30c5a183a8d6d44c0d676d428b746fc588f556c016`. On the `windows-2025-vs2026` image, Node v22.23.4 built all 12 tasks successfully before native acceptance. [Run metadata](actions-run.json) · [Job metadata](windows-job.json) · [Exact checkout commit](checkout-merge.json)

## Native observations

| Actual alias | Link metadata | Aliased helper | Native aliased cold launch |
| --- | --- | --- | --- |
| Junction | `Junction`, Directory and ReparsePoint true | Identity and store-state exited 0 with empty stdout and stderr | Exit 1 with existing runtime/configuration/ownership refusal. No gateway spawned. |
| Directory symbolic link | `SymbolicLink`, Directory and ReparsePoint true | Identity and store-state exited 0 with empty stdout and stderr | Exit 1 with the same refusal. No gateway spawned. |

Each canonical helper returned one lowercase digest and LF with empty stderr. Both alias imports were inert, both stores were empty before cold launch, and the fixture recorded owned cleanup with no listener/log/leases from the refused attempt and the alias unlinked. Both new subtests then failed at `assert-cli`. Later successful native warm and wrong-config checks for the new alias paths require candidate evidence. The existing launcher readiness/reuse and independent contention groups passed. The step reported 17 tests, 14 passes, three failures and zero skips. The failures were both new alias subtests and their enclosing group. GitHub’s artifact step warned that its configured path matched no files. The job log retains both structured records. [Independent parsed observations](independent-readback.json) · [Job log](windows-job.decoded.log)

The log’s connector response is serialized without modifying the log field. The decoded file is its exact log string encoded as UTF-8, 52,654 bytes, SHA-256 `119b5186afa2d98fc015ea8ac44a5e1cf9107802fe23661501a33781d8ecbe85`, ending with the connector’s existing CRLF. The first offline inspector preserved the decoded file but rejected the TAP reporter’s doubled JSON backslashes. The corrected inspector undoubled those backslashes only when reading the two derived diagnostics and independently confirmed the log file was byte-identical. [Raw connector response](windows-log-connector-response.json) · [First offline inspector outcome](readback-first-failure.txt) · [Corrected offline inspector](verify.mjs) · [Node 22 TAP escape readback](tap-reporter-escape-readback.json)

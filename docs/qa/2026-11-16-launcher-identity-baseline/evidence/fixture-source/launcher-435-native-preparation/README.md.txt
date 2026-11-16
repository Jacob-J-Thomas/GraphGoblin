# Windows launcher acceptance for GraphGoblin #435

## Scope and evidence

This packet prepares a Windows junction reproduction and acceptance run for the existing launcher and the compiled instance-identity CLI. The preparation source is isolated checkout commit `615d50bc358d73bc55ad0591f4f625f1a46cb671`. Use the actual refreshed base after #381, #410, and #419 merge. Bind the base and later candidate separately before use. Neither phase has run. [Issue #435](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/435)

The run invokes the ordinary built identity CLI and a real native Windows x64 launcher compiled from the bound checkout’s `apps/windows-launcher/Launcher.cs`, using the Framework compiler configuration from `tooling/scripts/windows-launcher.acceptance.mjs`. The launcher uses its product `--config <file> --ensure-gateway` entry. The gateway therefore starts through the production Windows process creation path and serves real TCP and file SQLite. The harness writes the disposable config directly with the alias preserved exactly. This entry does not open a Chrome window.

The fixture proves one actual directory junction to the same checkout. The junction and config paths exercise spaces and Unicode. The junction name also contains a percent sign. Additional volume types, symlinks, and OS families have no runtime observations here. A later Mac user-path check remains #456. Installer staging, collision/dependency validation and transaction handling stay with #436. Log checks here only identify whether an unexpected gateway launch began. Persistent log retention stays with #438. Helper pipe handling and deadline changes stay with #458 and its held PR #460. [Issue #436](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/436), [Issue #438](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/438), [Issue #458](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/458), [PR #460](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/460)

## Matrix

| Route | Baseline observation to test | Candidate acceptance |
| --- | --- | --- |
| Built CLI direct, including a relative entry | Exit zero, one lowercase SHA-256 digest followed by exactly one LF, empty stderr | Same output contract and same digest for equivalent effective settings |
| Built CLI junction, same store and port as direct | Predicted exit zero with empty streams from the current entry-point guard. The run records the actual bytes and fails if the prediction is incompatible. | Same digest as direct, exactly one record, empty stderr |
| Read-only `--store-state` | Real path reports `{"state":"free"}` before start and `held` with the actual directory lock during a live launch. Predicted silent alias behavior. | Direct and junction each report free before start and held during their native live launch. Store remains empty through the prelaunch matrix. |
| Import and invalid inputs | Module import is inert through either spelling. Direct invalid port gives the existing generic diagnostic and exit one. Predicted silent alias config probe. A missing helper file gives Node’s module-not-found error. | Inert import and missing-entry outcomes preserved. Both direct and junction execution emit the existing invalid-config diagnostic and exit one. Native unknown option and missing configured checkout are refused. |
| Native real checkout cold and warm | Fresh gateway starts and second native launch reuses it. Cross-spelling warm launch predicted to refuse before opening another writer. | Fresh gateway starts, and second native launch and junction warm invocation reuse the exact same process. |
| Native junction cold and warm | Predicted cold refusal with a closed port, empty store and no gateway log. This supplies no native baseline aliased warm-success observation. | Fresh gateway starts with its own store. Same-spelling and real-checkout warm invocations reuse the exact process. |
| Wrong store and effective config during a healthy launch | Wrong store or changed `GG_REQUIRE_API_KEY` each computes a different identity. Native should refuse to reuse the live process, with its exact owner retained. | Repeat both controls against each real or junction cold-started gateway. Original process, serving digest, PID, both lease bytes and lease identity survive. Wrong-store path remains empty. |

Path-alias equality is always compared with the same port, data directory and effective settings. The independent alias cold case computes a canonical expected value for its second fresh port and store. Within any one phase, compare equivalent config fingerprints and actual gateway header values. Literal runtime digests across phases can depend on absolute build paths.

For each admitted cold start, the harness checks `/healthz`, process image, argv, parent PID, and Win32 process creation filetime, and matches that PID plus creation identity in both lock records. It also checks the file SQLite signature in the exact store. Successful responses from `/app/` and `/goblin/` and one referenced JavaScript asset from each match the bound build’s bytes. These are static HTTP readbacks. The recorded argv and both fixture paths show whether the launcher passes the alias through to the child.

## Execution prerequisites

1. Root reviews the sealed packet and separately authorizes one named phase against a clean, isolated, built checkout. Record Git head, index/worktree state, source bytes, built API and web outputs, workspace links and dependency inputs needed by the build, and the project Node executable. Bind the Framework64 C# compiler and the system Windows PowerShell used for process and file queries. Record the exact command and parent process, plus the absence of competing admitted jobs in the owned environment. Root performs post-run binding independently.
2. Run the exact project-scoped Windows Node v22.23.4 with no preload, flags or `NODE_OPTIONS`. Use a fresh evidence name under this packet. Root’s later run wrapper should capture runner PID and creation identity, stdout and stderr, and the real runner exit and stream-close records before interpreting the result.
3. The harness allocates two fresh ephemeral IPv4 loopback ports, checks for refusal before use, and rejects 4747 and 4748. The service env comes from the launcher’s explicit settings plus an allowlisted system environment. Host is `127.0.0.1`, local SQLite store is isolated inside the fresh evidence directory, logs are informational, API key requirement is false except for the deliberate mismatch, and Ollama and Swagger UI are disabled. No auth tokens or provider credentials are inherited. Startup timeout is 30 seconds and window timeout is two seconds. There are no requests to preflight endpoints, workflow/run starts, or provider calls.
4. Use either phase literally as admitted. Replace the isolated path and fresh name only with the root-bound values.

```powershell
$qaNode = 'C:\Users\98jak\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64\node.exe'
$qaHarness = 'C:\Users\98jak\graphgoblin-qa\2026-11-13-aidlc-batch\launcher-435-native-preparation\run.mjs'
& $qaNode $qaHarness baseline '<bound isolated checkout>' 'evidence-baseline-first'
```

## Receipts and resource ownership

`runner.json` records the input binding. The native runner creates individual attempt, spawn and outcome receipts in the owned temporary directory, with argv, PID, observed exit/close, and bounded stdout/stderr. Each verified cold gateway identity is written immediately as its own receipt. `summary.json` records case results and cleanup. The first assertion failure creates `first-failure.json` before any cleanup. A failed baseline prediction or a candidate incompatibility remains reviewable evidence and ends the run. The harness does not repeat launches to recover an assertion. The overall 245-second watchdog is an evidence boundary. Keep its raw exit output, the per-process receipts and any unresolved gateway identity if it triggers.

Only a gateway with an exact verified identity is eligible for the ordinary shutdown drain. The harness verifies the same live PID/creation/digest/lock evidence, queries for active runs, reads the current shutdown control token without printing it and requests a managed drain. It observes listener refusal, release of both lease and recovery guard paths, and absence of the original PID/creation pair. A failed or ambiguous launch may leave evidence and a live process for operator readback. Network requests are confined to the two candidate loopback ports. The direct child handle may stop only a timed-out helper, compiler or read-only probe that the harness launched itself.

Deletion on a passing run is restricted to the exact owned junction entry, and exact regular SQLite files and disposable key files under known owned stores. The harness verifies real paths, holds simultaneous exclusive Windows read handles to the owned files and confirms directory membership again before unlink. It does not read the key. The evidence directories, inputs and native log files remain available. A failed execution preserves the first failure and skips further destructive store or junction cleanup. The owner checkout, store, processes, shortcuts and configured ports are outside this packet.


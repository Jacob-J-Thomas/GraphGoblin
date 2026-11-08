# #439 - Codex configured plugin inheritance

Implementer evidence, 2026-11-07, baseline `bb8c4afa0c5a83ae92631d5df800bb131445c02b`. Policy: [ADR-0065](../../decisions/ADR-0065-codex-inherits-configured-plugins.md). This record establishes engineering behavior; independent opposite-family review and QA remain separate delivery gates.

## Native method

Run after building the adapter and its workspace dependencies:

```powershell
node docs/qa/2026-11-07-439-plugin-inheritance/scripts/native-plugins.mjs
```

The [reproduction script](scripts/native-plugins.mjs) creates a disposable `CODEX_HOME`, working directory, local marketplace and harmless fixture plugin under one `gg-439-plugin-*` temporary directory. It uses the actual `CodexHarness`, SDK and pinned native CLI 0.160.0. The fixture home also configures a standalone MCP server with a distinct echo tool. It supplies a minimal environment, without owner credentials or provider keys, and configures a loopback Responses endpoint on an ephemeral port. No owner service/store, ports 4747/4748, real Jev or remote provider is used. The script retains the fixture directory for inspection; the orchestrator cleaned the recorded fixtures after evidence capture and independent verification, as recorded below.

The Responses fixture returns a native `functions.exec` custom-tool call. Inside the **actual CLI worker**, that call reads `ALL_TOOLS`, records the fixture tool names, invokes each available fixture tool, and returns its constant marker. The fixture verifies the subsequent model request contains the worker's tool output and `GG439_PLUGIN_OK` or `GG439_STANDALONE_OK`. This exercises real plugin loading, MCP initialization, tool registration and invocation through the worker. It is stronger than an argument snapshot or process tree; the model responses themselves are controlled, so it does not establish a real model's tool-selection behavior or third-party plugin health.

MCP clients start concurrently. The local model fixture waits 300 ms before its first synthetic tool call so immediate fixture responses do not depend on ordinary model latency. Each MCP process records its own PID and `started`, `tools/list` and `tools/call` events. Windows cleanup checks match both recorded PIDs and the unique fixture command path; a reused PID alone is not a surviving child. Completion and cancellation must leave no matching fixture process. The cancellation case holds a model request open after the enabled plugin starts, then calls `HarnessSession.cancel()`.

The [native result](native-result.json) preserves per-case worker outputs, MCP lifecycle events, listing arguments/names, reported errors and cleanup results. No full owner prompt, configuration or credentials are collected. Its synthetic home path and process IDs are disposable fixture identifiers.

**Result:** all 15 native scenarios matched their documented expected outcomes on Windows with Node v22.23.4 and CLI 0.160.0. The two CLI-limit scenarios establish the limitations described below, rather than plugin health. All fixture MCP children ended after completion or cancellation. Remote provider calls: 0.

Raw evidence SHA-256:

```text
46319dedaaf1d3804f113f49fda9211d91682b52ebada728a36f7a16ac835546  native-result.json
3e16d42466807857e8132e6f9e03a84f2d5265040afe0b571f637589379c0ab8  scripts/native-plugins.mjs
```

## Independent native rerun

Root/Astra independently reran the same 15-case native fixture on stacked commit `df4447bc5e4db20c031463b72323b47715edc2fc`, built on catalog commit `d1563fe83af812f1b74d6520a621f5ab9c03a0dd`. All 15 scenarios matched their expected outcomes, the script exited 0, remote provider calls remained 0, and fixture MCP children were confirmed gone. The [independent result](independent-native-result.json) and [invocation log](independent-native.log.txt) preserve that rerun. The original implementer result above was restored byte for byte and its hash reverified. Required opposite-family review and QA remain separate gates.

Root removed its independent fixture directory `gg-439-plugin-BjM72V` after a dry run reported no links and all children were confirmed gone. The evidence files remain retained here.

The implementer's final fixture was retained through independent verification, then root removed exactly the 11 worker-created native fixture directories, including the exploratory attempts and final `gg-439-plugin-Y3OClM`. Each cleanup dry run reported zero links, no matching fixture MCP children remained, and all 11 paths were absent afterward. The raw results, scripts and independent evidence remain preserved. The [worker cleanup manifest](worker-cleanup-manifest.json) records the exact paths; root also retains the delivery cleanup record `delivery/plugin-worker-cleanup.json`.

```text
e011eea7808051e5977c28ca61fff7d07d3288e781d3588955881315c435f229  independent-native-result.json
```

## Covered behavior

| Case                               | Expected observation                                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Enabled configured plugin          | Worker advertises and successfully calls the plugin echo tool.                                                                                                           |
| Resumed conversation               | Same inherited tool works on the resumed thread.                                                                                                                         |
| Structured completion              | Common harness inherits the tool and returns the requested JSON object.                                                                                                  |
| Node `features.plugins=false`      | Plugin echo is absent.                                                                                                                                                   |
| Standalone MCP node opt-in         | Standalone echo and inherited plugin echo both execute.                                                                                                                  |
| Individually disabled plugin       | Plugin echo is absent, including with node `features.plugins=true`.                                                                                                      |
| Globally disabled feature          | Plugin echo is absent; explicit node feature enable restores the configured enabled plugin.                                                                              |
| Trusted project disables plugin    | Project-layer disable wins over home enable.                                                                                                                             |
| Legacy root `profile` setting      | CLI-reported unsupported configuration refuses before any model request, with repair instructions. The SDK exposes no `--profile` selector; this change adds none.       |
| Invalid typed plugin configuration | CLI error refuses before any model request and retains the actual diagnostic.                                                                                            |
| Cancellation after plugin starts   | Abort settles and the fixture child is gone.                                                                                                                             |
| Discovery separation               | Every successful listing includes only the standalone server and receives discovery-only `features.plugins=false`; default turns still expose the inherited plugin tool. |

The default turn's absence of either `features.plugins=true` or `false` is also established through the real SDK's argument construction in `src/isolation.test.ts`. Those tests cover node feature opt-in/out, fresh/resumed/structured usage, standalone overrides, unrelated isolation defaults, and precedence of SDK model, effort, sandbox, approval, network and web-search settings. Existing invalid-key and prototype-pollution refusal tests remain. A long-warning regression confirms bounded errors prioritize the CLI's configuration diagnostic.

## Pinned CLI limits, tracked in #442

Two native reproductions deliberately preserve the normal CLI behavior:

- `cli-limit-unknown-enabled-plugin-id` adds an unknown enabled ID alongside the valid fixture. The CLI silently ignores the unknown ID while the valid plugin still works.
- `cli-limit-missing-plugin-mcp-file` points the installed fixture manifest at a nonexistent MCP file. The CLI still completes the turn, with no fixture tool available.

These are **observed limitations**, not passing plugin-health checks. GraphGoblin adds no fallback plugin set or forced enablement. [#442](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/442) tracks broader diagnostics; #439's configuration-error criterion covers errors the CLI actually reports. No inventory/filesystem validator or general plugin manager is part of this change.

## Repository gates

- Focused harness, isolation and structured suites: 73 passed.
- Adapter typecheck and lint: passed.
- On stacked commit `df4447bc5e4db20c031463b72323b47715edc2fc`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm check:layers`, `pnpm check:migrations`, `pnpm check:tokens`, `pnpm check:deps`, `pnpm check:templates`, `pnpm check:licenses`, `pnpm check:docs`, `pnpm check:contrast`, and `pnpm format:check` all passed. Logs are the adjacent `gate-*.log.txt` files, including [build](gate-build.log.txt), [typecheck](gate-typecheck.log.txt), [lint](gate-lint.log.txt), and [format](gate-format-check.log.txt).
- Environment: project Node v22.23.4 first on PATH; `TURBO_CONCURRENCY=1`, `TURBO_ENV_MODE=loose`, `VITEST_MAX_WORKERS=1`, and `LIVE=0`. Gates ran sequentially.
- Full adapter coverage on the same stacked commit: `pnpm --filter @graphgoblin/adapter-codex exec vitest run --coverage --maxWorkers=1` passed with 642 tests passed, 4 live tests skipped, 99.42% lines and 95.61% branches ([successful full retry](gate-adapter-codex-coverage-retry.log.txt)). Existing coverage thresholds and test timeouts were unchanged.
- The [first adapter coverage run](gate-adapter-codex-coverage.log.txt) had 641 passed, 4 skipped, and one unchanged readiness-probe test timing out at 5.137 s against its 5 s limit (`probe-directory.test.ts`, collision case 1). Its [isolated retry](gate-probe-directory-retry.log.txt) passed all 4 tests unchanged. The one planned full retry then passed after the orchestrator released a quieter native-test slot. These observations do not establish the original timeout's cause; no timing assertion or coverage exclusion was changed.
- Gate scope: full adapter coverage plus the native common-harness fixture establish this slice's configuration and worker boundary. No API contract or route changed, so no additional focused API boundary test was selected. This plugin branch did **not** run repository-wide coverage or the complete `pnpm check`. The final integrated UI/batch branch must run the full batch `pnpm check`, and all four PR CI jobs remain required; those integration/CI gates are pending in this implementer record.
- After the final evidence-only README updates, its focused Prettier check and `git diff --check` passed.

Claude Opus 5.5 completed the full source review on `aed1446` against `d1563`. The [preserved report](review-1-report.log.txt) and [root disposition/documentation correction record](review-1-disposition.md) distinguish the accepted F1/F2/F3 documentation fixes from the rejected new owner-acknowledgement gate. A targeted documentation-delta review remains pending; this is not recorded as an approved review. The separate root rerun above completed native QA; the documented service-authority possibilities do not expand its harmless echo-tool evidence into live mutating-tool proof.

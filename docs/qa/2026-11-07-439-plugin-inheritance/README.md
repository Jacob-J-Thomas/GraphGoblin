# #439 - Codex configured plugin inheritance

Implementer evidence, 2026-11-07, baseline `bb8c4afa0c5a83ae92631d5df800bb131445c02b`. Policy: [ADR-0065](../../decisions/ADR-0065-codex-inherits-configured-plugins.md). This record establishes engineering behavior; independent opposite-family review and QA remain separate delivery gates.

## Native method

Run after building the adapter and its workspace dependencies:

```powershell
node docs/qa/2026-11-07-439-plugin-inheritance/scripts/native-plugins.mjs
```

The [reproduction script](scripts/native-plugins.mjs) creates a disposable `CODEX_HOME`, working directory, local marketplace and harmless fixture plugin under one `gg-439-plugin-*` temporary directory. It uses the actual `CodexHarness`, SDK and pinned native CLI 0.160.0. The fixture home also configures a standalone MCP server with a distinct echo tool. It supplies a minimal environment, without owner credentials or provider keys, and configures a loopback Responses endpoint on an ephemeral port. No owner service/store, ports 4747/4748, real Jev or remote provider is used. The fixture directory is retained for inspection.

The Responses fixture returns a native `functions.exec` custom-tool call. Inside the **actual CLI worker**, that call reads `ALL_TOOLS`, records the fixture tool names, invokes each available fixture tool, and returns its constant marker. The fixture verifies the subsequent model request contains the worker's tool output and `GG439_PLUGIN_OK` or `GG439_STANDALONE_OK`. This exercises real plugin loading, MCP initialization, tool registration and invocation through the worker. It is stronger than an argument snapshot or process tree; the model responses themselves are controlled, so it does not establish a real model's tool-selection behavior or third-party plugin health.

MCP clients start concurrently. The local model fixture waits 300 ms before its first synthetic tool call so immediate fixture responses do not depend on ordinary model latency. Each MCP process records its own PID and `started`, `tools/list` and `tools/call` events. Windows cleanup checks match both recorded PIDs and the unique fixture command path; a reused PID alone is not a surviving child. Completion and cancellation must leave no matching fixture process. The cancellation case holds a model request open after the enabled plugin starts, then calls `HarnessSession.cancel()`.

The [native result](native-result.json) preserves per-case worker outputs, MCP lifecycle events, listing arguments/names, reported errors and cleanup results. No full owner prompt, configuration or credentials are collected. Its synthetic home path and process IDs are disposable fixture identifiers.

**Result:** all 15 native scenarios matched their documented expected outcomes on Windows with Node v22.23.4 and CLI 0.160.0. The two CLI-limit scenarios establish the limitations described below, rather than plugin health. All fixture MCP children ended after completion or cancellation. Remote provider calls: 0.

Raw evidence SHA-256:

```text
46319dedaaf1d3804f113f49fda9211d91682b52ebada728a36f7a16ac835546  native-result.json
3e16d42466807857e8132e6f9e03a84f2d5265040afe0b571f637589379c0ab8  scripts/native-plugins.mjs
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
- Full build, `pnpm check`, and `pnpm format:check`: results will be recorded after the serialized full-gate slot.

Independent reviewer/QA should rerun the native script and inspect the actual worker-output records, rather than infer tool availability from listing arguments alone.

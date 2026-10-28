# WP-423: loop turns without the machine's personal Codex and Claude extensions

Implementer record for issue #423 (F2 observation O1), 2026-10-27/28. The work branch is based on `main` at `a4fee9a9`. The owner decided option A on 2026-10-27: loop turns switch off inherited plugins, MCP servers and personal features by default, and a node's Codex `configOverrides` turn a specific server back on. The decision is recorded as [ADR-0063](../../decisions/ADR-0063-loop-turns-without-personal-extensions.md).

**Result.** Option A works through the pinned CLI's `--config` surface. No SDK patch change was needed.

- **Before the fix,** on `main`, a real Codex loop turn ran `node_repl.exe` from `[mcp_servers.node_repl]` and three plugin-provided processes: `node.exe`→`node_repl.exe`, `node.exe`, and `cmd.exe`→`node.exe`.
- **After the fix,** a real turn ran only the CLI's own `codex-code-mode-host.exe` and `codex-command-runner-0.160.0.exe` beside the shell command.
- **One server back on.** A node that turns `node_repl` back on gets exactly that server.
- **Claude** turns already ran without the machine's MCP servers, plugins, hooks and skills, so it needed no change.

The brief expected no `codex-code-mode-host.exe` after the fix. That expectation does not hold: the host is part of the CLI itself, and a turn without it ran no command (see "Code-mode host").

Machine: Windows 11, project-scoped Node v22.23.4 (`%USERPROFILE%\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64\node.exe`), pnpm 12.8.1. Codex CLI: the SDK-bundled 0.160.0. Claude Code: 2.1.308.

## 1. CLI investigation (Codex CLI 0.160.0)

No probe in this section reached a provider. The probes:

- `codex mcp list --json`, `codex plugin list --json`, `codex plugin marketplace list` and `codex features list`, each with `--config` overrides;
- `codex exec` against a local server on 127.0.0.1 that holds every request open, with the process tree read by PID;
- temporary `CODEX_HOME` folders that hold only a `config.toml`.

The output records server, plugin and process names, enabled flags and feature states only. Evidence: [cli-investigation.log.txt](cli-investigation.log.txt), from [scripts/cli-investigation.mjs](scripts/cli-investigation.mjs), and [notify-probe.log.txt](notify-probe.log.txt), from [scripts/notify-probe.mjs](scripts/notify-probe.mjs).

| Question                               | Probe                                                                                                      | Result                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Documented switches                    | `codex exec --help`                                                                                        | `-c/--config`, `--enable/--disable <FEATURE>` (= `features.<name>=true/false`), `-p/--profile` (layers a file on top), `--strict-config`, and `--ignore-user-config` ("Do not load `$CODEX_HOME/config.toml`; auth still uses `CODEX_HOME`"). The SDK passes none of the last three.                                                                                                      |
| Does `mcp_servers={}` clear the table? | `mcp list --json -c mcp_servers={}`                                                                        | No. All four servers are still listed: overrides merge into the loaded tables.                                                                                                                                                                                                                                                                                                            |
| A non-table value?                     | `-c mcp_servers=[]`                                                                                        | The configuration fails: `invalid type: sequence, expected a map in mcp_servers`.                                                                                                                                                                                                                                                                                                         |
| One server off                         | `-c mcp_servers.node_repl.enabled=false`                                                                   | `node_repl:off`, the others unchanged.                                                                                                                                                                                                                                                                                                                                                    |
| A name that is not configured          | `-c mcp_servers.unknown_gg423.enabled=false`                                                               | The configuration fails: `invalid transport in mcp_servers.unknown_gg423`. Names must come from the loaded configuration.                                                                                                                                                                                                                                                                 |
| Repeated keys                          | `enabled=false` then `enabled=true`, and the reverse                                                       | The last one wins (`on`, then `off`). An inline table `mcp_servers.node_repl={enabled=true}` after `enabled=false` also wins.                                                                                                                                                                                                                                                             |
| Plugins                                | `-c features.plugins=false`                                                                                | `mcp list` keeps only `node_repl` (the plugin servers `cua_repl` and `graphgoblin` and the apps server `codex_app` go). `plugin list` drops from 28 installed (13 local, 15 remote) to 0. `plugin marketplace list`: "No plugin marketplaces in scope."                                                                                                                                   |
| `plugins={}`, `marketplaces={}`        | as above                                                                                                   | No effect (merge).                                                                                                                                                                                                                                                                                                                                                                        |
| One plugin                             | `-c plugins.graphgoblin@graphgoblin-local.enabled=false`; the quoted key `plugins."graphgoblin@…".enabled` | Unquoted: that plugin's server goes. Quoted: no effect, because the CLI splits keys on dots and keeps the quotes. With `features.plugins=false`, `plugins.<id>.enabled=true` does not bring a plugin back.                                                                                                                                                                                |
| `features.apps=false` alone            | `mcp list --json`                                                                                          | No change to the listing (`codex_app` is already off there); the feature is the ChatGPT apps connector.                                                                                                                                                                                                                                                                                   |
| Features                               | `features list` with `-c features.<name>=false`                                                            | `plugins`, `apps`, `memories` and `hooks` all read `false`. The machine's `[features]` differ from the CLI defaults (empty `CODEX_HOME`) only in `memories` and `prevent_idle_sleep`. `multi_agent`, `goals` and `code_mode_host` default to `true`.                                                                                                                                      |
| `notify`                               | a temporary `CODEX_HOME` whose `notify` runs a probe; a local server completes the turn                    | `codex exec` runs `notify` after the turn (1 probe file). With `-c notify=[]`: 0. Arrays replace.                                                                                                                                                                                                                                                                                         |
| Project layer                          | temporary `CODEX_HOME` with a trusted project holding `[mcp_servers.project_server]`                       | `mcp list` run in the project lists `home_server` and `project_server`; run elsewhere only `home_server`; the top-level `codex -C <project> mcp list` does not change that. `exec --cd <project>` from another working directory starts both servers (two `ping.exe`); `exec --cd <elsewhere>` from the project starts only one. So the listing must run in the turn's working directory. |
| Process tree, dry run                  | `exec` against the holding server, the machine's own configuration                                         | No override: `node_repl.exe`, `node.exe`→`node_repl.exe`, `node.exe`, `cmd.exe`→`node.exe`. With `features.plugins=false` only: `node_repl.exe`. With `mcp_servers.node_repl.enabled=false` only: the plugin servers. With the isolation defaults and `node_repl` off: `codex.exe` and `conhost.exe` only.                                                                                |

**What works for option A.**

- **MCP servers:** `mcp_servers.<name>.enabled=false` per server, with the names read from `codex mcp list --json` run in the turn's working directory.
- **Plugins:** `features.plugins=false`. One plugin alone cannot be turned back on, only all of them with `features.plugins=true`.
- **Personal features:** `features.apps=false`, `features.memories=false`, `features.hooks=false`, `features.multi_agent=false` and `features.goals=false`. The last two were added by the coordinator's decision of 2026-10-28; see "Follow-up" below.
- **The turn-completion program:** `notify=[]`.

**Alternatives examined and not used.**

- `--ignore-user-config` is not exposed by the SDK, so it would need a patch. It also drops the Windows sandbox mode and project trust.
- `mcp_servers={}` has no effect.
- Option B, a separate Codex home, was not chosen by the owner.

## 2. Implementation

All changes are in `packages/adapter-codex`:

- [`isolation.ts`](../../../packages/adapter-codex/src/isolation.ts) (new) holds the isolation defaults, the layering of configurations by key path, and the listing `configuredServers`.
- [`client.ts`](../../../packages/adapter-codex/src/client.ts) (new) holds the SDK client types, moved from `harness.ts` and re-exported, and `isolatedClient`. Before each turn, `isolatedClient` lists the servers, then constructs the SDK `Codex` with the server switches layered under the defaults and the node's overrides.
- [`options.ts`](../../../packages/adapter-codex/src/options.ts): `clientOptions` builds `config` as the isolation defaults with `configOverrides` layered after them. `threadOptions` and `sanitizeConfig` are unchanged.
- [`cli.ts`](../../../packages/adapter-codex/src/cli.ts): the runner accepts an abort signal and also returns stdout alone. The listing parses stdout only, because the CLI can warn on stderr.
- [`harness.ts`](../../../packages/adapter-codex/src/harness.ts): the default client factory is `isolatedClient`, with the harness's CLI, environment and timeout.

`sanitizeConfig` never refused keys; it drops values that are not TOML. The protection the brief names comes from argument order, which still holds: the SDK emits the thread options (model, effort, sandbox, approval, network access, web search) after all `config` keys, and among repeated keys the last wins. A test asserts that a node's `approval_policy="untrusted"` is followed by the thread's `approval_policy="never"`.

The `--config` order of a turn:

1. the server switches;
2. `features.plugins=false`, `features.apps=false`, `features.memories=false`, `features.hooks=false`, `features.multi_agent=false`, `features.goals=false` and `notify=[]`;
3. the node's overrides;
4. the thread options.

Injected client factories (test doubles of the SDK) skip the listing. The default factory, which runs the real SDK and CLI, always lists.

## 3. Real turns: process trees under the gateway, by PID

Method (as F2):

1. Start the built API on a disposable store `%TEMP%\gg-423-*` (ports 6310 to 6319, no `GG_*` or `JEV_API_KEY` inherited).
2. Publish one Codex inference node: `gpt-6-luna`, `low`, the default `workspace-write`, the prompt "Run exactly this shell command …: `powershell -NoProfile -Command "Start-Sleep -Seconds 12; Write-Output <marker>"`. Then reply with exactly the word DONE".
3. Start a run. A PowerShell CIM `Win32_Process` poller lists every descendant of the gateway PID for the whole run.
4. Take the in-flight snapshot 1.5 s after the marker command appears. The CLI's `--config` arguments are read from its own command line; prompts go through stdin, not argv.

Names and PIDs only. The gateway's own `conhost.exe` is omitted.

**Before, `main` build (`codex-main-before`, [log](codex-main-before.log.txt)).** The CLI received `model_reasoning_effort="low"`, `sandbox_workspace_write.network_access=false`, `web_search="disabled"` and `approval_policy="never"`, and no other `--config`.

```
codex.exe 51808
  node_repl.exe 9900                     <- [mcp_servers.node_repl] (gone with its enabled=false)
  node.exe 36172 -> node_repl.exe 9592   <- from plugins (gone with features.plugins=false)
  node.exe 53496                         <- from plugins (same)
  cmd.exe 53804 -> node.exe 25488        <- from plugins (same)
  codex-code-mode-host.exe 49704
  codex-command-runner-0.160.0.exe 8372 -> powershell.exe 23108 -> powershell.exe 22248 (marker)
```

`codex-windows-sandbox-setup.exe` also appeared briefly during the run. The run succeeded, replied DONE, and the command exited 0.

**After, fix build (`codex-fix-after`, [log](codex-fix-after.log.txt)).** The CLI received:

```
mcp_servers.node_repl.enabled=false, features.plugins=false, features.apps=false,
features.memories=false, features.hooks=false, notify=[],
model_reasoning_effort="low", sandbox_workspace_write.network_access=false, web_search="disabled", approval_policy="never"
```

```
codex.exe 32864
  codex-code-mode-host.exe 30336
  codex-command-runner-0.160.0.exe 17936 -> powershell.exe 37668 -> powershell.exe 47688 (marker)
```

There was no `node_repl.exe` and no plugin `node.exe` or `cmd.exe`. The run succeeded, replied DONE, and the command exited 0. Before the turn, the listing ran as `node.exe 46232 -> codex.exe 35844` directly under the gateway, and its output named `node_repl`, as the turn's first `--config` shows.

**One server back on (`codex-fix-reenable`, [log](codex-fix-reenable.log.txt)).** The node's `configOverrides` were `{"mcp_servers": {"node_repl": {"enabled": true}}}`. The CLI received `mcp_servers.node_repl.enabled=true` first, followed by the same defaults.

```
codex.exe 16964
  node_repl.exe 35844                    <- the machine's node_repl, back on for this node only
  codex-code-mode-host.exe 34552
  codex-command-runner-0.160.0.exe 39568 -> powershell.exe 14292 -> powershell.exe 40572 (marker)
```

The plugin servers stayed off. The run succeeded, replied DONE, and the command exited 0.

**Product dry runs (no provider).** Turns pointed by node override at the local holding server. Main: the same five extension processes. Fix: `codex.exe` and `conhost.exe` only. Evidence: [codex-main-dryrun.log.txt](codex-main-dryrun.log.txt), [codex-fix-dryrun.log.txt](codex-fix-dryrun.log.txt).

**Builds.** Real turns 2 to 4 ran on the first fix commit `7553cce4`. Commit `6abe20a1` changed only how the listing's JSON is read (stdout alone). Its product dry run (`codex-fix-dryrun`, rerun on that build) gives the same `--config` arguments and the same tree.

**Follow-up: `multi_agent` and `goals` off (coordinator decision, 2026-10-28; no new real turn).** The product dry run on the final build is [codex-fix-features-dryrun.log.txt](codex-fix-features-dryrun.log.txt). The turn CLI received:

```
mcp_servers.node_repl.enabled=false, features.plugins=false, features.apps=false,
features.memories=false, features.hooks=false, features.multi_agent=false, features.goals=false,
notify=[], <the node's model_provider overrides pointing at the local holding server>,
model_reasoning_effort="low", sandbox_workspace_write.network_access=false, web_search="disabled", approval_policy="never"
```

The listing CLI received `mcp list --json` with the same six `features.<name>=false`. The tree under the gateway was `codex.exe` and `conhost.exe` only.

- **Accepted by the CLI:** `codex features list -c features.multi_agent=false -c features.goals=false` reports both `false`, and `code_mode_host` `true`.
- **Not verified:** whether the model loses the sub-agent tools; that needs a real turn, which the coordinator did not ask for. The model-visible context (`codex debug prompt-input`, [prompt-sections.log.txt](prompt-sections.log.txt)) is unchanged by the two switches: it keeps its `multi_agent_role` and `multi_agent_mode` sections.
- **Discarded first attempt:** in that run, `jusched.exe` and `jucheck.exe` appeared "under" the gateway only because the gateway reused the PID of their long-gone parent. The run was repeated, and the log holds the repeat.

### Code-mode host

`codex-code-mode-host.exe` belongs to the CLI, not to the machine's configuration:

- it ships in the pinned package's own `bin` folder beside `codex.exe`;
- `code_mode_host` is `true` under an empty `CODEX_HOME`;
- the binary's messages say Code Mode needs it ("enable `features.code_mode_host` and install `codex-code-mode-host`", "Code mode will fail closed!");
- it started only when the model used a tool: the product dry runs, which never reach a tool call, show no host.

The diagnostic turn `codex-fix-codemode-off` ([log](codex-fix-codemode-off.log.txt)) set `{"features": {"code_mode_host": false}}`. The run "succeeded" and replied DONE, but it ran **no command at all**: no command item, no command runner and no PowerShell. The loop isolation therefore leaves the host on. The brief's expectation of no host after the fix is wrong for this CLI.

## 4. Claude

**How the adapter launches the pinned CLI 2.1.308.** `packages/infrastructure/src/claude`:

- `policy.ts` `SUPPRESSION_ARGS`: `--safe-mode --setting-sources "" --strict-mcp-config`;
- read-only adds `--restricted --tools Read,Glob,Grep`;
- the restricted environment `subscriptionEnvironment` passes only 11 OS variables plus `DISABLE_AUTOUPDATER` and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`;
- `protocol.ts` refuses a session whose init reports any MCP server, any plugin other than the built-in `cc-plugin-agents-md` and `cc-plugin-plugin-authoring`, or any skill outside the bundled allowlist;
- `protocol.ts` also refuses `hook_*` records at any time.

`claude --help` documents `--safe-mode` as starting "with all customizations (CLAUDE.md, skills, installed plugins, hooks, MCP servers, custom commands and agents, …) disabled".

**The owner's configuration, names only.**

- `claude mcp list`, run from a neutral folder and without a model turn, lists the user-scope `playwright` server and three claude.ai connectors (Claude Docs, Google Calendar, Gmail), all connected.
- `~/.claude.json` has `mcpServers: playwright`, and 5 of 12 project entries have their own servers.
- `~/.claude/settings.json` has no `hooks`, `enabledPlugins` or `mcpServers`.

**What ran in loop turns.**

- **Two product turns.** `claude-haiku-5-5` at `low`, read-only, through the built API: [claude-fix.log.txt](claude-fix.log.txt) and [claude-fix2.log.txt](claude-fix2.log.txt). Both succeeded and replied DONE. The CLI received exactly the flags above.
- **Under the turn CLI** only `conhost.exe`, `reg.exe` and `where.exe` ran, plus once a nested `claude.exe`, the CLI's embedded ripgrep (below). No `node`, `npx`, `cmd`, PowerShell or Python ran, so no MCP server, hook or plugin program. `reg.exe` also runs under the no-model `claude auth status` checks, so it is part of the CLI's own startup.
- **One direct CLI turn with the adapter's exact flags, environment and `--debug-file`** ([claude-debug-turn.log.txt](claude-debug-turn.log.txt), filtered and redacted; the full debug log is not kept). Init reported `mcp_servers: []`, plugins `cc-plugin-agents-md` and `cc-plugin-plugin-authoring`, and bundled skills only. The CLI's own log reads:
  - `[claudeai-mcp] Disabled in safe mode`;
  - `Safe mode: installed plugins are disabled, none of their hooks or hooks modules load; built-in plugins load regardless`;
  - `Registered 0 hooks from 2 plugins`;
  - `[reduced mode] Skipping skill dir discovery`;
  - `getSkills returning: 0 skill dir commands, 0 plugin skills, 38 bundled skills`;
  - `Ripgrep first use test: PASSED (mode=embedded, path=%USERPROFILE%\.local\bin\claude.exe)`. This explains the nested `claude.exe`.

**Finding: not inherited.** Loop Claude turns run without the owner's MCP servers (user-scope, project and claude.ai connectors), installed plugins, hooks, skills and `CLAUDE.md`. No code change was needed; the existing infrastructure tests cover the launch flags and the init refusals.

The log also says "managed settings-file hooks still run". Managed policy is the administrator's, docs/06 already says it stays in force, and this machine has none.

The first product turn's own check, "no process other than `conhost.exe`", was too strict and reports FAIL in [claude-fix-result.json](claude-fix-result.json) because of `reg.exe`, `where.exe` and the embedded ripgrep. The second turn uses the corrected check (no MCP, hook or plugin program) and passes.

## 5. Every real turn

| #   | Harness | Model / effort             | Purpose                                      | Run                          | Outcome                             |
| --- | ------- | -------------------------- | -------------------------------------------- | ---------------------------- | ----------------------------------- |
| 1   | Codex   | `gpt-6-luna` / `low`       | before, `main` build                         | `01M60D39XZVG014Q4BAP00GSP7` | succeeded, DONE, command exit 0     |
| 2   | Codex   | `gpt-6-luna` / `low`       | after, fix build                             | `01M60E1RJM10965PFX6TCV287Y` | succeeded, DONE, command exit 0     |
| 3   | Codex   | `gpt-6-luna` / `low`       | node turns `node_repl` back on               | `01M60E3638MJ62DTRH7VNHYYZX` | succeeded, DONE, command exit 0     |
| 4   | Codex   | `gpt-6-luna` / `low`       | diagnostic: `features.code_mode_host=false`  | `01M60E4NASXDNNFXT47XPM8KG9` | succeeded, DONE, **no command ran** |
| 5   | Claude  | `claude-haiku-5-5` / `low` | product turn, process tree                   | `01M60EHAE7Z3N45ZZRGS837QEK` | succeeded, DONE                     |
| 6   | Claude  | `claude-haiku-5-5` / `low` | product turn, process tree with child shapes | `01M60EKEMKF7ZX7HS28C1KFH8W` | succeeded, DONE                     |
| 7   | Claude  | `claude-haiku-5-5` / `low` | direct CLI, adapter flags and `--debug-file` | none (direct CLI)            | succeeded, DONE                     |

The budgets were 6 Codex and 3 Claude turns; 4 Codex and 3 Claude turns were used. The two product dry runs and every probe in section 1 reached no provider.

**Cleanup.**

- Each Codex run removed the CLI's session records whose first-line `cwd` is in its own `gg-423-*` store: one rollout per run under `%USERPROFILE%\.codex\sessions\2026\10\{27,28}`, including the two dry runs. [scripts/remove-sessions.mjs](scripts/remove-sessions.mjs) finds none left.
- Each Claude product run removed its own `%USERPROFILE%\.claude\projects\…gg-423-…` folder. The direct turn used `--no-session-persistence`. `~/.claude.json` holds no `gg-423` project entry.
- Every store and temporary `CODEX_HOME` is deleted, and every process ended here was one this record started, ended by PID.

## 6. Tests (red before)

The new [isolation.test.ts](../../../packages/adapter-codex/src/isolation.test.ts) drives the public `CodexHarness` with the real SDK and the fake CLI [argv-cli.mjs](../../../packages/adapter-codex/src/fixtures/argv-cli.mjs). The fake answers `mcp list --json` like CLI 0.160.0 and records the exact `exec` argv. A second group uses an injected `cliRunner` for the listing's failure modes.

To show them red, `cli.ts`, `harness.ts` and `options.ts` were restored from `a4fee9a9` and `client.ts` and `isolation.ts` were removed. With the final tests and fixtures in place, 12 tests failed ([red-before.log.txt](red-before.log.txt)):

- `switches off every configured MCP server, plugins, apps, memories, hooks and notify`: received only the 4 thread `--config` arguments instead of 11;
- `applies a node override after the defaults, before the thread options`;
- `switches them off on a resumed conversation too`;
- `does not start the turn when the MCP servers cannot be listed`: "promise resolved … instead of rejecting";
- six cases of `refuses to start on …` (spawn ENOENT, timeout, non-JSON, a non-array, an entry without a name, the name `team.docs`);
- `harness.test.ts` › `sets every behaviour-affecting option explicitly on the thread`, now expecting the isolation `config`;
- `cli.test.ts` › `captures stdout and stderr together, stdout alone, and the exit code`.

`stops before the turn when the run is cancelled during the listing` passed on `main` too. It covers the new abort path and is not a red-before test.

**Red before for the follow-up.** The test `switches off sub-agents and goals unless the node turns one back on` was added with the default lists extended, and run on `96efaed8` before `ISOLATED_FEATURES` changed. It failed with "expected [ 'features.plugins=false', …(8) ] to include 'features.multi_agent=false'". So did the exact-list tests (11 failed in `isolation.test.ts` and `harness.test.ts`). All pass after the change.

The fake CLI also writes a warning to stderr before the listing's JSON, as the real CLI does under a temporary `CODEX_HOME`. The first commit (`7553cce4`) parsed the combined output. The second commit (`6abe20a1`) parses stdout alone; the CLI runner now also returns stdout.

Changed tests:

- `harness.test.ts` adds layering cases: dotted keys, a scalar replaced by a table, and node `features`/`notify` overrides.
- `cli.test.ts` and the API tests `nested-readiness.test.ts` and `readiness-evidence.test.ts` give their fake runners the new `stdout` field.
- Every other fake Codex executable that runs turns answers `mcp list` with `[]`; before this, such a fake treated the listing as a turn:
  - `apps/api/src/shutdown-console.test.ts` (C#) and `apps/api/src/shutdown-process.test.ts` (Node script);
  - `apps/web/e2e/shutdown.spec.ts` (POSIX fake) and `apps/web/e2e/shutdown-fake-codex.ps1` (Windows fake);
  - `tooling/fixtures/unlimited-codex.cs` and `tooling/fixtures/model-switch-cli.cs`, used by QA scripts.

  The first full API coverage run caught it in `shutdown-console.test.ts`: the listing hung on the fake's held turn and the run failed. `tooling/fixtures/readiness-cli.cs` already refuses anything but probes.

- `refusal.test.ts` and `stderr-evidence.test.ts` give their engine runs an existing working directory, which the listing needs as its working directory. The fake workspace's `/tmp/graphgoblin/<run>` does not exist on Windows.
- The preload fakes `refusal-cli.mjs`, `spec-cli.mjs` and `apps/api/src/testing/codex-refusal-cli.mjs` answer the listing with `[]`.

## 7. Gates

All gates ran on the final state, with Node v22.23.4 first on `PATH`, `GG_TEST_PORT_START=7340` and `GG_TEST_PORT_COUNT=40`.

| Gate                                                                       | Result                                                                                                                                         |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`                                                               | 11/11 tasks                                                                                                                                    |
| `pnpm typecheck`                                                           | 20/20 tasks                                                                                                                                    |
| `pnpm lint`                                                                | 12/12 tasks                                                                                                                                    |
| `pnpm check:layers`                                                        | Layer rules: OK                                                                                                                                |
| `pnpm check:deps`                                                          | 0 errors; 3 `no-orphans` warnings on files this change does not touch (`drizzle.config.ts`, `e2e/shutdown.config.ts`, `check-templates.d.mts`) |
| `pnpm format:check`                                                        | all files use Prettier style                                                                                                                   |
| `pnpm --filter @graphgoblin/adapter-codex test:coverage`                   | 598 passed, 4 skipped; lines 99.39%, branches 95.31%                                                                                           |
| `pnpm --filter @graphgoblin/infrastructure test:coverage`                  | 871 passed; lines 98.12%, branches 94.31% (no change in this package)                                                                          |
| `pnpm --filter @graphgoblin/engine test:coverage`                          | 1763 passed; lines 96.94%, branches 91.2% (no change in this package)                                                                          |
| `pnpm --filter @graphgoblin/api exec vitest run --coverage --maxWorkers=2` | 1683 passed, 14 skipped; lines 96.22%, branches 90.88%                                                                                         |
| `apps/web`: `pnpm exec playwright test e2e/shutdown.spec.ts` (Edge)        | 2 passed: its Windows fake Codex now answers the listing                                                                                       |
| `pnpm docs:generate`                                                       | not run: no node schema or route changed                                                                                                       |

**API: first run and rerun.** The first API run had three failures. Two were in `shutdown-console.test.ts`, whose fake Codex treated the new listing as a held turn; it was fixed as described in section 6. The third was a 20 s timeout in `wait-identity.test.ts`, which does not involve Codex. That run overlapped with a rebuild and the product dry runs. The rerun on an idle machine passed in full.

## 8. Open points

1. **Still inherited from `config.toml`, owner's call.** Project trust, model providers and profiles, `service_tier` (this machine has `priority`), `personality` (`pragmatic`), `shell_environment_policy`, `prevent_idle_sleep`, the skills under `CODEX_HOME` and the personal `AGENTS.md` (empty here). `skills.include_instructions` exists in the binary but was not evaluated.
2. **`multi_agent` and `goals` are off by decision (2026-10-28).** Two reasons: both are set in the machine's personal `[features]`, and sub-agent spawning changes what an unattended turn can do. A node turns sub-agents back on with `{"features": {"multi_agent": true}}`. Whether a real turn then lacks the sub-agent tools is not observed (no real turn was run for this follow-up).
3. **One plugin cannot be re-enabled alone.** The CLI cannot turn on a single plugin while `features.plugins=false`. A node can only turn all of the machine's plugins back on.
4. **One extra CLI run per Codex turn.** The listing took about 0.1 to 0.5 s in the probes, and it also runs for each structured decision call.
5. **Machine-specific evidence.** The listing and switches were verified on this machine's Codex configuration. A future CLI that changes `mcp list --json` fails turns closed with a message naming the listing.
6. **Shared files.** `docs/06` changes only the "never leak" paragraph and the `configOverrides` and capabilities rows, kept within the table's column width so that no other row is re-padded. #205 edits the `effort` row of the same table; if its cell grows past 260 characters, Prettier re-pads the whole table there. The CHANGELOG gets one bullet at the top of Unreleased.

## Files

- `scripts/`: `lib.mjs` (gateway, process tree, redaction, session cleanup), `codex-turn.mjs`, `claude-turn.mjs`, `claude-debug-turn.mjs`, `cli-investigation.mjs`, `notify-probe.mjs`, `prompt-sections.mjs`, `remove-sessions.mjs`, `redact-file.mjs`.
- Logs: `codex-*.log.txt` and `codex-*-result.json` (one set per run), `codex-*-gateway.log.txt` (the API's HTTP request log), `claude-*.log.txt`, `claude-*-result.json`, `cli-investigation.log.txt`, `notify-probe.log.txt`, `red-before.log.txt`. All are UTF-8 with profile paths, the machine name and credential-shaped strings redacted, and none exceeds 1,000,000 bytes.

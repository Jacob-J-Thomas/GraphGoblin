# WP-F5: Windows command-launch diagnosis

Research record for #102 (WP-F5), measured on 2026-10-19 from `main` at `9070207`. All launches used installed CLIs through their subscription logins, disposable directories, and disposable APIs on ports 5710 and 5711. No model turn was run for either provider. No credential was exported or printed: the CLIs only checked their own logins, and Claude's `auth status` output was reduced to two fields. The disposable APIs seeded the machine's Jev key from the environment into their own stores, as any instance does; those stores were deleted afterwards. The owner's instance, store and checkout were not touched. Revised on 2026-10-20 after review: the `fs.mkdtemp` boundary was re-measured at 247 characters (succeeds) and 248 (fails), and the defect classification of launch names was corrected.

## Result

**Confirmed, not a GraphGoblin launch defect.** The #102 failure (`Failed to create unified exec process: CreateProcessWithLogonW failed: 267`) is Codex's Windows sandbox refusing a command whose working directory is invalid. In the trial, the QA worker model supplied a per-command `workdir` that dropped one segment of the admitted workspace path, so the directory did not exist. GraphGoblin's `--cd` was correct, and every command that used it ran. The failure reproduces without a model turn by asking Codex's sandbox to start a command in a missing directory.

**One matrix cell failed where the direct invocation succeeded,** and it was fixed: with the system temporary directory at 226 characters, the Claude adapter's readiness check could not create its empty check directory, because Windows `fs.mkdtemp` refuses paths of 248 characters or more (the check path was 249). Claude itself starts from such a directory. The adapter now creates the directory with `mkdir`. Every other cell behaved the same through GraphGoblin as through PowerShell and `cmd`.

**Script node launches** behaved identically to direct launches in every matrix cell. The original report concerns harness launches (commands run by a Codex worker inside Codex's sandbox), not script nodes.

## Environment

| Item                     | Value                                                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OS                       | Windows 11 Pro 10.0.26300, `LongPathsEnabled = 1`, console code page 65001                                                                                  |
| Node                     | 22.14.0 for every GraphGoblin launch and every `codex.js` cell; the machine default 23.10.0 ran the npm global `codex.cmd` shim and read Codex session logs |
| Codex CLI                | 0.160.0, both the SDK-bundled CLI and the npm global install; the user Codex configuration selects `[windows] sandbox = "elevated"`                         |
| Claude Code              | 2.1.304, native `claude.exe`, signed in with a Claude.ai account                                                                                            |
| Other drive              | `D:` (local NTFS)                                                                                                                                           |
| Session variables        | The Claude Code session variables of the measuring shell (`CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_PID`) were removed from every launched environment         |
| Updater on Claude copies | Direct launches of copied `claude.exe` set `DISABLE_AUTOUPDATER=1`, as the product's own Claude environment does                                            |

## The original report

The 2026-10-06 trial ran one QA worker through GraphGoblin with Codex 0.160.0 (`workspace-write`, approval `never`, network off). Its Codex session log records the session and turn working directory as the admitted workspace `%TEMP%\gg-aidlc-trial\aidlc-trial-<timestamp>\aidlc-trial-positive`, which is what GraphGoblin passed as `--cd`. The log also records each command's own `workdir` argument, which the SDK's command items do not expose (the reason the trial could not tell these causes apart):

| Command `workdir` named by the model                                                 | Calls | Outcome                                           |
| ------------------------------------------------------------------------------------ | ----: | ------------------------------------------------- |
| `%TEMP%\gg-aidlc-trial\aidlc-trial-<timestamp>\aidlc-trial-positive` (the workspace) |     7 | all ran                                           |
| `%TEMP%\gg-aidlc-trial\aidlc-trial-positive` (timestamp segment dropped)             |     5 | all failed: `CreateProcessWithLogonW failed: 267` |

The shortened directory does not exist; the trial only creates timestamped run directories, and `%TEMP%\gg-aidlc-trial` still holds only the timestamped one. The failures were therefore not intermittent in their cause: the model alternated between the correct and a mistyped path, and every mistyped call failed.

Reproduction without a model turn, through Codex's own sandbox command (`codex sandbox -P :workspace -C <dir> -- cmd /c cd`, CLI 0.160.0):

| Working directory                         | `elevated` (configured mode)                                          | `unelevated`                                                                |
| ----------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| missing directory                         | exit 1, `windows sandbox failed: CreateProcessWithLogonW failed: 267` | exit 1, `CreateProcessAsUserW failed: 267 (The directory name is invalid.)` |
| existing, 258 characters                  | exit 0                                                                | exit 0                                                                      |
| existing, 262 characters                  | exit 1, `CreateProcessWithLogonW failed: 267`                         | exit 1, `CreateProcessAsUserW failed: 267 (The directory name is invalid.)` |
| every matrix directory below              | exit 0, printed the directory                                         | exit 0, printed the directory                                               |
| existing, `CodexSandboxUsers` denied read | exit 0                                                                | exit 0                                                                      |

Windows error 267 is `ERROR_DIRECTORY` ("The directory name is invalid"): Windows refuses to start a process whose working directory does not exist or is longer than 258 characters. The sandbox's wrapper text differs from the trial's (`windows sandbox failed` against `Failed to create unified exec process`) because the trial went through Codex's unified exec tool; the Windows call and its error code are the same.

Other occurrences on this machine: two later Codex worker sessions matched only because they quote #102's text. Four real occurrences appear in Codex Desktop sessions (CLI 0.162.0-alpha) that GraphGoblin did not launch; three named no per-command directory. Their causes were not analysed; they show that the message is not specific to GraphGoblin launches.

Classification: model and provider side. GraphGoblin's working-directory mapping and environment are not involved, and no product change addresses it. Codex reports the condition only as a bare Windows error code; that wording is Codex's.

## Comparison matrix

### Directories

`%TEMP%` below is the measuring account's temporary directory (33 characters). Each row used a working directory (`cwd`) and a binary directory (`bin`) of the same shape; binaries placed for the test were copies of `claude.exe` and `node.exe`, and of `codex.exe` from the pnpm store (hard links on `C:`, copies on `D:`).

| Row                       | Working directory                                                       | Length |
| ------------------------- | ----------------------------------------------------------------------- | -----: |
| plain                     | `%TEMP%\gg-wpf5\cwd\plain`                                              |     51 |
| spaces                    | `%TEMP%\gg-wpf5\cwd\with spaces`                                        |     57 |
| parens                    | `%TEMP%\gg-wpf5\cwd\Program Files (x86)`                                |     65 |
| non-ASCII                 | `%TEMP%\gg-wpf5\cwd\nünïcödé-日本語-ñ`                                  |     60 |
| long                      | `%TEMP%\gg-wpf5\cwd\long\segment-01-abcdefghij\…\segment-08-abcdefghij` |    226 |
| other drive               | `D:\gg-wpf5\cwd\plain`                                                  |     20 |
| plain, trailing `\`       | `%TEMP%\gg-wpf5\cwd\plain\`                                             |     52 |
| other drive, trailing `\` | `D:\gg-wpf5\cwd\plain\`                                                 |     21 |

The trailing-backslash rows reuse the plain binaries; a file path has no trailing separator.

### Commands and launch methods

- Codex: `--version` and `login status`, as the native `codex.exe` and as the npm launcher `node <bin>\node_modules\@openai\codex\bin\codex.js` (the layout the SDK-bundled default uses).
- Claude: `--version` and `auth status --json` (only `loggedIn` and `authMethod` were kept from its output).
- Script: `node -e "console.log(process.cwd())"`, with the copied `node.exe` and with the bare name `node`.
- (a) PowerShell: `Set-Location -LiteralPath <cwd>; & <binary> <args>`, sent as `-EncodedCommand` so non-ASCII text survives. `cmd`: `cmd.exe /d /s /c "cd /d "<cwd>" && "<binary>" <args>"`.
- (b) Product launchers, public exports only, in a Node 22 process started in `<cwd>` with `TEMP` and `TMP` set to `<cwd>`: `createCodexHarness({ codexBinary }).preflight()` and `createCodexHarness().preflight()` from `@graphgoblin/adapter-codex`; `new ClaudeHarness({ binary }).preflight()` and `new ClaudeHarness().preflight()` from `@graphgoblin/infrastructure/claude`; `new ProcessScripts().run({ command, args, cwd })` from `@graphgoblin/infrastructure/process`. Claude's readiness check runs in a fresh directory under the temporary directory, so `TEMP` places it inside the row's directory.
- (c) Built API from `<cwd>` with `GG_DATA_DIR=<cwd>\data` (with a trailing `\` on the trailing rows), `GG_PORT=5710`, and `TEMP`/`TMP` as in (b): `node apps/api/dist/main.js --preflight` with `GG_CODEX_BINARY`/`GG_CLAUDE_BINARY` set to the row's `codex.exe` and `claude.exe`, to the row's `codex.js` and `claude.exe`, and unset; then the server started with the row's `codex.exe` and `claude.exe`, `GET /system/preflight`, and a draft run of a three-node loop whose script node runs the `node -e` script with `cwd` set to the row's directory.

Environment differences between the methods: direct launches inherit the shell's environment. The Codex preflight and SDK sessions inherit the API process environment (sessions add the SDK's originator variable and the bundled CLI's `codex-path` folder to `PATH`, and pass the working directory as `--cd`). The Claude adapter passes only `SystemRoot`, `WINDIR`, `COMSPEC`, `PATHEXT`, `PATH`, `TEMP`, `TMP`, `USERPROFILE`, `HOME`, `APPDATA`, `LOCALAPPDATA`, `DISABLE_AUTOUPDATER=1` and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`. Scripts inherit the API process environment plus the node's own variables. Every product launch uses `shell: false`.

### Outcomes

Every cell not listed as failing exited 0 and printed the expected text: `codex-cli 0.160.0`, `Logged in using ChatGPT`, `2.1.304 (Claude Code)`, `{"loggedIn":true,"authMethod":"claude.ai"}`, the row's directory (non-ASCII intact, trailing separator dropped by Windows), or a preflight `ok` for `data-dir`, `harness.codex` and `harness.claude`.

| Row                       | Codex (a) PS / cmd         | Codex (b)                          | Codex (c)                         | Claude (a) PS / cmd | Claude (b)                    | Claude (c)                    | Script (a) PS / cmd | Script (b) | Script (c) run |
| ------------------------- | -------------------------- | ---------------------------------- | --------------------------------- | ------------------- | ----------------------------- | ----------------------------- | ------------------- | ---------- | -------------- |
| plain                     | 8/8 ok                     | 3/3 ok                             | 4/4 ok                            | 4/4 ok              | 2/2 ok                        | 4/4 ok                        | 2/2 ok              | 2/2 ok     | 2/2 succeeded  |
| spaces                    | 8/8 ok                     | 3/3 ok                             | 4/4 ok                            | 4/4 ok              | 2/2 ok                        | 4/4 ok                        | 2/2 ok              | 2/2 ok     | 2/2 succeeded  |
| parens                    | 8/8 ok                     | 3/3 ok                             | 4/4 ok                            | 4/4 ok              | 2/2 ok                        | 4/4 ok                        | 2/2 ok              | 2/2 ok     | 2/2 succeeded  |
| non-ASCII                 | 8/8 ok                     | 3/3 ok                             | 4/4 ok                            | 4/4 ok              | 2/2 ok                        | 4/4 ok                        | 2/2 ok              | 2/2 ok     | 2/2 succeeded  |
| long                      | exe 4/4 ok; `codex.js` 0/4 | exe, bundled ok; `codex.js` failed | exe, defaults ok; `codex.js` FAIL | 4/4 ok              | 0/2 before the fix, 2/2 after | WARN before the fix, ok after | 2/2 ok              | 2/2 ok     | 2/2 succeeded  |
| other drive               | 8/8 ok                     | 3/3 ok                             | 4/4 ok                            | 4/4 ok              | 2/2 ok                        | 4/4 ok                        | 2/2 ok              | 2/2 ok     | 2/2 succeeded  |
| plain, trailing `\`       | 8/8 ok                     | 3/3 ok                             | 4/4 ok                            | 4/4 ok              | 2/2 ok                        | 4/4 ok                        | 2/2 ok              | 2/2 ok     | 2/2 succeeded  |
| other drive, trailing `\` | 8/8 ok                     | 3/3 ok                             | 4/4 ok                            | 4/4 ok              | 2/2 ok                        | 4/4 ok                        | 2/2 ok              | 2/2 ok     | 2/2 succeeded  |

(c) counts three `--preflight` runs plus the HTTP preflight for each harness.

Long row, `codex.js` (all methods): the npm launcher starts `…\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe`, 307 characters, and Node reports `spawn … ENOENT` (exit 1). A separate measurement started `codex.exe` from paths of 250 to 259 characters and failed from 260 (`spawn ENOENT`). Direct PowerShell and `cmd` fail identically, so this is a platform limit, not a GraphGoblin difference. The bundled CLI's executable is the checkout path plus 122 characters, so a checkout deeper than 137 characters would reach the limit.

Long row, Claude (b) and (c), before the fix: preflight reported only `Claude preflight failed` (a WARN in the API preflight because no Claude default was configured; FAIL when one is). A direct launch from the same directory succeeded.

### Localisation of the Claude cell

| Step                                                                 | Measurement                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Where it failed                                                      | `ClaudeHarness` readiness check, `packages/infrastructure/src/claude/harness.ts`: `mkdtemp(join(tmpdir(), 'gg-claude-probe-'))` threw `ENAMETOOLONG` before any CLI started. The error is not a `ClaudeHarnessError`, so preflight shows the generic text (a turn, which runs the same check first, would show `Claude turn failed`).                                                                                                |
| `fs.mkdtemp` against `fs.mkdir` (Node 22.14.0 and 23.10.0)           | Both succeed up to 247 characters. `mkdtemp` fails with `ENAMETOOLONG` from 248 to 258 characters (249 in the long row), and with `ENOENT` from 262, while `mkdir` succeeds at every length tested (up to 266). Given the long-path form (`\\?\…`) of the same prefix, `mkdtemp` succeeds (253 characters), but then returns that form as the directory name; `mkdir` applies the long-path form itself and keeps the ordinary name. |
| Starting a CLI by working-directory length (`spawn`, `shell: false`) | `claude --version` and `node --version` start from 240, 248, 250, 255 and 258 characters, and fail with `spawn ENOENT` from 259 characters. This is Windows' working-directory limit: PowerShell reports the same launch as `The directory name is invalid` (error 267), which Node reports as `ENOENT`.                                                                                                                             |
| Change                                                               | Create the check directory with `mkdir(join(tmpdir(), 'gg-claude-probe-<8 random hex>'), { mode: 0o700 })`. It is still fresh, exclusive and empty, and is removed afterwards. A name that already exists is neither reused nor removed; up to four fresh names are tried, then the check fails.                                                                                                                                     |
| After the change                                                     | The long row passes in (b), (c) `--preflight` and the HTTP preflight with the real Claude CLI. With `TEMP` at 233 characters the preflight passes; at 234 and 240 characters the check directory exceeds 258 characters and preflight reports `The installed Claude executable could not be started`, which is the Windows limit above, not a missing CLI.                                                                           |

Regression test: `packages/infrastructure/src/claude/harness.test.ts`, "creates the prerequisite directory under a system temporary directory of 226 characters (#102)". It points `TEMP`, `TMP` and `TMPDIR` at a real 226-character directory and runs the public `preflight()` with an injected transport. Before the change it failed on Windows with `ok: false, problems: ["Claude preflight failed"]`; after it, the check directory (more than 248 characters) is created, used for all three checks and removed. On Linux both versions pass. Two further tests cover name collisions through the same interface: one collision is followed by a fresh name, and four collisions (or any other creation fault) fail the check without starting the CLI or removing a directory.

### Launch names outside the documented contract

`GG_CODEX_BINARY` is documented as an absolute native executable path (guide 01) or a JavaScript launcher (docs/06), and GraphGoblin starts every process without a shell. These cells show what other names do. Nothing was changed in this work package.

- Not defects: `.cmd` shims and bare names as `GG_CODEX_BINARY`, and bare npm shim names as a script `command`. They are outside the documented contract, and GraphGoblin reports them as start failures.
- Defect, recorded as a separate infrastructure follow-up: a script `command` naming a `.cmd` or `.bat` file. Node refuses to start it without a shell and throws `spawn EINVAL` synchronously inside `ProcessScripts.run` (`packages/infrastructure/src/process/scripts.ts`, the `spawnImpl` call), so `run()` rejects instead of returning a `PROCESS_START_FAILED` result. The round-1 review measured the consequence through the engine: the node fails with `INTERNAL_ERROR: spawn EINVAL`, resumable, with no progress event.

| Launch                                                 | Direct PowerShell / `cmd`                                                                                              | Through GraphGoblin                                                                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GG_CODEX_BINARY` = npm shim `<npm prefix>\codex.cmd`  | ok / ok                                                                                                                | preflight: `preflight failed: spawn EINVAL` (Node refuses `.cmd` files without a shell)                                   |
| `GG_CODEX_BINARY` = `codex`                            | ok / ok (via `codex.ps1` / `codex.cmd`)                                                                                | preflight: `Codex CLI could not be run (codex): spawn codex ENOENT` (without a shell only `.com` and `.exe` are searched) |
| `GG_CLAUDE_BINARY` = `claude`                          | ok / ok                                                                                                                | preflight ok (`claude.exe` is found on `PATH`)                                                                            |
| Script `command` = `npm`, `--version`                  | ok / ok unquoted (the matrix's quoted `"npm"` failed: `npm.cmd` then looked for its files under the current directory) | `spawn failed: PROCESS_START_FAILED`                                                                                      |
| Script `command` = `<npm prefix>\npm.cmd`, `--version` | not run                                                                                                                | `ProcessScripts.run` rejects with `spawn EINVAL` instead of returning a result (defect, above)                            |
| Script `node -e` with a 262-character `cwd`            | `The directory name is invalid` / `The current directory is invalid.`                                                  | `spawn failed: PROCESS_START_FAILED`                                                                                      |

## Not covered

- No real Codex or Claude turn. The Codex session start (`codex exec --cd <dir>`) was not launched; its directory reaches the sandbox exercised above. The Claude turn's own launch (`--print` in the authored working directory) was not started.
- Model-supplied relative `workdir` values, directories reached through junctions, symbolic links, UNC shares, mapped network drives or 8.3 short names.
- Access-control failures other than one deny entry for `CodexSandboxUsers`, which did not prevent the launch.
- Codex versions other than 0.160.0, including the four unanalysed 0.162.0-alpha Desktop occurrences; Claude Code versions other than 2.1.304.
- Machines with `LongPathsEnabled = 0`, consoles not using UTF-8, and non-Windows hosts.
- The same `fs.mkdtemp` limit in other temporary directories GraphGoblin creates (for example the Codex structured-completion directory), which need a model turn to reach.
- Derived, not launched: a run's temporary workspace is `<data dir>\workspaces\<run id>`, 38 characters longer than the data directory, so a data directory deeper than 220 characters would give Codex and script nodes a working directory past the 258-character limit.

## Follow-ups recorded separately

The round-1 review confirmed three defects observed here that are outside this fix. Each is filed as its own issue:

- A script `command` naming a `.cmd` or `.bat` file makes `ProcessScripts.run` reject with a raw `spawn EINVAL` (see "Launch names outside the documented contract").
- The Codex structured-completion directory (`packages/adapter-codex/src/structured.ts`) is still created with `fs.mkdtemp` and has the same 248-character limit.
- A start failure caused by the working directory (Node's `ENOENT` for Windows error 267) is reported by the Claude adapter as `The installed Claude executable could not be started`, as in the 234-character `TEMP` measurement above.

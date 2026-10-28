CHANGES REQUIRED: WP-423 at a19911040b52ef2c9618dcc27bc5f5fac43e506e.

Independent review, 2026-10-28. One merge-blocking finding. No product code, tests, existing documentation, Git index, or branch state changed. This file is the reviewer's only repository addition. No sub-agents or live provider turns were used.

## 1. Finding

1. **P2 - Preserve or reject prototype-sensitive configuration segments before merging.** Location: `packages/adapter-codex/src/isolation.ts:64-75`, especially the inherited-property read at line 72 and assignment at line 75; the same assignment pattern appears in `merge` at lines 81-84.

   **Reproduction:** drive the public `CodexHarness`, with the real SDK and the repository's `src/fixtures/argv-cli.mjs`, with `GG_FAKE_CODEX_MCP='["__proto__"]'`. Start an ordinary turn with no node overrides. The listing accepts that name because it matches `SERVER_NAME`, but the recorded turn arguments contain `mcp_servers={}` and no `mcp_servers.__proto__.enabled=false`. The fake turn succeeds. The pinned binary also accepts a disposable configuration containing `[mcp_servers.__proto__]` when running `features list` (exit 0); this is a plain TOML key segment, not an invalid-name rejection case.

   **Actual effect:** `expand` creates ordinary `{}` dictionaries. Assigning their `__proto__` property changes the JavaScript object's prototype instead of retaining an own configuration key. The SDK then serializes the empty own-property table as `mcp_servers={}`. As the implementation investigation establishes, that argument does not clear the CLI's inherited server table. A machine with this server configured therefore retains it despite the default isolation policy.

   There is a second manifestation of the same merge defect: pass the node override `{"review.__proto__.gg_rev423_marker": true}` through the same public harness. `Object.hasOwn(Object.prototype, 'gg_rev423_marker')` changes from `false` to `true` in the review probe process. Intermediate path traversal follows and mutates an inherited prototype. This is process-wide state mutation, not merely a missing argument.

   **Expected:** every accepted listed server must receive its disable switch, or the turn must fail closed as definitely not submitted. Configuration traversal and merging must use own-property-safe storage/access, or explicitly reject dangerous segments before traversing them. Add public-harness regressions for both the listed `__proto__` server and a dotted override traversing `__proto__`. Do not solve only the listing case while leaving node overrides able to mutate prototypes.

   **Evidence:** corrected public-harness capture `%TEMP%\gg-rev423-probe-corrected.log.txt`, case `proto-server`; separate `%TEMP%\gg-rev423-prototype.mjs` invocation printed `prototypeBefore false` and `prototypeAfter true`. No real server or provider was started to establish this finding.

### Minimal public-interface reproduction

After `pnpm.cmd build`, save this module under a fresh `%TEMP%\gg-rev423-*` filename and run it with the project Node from the repository root:

```javascript
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { CodexHarness } = await import(
  pathToFileURL(resolve('packages/adapter-codex/dist/index.js'))
);
const directory = mkdtempSync(join(tmpdir(), 'gg-rev423-repro-'));
const argv = join(directory, 'argv.json');
const preload = pathToFileURL(resolve('packages/adapter-codex/src/fixtures/argv-cli.mjs')).href;
const harness = new CodexHarness({
  codexBinary: process.execPath,
  env: {
    ...process.env,
    NODE_OPTIONS: `--import=${preload}`,
    GG_FAKE_CODEX_MCP: '["__proto__"]',
    GG_FAKE_CODEX_ARGV: argv,
  },
});
const session = harness.start(
  {
    workingDirectory: directory,
    options: { sandbox: 'read-only', approval: 'never' },
    turn: { prompt: 'Controlled fixture; no provider call' },
  },
  new AbortController().signal,
);
await session.result;
const args = JSON.parse(readFileSync(argv, 'utf8'));
console.log(args.filter((_value, i) => args[i - 1] === '--config'));
// Actual: mcp_servers={} rather than mcp_servers.__proto__.enabled=false.
```

## 2. Head, scope, and environment

- Initial and final reviewed HEAD: `a19911040b52ef2c9618dcc27bc5f5fac43e506e`; it matches the required `a1991104` prefix. Base: `a4fee9a9`. Review diff: `git diff a4fee9a9 HEAD`.
- Actual reviewer branch: `codex-review-423`. The implementer's supplied branch name is provenance; no branch switch was performed.
- Five reviewed commits: `7553cce4`, `6abe20a1`, `96efaed8`, `4ea1c015`, `a1991104`.
- Worktree: `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-review-423`. Initially clean.
- `node --version`: `v22.23.4`. Executable: `%USERPROFILE%\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64\node.exe`. `pnpm.cmd --version`: `12.8.1`. This runtime was placed first on PATH for gates and review probes.
- Dependencies were present. No install, dependency links, junctions, commits, staging, push, merge, rebase, stash, directory deletion commands, or owner-store access were performed.
- Manual built-product checks used port 6380. The browser copy used 6381-6389. Gate shells set `GG_TEST_PORT_START=7620` and `GG_TEST_PORT_COUNT=40`. Reviewer stores and helper artifacts use `gg-rev423-` under `%TEMP%`. No manual gateway inherited `GG_*` or `JEV_API_KEY`.
- Some existing API fixtures ignore the test-port allocation and select their own 5600-range ports. The unrelated failing fixture selected 5682. Repository test fixtures also retain their own pre-existing temporary prefixes. These tests were not edited.

## 3. Mechanism checks

The independent public-harness probes use built adapter exports, the real installed SDK, and the repository's argument-printing fake. A temporary preload adds slow/malformed listing responses only; it does not replace the adapter or SDK. Captures are in `%TEMP%\gg-rev423-probe-corrected.log.txt`.

| Case                                            | Verified result                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two listed servers, no override                 | `mcp_servers.node_repl.enabled=false`, then `mcp_servers.docs.enabled=false`, then the six feature defaults, `notify=[]`, then SDK thread configuration.                                                                                                                                                                                                                |
| Nested and dotted node overrides                | Both produced identical arguments. Re-enabling `node_repl` preserved `docs.enabled=false`; `features.plugins=true` preserved the other five feature defaults.                                                                                                                                                                                                           |
| Approval precedence                             | The node's `approval_policy="untrusted"` preceded the SDK's final `approval_policy="never"`. Model, sandbox, working directory, effort, network access, and web search remained explicit thread arguments.                                                                                                                                                              |
| Listed server also named by the node            | It appeared once with the node's final value, while the other listed server stayed disabled. Merging replaces a value in its original serialization position; it does not emit two copies of that server's switch.                                                                                                                                                      |
| Listing arguments and working directory         | `mcp list --json` received all six `features.<name>=false` arguments and ran in the requested turn directory. The environment matched the harness environment. Plugins/apps are disabled for the listing itself. The no-server-start conclusion for the real binary remains supported by the implementer's investigation, not a new live process-tree observation here. |
| Invalid server segment `team.docs`              | Failed `HARNESS_TURN_FAILED`, definitely not submitted; no SDK turn started.                                                                                                                                                                                                                                                                                            |
| Server segment `__proto__`                      | Failed isolation as finding 1 describes.                                                                                                                                                                                                                                                                                                                                |
| Stderr warning before valid stdout JSON         | Accepted the listing and started the controlled turn.                                                                                                                                                                                                                                                                                                                   |
| Stdout banner followed by JSON                  | Failed closed: `mcp list printed no JSON: Banner \| []`; definitely not submitted; no SDK turn.                                                                                                                                                                                                                                                                         |
| Unexpected JSON object shape                    | Failed closed with `mcp list printed an unexpected shape.`; definitely not submitted; no SDK turn.                                                                                                                                                                                                                                                                      |
| Listing exit 2                                  | Preserved the listing/configuration cause in `HARNESS_TURN_FAILED`; definitely not submitted; no SDK turn.                                                                                                                                                                                                                                                              |
| Slow real fake process                          | At 15,015 ms, failed with `timed out after 15000 ms`, definitely not submitted; no SDK turn. The default bound is 15 seconds.                                                                                                                                                                                                                                           |
| Cancellation during a real fake listing process | Returned `AbortError` about 78 ms after starting the probe; no SDK turn. This establishes abort handling for the direct controlled fake, not native descendant-tree termination.                                                                                                                                                                                        |
| Missing CLI                                     | The adapter suite covers `HARNESS_NOT_INSTALLED` and definitely-not-submitted evidence; the engine mapping preserves this state.                                                                                                                                                                                                                                        |
| Resume                                          | The real SDK received `resume argv-thread` plus the same listing, server disable, feature, notify, and thread options.                                                                                                                                                                                                                                                  |
| `CodexStructured.complete`                      | A structured request through the public wrapper also listed and disabled `docs`, applied the same defaults, and retained the read-only/never/no-network/no-web thread options and output-schema argument.                                                                                                                                                               |

For an ordinary default turn the six feature switches are, in order: `plugins`, `apps`, `memories`, `hooks`, `multi_agent`, `goals`. They precede `notify=[]`; the SDK's effort, network, web-search, and approval config follows. The SDK patch is unchanged (`git diff a4fee9a9 HEAD -- patches` was empty).

The pinned executable's `--version`, `--help`, `exec --help`, and `features list` were independently run without a model request. It is CLI 0.160.0. With the six overrides, `features list` reported all six false and `code_mode_host` true. Its help documents dotted `--config`, feature enable/disable flags, and `exec --ignore-user-config`.

### Listing cost and caching

The design starts one listing process per fresh, resumed, repair, or structured turn. Ordinary controlled fake turns, including the SDK fake process, took roughly 0.2 seconds here; this is not a measurement of the owner's real CLI startup. The implementer's 0.1-0.5 second listing measurement is historical evidence in its record.

I do **not** recommend caching server names by working directory alone. User configuration, trusted-project configuration, profiles, environment/Codex home, and installed/remote plugin state can change without changing that directory. A stale cache would miss a newly configured inherited server, violating fail-closed isolation. Any future P3 performance optimization needs explicit effective-configuration invalidation and a regression for a server added between turns; the current per-turn lookup is justified.

## 4. Built HTTP and inspector checks

Command: `node %TEMP%\gg-rev423-http.mjs` from the repository root with project Node, after `pnpm.cmd build`. The temporary CLI answers version/help/login probes and fails only `mcp list` with exit 2 and `REVIEW_MCP_LIST_FAILED: synthetic configuration failure`. It makes no provider calls.

The corrected probe passed on a disposable built gateway at port 6380. Both the initial failure and the failure after Resume contained:

```json
{
  "code": "HARNESS_TURN_FAILED",
  "message": "harness turn failed: Codex could not list the machine's MCP servers, so the turn did not start: mcp list exited 2: REVIEW_MCP_LIST_FAILED: synthetic configuration failure",
  "nodeId": "infer",
  "resumable": true,
  "details": { "adapterCode": "HARNESS_TURN_FAILED" },
  "inference": {
    "submission": "definitely-not-submitted",
    "promptKind": "authored"
  }
}
```

Visit and turn IDs are omitted above. The event history preserved the failure; the inspector in headless Microsoft Edge displayed the complete listing cause, `HARNESS_TURN_FAILED`, and the Resume control. Resume using the observed recovery sequence performed another listing and failed with the same cause. It did not turn this into delivery uncertainty, silently start a fresh conversation, or hide the cause. A resumable external configuration failure is appropriate here: the owner can fix the machine configuration before resuming. Two listing invocations and zero non-help SDK `exec` invocations were recorded. The gateway drained and exited 0.

Evidence: `%TEMP%\gg-rev423-http-corrected.log.txt`; redacted event JSON, inspector text/screenshot, and gateway log in `%TEMP%\gg-rev423-http-Pz9uS6`.

Source trace: `listingFailure` attaches submission metadata; `TurnAccumulator` preserves recognized typed failures; `harnessFailureSubmission` preserves explicit submission; engine `mapHarnessFailure` and inference failure recording retain the adapter cause and submission. The HTTP result verifies the complete path rather than inferring it from adapter tests alone.

## 5. Commands, tests, and gates

All pnpm invocations below used `pnpm.cmd` in Windows PowerShell and the project Node. `--force` disabled Turbo caching for the two requested coverage commands. API coverage was run with the requested two-worker limit.

| Command                                                                                                                                                                                                        | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git rev-parse HEAD`, `git branch --show-current`, `git status --short`, `git log --oneline a4fee9a9..HEAD`, `git diff a4fee9a9 HEAD` and targeted diff/read/search commands                                   | Pinned head confirmed; five commits reviewed; initially clean. Shared-file results below.                                                                                                                                                                                                                                                                                                                                                                           |
| `pnpm.cmd test:coverage --filter @graphgoblin/adapter-codex --force`                                                                                                                                           | PASS: 597 passed, 5 skipped; 15 files passed, one skipped. Lines 99.19% (490/494), branches 95.10% (447/470), statements 97.99%, functions 99.29%. Four live tests were skipped; the installed-login probe was also skipped in this environment.                                                                                                                                                                                                                    |
| `pnpm.cmd test:coverage --filter @graphgoblin/api --force -- --maxWorkers=2`                                                                                                                                   | FAIL: 1684 passed, 1 failed, 12 skipped; 102 files passed, one failed, two skipped. Duration 661.82 seconds. Failure was `script-persistence-restart.test.ts` / `a constructed pre-change unfinished script history never automatically repeats its effect`: `EADDRINUSE` at `127.0.0.1:5682` before the child API listened. This file is untouched by WP-423. No API coverage summary was emitted, so this review does not claim a passing API coverage threshold. |
| `pnpm.cmd --filter @graphgoblin/api exec vitest run src/script-persistence-restart.test.ts --maxWorkers=1`                                                                                                     | The single isolated rerun passed all 3 tests in 35.02 seconds. Both outcomes are retained; this does not relabel the original full coverage run as green. No full-suite retry was made.                                                                                                                                                                                                                                                                             |
| `pnpm.cmd build`                                                                                                                                                                                               | PASS: 11/11 tasks, all restored from Turbo cache.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `pnpm.cmd typecheck`                                                                                                                                                                                           | PASS: 20/20 tasks; 14 cached.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm.cmd lint`                                                                                                                                                                                                | PASS: 12/12 tasks; 6 cached.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `pnpm.cmd check:layers`                                                                                                                                                                                        | PASS: layer rules OK.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `pnpm.cmd check:deps`                                                                                                                                                                                          | PASS: 0 errors, 3 existing no-orphans warnings (`drizzle.config.ts`, `shutdown.config.ts`, `check-templates.d.mts`).                                                                                                                                                                                                                                                                                                                                                |
| `pnpm.cmd format:check`                                                                                                                                                                                        | PASS: all matched files used Prettier style. The newly added REVIEW.md was separately formatted and checked.                                                                                                                                                                                                                                                                                                                                                        |
| `git diff --check a4fee9a9 HEAD`                                                                                                                                                                               | Exit 1 for extra blank EOF lines in two evidence logs (`cli-investigation.log.txt:161`, `red-before.log.txt:340`). No product-code whitespace finding.                                                                                                                                                                                                                                                                                                              |
| `node %TEMP%\gg-rev423-probe.mjs` and `node %TEMP%\gg-rev423-prototype.mjs`                                                                                                                                    | Public-harness mechanism/fault probes described above, including confirmed finding 1.                                                                                                                                                                                                                                                                                                                                                                               |
| Pinned `codex.exe --version`, `--help`, `exec --help`, `features list` with the six feature overrides                                                                                                          | PASS: version/config surface and flags independently checked; no model turn. A second `features list` accepted the disposable `__proto__` server configuration.                                                                                                                                                                                                                                                                                                     |
| Compile `tooling/fixtures/model-switch-cli.cs` and `unlimited-codex.cs` with `Add-Type`; compile `apps/web/e2e/shutdown-fake-codex.ps1` with Windows PowerShell; invoke each executable with `mcp list --json` | All three returned `[]`, exit 0. No turn or native termination was needed.                                                                                                                                                                                                                                                                                                                                                                                          |
| From `apps/web`: `pnpm.cmd exec playwright test --config %TEMP%\gg-rev423-shutdown-Z2UPzI\shutdown.config.mjs --grep 'drain is visible everywhere'`                                                            | PASS in Microsoft Edge: 1 test, 28.5 seconds. This executed a temporary copy of `e2e/shutdown.spec.ts`, preserving its assertions and substituting only the absolute repository/module paths, allocated ports 6381-6389, and `gg-rev423-` prefix. The config had one worker, no retries, and traces off. Repository tests were unchanged.                                                                                                                           |
| Controlled `taskkill.exe /PID <reviewer's four-second Node probe PID> /T /F`                                                                                                                                   | Exit 1, exact refusal: `ERROR: Access denied`. The probe exited naturally. This is D-015, not a passing termination check.                                                                                                                                                                                                                                                                                                                                          |
| `Get-CimInstance Win32_Process` for process inventory                                                                                                                                                          | Refused: `Access denied`, `HRESULT 0x80041003`. No independent live process-tree evidence is claimed.                                                                                                                                                                                                                                                                                                                                                               |

Report formatting: `pnpm.cmd exec prettier --write docs/qa/2026-10-28-wp-423-isolation/REVIEW.md`, followed by the matching `--check` command, both passed.

Turbo also printed cache-write `Access is denied (os error 5)` warnings while successful gates completed. Those warnings are not the native-termination evidence above.

### Fixture consistency

`argv-cli.mjs`, `spec-cli.mjs`, both refusal preloads, the API shutdown-console C# fake, the Linux shutdown-process fake, the Windows browser fake, its POSIX equivalent, and the two turn-capable tooling C# fixtures all answer the listing without entering their turn path. The API suite passed the changed readiness, refusal/provenance, and shutdown-console test files. The Linux shutdown-process turn case remains platform-skipped on Windows. The readiness-only Node/C# fixtures intentionally refuse non-probe commands; they are not used as turn-capable CLIs and do not need a successful listing path.

### Probe setup corrections

The first temporary fault-preload probe checked `process.argv[1] === 'mcp'`, but Node provides a path there. That setup failed to inject banners, delays, and cancellation timing; those initial results were discarded. The corrected preload uses `basename` and establishes the results in section 3. Ordinary/prototype-server argument captures agreed in both runs.

The first HTTP probe sent Resume without mandatory `observedSeq` and received a correct 400 validation response. The corrected probe supplies the observed sequence and establishes the Resume result above. Both gateways exited normally.

The first temporary Playwright copy used a `file:` import that the runner's CommonJS transform could not resolve; no test ran. The absolute module-path correction allowed the single drain test to run. An attempted PowerShell `Env:` inventory also reported duplicate environment keys; subsequent environment stripping used the .NET environment dictionary. These were review-harness setup errors, not product-test failures or retries of failing assertions.

## 6. Documentation, owner intent, and shared files

`docs/06`, ADR-0063, guides 02/05/07, and the CHANGELOG correctly explain server-by-server switches, the feature defaults, per-node re-enabling, all-plugin re-enabling rather than one plugin, listing failure, and the retained code-mode host. The CHANGELOG has an actionable upgrade note for loops that relied on inherited servers, plugins, or sub-agents. The original unqualified “never leak” claim has been narrowed.

Shared-file scope is respected: `options.ts` adds the isolation import, changes the `clientOptions` configuration builder and its comments, and leaves `threadOptions`/`sanitizeConfig` implementation unchanged; `docs/06` changes the inheritance paragraph and the two capability/config rows; CHANGELOG adds one Unreleased bullet. No SDK patch or Claude implementation change was made.

**Judgment on remaining inheritance:** project trust, login/model access, and the CLI's own tool host are understandable operational prerequisites under option A. Model-provider selection, `service_tier`, `personality`, and `shell_environment_policy` still make behavior machine-dependent, but do not themselves load an MCP/plugin process. Personal skills and personal `AGENTS.md` are more directly in tension with the broad intent “without the machine's personal extensions”: they can inject personal instructions into a loop even after executable extensions are disabled. ADR-0063:52 and docs/06 explicitly disclose this rather than silently claiming full prompt isolation. This review does not invent an approved separate-Codex-home solution or classify these disclosed open decisions as an additional implementation blocker.

**Recommended next step:** obtain a scoped owner decision about personal skills/instructions and uncaptured behavior settings; then verify the chosen per-invocation controls with a disposable personal-skill/instruction canary. Keep public claims limited to the enumerated exclusions until that is resolved. The code-mode host should remain under the explicit follow-up instruction.

**Sub-agent evidence remains open:** ADR-0063:65-67 accurately distinguishes CLI flag acceptance from model-visible tool availability. The existing real after-turn/re-enable evidence predates the final `multi_agent`/`goals` follow-up. The final dry run verifies arguments and an idle process tree, not the absence of sub-agent tools. Persistent multi-agent prompt sections prove neither that those tools remain nor that they are gone. A subsequently authorized real-turn/tool inventory is the next acceptance evidence; none was attempted in this D-005 review.

## 7. Not run and evidence limits

- **Not run here:** the second browser shutdown case, `confirmed force interrupts a controlled native harness, releases ownership and preserves interruption on restart`, because native force termination is unavailable under D-015 (`taskkill`: `ERROR: Access denied`, exit 1). The full two-case shutdown spec is therefore not signed off by this review. No substitute test was presented as a native force-stop pass.
- No real Codex/Claude inference, no re-run of the implementer's process-tree scripts, and no session-record removal. Real process trees and Claude behavior are attributed to the implementer's retained record. The retained `codex-main-before.log.txt`, `codex-fix-after.log.txt`, and `codex-fix-reenable.log.txt` were read directly: their PID/parent trees, CLI arguments, and successful one-turn outcomes match the README excerpts. The retained Claude debug log likewise records disabled installed plugins/connectors and skipped personal skill discovery. Source confirms Claude's unchanged `--safe-mode --setting-sources "" --strict-mcp-config` launch policy and runtime checks.
- No independent rerun of engine/infrastructure coverage, the full web suite, full tooling acceptance suite, Linux-only shutdown cases, or model-visible sub-agent tool inspection. Adapter coverage, the full API attempt, the built failure/inspector probe, and the available Edge shutdown case are the independent evidence obtained here.
- `docs:generate`/`check:docs`, licence and token gates were not run: no schema, route, dependency, or `apps/web/src` change requires them.
- No new test was added, so no new red-before claim is made. The implementer's existing red-before log was inspected; this review independently reproduces the newly found defect at the reviewed head.
- Reviewer captures and disposable stores remain under the named `%TEMP%\gg-rev423-*` paths for inspection; no manual directory cleanup was attempted. Text evidence is redacted and UTF-8 without BOM. No compressed trace is required for this review.

The verdict remains **CHANGES REQUIRED** for finding 1. The unrelated API-suite collision and native-test limits remain separately reported; neither is a claimed WP-423 product regression or a green acceptance result.

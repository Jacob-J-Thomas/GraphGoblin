# Independent #442 QA — backend checkpoint

**Backend phase PASS within the declared scope. Integrated UI/browser QA remains pending.**
Configured QA model: GPT-6.1 Sol xhigh. This is independent touched-system behavior QA, not
formal review, CI, final audit, production-provider acceptance, or human acceptance.

## Source and evidence binding

Independent detached checkout: `G:/ggq/gg-i4-442-qa/GraphGoblin`.

- Backend commit: `5b0d806c75d409c33a57ea54ffda45e2f89bc500`.
- Tree: `8e24c697b40eb1a4ab4cd81f481fce53494a2ce7`.
- Parent: `02351e2fb932b3be44e7cc3fb3943a61d568226c`.
- All seven backend frozen-file hashes match root's source freeze. Initial and final tracked
  status are clean. No author checkout edit, source/index mutation, product commit/push,
  issue write, or owner-state access occurred.
- Node `v22.23.4`, pnpm `12.8.1`. Offline frozen install PASS. One full `pnpm.cmd build`
  PASS: 12/12 tasks, zero cache hits, 1m0.095s. No full coverage run in this phase.
- `backend-source-build-binding.json` binds source and 1,271 built outputs. Preserve those
  outputs for later incremental UI verification; coordinate before another heavy build.

Read AGENTS, docs README/12/15, the intent-4 register, D175, D185, original discovery PLAN/REPORT,
backend author REPORT, and relevant harness/preflight/distribution/troubleshooting docs/source.
`PLAN.md` declares finite predictions before execution. D185 was selected by the coordinator,
not a new owner acceptance. Inputs include 174 original files with SHA-256 hashes: the complete
discovery packet, complete backend-author packet, root source freeze, D175 and D185.

## Built CLI and real HTTP results

`public-qa.mjs` and `fixture-cli.mjs` are independently authored, local evidence drivers.
The real built application spawns the harmless executable fixture through its actual native
process boundary. The fixture accepts only version/help/login commands and records PID, parent,
argv, cwd and disposable home. It never runs an SDK worker or accesses a model provider.

**19/19 declared checks PASS**, process exit 0, in `public-qa-01.log` and `public-results.json`:

| Boundary | Observed result |
| --- | --- |
| Built `main.js --preflight`, ready Codex | Exactly one `Codex plugins` warning with the selected fixed text; warning-only exit 0; ready to start |
| Built command, auth failure | Exit 1; existing authentication failure; no success notice |
| Built command, incompatible required help | Exit 1; no success notice; stopped after second command |
| Built command, unknown/version failure | Exit 1; no success notice; stopped after first command |
| Built command, missing executable | Exit 1; no success notice; no fixture call |
| Built public method, absent Codex / only other ready harness | No `plugins.codex` notice. These two map controls use the built public method with controlled ports, not native-provider evidence |
| HTTP no key / wrong key, both preflight routes | 401, no native prerequisite call |
| HTTP loops-only key, both preflight routes | 403, no native prerequisite call |
| Authorized `GET /system/preflight`, ready Codex | 200, `ok:true`, `harness.codex` ready/ok, exactly one independent `plugins.codex` warn row |
| Authorized `GET /harness/preflight`, ready Codex | Exact Codex object: harness codex, state ready, ok true, version 0.160.0, authenticated true, problems [] |
| System/harness routes after sign-in failure | Existing failed auth facts preserved; authenticated false on harness object; no fixed success notice |
| Explicit repeat after sign-in repair | System route again returns ready with the fixed warning |
| Child command accounting and cleanup | Only the existing four no-turn commands; no inventory/app-server/worker command; probe-temp directory empty |

Each successful/fully examined prerequisite probe invokes exactly:

```text
--version
exec --help
exec resume --help
login status
```

31 fixture child calls total. Every public diagnostic CLI case preserves its pre/post
store-file hashes; first-run cases create no store. The authenticated gateway uses a separately
initialized disposable store and generated QA-only keys. It is shut down via the existing
authenticated shutdown route: accepted 202, gateway exit 0. Raw response/argv bodies are retained;
QA tokens are redacted in retained key-command outputs.

These facts establish the actual built command/HTTP boundary over controlled executable facts.
They do not establish a real Codex account's authentication, model access, provider health, or
arbitrary third-party plugin health. No extra probe is inferred merely from source reasoning:
the fixture rejects unexpected commands and all recorded calls were inspected.

## Finite actual CLI same-session repair observation

D185 adds one bounded control to the previously unperformed repair observation. It uses the
actual independently installed SDK/native CLI, the built GraphGoblin Codex harness, an owned
Git plugin installed through supported CLI commands with `file://` transport, an owned harmless
stdio MCP, and a synthetic loopback Responses endpoint. No provider account or paid turn.

`repair-qa.mjs`, `repair-qa-01.log`, `repair-results.json`, native stdout/stderr and fixture MCP
events preserve exact source, requests, events, child argv/PID and native binary SHA-256.

| Turn | Actual worker observation | Lifecycle |
| --- | --- | --- |
| Fresh, authored MCP asset missing before installation | Available fixture tools `[]`; normal final completion | Two loopback requests; native inventory and worker exit 0/no signal |
| Add asset in authored Git source, local fixture commit, supported CLI remove/add; resume exact session once | `mcp__gg442repair__echo_repaired` available and called; actual `GG442_REPAIRED_TOOL_OK` result | Two loopback requests; native inventory and worker exit 0/no signal |

The exact same session ID is `01a1fd9b-089a-7f11-a9ee-76cb09e4c42a` in both turns. Total is exactly
two turns / four synthetic loopback requests, zero retries, within the 30-second turn and
5-second acknowledgement bounds. Both post-turn command-line ownership censuses are `[]`.
No cleanup kill was needed. This measures one successful supported reinstall/resume outcome;
it is not a promise that all repaired plugins reload, and preflight still did not verify tools.

No app-server, cache inspection/edit, feature-flag experiment or external Git source was used.
The Git source and transport are local. The only configured Responses provider is loopback;
analytics/feedback are disabled and owner auth/config is absent. No comprehensive packet capture
was run, so the evidence does not claim an exhaustive network-negative audit.

## Original failures remain original failures

The copied, hashed discovery/author packets preserve all original bytes and their source
bindings. Historical discovery is not relabelled as independent QA:

- Two earlier plugin-enabled worker attempts ended `HARNESS_TERMINATION_UNCONFIRMED`; they
  remain failed/unconfirmed. Their cause is unresolved.
- Three app-server containment attempts observed curated HTTPS Git fetching, including a
  supported `remote_plugin=false` attempt; that lane remains stopped. Its bad-asset/unknown-ID
  comparison was not completed, and no universal CLI diagnostic-inability claim follows.
- The first CLI-only healthy worker produced a tool result and normal SDK result, but an invalid
  injected `close` assertion failed after the SDK removed listeners. Direct native exit was not
  independently recorded for that original worker. Its failure is not a clean native-exit pass.
- Earlier fixture setup/resolution/Git-input errors and original failed regression remain in
  their raw packets. They were not retried here for green or counted as current acceptance.
- The two plugins-off controls and twelve distinct continuation cases are historical native
  evidence on base `02351e2f`, with local/file-transport limits. This pass independently adds the
  built diagnostic boundaries and exactly the two repair turns above.

One evidence-enumeration setup correction occurred in this pass: the first output-hash command
looked one directory too deep and reported zero outputs. It was corrected to bind 1,271 actual
outputs before the checkpoint. This was an artifact enumerator error, not a build/product test
failure; no failing product case or failed native turn was discarded.

## Final lifecycle and remaining gates

`final-owned-process-check.json` at 2026-11-21T10:16:36Z records no owned processes, no remaining
public-store lock, clean independent Git status, exact backend HEAD, and the actual MCP tool call.
All fixture homes/config/temp/store/plugin sources are disposable and retained as evidence.
No owner store/config/credentials/plugins/service, ports 4747/4748, default Ollama 11434, issue
write, publication, deployment, or paid provider was used. No source/index change was made.
The only Git commits in this pass are isolated local plugin-fixture provenance commits.

Remaining: integrated actual-Claude UI source binding and incremental build; real browser
Settings Ready/failed/Retry/Codex-only notice checks, visual/accessibility observations and
screenshots. Opposite-family reviews, normal coverage/current-head/current-target CI, final
designated audit, #439 obligations and owner acceptance remain separate root-owned gates.
This report is a backend checkpoint and must not be sealed or labelled complete delivery.

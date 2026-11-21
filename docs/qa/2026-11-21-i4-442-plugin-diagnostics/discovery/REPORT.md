# #442 discovery checkpoint

Author context `/root/i4_448_preflight`, GPT-6.1 Sol xhigh. Evidence/design only; no implementation,
commit, push, PR or issue write. Recommended bounded surface is in PLAN.md, pending selection.

Final discovery status: two plugins-off controls PASS. The first CLI-only healthy plugin control
completed normally and exercised the actual tool, but its driver exited 1 on an invalid `close`
observer assertion. That failure is preserved and explained below. The remaining twelve distinct
plugin cases then PASS in one continuation with actual tool/absence evidence, native exit0 and
owned-process absence. Earlier unconfirmed attempts remain failed; app-server containment remains
unresolved and that lane is stopped. No current remote HTTP/auth/marketplace-service health claim.

## Source and environment

Worktree `G:/ggq/gg-i4-442-plugin-diagnostics/GraphGoblin`, branch
`codex/gg-i4-442-plugin-diagnostics`, immutable clean base
`02351e2fb932b3be44e7cc3fb3943a61d568226c`. source-binding.json records exact source hashes and
empty Git status. The separate #448 frozen checkout was not changed.

Read AGENTS, docs/README, docs/12, docs/15, current cli.ts/harness/isolation/options, numbered
harness/preflight docs and the original #439 native driver. Live #442 was open/aidlc-ready with
Sol implementation and Opus review routing and November 21 D171 admission.

Project-scoped Node v22.23.4 and pnpm.cmd 12.8.1. Frozen offline install passed (install.log),
unchanged lock. No build or product tests were run: this phase only executes disposable discovery
scripts, actual pinned native CLI and source adapter fixtures through tsx development conditions.
Native binary and SDK provenance are in cli-help-and-schema.json and native result manifests.

All test homes/config, plugin packages and repositories are disposable scratch data. Child
CODEX_HOME/HOME/USERPROFILE/APPDATA/LOCALAPPDATA point at scratch homes; base environments allow
only PATH/PATHEXT/SYSTEMROOT/WINDIR/TEMP/TMP/COMSPEC. No owner home/config/auth/store/service or
ports 4747/4748 were used. Local provider responses and the MCP echo tool are controlled.
No paid provider action occurred. **Do not claim no external network:** curated Git fetches were
observed in the app-server/worker exploratory lane and are retained below.

## Supported interfaces found

Pinned CLI reports codex-cli 0.160.0. All inspected help commands exited 0. cli-help.json,
cli-help-expanded.json and cli-help-and-schema.json preserve terminal output and arguments.

- plugin list --json / --available / --marketplace: configured/installed/available inventory.
- mcp list --json: configured MCP inventory; auth_status=unsupported for harmless stdio echo
  is not a plugin-health result.
- debug prompt-input: rendered prompt input. It did not supply expected-versus-loaded health.
- debug help: models, app-server send-message tooling and prompt-input; no named plugin-health
  command is advertised.
- app-server generate-json-schema: supported generated protocol exposes config/read,
  plugin/list, plugin/installed, plugin/read, mcpServerStatus/list and config-warning notifications.
  Generated schemas are retained in G:/ggq/gg442-help-oeBhh0/schema and schema-experimental.
- plugin/read includes declared mcpServers names; list/installed include marketplaceLoadErrors.
  This is useful inventory, not automatically worker health. No universal unsupported-CLI claim
  is warranted merely because GraphGoblin currently does not use those interfaces.

Current GraphGoblin preflight performs version/help/login checks (cli.ts), and returns ready with
problems=[] on success. HarnessPreflight is strict and has no informational warnings field.
System preflight renders successful harness readiness as installed/logged-in and reads problems
for failed checks. Generic PreflightCheck already supports warning rows, making PLAN.md's scoped
system warning possible without changing readiness or execution policy.

## Fresh CLI-only results: both source lanes

Relevant raw generated protocol schemas are also copied to supported-schemas/ in this packet;
their exact bytes and the remaining evidence files are bound by evidence-sha256.json.

Authored malformed MCP paths exist **before** scratch installation. No private installed cache
was opened, mutated, scanned or repaired by this driver. Public CLI plugin install output may
mention its own cache path; retaining that result is not a private-cache validator.

| Authored state | plugin list JSON | mcp list JSON | exit / stderr |
| --- | --- | --- | --- |
| Healthy fixture | installed=true, enabled=true | gg442_fixture configured | 0 / empty |
| Unknown enabled ID alongside healthy plugin | unknown ID omitted; healthy row remains enabled | healthy server only | 0 / empty |
| Enabled plugin manifest points at missing.json | installed=true, enabled=true | [] | 0 / empty |
| Individually disabled healthy fixture | installed=true, enabled=false | [] | 0 / empty |

These outcomes were observed for local path sources and Git-sourced plugins cloned over file://
local transport. `metadata-only-result-initial.json` and `git-metadata-only-result.json`, their
per-case JSON files and logs preserve the exact outputs. All Git plugin source URLs remain owned
local files; D173 explicitly limits this to repository install/loading/provenance behavior, not
HTTP/auth/network or live remote service behavior. CLI metadata alone is not an accepted worker
health or runtime policy pass.

The prototype's `*-node-off` metadata-only rows retain an override object but do not apply it to
those diagnostic CLI calls and run no worker. They establish **no node opt-out result**. Raw
prototype summaries saying `passed:5` count metadata rows only, never accepted native workers.
At that metadata-only stage, fresh runtime global-disable/node-opt-in, resume and same-session
repair controls were unperformed; the later CLI-only section records new runtime observations
without reinterpreting these metadata rows.

The Git fixture initially used the output protocol's `source:git` spelling as an input source.
That entry was skipped and plugin install returned not-found; metadata-only.log retains failure.
Official plugin packaging docs specify input `source:url` for a repository-root plugin. After
that documented fixture correction, actual pinned CLI installation reports normalized source:git
and the five Git metadata rows execute successfully (git-metadata-only.log). The contemporary
documentation is a schema lead, not by itself evidence about the pin:
[OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins).

## Native/app-server attempts and limits

**At this earlier exploratory checkpoint, accepted complete native worker cases were 0.** Two fresh healthy attempts exposed and invoked
mcp__gg442_fixture__echo_fixture with GG442_PLUGIN_OK in the controlled worker's actual ALL_TOOLS
and output, but both ended after the 30-second fixture abort with
HARNESS_TERMINATION_UNCONFIRMED (5-second acknowledgement bound). Neither is PASS. Unknown-ID and
missing-asset worker turns were not reached; old #439 results remain historical evidence only.

1. native-discovery-03.log / native-discovery-result-03.json / responses-requests-03.json and
   native-discovery-03.mjs retain the first real source-harness/SDK/native attempt. Supported
   app-server startup spawned Git fetch of OpenAI curated plugins into the scratch CODEX_HOME.
   This was observed despite plugin/list marketplaceKinds=[local]. That argument does not prove
   startup avoids remote curated syncing. Initial plugin/read used the directory and returned
   Access denied; the list's supported marketplace path showed it expects marketplace.json.
2. D174 selected child-only Git protocol http/https/ssh deny, file allow, isolated Git global/system
   config and terminal prompting disabled. native-discovery-04.log/result/source preserve the
   actual negative containment result: a curated HTTPS fetch still occurred. No claim is made
   about why those environment settings did not prevent it. Corrected plugin/read of the file
   returned healthy mcpServers=[gg442_fixture], marketplaceLoadErrors=[], and mcpServerStatus/list
   included the harmless tool. These results are limited to that healthy scratch plugin.
3. At the coordinator's amended D174 selection, exactly one additional app-server probe ran
   **without any worker/model turn**: argv app-server --disable remote_plugin --stdio.
   flagged-appserver-probe-result.json proves effective config.read features.remote_plugin=false,
   while its owned process watcher still observed HTTPS curated Git fetches (49 nonempty sampled
   observation lines). The app-server required its owned 5-second forced-stop path after EOF.
   The flag is therefore not an established curated-sync containment control. This lane is stopped;
   no more flag/cache/network experiments are authorized or claimed.

The app-server lane did not reach missing-asset/unknown-ID comparisons. Its healthy metadata
results do not prove those interfaces are incapable of exposing a relevant error. The recommended
warning therefore says GraphGoblin preflight **does not verify** plugin tools, rather than saying
the whole CLI has no observability interface.

## Cleanup and retained failures

On the first two exploratory attempts, the author interrupted the owned run and re-read known Git
process command lines against its exact scratch root before any Stop-Process. No broad/name-only
kill was used and unrelated processes were left alone. curated-fetch-owned-processes.json,
curated-fetch-after-stop.json, curated-fetch-04-owned-processes.json and
curated-fetch-04-after-stop.json retain checks. Both after-stop arrays are [].
flagged-probe-after-stop.json is [] after the single flagged probe. Fixture directories remain
retained as evidence, not as running helpers. No personal plugin install/uninstall/repair occurred.

Additional setup errors are retained: cli-help.log's initial createRequire resolution hit the
import-only SDK export; the corrected ESM resolve used Node's supported parent resolution flag.
native-discovery.log records root-level tsx not found; the API package's installed tsx was then
used. native-discovery-02.log/result records a fixture mkdir parent race, fixed with recursive
owned-directory creation before any native case. These are fixture corrections, not product fixes
or passing checks; no error output was discarded.

#427 independent QA provided a read-only path to its working source fixture. Its plain-message
SSE completion matches this driver's response shape, but it disables plugins and uses no tools;
that success does not resolve this two-round tool/termination limit. No #427 artifact/service was
modified or used for a turn. Further finite diagnosis should separate a plugins-off plain control
from a plugins-off two-round functions.exec control with owned native stdout/stderr/event/PID
evidence, before another healthy plugin turn. The parent subsequently selected and completed
that finite sequence, retained in the next section.

## Finite diagnosis and CLI-only matrix completion

The parent approved two plugins-off controls before another healthy plugin attempt. The
instrumented two-control-diagnosis.mjs uses the real source harness, pinned SDK/native CLI,
controlled Responses endpoint and no app-server call. Both PASS: plain message, one model request,
~1.26 s; two-round functions.exec, two requests, ~1.34 s. Both return GG442_CONTROL_OK; raw native
stdout/stderr, source events, PID/argv and closure records are retained in two-control-result.json
and per-control artifacts. Owned-process checks were [], with no cleanup kill. This establishes
that the two-round fixture can finish with plugins off; it does not identify the earlier hang's
cause. The corrected fixture also uses distinct response IDs and consumes source events; these
changes are retained and cannot be silently treated as a controlled causal comparison.

Next, the parent approved one CLI-only healthy plugin control followed by distinct matrix cases
only if the control completed cleanly. No app-server is started by this driver. It authors healthy
and broken local/Git plugins before installing them through supported CLI commands, configures
only the selected owned fixture, and lets normal inheritance/overrides act through the source
adapter. The first healthy local control returned GG442_CONTROL_OK, actual MCP GG442_PLUGIN_OK,
and raw native item.completed(mcp_tool_call), item.completed(agent_message), turn.completed.
Its owned-process query returned [] with no kills, ~1.7 s; no abort/unconfirmed-termination error.

The script nevertheless exited 1 because its injected native observer asserted `child.close`
had fired. Fresh pinned SDK source (dist/index.js:286-310) waits for `child.exit`, drains stdout,
requires exit code0/no signal, then executes `child.removeAllListeners()` in finally. It can remove
the injected close listener before that later event. Thus missing observer `close` was not proof
of a surviving process. Original source, result and terminal are preserved as
plugin-cli-matrix-01.mjs, plugin-cli-matrix-result-01.json and plugin-cli-matrix.log. The healthy
behavior is established by the public SDK result and OS absence; direct exit0 was not independently
recorded for that first native process, and that observation limit remains explicit.

The corrected driver records native `exit` before the SDK removes listeners. It continued in the
same retained scratch home/session **without rerunning that healthy local control**. The twelve
remaining distinct cases all PASS in plugin-cli-matrix-continuation.log/result.json, each with
two controlled model requests, normal final text, native exit0 observed before the harness result,
and owned-process query []. No cleanup kill was needed and no provider fallback/retry occurred.

| Native CLI-only case | Actual worker tool outcome |
| --- | --- |
| Local missing MCP asset | [] and normal turn completion; no actionable skipped-plugin error |
| Local unknown enabled ID + healthy fixture | healthy echo available and invoked; unknown ID silently ignored |
| Local individual disable | [] |
| Local node features.plugins=false | [] |
| Git-sourced/file-transport healthy | expected Git fixture echo available and invoked |
| Git-sourced/file-transport missing asset | [] and normal completion; no skipped-plugin error |
| Git-sourced/file-transport unknown ID + healthy fixture | healthy echo available and invoked; unknown silently ignored |
| Git-sourced/file-transport individual disable | [] |
| Git-sourced/file-transport node opt-out | [] |
| Local global feature disable | [] |
| Local explicit node opt-in under global feature disable | healthy echo available and invoked |
| Local same-session resume | healthy echo available and invoked; exact original session ID reused |

Each positive observes actual worker ALL_TOOLS plus a successful harmless MCP invocation; each
negative checks the actual worker's returned availability, not argv or process count alone.
Those fixture tools establish these authored cases, not arbitrary third-party plugin health or
a model's independent tool-selection skill. No HTTP/auth/live remote marketplace behavior is
established by file:// Git sources. The earlier app-server Git fetches remain real observations;
absence of a matching process at a later sample is not proof of zero external network activity.

## Remaining work before acceptance

Implemented: nothing. Complete evidence: pinned help/schema inventory, local/Git CLI omissions,
disabled metadata, two plugins-off controls, one observed-complete local healthy control with the
retained observer defect, twelve passing continuation scenarios, negative app-server containment
probes and scoped cleanup. Investigated/unresolved: cause of the first two unconfirmed attempts,
app-server containment and its bad-asset/unknown diagnostics. Unperformed: same-session output
repair, product implementation/tests, independent review/QA, full coverage, exact-head/current-target
CI and final audit. Normal CLI-only plugin behavior is now freshly measured within the stated
fixture boundary; no earlier failure is relabelled as a pass.

No #439 or other owner acceptance/closure obligation is changed. This checkpoint supplies a
concrete bounded plan with those limits for coordinator selection; it is not a clean or exhaustive
plugin-health assessment.

# Independent #442 QA — declared finite predictions

This is independent behavior QA by configured GPT-6.1 Sol xhigh, not formal review, provider acceptance, CI, final audit, or human acceptance. Backend source: detached commit `5b0d806c75d409c33a57ea54ffda45e2f89bc500`, tree `8e24c697b40eb1a4ab4cd81f481fce53494a2ce7`, parent `02351e2fb932b3be44e7cc3fb3943a61d568226c`. Independent checkout: `G:/ggq/gg-i4-442-qa/GraphGoblin`. Never edit the author checkout or tracked source/index.

Read AGENTS, docs README/12/15, register intent 4, D175, original discovery PLAN/REPORT, backend author REPORT, relevant preflight/harness/distribution/troubleshooting docs and source. D175 selects the fixed warning without new probes or altered readiness. Original evidence is copied with hashes, including failures. Original discovery is source-bound historical actual CLI evidence; it is not my native result.

## Predictions declared before execution

1. Built `main.js --preflight` with independently authored harmless version/help/login executable will print exactly one Codex plugin warning when Codex is ready, still exit 0 for warning-only reports, and invoke exactly version, exec help, resume help and login status. No plugin inventory, config, app-server or worker/model call.
2. Built command negatives: Codex login failure, incompatible help, missing executable and unknown/version failure retain failure exit 1 and omit the plugin warning. A non-Codex default still has no success warning when Codex fails. Claude readiness must not add a Codex notice. Disposable store/config remain untouched by diagnostic commands except exclusive temporary writable probes that clean up.
3. Authenticated disposable running built gateway: no-key and incorrect-key system/harness preflight requests retain 401; read-only insufficient-scope key retains 403 for system diagnostics. Authorized `GET /system/preflight` returns the warning independently of ready Codex/authenticated true and no added probe commands; `GET /harness/preflight` keeps exact ready/auth response shape with no warning/problem injection. After a fixture login failure, system/harness reflect auth failure without the success warning. Explicit retry after repair returns ready and the warning. Only expected native command argv appear, with per-request counters and no provider/inventory call.
4. The earlier source-harness/native matrix established some authored plugin behavior, with retained observer/termination/containment failures. Do not repeat it for green or infer universal plugin health from it.
5. Coordinator-selected finite repair control: independently author a local Git plugin with a missing MCP asset before supported file-transport installation; fresh controlled worker should complete while observing the expected tool absent. Repair the authored source, commit locally in the owned fixture and reinstall using supported local CLI. Resume exact session once. Possible outcomes are explicitly open: the repaired tool may become available and callable, or the resumed CLI may retain old tool availability. Observe rather than assume reload. This change makes a scope notice, so retained old availability alone is a documented CLI limit rather than a defect in the notice.

Repair budget: exactly two turns, at most four loopback Responses requests, 30 seconds per turn plus 5-second acknowledgement. No retries, app-server, private cache inspection/edit, feature experiments, remote Git or paid provider. Stop on unconfirmed termination. Native exit0 and owned-process absence required for a completed result. Tool availability/result must come from actual worker output, never argv alone.

## Isolation, lifecycle and sequencing

One offline frozen install and one full build now. Preserve exact logs/source hashes and built outputs for the later integrated UI incremental build; coordinate before another heavy build. No full coverage in this phase.

Use QA-owned home/config/temp/store/plugin/repository paths and loopback ephemeral ports only; never ports 4747/4748 or default Ollama 11434. Child environment allowlist excludes owner auth/config. Ollama explicitly disabled. Controlled fixture records argv/PID/cwd, rejects unexpected commands and never calls a provider. Generated fixture auth/API credentials belong only to disposable QA store. Native control uses only loopback server and file:// Git source; do not claim absence of network merely from later process absence.

Record all original harness errors and attempts rather than replacing results. Capture process start/exit and final command-line ownership census. Gracefully stop owned gateway through authenticated shutdown or owned IPC; bounded forced tree stop only after exact PID/command-line verification. No name-only cleanup.

## Deferred integrated UI gate

Await root's frozen actual-Claude UI head. Rebind independent checkout, incremental build with source/output hashes, then real browser Settings ready/failed/retry/Codex-only copy/accessibility checks and screenshots. Backend phase remains a checkpoint until those checks and root-owned review/CI/audit gates are handled.

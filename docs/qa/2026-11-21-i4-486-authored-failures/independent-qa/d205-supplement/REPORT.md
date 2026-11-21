# #486 independent supplemental and D204 corrective QA

**PASS for the bounded D205 scope. No product failure was observed.** All **29 final scenario records passed**: 14 required supplemental scenarios, 10 D204 fixtures, one additional genuine authored-JSONata privacy control, and four public-surface/history/reopen checks. This supports a coordinator QA disposition together with the mapped prior executed controls and the original Opus evidence. The original Opus report remains **CONDITIONAL**, unchanged; this packet does not claim current-target CI, final audit, owner acceptance, merge or deployment.

## Exact source and execution

- Clean detached source **4d982162ca60e885d5af22f66076383a048215db**, tree **b9e4ce6463df9c47ba43bd47236ae61d60876aeb**, parent633, at `G:/ggq/gg-i4-486-d204-qa/GraphGoblin`.
- Before execution and again after completion: preparation seal **48/48**, source **1,747/1,747**, build outputs **1,247/1,247** match every recorded size and SHA-256. Preparation seal SHA `408c8f092d9c3cc7cbb74cbe98e12dab34261ebf25b71e5434c071e309185070`; source manifest `8a96de3ca023c13d9a27c1a9d9ec175fa6e8957b66c3817cec7120800e397b1d`; output manifest `fefdf00c163f390697d1b1df1252a073e4426cfde4a1e863220a94f5e4204701`.
- Original source633 Opus packet rechecked after this work: **200/200** unchanged, seal `f334af3e4989a6a22bae733d475aa87ef3f147bcde83f531c6f2e31191279388`. No old evidence was overwritten or relabelled as new execution.
- Runtime **Node22.23.4**, pnpm12.8.1. QA drivers import the prepared **built** modules. No rebuild, install, product/test-source edit, index operation, provider request, owner-store access, GitHub write, extra agent or provider was performed. Each process used a new scratch cwd/TEMP/TMP. D205 SHA `3e44a2d2eedc68b4c7063f52bc127bc177e82a20bb0855ed578fbf780e653a2f` was verified before execution.
- Independent executor context is distinct from the correction author. This packet is not the actual Claude Opus broad QA or a formal implementation review. Model/role authority is D205; no new provider envelope or model-identity claim is manufactured here.

Admission and final comparisons: [admission.json](./binding/admission.json), [final-verification.json](./binding/final-verification.json). Every attempt retains the command, cwd, environment overrides, timestamps, exit status, stdout/stderr, raw observations, exact driver/library `input-copy` bytes and hashes. API/seam rows carry their precise class in `actual.evidenceClass`; the common recorder's generic top-level class is not used to claim native or synthetic coverage.

## New results

| Group | Final outcome | What the executed assertions establish |
| --- | --- | --- |
| [S1](./results/s1/attempt-1/results.json) | **3/3**, attempt1 | True domain error, name spoof and plain code object thrown synchronously by ordinary continuation `resume` retain harness policy. The new continuation task is D before its handle; exact recovery repeats its stored continuation prompt/session choice and **same turnId**, with no fresh authored start or invented retry/acceptance. Earlier accepted work remains factual history. |
| [S2](./results/s2/attempt-1/results.json) | **3/3**, attempt1 | Retriable acknowledged D transport performs exactly one automatic retry with identical request/turn, one old-handle cleanup and no explicit Resume. Positive-acceptance Q performs no automatic retry and later explicitly continues its usable session. A real node timeout during contextWindow admission produces INFERENCE_TIMEOUT/true with **zero turn/start/resume**, no authored phase and an observed abort. |
| [S3](./results/s3/attempt-1/results.json) | **6/6**, attempt1 | Structured timeout and typed artifact failure after accepted main success retain their own codes, main provenance and no authored phase/sentence. Artifact recovery and unexpected structured exception recovery actually continue the existing session. Output coerce repair-prompt fault is B19/after-result/false with no structured call. Input/output coerce target-write faults retain exact PATCH_ERROR operation attribution: input has no main turn; output retains the actual main turn and phase. |
| [S4](./results/s4/attempt-1/results.json) | **2/2**, attempt1 | A **published data-only JSONata function result** reaches inference serialization outside the mapper: ordinary safe internal/Q/true, no authored phase, actual continuation on Resume and no partial vars commit. A valid inference transform setting `/vars` to a scalar reaches **executor final-thread validation**, yielding internal/false with no fabricated inference provenance or phase. This is direct inference execution, not substitution of the existing Mutate test. |
| [D204 reconstruction](./results/d204-recon/attempt-1/results.json) | **2/2**, attempt1 | Explicit **synthetic custom-handler** internal errors with prior real scripted D/Q tasks preserve the private diagnostic through RunManager reconstruction; logs correlate run/node and marker, while error JSON/options, public failure/events omit it. Prior inference, submissions and session rows remain equal, with no retry metadata. This is not a naturally reached canonical rerender with a pending task. |
| [D204 API](./results/d204-api/attempt-2/results.json) | **8/8 corrective fixtures**, attempt2 | Canonical trim success, synthetic canonical rerender diagnostic, fresh invalid/empty inference workspace, and all four **naturally reached restart** D/Q × invalid/empty workspace cases described below. |
| Same API group, A2 | **1/1 additional fixture** | A genuine output `$error` gives the safe after-result authored failure; its evaluator marker is absent from scoped captured logs, stored failure/event and public projections. Safe failure logging still occurs. |
| Same API group, surfaces/history | **4/4** | Built MCP get/wait full parity; real browser fixed copy/privacy/recovery controls; unchanged selected rows/events after reads/new publication; clean disk reopen with byte-identical selected row/event and public-failure hashes. |

The S1–S4 groups use the built public RunManager with scripted/fake ports. Their passes do not claim native disk, process, provider or network behavior. D204 API uses a real built authenticated server, production filesystem/workspace adapters and disk-backed SQLite, with scripted harnesses, a capturing logger and a **delegating** workspace-call counter. MCP is the built stdio child; the inspector is the actual built web app in Chromium.

## D204 diagnostic and workspace observations

The synthetic canonical fault was injected only into the engine canonical renderer import using a QA-owned Node resolution hook. It produced the existing safe INTERNAL_ERROR at `respond`, resumable true, after context-window admission and with **zero provider starts/turns**. A captured private `node failed` record contains the exact cause and stack markers with the correct runId/nodeId. Those markers are absent from stored row, matching `run.failed`, REST, full MCP and actual rendered page. A separate unfaulted canonical run really trimmed the oldest history pair and retained the recent pair before one scripted main call.

The stronger workspace restart cases all reached naturally. The **unchanged pinned template** used:

```liquid
{% if counters.nodeVisits.infer > 1 %}<runtime include fault or whitespace>{% else %}<owned valid directory>{% endif %}
```

Each initial real visit created its owned native directory and established a real scripted task with either D or accepted usable Q. The API drained, closed and disposed; the same disk store reopened in a new container. The durable next `node.started` incremented `counters.nodeVisits.infer` from1 to2. With the old manager's successful workspace cache gone, the same template then rendered an include fault or empty path. **No pinned definition was edited, no synthetic prior was injected, and no early unusable-Q guard was bypassed.** These were accepted-Q fixtures, not unusable-Q or missing-session tasks.

All four failures were the typed safe `settings.workingDirectory.template`/false. They retained the exact prior turn/session/submission provenance and session row; old submission/turn events were byte-equal, there was no new harness turn/start/resume or retry object, and the delegating workspace counter recorded **zero new resolve/write calls**. A subsequent read-only native SQLite/filesystem check verified all four initial directories exist and their pinned workspace templates remain exact; both fresh failed-workspace runs have zero `run_resource_uses` rows. [Native readback](./native-workspace-readback.json).

The two diagnostic-reconstruction fixtures remain explicitly synthetic because normal canonical trimming excludes a pending task. This packet does not turn the latent rebuild observations from Fable2 into new reachable product failures or change D204's selected implementation.

## Public surfaces and durable bytes

The sample is deliberately small: canonical internal failure, fresh empty inference workspace, and genuine output-transform authored failure. Stored row == latest run.failed == authenticated REST; built MCP `get_run` structured/text failure and terminal `wait_for_run` failure agree exactly. The MCP transport clears its PID on close, so the in-driver post-close PID check is not credited. Authoritative cleanup instead uses pre-close resource PID48796 (absent afterwards) and a final precise scan including the exact QA checkout path: zero matching Node/Chrome processes. Attempt1 did not persist its MCP PID; its client was closed and the same final checkout scan found no remaining child.

Cached installed Playwright CLI0.1.25 drove installed Chromium1234 with an explicit executable path, no browser/package download, at1400×1000. CLI snapshots preceded DOM inspection. The browser showed each full fixed failure message, enabled Resume for the canonical internal failure, and disabled it for both deterministic authored failures. All scoped marker omissions and owned-origin network assertions passed. All three screenshots were independently opened and inspected after execution; their visible alerts and recovery controls agree with the DOM observations. [Browser evidence](./results/d204-api/attempt-2/browser), [CLI history](./results/d204-api/attempt-2/browser-history.json).

Selected **eight** candidate rows/events remained identical after public reads and a new publication/run, then after another authenticated clean drain/reopen. A read-only SQLite client, used with the server stopped, independently matched raw selected row/event hashes across reopen. [Disk comparison](./results/d204-api/attempt-2/disk-reopen.json). This is candidate history, not output of a pre-change build.

## Attempts, cleanup and retained limits

Only the API group needed another attempt. Attempt1 passed eight D204 API fixtures, A2 and MCP, then Playwright CLI rejected `--config` on `localstorage-set`. That was QA instrumentation: the option now goes only on `open`. The first browser was explicitly closed without the rejected option, and its API drained in `finally`. Attempt2 passed all13 group rows; both complete attempts and input copies remain. No product oracle or production code changed. [BLOCKERS](./BLOCKERS.md) records this disposition.

Owned driver PIDs: S1=45124, S2=42928, S3=42156, S4=45244, reconstruction=17000, API attempt1=4576 and attempt2=41008. Final MCP pre-close PID48796 is retained in resources. All eight known PIDs are absent. API ports5871/5872/5873 refused after authenticated shutdown. The CLI closed its uniquely named browser session. Browser process PID was not exposed by the CLI, so no vacuous PID assertion is claimed; a precise final Node/Chrome command-line scan for this QA's checkout, scratch/artifact paths and session found **zero matching processes**. [Precise absence](./final-precise-process-absence.json), [cleanup summary](./cleanup.json). No owner processes were signalled; ports4747/4748/11434 were not used.

Evidence accounting remains separate:

- **New final execution:** 29 scenario records, comprising14 required supplement +10 D204 +1 genuineA2 +4 surface/history checks. Three D204 fixtures have synthetic reachability (canonical fault plus two reconstruction cases); those three are included in29, not additional passes.
- **Inherited independent source633 evidence:** original430 new Opus checks plus36 inherited domain checks, not rerun here; original verdict unchanged.
- **Prior hosted controls:** the D205 accepted source-bound assertions in run44909411264 at d117/02a remain historical ordinary execution. They are not counted among29 or claimed as current CI.
- **Explicitly unexecuted/limited:** adjacent A04 preview, full pre-change-build upgrade experiment, exhaustive native OS fault matrix, live paid-provider behavior and full Windows package coverage. Existing legacy-projection/candidate-history evidence keeps its narrower meaning. No final-current-target CI/Astra3/owner acceptance result is claimed.

All required D205 supplemental criteria and D204 corrective criteria have executed evidence at source4d. Final integration/current-target numerical gates, native artifact replay, reserved final audit, signed delivery and owner acceptance remain with root.

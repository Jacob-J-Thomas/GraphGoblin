# Intent 4 readiness reconciliation

Read-only evidence packet, 2026-11-21 01:07 UTC. This is neither admission nor acceptance.

Source: `G:/ggq/gg-459-qa-main/GraphGoblin`, immutable main `47ca4640793a81efa5bec661dba25627de314774`. Read AGENTS, docs/README, docs/12, docs/15 and the approved five-intent register. Baseline `git status --short` was empty. No tests, app starts, provider turns, owner config/auth reads, labels, issue comments, closures or product changes were performed. Only this output directory was written. A few retained QA paths are omitted by the checkout; specific historical README material was inspected through `git show HEAD:<path>`.

The approved register orders all eight issues after intent 3 engineering delivery, allows evidence-backed dispositions, and retains opposite-family review, independent QA, current-head/current-target CI, fresh Astra MAX audit and existing closure obligations. Reconcile labels/hierarchy/dependencies at actual admission.

## Live issue state

GitHub connector fetched every issue body and state during this review. All eight are open with zero comments. No change since the listed update time was reported.

| Issue | Current gate/parking state | Updated UTC | Readiness conclusion |
| --- | --- | --- | --- |
| [427](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/427) | needs-refinement; Sol implementation / Opus review; touched-system QA | 2026-11-14 05:52 | Historical account refusal cannot justify universal seed disable. Minimal guide clarification plus existing-message verification is viable. |
| [448](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/448) | backlog; Sol / Opus; touched-system QA | 2026-11-08 01:23 | Stored-only offline catalog and startup projection still differ in source. Bounded code candidate. Explicit owner closure instruction exists. |
| [362](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/362) | backlog; no model/QA labels | 2026-10-20 08:13 | Existing implementation and maintained native regression support a no-code disposition after independent QA. |
| [363](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/363) | backlog; no model/QA labels | 2026-10-20 08:13 | Structured-call mkdtemp remains; adjacent probe creation already has the requested pattern. |
| [364](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/364) | backlog; no model/QA labels | 2026-10-20 08:13 | Current preflight wording changed, but every spawn ENOENT still becomes missing executable. |
| [365](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/365) | backlog; no model/QA labels | 2026-10-20 08:13 | Numbered docs already name inherited Windows sandbox mode; broad source/research promises remain to reconcile. |
| [486](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/486) | backlog; Sol / Opus; touched-system QA | 2026-11-15 17:52 | Remaining evaluator boundaries are present; substantial standalone engine work. |
| [442](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/442) | backlog; Sol / Opus; touched-system QA | 2026-11-07 22:42 | Existing docs disclose silent skips; runtime has no affirmative plugin-health evidence. Bounded supported-diagnostics investigation remains. |

## #427: account availability and the existing public diagnostic

- Seed source is `packages/infrastructure/src/sqlite/settings.ts:364` (`DEFAULT_MODEL_CATALOG`); the `gpt-5.5` model is at :440 and enabled at :444. `SqliteModelCatalog.seed`, :477, refreshes harness metadata while preserving stored enabled values. No current account entitlement check controls this seed.
- SDK is pinned to 0.160.0 (`packages/adapter-codex/package.json:29`, installed SDK package metadata and lock agree). Static embedded JSON was decoded from the bundled native CLI, without executing it or accessing configuration. `gpt-5.5` has `visibility: list`, `supported_in_api: true`, minimum client 0.124.0, efforts low/medium/high/xhigh, and `available_in_plans` including free, plus, pro, business and enterprise. This is shipped capability metadata, **not live entitlement, current provider availability or proof that the October owner refusal no longer occurs**. Small static excerpt/provenance: `cli-model-metadata.json`.
- Current Codex preflight (`packages/adapter-codex/src/cli.ts:150-243`, `harness.ts:128`) checks version, exec/resume help and login status; it does not request a model turn. `packages/contracts/src/harness.ts:20` explicitly defines readiness as prerequisite health, never model entitlement/availability. It does not expose the Codex login method for account-policy seeding.
- `events.ts:176-206` recognizes structured HTTP 400 invalid_request_error; :308-319 emits non-retriable `HARNESS_ARGUMENTS_REJECTED` and retains the provider explanation. `events.test.ts:175` already tests a model-unavailable-for-ChatGPT-account explanation. That is a controlled fixture assertion, not renewed provider evidence.
- Engine mapping `packages/engine/src/handlers/inference-failure.ts:155-162` stores this as **`HARNESS_TURN_FAILED`**, `details.adapterCode: HARNESS_ARGUMENTS_REJECTED`, `resumable: false` (PINNED at :12), preserving the explanatory message. `refusal.test.ts:178-213` establishes public engine refusal and no Resume for the analogous effort refusal. It does not independently exercise this exact account case through API/browser.
- Persistence `run-manager.ts:3063` applies `boundedFailure`; `event-validation.ts:26` truncates messages with an explicit marker at `RunFailureSchema`'s 10,000-character limit (`contracts/src/run.ts:159`). Typed messages pass through; the safe generic projection is specifically for INTERNAL_ERROR. REST `/runs/:id` returns the manager snapshot (`apps/api/src/routes/runs.ts:185`), MCP `get_run` delegates to the API (:253 in tools.ts), MCP summaries preserve failure.message (`describe.ts:142`), and the inspector directly renders it as React text (`RunInspectorPage.tsx:208-219`). This short provider explanation therefore survives source projection; arbitrary provider text has no new semantic sanitization proved here.

Minimal candidate: explain in the guide/numbered harness docs that an enabled shipped model and a ready preflight do not establish access for the API's actual Codex account/endpoint. Describe `model_not_found` as the provider refusing the selected model for that account/endpoint only when its structured refusal establishes that cause. Advise choosing an explicitly supported model or deliberately changing the login/endpoint; no automatic substitution, retry loop, global disable or API-key-only claim. The issue expressly allows catalog **or guide** clarification. Existing message may satisfy its recognition requirement after exact synthetic public QA; no new run code is required solely for terminology. Preserve the refinement gate until the orchestrator reconciles this bounded disposition.

Suggested independent QA: supported-version fixture, authenticated preflight with no model request, synthetic structured model_not_found refusal with the known short explanation through stored event/row, REST/MCP/inspector, non-resumability and one authored turn; unknown/malformed/unstructured/provider-transient failures must not acquire an account diagnosis. No real account turn is necessary to test this guidance/projection.

## #448: one pure startup catalog projection

Offline `apps/api/src/preflight.ts:365` reads stored rows unchanged for a migrated store. Startup `container.ts:212-234` appends missing DEFAULT_MODEL_CATALOG identities after stored rows before validating defaults. This discrepancy remains. Read-only SQLite catalog loading is already available (`infrastructure/src/sqlite/settings.ts:458`, `readPreMigrationModelCatalog`).

Minimal candidate: share a pure stored-first projection keyed by `(harness, model)` between startup admission and offline preflight. Do not invoke seed(), migrate, open a write connection, refresh stored metadata or replace a disabled stored row. Place the helper at an existing allowed boundary, e.g. the existing sqlite catalog module, and retain exports/layers. Avoid unnecessarily changing live runtime catalog behavior.

QA after admission: disposable current-format store missing one shipped seed; matching process defaults; public offline command agrees with normal startup's admission. Disabled stored identity beats enabled seed, unknown/wrong-family/unsupported effort remain refused as applicable. Compare database and WAL bytes before/after and retain the SQLite -shm reader exception. Cover first-run, broken/old store and external DB URL without new state. Existing tests: `preflight.test.ts:245` catalog positives/negatives, :489 encoded existing DB, :510 unsupported store, :553 WAL bytes; startup refusal controls in `database-ownership.test.ts:57`.

Acceptance nuance: current Codex disabled-model preflight severity is **warn** (`preflight.ts:279`), while startup admission refuses invalid defaults. Keep that established severity in this narrow projection change unless a separate explicit requirement warrants changing it; do not silently reinterpret “preserve disabled refusals” as permission to broaden policy. Issue body says not to close without owner instruction; orchestrator must preserve that closure gate.

## #362: already contained by #321 / PR #375

`infrastructure/src/process/scripts.ts:119-134` catches synchronous spawn exceptions, retains `shell: false` (:126), and resolves `definitely-not-started` with null exit. No raw synchronous EINVAL rejection escapes. The legacy adapter stderr token remains PROCESS_START_FAILED; the **current public contract is SCRIPT_START_FAILED** (`contracts/src/run.ts:58`). Engine handler `handlers/script.ts:106-114` selects that code and supplies provenance; RunFailureError defaults resumable true (`errors.ts:54-61`). It fails before completed-process progress is recorded. The old issue's progress expectation should follow this later deliberate recovery contract.

Maintained exact tests (inspect only, not executed here):

- `scripts.test.ts:330`: missing-command null exit / definitely-not-started control.
- `scripts.test.ts:340`: injected synchronous EINVAL, no sensitive-command leak, bounded stderr behavior.
- `scripts.test.ts:359`: native Windows `.cmd` creates no marker and returns definitely-not-started; owned temp dir removed.
- `engine/src/script-recovery.test.ts:189`: definitely-not-started / uncertain / completed-nonzero matrix, typed run failure, resumability and visit/dispatch provenance.
- `script-recovery.test.ts:134`: crash/recovery preserves the proven refusal rather than treating it as an unproven effect.

Git blame attributes implementation and both EINVAL tests to merged main commit **35bd31ad9ba4001aa1e1d0608122f448b954c103**, PR [375](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/375). Related development history: `2c675ce29af9ef1060407c45371c533f22b6bc5b` introduced proven refusals as SCRIPT_START_FAILED; `48a576964d3da7508930f708d3add8217d90fab9` refined deliberate script recovery. The merged commit says it closes #320/#321; it did **not** auto-close #362. Current docs already agree (`docs/05:489`, `docs/04:152`, ADR-0059).

Proposed disposition: independent native rerun of maintained tests and one composed engine/public `.cmd` failure from a separate disposable worktree, including no marker and the current code/resumability. If these pass, record already-fixed reconciliation; do not manufacture code to restore obsolete PROCESS_START_FAILED naming. This report alone does not accept/close the issue.

## #363: structured temp directory remains the narrow defect candidate

`adapter-codex/src/structured.ts:14-16` still uses mkdtemp with `graphgoblin-structured-`. `complete():49-58` acquires it before harness.start. Adjacent `cli.ts:102-123` already uses exclusive mkdir with a short random name, mode 0700 and four EEXIST attempts; Claude has the same pattern (`infrastructure/src/claude/harness.ts:74-96`). Existing Codex probe tests (`probe-directory.test.ts:124`) cover a 226-character root and preserve collision directories; intent 1 already hardened their timeout cleanup lifecycle.

Candidate: reuse a small adapter-local exclusive temp-directory helper for structured and Codex probe creation, or apply the same established pattern with bounded retries if extraction adds unnecessary ownership conflict. Never reuse/remove a colliding directory. No new package or infrastructure-to-adapter import. Keep structured cancellation-before-create, cancellation-during-acquisition, primary failure and cleanup precedence (`structured.test.ts:49,58,86,99,116,135`).

QA: native Windows 226-character root with a fake harness (no provider request), start count and fresh/empty cwd, eventual cleanup on success/failure/abort; bounded EEXIST, EACCES/noncollision failure, fixed/request cwd precedence. Do not claim unbounded long-path support: the OS/CLI cwd limit still exists and #364 handles truthful failure diagnostics.

## #364: ENOENT ambiguity survives the readiness rewrite

`infrastructure/src/claude/process.ts:161-165` retains only ENOENT/EACCES/UNKNOWN from process error. `harness.ts:102-118` maps every ENOENT to HARNESS_NOT_INSTALLED. Probe text now says “Claude CLI was not found at the configured path,” and preflight converts it to cli-missing (:335); turn text still says executable could not start. Neither path establishes that cwd was valid. The same classification is used after turn execution (:459-485). Probe directories now use mkdir, so reproduce the current implementation rather than the old mkdtemp layout.

Candidate: check known invalid cwd facts without leaking its private path; when launch ENOENT remains ambiguous, use honest unknown/start-failed guidance that names both executable and cwd possibilities. An existing directory alone does not prove that Windows can start a process there, especially for long paths; avoid a TOCTOU claim of certainty. Preserve real missing-binary cli-missing, cancellation/deadline/termination precedence and proven non-submission. A failed model turn must not be sent merely to diagnose cwd.

Independent QA: real harmless native executable with missing/non-directory/long cwd plus a real missing executable in valid short cwd, and healthy short cwd; preflight and turn result classification with synthetic runner/fixture. Existing tests anchoring behavior: `harness.test.ts:735` preflight failures, :858 missing executable matrix; `readiness.test.ts:128` real missing binary; `process-failure.test.ts` lifecycle/errno controls. Do not call the owner's signed-in native preflight test during this task.

## #365: narrow documentation reconciliation

`docs/06-harness-integration.md:502` now scopes overrides to settings a node has, and :538-542 explicitly lists inherited login/model access, **CLI Windows sandbox mode**, other built-ins and remaining config. That disclosure arrived in `f8c47f8bb3f7b29596b0d664f9e6a359160f29f0` (PR #430), later extended for plugins. In contrast, `adapter-codex/src/options.ts:11-13` and `docs/research/codex-sdk.md:37` still use broad every-behavior-affecting language.

The installed SDK `dist/index.js` emits sandboxMode as --sandbox and per-thread approval/network/model/effort options after client config; it supplies no dedicated Windows backend selection. `threadOptions` (`options.ts:44-57`) forwards authored sandbox permissions and never sets `windows.sandbox`. No owner config was inspected, and this is not a new permission defect finding.

Candidate: synchronize source/research wording to the explicit inherited backend distinction already documented in docs/06; do not introduce a backend override or permission change. An evidence-backed existing-doc disposition may suffice if independent review accepts the remaining comment correction. QA compares local SDK argv/source and documentation, with an isolated config fixture only if a behavior claim needs renewed proof.

## #486: preserve evaluator provenance and side-effect boundaries

Remaining direct call sites include `handlers/script.ts:40` argument templates; `heartbeat.ts:20,26,28,51,138,153` headers/URL/body/script args/until/deadline; `subloop.ts:61,70,99,139,222` input/output mappings/message rendering/trigger payload; `inference.ts:306,315,364,608,698` input transforms/context files/prompt/repair/output transforms; and selection predicates in `common.ts:121,136`. These are call-boundary candidates, not a license to catch arbitrary domain-named errors around whole handlers.

Reusable precedent: `mutate.ts:10-34` supplies a MutationFailureMapper at apply/evaluation boundaries; `domain/src/mutations.ts:45,89,91,166-170,318-331` and `common.ts:266` preserve that boundary. `exit.ts:16-21` catches only ExpressionError at its evaluator. `failure-publication.ts:28` bounds authored causes to 1,000 characters. Inference currently calls runMutations without the mapper; external completion/resolver/storage failures must remain external even when named TemplateError/ExpressionError. Existing `mutation-failures.test.ts:154` has these same-class negative controls.

Required small design before code: complete boundary-to-public-code / bounded cause / node / resumability matrix; distinguish deterministic authored error before submission from post-acceptance output mapping, provider failure, final serialization/thread/storage failure, and script/heartbeat side effects already performed. Preserve saved prompt/turn identity and acceptance evidence, parent/child parity, deadline/cancellation precedence and historical rows. A typed authored failure must never authorize replay of uncertain work. Heartbeat predicate/deadline failure occurs after a recorded probe beat: account for that existing effect explicitly.

Keep as a standalone engine change with focused public-method positive/negative controls, inline/nested parity and composed synthetic stored-row/event, REST/MCP/inspector checks against private canaries. Update numbered docs, guide and CHANGELOG. This is the highest-risk unit; no global exception-by-class catcher.

## #442: bounded diagnostic limit, preserve plugin inheritance

Current `isolation.ts:151-160` deliberately lists standalone MCP with plugins **off for discovery** and then suppresses only standalone servers. That list cannot establish loaded plugin tools. `cli.ts:150-243` preflight has no plugin-health step, and `contracts/src/harness.ts:32` exposes no plugin diagnostic result.

`docs/06:510` and ADR-0067:33 already disclose the unknown-ID/missing-MCP-file limitation. Retained `docs/qa/2026-11-07-439-plugin-inheritance/README.md` and `scripts/native-plugins.mjs` provide prior disposable local marketplace/Responses fixture machinery; the README records both silent cases and explicitly refuses plugin-health conclusions. This is historical fixture evidence, not a new reproduction. Research docs identify supported `codex plugin list` and `codex mcp list`; neither enabled configuration nor MCP listing alone proves effective worker tools.

Candidate: first use then-pinned supported CLI diagnostics with disposable local and remote-style fixture cases. If no supported health signal exists, expose an explicit bounded unsupported-observability result/warning through an appropriate existing diagnostic surface, with guidance to inspect the effective CLI plugin configuration and use its supported commands. Do not claim absent tools solely from an empty listing, parse private cache layout, install/repair plugins, add a replacement manager or change inheritance. Record which public surfaces establish state and which cannot. Preserve enabled healthy, disabled, node-opt-out and same-session repair/resume behavior. No owner config or paid provider is needed.

## Proposed ownership lanes after admission

1. **Catalog/preflight lane, #448:** API preflight/container plus pure catalog helper and their tests. #427 should not edit seeds on current evidence.
2. **Codex adapter lane, #363 then #442:** one owner for shared cli.ts/harness/isolation tests. Avoid concurrent edits to cli.ts/probe-directory.test.ts. Scope #442 after supported-interface findings; keep separate reviewable outcomes.
3. **Claude native lane, #364:** infrastructure/claude harness/process/tests, independent of Codex temp work. Reserve native test capacity rather than contending with process-heavy suites.
4. **Engine lane, #486:** handlers/common/domain mapper/contracts if necessary. Own all evaluator semantics together; #362 is separate no-code QA/disposition and should not edit the handler.
5. **Documentation integration lane, #427/#365 plus every unit's doc updates:** one owner for docs/06, guide troubleshooting, research and CHANGELOG; apply updates sequentially after runtime interfaces settle. Product code can proceed independently only with explicit file ownership. An actual surface/UI change for #442 needs Claude implementation or review per the approved register.

These are suggested boundaries, not dispatch. Every new implementation/QA workspace must recheck its actual integration base after intent 3 completes; this packet's source anchors and static findings are pinned, not a claim about that future base.

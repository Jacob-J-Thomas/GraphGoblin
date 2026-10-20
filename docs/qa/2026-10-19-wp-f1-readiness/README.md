# WP-F1 (#179) round 2: classification and draft-save readiness

## 1. Branch and worktree

- Branch/worktree name: `codex-wp-f1-readiness-precision`.
- Round-2 base: `50d932946138ca4a7e759b9df30ddb6453e54e20`, committed by the orchestrator from round 1.
- Uncommitted; ready for orchestrator review. No staging, commits, pushes, owner-app/store changes, credential exports or paid turns.
- This report supersedes the round-1 handoff. Historical evidence remains labelled below.

## 2. Per bolt: #179

### Pipeline and draft-save measurement

| Stage                                                   | Current behavior                                                                                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude location/probe                                   | Explicit binary or installed native executable; no-turn version/help/auth status in disposable directory. Parse auth JSON even on nonzero exit.                          |
| Codex location/probe                                    | SDK-bundled binary or explicit override; numeric version core >=0.160.0, required exec/resume flags, local login. Pre-release suffixes accepted.                         |
| Draft create/template/import/save                       | Catalog/configuration checks only, no readiness probe and no readiness issues. Explicit invalid configuration remains rejected.                                          |
| Validate/publish/preflight/manual API-MCP run admission | Caller-owned memo: one promise per harness per request, failures included; distinct harnesses concurrent. Next request probes again.                                     |
| API                                                     | Seven server states: unknown, ready, cli-missing, cli-incompatible, auth, quota, transport. Login fact omitted until established; confirmed signed-out is false.         |
| Web contract                                            | checking is a client pending-request state. Editor fetches readiness separately. Visual files and browser specs are assigned to the following worker and untouched here. |

Measured through real HTTP on a disposable built API at port 5657, using the actual SDK Codex 0.160.0, with no turn:

| Operation    | Before at 50d9329 | After  | Probes before / after |
| ------------ | ----------------- | ------ | --------------------- |
| Draft create | 7,578 ms          | 106 ms | 1 / 0                 |
| Draft save   | 3,792 ms          | 47 ms  | 1 / 0                 |

Both saves returned HTTP 200. These are single controlled observations, not a latency SLA. The before and after used separate disposable instances and the same definition/request script. [Timing evidence](draft-timing.json).

### Before/after classification table

All six quoted text cases failed the new domain regression on the reviewed code. The realistic signed-out Claude fixture and three turn-isolation cases also failed before the fix.

| Input / boundary                                                                | Before                                     | After                                                                                                |
| ------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Claude exit 1 stdout `{"loggedIn":false,"authMethod":"none"}`, empty stderr     | unknown / HARNESS_TURN_FAILED              | auth / HARNESS_NOT_AUTHENTICATED, authenticated false                                                |
| `Failed to connect to authentication server: ECONNREFUSED`                      | auth                                       | transport                                                                                            |
| `stream disconnected before completion: authentication token refresh timed out` | auth                                       | transport                                                                                            |
| `Invalid API key ? Please run /login`                                           | unknown                                    | auth                                                                                                 |
| `API Error: 500 Internal server error`                                          | unknown                                    | transport                                                                                            |
| `ETIMEDOUT`                                                                     | unknown                                    | transport                                                                                            |
| `EAI_AGAIN`                                                                     | unknown                                    | transport                                                                                            |
| Codex exit 1 stderr `Not logged in`                                             | auth                                       | auth, unchanged                                                                                      |
| Codex `0.161.0-alpha`                                                           | cli-incompatible                           | numeric core accepted, ready when all other prerequisites pass                                       |
| Missing Codex model/config/resume-JSON flag                                     | generic incompatible message               | cli-incompatible with version and failing flag named                                                 |
| Nonzero turn stderr mentioning quota/authentication/network                     | inferred typed cause and retry eligibility | HARNESS_TURN_FAILED, nonretriable for Claude, unless native protocol positively identifies the cause |
| CLI `2.1.429` without HTTP/status context                                       | unknown                                    | unknown, unchanged                                                                                   |
| Disabled / absent catalog identity                                              | MODEL_DISABLED / MODEL_NOT_IN_CATALOG      | unchanged, independent of CLI health                                                                 |

The no-turn path alone opts into bounded stderr inference. Real turns neither capture diagnostic classifications nor use an injected classification to change their failure code. Explicit native protocol errors retain their existing typed handling.

### Native and installed evidence

The round-2 real installed signed-out test uses an empty disposable USERPROFILE/HOME, without copying credentials: Claude 2.1.292 reports auth and authenticated false. The ordinary installed Claude probe asserts ready; missing binary or unavailable login skips with a stated reason. The installed Codex probe now asserts ready when login is accessible; it skips for missing binary/login instead of accepting any parseable state. Here Codex's inaccessible sandbox login caused that skip.

**Correction to round 1:** Codex 0.160.0 is ready outside the managed sandbox, confirmed by the Claude Opus 5.5 reviewer. The historical auth result in the JSON was a sandbox artifact, not the owner's machine readiness. That reviewer evidence is identified as externally provided, not a new unsandboxed measurement by this worker.

Historical installed no-turn lifetime samples remain in [native-lifetime.json](native-lifetime.json) and [native-lifetime-final.json](native-lifetime-final.json). At 07:51:40Z, the same nine matching Claude/Codex PIDs remained before/after all five samples; at 09:07:24Z, the same five remained. Samples: Claude help completion, 1 ms timeout and 1 ms cancellation; Codex exec help completion and 1 ms timeout. Zero new matching survivors were observed. Claude stop races exited 0 with close confirmed; they do not prove forced termination won. Codex readiness has no cancellation interface. These observations do not establish model-turn/arbitrary-descendant lifetime.

CIM/tasklist were denied, so corrected evidence used Get-Process with a successful-enumeration sentinel. The invalid initial empty CIM snapshots are not included. The [taskkill diagnostic](taskkill.json) separately records sandbox access denial and a task-owned sleeper surviving tree-kill until directly stopped. A synthetic hanging native fixture also required exact task-owned cleanup. No orphan fix or process termination change is prescribed here.

The [original Codex boundary evidence](codex-before.json) and [round-1 native fake evidence](native-fixtures.json) are historical controlled fixtures, not provider turns. The auth fixture shape has since been corrected and verified through both package tests and the Windows PowerShell 5.1 native builder. One-off collectors were deleted; resolved machine paths were removed from all evidence.

## 3. Files changed

- `CHANGELOG.md`: record wire-code/authentication changes and the draft-save rule; remove the stray blank.
- `apps/api/scripts/readiness-fixture-probe.mjs`: delete the one-off collector.
- `apps/api/src/catalog.test.ts`: assert catalog-only draft issues and readiness only on validation/publication.
- `apps/api/src/loop-issues.ts`: allow draft callers to explicitly disable readiness probing.
- `apps/api/src/model-issues.ts`: skip readiness on draft writes; check distinct harnesses concurrently with ordered issues.
- `apps/api/src/model-readiness.test.ts`: exercise zero-probe drafts, memo freshness, concurrency and manual run admission.
- `apps/api/src/preflight.ts`: check system harness prerequisites concurrently.
- `apps/api/src/routes/loops.ts`: disable CLI probes on create/import/save while retaining full validate/publish checks.
- `apps/api/src/routes/runs.ts`: probe fresh readiness and pin the checked version before manual API/MCP run admission.
- `apps/api/src/routes/system.ts`: probe configured harnesses concurrently and omit unknown login facts.
- `apps/api/src/routes/template-drafts.test.ts`: remove CLI readiness expectations from template draft creation.
- `apps/api/src/routes/templates.ts`: create template drafts without probing readiness.
- `docs/06-harness-integration.md`: document server/view states, real catalog codes and concurrent operation scope.
- `docs/07-api-and-streaming.md`: document separate draft/validation issues and run admission behavior.
- `docs/09-frontend-and-pwa.md`: replace stale picker/preflight behavior and explain independent readiness fetching.
- `docs/guide/07-troubleshooting.md`: separate catalog availability from CLI causes and use reload guidance.
- `docs/qa/2026-10-19-wp-f1-codex-before.json` ? `docs/qa/2026-10-19-wp-f1-readiness/codex-before.json`: move and redact machine paths; label historical/sandbox provenance.
- `docs/qa/2026-10-19-wp-f1-native-fixtures.json` ? `docs/qa/2026-10-19-wp-f1-readiness/native-fixtures.json`: move and redact machine paths; label historical/sandbox provenance.
- `docs/qa/2026-10-19-wp-f1-native-lifetime-final.json` ? `docs/qa/2026-10-19-wp-f1-readiness/native-lifetime-final.json`: move and redact machine paths; label historical/sandbox provenance.
- `docs/qa/2026-10-19-wp-f1-native-lifetime.json` ? `docs/qa/2026-10-19-wp-f1-readiness/native-lifetime.json`: move and redact machine paths; label historical/sandbox provenance.
- `docs/qa/2026-10-19-wp-f1-readiness.md` ? `docs/qa/2026-10-19-wp-f1-readiness/README.md`: replace the handoff with this round-2 report and owner QA.
- `docs/qa/2026-10-19-wp-f1-readiness/draft-timing.json`: record real-HTTP before/after Codex draft timings and probe counts.
- `docs/qa/2026-10-19-wp-f1-taskkill.json` ? `docs/qa/2026-10-19-wp-f1-readiness/taskkill.json`: move and redact machine paths; label historical/sandbox provenance.
- `packages/adapter-codex/scripts/readiness-native.mjs`: delete the one-off collector.
- `packages/adapter-codex/src/cli.test.ts`: cover pre-releases, missing config/resume flags, named diagnostics and actual installed readiness.
- `packages/adapter-codex/src/cli.ts`: compare numeric version core, name failed syntax and report login only when checked.
- `packages/adapter-codex/src/fixtures/readiness-cli.mjs`: add missing-config/resume-JSON and pre-release executable cases.
- `packages/adapter-codex/src/harness.test.ts`: expect omitted login facts and updated reload guidance.
- `packages/api-client/openapi.json`: regenerate seven server states and optional authenticated.
- `packages/api-client/src/generated/schema.ts`: regenerate client types from the changed contract.
- `packages/contracts/src/claude.test.ts`: reject server checking and permit absent authenticated.
- `packages/contracts/src/harness.ts`: remove server checking and make login fact optional.
- `packages/domain/src/readiness.test.ts`: add all six quoted diagnostic regression cases.
- `packages/domain/src/readiness.ts`: prioritize connection evidence, recognize real diagnostics and avoid invented login facts.
- `packages/infrastructure/scripts/readiness-native.mjs`: delete the one-off collector.
- `packages/infrastructure/src/claude/fixtures/readiness-cli.mjs`: mirror real signed-out JSON/exit/stderr and add missing-effort case.
- `packages/infrastructure/src/claude/harness.test.ts`: prove turn stderr classifications cannot change code or retry eligibility.
- `packages/infrastructure/src/claude/harness.ts`: parse auth JSON before generic exit handling and restrict inference to no-turn checks.
- `packages/infrastructure/src/claude/process-failure.test.ts`: test probe-only diagnostic capture and turn isolation.
- `packages/infrastructure/src/claude/process.ts`: make bounded diagnostic inference an explicit no-turn opt-in.
- `packages/infrastructure/src/claude/readiness.test.ts`: cover missing effort and assert real ready/signed-out states with reasoned skips.
- `tooling/fixtures/readiness-cli.cs`: label Windows PowerShell 5.1 owner-QA scope and mirror signed-out stdout JSON.
- `tooling/scripts/readiness-fake-cli.ps1`: label Windows PowerShell 5.1-only execution; preserve a valid leading BOM.
- `tooling/scripts/readiness-native.mjs`: delete the one-off collector.

## 4. Tests

- `packages/domain/src/readiness.test.ts`: every quoted diagnostic above; before: six expected transport/auth results instead returned auth/unknown; after: all classification cases pass in the full domain run.
- `packages/infrastructure/src/claude/readiness.test.ts`: realistic exit-1 signed-out JSON; missing effort flag; installed ready assertion/explicit skips; actual isolated signed-out CLI assertion. Before fixture change: expected auth, received unknown.
- `packages/infrastructure/src/claude/harness.test.ts` and `process-failure.test.ts`: real-turn classifications ignored, stderr inference opt-in only for no-turn probes. Three turn-isolation cases failed before and pass after.
- `packages/adapter-codex/src/cli.test.ts`: missing config/resume JSON, pre-release version, actionable version/flag diagnostics, unknown login before login stage, installed ready-or-reasoned-skip.
- `packages/contracts/src/claude.test.ts`: server rejects checking; absent authenticated is accepted.
- `apps/api/src/model-readiness.test.ts`: create/import/save/template create make zero probes; validate probes once per harness; independent requests fresh; rejections shared/sanitized; validate/preflight launch both harnesses before either completes; fresh failed manual run admission starts no turn. Draft-probe assertions failed on the reviewed code (expected 0, received 1). Publication now uses a connected multi-node graph and succeeds after readiness becomes ready, proving that readiness alone blocks it. An added empty-versionId regression failed expected 422, received 202 before matching the existing published fallback.
- Existing catalog/template route expectations now distinguish catalog-only draft checks from full validation/publication checks.

| Package        | Tests                         | Lines              | Branches           |
| -------------- | ----------------------------- | ------------------ | ------------------ |
| Domain         | 547 passed / 6 known failures | 98.42% (1938/1969) | 95.61% (2179/2279) |
| Infrastructure | 511 passed / 6 known failures | 98.80% (1897/1920) | 94.92% (1515/1596) |
| Codex          | 86 passed / 5 skipped         | 98.38% (305/310)   | 94.75% (307/324)   |
| API            | 641 passed / 2 skipped        | 98.55% (1703/1728) | 93.42% (1237/1324) |
| Contracts      | 257 passed                    | 99.73% (370/371)   | 94.89% (186/196)   |

The six domain adversarial failures import node:module.registerHooks, unavailable on the required Node 22.14. The six infrastructure failures are existing native termination checks (one adversarial ProcessScripts child/grandchild, two ProcessScripts timeout/abort, three Claude timeout/overflow/abort/descendant cases), with timeouts, continuing marker writes or EBUSY under the sandbox's denied tree-kill. No readiness component regression remains in that full run. Five Codex skips comprise four paid LIVE cases and the installed-login test with no accessible sandbox login.

The full API run passes the updated catalog/template expectations and all fifteen model-readiness cases. The focused Claude harness/readiness/process-failure run passes all 65 cases, including the real signed-out CLI. The final API run follows the empty-versionId fix and valid-graph assertions; the final Codex run follows two added --version diagnostic tests; it is not a retry of unchanged code.

## 5. Gates

All gates use Node 22.14.0 first on PATH and pnpm.cmd. Coverage calls each package directly with --maxWorkers 1 (infrastructure: 2) and --coverage.reportOnFailure; no thresholds or exclusions changed. Four paid Codex LIVE tests remain skipped.

| Exact command                                                                                           | Result                                                                                    |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `pnpm.cmd --filter @graphgoblin/domain test:coverage --maxWorkers 1 --coverage.reportOnFailure`         | FAIL: six known registerHooks failures; truthful coverage above                           |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers 2 --coverage.reportOnFailure` | FAIL: six known sandbox-native termination failures; truthful coverage above              |
| `pnpm.cmd --filter @graphgoblin/adapter-codex test:coverage --maxWorkers 1 --coverage.reportOnFailure`  | PASS, 86 tests and five explicit skips                                                    |
| `pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers 1 --coverage.reportOnFailure`            | PASS, 641 tests and two skips                                                             |
| `pnpm.cmd --filter @graphgoblin/contracts test:coverage --maxWorkers 1 --coverage.reportOnFailure`      | PASS, 257 tests                                                                           |
| `pnpm.cmd typecheck --concurrency=2`                                                                    | PASS, 20 tasks                                                                            |
| `pnpm.cmd lint --concurrency=2`                                                                         | PASS, 11 tasks                                                                            |
| `pnpm.cmd format:check`                                                                                 | PASS, all matched files                                                                   |
| `pnpm.cmd --filter @graphgoblin/api-client generate`                                                    | PASS, regenerated OpenAPI and client                                                      |
| `pnpm.cmd docs:generate`                                                                                | PASS, generated references have no resulting diff                                         |
| `pnpm.cmd check:docs`                                                                                   | PASS, generated docs up to date                                                           |
| `pnpm.cmd --filter @graphgoblin/api build`                                                              | PASS; used for the after timing                                                           |
| `pnpm.cmd check:layers`                                                                                 | PASS                                                                                      |
| `pnpm.cmd check:deps`                                                                                   | PASS, 766 modules / 2954 dependencies; existing drizzle.config.ts no-orphans warning only |
| `git diff --check`                                                                                      | PASS                                                                                      |

The initial lint found two no-undef errors in the disposable timing script under the API package. That non-shipping scratch file was moved out of the package before rerunning lint; no lint rule was weakened. The owner-QA builder was also executed with powershell.exe: the compiled Claude auth fixture exited 1, stdout was exactly the signed-out JSON, stderr was zero bytes.

No browser specs were changed or rerun: the assigned visual worker owns that follow-up. No dependency changes; licence checks are not required. No web source changed; token checks are not required.

## 6. Docs

- docs/06: real codes, seven server states, optional login fact, concurrent operation probes and zero-probe draft writes.
- docs/07: separate authoring/admission paths and manual run readiness error.
- docs/09: current picker/preflight semantics and independent editor readiness fetch.
- guide/07: disabled/absent catalog meaning, separate prerequisite causes, reload guidance and draft-save rule.
- CHANGELOG #179: HARNESS_UNAVAILABLE replaced by HARNESS_READINESS_<STATE>, checking client-only, optional authenticated and no-probe draft writes; stray blank between bullets removed.
- OpenAPI/client regenerated; docs generated and checked. No ADR: implements the orchestrator's approved refinement.

## 7. Decisions and parameters

- Connection/errno evidence wins over incidental auth words; explicit API Error numeric syntax is accepted without interpreting bare version numbers as HTTP statuses.
- Login is an optional fact. A version/help failure does not invent a signed-out result. Local auth commands remain no-turn only.
- Existing 15-second per-command deadlines and 8 KiB ephemeral stderr bound remain; the bound applies only when a no-turn probe opts in.
- The request owns the memo, without any process/container cache. Draft writes explicitly disable probing. Concurrent selection checks retain definition order in returned issues.
- Manual API/MCP run admission checks and pins the selected published/explicit version before invoking RunManager; version ownership/status validation remains with RunManager. Draft selection semantics are unchanged; empty versionId retains the existing published fallback and cannot skip the check.
- Owner-QA C# builder requires Windows PowerShell 5.1 (`powershell.exe`), not pwsh; it refuses nonempty destinations and every model-turn command.

## 8. Caveats and open items

- Independent follow-up review and owner product acceptance remain required before closure. No issue/GitHub mutations were made.
- Record for #243 (outside this change): `packages/engine/src/handlers/inference.ts:207-211` still maps HARNESS_TRANSPORT_FAILED to run HARNESS_TURN_FAILED and retains adapterCode only in details. No engine error mapping was changed.
- Visual settings/picker/Defaults/catalog/policy files and browser specs were left to the Claude visual round, which has since landed (labels, Retry preflight, rechecking, Defaults lines, Codex retry); the steps below use its controls.
- Domain registerHooks and sandbox native termination gate failures are recorded rather than hidden or repaired outside scope. No new models, retirement workflow or usage recovery.
- Disposable data, coverage and report directories remain; no directories were deleted. The four specifically named one-off collector files were removed.

The [round-3 report](round-3.md) records the classification, wording, regression and gate follow-up.

### Owner QA (disposable instance, no turns)

1. Build using Node 22. Use a new data directory and an unused port in 5624-5629; never use the owner app at 4747/4748 or its store. Point GG_WEB_DIST at this worktree's built web output. Use a separate PowerShell terminal for all environment overrides.
2. Native fake CLIs: run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tooling/scripts/readiness-fake-cli.ps1 -Directory <new-empty-directory> -Harness claude` and again for codex in a different directory. **Windows PowerShell 5.1 only.** Execution-policy bypass is process-local. Prepend both directories to PATH and set GG_CLAUDE_BINARY=claude.exe and GG_CODEX_BINARY=codex.exe explicitly; PATH alone does not override normal installed/bundled defaults.
3. Start the built disposable API and open Settings. Change each fake's scenario.txt, then choose **Retry preflight** in the Harness preflight card (it is disabled while a check runs, and "Rechecking…" appears beside it while the previous result stays on screen). Expected badge label and `data-state` per scenario: ready -> Ready (`ready`); old/missing-model/missing-effort -> CLI update needed (`cli-incompatible`), with one problem naming the version or the missing option; hang -> the previous result with "Rechecking…" until the command deadline and bounded shutdown confirmation finish, then Unknown (`unknown`); auth -> Sign-in needed (`auth`), problem "Claude is not signed in. Run claude auth login, then retry preflight." (Codex: "Codex sign-in is missing or invalid. Run codex login, then retry preflight."); quota -> Usage limit (`quota`); transport -> Connection failed (`transport`); unknown -> Unknown. For cli-missing (CLI not found), configure a nonexistent binary. For the hanging Claude auth-status scenario, allow the 15-second command deadline plus up to 5 seconds of bounded shutdown confirmation (20 seconds for that command); earlier version/help commands add their own elapsed time. Codex has a 15-second per-command deadline and returns its timeout without a separate shutdown-confirmation wait. Transport detail is "Claude reported a connection or provider service error." (or Codex), followed by the existing network/service-status action. Every problem is one detail sentence and one action, with no repeated sentence and Claude/Codex capitalised. The Claude auth fixture must print signed-out JSON on stdout, exit 1, empty stderr. No fixture accepts turns.
4. For a real signed-out scenario, first retain the real installed claude.exe path while the original USERPROFILE is still set. In another disposable API terminal set USERPROFILE and HOME to a new empty profile directory, CODEX_HOME to a separate empty directory, GG_CLAUDE_BINARY to the real executable, and clear any fake GG_CODEX_BINARY override so the SDK CLI is used. Set a fresh GG_DATA_DIR and a free 5624-5629 port. Do not copy/export credentials. Open Settings and inspect GET /harness/preflight: expect auth for each inaccessible login, with authenticated false only when signed-out status is established. Claude's command is auth status --json, never a prompt or turn. Ordinary installed probes should show ready when that API user has login.
5. Time a Codex draft save: with the fake scenario hang or with the ordinary installed Codex, create a disposable Codex loop and edit a prompt. Measure PUT /loops/:id/draft in the browser network panel or an HTTP stopwatch; it should not wait for a CLI. For probe-count checks, close GraphGoblin pages and issue the draft requests over HTTP; independent editor/focus preflight requests would otherwise add their own probes. Count new --version entries in the fake's probes.log: create/import/save/template create add zero. Run POST /loops/:id/validate and inspect one probe per referenced harness, even for multiple nodes. The next validation must see a changed scenario. Mixed harnesses begin concurrently. Do not start a real model run.
6. With ready fixtures, disable a model in Settings: saves retain MODEL_DISABLED without probing; validation/publication reports it. Re-enable afterward. Validate a copied definition with model removed-model: MODEL_NOT_IN_CATALOG. Actual supported harness-row deletion is prohibited by the public API and retirement remains out of scope.
7. Inspect /system/preflight and /harness/preflight for cause/state versus severity; preserve authored model and effort during auth/quota/transport failures. Use **Retry preflight** (Settings) or **Retry Claude preflight** / **Retry Codex preflight** (node editor) for a new check.
8. Focus refetch: with both fakes on ready, open a loop with a Claude inference node whose model is set, and open the node. Expand **Advanced** before inspecting **Model**. Set the Claude fake to hang, switch to another window for a few seconds and back (the browser refetches readiness on focus after two seconds). While that check is pending, the Model field must stay editable with the same option label, without "Checking…", "(saved)" or a Retry button. After the 15-second command deadline plus up to 5 seconds of shutdown confirmation (20 seconds for this hanging Claude auth-status command), the result becomes Unknown and only then does the field turn read-only with a Retry Claude preflight button. Do the same with the Codex fake on auth: the Codex field shows "Codex sign-in is missing or invalid. Run codex login, then retry preflight." with Retry Codex preflight, and that existing Codex failure note stays visible while Retry rechecks it. No new failure note appears during the first check, or while a previously ready Codex result is being rechecked.
9. Settings, Defaults: save a Claude default while Claude is ready, then set the Claude fake to auth and retry preflight. The option reads "<name> (saved)" and the one line under the fields reads "Claude readiness: Sign-in needed. See Harness preflight below."; the Codex section shows the same kind of line when only Codex fails. Catalog rows of the failing harness read "Enabled in catalog." then "<Harness> readiness: <label>." Stop only the disposable API afterward.

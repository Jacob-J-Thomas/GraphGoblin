# WP-A5a - supported-boundary test replacements (#317)

## 1. Scope and baseline

- Branch: `codex-wp-a5a-invasive-tests`.
- Initial baseline: `4608440c0c4528a998d7974bb16a90b59102a2a2`; finite target inventory from PR #346.
- Round 2 baseline: `da5e5df`, including the initial replacement commit `f1b9d78`.

## 2. Per bolt

#317: the sixteen V rows are replaced by the boundaries below. The five active U decisions are recorded in section 7. No boundary replacement remains unresolved; Linux-only execution evidence is explicitly pending. #264 gaps, thresholds and exclusions are untouched. Test refactoring preserves existing behavior; these are not claims of newly fixed product bugs.

| Row                                                             | Old mechanism                                                                | New supported boundary                                                                                                         | Preserved or strengthened observable assertion                                                                                                                                                                                               |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [V01](../../packages/adapter-jev/src/decider.test.ts)           | Cast to private Jev client and replace `systemOne`                           | Injected fetch returns a real Response whose external `text()` rejects with a plain Error; public `choose()`                   | Exact `DECIDER_HTTP_ERROR` / `Jev request failed`; no response-read/transport marker; one request                                                                                                                                            |
| [V02](../../packages/adapter-jev/src/decider.test.ts)           | Cast to private SDK logger and invoke unreachable warn/error methods         | Real SDK request through injected fetch and Logger on controlled HTTP 503                                                      | Exact debug and information event routing to engine debug; every logger call checked for key/header/body redaction; info/warn/error stay unused by this pinned request path                                                                  |
| [V05](../../packages/engine/src/finalization.test.ts)           | Patch shared `defaultHandlers().trigger.execute`                             | HandlerRegistry passed to public RunManager constructor through the engine testing helper                                      | Invalid patch durably fails with `INTERNAL_ERROR`, `nodeId: start`, nonresumable failure, no node completion; one terminal event survives two recoveries; run finalized                                                                      |
| [V09](../../packages/engine/src/edge-cases.test.ts)             | Export private `hasPath` for direct implementation tests                     | Inference output transforms exercise disabled-repair/continue-raw fallback                                                     | Existing object/array target emits replace, missing target emits add, persisted null values agree; invalid numeric/string/leading-zero array paths fail safely with no successful node finish                                                |
| [V07](../../packages/infrastructure/src/sqlite/storage.test.ts) | Replace repository subject's `getLoop`                                       | Real libsql clients wrapped only to pause after SELECT, with a second real file connection for the competing publish           | Published version never changes; late save gets draft v2 and current/draft pointers agree; two readers of one draft cause exactly one publication                                                                                            |
| [V06](../../apps/api/src/container.test.ts)                     | Replace/observe container-owned manager and migrate methods                  | Real invalid readiness marker and durable queued admission; external native-client migration gate; observable recovered script | No recovery or startup row writes after readiness failure; starts share one public promise; ownership held through pending stop; seeded metadata visible inside recovered work; disabled built-in survives reopen                            |
| [V11](../../apps/api/src/container.test.ts)                     | Mock Jev prototype `choose`/`classifyNoul`                                   | Existing loopback HTTP classifier fake selected by stored entry endpoint                                                       | Exact Noul and Choice HTTP method/path/auth/model/state/questions and mapped answers; shared client identity across primitive types, identity replacement on key change, disabled/missing-secret invalidation                                |
| [V12](../../apps/api/src/templates/catalog-boundary.test.ts)    | Replace TemplateCatalog subject's `get`                                      | Two public `draft()` calls, mutating first before second                                                                       | Second and source draft unchanged, first differs, entry shape preserved                                                                                                                                                                      |
| [V10](../../apps/web/e2e/pwa.spec.ts)                           | Production PwaTestHook/window simulate/counter seam                          | Unit Workbox injection; real byte-different waiting workers in browser tests/screenshots                                       | No activation/message before confirmation; exact SKIP_WAITING message; one navigation/reload after confirmation; Later and repeated external updates work; unsupported browser lifecycle remains inert                                       |
| [V13](../../apps/web/src/components/icons/icons.test.tsx)       | Production `ICON_NAMES` used only by test                                    | Test-local exhaustive `satisfies Record<IconName, true>` glyph inventory and rendered Icon components                          | Every icon still renders decorative currentColor stroke geometry; type checking catches missing names                                                                                                                                        |
| [V14](../../apps/web/src/editor/history.test.ts)                | Dead production `EMPTY_HISTORY`                                              | Test-local empty fixture, real recordStep/travel/store interfaces                                                              | All history/undo/redo assertions retained                                                                                                                                                                                                    |
| [V15](../../apps/web/src/editor/routing-manual.test.ts)         | Dead production `describeRoute` wrapper                                      | Live `createRoutingPlan(...).routes` manual route                                                                              | Lane, label, radii, manual marker and absent endpoints asserted through real planner                                                                                                                                                         |
| [V16](../../apps/web/src/editor/routing.test.ts)                | Dead production `routeBackwardEdges` wrapper                                 | Test-local projection of live `createRoutingPlan(...).routes`                                                                  | Every geometry, collision, ordering, lane, label, bounds, immutability and channel assertion retained                                                                                                                                        |
| [V17](../../apps/web/src/forms/layout.test.ts)                  | Dead production `labelOf`                                                    | Public formLayout and placementsOf                                                                                             | Humanized key and authored title labels preserved                                                                                                                                                                                            |
| [V03](../../apps/api/src/main.test.ts)                          | Captured listeners, stubbed exit and replaced buildApp/createContainer/start | Reusable built-entry subprocess fixture, binary-created key, real SQLite/network/filesystem faults, Linux signals              | CLI dispatch and exit codes 0/1/2, store ownership, listener lifetime, one shutdown, corrupt pre-HTTP failure, occupied port, separate post-container static registration failure, signal receipt before readiness through a master-key FIFO |
| [V04](../../apps/api/src/main.test.ts)                          | Captured listeners and stubbed exit in edges test                            | Consolidated into V03 fixture                                                                                                  | Actual child exit, one shutdown, closed listener and released lock; no callback invocation presented as native evidence                                                                                                                      |

## 3. Files changed

- adapter-jev: `src/decider.test.ts`, `src/decider.ts`.
- engine: `src/finalization.test.ts`, `src/edge-cases.test.ts`, `src/handlers/common.ts`, `src/testing/scenario.ts`.
- infrastructure: `src/sqlite/storage.test.ts` only; no `loops.ts` or other worker-owned storage implementation edits.
- api: `src/container.test.ts`, `src/triggers.test.ts`, `src/templates/catalog-boundary.test.ts`, `src/main.test.ts`, `src/edges.test.ts`, new `src/testing/api-subprocess.ts`. No production API file edits.
- web: PWA register source/unit tests; four routing test entries and routing source; history/store/Canvas/decision-route/SchemaForm tests and history/store source; icon source/barrel/tests; form layout source/tests; E2E pwa/responsive/screens capture and new `e2e/pwa-helpers.ts`.
- docs: this report, additive lifecycle section in `docs/10-testing-and-quality.md`, removed-seam references in `docs/09-frontend-and-pwa.md`, one #317 Unreleased CHANGELOG bullet.
- Shared-file edits: docs/10 is shared with WP-A2/WP-E1a; this patch only appends its own lifecycle section. CHANGELOG adds one top bullet. No edits to WP-B1/C1/C2/B3 production hot spots, WP-A2 draft spec, Playwright config or CI.

Round 2 review changes (one line per file):

- `AGENTS.md`: document API subprocess builds through Turbo test dependencies.
- `turbo.json`: add only API test/test:coverage build dependencies; preserve inherited build dependencies and caching configuration.
- `apps/api/src/triggers.test.ts`: exercise missing secret storage for unsigned intake and a signed positive control.
- `apps/api/src/container.test.ts`: resolve the libsql mock target eagerly and collapse U10 to one valid-definition case.
- `apps/api/src/main.test.ts`: use 60-second lifecycle case/cleanup budgets, assert signal receipt before readiness on Linux, and remove the entry-load coverage assertion.
- `apps/api/src/testing/api-subprocess.ts`: use 60-second waits, diagnose missing builds, opt into child V8 coverage explicitly and remove fixture directories on disposal.
- `packages/infrastructure/src/sqlite/storage.test.ts`: close both interleaving clients and remove their own temporary directory with retries.
- `docs/09-frontend-and-pwa.md`: restore the complete PWA bullet and replace only its obsolete test-hook sentence.
- `docs/10-testing-and-quality.md`: document build ordering, real ordering assertions, budgets, opt-in diagnostics and fixture cleanup.
- `docs/qa/2026-10-18-wp-a5a-supported-boundaries.md`: remove machine-local/process notes and record the review fixes and verification outcomes.

Production edits are limited to Jev's unified log forwarder; de-exporting private hasPath; removing PwaTestHook/window hook/counter; removing ICON_NAMES and its barrel re-export, EMPTY_HISTORY, describeRoute, routeBackwardEdges and labelOf; and removing historyClock with three store calls moved to the external performance clock. The engine testing helper adds optional HandlerRegistry injection, as explicitly permitted by the brief. No new public production test seam.

## 4. Tests

Initial replacement package runs, with no automatic test retry:

| Package                        | Result                                                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| adapter-jev                    | 34 passed, 5 existing opt-in skips; coverage gate passed                                                                                        |
| engine                         | 460 passed; coverage gate passed                                                                                                                |
| infrastructure                 | 491 passed, 6 failed; same six native process failures on original HEAD and worker sources; coverage thresholds passed but the test gate failed |
| api                            | 608 passed, 6 skipped (2 existing opt-in cases and 4 platform cases); coverage gate passed                                                      |
| web                            | 1,471 passed; coverage gate passed                                                                                                              |
| requested browser specs        | 33 passed on first execution                                                                                                                    |
| final browser message observer | 2 passed after the lint-only native-method binding adjustment                                                                                   |

Named replacements include `safely wraps an unexpected response-read failure from the transport`, `routes SDK logs to the engine logger`, `terminal append survives crash before status: invalid-patch`, `inference raw repair handles target %s safely`, both draft/publish interleavings, the container recovery/readiness/serialization cases, `returns independent drafts across public creation calls`, and the real-worker update tests. The row links above point to their test entries.

This is a test-mechanism repair. The inventory records the original private/method/namespace access. The replacements exercise separate real storage connections, independently constructed component callers, durable node-specific failure evidence and a fresh corrupt sibling database. No newly fixed product behavior defect is claimed.

Initial replacement coverage was above 90% in all four metrics for every changed package. Before and after the initial replacement:

| Package        | Lines, before -> after | Branches, before -> after | Functions, before -> after | Statements, before -> after |
| -------------- | ---------------------- | ------------------------- | -------------------------- | --------------------------- |
| adapter-jev    | 98.82% -> 98.80%       | 96.77% -> 96.77%          | 100.00% -> 100.00%         | 97.77% -> 97.75%            |
| engine         | 98.51% -> 98.51%       | 93.08% -> 93.20%          | 97.59% -> 97.59%           | 97.48% -> 97.48%            |
| infrastructure | 98.78% -> 98.78%       | 94.80% -> 94.80%          | 98.56% -> 98.56%           | 98.03% -> 98.03%            |
| api            | 98.48% -> 97.89%       | 93.46% -> 92.91%          | 95.95% -> 94.11%           | 97.38% -> 96.41%            |
| web            | 98.93% -> 98.93%       | 94.86% -> 94.83%          | 98.50% -> 98.49%           | 98.03% -> 98.03%            |

The original-source comparison and final coverage used `--maxWorkers=2 --coverage.reportOnFailure`. Original API passed 610 tests and original web passed 1,471; infrastructure retained six native failures. No assertions were suppressed, and no thresholds or exclusions changed.

Denominators are truthful: Jev lines 85 -> 84 and functions 22 -> 19; web lines 7,063 -> 7,049 and functions 2,204 -> 2,197 after deleting dead/test-only code; API lines 1,717 -> 1,801 and functions 371 -> 408 include the new subprocess test helper. Opt-in native child V8 reports remain separate from the Vitest package percentages.

The routing audit compares LCOV branch identities using unchanged source-line mappings: **zero lost live branches** in `routing.ts`, `routing-geometry.ts`, `routing-labels.ts`, `routing-search.ts` and `manual-route.ts`. Only the deleted routeBackwardEdges default-argument branch disappears; routing.ts functions are 86/86 -> 84/84 and live helper coverage is retained. The small aggregate web branch decrease also includes two fewer covered branches in unchanged EditorPage.tsx at lines 416 and 418; it is recorded without an out-of-scope #264 repair.

### Round 2 verification (2026-10-19)

The final package measurements use all maintained tests with `--maxWorkers=2 --coverage.reportOnFailure`; there are no name/file filters, automatic retries, threshold reductions or new exclusions. Before is the reviewed initial replacement; after is this revision.

| Package        | Result                        | Lines, before -> after | Branches, before -> after | Functions, before -> after | Statements, before -> after |
| -------------- | ----------------------------- | ---------------------- | ------------------------- | -------------------------- | --------------------------- |
| api            | 608 passed, 6 skipped; passed | 97.89% -> 97.83%       | 92.91% -> 92.85%          | 94.11% -> 93.85%           | 96.41% -> 96.31%            |
| web            | 1,471 passed; passed          | 98.93% -> 98.93%       | 94.83% -> 94.84%          | 98.49% -> 98.49%           | 98.03% -> 98.03%            |
| infrastructure | 491 passed, 6 failed; failed  | 98.78% -> 98.78%       | 94.80% -> 94.80%          | 98.56% -> 98.56%           | 98.03% -> 98.03%            |

- Unsigned JSON, text and byte deliveries still return 202, save their intent and recover the same run ID with the real secrets table absent. A correctly signed delivery under the same storage fault returns 500 and saves no intent or run, confirming that this boundary observes signed intake.
- All lifecycle waits, lifecycle cases and their cleanup hook use 60-second budgets; other API suite defaults remain unchanged. The first unrestricted API attempt reported `Hook timed out in 20000ms` in lifecycle cleanup and a 20-second catalog-rebuild timeout. The lifecycle hook was corrected to 60 seconds; the final two-worker run passed all maintained API tests. The unchanged catalog case is not claimed fixed at unrestricted concurrency.
- Fixture configuration checks confirm inherited `NODE_V8_COVERAGE` is dropped by default and `GG_API_SUBPROCESS_V8_COVERAGE=1` opts in. Both verification fixtures removed their own directories on disposal.
- The API process directory inventory is identical before and after verification: 32 pre-existing directories, zero added and zero removed. Fixture cleanup leaves no new `gg-api-process-*` directory.
- Edge passed all 11 PWA browser cases on the first attempt, including the real waiting-worker confirmation flow. Signal/FIFO cases remain Linux-only; Windows supplies no native-handler evidence.

## 5. Gates

Initial replacement gate results follow. Every command ran with Node 22 first on PATH; `pnpm.cmd exec node -p process.version` returned `v22.14.0`. The unqualified package commands below run all maintained tests at the stated concurrency; there are no name/file filters or retries in final coverage.

| Exact command                                                                                           | Result                                                                                    |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `pnpm.cmd build`                                                                                        | Passed: 11 tasks; run before browser/native entry tests                                   |
| `pnpm.cmd typecheck`                                                                                    | Passed: 20 tasks, including tests and fixtures                                            |
| `pnpm.cmd lint --concurrency=1`                                                                         | Passed: 11 tasks; serialized tasks avoid host contention                                  |
| `pnpm.cmd format:check`                                                                                 | Passed after final line-ending normalization                                              |
| `pnpm.cmd check:layers`                                                                                 | Passed                                                                                    |
| `pnpm.cmd check:deps`                                                                                   | Passed: 0 errors, 1 existing orphan warning for packages/infrastructure/drizzle.config.ts |
| `pnpm.cmd check:tokens`                                                                                 | Passed: 161 files                                                                         |
| `pnpm.cmd --filter @graphgoblin/adapter-jev test:coverage --maxWorkers=2 --coverage.reportOnFailure`    | Passed                                                                                    |
| `pnpm.cmd --filter @graphgoblin/engine test:coverage --maxWorkers=2 --coverage.reportOnFailure`         | Passed                                                                                    |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=2 --coverage.reportOnFailure` | Failed: same six baseline native process tests; all coverage thresholds passed            |
| `pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers=2 --coverage.reportOnFailure`            | Passed                                                                                    |
| `pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=2 --coverage.reportOnFailure`            | Passed                                                                                    |
| `pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/pwa.spec.ts e2e/responsive.spec.ts`        | Passed: 33/33, first execution                                                            |
| `git diff --check`                                                                                      | Passed                                                                                    |

The browser observer recheck ran `pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/pwa.spec.ts --grep 'an open window detects|registers the service worker'`: 2/2 passed after the native-method binding adjustment.

Coverage measurements use the maintained package test suites. `--coverage.reportOnFailure` retains measurements on failure without converting a failed test gate to a pass.

`check:docs` was not run because no node schema or route contract changed. `check:licenses` was not run because dependencies did not change. Contracts were not touched. Initial typing/lint/fixture failures were corrected before the final runs; the six baseline process failures were not repaired or suppressed. Turbo reported cache-write access warnings but completed the listed passing gates.

### Round 2 gates

All commands used Node `v22.14.0`. The package commands below retain the full maintained test suites; the explicit worker bound controls host load.

| Exact command                                                                                           | Result                                                                                                                       |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd build`                                                                                        | Passed: 11 tasks                                                                                                             |
| `pnpm.cmd --filter @graphgoblin/api test:coverage`                                                      | Initial attempt failed: lifecycle cleanup hook and unchanged catalog rebuild each exceeded 20 seconds; 606 passed, 6 skipped |
| `pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers=2 --coverage.reportOnFailure`            | Passed after the lifecycle cleanup budget correction: 608 passed, 6 skipped                                                  |
| `pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=2 --coverage.reportOnFailure`            | Passed: 1,471 tests in 116 files                                                                                             |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=2 --coverage.reportOnFailure` | Failed: 491 passed, the same six sandbox/native-process failures; all coverage thresholds passed                             |
| `pnpm.cmd typecheck`                                                                                    | Passed: 20 tasks, including test fixtures                                                                                    |
| `pnpm.cmd lint`                                                                                         | Passed: 11 tasks                                                                                                             |
| `pnpm.cmd format:check`                                                                                 | Passed after correcting turbo.json line endings; final report also formatted and checked separately                          |
| `pnpm.cmd check:docs`                                                                                   | Passed: generated references are current                                                                                     |
| `pnpm.cmd check:layers`                                                                                 | Passed                                                                                                                       |
| `pnpm.cmd check:deps`                                                                                   | Passed: 0 errors, existing drizzle.config.ts orphan warning                                                                  |
| `pnpm.cmd check:tokens`                                                                                 | Passed: 161 files                                                                                                            |
| `pnpm.cmd exec playwright test e2e/pwa.spec.ts` from `apps/web`, with `GG_E2E_BROWSER_CHANNEL=msedge`   | Passed: 11/11, first attempt, no retries                                                                                     |
| `git diff --check`                                                                                      | Passed                                                                                                                       |

Turbo's resolved task graph confirms that both API test tasks depend on `@graphgoblin/api#build`, that API build retains `^build`, and that API coverage outputs remain `coverage/**`.

## 6. Docs

Docs/09 restores the complete PWA configuration bullet and describes real waiting-worker browser evidence; existing editor documentation retains live planner metadata. Docs/10 documents harness location, build prerequisite, data/port/environment isolation, CLI/native evidence, platform skips and bounded startup-lock fixture. CHANGELOG names removed internal exports for test/tool consumers. No ADR, generated reference, schema, API behavior, dependency, migration or threshold change.

## 7. Decisions and parameters

| Decision             | Applied choice and reason                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U07                  | Gate at exposed admission.claim, labelled a controlled collaborator race. A second public RunManager and PollTriggers share real storage because the first manager holds its own pin mutex across claim; a same-manager poll cannot overtake that point. Preserve the actual poll probe and authenticated request; compare the winning poll identity and the deduplicated authenticated receipt. No subject-chain patch remains. |
| U08                  | Drop the real secrets table shared by all owner-scoped secret instances. Unsigned intake still saves its intent and recovers the same run; signed intake with a valid signature fails at this storage boundary and saves no intent.                                                                                                                                                                                              |
| U09                  | Class-wide refresh calls are not the contract. Registry status and classifier identity remain unchanged for unrelated secret/owner notifications; relevant key/enable changes still invalidate.                                                                                                                                                                                                                                  |
| U10                  | Protected-store parse count is an internal optimization, not a public contract. Assert one valid stored definition is admitted; retain actual malformed-definition refusal, repeated readiness checks and no-write assertions.                                                                                                                                                                                                   |
| U11                  | Remove mutable historyClock. Fake only performance in the four affected suites; advance its clock for coalescing boundaries while real timers continue to drive UI interactions.                                                                                                                                                                                                                                                 |
| U01                  | Optional Zod narrowing cleanup deferred; already acceptable library-author introspection, no private GraphGoblin access. Contracts untouched.                                                                                                                                                                                                                                                                                    |
| Jev logging          | One lookup-based forwarder, bound for four SDK levels. Real SDK debug/info exercise the one function; no direct unreachable warn/error calls and no exclusion/threshold adjustment.                                                                                                                                                                                                                                              |
| Path semantics       | Keep private hasPath implementation; no substitution with getAtPointer and no leading-zero behavior change. Test safe failure via inference output mutation fallback.                                                                                                                                                                                                                                                            |
| Routing helper audit | describeRoute only wrapped manualRoute/crossesAnyCard/BoxIndex/Reservations; createRoutingPlan still uses those live helpers. routeBackwardEdges only projected plan.routes. No shared routing helper was removed, no routing test entry was deleted, and the final LCOV identity audit found zero lost live branches in all five shared routing/helper modules.                                                                 |
| Process fixture      | Alternate free ports 5600-5699; unique temp store; inherited GG variables cleared; key minted by binary. Subprocess wait and test budgets are 60 seconds; no product timeout/grace change. A real master-key FIFO keeps startup asynchronously pending; shutdown must be logged before readiness, followed by clean exit and lock release. Ubuntu coreutils mkfifo supplies the FIFO. No product timeout changes.                |
| Platform evidence    | Signal cases run only on Linux; Node force-kills children on win32 without JS handlers. The real post-container wildcard-static-asset fault separately skips win32 because that filename is invalid on Windows. Linux CI must execute both.                                                                                                                                                                                      |
| Disposable files     | Close fixture clients/children, then best-effort remove their own temp directories using recursive, forced removal with ten retries. Child V8 reports are opt-in and default off. No owner environment is used.                                                                                                                                                                                                                  |

The only `turbo.json` additions are:

```json
"@graphgoblin/api#test": {
  "dependsOn": ["@graphgoblin/api#build"]
},
"@graphgoblin/api#test:coverage": {
  "dependsOn": ["@graphgoblin/api#build"],
  "outputs": ["coverage/**"]
}
```

The existing `build.dependsOn: ["^build"]` still supplies transitive builds. Turbo replaces the generic definition for a package-specific task, so the existing coverage output glob is repeated unchanged on the API override. No caching inputs were changed; coordinate inherited input settings when integrating WP-A1.

The exact sentence added under AGENTS.md Rules is:

> - API subprocess tests build the API first through Turbo's `test` and `test:coverage` task dependencies.

## 8. Caveats and open items

- Linux signal/startup-order and literal-wildcard HTTP-setup cases cannot execute on this Windows worker. Their native evidence remains required in ubuntu-latest CI; no fake/captured callback substitutes it. The FIFO fixture requires Ubuntu coreutils mkfifo. This is pending platform verification, not an unresolved boundary design or a native Windows pass.
- The infrastructure gate is **not green**. These unchanged tests failed on both original HEAD and final sources: `src/adversarial.test.ts:225` (ProcessScripts child/grandchild abort), `src/claude/process.test.ts:69` (deadline/output overflow), `:84` (abort/cancel), `:97` (descendant termination, also an EBUSY cleanup failure), and `src/process/scripts.test.ts:54` / `:65` (timeout/abort termination). No process implementation or those tests were changed. Their resolution is outside this finite #317 replacement package.
- Unrestricted host concurrency can exceed existing suite budgets. Bounded-worker measurements do not establish unrestricted concurrency stability.
- The six infrastructure failures reproduce the sandbox native-process termination limitation: timeouts, descendants continuing to write, and EBUSY cleanup. No native-process implementation or its tests were changed in this revision.
- Production main.ts source-coverage gaps remain assigned to #264; child V8 diagnostics are not merged into package coverage.
- #224 extends drain/force behavior; #264 owns assertion/coverage gaps. Neither is implemented here. The two fewer covered branches in unchanged EditorPage.tsx at lines 416 and 418 are a measured coverage difference, not a claimed product defect.

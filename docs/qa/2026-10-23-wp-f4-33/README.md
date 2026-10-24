# WP-F4 #33 implementation and verification evidence

Branch: `codex-wp-f4-33`. Base: `fbd48d3da5f162539964516a34d5de7e387d63c6`.
Worktree: `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-wp-f4-33`.
Changes are uncommitted for the orchestrator. No Git history or owner environment was changed.
Node 22.14.0 was selected before every pnpm/Node gate. No dependency links were created.

## Baseline reproduction (confirmed)

On the unchanged production source, two public RunManager/fake-harness scenarios passed:
`pnpm.cmd --filter @graphgoblin/engine exec vitest run src/own-session.test.ts`.
See [reproduction.log.txt](reproduction.log.txt) and the exact handle assertions in
`packages/engine/src/own-session.test.ts`.

| Authored policy                 | First worker          | Reviewer               | Revisited worker       | Second run                            |
| ------------------------------- | --------------------- | ---------------------- | ---------------------- | ------------------------------------- |
| resume-previous, fresh reviewer | starts fake-session-1 | starts fake-session-2  | resumes fake-session-2 | not used in this scenario             |
| both resume-named, key shared   | starts fake-session-1 | resumes fake-session-1 | resumes fake-session-1 | both nodes also resume fake-session-1 |

The new own-session worker/reviewer scenario then failed on the baseline with
`Invalid discriminator value. Expected 'fresh' | 'resume-previous' | 'resume-named'`:
[before-fix.log.txt](before-fix.log.txt). After implementation it passes with
worker 1 fresh, reviewer 2 fresh, worker 1 resumed, reviewer 3 fresh.

The initial unexecuted scaffold had a one-route decision and was rejected by Zod.
That first fixture error output was not kept; the valid baseline run above supersedes it.
The earlier dependency-admission failure remains in [baseline.log.txt](baseline.log.txt)
as historical environment evidence, not a session reproduction.

## Contract and isolation

`{ policy: 'resume-own', resetAfterVisits?: number }` is opt-in. Default remains fresh.
Omitted reset means no automatic reset. Its engineering range is positive safe integers
1 through 9,007,199,254,740,991, preserving exact modulo arithmetic without an arbitrary
product cap. N completed logical visits share one provider conversation; visit N+1
starts fresh. Retries, repair and interrupted recovery remain inside a visit.

Existing prompt/input/context-file controls deliberately select current loop context
for fresh or resumed turns. Reset never clears the shared thread or another node.
Own identity is run/node/harness; forks and children have separate run IDs and logs.
The log selects the final attempt of the last durable node.finished and the exact
existing session row. A stale higher attempt cannot win. No stored schema change or
migration 0020 is needed. See ADR-0052 and docs/03, docs/05, docs/06 and guide 02.

## Deterministic evidence

- Contracts: 14 focused cases pass, including default/omission, positive bounds,
  invalid reset values and unchanged old policies ([focused-contracts.log.txt](focused-contracts.log.txt)).
- Engine: 26 cases pass, including both fake harness families, feedback cycles,
  parallel runs, fork/child isolation, resets at 1 and 2, 12 visits without a reset,
  stale higher attempts, missing and uncertain sessions, exact refusal retry,
  accepted continuation, cancellation, repairs and deliberately selected loop input
  ([focused-engine-fixed.log.txt](focused-engine-fixed.log.txt)).
- Repositories: 4 focused cases pass through SQLite and the memory port
  ([focused-infrastructure.log.txt](focused-infrastructure.log.txt)).
- Editor: the actual SchemaForm control saves own policy and an optional reset,
  keeps omission, rejects zero and displays contextual help
  ([focused-web-fixed.log.txt](focused-web-fixed.log.txt)).

Earlier fixture failures and corrections are retained in focused-engine.log.txt and
focused-web.log.txt. They are not passing gates or product regressions. Typecheck
caught compound-filter narrowing errors in test code; these were fixed using two
filtering steps without casts. The initial output is retained in typecheck.log.txt.

## Native process, browser and provider checks

The built-API restart suite passed all **6/6** scenarios, including the added public API
worker/reviewer cycle. It kills the real API while waiting, starts a new API process,
reopens the same SQLite store, then verifies worker/reviewer handles and newly authored
feedback after resume. See [prompt-restart.log.txt](prompt-restart.log.txt).
This uses a fake provider, so it proves native process/storage restart, not provider recall.
All six disposable stores were retained; no worker directory deletion was performed.

The Edge browser scenario passed **1/1**, with retries disabled: keyboard selection of
own continuity, reset N=2 saved through the API, reload preserves the selection and N,
then clearing N persists its omission. See [browser.log.txt](browser.log.txt) and
`apps/web/e2e/own-session.spec.ts`. The existing schema-driven control supplies the UI;
model/effort fields and NodeEditorDialog production code are unchanged.

Bounded real scripts (exactly two turns, no retries, scratch directory, read-only tools):

```powershell
node docs/qa/2026-10-23-wp-f4-33/codex-continuity.mjs
node docs/qa/2026-10-23-wp-f4-33/claude-continuity.mjs
```

Run after `pnpm.cmd build` with Node 22. The launcher resolves public workspace exports
at the API composition root; provider work remains in its separately created temporary
directory. The scripts start fresh, recreate the adapter and resume the same native ID,
checking a random synthetic nonce omitted from the resume prompt, acceptance markers and
reported input usage. Each turn has a 90-second QA deadline (an engineering test bound,
not a product session limit). No retries or model fallback are allowed.

Codex requests `gpt-6-luna` / low with API-key environment variables removed so it uses
the existing sign-in. CLI **0.160.0** was reachable, but preflight reported auth missing
or invalid in this sandbox. It stopped with **zero provider turns**, without attempting
login or configuration changes. See [codex-live-public-entry.log.txt](codex-live-public-entry.log.txt).
The preceding built-entrypoint attempt had the same auth result
([codex-live-final.log.txt](codex-live-final.log.txt)); the earliest premature attempt
stopped before the CLI because a build artifact did not yet exist
([codex-live.log.txt](codex-live.log.txt)). These are retained failures, not live evidence.

Claude requests `claude-haiku-5-5` / low. Its real provider turns were **not run**, as
D-005 reserves them for the orchestrator. Both native continuity scripts need execution
in the orchestrator's signed-in context. Fake-harness tests establish neither native
recall/retention nor provider compaction guarantees. No provider settings were changed.

### Orchestrator live run (2026-10-24, D-005)

The orchestrator ran both scripts unchanged from this worktree after `pnpm build`, with Node
22.14.0 and the machine's existing sign-ins. Both passed with exactly two turns each: the
adapter was recreated between the turns, the resumed turn reported the same provider session,
and the provider recalled the nonce that only the first turn contained.

| Harness | CLI     | Model / effort           | Turns | Same session | Nonce recalled | Log                                                                  |
| ------- | ------- | ------------------------ | ----- | ------------ | -------------- | -------------------------------------------------------------------- |
| Codex   | 0.160.0 | `gpt-6-luna` / low       | 2     | yes          | yes            | [orchestrator-live-codex.log.txt](orchestrator-live-codex.log.txt)   |
| Claude  | 2.1.308 | `claude-haiku-5-5` / low | 2     | yes          | yes            | [orchestrator-live-claude.log.txt](orchestrator-live-claude.log.txt) |

This proves native start and resume of a recorded session ID for both supported harnesses,
which `resume-own` relies on; the selection of which ID to resume is proved by the engine
tests above. The two scratch directories (`gg-wp-f4-33-*`) were left in the temp folder.

## Gate commands and results

All commands below ran from the worktree with Node **22.14.0** first on PATH and
`pnpm.cmd` from PowerShell. There was no store-lock failure and no direct-binary fallback.
PowerShell stderr wrappers labelled NativeCommandError in some captures are not the
exit result; results below use actual exit codes and the tool's final summary.

| Command                                                                                                                                                                                                                                            | Result and retained output                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm.cmd typecheck --concurrency=2 --cache-dir=.turbo/cache`                                                                                                                                                                                      | PASS, 20 tasks; [typecheck-final.log.txt](typecheck-final.log.txt). Initial test narrowing failure: typecheck.log.txt; subsequent generated-client mismatch: typecheck-fixed.log.txt. Fixed narrowing, then regenerated the public client before the final run.                                        |
| `pnpm.cmd --filter @graphgoblin/web typecheck`                                                                                                                                                                                                     | PASS after final browser edits; typecheck-web-final.log.txt.                                                                                                                                                                                                                                           |
| `pnpm.cmd lint --concurrency=2`                                                                                                                                                                                                                    | PASS, 11 tasks; [lint.log.txt](lint.log.txt). Existing ThreadViewer useState warning and shared Turbo-cache access warnings retained.                                                                                                                                                                  |
| `pnpm.cmd --filter @graphgoblin/engine lint`                                                                                                                                                                                                       | PASS after fixture narrowing corrections; lint-engine-final.log.txt.                                                                                                                                                                                                                                   |
| `pnpm.cmd --filter @graphgoblin/api exec eslint scripts/prompt-restart.integration.mjs`                                                                                                                                                            | PASS after final restart-script edit; lint-api-script-final.log.txt.                                                                                                                                                                                                                                   |
| `pnpm.cmd format:check`                                                                                                                                                                                                                            | Initial FAIL in e2e/server.ts; format-check.log.txt. Fixed the formatting.                                                                                                                                                                                                                             |
| `pnpm.cmd format:check --cache`                                                                                                                                                                                                                    | PASS; [format-check-final.log.txt](format-check-final.log.txt). An extra post-report run of the same full command was cancelled after over ten minutes without a summary (format-check-report.log.txt); no passing result is claimed for that run. The changed QA files passed the direct check below. |
| `pnpm.cmd exec prettier --ignore-path .gitignore --check docs/qa/2026-10-23-wp-f4-33/README.md docs/qa/2026-10-23-wp-f4-33/live-continuity.mjs docs/qa/2026-10-23-wp-f4-33/codex-continuity.mjs docs/qa/2026-10-23-wp-f4-33/claude-continuity.mjs` | Final QA-file check; format-check-qa-final.log.txt. The override includes raw-QA script extensions normally ignored by Prettier.                                                                                                                                                                       |
| `pnpm.cmd check:layers`                                                                                                                                                                                                                            | PASS; check-layers.log.txt.                                                                                                                                                                                                                                                                            |
| `pnpm.cmd check:deps`                                                                                                                                                                                                                              | PASS, zero errors; check-deps.log.txt. Existing no-orphans warning for infrastructure/drizzle.config.ts.                                                                                                                                                                                               |
| `pnpm.cmd check:tokens`                                                                                                                                                                                                                            | PASS; check-tokens.log.txt.                                                                                                                                                                                                                                                                            |
| `pnpm.cmd --filter @graphgoblin/api-client generate`                                                                                                                                                                                               | PASS; client-generate.log.txt. Required to propagate the new schema union.                                                                                                                                                                                                                             |
| `pnpm.cmd docs:generate`                                                                                                                                                                                                                           | PASS; docs-generate-final.log.txt. Earlier generation also retained.                                                                                                                                                                                                                                   |
| `pnpm.cmd check:docs`                                                                                                                                                                                                                              | PASS, generated docs current; check-docs.log.txt.                                                                                                                                                                                                                                                      |
| `pnpm.cmd check:migrations`                                                                                                                                                                                                                        | Not applicable / not run: no migration or stored schema change.                                                                                                                                                                                                                                        |
| `pnpm.cmd check:licenses`                                                                                                                                                                                                                          | Not applicable / not run: no dependency changes.                                                                                                                                                                                                                                                       |
| `pnpm.cmd test:prompt-restart`                                                                                                                                                                                                                     | PASS, 6 tests; prompt-restart.log.txt. Environment: GG_PROMPT_RESTART_PORT_BASE=5940, GG_PROMPT_RESTART_DATA_PREFIX=gg-wp-f4-33-, GG_PROMPT_RESTART_KEEP_DATA=1.                                                                                                                                       |
| `pnpm.cmd build --concurrency=2 --cache-dir=.turbo/cache`                                                                                                                                                                                          | PASS, 11 tasks; [build.log.txt](build.log.txt).                                                                                                                                                                                                                                                        |
| `pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/own-session.spec.ts --retries=0`                                                                                                                                                      | PASS, 1 test; browser.log.txt. GG_E2E_MAIN_PORT=5942 and GG_E2E_CONTROL_PORT=5943; default Windows Edge channel, no download.                                                                                                                                                                          |

Focused commands also passed:

```powershell
pnpm.cmd --filter @graphgoblin/contracts exec vitest run src/session-policy.test.ts
pnpm.cmd --filter @graphgoblin/engine exec vitest run src/own-session.test.ts
pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/sqlite/session-family.test.ts
pnpm.cmd --filter @graphgoblin/web exec vitest run src/forms/session-policy.test.tsx
```

The pre-fix regression command used the engine command above with
`-t 'resumes only the worker'`; its discriminator rejection is in before-fix.log.txt.
Focused fixture failures are preserved separately, never relabelled as passing runs.

### Package coverage (all denominators and thresholds unchanged)

Each package was run directly, bypassing Turbo coverage cache, with
`pnpm.cmd --filter @graphgoblin/<package> test:coverage --maxWorkers=2`.
API and api-client additionally used `--coverage.reportOnFailure`.
The unchanged adapter-codex package was also checked because the brief names it.
No broad suite was retried to obtain green results.

| Package                          | Tests                                 | Statements / branches / functions / lines | Result and evidence                                                    |
| -------------------------------- | ------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| contracts                        | 280 passed                            | 99.50 / 95.00 / 100 / 99.74 percent       | PASS; coverage-contracts.log.txt.                                      |
| engine                           | 1606 passed, 1 failed                 | Not emitted after failure                 | FAIL; coverage-engine.log.txt.                                         |
| infrastructure                   | 759 passed, 15 failed                 | Not emitted after failure                 | FAIL; coverage-infrastructure.log.txt.                                 |
| adapter-codex (extra, unchanged) | 493 passed, 2 failed, 5 skipped       | Not emitted after failure                 | FAIL; coverage-adapter-codex.log.txt.                                  |
| api-client (generated contract)  | 71 passed, 1 failed                   | 100 / 99.37 / 100 / 100 percent           | FAIL despite coverage meeting thresholds; coverage-api-client.log.txt. |
| api                              | 1317 passed, 4 failed, 8 skipped      | 96.47 / 93.16 / 94.27 / 97.94 percent     | FAIL despite coverage meeting thresholds; coverage-api.log.txt.        |
| web                              | 1599 passed, 8 failed; 1 worker error | Not emitted after failure                 | FAIL; coverage-web.log.txt.                                            |

The new focused scenarios and browser check passed. Broad suite failures occurred in
unchanged tests; that observation does not establish their cause or excuse failed gates:

- Engine: `run-manager.test.ts:172`, fast graph cycle expected more than one timer tick,
  received one. This pure decision scenario does not invoke inference.
- Infrastructure: adversarial real-child abort; process/scripts (3), Claude/process (4),
  Claude/readiness (1), SQLite/upgrade (6). Full assertions and timeouts are retained.
  Upgrade is protected #355 work and was not edited.
- Adapter-codex: probe-directory long TEMP and collision tests exceeded 5 seconds.
- api-client: templates test exceeded 5 seconds; teardown also exceeded 10 seconds.
- API: ADV-008 routes/scopes, invalid-effort manual catalog, CLI exit-code subprocess,
  nested-readiness Codex fixture exceeded their existing deadlines.
- Web: seven timeouts across EditorPage, NodeEditorDialog, TriggerEditor, json-sections,
  SettingsPage and EditorPage.restore; one legacy restore assertion could not find its
  heading. One Vitest fork worker failed to start/respond. Full names remain in the log.

No test deadline, retry policy, threshold, exclusion or unrelated production behavior
was changed to bypass these failures. Package coverage totals are not asserted where
Vitest did not emit them. Independent clean-environment verification remains required.

## Changed surfaces and integration notes

Runtime changes are confined to the session schema/metadata, inference selection and
visit derivation, the session repository port, fake repository and SQLite query.
The adapters' existing resume paths already forward complete settings and native IDs;
neither adapter production implementation was changed.

Additive supporting edits outside the primary files:

- `packages/engine/src/prompt-provenance.test.ts`: forwards the new public repository
  query in its existing injected wrapper; no provenance behavior change.
- `packages/api-client/openapi.json` and `src/generated/schema.ts`: regenerated union.
  The WP-E1 SSE source is untouched.
- `apps/api/scripts/prompt-restart.integration.mjs`: new public own-session restart
  scenario plus optional test port/prefix/retain overrides. Default behavior unchanged.
- `apps/web/e2e/server.ts`: only optional test port overrides (main/control); no product
  routing, shutdown, model/effort or form layout change.
- `docs/09-frontend-and-pwa.md` and guide 02: additive session-policy/help paragraphs.
  These overlap WP-F2b documentation ownership; model/effort prose/layout is untouched.
- Shared docs/03, docs/05 and docs/06: continuity/context/recovery sections only;
  WP-F3 structured completion and other run-manager ownership regions are untouched.

Also updated docs/04's schema and recovery description, ADR-0052, generated reference
nodes, and one top Unreleased CHANGELOG bullet ending (#33), with an Upgrade note for
client/port implementers and no store rewrite.

## Evidence handling and outstanding acceptance

Logs are retained as .log.txt, normalized to UTF-8 and user-profile paths redacted to
`%USERPROFILE%`. The historical baseline remains clearly labelled. No captured log is
above 1,000,000 bytes. Passing browser execution produced no failure trace or screenshot.
Temporary coverage/build/report/store directories remain for orchestrator cleanup.

Completed: baseline reproduction; implementation; deterministic isolation/reset/provenance
scenarios; schema-driven editor and browser persistence; real API process restart;
docs/reference/client generation and the listed passing static/build gates.

Outstanding at the implementer's report: failed broad coverage gates; native provider
start/resume evidence for both harnesses (since supplied by the orchestrator's live run
above); independent review/QA and owner product acceptance. No issue closure, merge,
commit, publication, owner-runtime update or live-provider continuity claim is made.

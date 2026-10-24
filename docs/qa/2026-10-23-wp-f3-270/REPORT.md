# WP-F3, bolt #270

## 1. Branch and worktree

Branch: `codex-wp-f3-270`. Worktree:
`%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-wp-f3-270`.
Base commit: `fbd48d3da5f162539964516a34d5de7e387d63c6`.
Uncommitted; orchestrator review and unresolved validation remain before commit.

## 2. Per bolt

**#270: implemented; full verification remains incomplete.**

- Baseline: both public RunManager and API reproductions stayed `running` beyond the
  configured visible run deadline, while the repair call remained pending and capacity
  1 held the next run queued. Both failed with
  `AssertionError: expected 'running' to be 'failed'`. [Baseline evidence](BASELINE.md)
  records the controlled fake boundary and the unkept initial terminal captures.
- Configured completions: one engine helper bounds repair and LLM route ports, forwards
  abort and produces resumable `STRUCTURED_COMPLETION_TIMEOUT`, with the configured
  milliseconds in its message and `details.timeoutMs`. Public engine tests demonstrate
  capacity release; API tests exercise repair and the real CodexDecider over a fake
  StructuredPort. An authored run deadline retains `RUN_DEADLINE_EXCEEDED`.
- Late settlement: both fulfillment and rejection are observed once after interruption,
  logged as `late structured completion discarded` with run/node identity and no provider
  body, and cannot produce a decision, node completion patch or changed thread.
- Cancellation: explicit Cancel remains `cancelled`, with `run.cancelled` and no timeout
  failure. A finite-deadline cancellation test freezes time before expiry, then verifies
  the late value and elapsed deadline cannot change that outcome. Race tests require one
  terminal outcome.
- Unlimited/defaults: null/omission adds no completion timer. Fake-timer evidence advances
  beyond the former 120-second declared setting; cancellation still works. Pin/restart
  evidence uses a new RunManager over fake repositories and preserves the original
  20 ms pin through publication and Resume. It is controlled component evidence, not a
  native process restart claim.
- Adapter: abort is checked before and after temporary directory allocation; the signal
  reaches the SDK through CodexHarness, session.cancel is invoked and scratch cleanup
  runs after cancellation. Tests cover early abort, SDK abort forwarding, cancellation
  cleanup and cleanup failure.
- Real adapter: the 100 ms case produced the typed timeout and advanced past assertions
  that the original SDK session settled and its scratch directory was cleaned. The
  expected-fast case exceeded its explicit 60,000 ms deadline. **The positive live case
  is unresolved.** [Attempt log](real-adapter.log.txt) and
  [reconstructed attempted runner](real-adapter-check-run.mjs) retain this evidence. The attempted runner was reconstructed by reversing the later model-constant and final-cleanup edits; its original raw script capture was not kept. The attempt
  preceded the final engine Promise.race refactor; that earlier helper source was not
  kept separately. Adapter cancellation code is unchanged. The
  [current runner](real-adapter-check.mjs) adds bounded final cleanup reporting and is
  ready for the orchestrator to run outside this sandbox. No further provider retry
  was attempted here. SDK session settlement is observed; no separate PID-tree inventory
  is claimed.

## 3. Files changed

The complete package-grouped manifest is [FILES.md](FILES.md).

- Engine: completion boundary, repair/evaluation calls, pins, constructor contract and
  supported-interface regression tests/builders.
- Contracts: visible nullable loop/pin limit, typed timeout code, fixtures and four golden
  parse outputs.
- Codex adapter: abort/cancel/scratch lifecycle and tests.
- API: injected structured adapter also feeds the default CodexDecider; public boundary
  tests cover fast, stalled/late and cancellation paths.
- Web: Loop control, Settings default, pinned inspector value, unit and browser tests.
- API client: regenerated OpenAPI and TypeScript schema.
- Infrastructure: pin fixtures and old-migration read-default assertions only.
- Docs and QA: behavior/upgrade text, ADR-0051, raw logs and bounded real-adapter runner.

Shared WAVE files: `apps/api/src/container.ts` edits are limited to the CodexDecider
import, structured wiring and removal of the unused engine setting (the structured
region shared with WP-C7). `docs/guide/07-troubleshooting.md` has an additive structured
completion section alongside WP-C7's guide ownership. No shutdown/admission region was
implemented by this bolt. Shared locations: container.ts lines 6, 281 and 302 (import, decider wiring and settings block); guide 07 adds its section at line 267.

## 4. Tests

Regression names are in `packages/engine/src/structured-deadline.test.ts` and
`apps/api/src/structured-deadline.test.ts`. They demonstrably failed on the base before
production edits; the quote above is the faulty status assertion. Initial fixture errors
were corrected before accepting reproduction evidence, as recorded in BASELINE.md.

The final helper passed 40 focused deadline/evaluator tests. An additional deterministic
finite-deadline cancellation test passed separately. Seven focused API cases passed after
replacing an arbitrary provider-entry poll with a public entry/terminal-state barrier;
that source change resolves the fixture's scheduling failure, rather than retrying it
unchanged. A subsequent cleanup race was fixed by removing the duplicate body cancellation: afterEach now solely owns stopping the queued run. The final helper's API recheck passed all seven cases after the cleanup fix; see api-focused-verified.log.txt. Both relevant browser
specs passed against the built served app. Five Codex abort tests were added to the
existing five structured tests.

Coverage and final package test results:

| Package        | Tests                                                        | Lines  | Branches | Result                                                        |
| -------------- | ------------------------------------------------------------ | ------ | -------- | ------------------------------------------------------------- |
| engine         | 1592 passed, 2 failed; finite-cancel check passed separately | 98.09% | 93.05%   | Failed unchanged child-wake/Unlimited timing checks           |
| adapter-codex  | 498 passed, 2 failed, 5 skipped                              | 98.88% | 94.66%   | Failed two unchanged probe-directory timeouts                 |
| api            | 1328 passed, 8 skipped                                       | 97.94% | 93.16%   | Passed                                                        |
| contracts      | 266 passed                                                   | 99.74% | 95.00%   | Passed                                                        |
| api-client     | 72 passed                                                    | 100%   | 99.37%   | Passed                                                        |
| web            | 1636 passed                                                  | 98.92% | 94.97%   | Passed                                                        |
| infrastructure | 762 passed, 10 failed                                        | 98.69% | 95.04%   | Failed unchanged process cleanup/readiness and cutover checks |

All measured package line and branch denominators exceed 90%. Coverage reporting on
failure does not make a failing suite pass. No threshold, exclusion or timeout was
weakened. The added finite-cancel test was not in the engine coverage run's initial
file collection and passed its own supported-interface check.

Final unresolved aggregate failures are retained in the corresponding final logs:

- Engine: `awaited-children.test.ts:141` (stale-child wake) and
  `unlimited.test.ts:62` (Unlimited marked passes).
- Adapter: `probe-directory.test.ts:33` and `:59`, both 5-second timeouts.
- Infrastructure: `adversarial.test.ts:225` (child/grandchild cancellation timeout);
  `claude/process.test.ts` (two EBUSY cleanup errors and descendant marker still growing
  at line 146); `claude/readiness.test.ts:62` (shutdown-unconfirmed diagnostic instead
  of expected deadline diagnostic); `process/scripts.test.ts:194` (cleanup required),
  `:237` and `:248` (15-second timeouts); `sqlite/upgrade.test.ts:230` and `:302`
  (20-second cutover timeouts). Ten tests failed; one also produced an extra cleanup
  error, so the raw failure-detail list contains eleven entries.

These files were not changed by this bolt. Their failures are unresolved; measured
host contention does not establish the cause of every failure or excuse native
process cleanup failures. See [CHECKS.json](CHECKS.json) for exact commands and results.

## 5. Gates

All commands select Node v22.14.0 first on PATH and invoke `pnpm.cmd` on Windows.
Final Turbo checks use a cache under this worktree (`TURBO_CACHE_DIR=.turbo/cache`)
to avoid denied writes to the shared cache. Two workers limit this worker's test load;
`--coverage.reportOnFailure` preserves honest metrics even when tests fail.

- `pnpm.cmd typecheck` and final `pnpm.cmd typecheck --concurrency=2`: passed 20/20. A follow-up engine typecheck includes the additional finite-cancel fixture.
- `pnpm.cmd lint`: initial fixture import-style and helper rejection-type failures were
  fixed. Engine lint and final `pnpm.cmd lint --concurrency=2` passed; the latter retains one unchanged useState warning at `apps/web/src/runs/inspector/ThreadViewer.tsx:106`. The intermediate helper-lint failure capture was not kept separately after the final root log replaced it; its rejection-type reason is transcribed here.
- `pnpm.cmd format:check`: interrupted without completion; not a pass. See [format notes](FORMAT-NOT-COMPLETED.md). A changed-file formatting diagnostic is retained separately.
- `pnpm.cmd check:layers`: passed.
- `pnpm.cmd check:deps`: passed, with one existing no-orphans warning for drizzle.config.ts.
- `pnpm.cmd check:docs`: passed; generated references are current.
- `pnpm.cmd check:tokens`: passed, 169 web files checked.
- Original package coverage commands were run for engine, adapter-codex, API, contracts,
  web, infrastructure and API client. Failures/interrupted runs are retained in their
  initial logs. Final commands are
  `pnpm.cmd --filter @graphgoblin/<package> test:coverage --maxWorkers=2 --coverage.reportOnFailure`.
  Final statuses are recorded in section 4 and CHECKS.json; no earlier failure is concealed by a later pass.
- `pnpm.cmd --filter @graphgoblin/api-client generate` and `pnpm.cmd docs:generate`: passed.
- `pnpm.cmd build --concurrency=2`: passed 11/11.
- From `apps/web`, `pnpm.cmd exec playwright test e2e/unlimited-mode.spec.ts`: passed 2/2.
- `node docs/qa/2026-10-23-wp-f3-270/real-adapter-check.mjs`: incomplete positive case;
  the retained attempt exited 1 after its 60-second timeout.
- `git diff --check`: passed.

## 6. Docs

Updated numbered docs 04, 05 and 06; guide 03's failure reference and guide 07's typed
completion timeout guidance; ADR-0051; and the top Unreleased CHANGELOG bullet ending
`(#270)`. Upgrade notes move the formerly unenforced EngineSettings field into
LoopSettings. OpenAPI/client types were regenerated; docs/reference outputs regenerate
without content differences and check:docs passed.

## 7. Decisions and parameters

- **Owner:** one engine Promise.race boundary, not an adapter timer. It covers LLM routing
  and every structured repair attempt independently. The clock starts at the port-call
  boundary after engine admission/model/context preparation, not at API request arrival.
- **Configured:** a positive integer `LoopSettings.structuredTimeoutMs`, pinned in
  `run.pinned.limits`. The unused constructor setting is removed, with an upgrade note.
- **Default/Unlimited:** null, including omission. No finite runtime default is introduced.
  The Loop editor's Limited suggestion is 120,000 ms, chosen from the old declared value,
  never applied until authored and never represented as owner-approved. Null removes
  this timer; independent run/node/gate controls and Cancel still apply.
- **Range:** 1 to 31,536,000,000 ms, matching the run deadline's one-year range; timer
  chunks are at most Node's 2,147,483,647 ms to avoid overflow. The configured failure
  is resumable for a deliberate new read-only completion attempt; no automatic retry
  or spending/token/subscription/provider-turn budget is introduced.
- **Cancellation representation:** retain the existing `cancelled` status and
  `run.cancelled` event, without a RunFailure payload. This distinguishes cancellation
  from `failed` plus `STRUCTURED_COMPLETION_TIMEOUT`; no separate cancellation failure
  code was added. This is an explicit interpretation of the requested distinguishability.
- **Storage:** current schema defaults add null consistently to definitions, run pins,
  queued events and admission parsing. No persisted value needs rewriting and no new
  migration is necessary; old migration tests verify the read defaults.
- **Adapter cleanup:** existing harness cancellation grace is retained (5 seconds); no
  new adapter execution ceiling. Native QA uses explicit 100 ms and 60,000 ms deadlines,
  10-second cleanup observations and a 120,000 ms outer QA watchdog. These are bounded
  test choices, not product defaults or owner-approved runtime parameters.

## 8. Caveats and open items

Do not call #270 fully verified or merge-ready. The positive real-provider case needs
an outside-sandbox run of the current runner, and aggregate gate failures and the incomplete
whole-repository format gate need independent QA/baseline reconciliation. No retry-to-green acceptance is claimed. See
[host measurement](HOST-MEASUREMENT.md) for the observed process load and its limits.
Unchanged engine child-wake/Unlimited and adapter CLI-probe timing failures recur; an
earlier checkpoint test also measured 2027.96 ms against its 2000 ms bound. The latter
passed in the final engine run but has not been resolved by a code change.

Infrastructure's native cleanup/readiness failures require investigation alongside
its two cutover timeouts. The final API-client run passed all 72 tests. Retained artifacts
are indexed with byte sizes and SHA-256 in [ARTIFACTS.json](ARTIFACTS.json); changed
source and runner hashes are in [SOURCE-HASHES.json](SOURCE-HASHES.json). Captured logs
are normalized to UTF-8 and user-profile paths redacted before hashing; pre-normalized
terminal streams were not separately kept. No retained capture exceeds 1,000,000 bytes.

All changes remain uncommitted for the orchestrator's cross-vendor review, QA and
subsequent commit/sign-off process. The requested commit-ready state is not asserted
because the validation gaps above remain. Task-prefix temporary directories and generated
outputs remain for the orchestrator; see [TEMP-LEFTOVERS.md](TEMP-LEFTOVERS.md).

Observed outside this bolt: `packages/engine/src/ports.ts:464` still describes owner
model defaults as read on start or resume, although execution pins inherited defaults
at creation. This existing comment was not changed as part of structured deadlines.

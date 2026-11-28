# Codex probe cleanup (#506, #511): review and QA

Issues #506 and #511 are bounded cleanup fixes in `@graphgoblin/adapter-codex`.

- **#506:** a Codex readiness check that timed out could leave its `gg-codex-probe-*` directory on Windows.
- **#511:** a skipped Codex live suite still created a `graphgoblin-live-*` directory.

This packet binds:

- the reviewed candidate;
- the correction that formal review 1 required;
- the merge with current main;
- the independent Claude review and QA of the result.

Raw originals are under `raw/` with their SHA-256 in [MANIFEST.json](MANIFEST.json).

## Commits

| Commit                                     | Role                                                                                                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `babb335ca869b588a4908d2e5ea24264aee2397b` | The 12-path candidate that formal review 1 examined, committed unchanged on `154e78d54ee485330816d606032280de44d6e891`. Its blob ids match the review's patch exactly. |
| `49b29cfe9f08d6440180b747925a4ce078f5b6f7` | The review-1 correction, in five paths only.                                                                                                                           |
| `46617e2920d25a7e396fc229a797fa2e8773858e` | `git merge --no-ff` of main `4e1037c9e9922ffa27237fe79850403b6b54fc70`. This is the head that the review and QA bind.                                                  |

The candidate and the correction are separate commits, so the targeted opposite-family re-review can read exactly `git diff babb335c 49b29cfe`. The manifest records that diff's SHA-256.

## Behaviour

**The CLI runner (#506).** Codex preflight and the per-turn MCP listing run the CLI through one runner that settles the exact child it started.

- Ordinary completion resolves when the child closes.
- A deadline or cancellation stays the call's first failure. The runner then:
  - asks the child to stop;
  - sends one stronger request halfway through a separate two-second cleanup allowance, if the child has not exited;
  - waits for `close` within that allowance.
- Without a `close` in time, the result carries `terminationUnconfirmed`.
- A missing executable is reported at once.
- A listing whose turn is already cancelled starts nothing.

**Preflight cleanup.** Preflight removes its probe directory once, after the last check has closed, and does not retry.

- A check that did not confirm that it stopped may still be running in that directory. Preflight then leaves the directory in place and attempts no removal.
- In either cleanup failure, preflight keeps the check's state and adds one fixed problem:
  - `Codex CLI check process did not confirm that it stopped.` when the check was not confirmed stopped;
  - `Codex readiness check could not remove its temporary folder.` when the removal after close failed.
- A check that passed reports `unknown` instead.

**Unconfirmed listing.** A listing whose process did not confirm that it stopped fails the turn with `HARNESS_TERMINATION_UNCONFIRMED`, using a fixed listing message. This happens before any output is read, and no turn starts.

- The listing error is definitely-not-submitted. The harness reports `delivery-uncertain` through the existing engine rule.
- A cancelled turn ends as cancelled, or with this listing message, when the listing's runner settles before the harness's cancellation acknowledgement bound (`cancelGraceMs`, default 5 s).
- A custom `cancelGraceMs` shorter than the two-second allowance can return the harness's generic termination message, with the same code.

**Live suite (#511).** The Codex live smoke suite allocates its working directory in an enabled `beforeAll` hook, whose teardown removes it. A skipped suite creates nothing.

There is no store, schema, API or format change. Folders left by earlier runs are not removed.

## Native baseline

[ARCHITECTURE.md.txt](raw/baseline/ARCHITECTURE.md.txt) records the selected design.

The pre-change source at `154e78d5` ran three native Windows fake-CLI timeouts with the [diagnostic driver](raw/baseline/probe-readiness.mjs). In each one:

- the typed timeout settled first;
- removal of the probe directory failed with `EBUSY`;
- only then did the child exit and close;
- the directory remained afterwards.

The runs are [timeout-01](raw/baseline/timeout-01.stdout.json), [timeout-02](raw/baseline/timeout-02.stdout.json) and [timeout-03](raw/baseline/timeout-03.stdout.json).

Actual collection of `src/live.test.ts` with `LIVE=0` skipped all four cases ([output](raw/baseline/disabled-live.stdout.log.txt)), yet left one empty `graphgoblin-live-*` directory.

This is fake-CLI evidence, not a frequency estimate for the real CLI.

## Author evidence before review

The [implementation report](raw/author/implementation-01/IMPLEMENTATION-REPORT.claude.md.txt) covers the runner, preflight, live-suite and test changes.

The [continuation report](raw/author/continuation-02/IMPLEMENTATION-REPORT.claude.md.txt) covers the unconfirmed listing mapping.

The continuation report also kept FUP093's conservative engine outcome: the harness reports `delivery-uncertain` for an unconfirmed termination. Its final package coverage was 710 passed and 5 skipped.

## Formal review 1: CHANGES REQUIRED

The opposite-family formal review 1 ([original](raw/review-01/REVIEW.md.txt)) examined the unchanged candidate. It accepted FUP093's classification, the confirmed-close ordering and the #511 lifecycle. It required two changes:

- **R1 (P2):** preflight still called `rm` on its probe after the runner reported `terminationUnconfirmed`, while the child might still be using the directory. The owned probe must be kept on uncertainty. One removal must still follow a confirmed close, and the changelog and guide must agree.
- **R2 (P3):** docs/06 must qualify which message a cancelled listing returns when a custom `cancelGraceMs` is shorter than the runner's allowance.

## Correction (`49b29cfe`)

The full author record is the [correction report](raw/correction-03/CORRECTION-REPORT.md.txt). Its `logs/*.log` files are stored here as `logs/*.log.txt` with unchanged bytes.

**Source change.** `preflightCli` now computes `cleanup = notStopped ? [CHECK_NOT_STOPPED] : await removeProbe(cwd)`. An unconfirmed check makes zero `rm` calls and adds no removal-failure problem. After a confirmed close, the single removal and its separate problem are unchanged. `runCli` and all public contracts are unchanged.

**New test.** `probe-directory.test.ts` adds `retains its probe before confirmed close, given $name`. It uses the owned temporary fixture and a controlled runner:

- an unconfirmed timeout: typed result, fixed problem, zero `rm` calls, retained empty directory;
- the same timeout after close: one `rm` call, directory gone.

The stale row that combined an unconfirmed stop with a removal was removed. The confirmed-timeout, signed-out and ready rows with an injected `EBUSY` remain.

**Red, then green.** The contract's targeted selector failed against the unfixed source on exactly the zero-`rm` assertion ([red](raw/correction-03/logs/01-red-controlled-old-source.log.txt)). It passed with the fix ([green](raw/correction-03/logs/02-green-controlled-fixed-source.log.txt)).

**Checks at `49b29cfe`:**

- focused probe-directory, cli and isolation suites: 100 passed, 1 skipped ([log](raw/correction-03/logs/05-focused-tests.log.txt));
- typecheck, lint, Prettier and `git diff --check`: pass.

**Coverage at `49b29cfe`.** The package-wide adapter coverage run excluded only the installed-CLI case and ran under the shared machine lock ([log](raw/correction-03/logs/08-coverage.log.txt)):

- 710 passed, 5 skipped;
- lines 99.31% (577/581), branches 96% (505/526);
- the new code is fully covered.

**After the merge.** Main changes no `adapter-codex` file and no dependency. The CHANGELOG conflict was resolved as a union. With the merge applied:

- focused suites including `live-collection` and `live`: 104 passed, 5 skipped ([log](raw/correction-03/logs/10-merge-focused-tests.log.txt));
- typecheck and lint: pass.

## Independent Claude review

Verdict: approved for the opposite-family review, with no fix-in-PR findings in `babb335c..49b29cfe` or the full slice ([original](raw/independent-rq-01/REVIEW.md.txt)).

The reviewer was a separate Claude Opus 5.5 (xhigh) agent.

- **R1** is resolved: zero removals on an unconfirmed stop, with the red control at the zero-`rm` assertion.
- **R2** is resolved and accurate against `harness.ts`.

The merge keeps every `adapter-codex` blob identical to `49b29cfe`.

Observations, none admitted as findings:

1. A retained probe is never reclaimed. Each unconfirmed preflight leaves one directory. This follows the R1 contract and the CHANGELOG.
2. A maintained native regression with a detached helper that keeps the pipes would pin the unconfirmed path and the `cancelGraceMs` race. This is recommended for the orchestrator's catalogue, not this PR.
3. The test-only setup module is still emitted into `dist`. Formal review 1 had already assessed this.

## Independent QA: PASS WITH LIMITS

The QA agent was a separate Claude Opus 5.5 (xhigh) agent ([original report](raw/independent-rq-01/QA-REPORT.md.txt)).

**How it ran.** The QA drove `46617e29`'s source through `createCodexHarness()`. Observing wrappers recorded every `rm`, spawn, kill, exit and close ([drivers](raw/independent-rq-01/scripts/)).

The fake CLI makes no provider request, and `CODEX_HOME` pointed to an unused path. Each helper process was bounded, and its pid was recorded.

The report refers to `raw/runs/` paths. Here the case records are under [`raw/independent-rq-01/runs/`](raw/independent-rq-01/runs/).

| ID      | Case                                                                          | Observed                                                                                         | Result          |
| ------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------- |
| Q01–Q02 | Ready and signed-out CLI                                                      | Expected state; close, then one `rm`; TEMP empty                                                 | PASS            |
| Q03     | Confirmed timeout                                                             | `SIGTERM` → close → one `rm`; typed `unknown`; no residue                                        | PASS            |
| Q04     | Missing executable, 15 s deadline                                             | `cli-missing` 1.5 ms after spawn; probe removed                                                  | PASS            |
| Q05     | Real detached grandchild keeps pipes and working directory past the allowance | `[UNKNOWN, NOT_STOPPED]`, **zero `rm` calls**, probe retained; close came about 4 s after return | PASS            |
| Q06     | Non-detached grandchild (the bundled launcher's structure)                    | Ended with its parent; confirmed path; probe removed                                             | OBSERVED        |
| Q07–Q09 | Real `EBUSY` holder after ready, signed-out and confirmed-timeout checks      | One `rm` → `EBUSY`; check result kept plus the removal problem                                   | PASS            |
| Q10     | Confirmed timeout under a 226-character TEMP root                             | 250-character probe removed after close                                                          | PASS            |
| RC1     | Red: `babb335c`, Q05 scenario                                                 | `rm` → `EBUSY` while the descendant still ran (formal review 1's R1)                             | RED as expected |
| RC2     | Red: `4e1037c9` (pre-#506), Q03 scenario                                      | Removal before close; probe left (the original defect)                                           | RED as expected |
| L1      | Listing hangs; turn cancelled                                                 | Listing closes before an `AbortError`; no turn                                                   | PASS            |
| L2      | Unconfirmed listing, cancelled, default `cancelGraceMs`                       | Exact listing message with `HARNESS_TERMINATION_UNCONFIRMED`; `delivery-uncertain`; no turn      | PASS            |
| L3      | As L2 with `cancelGraceMs` 500                                                | Generic harness message, same code (the R2 wording)                                              | PASS            |
| L4      | Unconfirmed listing after its own deadline                                    | Listing `timed out after 2500 ms` message; no turn                                               | PASS            |
| L5      | Closing listing with `cancelGraceMs` 10                                       | Generic message wins (the author's untested caveat)                                              | PASS            |
| N1      | Disabled live-suite collection at the head                                    | 4 skipped; TEMP root empty                                                                       | PASS            |
| N2      | Red: pre-fix `live.test.ts`                                                   | One `graphgoblin-live-*` left                                                                    | RED as expected |
| N3      | Same scratch method, head `live.test.ts`                                      | TEMP root empty                                                                                  | PASS            |
| F1      | Maintained focused suites at the head                                         | 104 passed, 5 skipped; TEMP clean                                                                | PASS            |

Prettier, `git diff --check`, lint and typecheck passed at the head.

For Q07 and Q08, the driver missed the holder's late pid file, so the QA agent removed those two case roots by hand after confirming the holders had ended. The product results are unaffected.

## Not established

- **Package coverage at the merged head was not run locally.** The QA lock wait timed out ([C1](raw/independent-rq-01/runs/C1-coverage-head.log.txt)). Coverage stands at `49b29cfe`, and every `adapter-codex` file is byte-identical at the head. Hosted CI provides head coverage.
- **The real installed Codex CLI was not run.** The unconfirmed path used a fake CLI whose detached grandchild keeps the pipes. Q06 suggests the bundled launcher's non-detached child ends with its parent on Windows. The mechanism and the native binary's behaviour are not established.
- **The maintained tests cover the unconfirmed paths only with controlled runner results.** The native unconfirmed cases (Q05, L2–L4) are QA evidence, not maintained tests.
- **The enabled #511 lifecycle is covered only by the maintained `live-collection.test.ts`.** No real `LIVE=1` run was made.
- **Only Windows was exercised.**
- **Failure frequency with real CLIs is not established.** An unconfirmed check leaves its probe directory permanently, by contract.

## Remaining gates

The targeted opposite-family re-review of `babb335c..49b29cfe` and the fresh Astra MAX final audit are pending until 2026-11-28. Current-head CI follows publication. Owner acceptance is separate.

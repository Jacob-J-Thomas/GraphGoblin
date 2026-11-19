# PR #505 F1 correction: the #466 lifecycle regression cases own their real outer lifecycle

Implementer: Claude Code, Claude Opus 5.5 (`claude-opus-5-5`), xhigh effort. Worktree
`C:/Users/98jak/.codex/worktrees/gg-20261117-probe-466/GraphGoblin`, branch
`codex/gg-20261117-probe-466`, HEAD `eb54ce9acab70f75b6ee84e2c5813920be7a2ce9`, base main
`6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1`. The change is **uncommitted and unstaged**. I made no commit,
stage, push, stash, remote write, issue change or subordinate agent. Windows 11 Pro 26300, project Node
v22.23.4, pnpm 12.8.1, Vitest 5.0.3 (runner chunk SHA-256 `950469eb…7769717`, unchanged).

Finding addressed: [formal scan 1, F1 `probe-lifecycle/outer-test-timeout-unowned`](../pr505-formal-01/README.md).
That packet was only read. Its 33 files are byte-identical before and after this work
([before](01-reviewer-packet-before.sha256), [after](09-reviewer-packet-after.sha256)), and its own
`SHA256SUMS.txt` still verifies 32/32.

## Summary

The five lifecycle regression cases (two `it.for` rows, the ordinary case and two more `it.for` rows)
drove a probe case through a controlled `CaseLifecycle` that was not connected to their own Vitest case.
On a real timeout of the enclosing case, Vitest started the next case while the old body still held
the TEMP/TMP/TMPDIR stubs, the case root, an injected `rm` fault and late calls on the cleared mocks.
The same happened after an early assertion failure, because the controlled finish hooks never ran at all.

The correction keeps the controlled lifecycle and every existing assertion, and makes the enclosing
Vitest case own it, the same way `probeCase` owns a probe case:

- `controlledLifecycle(enclosing)`: the enclosing Vitest signal's abort also aborts the controlled one,
  so the fake CLI runner starts nothing more and `runCli` kills a running fake CLI. `finish()` runs the
  controlled hooks once. `settle()` abandons and finishes the controlled case if the test has not
  finished it. It never rejects, and it returns the errors of a finish the test did not see.
- `lifecycleTest(test)`: registers an `onTestFinished` hook on the **real** test context. The hook waits
  for the whole test body, including its `finally` cleanup, and then calls `settle()`. It reports two
  kinds of failure: a body failure that came after the real abort (the same rule as `probeCase`), and
  the controlled-finish errors the body never saw. More than one is reported as an `AggregateError`,
  whose members Vitest reports separately.
- The double-fault case's `finally` first `await lifecycle.settle()`. Only then does it restore its
  `rm` fault and remove the root that the fault preserved. This holds even after an early failure.
- The four original public cases, the fake CLI runner, production code, configuration, timeouts,
  retries and coverage settings are unchanged. One sentence was added to
  `docs/10-testing-and-quality.md`. CHANGELOG is unchanged, and its existing claim now holds for every
  maintained case.

Whitespace-insensitive delta: +69/−15 in two files. Most of the plain diff (+167/−113) is the
re-indentation of the wrapped bodies. See [diff](final-vs-eb54ce9a.diff) and
[`-w` diff](final-vs-eb54ce9a.ignore-whitespace.diff).

## Source hashes (SHA-256)

| File                                                        | Original (eb54ce9a)                                                | Final                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `packages/adapter-codex/src/probe-directory.test.ts`        | `9d952d1cd6d731e223cc47ac53ec5e40b89db3ddf90f8f4ca983ac1f30b8ec5a` | `e211bfdc49b1a465e4b1b0d997f028005112d003282417c7286172f928e15e75` |
| `docs/10-testing-and-quality.md`                            | `c7add5fd4becd4ca074560accf79c8b961698686bf507a60ce42da7d99ed5676` | `13be1376095cc55c132514b0e5cce403206447afee2b42a0afa8477a84751111` |
| `CHANGELOG.md`                                              | `82d99fdc…7799cd`                                                  | unchanged                                                          |
| `cli.ts` / `harness.ts` / `index.ts` / `readiness-cli.mjs`  | `5afe5319…` / `a1738844…` / `9c7bc1e6…` / `233f6e5e…`              | unchanged                                                          |
| adapter `vitest.config.ts`, `package.json`, shared config, lock | see [pre-state](00-pre-state.txt)                              | unchanged ([final state](10-final-state.txt))                      |

An interim version, `c42d47e2…`, was used by the three `corrected-*` witness runs. It differs from the
final file only in the `lifecycleTest` doc comment and in how the hook assembles and labels its
failures. [Interim → final diff](sources/interim-vs-final.diff). The interim bytes were reconstructed
from the final file by [script](sources/reconstruct-interim.mjs), which checks that hash. All three
witness scenarios were then rerun against the final bytes (`final-*`). Copies:
[original](sources/original-eb54ce9a-probe-directory.test.ts.txt),
[interim](sources/interim-c42d47e2-probe-directory.test.ts.txt),
[final](sources/final-probe-directory.test.ts.txt).

## Regression evidence: external real-Vitest witness

The [generator](witness/generate-witness.mjs) generalises the reviewer's
[original generator](witness/reviewer-generate-outer-timeout-witness.mjs.txt)
([delta](witness/reviewer-vs-author-generator.diff)). It copies verbatim:

- the helper and fixture prefix;
- the lifecycle definitions, including the new ownership mechanism and its wiring to the real context;
- one maintained case.

It adds only observation lines: it exposes the case's `seen`, records inner and outer body settlement,
and registers an observation-only finish hook from `beforeEach`. Vitest runs that hook after the
case's own hook.

The witness applies one boundary fault to the first real `readdir`:

- `hold`: as the reviewer did, wait for the actual outer Vitest abort plus 650 ms.
- `reject`: an injected error, with no timeout.

A successor case records its facts **before awaiting anything**, waits a 1.5 s quiet window, then
records again. `afterAll` waits for a late predecessor and removes any leftovers by exact path.

No timeout, hook timeout or retry is configured. A `testNamePattern` selects the target row and the
successor. The original case extraction (`6d6cc4fd…`) is byte-identical to the reviewer's. The
extracted case bytes are identical between the interim and final runs; only the definitions differ.

Successor expectations: prior outer body finished, inner probe body settled, finish hooks done, root
absent, no TEMP/TMP/TMPDIR left at the old root and all three equal to their original values, no
running owned fake CLI, zero calls on the mocked `mkdtemp`/`mkdir`/`readdir`/`rm`/`spawn` at start and
after the quiet window, and the `rm` mock implementation back at its module-load baseline.

| Scenario (boundary)                                         | Original `9d952d1c` (should fail)                                                                                                                                                                                                                                                                          | Final `e211bfdc` (successor should pass)                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ordinary failure case, real timeout (`hold`)                | Abort 5018 ms. **Successor 5028 ms**: outer body unfinished, inner unsettled, root present, all three TEMP vars at the old root. Late `readdir`×3, `rm`×2, `spawn`×4 landed in the successor's quiet window. Old body finished 6036 ms. Reported: timeout; successor failed. Exit 1. [events](witness/runs/original-ordinary-timeout/events.jsonl), [log](witness/runs/original-ordinary-timeout/vitest.log) | Abort 5020 ms. Read released 5686 ms. Inner settled 5691, outer body 5693, finish hooks 5699. **Successor 5701 ms: all clean**, and still clean after the quiet window. Reported: **timeout** + `expected [] to have a length of 4 but got +0` (late body failure). Successor passed. Exit 1. [events](witness/runs/final-ordinary-timeout/events.jsonl), [log](witness/runs/final-ordinary-timeout/vitest.log) |
| double-fault "without an abort" row, real timeout (`hold`)  | Abort 5031 ms. **Successor 5036 ms**: outer body unfinished, root present, all three TEMP vars at the old root, **injected `rm` EBUSY fault still installed**. Late `readdir`×3 and `spawn`×4 in the quiet window. Reported: timeout; successor failed. Exit 1. [events](witness/runs/original-double-fault-timeout/events.jsonl), [log](witness/runs/original-double-fault-timeout/vitest.log) | Abort 5031 ms. Read released 5692 ms. Inner settled 5696, outer body (including fault restoration) 5698, hooks 5703. **Successor 5705 ms: all clean**, `rm` at baseline. Reported: **timeout**, `expected true to be false`, `Body failure without an abort`, `Case root removal failure` (four distinct errors). Successor passed. Exit 1. [events](witness/runs/final-double-fault-timeout/events.jsonl), [log](witness/runs/final-double-fault-timeout/vitest.log) |
| abandoned "while a fake CLI runs" row, early assertion (`reject`) | Early failure `expected false to be true` at about 28 ms. The controlled hooks never ran. **Successor 36 ms**: root present and all three TEMP vars at the old root, **still so after the quiet window**. `afterAll` had to remove the root and unstub the environment. The inner failure was never reported. Exit 1. [events](witness/runs/original-early-assertion/events.jsonl), [log](witness/runs/original-early-assertion/vitest.log) | Early failure at 23 ms. Hooks done 34 ms. **Successor 36 ms: all clean**, and the witness needed no cleanup. Reported: `expected false to be true` plus the previously dropped inner failure `expected { state: 'unknown', ok: false, …(1) } to match object { state: 'ready', ok: true }`. Successor passed. Exit 1. [events](witness/runs/final-early-assertion/events.jsonl), [log](witness/runs/final-early-assertion/vitest.log) |

The interim `corrected-*` runs gave the same outcomes, with successors at 5699, 5691 and 38 ms.
Every run's [receipt](witness/runs/final-ordinary-timeout/receipt.txt) records the command, exit
code, times and source hash. Each run used its own private TEMP root, which was empty afterwards and
then removed. After every run, `processes-after.txt` lists no `node.exe` process running
`readiness-cli.mjs`. The first run (`original-ordinary-timeout`) used runner v1, whose query matched
only its own PowerShell process. Later runs filter to `node.exe`
([v1 copy](witness/run-witness.v1-used-for-original-ordinary-timeout.sh.txt),
[delta](witness/run-witness.v1-to-v2.diff)).

**Why the errors after a timeout changed (expected).** The propagated abort makes the fake runner's
`throwIfAborted()` stop before starting a fake CLI after the real deadline. Preflight then fails
closed, so the late outer body fails an assertion that assumed four fake CLIs ran. The hook reports
that failure with the timeout. Previously the late body silently started four fake CLIs during the
successor.

In the double-fault row, the propagated abort resolves the case's race on the controlled signal, so
`expect(signal.aborted).toBe(false)` fails after the abort. The `finally` then settles the controlled
case (late body failure plus EBUSY), restores the fault and removes the root. The timeout is still
reported first in every timeout scenario.

## Maintained gates (final source `e211bfdc`, one run each, private TEMP)

| Log                                          | Command (from the worktree, Node v22.23.4 first on PATH)                                       | Result                                                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [02-focused](logs/02-focused.log)            | `pnpm.cmd --filter @graphgoblin/adapter-codex test src/probe-directory.test.ts --reporter=verbose` | 9/9 passed, exit 0                                                                                           |
| [03-typecheck](logs/03-typecheck.log)        | `pnpm.cmd typecheck --filter=@graphgoblin/adapter-codex`                                       | 4/4 tasks, 0 cached, exit 0                                                                                  |
| [04-lint](logs/04-lint.log)                  | `pnpm.cmd lint --filter=@graphgoblin/adapter-codex`                                            | exit 0                                                                                                       |
| [05-format-check](logs/05-format-check.log)  | `pnpm.cmd format:check` (whole repository)                                                     | exit 0                                                                                                       |
| [06-adapter-coverage](logs/06-adapter-coverage.log) | `pnpm.cmd test:coverage --filter=@graphgoblin/adapter-codex`                            | 647 passed / 4 skipped; statements 98.3%, branches 95.61%, functions 99.32%, lines 99.42%; cache miss; exit 0 |

Witness commands: `bash witness/run-witness.sh <original|corrected|final> <scenario> <source> <sha256>`.
The runner generates the witness with `wx` and refuses to overwrite. It then runs
`pnpm.cmd --filter @graphgoblin/adapter-codex exec vitest run --config <run>/vitest.config.mjs --reporter=verbose`
from the worktree, with TEMP/TMP/TMPDIR set to a private root. Each run took about 7 to 11 s. Each
exits 1 by design, because the first case fails deliberately. The meaningful result is the successor's
verdict and the events.

The full repository suite was not rerun: the change is test-local to one file plus one documentation
sentence. The coverage run includes the pre-existing `cli.test.ts` case, which runs the installed
Codex CLI for version, help and login status only. It makes no model request.

## Cleanup

- The gates' private TEMP held exactly the three known items, the same as in the prior correction
  evidence: one `gg-codex-probe-*` from the known `cli.test.ts` Windows race (#506 territory), one
  `graphgoblin-live-*` from `live.test.ts` module load, and `node-compile-cache`. It had 0 reparse
  points and was removed by exact path. No fake CLI process remained
  ([07-cleanup](logs/07-cleanup.txt)).
- The empty private TEMP root of my first, unlogged dev focused run (9/9) was removed by exact path.
  `%TEMP%\gg-codex-isolation-YibZTX` (born 2026-11-15) is foreign and was left untouched
  ([08](logs/08-dev-temp-and-foreign.txt)). A scratch dry-run folder of generated witnesses, used to
  inspect the extraction before the real runs, was removed by exact path.
- Owner checkout, stores, ports 4747/4748, other worktrees, `docs/qa/` packets and the reviewer packet
  were not touched. `git status` shows only the two modified files; the staged set is empty
  ([final state](10-final-state.txt)).

## Decisions and alternatives

1. **The enclosing case owns the controlled one through the real `onTestFinished`, as in `probeCase`.**
   This reuses the runner semantics the PR already depends on: hooks run after the abandoned body, before
   the successor, under the unchanged 10 s hook timeout.
   Rejected alternatives:
   - Awaiting only the inner probe `run`: the outer body's trailing assertions, `leftAtFinish` reads,
     fault restoration and root removal would still run during the successor.
   - Restoring the environment early, or enabling `unstubEnvs`: this changes shared configuration and
     stops neither the late calls nor the root and fault leaks.
   - Higher timeouts or retries: prohibited, and they would hide the defect.
   - Dropping the controlled lifecycle: the cases need to control when abandonment happens and to
     observe the finish result.
   - Registering outer cleanup as extra real hooks: stack order would run it before settlement.
   - Moving the cases into another file or process: larger, with no added guarantee.
2. **Abort propagation.** In the `hang` scenario only an abort ends the fake CLI. Without propagation,
   settlement after a real deadline would depend on the 15 s preflight CLI timeout. That exceeds the
   10 s hook timeout, so the successor could again start with live work. I used an explicit listener on
   Vitest's signal rather than `AbortSignal.any`, which keeps a plain strong reference with no
   composite-signal GC questions. The cost is the changed late error explained above, which is still
   reported.
3. **Memoised `finish`, and `settle()` that reports only unseen errors.** This keeps "reported once":
   a body that awaited and asserted its finish result is not reported again. An early exit does not drop
   the inner body's failure or a cleanup failure, which the original dropped silently in the
   early-assertion witness. `settle()` never rejects, so the body's own early failure is never masked.
   The hook builds a new failure array rather than mutating an inner `AggregateError`'s `errors` (fixed
   between the interim and final versions).
4. **The double-fault `finally` settles first.** The `rm` fault is restored, and the root it preserved
   removed, only after the controlled case and its processes have settled.
5. **Scope of evidence.** I added no maintained self-tests for `lifecycleTest`: testing it in-suite would
   need yet another controlled level, which is the framework creep the brief warns against. Real-Vitest
   external witnesses exercise its actual purpose and fail against the original. Three scenarios cover
   real abandonment, fault restoration plus an early assertion after the abort, and an early assertion
   with no timeout.
6. **Documentation.** One sentence in `docs/10` describes the lifecycle cases' ownership. QA packets
   under `docs/qa/`, the QA index and CHANGELOG are left for root publication.

## Residual limits

- Settlement is bounded by Vitest's unchanged 10 s hook timeout, which is the same limit as `probeCase`.
  A body or controlled case that does not settle within it would get a reported hook timeout, and the
  successor could still start. Examples: a process that ignores the kill, or a filesystem stall longer
  than 10 s.
- One run per scenario, on Windows 11 with Node 22.23.4 and Vitest 5.0.3. Not covered: Linux or macOS,
  a cancelled run (Ctrl-C or bail aborts the same context signal through `withCancel`; checked by code
  reading only), and stability sampling.
- No witness has a `hang` fake CLI running at the instant of the real abort. The maintained cases
  abandon synchronously at that spawn, so the state never arises. Propagation kills a running fake CLI
  through the same `runCli` signal path that the maintained simulated-abandonment rows exercise.
- `rmImplementationIsBaseline` compares `getMockImplementation()` identity with the module-load
  baseline. It detects the injected fault, but not every conceivable mock mutation.
- Current-head CI, separate independent QA, the targeted delta re-review and the reserved final audit
  are pending. #503 and #506 are unaffected.

## Handoff for independent QA and targeted re-review

- Review target: the uncommitted delta in this worktree. In
  `packages/adapter-codex/src/probe-directory.test.ts`, that is lines 213–281: `controlledLifecycle`
  (218) and `lifecycleTest` (261). It also covers the three wrapped cases (322, 365, 391) and the
  double-fault `finally` (`settle()` at 443). In `docs/10-testing-and-quality.md`, it is line 81.
- Suggested QA:
  - Copy `witness/generate-witness.mjs` and `run-witness.sh` into a fresh sibling folder, change `E`
    and the run names, bind to `e211bfdc…`, and replay the three scenarios.
  - Optionally add an independent scenario, for example holding a later `readdir`, or a cancelled run.
  - Rerun the reviewer's original generator against the final file. It will refuse, because it binds
    the old hash; adapt it only as described in its own REPRODUCE.md.
  - Re-check the earlier initial and final QA criteria: the default-timeout helper, and the separately
    reported body and removal errors.
- Expected invariants: the first case still reports its timeout or early failure; the successor
  passes; no late mock calls; TEMP/TMP/TMPDIR restored; root absent; no owned fake CLI; the `rm` fault
  restored before the successor; the maintained suite 9/9.

## Files

`00-pre-state.txt`, `01-`/`09-reviewer-packet-*.sha256`, `10-final-state.txt`, the two diffs, `logs/`
(gates, cleanup and owned TEMP), `sources/` (original, interim and final copies, the reconstruction
script and the interim diff), and `witness/` (generator, runner, reviewer generator copy and deltas,
and the nine run folders, each with `witness.test.ts`, `vitest.config.mjs`, `generation.json`,
`events.jsonl`, `vitest.log`, `receipt.txt`, `processes-after.txt`, `temp-after.txt` and Vitest's
cache `results.json`). [SHA256SUMS.txt](SHA256SUMS.txt) covers every other file.

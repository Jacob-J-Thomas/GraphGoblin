# Web test stability: audit follow-up

Base/head: `67c8408839d6990f4739257e036e0483a5e0d7d2`, branch
`codex-chore-web-test-stability`, Node 22.14.0, Windows, 12 logical processors.
This record supersedes the round 1 stability conclusion in [after.md](after.md).
Work remains uncommitted for the orchestrator. Production source, Vitest
configuration, coverage policy and the global 20-second test timeout stay unchanged.

## Before: evidence and reproductions

The independent audit's first loaded run failed **2 tests / 116 files**, with
1472 tests passing, in **420.69 seconds**. Its retained transcript is
[audit-verified-parallel-1.log.txt](audit-verified-parallel-1.log.txt):

```text
FAIL src/editor/EditorPage.test.tsx > EditorPage > describes valid pending JSON accurately and refuses Publish until applied or cancelled
TestingLibraryElementError: Unable to find an element with the text: Ready to publish.
FAIL src/settings/sections/ClassifierModelsSection.test.tsx > ClassifierModelsSection > adds a custom classifier that starts disabled, after the contract checks pass
Error: Test timed out in 20000ms.
```

The audit measured the classifier at **20,020 ms**. This thread's unchanged
loaded parallel runs passed it at **6,722 / 10,444 ms**, and the editor case at
**3,349 / 5,419 ms**. The deadline failure was not reproduced in those runs;
their passes do not invalidate the independent failure on this same head.

A controlled initial GET response delayed by 1.5 seconds passed the old editor
test. A 6-second response then reproduced `Unable to find … Ready to publish`,
with **Loading loop…** still visible. This is an injected API-latency probe,
separate from the CPU-loaded matrix; production was never edited.

The audit's zero-delay announcement mutation passed **all 28 original changed
cron tests**, reproduced here in **65.51 seconds**. The strengthened test rejects
it in **14.82 seconds**:

```text
Expected: "Every day at 09:00, UTC. Upcoming runs ready."
Received: "Custom expression: 0 9 * * * · UTC. Upcoming runs ready."
Tests 1 failed | 27 skipped (28)
```

The same strengthened test passed unchanged production in **30.61 seconds**.
These first strength checks used a temporary Vite source overlay. The actual
test files were edited only after all three had completed in the baseline serial run.

[audit-static-audit.json](audit-static-audit.json) identifies **22 references**
without committed artifacts. The original reference checker returned `2 files,
8 citations, 0 missing`: its filename grammar missed the temporary-path and
brace-group references. The audit's explicit list established this gap.

The byte-preservation probe formatted compact JSON with a QA filename before
the ignore change: `ignored: false`, source SHA-256
`d456dc45dd728d6177aa9bf89aa50ba68625e3a5cde2fa7b697c655ce2eb08d9`,
formatted SHA-256
`c56a0573f4a917049ef3673fdbfe347b94e369c05f1cd19103c0c30601f0f601`.
After the change it reports `ignored: true`, identical source/output hashes.
No existing evidence was reformatted back to an older representation.

## Evidence retention

All 22 references now resolve beside the original documents, with transcripts
named using the .log.txt extension. [evidence-provenance.json](evidence-provenance.json)
records original and retained hashes. Redaction removes the local user-directory
prefix and username in both UTF-8 and UTF-16LE, including wrapped PowerShell
paths. Otherwise the raw bytes, including the baseline log's mixed encoding,
are retained. The removed disposable browser config is explicitly identified
as reconstructed from [gg-chore-web-browser.cjs](gg-chore-web-browser.cjs),
rather than claimed as an original captured file.

The formatter ignores raw JSON, YAML and JavaScript/TypeScript artifacts under
QA; Markdown remains formatted. The retention rule is documented in
docs/15-issue-workflow.md under QA scope.

## Changes and sequencing

The classifier's six strings contain 82 characters: six awaited pastes replace
82 individual input events. [Fixture work record](gg-chore-web-round2-fixture-work.log.txt).

| Finding                      | Cause and correction                                                                                                                                                                                  | Ordering and limits                                                                                                                                                                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Classifier creation deadline | Six fixture strings drove character-by-character form changes. Paste each complete value through the existing public user fixture.                                                                    | Every paste is awaited. Empty-field, duplicate-ID, endpoint and capability validation, request body, disabled default and focus assertions remain. No keyboard behavior was replaced in a keyboard test.                                                        |
| Initial editor readiness     | The validation observation window included asynchronous loop/device loading. Await removal of the public **Loading loop…** element before the existing **Ready to publish** observation.              | Loading has a 10-second observation window inside the unchanged 20-second test deadline; server validation keeps its existing 5-second observation. No sleep or API response assumption appears in the actual test.                                             |
| Cron announcement debounce   | The old test never yielded fake time between edits. Advance to t=100, edit `b`, hold through t=449, edit `broken`, pass the cancelled old deadline at t=450, hold through t=798, and settle at t=799. | Both 349 ms boundaries preserve the original announcement; the second edit restarts the 350 ms debounce. Each timer advance runs inside awaited `act`; `finally` restores real timers.                                                                          |
| Evidence references          | Temporary paths and grouped filenames did not resolve to committed artifacts. Retain every referenced artifact, use explicit links, and record hashes/redactions.                                     | Original and retained hashes distinguish redaction from formatter mutation. The browser configuration's reconstruction is explicit.                                                                                                                             |
| Formatter byte fidelity      | Prettier treats its ignore file as gitignore syntax, which does not expand braces. Enumerate JSON, YAML and each requested script extension.                                                          | The first formatter probe caught five newly retained script/config copies changing; those new copies were restored from their original sources. A second full formatter cycle preserved all 317 snapshotted raw QA artifacts. No pre-existing evidence changed. |

The assertion audit retained **522/522** original assertion calls across the three
changed test files and added four cron assertions. No declaration or parameter
was removed. The actual final cron test rejected the zero-delay mutation; the
actual editor test passed the same 6-second injected response that failed before.
The three edited cases passed together against normal production code.

## Final verification

The baseline matrix's three target files all completed unchanged before their
edits; the remaining files continued unchanged. That diagnostic serial run is
not counted among the final gates. Its parallel runs also overlapped the
controlled probes; the final matrix runs without overlapping diagnostics.

Every full invocation uses Node 22.14.0, default Vitest parallelism unless marked
serial, three continuously busy worker threads, and zero retries. The retained
[auditor runner](round2-after/run-matrix.cjs) is unchanged; it runs two parallel
invocations and one serial invocation. [The additional runner](round2-after/additional-parallel.cjs)
uses the same body for the required third parallel invocation, with separate
result filenames. No whole-suite failure is discarded or retried.

The baseline diagnostics all passed, including coverage:

| Baseline invocation | Tests | Vitest duration | Wall seconds | Classifier ms | Readiness ms | Cron ms | Transcript                                       |
| ------------------- | ----: | --------------: | -----------: | ------------: | -----------: | ------: | ------------------------------------------------ |
| Parallel 1          |  1474 |        293.16 s |      295.400 |          6722 |         3349 |    1676 | [log](round2-before/verified-parallel-1.log.txt) |
| Parallel 2          |  1474 |        483.68 s |      486.603 |         10444 |         5419 |    1145 | [log](round2-before/verified-parallel-2.log.txt) |
| Serial              |  1474 |       1853.31 s |     1857.190 |          2664 |         1571 |     593 | [log](round2-before/verified-serial.log.txt)     |

All four final invocations passed **116 files / 1474 tests**, with **coverage
emitted**, **zero retries** and **zero timeouts**. They ran in the order below:

| Final invocation          | Vitest duration | Wall seconds | Load CPU seconds | Coverage L / B / S / F (%)    | Transcript                                      |
| ------------------------- | --------------: | -----------: | ---------------: | ----------------------------- | ----------------------------------------------- |
| Parallel 1                |        307.63 s |      311.506 |          771.673 | 98.95 / 94.84 / 98.02 / 98.49 | [log](round2-after/verified-parallel-1.log.txt) |
| Parallel 2                |        318.88 s |      324.033 |          748.548 | 98.93 / 94.87 / 98.02 / 98.49 | [log](round2-after/verified-parallel-2.log.txt) |
| Serial (`--maxWorkers=1`) |       1682.15 s |     1693.359 |         4340.781 | 98.93 / 94.84 / 98.03 / 98.49 | [log](round2-after/verified-serial.log.txt)     |
| Parallel 3                |        240.68 s |      243.903 |          597.609 | 98.93 / 94.84 / 98.03 / 98.49 | [log](round2-after/verified-parallel-3.log.txt) |

The three load threads are ready before pnpm starts and terminate in the
runner's awaited `finally`; the 45-minute abandonment bound never fired. The
recorded CPU consumption measures their native load. The two retained results
files preserve all invocations: [auditor matrix](round2-after/verified-matrix-results.json)
and [additional parallel result](round2-after/additional-matrix-results.json).

Individual case times are milliseconds. The original classifier deadline remains
an independent audit reproduction; this thread's local before runs passed it.

| Case                     | Auditor before                               | Local before parallel 1 / parallel 2 / serial | After parallel 1 / parallel 2 / parallel 3 / serial |
| ------------------------ | -------------------------------------------- | --------------------------------------------- | --------------------------------------------------- |
| Classifier creation      | 20,020, timeout                              | 6722 / 10444 / 2664                           | 3025 / 4447 / 3140 / 1572                           |
| Initial editor readiness | Ready observation failed                     | 3349 / 5419 / 1571                            | 2848 / 2521 / 2485 / 1545                           |
| Cron announcement        | Zero-delay mutation escaped all 28 old tests | 1676 / 1145 / 593                             | 1049 / 1023 / 864 / 591                             |

## Probe ledger

All focused unselected cases are CLI filtering, with no skipped test declarations.
The full matrix retains all 1474 cases. Expected mutation failures below are
successful rejection evidence, not passing production test invocations.

| Invocation                                       | Result                                                                                                                                                               | Transcript                                                            |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Initial temporary-config startup                 | Failed before tests: Vite attempted its bundle cache outside the writable worktree (`EPERM`). Move the disposable config into the web package; no permission change. | [startup](gg-chore-web-round2-status-before.log.txt)                  |
| Original 28 cron tests, zero-delay mutation      | 28 passed, 65.51 s: the missing announcement guard is reproduced.                                                                                                    | [old mutation](gg-chore-web-round2-status-before-repaired.log.txt)    |
| Original readiness case, 1.5 s injected response | 1 passed, 30.93 s: negative probe.                                                                                                                                   | [short response](gg-chore-web-round2-readiness-before.log.txt)        |
| Original readiness case, 6 s injected response   | 1 failed, 124.33 s: Ready absent while Loading loop remains.                                                                                                         | [before](gg-chore-web-round2-readiness-before-6s.log.txt)             |
| Strengthened overlay, mutation                   | 1 failed as expected, 14.82 s.                                                                                                                                       | [overlay rejection](gg-chore-web-round2-status-mutant-strong.log.txt) |
| Strengthened overlay, unchanged production       | 1 passed, 30.61 s.                                                                                                                                                   | [overlay normal](gg-chore-web-round2-status-normal-strong.log.txt)    |
| Actual edited cron case, mutation                | 1 failed as expected, 31.94 s, with the quoted prior/early-announcement mismatch above.                                                                              | [final rejection](gg-chore-web-round2-status-final-mutant.log.txt)    |
| Actual edited readiness case, same 6 s response  | 1 passed, 27.64 s.                                                                                                                                                   | [after](gg-chore-web-round2-readiness-after-6s.log.txt)               |
| Actual three edited cases, unchanged production  | 3 passed, 20.33 s.                                                                                                                                                   | [normal focused](gg-chore-web-round2-focused-final.log.txt)           |

The mutation is applied through the standalone [Vite probe configuration](round2-status.config.mjs)
to the module loaded by that probe. Production files never change. Copy this
configuration into the web package to resolve its relative base import. Set
`GG_CRON_MUTATION=1`, `GG_STRENGTHEN=0` to test the actual final cron case.
The historical [overlay generator](round2-strengthen.cjs) applies only to the
old `67c84088` test. The [latency probe](round2-readiness.config.mjs) injects the
public FakeApi GET response; its base-import user-directory prefix is redacted.

## Files and shared ranges

Ranges below refer to the resulting worktree; no product file or existing
Vitest configuration changes.

| File                                                            | Lines                        | Scope                                                                    |
| --------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------ |
| apps/web/src/editor/EditorPage.test.tsx                         | 2–9, 63–65                   | Public loading-state observation, existing readiness assertion retained. |
| apps/web/src/settings/sections/ClassifierModelsSection.test.tsx | 12, 171–186                  | Batched fixture strings, every validation and focus assertion retained.  |
| apps/web/src/forms/cron/control.test.tsx                        | 382–401                      | Positive fake-time advances and debounce restart/boundary assertions.    |
| .prettierignore                                                 | 13–23                        | Shared root file: explicit raw QA evidence extension patterns.           |
| docs/15-issue-workflow.md                                       | 34–35                        | Shared workflow: additive evidence-retention sentence only.              |
| docs/qa/2026-10-22-web-test-stability/before.md and after.md    | Intro and artifact citations | Historical scope marked, all 22 original references retained and linked. |
| This record, manifests, probe scripts/configs and transcripts   | New evidence                 | Original/redacted hashes and complete matrix/probe evidence.             |

[The tested-source record](round2-after/tested-sources.json) binds the three test
files, existing paste fixture, production components and Vitest configurations
to their raw SHA-256 and Git blob hashes. The pre-matrix formatter left all nine
unchanged, and preserved all 320 raw QA artifacts then present. Earlier byte
checks and the extension probe are retained:
[317 unchanged](gg-chore-web-round2-bytes-expanded.log.txt),
[320 unchanged](gg-chore-web-round2-bytes-pre-matrix.log.txt),
[extensions](gg-chore-web-round2-byte-extensions.log.txt),
[assertions](gg-chore-web-round2-assertions.log.txt).

## Gates and remaining handoff

Pre-matrix Node 22 gates passed: typecheck, lint, format, format-check,
check-docs, layers, dependencies, tokens and build. Dependency checking has the
existing no-orphans warning for packages/infrastructure/drizzle.config.ts.
The built app passed 25 editor-modal, trigger-types and undo browser tests with
zero retries on ports 5770/5771; [browser transcript](gg-chore-web-round2-browser.log.txt).

The additional full classifier/cron browser invocation initially passed 14/15
cases, then exhausted the eight reserved extra ports before binding the fifth
classifier API. Its trace records `500: Error: Reserved test port range exhausted`
on the control `/apps` request, before the UI was reached. This was a disposable
fixture allocation defect, not a reproduced product race. Retained evidence:
[failed run](gg-chore-web-round2-browser-extra.log.txt),
[native response extracted from its trace](gg-chore-web-round2-browser-first-control.log.txt),
[original fixture generator](browser-extra-first/generator.cjs).

The corrected fixture closes the previous extra API and local classifier endpoint
before creating the next serial case's instances, keeping main/control on 5770/5771
and extra listeners within 5772–5779. The base browser configuration already runs
one worker; the disposable configuration makes that explicit. No assertion or case
was filtered or changed. The same two complete files then passed **15/15**, **51.0 s**,
zero retries: [bounded run](gg-chore-web-round2-browser-extra-bounded.log.txt).
The corrected run uses a separate results directory, preserving the failed run's
temporary trace. Its actual generated [configuration](gg-chore-web-extra.config.ts)
and [generator](round2-browser-extra.cjs) are retained. All four disposable app-side
files were removed before the final static gates. Total successful browser
qualification is **25 + 15 cases**; the earlier 14/15 failure remains recorded.

Final Node 22 gates all passed with the retained raw artifacts present:

| Command                 | Result                                | Transcript                                                 |
| ----------------------- | ------------------------------------- | ---------------------------------------------------------- |
| `pnpm.cmd typecheck`    | Pass, 22.746 s                        | [log](gg-chore-web-round2-gate-final-typecheck.log.txt)    |
| `pnpm.cmd lint`         | Pass, 42.626 s                        | [log](gg-chore-web-round2-gate-final-lint.log.txt)         |
| `pnpm.cmd format`       | Pass, 29.287 s                        | [log](gg-chore-web-round2-gate-final-format.log.txt)       |
| `pnpm.cmd format:check` | Pass, 37.440 s                        | [log](gg-chore-web-round2-gate-final-format-check.log.txt) |
| `pnpm.cmd check:docs`   | Pass, 1.543 s                         | [log](gg-chore-web-round2-gate-final-check-docs.log.txt)   |
| `pnpm.cmd check:layers` | Pass, 0.254 s                         | [log](gg-chore-web-round2-gate-final-check-layers.log.txt) |
| `pnpm.cmd check:deps`   | Pass, 17.626 s; existing warning only | [log](gg-chore-web-round2-gate-final-check-deps.log.txt)   |
| `pnpm.cmd check:tokens` | Pass, 3.352 s                         | [log](gg-chore-web-round2-gate-final-check-tokens.log.txt) |

The full final formatter cycle preserved **360 raw QA artifacts byte-for-byte**:
[byte check](gg-chore-web-round2-bytes-final.log.txt),
[pre-format hashes](gg-chore-web-round2-hashes-final.json).
All **nine tested source/config files** also remained byte-identical:
[source check](gg-chore-web-round2-sources-final.log.txt).
The final manifests retain the original and anonymized hashes; no raw input
was reformatted back to an earlier representation. The five early restorations
were newly copied, uncommitted artifacts whose original sources were retained.

Native checks found none of the three recorded matrix parent PIDs still running.
The Windows listener-inventory API returned access denied, so a privilege-free
native TCP probe checked every harness bind address instead: all ten connections
to 127.0.0.1:5770–5779 returned `ECONNREFUSED`.
[processes](gg-chore-web-round2-native-cleanup.log.txt),
[TCP probes](gg-chore-web-round2-native-ports-tcp.log.txt),
[inventory diagnostic](gg-chore-web-round2-native-ports.log.txt).
The [worktree validation](gg-chore-web-round2-finish-validation.json) checks head,
branch, empty index, manifest hashes, anonymization and addable artifact paths.
The final external reference-checker result is **0 missing**, captured in
[its transcript](refs-check.log.txt), after all other verification commands.

The orchestrator owns committing all new evidence artifacts, Fable review and
the resumed independent audit. The local classifier deadline remains a negative
reproduction; the independent failure, local timings and work reduction are
preserved for review. No product race was established, no product or Vitest
configuration changed, and no commit, index or remote operation was performed.

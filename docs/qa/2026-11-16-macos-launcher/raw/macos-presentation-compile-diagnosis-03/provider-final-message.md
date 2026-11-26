I found one concrete source issue that fits every piece of CI evidence, but I can't prove it caused the failure. At CI head, `Tests/Presentation/Support/LiveAppKit.swift` didn't import `Testing`. Yet it calls Harness's `waitUntil(...)` three times, relying on the default `sourceLocation: SourceLocation = #_sourceLocation`. The smallest fix is a one-line `import Testing`, and that line appeared in this worktree while I was reading. I made no edits, ran no commands, had no Mac access, didn't touch the review budget, and have not compiled anything.

## What the CI07 evidence establishes

**Read directly from the receipts:**
- **Batch split:** the 20 Presentation test files were compiled in three batches of 7, 7 and 6 (three groups of "began" lines in `swift-tests.stderr`: lines 89–95, 96–102 and 118–123). The seven missing objects are exactly the middle batch, files 8–14 in source order (the primaries are listed in the diagnostic stdout, lines 20–26).
- **Module emission passed:** the presentation module was emitted, which checks declarations but skips function bodies. The other two batches compiled with these seven files present but not as primaries, so their function bodies were never checked there.
- **Serial replay was fast:** the diagnostic build started about 17 ms after `finishedAt` 803.620 (its 147,983 ms timeout implies this), and the report scan ran at 809.708. So the whole serial build took at most about 6.1 s and failed quickly.
- **History:**
  - CI03 (`635a637`) passed without the five new files.
  - CI04 tracked all five, but stopped at the PublisherTests error after only `Emitting module LauncherPresentationTests`.
  - CI05, CI06 and CI07 are the only runs that compiled these files as primaries, and all three failed silently.
- **Errors do normally appear:** CI04's macro-expansion error was printed normally, so ordinary type errors are not swallowed in this pipeline.

**Inferred, not verifiable here:**
- In batch mode, all primaries are type-checked before any object file is written. No object exists for any of the seven, including the first one (LiveCompositionTests). So the failure most likely happened during type-checking.
- As I understand swift-driver, a frontend that is killed or crashes produces a plain "compile command failed due to signal N" line. The driver only stays quiet when a compile job exits with status 1. No such line appeared, and no crash or Jetsam report was found. That points to a silent exit with status 1, and away from a memory kill or a crash.

## The seven sources

**LiveAppKit.swift (as I first read it):**
- It imported only AppKit, Foundation, LaunchContract and LauncherPresentation.
- `LiveHarness` calls `waitUntil` in `finishEngine`, `waitForTimer` and `showDelayedPanel`. That function is declared at `Harness.swift:92–96` with the `#_sourceLocation` default.
- Under SE-0422, that default macro is expanded at each call site, inside the caller's file. Swift Testing generates `Testing.SourceLocation.__here()`; CI04's `#require` expansion shows that form. That `#_sourceLocation` produces the same form is my understanding. `Testing` isn't visible in a file that doesn't import it.
- This is unique. All eight other callers of these helpers import `Testing`. LiveAppKit.swift's function bodies are only checked when it is a primary, which happens only in the failing batch.
- **Not explained by the source:** a correct compiler should have printed an error. A loss of that diagnostic, perhaps in how Swift-style diagnostics render this kind of expansion, is a separate, untested hypothesis.

**Everything else:** no concrete defect.
- The types, `@MainActor` protocols and APIs used by `LiveHarness` and `TerminationGuardSurface` match production code.
- `#require(keyEvent(…, flags: [.command]))` and `Mutex` both already compile elsewhere. `defer` inside an async test also compiles elsewhere.
- Novel but ordinary constructs, judged unlikely to matter:
  - `@Test` functions declared in an extension of the suite in another file.
  - The `hidePaths` array of `@MainActor () -> Void` closures.
  - FixtureChild's `withCheckedContinuation` call without a type annotation.

## Concurrent changes in this worktree

These appeared during my session; I can't confirm their commit status.
- `LiveAppKit.swift:4` now has `import Testing`. You can confirm the CI-head content with `git show 8282861:apps/macos-launcher/Tests/Presentation/Support/LiveAppKit.swift`.
- `tooling/scripts/macos-launcher-coverage.acceptance.mjs` now passes `-Xswiftc -disable-batch-mode` in both the main `swift test` (lines 522–523) and the diagnostic build (lines 400–401). The CI07 receipts show neither.

## Assessment of `-Xswiftc -disable-batch-mode`

**It is supported.** The Swift 6.1 driver lets the last of the enable/disable flags win, and SwiftPM appends `-Xswiftc` flags after its own `-enable-batch-mode`. To check it in the next receipt: both flags should appear in the module's command line, and each compiler line should have exactly one `-primary-file`.

**Gaps:**
1. **Unattempted files look like failures.** Batch mode implies `-continue-building-after-errors`; non-batch mode doesn't. With `--jobs 1`, the first failing file stops all later ones, which then show as missing objects. Add `-Xswiftc -continue-building-after-errors`.
2. **SwiftPM still hides the outcome.** It won't show a job's exit status or signal.
3. **Using it in the main test build has costs.**
   - If it lands together with the import, you can't tell which change fixed the build.
   - It adds build time inside the unchanged 270 s budget.
   - A fresh, serial, non-batch full rebuild could exceed the ~148 s diagnostic window. That's my estimate.

**Also worth adding:** `-Xswiftc -diagnostic-style=llvm`. It changes only how errors are printed (unbuffered), so it directly tests whether a diagnostic is being lost.

**A more informative alternative:** rerun only the presentation test module's compile, directly on the failed build directory.
- Take the recorded `swiftc` arguments for LauncherPresentationTests from `debug.yaml` (or line 16 of the diagnostic stdout).
- Append `-disable-batch-mode -continue-building-after-errors -diagnostic-style llvm` and use `-j1`.
- Keep `-parseable-output` and save the raw stdout/stderr. That JSON records each file's exit status or signal.
- It should only recompile the seven missing files.
- Afterwards, record the object files again, and save `debug.yaml` as an artifact; it is currently only hashed.

## Proposed next run

1. **Main test build:** keep the CI07 configuration (batch mode), with only the `import Testing` change.
2. **Failure-only diagnostics:** the probes above.

How to read the result:
- **Presentation tests compile:** the missing import was required. Record the silent failure as unexplained toolchain behaviour.
- **Still fails:** the hypothesis is rejected. The per-file results and the exit status or signal decide the next step.
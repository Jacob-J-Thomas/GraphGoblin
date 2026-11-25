I couldn't find a defect in the presentation tests, the GUI fixture or shipping presentation code that explains CI09's silent timeout. There is one real but unproven hang path in the fixture launcher, and the run most probably stalled too early for any presentation test body to be involved. I made no edits and ran no commands; the formal scan budget is untouched.

## What the artifacts show
- **Primary run:** killed at 270,000 ms (`status: null`, `SIGKILL`, `ETIMEDOUT`), with 0 bytes on stdout. The stderr log ends at line 151, `Build complete! (22.50s)`, and nothing follows it.
- **Generated runner:** the standard SwiftPM 6.1.2 Swift Testing entry point. The XCTest paths are switched off with `#if false`, which is normal on macOS.
- **Link list:** all 18 presentation test objects are linked. `PresentationFixture` is a separate signed executable and is not in the test bundle, so there are no clashing entry points.
- **Crash reports:** the collector's pattern (`macos-launcher-coverage.acceptance.mjs:238–239`) only matches compiler, linker and JetsamEvent files. So "no crash reports" doesn't rule out a crash of the test process (`swiftpm-testing-helper`, `xctest`) or of `PresentationFixture`. The 29 report entries scanned were not otherwise examined.
- **Free memory 121 MB:** Node's `freemem()` on macOS counts only completely free pages, and there was no jetsam match. This is not evidence of memory pressure.
- **CI03 baseline:** same OS (15.8.2, macos-15-arm64). An empty XCTest phase, then 105 Swift Testing tests in 0.734 s. About 380 lines (roughly 30 KB) went to SwiftPM's stdout.
- **CI04–CI08** stopped at compile errors, so CI09 is the first run of the 14 added presentation tests:
  - "Hosted GUI session gate": 1 test
  - Live AppKit windows: 4 tests, plus 5 in the `LiveCompositionTests.swift` extension
  - Composed launcher in a GUI child process: 4 tests

## Where it probably stalled (inference, not proven)
- SwiftPM passes the test process's output through `print`, which buffers when writing to a pipe. Node gives it a Unix socket pair, and on macOS I expect that buffer to be about 8 KiB (not checked on the runner).
- A run behaving like CI03 prints well over 8 KiB within a second. The "suite started" and "test started" lines alone exceed it.
- So 0 bytes most likely means the run stalled before Swift Testing printed about 8 KiB. That would be in the empty XCTest phase, during test discovery and planning, or in the first burst of test starts.

## Presentation candidates checked
- **Discovery:** none of our code runs. The new static values are plain strings and copy text with no AppKit calls.
- **`.enabled(if:)` gates:** Swift Testing evaluates these during planning, before it prints anything. They call `CGSessionCopyCurrentDictionary()` and read environment variables. The same call already gated the AppKit windows suite in CI03 on the same OS and passed. The collector passes the full environment through, so the Live and child-process suites were switched on in CI09. A hang here is not plausible.
- **AppKit and the main thread:** every AppKit-touching suite runs on the main actor, and CI03 shows the main thread works for this. The Live tests never call `run()`, `terminate` or the termination reply, and use no modal loop. A blocked main thread would only stall main-actor tests; the backend and non-main tests would keep printing.
- **Async and main-actor waits:** `waitUntil` and `drainMainActor` are capped at 5 s (`Harness.swift:91–119`). `waitUntilRunning` resumes once the engine task starts; that pattern already passed in CI03. No presentation test blocks Swift's shared async thread pool.
- **GUI child process:** its stdin is `/dev/null` and it gets its own pipes. Foundation's `Process` doesn't pass other file descriptors to the child, so it can't hold SwiftPM's or Node's pipes open. Waiting happens on GCD threads, not the shared pool. Each scenario is capped at 30 s + 5 s, except the one path below.

## Real but unproven defect
`Tests/Presentation/Support/FixtureChild.swift`:
- Lines 82–83 promise to wait "until the child has exited and both streams are closed, or the deadline passes".
- Line 135 (`exited.wait()`, after `SIGKILL`) has no timeout, and line 138 (`process.waitUntilExit()`) has none either.
- If Foundation never observes the child's exit, that test, and therefore the whole run, never finishes.
- CI09 doesn't show this branch was reached. On its own it wouldn't explain zero output, because other tests would keep printing.

Proposed correction, for a later authorised instruction:
- Change line 135 to `reaped = exited.wait(timeout: .now() + .seconds(5)) == .success`.
- If the child is not reaped, skip `waitUntilExit`, `terminationReason` and `terminationStatus` (Foundation raises an exception for a running process). Keep the process and pipes alive as lines 143–144 already do for the pipes. Return `timedOut: true, exitedNormally: false, status: -1, streamsClosed: false` plus an "unreaped" note.
- Only call line 138 after the termination handler has signalled.

`expectCleanExit` then fails with diagnostics instead of hanging. No timeout or assertion changes. A minor related point: lines 128–133 check `isRunning` and then send the kill as two separate steps. So the comment's "only while unreaped" guarantee isn't strictly true, though the race window is tiny.

## Notes for GPT (hypotheses)
- **Thread pool:** the runner has 3 CPUs, so Swift's shared async thread pool is about 3 threads. Synchronous test bodies that block one, such as `runHeadless()` and `validateStaged()` in `InstalledEngineTests` (up to 60 s), slow every test's start, including the presentation tests that depend on the pool. In the engine code I read, the async `run` uses its own GCD queue and the blocking calls have limits. So this is a slowdown, not a proven deadlock.
- **Crash-report scan:** the report-pattern gap above.

## Smallest next discriminating change
1. **Leave presentation sources unchanged** for the next run, so whatever it shows can be attributed cleanly.
2. **Use the event stream already in the worktree collector.** Lines 502–531 add `_STDBUF_O=0`, `--event-stream-output-path` and `--event-stream-version 0`; CI09's receipt had none of these. For presentation, read the result as follows:
   - no event file → the stall is before Swift Testing;
   - test records but no "run started" → planning, where the gates are the only presentation code;
   - a Live or child-process test started but never ended → a presentation test body;
   - otherwise → backend.
3. **Small read-only additions to the collector's failure path** (GPT's file):
   - List `presentation-profiles/` with names, sizes and modification times. Each `<scenario>.profraw` is written only when that GUI child reaches `exit()`, so this shows which child scenarios finished, and when, without touching any test.
   - Widen the crash-report pattern to `swiftpm-testing-helper`, `xctest`, `PresentationFixture` and `GraphGoblin`.
4. **Apply the `FixtureChild` correction only if** the event stream shows a child-process test that started and never ended.

No timeouts are raised, no tests skipped, no assertions or coverage thresholds weakened, and no shipping code changed.
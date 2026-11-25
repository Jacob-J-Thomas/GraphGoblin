I've bounded the fixture's failure exit path. It isn't verified natively: there's no Swift toolchain here, so nothing was compiled or run. Native verification is the upcoming complete macOS suite. Only `apps/macos-launcher/Tests/Presentation/Support/FixtureChild.swift` changed. Nothing was committed or pushed.

## What changed
1. **Post-SIGKILL wait (old line 135):** `exited.wait()` is now `exited.wait(timeout: .now() + .seconds(5))`. That reuses the 5 s grace the SIGTERM step already had. All three waits on the termination signal now record whether it arrived.
2. **`process.waitUntilExit()` removed (old line 138).** It is replaced by a small bounded check, `runningEnds(process, within: .seconds(5))`. This checks Foundation's `isRunning` every 1 ms and gives up after 5 s. It doesn't reap, signal or run a run loop.
3. **New field `exitObserved`:** true only when the termination handler fired and Foundation itself then reports the child not running. A callback alone doesn't count, and PID checks aren't used.
4. **Reason and status are read only after that.** `terminationReason` and `terminationStatus` are read only when `exitObserved` is true. Otherwise the result reports `exitedNormally: false, status: -1`.
5. **Unobserved child:** the `Process` object is deliberately kept alive with `Unmanaged.passRetained`, because Foundation may still be tracking it and may still call the handler. The existing rule that keeps the pipes open when a reader is still blocked is unchanged.
6. **Diagnostics:** the diagnostics line now includes `exitObserved=…`. The launch-error result sets it to false.
7. **Doc comments:** "only while it is still running and unreaped" became "only while Foundation still reports it running", which matches the existing check-then-signal code. The `runToEnd` comment now describes the bounded cleanup.

**Unchanged:**
- The success path: when the handler fires, Foundation already reports the child stopped, so the check passes at once.
- The four scenarios and their profile file names.
- `expectCleanExit` and every test assertion.
- The 30 s default timeout and the existing 5 s waits.
- Signals still go only to the tracked child, via `terminate()` and `kill(pid, SIGKILL)`. There are no global process operations.
- No production, Package, collector or CI files were touched.

**Bounds:** before, the post-kill phase could wait forever. Now, if the handler never fires, the helper returns after at most 30 + 5 + 5 + 5 = 45 s. If the handler fires but Foundation still reports the child running (not expected), the maximum is 50 s.

A child whose exit isn't observed is reported as a failure: `exitedNormally` is false and `status` is −1, so the existing `expectCleanExit` assertions fail with diagnostics instead of hanging.

## Checks run on Windows
- `git diff --check` on the file: clean.
- Search of `Tests/Presentation`: no `.wait()` without a timeout and no `waitUntilExit` remain. The only status reads are lines 166–167, both behind `exitObserved`.
- `FixtureRun` is built only in this file (2 places), and both include the new field. Nothing in `tooling/`, `apps/` or `.github/` reads the diagnostics text. No product doc or ADR mentions this helper.
- Brackets balance, line endings are LF, and the longest line is still 114 characters.

## Still unverified
- **No native build or tests.** Whether this compiles under Swift 6 and whether all four child-process tests still pass needs the upcoming full macOS suite.
- **The failure path itself hasn't been run.** I couldn't find a safe way to make Foundation miss a child's exit after SIGKILL. A fifth scenario would add a fifth profile file, which the collector rejects (it expects exactly four). Interfering with Foundation's reaping isn't safe. So I added no negative test, and this rests on the reasoning above.
- **Assumption:** I'm relying on Foundation marking the child as stopped before it calls the termination handler. If that's wrong, the success path still works, waiting at most 5 s.
- **Small existing race left unchanged:** between the `isRunning` check and the signal, the child could be reaped and its PID reused. The window is tiny.

The worktree also has uncommitted changes to `Tests/Engine/InstalledEngineTests.swift` and `Tests/Engine/LoopbackTests.swift`. Those are GPT's concurrent edits; I didn't touch them.
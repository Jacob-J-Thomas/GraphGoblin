# Execution qualifications

## Engine checkpoint timing gate

[Engine coverage](engine-coverage.log.txt) exits 1: 1756 passing tests and the existing `recovery.test.ts:679` checkpoint input-wake failure, `expected 2374.4542 to be less than 2000`. Numerical coverage is 96.94% lines and 91.19% branches, above the unchanged thresholds. A test failure still makes the invocation nonzero.

The test seeds 10,000 completions, saves a checkpoint, reads the waiting run, provides its input and settles it. It never pauses or invokes Resume, so the changed `resumeRun` branch and `completePausedResume` helper do not execute on that path. The same case passed in the earlier 127-test focused run, without coverage. Other gates were running concurrently during the full coverage invocation; this is context, not proof of the timing failure's cause. No baseline timing comparison establishes a cause. No unchanged failing suite was retried to obtain a green result, no wall-clock assertion or threshold changed, and no exclusion was added. The engine gate remains failed and is explicitly open for resulting-head CI verification.

## Infrastructure native boundary: NOT RUN qualifications under D-015

[Infrastructure coverage](infra-coverage.log.txt) exits 1: 864 tests passed, six native termination cases failed to qualify, 98.12% lines and 94.26% branches. The framework reports seven errors across those six cases because the descendant case also fails cleanup. These cases are not counted as passes:

- `src/adversarial.test.ts:225`, aborting a real child/grandchild: locked-directory cleanup (`EBUSY`).
- `src/process/scripts.test.ts:157`, incomplete UTF-8 cancellation: the child is still alive at assertion line 203.
- `src/claude/process.test.ts:69`, deadline/output overflow: locked-directory cleanup.
- `src/claude/process.test.ts:84`, running-process cancellation: locked-directory cleanup.
- `src/claude/process.test.ts:150`, descendant shutdown: marker grows after cancellation (line 199), followed by locked-directory cleanup.
- `src/claude/readiness.test.ts:62`, hanging executable: termination remains unconfirmed instead of confirmed deadline exit.

These match the restricted native boundary documented by D-015 and the previous capped round's [owned-child permission probe](../scan-3/native-permission.json), which returned Access denied. That probe is historical, not a new current permission measurement. No denied termination was retried or routed around in this follow-up. The native production paths and their assertions are unchanged. Disposable locked fixtures remain under the task-prefixed system-temp directory; no cleanup sweep or operation on another worker's processes was attempted. Numerical coverage does not qualify native shutdown behavior.

## Scope and provenance

The new tests qualify the engine's public recovery commands, injected public storage ports, real SQLite and HTTP refusals, and fake-clock timer/child ordering. The restart suites use the built application with disposable stores. There are no live-provider turns or new browser/independent audit claims. The prior capped round's full Edge result remains historical. The orchestrator still owns review, commit, independent QA and resulting-head CI.

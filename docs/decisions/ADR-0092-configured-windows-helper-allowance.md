# ADR-0092: Configured Windows helper allowance and measured helper diagnostics

Date: 2026-11-28. Status: Accepted under the owner's 2026-11-28 instruction to integrate PR #460
into #612; implements #458's accepted acceptance criteria.

This supersedes the fixed 15,000 ms initial and retry caps of
[ADR-0086](ADR-0086-windows-helper-job-lifetime.md); its private job, pipes, monotonic cutoff,
cleanup allowance and refusal precedence are unchanged. It keeps the installer enrollment bounds
of [ADR-0090](ADR-0090-windows-launcher-warm-discovery.md) and writes its note through the
launcher log of [ADR-0081](ADR-0081-bounded-windows-launcher-logs.md).

## Context

The owner reported Windows launcher failures that the old launcher logged only as a generic
15-second identity/ownership timeout (#458). Native reproductions on the old launcher showed two
defects: a valid helper writing enough stderr to fill its pipe deadlocked, and a helper answering
in 16 seconds failed although the configured startup timeout was 25 seconds. PR #460 repaired
both on the old `Process.Start` helper. Meanwhile ADR-0086 (#459) replaced that helper with a
private-job helper that drains both pipes concurrently and bounds exit, EOF and empty-job
observation, which also resolves the pipe deadlock; ADR-0086 deliberately kept the fixed
15,000 ms cap and left #460's wider allowance and slow-success diagnostics to a later decision.
#458's accepted criteria still require the configured allowance and diagnostics that distinguish
the stage and outcome without helper output. #460's own helper mechanism is not reintroduced.

## Decision

**Cold-start allowance.** On a cold click, the `--launch-enrollment` check and the initial
`--store-state` ownership check each get their own work deadline of
`max(15, StartupTimeoutSeconds)` seconds: 60 seconds in the default installation and at most 300.
Each deadline keeps ADR-0086's semantics: one monotonic cutoff fixed before preparation, setup
charged, equality expired, and a separate two-second cleanup allowance after a failure.

**Held-store rechecks.** Their structure is unchanged: one monotonic release clock of
`StartupTimeoutSeconds` from the locked observation, a 2,000 ms cleanup reserve, a retry only
when it can fit the previous sample's measured duration or 200 ms, and retention of the last held
result after an inconclusive retry. The per-retry cap becomes the same configured allowance: a
retry's cutoff is the earlier of its admission plus that allowance and the release window's end
less 2,000 ms. The release window is never longer than the allowance, so in practice it decides;
a retry can never start a fresh full-length wait.

**Installer enrollment.** `GraphGoblin.exe --enroll-install` keeps its fixed 15-second work and
2-second cleanup allowance inside ADR-0090's 40-second stage bound, which a configured allowance
of up to 300 seconds could not fit. A slow install-time enrollment is refused and can be retried.

**Measured diagnostics.** `helper-timeout`, `helper-refused`, `helper-invalid` and
`helper-cleanup-unconfirmed` keep their codes, fixed guidance and precedence. Each adds one closed
observation: the stage (`enrollment` or `ownership`), a fixed outcome (timed out, exited with code
N, returned invalid or oversized output, ended without confirmed cleanup), the launcher-measured
milliseconds since the check was admitted, the check's allowance in milliseconds (its whole work
window) and the stdout and stderr byte counts the launcher read, for example
`(ownership check timed out after 15003 ms of its 15000 ms allowance; stdout 17 bytes, stderr 0 bytes)`.
Only launcher-measured integers enter it; helper output, paths and exception text never do. A
held refusal after an inconclusive retry keeps its held reason, lock location and safety advice
first and appends that retry's observation; unconfirmed cleanup still leads. Containment and
runtime-unavailable refusals are unchanged, since no helper ran.

**Slow-success note.** A successful click-time check (enrollment, initial ownership or a recheck)
that took at least 5,000 ms appends one closed JSON record to `launcher.log` through the ADR-0081
writer: outcome `slow-check`, stage `gateway`, the check name, `elapsedMs`, `allowanceMs`,
`stdoutBytes`, `stderrBytes` and a fixed message. The writer's private-root, mutex, size and
rotation rules apply; a dropped or failed note never changes the launch. The installer writes none.

`StartupTimeoutSeconds` is not one end-to-end deadline: the cold checks, the release wait,
gateway readiness and the PWA window are separate phases, and the store and port mutexes are
held through the first three.

## Alternatives

- Keep the fixed 15-second cap: #458's reproduction keeps failing at the configured 25 seconds.
- Restore #460's `Process.Start` helper and its own diagnostics: ADR-0086's private job already
  provides concurrent draining, bounded exit/EOF/empty-job observation and descendant
  containment, which that helper lacked.
- Let the installer enrollment follow the configured allowance: it would exceed ADR-0090's
  40-second stage bound, which this decision does not change.
- One end-to-end click deadline: a different product behavior that #458 did not ask for.

## Consequences

A legitimately slow cold check up to the configured timeout succeeds, and a slow success leaves
timing metadata. A hung or held-open helper now holds the store and port mutexes for up to its
allowance plus two seconds before refusing, so a concurrent click waits longer (within its
existing 360-second mutex wait). Exhaustion still never proves a store free or a lock stale. No
ownership protocol, stored data, configuration format or API changes. Upgrade: rebuild and
reinstall the launcher; the store needs no change.

Compiled NativeChecks establish the allowance function, both recheck cutoff branches at their
boundaries, the measured timeout text, exact byte counts for each closed helper outcome and the
note's record shape. `tooling/scripts/windows-launcher-helper.acceptance.mjs` drives the public
CLI: #458's 16-second checks under a 25-second timeout, stderr and stdout pressure, hung, failed
and malformed helpers, a descendant holding the inherited pipes, the measured texts and the
slow-success notes. The evidence in `docs/qa/2026-11-13-launcher-timeouts/` describes #460's
pre-#459 implementation and is kept as history.

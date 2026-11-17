# ADR-0083 - Native Swift coverage for the macOS launcher

Date: 2026-11-16. Status: Accepted policy; collector/check wired, first hosted verification pending.
Approved by the owner in the [#456 coverage and shutdown decision](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/456#issuecomment-6935644999).

## Context

The macOS launcher is a Swift package with six production targets. Its Xcode test run exports
LLVM coverage JSON, but the current CI report does not map every production source file. CI #03
maps 21 of the 25 production files and reports 2,177/3,588 lines (60.67%) and 1,015/2,040
regions (49.75%). The export has no branch denominator. These are partial measurements, not a
pass or failure against a complete 90% denominator. The [CI #03 packet](../qa/2026-11-16-macos-launcher/raw/macos-pr501-ci-03/README.md)
preserves the raw report and its mapping limitation.

The repository already has a separate per-package V8 policy for TypeScript and JavaScript. The
native Swift package needs measurable thresholds that include its complete production source
without weakening or replacing those existing gates.

## Decision

- Require at least 90% line coverage and at least 90% region coverage over the verified union of
  production source across all six Swift targets.
- Require explicit behavior tests of branch outcomes, including readiness, refusal, cancellation,
  and shutdown decisions. The LLVM export provides no branch denominator, so the policy does not
  set a numeric branch threshold.
- Use the full roster of 25 production source files. Verify source paths against the compiled
  objects and each executable entry point before combining counters across targets. Stop on any
  missing or unmapped production source or entry point; do not exclude it from the denominator.
  A declaration-only source with no executable regions remains inventoried and may have zero
  executable counters only when the complete object mapping establishes that status.
- Keep the existing TypeScript/JavaScript V8 thresholds, denominators, and CI gate unchanged.

Tests must establish real outcomes and invariants rather than reshape code or mock away the
production contract to increase counters. If safe behavior tests leave uncovered regions, report
the residual and actual percentages; do not hide production code with exclusions.

## Implementation status

The owner approved this policy. The `pnpm test:macos-coverage` package command is wired to run
the Swift native tests, collect and check coverage, and the macOS CI job invokes it before native
installer and gateway acceptance. The first hosted run with this wiring is pending. CI #03
predates the step; its existing green jobs and supplementary native coverage artifact do not
establish that this decision's thresholds passed or that the complete mapping is covered by the
new check.

The CI #03 21-of-25 mapping is a known evidence gap. The missing four sources remain part of
the required roster until complete object evidence proves any source has no executable regions.
The current mapped 60.67% line and 49.75% region results must not be reported as a complete
package score or as meeting the 90% policy.

## Consequences

The native coverage report will account for all six production targets and their entry points.
Swift's line and region thresholds supplement explicit outcome tests; they do not replace the
existing V8 gates or native installer, gateway, and presentation acceptance.

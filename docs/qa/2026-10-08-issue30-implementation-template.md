# Issue #30: Implementation template QA ledger — 2026-10-08

Scope: [#30](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/30), building on the integrated #28 foundation. The shipped implementation recipe discovers eligible issues, reserves each attempt, uses fresh sequential worker children, runs a bounded native gate, and opens a closing PR. It never merges that PR. Session/context work #33/#38 and layout #124/#125 remain deferred.

## Deterministic verification

The implementation source checkpoint is 87ee700, integrated with the final #28 recovery fixes at dc316520e40dbf6ac50bdd8430ac721d5159ae1a. The subsequent catalog formatting and this ledger are behavior-neutral.

| System                           | Executed result                                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API after foundation integration | 748 passed, two existing live tests skipped; statements94.42%, branches90.20%, functions96.26%, lines96.15%.                                                                                           |
| Authored graph                   | 36 fake-engine scenarios pass: direct/sequential split, fresh sessions and task workspaces, finite gate repairs, typed refusals, malformed structured outputs and PR proposals. Included in API total. |
| Domain                           | 402 passed; statements96.76%, branches93.96%, functions96.27%, lines97.86%.                                                                                                                            |
| Web                              | 1118 passed across99 files; statements97.71%, branches93.47%, functions98.27%, lines98.64%. Settings and prerequisite behavior are covered with fake API boundaries.                                   |
| Source and build                 | Full build11 tasks, typecheck20 tasks, lint11 tasks pass. Layers, Node22 dependency gate, license allowlist225 packages, generated docs and template validation pass.                                  |
| Catalog refusal                  | Both shipped bundles validate; deliberately invalid graph targets are rejected for both.                                                                                                               |

Independent root review drove concrete repairs before model review: authenticated journals and mapped PR intent reporting; commit/index reconciliation; durable gate-launch counts and uncertain-termination quarantine; exact PR state/title/body/head reconciliation; platform-aware path comparison; poll keys based on authenticated attempts before generic dedupe; and gates bound to an unchanged clean commit.

Actual PollTriggers with SQLite admission verifies that attempt one stays consumed after relabel/restart, authentic QA rework permits attempt two after restart, and duplicate or forged selections add no runs. A successful gate that moves HEAD or leaves the checkout dirty cannot authorize a PR. Fake process/GitHub tests exercise response-loss and refusal paths; they do not establish native provider or GitHub behavior.

## Local native process and distribution checks

Five native Windows process checks passed: literal argument preservation and credential-environment filtering, installed pnpm through Node and pnpm.cjs, timeout termination of an owned parent and grandchild with a stopped heartbeat, bounded output termination, and batch-launcher refusal before spawn. Receipt: native-process-2026-10-08T221036450Z/receipt.json in the private delivery evidence directory.

The first version-only pnpm smoke ran inside the product repository's ancestor package-manager pin and reached its five-second deadline. That failed receipt is retained. Moving only that version probe to the system temporary directory returned the installed pnpm11.25.0 in733ms and allowed the complete local smoke to pass. This was a fixture correction, not a production code repair or evidence about dependency installation.

The built archive contained all24 source/runtime catalog assets byte-for-byte. A production deploy loaded Starter and Implementation from the installed catalog and executed the installed support entry, which reported version1.0.0 matching the manifest. The image CI gate also executes each packaged support entry with --version in a read-only, network-disabled container; its current PR run is still pending.

## Remaining gates

- Actual browser preflight and Opus QA for the implementation settings, failure remediation, child pinning and draft handoff.
- Bounded real workflows against the separate private scratch repository; no #30 model turns, issues or PRs have been created there yet.
- Stable full Codex and installed Opus code review, triage/targeted repair as needed, and current-head CI.
- Only after those pass: merge this child into the feature branch. The final feature-to-main PR remains unmerged pending the owner's final product validation.

The native #26 Claude fresh/resume, #29 incoming webhook and #97 Jev call budgets were already consumed and are not repeated. The owner's installation and data remain unchanged.

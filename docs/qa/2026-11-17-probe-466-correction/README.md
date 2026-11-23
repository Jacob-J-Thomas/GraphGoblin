# #466 correction for errors after abort

This correction responds to the [diagnostic gap found by independent QA](../2026-11-17-probe-466-qa-initial/README.md). It changes only `packages/adapter-codex/src/probe-directory.test.ts`. No production code changed, and the docs and CHANGELOG are byte-identical.

## Finding

In the original candidate (SHA-256 `c952e3b40359ef448e3c22a46ebd9ad4f8818f4da608f00aa09c8cccf1be2d6d`), the `probeCase` finish hook ran `await probeFs.rm(root, …)` before `throw outcome.reason`. Suppose a case timed out, its body then failed late, and the case-root removal also failed. The rejected `rm` left the hook before the body failure was rethrown. Vitest reported the timeout and the `EBUSY` error, but not the body failure.

## Fix

The finish hook keeps the same order: wait for the body, wait for every fake CLI to exit, restore TEMP/TMP/TMPDIR, then remove the case root. It now collects the post-abort body failure and any root-removal failure:

- If there are two, it throws an `AggregateError` of both, in the order they happened.
- If there is one, it throws that error unchanged.
- If there are none, it throws nothing.

The rule for which failures are reported has not changed. A body failure without an abort is still reported only by the case itself, never again by the hook.

Vitest 5.0.3 `callTestHooks` catches each finish-hook error and passes it to `failTask`. `failTask` records each member of an `AggregateError` as its own error (`vitest/dist/chunks/run.BTlFXlnv.js`, lines 3551-3575 and 3971-3990).

No timeouts, retries or assertion settings changed. The production Windows probe-directory cleanup race is out of scope.

## Regression

The new test runs one case per row and injects an `EBUSY` failure only when the case root is removed. The probe's own directory removal stays real.

| Case                                                          | [Original helper](01-red-regression-current-helper.log)                                                                      | [Corrected helper](02-green-focused.log)                          |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Body fails after the abort, while a real `hang` fake CLI runs | **Fails**: the hook reports `[EBUSY]` and drops `Body failure after its abort`. Every settlement assertion before it passes. | Passes: the hook reports `[body failure, EBUSY]`                  |
| Body fails without an abort (guard for "reported once")       | Passes: `[EBUSY]`                                                                                                            | Passes: `[EBUSY]`. The body failure is reported once, by the case |

Both rows assert that the body had settled, the fake CLI had exited, the probe directory had been removed before the case-root removal, and TEMP had been restored. The case root remained because of the injected fault.

Each row then removes that root itself after restoring the spy. The existing 7 cases are unchanged and pass.

[03-runner-check.log](03-runner-check.log) is one real Vitest run with the default 5000 ms timeout. A throwaway scratch test, [03-runner-check.scratch.test.ts.txt](03-runner-check.scratch.test.ts.txt), uses no helper, fixture, fake CLI or filesystem; it was deleted by exact path afterwards. Vitest reported three errors: the timeout, `SCRATCH_LATE_BODY_FAILURE`, and `SCRATCH_ROOT_REMOVE_FAILURE` with code `EBUSY`. The next case ran and passed. Expected exit 1. This checks the reporting mechanism only. The [corrected independent QA packet](../2026-11-17-probe-466-qa-final/README.md) records the separate rerun of the original double-fault witness.

## Gates (new candidate `9d952d1c…`, one run each, Node v22.23.4, pnpm 12.8.1)

| Log                                                | Command                                                                                        | Result                                                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [02-green-focused.log](02-green-focused.log)       | `pnpm --filter @graphgoblin/adapter-codex test src/probe-directory.test.ts --reporter=verbose` | 9/9, exit 0                                                                                                  |
| [05-adapter-coverage.log](05-adapter-coverage.log) | `pnpm test:coverage --filter=@graphgoblin/adapter-codex`                                       | 647 passed, 4 skipped; statements 98.3%, branches 95.61%, functions 99.32%, lines 99.42%; cache miss; exit 0 |
| [06-typecheck.log](06-typecheck.log)               | `pnpm typecheck --filter=@graphgoblin/adapter-codex`                                           | 4 tasks, exit 0                                                                                              |
| [07-lint.log](07-lint.log)                         | `pnpm lint --filter=@graphgoblin/adapter-codex`                                                | exit 0                                                                                                       |
| [08-format-check.log](08-format-check.log)         | `pnpm format:check`                                                                            | exit 0 (root's `docs/qa/2026-11-17-probe-466-implementation/` present)                                       |

The coverage run includes the existing `cli.test.ts` case that runs the installed Codex CLI for version, help and login status. That case makes no model request and was not changed here.

## Boundaries and cleanup

- Every test run used one private TEMP/TMP/TMPDIR root ([owned-temp.txt](owned-temp.txt)). Afterwards it held three things, all from existing behaviour ([09-cleanup.txt](09-cleanup.txt)):
  - one empty `gg-codex-probe-*`, from the known `cli.test.ts` Windows hang race;
  - one empty `graphgoblin-live-*`, created at module load by `live.test.ts:38`;
  - Node's `node-compile-cache`.
- The root contained 0 reparse points and was removed by exact path. Afterwards no fake CLI process from this worktree was running.
- Real `%TEMP%` `gg-codex-*` entries were the same two pre-existing, unowned entries before and after.
- During the implementation correction, the existing `.gitattributes` bytes and the 46 files in the initial implementation packet matched the pre-correction records. Publication added separate attributes for the new packets. [Before](00-root-publication-files-before.sha256), [after](10-root-publication-files-after.sha256).
- The correction implementation ran the gates listed above. Extra stability samples, full repository checks and the dependency audit were outside that run. Issue #503 still blocks the audit.

## Files

- [00-pre-state.txt](00-pre-state.txt), [00-root-publication-files-before.sha256](00-root-publication-files-before.sha256): state before the correction.
- [original-c952e3b4-probe-directory.test.ts.txt](original-c952e3b4-probe-directory.test.ts.txt): original candidate bytes.
- [01-red-probe-directory.test.ts.txt](01-red-probe-directory.test.ts.txt), [01-red-regression-current-helper.log](01-red-regression-current-helper.log): the regression against the original helper.
- [02-green-focused.log](02-green-focused.log), `03-runner-check*`, `05`–`08` gate logs, [04-real-temp-gg-codex-before-gates.txt](04-real-temp-gg-codex-before-gates.txt), [09-cleanup.txt](09-cleanup.txt), [10-final-state.txt](10-final-state.txt), [10-root-publication-files-after.sha256](10-root-publication-files-after.sha256).
- [correction.diff](correction.diff): the original candidate compared with this correction.
- [candidate-vs-base.diff](candidate-vs-base.diff): the three candidate files compared with the base.
- The candidate manifests record the corrected source and documentation hashes. [SHA-256 manifest](source-CANDIDATE-MANIFEST.sha256), [JSON manifest](source-candidate-manifest.json).

## Published records

The [original report](README.md.txt) and [source checksums](source-MANIFEST.sha256) are byte-for-byte copies. The [publication manifest](publication-manifest.json) maps the original paths to their published copies.

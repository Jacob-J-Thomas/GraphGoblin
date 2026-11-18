# #466 correction 01: keep both failures after an abort

This correction responds to the diagnostic gap that independent QA found (`../i1-probe-466-independent-qa/README.md`, double-fault row). It changes only `packages/adapter-codex/src/probe-directory.test.ts`. No production code changed, and the docs and CHANGELOG are byte-identical.

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

| Case | Original helper (`01-red-…`) | Corrected (`02-green-…`) |
| --- | --- | --- |
| Body fails after the abort, while a real `hang` fake CLI runs | **Fails**: the hook reports `[EBUSY]` and drops `Body failure after its abort`. Every settlement assertion before it passes. | Passes: the hook reports `[body failure, EBUSY]` |
| Body fails without an abort (guard for "reported once") | Passes: `[EBUSY]` | Passes: `[EBUSY]`. The body failure is reported once, by the case |

Both rows also assert what was left when the case finished:

- the body had settled;
- no fake CLI was still running;
- the probe directory was removed before the case root;
- TEMP was no longer stubbed;
- the root is present only because of the injected fault.

Each row then removes that root itself after restoring the spy. The existing 7 cases are unchanged and pass.

`03-runner-check.log` is one real Vitest run with the default 5000 ms timeout. A throwaway scratch test, `03-runner-check.scratch.test.ts.txt`, uses no helper, fixture, fake CLI or filesystem; it was deleted by exact path afterwards. Vitest reported three errors: the timeout, `SCRATCH_LATE_BODY_FAILURE`, and `SCRATCH_ROOT_REMOVE_FAILURE` with code `EBUSY`. The next case ran and passed. Expected exit 1. This checks the reporting mechanism only. It is not the independent QA double-fault witness, which QA will rerun.

## Gates (new candidate `9d952d1c…`, one run each, Node v22.23.4, pnpm 12.8.1)

| Log | Command | Result |
| --- | --- | --- |
| `02-green-focused.log` | `pnpm --filter @graphgoblin/adapter-codex test src/probe-directory.test.ts --reporter=verbose` | 9/9, exit 0 |
| `05-adapter-coverage.log` | `pnpm test:coverage --filter=@graphgoblin/adapter-codex` | 647 passed, 4 skipped; statements 98.3%, branches 95.61%, functions 99.32%, lines 99.42%; cache miss; exit 0 |
| `06-typecheck.log` | `pnpm typecheck --filter=@graphgoblin/adapter-codex` | 4 tasks, exit 0 |
| `07-lint.log` | `pnpm lint --filter=@graphgoblin/adapter-codex` | exit 0 |
| `08-format-check.log` | `pnpm format:check` | exit 0 (root's `docs/qa/2026-11-17-probe-466-implementation/` present) |

The coverage run includes the existing `cli.test.ts` case that runs the installed Codex CLI for version, help and login status. That case makes no model request and was not changed here.

## Boundaries and cleanup

- Every test run used one private TEMP/TMP/TMPDIR root (`owned-temp.txt`). Afterwards it held three things, all from existing behaviour (`09-cleanup.txt`):
  - one empty `gg-codex-probe-*`, from the known `cli.test.ts` Windows hang race;
  - one empty `graphgoblin-live-*`, created at module load by `live.test.ts:38`;
  - Node's `node-compile-cache`.
- The root contained 0 reparse points and was removed by exact path. Afterwards no fake CLI process from this worktree was running.
- Real `%TEMP%` `gg-codex-*` entries were the same two pre-existing, unowned entries before and after.
- Root-owned `.gitattributes` and `docs/qa/2026-11-17-probe-466-implementation/` (46 files) are identical before and after (`00-…before.sha256`, `10-…after.sha256`). Nothing is staged and nothing was committed.
- Not run (by brief): extra stability samples, full repository checks, the dependency audit (#503 still blocks CI) and a copy of the independent QA run.

## Files

- `00-pre-state.txt`, `00-root-publication-files-before.sha256`: state before the correction.
- `original-c952e3b4-probe-directory.test.ts.txt`: original candidate bytes.
- `01-red-probe-directory.test.ts.txt`, `01-red-regression-current-helper.log`: the regression against the original helper.
- `02-green-focused.log`, `03-runner-check*`, `05`–`08` gate logs, `04-real-temp-gg-codex-before-gates.txt`, `09-cleanup.txt`, `10-final-state.txt`, `10-root-publication-files-after.sha256`.
- `correction.diff`: the original candidate compared with this correction.
- `candidate-vs-base.diff`: the three candidate files compared with the base.
- `CANDIDATE-MANIFEST.sha256` (check from the repository root with `sha256sum -c`) and `candidate-manifest.json`: the exact new candidate.
- `MANIFEST.sha256`: every other file in this folder.

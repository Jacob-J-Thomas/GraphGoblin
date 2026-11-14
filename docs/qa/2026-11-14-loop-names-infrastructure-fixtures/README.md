# Issue #209 / PR #470 infrastructure fixture correction

**Status:** The test-only correction is committed locally as `bc9a7138dcb9b06c26e7fca92a377b7fd9599737`. Full CI for this corrected commit is required and has not started.

## First CI failure

Gate run `43597212461` failed 17 tests because in-memory SQLite test stores created equivalent loop names:

- `definition-pins.test.ts`: 4 failures. `draftRun(seed)` repeatedly named its loop `Snap`.
- `history-cleanup.test.ts`: 2 failures. The local `create(name, template)` helper omitted `name` from each loop definition; the large-store case reused the default name for its template and fixed-path loops.
- `history-summaries.test.ts`: 11 failures. The damaged-history fixtures created damaged and healthy loops with the same default name.

`first-ci-failure.log` is a byte-identical copy of the original CI log (SHA-256 `2bd201caf31409b317e8ea87c81b45e74ab8141148786f3448774d8560bb0697`).

## Correction

Only three test fixtures changed. `draftRun` now uses its seed in the `Snap` loop name, and the exact pinned-label assertion follows that name. The cleanup helper uses its `name` argument for the loop; the large-store template and each fixed-path loop have explicit unique names. Damaged and healthy summary loops also have distinct names.

The pin, history-cleanup, and damaged-versus-healthy assertions remain. No runtime, API, or product behavior changed.

## Preparation verification

- The preserved preparation log records a Prettier check of the README and all three changed test files; the compact `prettier-check.log` records a fresh check of this publication README.
- `pnpm.cmd --filter @graphgoblin/infrastructure lint` passed; `infrastructure-lint.log` preserves the command output.
- `git diff --check` and reverse application check for the correction patch passed.
- No local tests, typecheck, or build were run. Corrected full CI must run coverage and type gates; that CI is pending.

`manifest.json` records included artifact hashes, baseline and corrected test-file hashes, and external preparation-manifest provenance. The original 22-artifact preparation record and README remain unchanged in the external batch archive.

# Preflight catalog fixtures under the #584 invariant

This packet supplements the [#545/#546 preflight packet](../2026-11-24-preflight-defaults-catalog/README.md) for PR [#576](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/576). That packet is historical and unchanged: its manifest records the test file that was reviewed and QA'd then. This packet records the later test-only change, its author runs and its independent Claude review and QA.

## Why the fixtures changed

Integrating main (`2ac2cb73`) brought in the [#584](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/584) shared catalog fixture (`fa7615c3`, [its packet](../2026-11-25-preflight-fixture-584/README.md)). #584 sets an invariant: no fixture writer opens a path that preflight inspects. A writer seeds a private staging path, requires a complete TRUNCATE checkpoint, and closes. Only the main database is then copied to the inspected path, and the copy refuses an existing destination. Two fixtures that this PR adds still opened their writer on the inspected path, where late native cleanup of that writer could change the WAL that the strict byte checks compare. Two commits apply the invariant to them:

- `a5cd4a51` moves the merged fixture body into `stagedStore(dbFile, rows, migrationsFolder?)`, and `fixture` and `pendingFixture` delegate to it. `pendingFixture` still migrates through the shipped prefix to `0026_chat`, leaving 3 migrations pending.
- `080c1736` seeds the unsupported-format case through a private `fixture-writer-*` path. It sets `format_version = 3`, requires the TRUNCATE checkpoint to return busy, log and checkpointed values of 0, closes the writer, and copies only the main database to the unused inspected path with `COPYFILE_EXCL`.

Production source is unchanged. `80d292a3` then merged main `4e1037c9` (#586), and `c7559bff` moved this PR's CHANGELOG entry back to the top of Unreleased with identical text.

## Superseded test-file hash

The earlier packet binds `apps/api/src/preflight-catalog.test.ts` to `e5adea910d0fdcc39b4a12ef1e9d52f3e09d55739abc9c77d92fe01f6d6005f8`. At the reviewed head `c7559bff` it is `c65f97518387813da430e1260572b7b236b6b1a763146c71f10f40e5f84340f9`, after the main integration and the two fixture commits. The [manifest](MANIFEST.json) records each step. `apps/api/src/preflight.ts` and `apps/api/src/preflight.test.ts` keep the earlier packet's hashes. `CHANGELOG.md` and the two changed docs differ only through main integrations: this PR's own added and removed lines in both docs are unchanged, and the [CHANGELOG entry text](raw/review-qa/raw/review/changelog-entry-identity.txt) is identical.

## Author runs

The author session ran these checks around the main merge. It left [logs](raw/author/) but no written report.

- `preflight-catalog.test.ts` passed 31/31 [before](raw/author/01-preflight-catalog-pre-merge.log.txt) and [after](raw/author/06-preflight-catalog-post-merge.log.txt) the merge. The preflight file passed 48/48 [before](raw/author/02-preflight-pre-merge.log.txt) and [after](raw/author/07-preflight-post-merge.log.txt). The [preflight Ollama file](raw/author/10-preflight-ollama-post-merge.log.txt) passed 18/18 after it.
- API typecheck and lint printed no diagnostics before or after the merge ([03](raw/author/03-api-typecheck-pre-merge.log.txt), [04](raw/author/04-api-lint-pre-merge.log.txt), [08](raw/author/08-api-typecheck-post-merge.log.txt), [09](raw/author/09-api-lint-post-merge.log.txt)). Scoped Prettier checks passed ([05](raw/author/05-prettier-pre-merge.log.txt), [16](raw/author/16-prettier-changelog.log.txt)), and so did [the full format check](raw/author/17-format-check.log.txt).
- Two local full API coverage runs after the merge failed on unrelated tests. They are retained as recorded, and neither is a coverage result for this PR. In the [first](raw/author/13-api-coverage-post-merge.log.txt), `subloop-restart.test.ts` failed because the API child exited when store ownership could not be verified ("WMI returned no valid process creation identity"): 1 failed, 2,317 passed, 40 skipped. A [focused rerun of that file](raw/author/14-subloop-restart-focused.log.txt) passed 3/3. In the [second](raw/author/15-api-coverage-attempt2.log.txt), a `history-cleanup.test.ts` case timed out at 20 seconds, and a Vitest worker exited with code 3221225477 (`0xC0000005`, an access violation) while running `classifiers.test.ts`: 1 failed, 2,286 passed, 40 skipped, 1 unhandled error. `preflight-catalog.test.ts` passed 31/31 in both runs.

## Independent review: READY

[The review](raw/review-qa/REVIEW.md.txt) by Claude Opus 5.5, independent of the author, covered `a5cd4a51`, `080c1736`, `80d292a3` and `c7559bff`. It does not replace the opposite-family review or the final audit.

- Every fixture writer and reader call site in the test file complies with the invariant ([call sites](raw/review-qa/raw/review/writer-call-sites.txt)). The unsupported-format change stays within its contracted window: the file outside it hashes to the contract's prefix and suffix ([window hashes](raw/review-qa/raw/review/unsupported-change-window.txt)).
- The byte-comparison helpers are identical to main. The merge changed only `CHANGELOG.md`, and its remerge diff is empty ([merge check](raw/review-qa/raw/review/merge-80d292a3-check.txt)). The diff against main lists only the PR's own 47 paths ([diff stat and checks](raw/review-qa/raw/review/diff-stat-and-checks.txt)).
- No P1 or P2 findings. **R1 (P3, follow-up candidate for the orchestrator):** nothing enforces the #584 invariant, which holds only by convention. A plain revert of both staging changes passes the whole file, and a future fixture writer on an inspected path would land green and flake later. The outcome needed is a deterministic guard, or an explicit decision to keep the convention.

## Independent QA: PASS WITH LIMITS

[The QA report](raw/review-qa/QA-REPORT.md.txt) is by a separate Claude Opus 5.5 agent at `c7559bff`, on Windows 11 with Node v22.23.4.

- **Stability.** Ten consecutive runs of the test file each passed 31/31 with no errors ([summary](raw/review-qa/raw/repeat/summary.txt), [file hash](raw/review-qa/raw/repeat/file-sha.txt)).
- **Sensitivity.** Each mutation ran on a scratch copy; the worktree was not edited ([mutation summary](raw/review-qa/raw/mutants/logs/summary.txt), [variant hashes](raw/review-qa/raw/mutants/MANIFEST.json)).

| ID  | Mutation                                                                    | Result                                                 |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------ |
| M00 | Unchanged control copy                                                      | 31/31 pass                                             |
| M01 | Database byte-equality check removed                                        | 1 fail: the comparator test                            |
| M02 | Existing-WAL equality check removed                                         | 1 fail: the comparator test                            |
| M03 | New-WAL-frames check removed                                                | 1 fail: the comparator test                            |
| M04 | Unsupported case without the format 3 downgrade                             | 1 fail: preflight exits 0                              |
| M05 | Pending fixture applies every shipped migration                             | 6 fail on "3 migration(s) pending"                     |
| M06 | `stagedStore` checkpoints with PASSIVE                                      | 24 fail at the all-zero checkpoint check               |
| M07 | Unsupported case checkpoints with PASSIVE                                   | 1 fail at the all-zero checkpoint check                |
| M08 | A file already exists at the inspected path                                 | 1 fail: `EEXIST`                                       |
| M09 | Modeled late native finalizer, staged fixtures (current code)               | 31/31 pass                                             |
| M10 | Modeled late native finalizer, fixtures as before `a5cd4a51` and `080c1736` | 6 fail at the strict existing-WAL check                |
| M11 | Plain revert of both staging changes, no model                              | 31/31 pass: a single run does not detect it (limit L1) |

- **Built CLI.** `node apps/api/dist/main.js --preflight` ran on disposable stores built under the invariant, with a fake Codex CLI, no Claude binary, Ollama disabled and loopback binding only ([results](raw/review-qa/raw/native/NATIVE-RESULTS.json), [stdout](raw/review-qa/raw/native/native.stdout.log.txt), [build](raw/review-qa/raw/native/api-build.log.txt), [dist hashes](raw/review-qa/raw/native/dist-hashes.txt)). Database and WAL bytes were unchanged after every preflight and startup. A reader created an empty WAL and `-shm`, which the documented reader exception allows.

| ID  | Store and configured default                                                    | Observed                                                                                                     |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| N1  | 3 migrations pending; stored-only Codex model, effort `low`                     | Exit 0. `WARN` for the pending migrations and `ok` for the default model                                     |
| N2  | 3 migrations pending; stored `gpt-5.5` efforts narrowed to `low`, effort `high` | Exit 1 with `EFFORT_UNSUPPORTED`; ordinary startup refuses it too                                            |
| N3  | 3 migrations pending; stored `gpt-6.1-terra` disabled                           | Exit 0. `WARN` that the default model is disabled                                                            |
| N4  | Current format 4 store; `gpt-6-luna`, effort `low`                              | Exit 0. `ok` for the database and the default model                                                          |
| N5  | Format 3 store                                                                  | Exit 1. `FAIL` for the database and `WARN` that defaults are not checked; ordinary startup refuses the store |

The QA report states these limits:

- **L1.** The tests do not deterministically detect a regression of the staging. A plain revert passes a single run (M11), and the protective effect is shown only under a modeled late finalizer (M09 against M10), not by reproducing the real timing #584 observed on macOS. This matches review finding R1.
- **L2.** Windows only. The original #584 failure was on macOS, and the macOS hosted job runs the launcher suite, not the API suite.
- **L3.** API coverage, typecheck and lint were not run locally. QA relied on hosted CI and the author's logs.
- **L4.** Mutations ran through a scratch Vitest configuration that resolves workspace packages by alias. The unchanged control (M00) passed 31/31, but it is not the repository's own configuration.
- **L5.** Native checks compared database and WAL bytes and directory listings only, not `-shm` contents. Provider readiness against real harnesses is out of scope.
- **L6.** The earlier packet was not updated for these commits. This packet records them.

## Status

Hosted CI [run 45753245193](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/45753245193) on `c7559bff` passed all seven jobs: Repository checks, Coverage, Gates, Browser, macOS launcher, Windows launcher and Template image. In the Coverage job the API suite passed 2,326 tests with 32 skipped, including `preflight-catalog.test.ts` at 31/31, with 95.47% line and 91.07% branch coverage. Browser passed 495 end-to-end tests with 1 skipped and zero retries. This packet adds only `docs/qa` files on top of `c7559bff`.

The opposite-family GPT targeted re-review of the two fixture commits and the fresh Astra MAX final audit are pending until 2026-11-28. Owner acceptance is separate.

## Files

Raw members are byte-for-byte copies of the external evidence. `.gitattributes` keeps Git from normalizing their line endings or flagging their whitespace. Files named `*.log` are stored as `*.log.txt`, because `.gitignore` ignores `*.log`; their bytes are unchanged. The review and QA reports are immutable originals, stored as `REVIEW.md.txt` and `QA-REPORT.md.txt`. `raw/review-qa/` mirrors the review and QA evidence folder, so the reports' `raw/` citations resolve, with the `.log.txt` rename. The mutated test copies, harness scripts and commit patches were left out to keep the packet small. Their SHA-256 values are listed under `omittedMembers` in the [manifest](MANIFEST.json) and in [the QA checksum list](raw/review-qa/EVIDENCE-SHA256SUMS.txt).

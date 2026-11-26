# Store recovery residual: #542, #537 and #560

This packet records the author evidence, the independent Claude review and the independent Claude QA
for branch `codex/gg-fu-store-recovery-residual-20261125`. The branch starts at
`f0dac0158c475c1bd43c779a744ee8e3c89b8c2e`, which carries the #533 typed hard-link component on
main `4e1037c9` (the same change is in PR #587). Review and QA bound
`6c86acea5db1725795c3e02fcc00dff521aacc7e` (implementation `8ffe5c0b` plus three added tests). The
later review fix `7ca75577` (R2 below) was not part of that review or QA. The opposite-family GPT
review and the fresh Astra MAX final remain separate gates.

Originals are kept byte-for-byte under `raw/`: Markdown reports as `*.md.txt`, logs as `*.log.txt`,
JSON and scripts unchanged. [MANIFEST.json](MANIFEST.json) lists each retained file with its size,
SHA-256 and origin. Scripts keep their original local paths and are not portable replays.

## Behaviour per issue

**#560: the original startup failure stays first.**

- A failed write, attestation or close of a newly created lock record closes its handle exactly
  once and removes the record at most once, after proof at the configured, non-followed path. A
  partial record is matched by the identity its handle reported before closing, and a complete one
  by its exact random-token bytes. An absent or foreign file is left alone and ends only the
  in-process reservation. An unproven record, or one whose lookup or unlink fails, is kept with
  its reservation and reported as retained.
- In `createContainer` setup, a failed read-only or mutable SQLite close keeps both acquired leases,
  because the connection may still be open. Otherwise the database lease and then the
  data-directory lease are each released once, even if the first release fails. A read-only close
  failure no longer replaces a store-format, guard or catalog refusal.
- Remaining failures travel in the API-private `StartupCleanupError`: the primary first (and as
  `cause`), then each failed step with a closed label and vetted code, then retained ownership. A
  fully settled cleanup throws the original error object unchanged. Managed startup classifies only
  the primary; shell output prints the primary as before plus one escaped line such as
  `cleanup also failed: database-close (EIO); ownership retained: ...`, never cleanup messages.

**#542: own-release successor on Windows.** Right after publication the guard's identity is
captured (`lstat`, a listing of only its own marker, `lstat`, consistent with the staging
directory). Only after a release has removed its own exact marker may an `EPERM` from removing the
emptied guard be classified, once, by #582's positive successor criteria. A verified live successor
completes the release and keeps the main lock without claiming reclamation; unknown, unchanged,
empty or unverifiable states keep the original failure and the existing rollback.

**#537: labelled residual diagnostics.** Failed recovery-marker reads are labelled
`observed-marker-read` or `recovery-marker-read`, with the marker token, a vetted code and the raw
cause. Failed read-only probes during an `EPERM` classification are attached to the unchanged
`recovery-directory-remove` error as `probeFailures`, with closed labels and codes. Raw probe text
is kept but never printed. The verified acquisition successor still refuses with exactly the
ordinary `held(path)` (FUP-091).

## Design mapping

| Decision                                   | How it is met                                                                                                                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FUP-044 1: tagged aggregate                | `StartupCleanupError` in the leaf module `startup-cleanup.ts`; only it is unwrapped by `serve.ts`; known refusals keep their category and explanation; arbitrary `AggregateError` is not interpreted                      |
| FUP-044 2: read-only setup close           | In scope; a primary guard or catalog failure survives a failed close; a close-only failure is its own primary                                                                                                             |
| FUP-044 3: leases after an uncertain close | Both leases kept and reported; otherwise database then directory lease released once each                                                                                                                                 |
| FUP-044 4: Windows `EPERM` disambiguation  | win32 only; unknown identity (inode 0, link or non-directory, lookup failure, unstable capture, listing or staging mismatch) never proves a successor; one `rmdir` per opportunity; non-Windows and `ENOTEMPTY` unchanged |
| FUP-044 5: `heldPaths`                     | Acquisition admission and failed-release reservations unchanged; only the own-release classification reads the physical path                                                                                              |
| FUP-044 6: exclusive record cleanup        | Identity read before the single close; reservation dropped only on proven removal, absence or foreign state; ordered errors name the retained path and append the guard-release failure                                   |
| FUP-084 P3 1: post-probe rechecks          | One expected-PID lookup asserted in the identity and replacement cases; isolated marker-only and controlled directory-only checks prove which late predicate refused                                                      |
| FUP-084 P3 2: attempt-limit disclosure     | Added to the existing #581 changelog entry                                                                                                                                                                                |
| FUP-091: verified acquisition successor    | Unchanged `held(path)`, pinned with no cause, code or operation, one shell line and `store-held`                                                                                                                          |

Docs: `docs/11-security-and-distribution.md`, `CHANGELOG.md` and
`docs/decisions/ADR-0091-bounded-startup-ownership-cleanup.md`.

## Author evidence

Read the [author report](raw/author/AUTHOR-REPORT.md.txt). Focused selections, API typecheck, lint,
Prettier and `pnpm check:qa` passed on the authored commits. A temporary
[mutation check](raw/author/mutation-check.mjs) applied 18 single-predicate mutants to
`data-dir-lock.ts` and `container.ts`. Two survived at first and gained controls; afterwards all 18
failed the focused tests, and the sources were restored byte-for-byte.

The local API coverage gate is unconfirmed. Three full runs under the shared heavy-suite lock each
lost a result to an environmental fault on this Windows host:

| Run                                                  | Bytes                 | Outcome                                                                                                                                                                                          |
| ---------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [1](raw/author/api-coverage-run1-pre-commit.log.txt) | pre-commit `8ffe5c0b` | 2,381 passed, 1 failed: the unrelated `history-cleanup` 1,000-workspace case timed out at 20 s (3.9 s alone); no coverage report                                                                 |
| [2](raw/author/api-coverage-run2-8ffe5c0b.log.txt)   | `8ffe5c0b`            | 2,377 passed; the `create-api-key.test.ts` worker crashed (0xC0000005), so its coverage is missing; lines 94.05%, branches 89.5%, functions 89.85%, below the gate by less than that file covers |
| [3](raw/author/api-coverage-run3-6c86acea.log.txt)   | `6c86acea`            | 2,384 passed, the same `history-cleanup` timeout; no coverage report                                                                                                                             |

Hosted CI coverage is the gate for this change. The local runs establish no coverage regression
and no coverage pass.

## Review

[Independent Claude review](raw/review/REVIEW.md.txt): READY FOR OPPOSITE-FAMILY REVIEW, with no
P0 to P2 finding. All nine of the author's review calls were accepted.

- **R1 (P3, deferred):** `create-api-key.ts` still uses the pre-#560 nested `finally` cleanup. It is
  outside the admitted paths and stays a follow-up; this branch does not change it.
- **R2 (P3, fixed in `7ca75577`):** on the own-release rollback, attached probe evidence sat below
  `util.inspect`'s default depth and printed as `probeFailures: [ [Object] ]` (QA case D3b), or as
  `[Array]` when the rollback also failed. The evidence array now prints its labels and codes at
  any depth, while each raw cause stays non-enumerable and unprinted. Two maintained tests assert
  the console rendering; [the proof log](raw/author/r2-proof.log.txt) shows both fail with the fix
  reverted and pass with it.

## Independent QA

[QA report](raw/qa/QA-REPORT.md.txt): PASS WITH LIMITS, on Windows 11 with the built API at
`6c86acea`. It ran 29 controlled-fault cases through the public startup path, with faults injected
only into `node:fs/promises` for the lock module and the SQLite factory for the container
([scripts](raw/qa/scripts/), [per-case raw](raw/qa/faults/)). The cases include a real NTFS
deny-read ACL (C1) and a real live successor process with its real CIM creation time (D1). 27
passed. B2 failed on a harness expectation error while the behaviour conformed, and D3b was the
observation that became R2. Managed launcher records kept `store-refused`, `store-held` and
`store-unavailable` with no text leak. [Native contention](raw/qa/contention/) ran four rounds of
five public `dist/main.js` processes: one owner each round, ordinary refusals and a clean store. A
library-level harness passed three five-worker trials.

## Not established

- Whether native Windows ever produces the own-release `EPERM` with a successor present: every
  `EPERM` was injected, even where the successor and its identity were real. The historical #471
  cause and frequency remain unknown.
- Attestation (`attestLocalArtifact`) on a Mac device; it was exercised at module level and in unit
  tests only.
- The API package coverage gate, which belongs to hosted CI.
- The R2 fix's native shell rendering, beyond the maintained tests and the proof log.
- Rarer contention interleavings than four rounds of five contenders on one machine.
- `serve()`'s own startup catch, returned-container disposal and `--create-api-key` cleanup (R1),
  which stay outside this change.

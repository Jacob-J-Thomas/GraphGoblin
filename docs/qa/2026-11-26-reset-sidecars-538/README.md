# Reset sidecar entry selection (#538): author, review and QA

Issue #538: `graphgoblin-api --reset` picked each SQLite `-wal`, `-shm` and `-journal` sidecar as the first listed directory entry with the same file identity. When the file had another hard link listed earlier, the reset unlinked that unrelated name, kept the sidecar, reported success and left the surviving name out of Keeps.

The candidate selects a sidecar as a directory entry, in this order:

1. the exact listed name;
2. otherwise, the one listed name in the database's physical directory with the same identity;
3. otherwise, on Windows only, the listed link that the native final path names in that same directory. The chosen name is then observed again and must still be the same regular file.

Anything else refuses before the store is read. Links and special files are never resolved. When `GG_DB_URL` spells the database file differently from the listing, both sidecar spellings must name the same entry, or neither may exist.

Another top-level name of a removed sidecar is kept and listed as `another name for <sidecar>`, through a private exception for that exact pair; the exported manifest check stays strict. A sidecar that is also a lock file or a reserved top-level name refuses, naming both. A sidecar at a `.reclaim` guard name, or at a lock file whose record cannot be verified, is refused earlier by the lock check, which names only the guard or lock file. The locked replan repeats the selection. An ambiguity first seen there refuses before removal and releases the locks.

## Bound source

| Commit                                     | What                                                                                                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `230640ae579e12c511894a9a586d82ce6d682202` | Implementation on base `14ea69842025c627f704b436727385d78e08768c`; the commit the independent review and QA examined                                        |
| `7e8169571b3acec899aa1f509f01d64922320f76` | Review nits R1 to R3 (test escape and assertions, guide guard wording); no product code change                                                              |
| `a93580d87119de2fdf7a2ff622b66ed054cb44a0` | Merge of main `4e1037c9e9922ffa27237fe79850403b6b54fc70`; the only conflict was `CHANGELOG.md`, resolved as a union with main's entries kept in their order |

The branch differs from main only in the five #538 paths: `apps/api/src/reset/reset.ts`, `apps/api/src/reset/reset-sidecars.test.ts`, `docs/guide/08-offline-upgrade.md`, `docs/decisions/ADR-0042-explicit-resets-replace-conversion.md` and `CHANGELOG.md`. [MANIFEST.json](MANIFEST.json) records their SHA-256 at the merge commit and the SHA-256 of every retained file.

## Author evidence

The author ran on Windows 10.0.26300, Node v22.23.4, on an NTFS G: volume. The full report is [raw/author/AUTHOR-REPORT.md.txt](raw/author/AUTHOR-REPORT.md.txt), kept byte for byte.

- **Focused reset tests:** 229 passed and 5 skipped (12 files). The new `reset-sidecars.test.ts` runs 66 cases on Windows: 63 pass and 3 skip. The skipped ones cover a case-sensitive directory, a FIFO and the outside-Windows refusal, and run on non-Windows CI.
- **API gates:** typecheck, lint and Prettier passed ([final-gates.log.txt](raw/author/final-gates.log.txt)).
- **API coverage:** run under the shared heavy-suite lock ([coverage-api.log.txt](raw/author/coverage-api.log.txt), [coverage-summary.api.json](raw/author/coverage-summary.api.json)).
  - 2,353 tests passed and 43 skipped.
  - Package: lines 94.56% and branches 90.16%.
  - `reset.ts`: lines 98.47% (453/460) and branches 94.31% (398/422).

### Native verifier: `verified:false`, a defect in the verifier

The author read the prepared [verify-native-candidate.mjs](raw/author/verify-native-candidate.mjs) in full and found it safe. It runs only on disposable stores under its own folder, strips `GG_*` and provider variables, and never touches an owner store. The author ran it once (its maximum) against the built API at base `14ea6984` plus the then-uncommitted candidate. It ran from a byte-identical copy in the author's evidence folder, because it writes next to itself.

It exited 1 with `verified:false, sourceUntouched:true` ([stdout](raw/author/native-verifier.stdout.log.txt), [raw result](raw/author/NATIVE-CANDIDATE-RESULT.json)). It covered three cases: an ordinary store, a root earlier hard link and a nested later hard link. Each case used the built CLI, the default private-copy reader and a real seeded format-3 WAL. Every product criterion held:

- the kernel link witness held, and the dry run changed nothing;
- both calls read format 3 and exited 0 with empty stderr;
- Removes listed the intended WAL;
- the root link was kept as `another name for graphgoblin.db-wal`, with the same bytes and identity;
- the recorded workspace and the intended WAL were removed;
- `master.key` and the owner notes were unchanged.

The only failing criterion is `privateCopyResidue.length === 0`. The scratch folder held `tsx-98jak`: 133 tsx compile-cache files, all written before the first store existed. The verifier puts `TEMP=scratch` into the environment it passes to the tsx-run seeder, so the seeder's cache lands in the folder it later checks for reset residue. The earlier probe spawned the seeder without that environment. The built CLI never loads tsx. The independent review confirmed this explanation. The verifier was not rerun, patched or replaced.

## Independent review (Claude, independent of the author)

Verdict: **no blocking findings**, ready for opposite-family review: no P1 or P2 findings, only P3 ([raw/review-qa/REVIEW.md.txt](raw/review-qa/REVIEW.md.txt)). The review read every contract point against the diff and found each met.

| ID  | Finding                                                                                                                | Disposition                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| R1  | The Kelvin look-alike comment claimed an escape that the code did not use                                              | Fixed in `7e816957`: `'\u212A.db-wal'`, keeping the guard that it differs from ASCII       |
| R2  | The order matrix asserted the exit code before stderr, losing a refusal's text                                         | Fixed in `7e816957`: `{ code, err }` asserted together for the dry run and confirmed reset |
| R3  | The guide said a guard-name overlap is refused "naming both"; the earlier lock check refuses it, naming only the guard | Fixed in `7e816957`: the guide states the earlier lock refusal accurately                  |
| R4  | One intermittent focused-run failure, cause not established (provisional)                                              | Open an issue only if it recurs; see the R4 record below                                   |
| R5  | The Windows-only native final-path proof runs in no CI job                                                             | Deferred to an issue (pre-existing CI venue gap); not filed by this packet                 |
| R6  | `listedName` still takes the first identity match for the reserved roots (wrong manifest label, no wrong removal)      | Deferred to an issue (pre-existing, outside #538); not filed by this packet                |
| R7  | A `master.key` hard-linked to a removed sidecar is labelled `another name for <sidecar>`                               | No change: its bytes survive, and the configuration is pathological                        |

## Independent QA: 62 of 62, PASS WITH LIMITS

[raw/review-qa/QA-REPORT.md.txt](raw/review-qa/QA-REPORT.md.txt) covers `qa:touched-systems`.

- **Build:** QA built the API under the heavy-suite lock and showed `reset.js` and `tree.js` byte-identical to a fresh compile of `230640ae`.
- **Cases ([case table](raw/review-qa/case-table.generated.txt), [CLI results](raw/review-qa/QA-CLI-RESULT.json), [controlled results](raw/review-qa/QA-CONTROLLED-RESULT.json)):** all ran on real NTFS fixtures with hard links, `fsutil hardlink list` witnesses, file IDs, nlink and SHA-256.
  - 30 built-CLI success cases;
  - 20 built-CLI refusal cases, each run as a dry run and as a confirmed reset with exact text and an unchanged tree;
  - 12 controlled in-process cases: native final-path failures, locked-replan ambiguity, and configured/stored short-name disagreement through one lstat alias.
- **Scripts:** under [raw/review-qa/scripts](raw/review-qa/scripts/qa-538-cli.mjs). They keep their original local paths and promise no portable replay.

Not established:

- 8.3 short names: none issued on G:, and the volume policy query was denied. The disagreement is controlled only.
- Case-sensitive directories: enabling the attribute needs elevation.
- macOS, Linux, SMB, ReFS and non-NTFS volumes.
- A real, unmocked native-query refusal.
- An external race at unlink time.
- API coverage on ubuntu.
- The cause of R4.

## R4 provisional flake record

In QA's first `vitest run src/reset/`, `reset-sidecars.test.ts > root -journal, other hard link: none` returned exit 1 from the confirmed reset. Its stderr was not captured, because the test asserted the exit code first.

- **Original record, verbatim:** [focused-reset-tests.log.txt](raw/review-qa/focused-reset-tests.log.txt) and [FAILURE-CONTEXT](raw/review-qa/focused-reset-tests.FAILURE-CONTEXT.txt).
- **Host load:** another worker's API coverage run held the shared heavy-suite lock at the time.
- **Passes after it:**
  - the single labelled re-run ([diagnostic-rerun-01](raw/review-qa/focused-reset-tests.diagnostic-rerun-01.log.txt));
  - 80 isolated source replays and 240 replays alongside real private-copy reads in one TEMP ([D1](raw/review-qa/DIAG-D1-loop-alone.json), [D2](raw/review-qa/DIAG-D2-loop-with-reader-churn.json));
  - six built-CLI journal runs;
  - after the R2 fix, both follow-up focused runs and the post-merge run: 229 passed and 5 skipped each ([run 1](raw/author-followup/followup-focused-reset-run1.log.txt), [run 2](raw/author-followup/followup-focused-reset-run2.log.txt), [post-merge](raw/author-followup/post-merge-gates.log.txt)).
- **Cause:** not established. It is not the #489 reset-tree rename EPERM, which did not occur in any run. With R2 fixed, a recurrence now prints the refusal text; record it under #489's rules and open an issue then.

## Follow-up and post-merge checks

- **After the nit commit:** focused reset tests passed twice. API typecheck, lint and scoped Prettier passed ([followup-gates.log.txt](raw/author-followup/followup-gates.log.txt)).
- **After the merge at `a93580d8`:** focused reset tests (229 passed, 5 skipped), API typecheck, API lint and `pnpm format:check` passed ([post-merge-gates.log.txt](raw/author-followup/post-merge-gates.log.txt)).
- **Not repeated:** API coverage after the test-only nit and the merge; main's merged changes touch no reset path.

## Remaining gates

The opposite-family GPT review, current-target CI on the exact head, and the fresh Astra MAX final audit remain. Owner acceptance is separate.

Raw files keep their recorded bytes (`raw/** -text !eol -whitespace`). Markdown originals use `.md.txt`, and logs use `.log.txt` because the repository ignores `*.log`. Paths inside raw files are the original local paths.

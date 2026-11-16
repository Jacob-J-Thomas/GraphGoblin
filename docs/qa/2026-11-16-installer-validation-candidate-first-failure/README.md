# #436 hosted installer candidate first failure

This packet preserves the first hosted candidate-first installer matrix for issue #436 on PR #497. The matrix failed one required case. The root receipt accepts the evidence packet and explicitly withholds engineering acceptance. This is not a candidate pass, complete CI result, or owner acceptance.

## Result

The hosted PowerShell 7 matrix recorded 32 cases: four supported installs passed, 27 refusal cases met their criteria, and case 06 failed the missing-Node diagnostic requirement. The failure happened before the guarded installer body: with no `NodePath` and an unusable process `PATH`, strict mode surfaced a null `.Source` property error instead of actionable Node 22.22.2 guidance. Case 06 did not mutate tracked artifacts.

All 28 nonzero requests preserved their tracked file bytes and identities. The driver made 49 direct calls, ran for 313.0259882 seconds, exited 1, and closed both streams. Independent process readback closed 399 driver-rooted lifetimes with zero ETW loss and no observed gateway or Chrome starts. These results document the failed candidate only.

The ordinary Windows suite passed 18 tests, including its separate Windows PowerShell 5.1 installer regression. The 32-case hosted matrix itself ran under PowerShell 7; that ordinary regression does not establish a PowerShell 5.1 hosted matrix. The composed rollback step and its upload were skipped. The correction and corrected hosted matrix are outside this packet and are not verified here.

## Evidence

- [Byte-exact original full report](full-report.md.txt). Its relative links retain the source packet context; use the links in this README to open packet copies.
- [Case outcomes](evidence/case-readback.tsv), [binary and argv readback](evidence/binary-argv-readback.json), [independent trace readback](evidence/independent-readback.json), and [driver disposition](evidence/execution-disposition.json).
- [Windows job log](evidence/windows-job.decoded.log), [completed Windows job metadata](evidence/windows-job.json), [run snapshot](evidence/actions-attempt1.json), [jobs snapshot](evidence/attempt1-jobs.json), and [artifact metadata](evidence/artifact-14204465794-metadata.json).
- [Independent reader scripts](evidence/verify-binaries-and-argv.py) and [retained artifact reader](evidence/verify-retained.py) are preserved with their readback results. The [rollback reader](evidence/verify-rollback.py) was prepared but not run because rollback was skipped.
- [Exact hosted artifact ZIP](artifact/artifact-14204465794.zip): 1,668,141 bytes, SHA-256 `ba67360d9cad393bcafc8ccdf5e5f4d0f06f13a8e451354d49d39d70ef49e44b`; its [899-member inventory](artifact-member-inventory.json) is retained. The 899 extracted member files are not duplicated in this packet.

## Provenance and limits

The [root evidence receipt](provenance/436-candidate-first-root-acceptance.json) records failed-candidate evidence acceptance with engineering acceptance withheld. It binds run 43819015672, attempt 1, Windows job 133137523340, artifact 14204465794, and the tested merge/tree. It also records the case counts, independent readback, skipped rollback, and remaining limits. The Windows job concluded failure; the run metadata snapshot was captured while other jobs were still in progress, so it does not establish final green CI.

The [source-copy map](source-copy-map.json) gives each direct copy's source path, destination, byte count, and SHA-256, identifies omitted connector wrappers, and records the ZIP member mapping. The [original source seal](source-SHA256SUMS.txt) is preserved byte-for-byte with 920 rows. [SHA256SUMS.txt](SHA256SUMS.txt) seals every retained packet file except itself. This packet deliberately omits the 899 extracted ZIP members; use a separate disposable directory if you need to rerun the offline readers.

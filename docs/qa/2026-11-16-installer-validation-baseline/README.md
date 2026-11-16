# #436 hosted installer baseline

This packet records the accepted old-source reproduction on PR #497. It is evidence of baseline defects, not a product pass. The original full report is preserved byte-for-byte as [full-baseline-report.md.txt](full-baseline-report.md.txt); its relative links retain their original source context. The links below point to this packet's copies.

## Result

The Windows-only attempt 2 completed the full 32-case installer matrix under x64 STA PowerShell 7.6.9 on hosted Windows Server 2025:

- Four supported routes passed, six existing refusal cases met their expected checks, and 22 cases exposed baseline differences.
- Eight invalid requests returned exit 0. Seventeen invalid cases changed final file bytes or presence.
- The ordinary Windows suite passed 17 tests on attempt 2. The earlier ordinary native failure is documented in the [ordinary native gate failure packet](../2026-11-16-installer-validation-native-gate-failure/README.md).
- The run's Gates job was carried forward as cancelled from the earlier attempt. The separate [Gates deadline packet](../2026-11-16-installer-validation-gates-deadline/README.md) records its 30-minute timeout. The overall CI run was not all-green.

The readback covers 303 before/after file copies and 90 valid seed copies. The 49 direct driver calls finished with separate process and stream-close evidence. ETW recorded 415 starts and 420 ends with zero event, log-buffer, or real-time-buffer loss; all 376 driver-rooted starts had a matching end before the closing canary. The strict 310-second schedule used 304.77 seconds, leaving about 5.23 seconds.

## Limits

- This matrix ran only under PowerShell 7.6.9. Permanent candidate regression coverage for Windows PowerShell 5.1 remains required.
- The Chrome proxy used a synthetic profile; this was not a browser-created PWA.
- Case 31 changed the disposable hosted profile's Desktop fallback link. The changed Desktop was retained for hosted VM teardown.
- A separate rollback challenge remains pending.
- The baseline contains old-source defects and does not establish current candidate correctness or acceptance.

## Evidence

The [root acceptance receipt](provenance/436-baseline-retry-root-acceptance.json) accepts the baseline reproduction and implementation release evidence, with the limits above. The full source packet's [934-row SHA seal](source-SHA256SUMS.txt) is preserved. The 913 extracted artifact members are not duplicated: [artifact-14199184120.zip](artifact/artifact-14199184120.zip) is retained once and its [member inventory](artifact-member-inventory.json) maps their names, sizes, and hashes to the ZIP.

Review entrypoints: [case outcomes](evidence/case-readback.tsv), [binary and exact argv readback](evidence/binary-argv-readback.json), [independent trace readback](evidence/independent-readback.json), [timing](evidence/timing-readback.json), and [full Windows job log](evidence/windows-job.decoded.log). The [source-copy map](source-copy-map.json) explains each copy and the ZIP-member mapping. [SHA256SUMS.txt](SHA256SUMS.txt) hashes every file in this publication packet.

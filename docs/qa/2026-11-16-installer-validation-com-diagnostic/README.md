# #436 hosted COM fixture diagnostic

This packet preserves the two-case hosted COM diagnostic for the #436 Windows installer baseline. It localizes a filename difference in the tested WSH shortcut creation path; it does not run installer cases or implement a fix.

## Hosted result

Windows job 133083194588 completed successfully in attempt 1 of Actions run [43801684182](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43801684182/job/133083194588) on test-only head `26b245315f353c07d1b5f55f2885a156779be5e3`. Its synthetic checkout was `0d1435f45b57b95fa7397111c4e07eae067a7ac2`, tree `7cbb7177aa24d681cf40f6a6372c63e9d3518678`, with actual target `be633141be5a0cd2b4f960a46761fabbf2cb82c7` and head as its ordered parents. The existing native launcher suite passed 17/17. The diagnostic child exited 0 and closed both empty output streams.

For Unicode `Chrome α.lnk`, WSH `Save()` returned true but produced `Chrome a.lnk` (Latin `a`); the requested Greek-alpha path was absent. Read and write property-store opens at the requested path returned `0x80070002`; neither `SetValue` nor `Commit` ran. For ASCII `Chrome A.lnk`, the exact path existed and the write/read property-store sequence returned success; variant type 31 returned `GraphGoblin.QA436.Source`.

This is a two-case fixture diagnostic only. It did not run the installer matrix, verify a product fix, or admit implementation or a corrected baseline execution. The root [diagnosis readback](provenance/436-com-probe-root-diagnosis.json) records the same narrow scope and the exact run, merge, ZIP, and case readbacks.

## Evidence and limits

The [sealed QA report](report/README.md.txt) contains the detailed case receipts and interpretation. The [Windows log](evidence/windows-job.decoded.log) is preserved byte-for-byte. The [artifact ZIP](evidence/artifact-14196488008.zip) is 12,003 bytes, SHA-256 `379eacb368041dbce1cb11b22aabd09aa4a65e46c06010524f5279a5829a98ef`, with 31 members. The [member inventory](evidence/artifact-member-inventory.json) and [source-copy map](source-copy-map.json) map those members; extracted files are not duplicated. The 46-row original source manifest is retained, and every row was checked against a byte-exact copy or archive member.

The independent readback's initial error and corrected offline comparison remain separate from hosted execution. This packet excludes the observer-v2 preparation/replay, signed URLs, provider event streams, databases, stores, and credentials. The [packet SHA-256 inventory](SHA256SUMS.txt) covers all packet files except itself.

# #436 first hosted execution evidence

This packet preserves the first hosted Windows attempt for the #436 Windows installer baseline. It records an execution/setup failure, not a product baseline, implementation, or review verdict.

## Hosted result

GitHub Actions run [43799391366, attempt 1](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43799391366/job/133075561392), Windows job 133075561392, used PR #497's test-only head `e84bb30388eead8b1ab06d781f80d291dcc4b8bb` against target `be633141be5a0cd2b4f960a46761fabbf2cb82c7`. The checkout was synthetic merge `fa6f545652ce10fcae7add8f5920ff6b4dc20ba2`, tree `60f594988ecb84f168eb9705026d6b7965a2c7ca`, with target then head as ordered parents. The build completed with Node 22.23.4. The existing native Windows launcher suite passed 17/17, with no skips.

The #436 driver then stopped during fixture creation at `New-Link` / `WriteAppId`, HRESULT `0x80070002`; it recorded **0/32 cases**. No installer matrix or #436 product behavior ran, and the attempt was not retried. This is not a passing or failing product-baseline result.

## Failure sequence and bounded offline evidence

The sealed [final report](report/README.md.txt) preserves the exact process evidence, limits, and proposed next diagnostic. The [earlier report snapshot](report/README.before-header-qualification.md.txt) is retained separately; the final report adds the XML PartitionInfo header-extension decode-error qualification. The original [job log](evidence/windows-job.decoded.log) is retained byte-for-byte, including its BOM and final CRLF.

The driver failed first in fixture creation. After it exited, the supervisor's original decoder/observer step separately failed its selector with “Native decoder produced no classic process-start payloads with argv fields.” The first offline observer correction still had missing ancestry/lifetime assertions; the later corrected offline ordering matched both canaries, the driver and eight descendants during the failed setup interval. These are offline interpretations of archived ETW bytes, not a successful hosted observer, installer run, or product test. The original hosted observation receipt remains incomplete.

## Artifact and integrity

The [hosted artifact ZIP](evidence/artifact-14195238640.zip) is 217,083 bytes, SHA-256 `27c3c8f71de948fac7c028130c722a6b930dfaa5357603863ab71b387a7afb88`, with 65 members. Its bytes match the separate root ZIP by hash. The [member inventory](evidence/artifact-member-inventory.json) records each member. The extracted member files are not copied again; the [source-copy map](source-copy-map.json) lists their paths, sizes and hashes and maps each to the exact ZIP member. The original 92-row source manifest is retained; all rows were checked against copied files or their archive members. Raw Markdown copies use `.md.txt` names. The [root acceptance receipt](provenance/436-first-hosted-root-acceptance.json) accepts the underlying failed hosted attempt/report and bounded offline trace only; it records no product implementation or diagnostic execution admission. It does not accept this publication packet. No signed download URLs, provider event stream, database, store, or credentials are included.

The [packet SHA-256 inventory](SHA256SUMS.txt) covers every packet file except itself. This archive does not claim that the 17 original launcher tests cover #436's installer matrix, nor that the offline process trace completes the missing hosted observation.

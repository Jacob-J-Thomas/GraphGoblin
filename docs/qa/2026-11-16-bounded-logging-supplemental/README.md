# PR500 supplemental behavior QA

Independent Claude Code Opus 5.5 xhigh ran the five supplemental modules once against frozen candidate `1c04263bcbfd93056e77ee98a9c5d705df26ea88`. All 34 case groups passed. Two local file/dangling-symlink variants were not exercised because Windows refused fixture creation with EPERM. The report distinguishes native processes, controlled production seams, compiled controls, fault-injected builds and source-only checks; it is not owner acceptance or a formal review.

Read the [complete original report](report/full-report.md.txt), [case/process analysis](report/analysis.json), [evidence inventory](report/evidence-inventory.json) and [reporter exit](report/exit.json). The report records 392 child executions with matching exit/close and complete streams, 18 gateway drains, 53 refused fixture ports, ten released holders, 54 exclusive store-file opens and 18 retained known fixture links. Its native, controlled and sampled-observation qualifications remain unchanged.

## Complete raw evidence

The [lossless evidence ZIP](supplemental-evidence.zip) contains all **2,324 files / 7,247,588 uncompressed bytes** of the reviewed supplemental packet, including all 2,211 inventoried per-case files, 32 invocation records and 30 wrapper receipts. Every ZIP member was read back and matched its original size and SHA-256. [Archive/member index](archive-members.json) · [Original packet checksum list](source-packet-SHA256SUMS.txt) · [Original source-copy map](source-copy-map.json)

The ZIP preserves member paths and file contents exactly; timestamps are normalized. Its inner `README.md`, source maps and original manifests remain unchanged. The source-copy map's destination paths name ZIP members. Selected report and inventory files are also available directly above, with identical bytes. Extract the ZIP into a separate empty review directory to inspect the original packet; do not extract over a working checkout or an existing evidence directory.

This packaging keeps the PR below GitHub's [3,000-file listing limit](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests-files) while retaining the complete raw packet. The reused V3/V4 harness references remain in the sibling [core archive](../2026-11-16-bounded-logging-core/README.md).

Fixture contents, keys, SQLite data and private provider-session streams remain excluded exactly as recorded in [exclusions](exclusions.json). The [bounded content-screen record](evidence-content-screen.json) describes its checks and limits. No native test, build or cleanup was repeated for packaging.

The report's [original 15-row seal](report/source-SHA256SUMS.txt) remains unchanged. This directory's [outer checksum list](SHA256SUMS.txt) covers its publication files. Product inputs remain frozen; current publication-head CI, opposite-family review, fresh Astra max sign-off and owner acceptance retain their separate gates. Formal scans used at this checkpoint: 0/3.

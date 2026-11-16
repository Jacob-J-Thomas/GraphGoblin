# PR #487 / issue #410 completion evidence

This packet records the independent final audit and verified completion of the terminal-wait change. It preserves the full Astra scan2 audit folder, its 52-row source manifest, and the final publication, merge, and issue readbacks. The earlier current-head CI and Opus scan1 packets remain separate sibling archives.

## Final audit and merged identity

- GPT-6 Astra at max effort completed formal scan 2 of the shared maximum of 3 with **SIGN-OFF** and no actionable in-scope blockers. The [full report](audit/full-report.md.txt) is 30,725 bytes, SHA-256 `e233b1cca80cda6b217e7316ea86a656b74ac61832dcd4c694a83d68a7d9ff43`.
- The [published full-report comment](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/487#issuecomment-6902325285) was read back exactly. The [root disposition](provenance/runtime-410-astra-root-disposition.json) accepts the SIGN-OFF and verifies the report and original manifest: 52 rows, 53 files including the manifest.
- PR #487 merged as `98692c8a8c7b519e8c83e585e026d595cedc0550` at 2026-11-15 22:21:44 UTC. Its tree `9439a500040aa4763613549cca6235023916de58` equals the reviewed head and tested synthetic merge. The actual parents are target `154401c7b47c1e56b62a6daec50e2a3145ea967d` and head `0d1b935988c4ff06f5091b645210b0cd88703a16`, in that order. The [merge readback](provenance/runtime-487-merge-readback.json) records the verified commit/tree/parents.
- Issue #410 was subsequently read back as closed/completed. See the [completion issue readback](provenance/runtime-410-completion-issue-readback.json) and [pre-merge readback](provenance/runtime-487-premerge-readback.json).
- This records #410 engineering delivery and closure. It does not claim owner acceptance or broader batch completion; #419 is the next delivery lane.

## Review, CI, and evidence qualifications

The [Opus scan1 archive](../2026-11-15-terminal-wait-opus-review/README.md) records Claude Opus 5.5 xhigh READY. The [current-head CI archive](../2026-11-15-terminal-wait-current-ci/README.md) records run `43758754651`, attempt 2, successful on tested merge `89fa84597f5aa124cf02d2fdebe27e4656ef1516`. These sibling packets are linked rather than duplicated here.

The Astra disposition retains four observations from Opus: O1 is an evidence qualification; O2 needs no product change; O3 is a limitation because native W1–W4 do not claim failed-parent resume; O4 requires no code change and records the synthetic history seed as retained externally through final audit. No owner resource was changed.

For O1, the earlier literal-old-source unit log used a pre-final test draft (assertion line 752, versus line 760 in the committed test). The committed-test probe emulates only the old failed-transition arguments: it produced two expected failures, then the candidate control passed both cases. This establishes sensitivity, but it is not a literal old-source checkout or rebuild. No formatting cause is assumed. The original log remains intact in the implementation evidence, and the probe is preserved in the [Opus archive](../2026-11-15-terminal-wait-opus-review/README.md).

The Astra report preserves two inspection-tool errors and their corrections. They concern the offline MCP comparison and ANSI-wrapped CI count parser, not product execution; the first outputs remain present. The report explains both, and the source folder copy retains the scripts, error files, and corrected readbacks.

## Preserved audit materials

- `audit/` contains all 53 files from the sealed Astra scan2 directory, including the full diff, changed-path inventory, admitted input/build/CI/native evidence inventories, remote snapshots, job logs, inspection scripts and initial error outputs.
- The original [audit source manifest](audit/SHA256SUMS.txt) is preserved byte-for-byte. Its 52 rows validate the original source names. The raw `full-report.md` and `commands.md` were copied byte-for-byte as `.md.txt`; [source-copy-map.json](source-copy-map.json) records each rename and source hash.
- `provenance/` contains the Astra admission and brief, root sign-off disposition, exact published-comment readback, pre-merge PR readback, actual merge readback, and issue completion readback.
- The [checksum manifest](SHA256SUMS.txt) verifies the files in this packet, including the preserved audit manifest, but not itself.
- No database, WAL/SHM sidecar, or private history seed is copied. Existing CI and Opus artifacts remain in their linked packets.

## Related evidence

- [Baseline](../2026-11-15-terminal-wait-baseline/README.md)
- [Implementation](../2026-11-15-terminal-wait-implementation/README.md)
- [Candidate native QA](../2026-11-15-terminal-wait-candidate/README.md)

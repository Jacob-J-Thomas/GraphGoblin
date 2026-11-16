# PR #487 Opus review — scan 1 of 3

This packet archives the first formal review of the terminal-wait change. Claude Opus 5.5 (`claude-opus-5-5`) at xhigh completed with process exit 0 and returned **READY**. The review found no current contract blocker. This is scan 1 only; it is not owner acceptance or merge authorization.

## Reviewed identity and disposition

- PR #487 head: `0d1b935988c4ff06f5091b645210b0cd88703a16`; target: `154401c7b47c1e56b62a6daec50e2a3145ea967d`.
- Tested merge: `89fa84597f5aa124cf02d2fdebe27e4656ef1516`, with the target and reviewed head as parents and tree `9439a500040aa4763613549cca6235023916de58`.
- CI run `43758754651`, attempt 2, was successful on that tested merge, as recorded in the report and admission.
- The root disposition records O1 as an evidence qualification, O2 as no change, O3 as a native-evidence limitation, and O4 as no change while the synthetic private-history seed remains external through the final audit. At that scan1 disposition snapshot, Astra max scan 2 and merge were pending; this packet does not update their later status.

## O1 probe qualification

The earlier literal old-source log discussed in the report used a pre-final test draft: the relevant assertion was at line 752 in that draft and line 760 in the committed test. It must not be conflated with the included probe logs.

The four included probe files use the committed test. `old-source-emulation.setup.ts` conditionally removes only an own `waiting: undefined` member from failed transitions in the in-memory repository. With emulation enabled, [01-emulated-pre-410.log](probes/01-emulated-pre-410.log) records the two expected failures (live execution and recovery); [02-candidate-control.log](probes/02-candidate-control.log) records the two passing candidate cases. This is a focused old-transition emulation, not a checkout or rebuild of literal old source. The original draft-log qualification remains in the full report.

## Archive contents

- [Full reviewer report](review/full-report.md.txt) — verbatim Markdown bytes, stored with `.txt` so it is treated as raw evidence.
- [Provider terminal summary](review/provider-final-message.md.txt) — a separate concise result, not a substitute for the full report.
- [Launch](review/launch.json), [provider result](review/result.json), [process exit](review/exit.json), and [stderr](review/stderr.log).
- [Probe setup](probes/old-source-emulation.setup.ts), [probe config](probes/probe.config.mjs), and both focused logs.
- [Admission](provenance/runtime-410-opus-admission.json), [root disposition](provenance/runtime-410-opus-root-disposition.json), [published comment readback](provenance/runtime-410-opus-comment-readback.json), and [PR body readback](provenance/runtime-487-pr-body-after-opus-readback.json).
- The [published review comment](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/487#issuecomment-6901983201).

## Copy integrity and exclusions

The [source-copy map](source-copy-map.json) maps each copied evidence file to its source path, size, and SHA-256. The [checksum manifest](SHA256SUMS.txt) covers the packet files other than itself. The raw provider event stream (`review-410-opus-scan1/events.jsonl`, 1,860,718 bytes, SHA-256 `6427de7b10699da9d32d63b3171ee2a6cd2e0f158caf3c4048dd986ae4f859d5`) and the probe Vitest cache (one file, 112 bytes) remain external and are not copied into this packet.

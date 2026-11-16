# Bounded logging correction implementation

This packet preserves the implementation handoff checkpoint. Its pending-build and QA statements below describe that checkpoint. Later forced build, native compilation and independent affected QA are recorded in the [correction QA packet](../2026-11-16-bounded-logging-correction-qa/README.md).

**State:** external evidence archive of the completed #438 implementation handoff. This packet preserves its original report, source diff, command logs, and provider completion metadata. It does not establish a full build, native acceptance, current-head CI, independent QA, or formal review.

## Source state and changes

The implementation session started from clean HEAD `4dbb0dc185a9419fcebabd85e199dd554c382b4f`, tree `6fb222d5b1e70ae6aa16c9702a36f12241c82a89`, in a sparse worktree. At handoff it remained on that HEAD and tree with 15 uncommitted changed files. [`source/source.diff`](source/source.diff) and [`source/changed-files.txt`](source/changed-files.txt) preserve that state; the original detailed report is copied byte-for-byte as [`source/implementation-report.md.txt`](source/implementation-report.md.txt). Root later verified the final source diff against that handoff: its only source-text delta is the one-word gateway-log clarification documented in [`root-copy-clarification.md.txt`](root-copy-clarification.md.txt). The root-captured final diff and 15-file SHA inventory are [`final-source/root-final-source.diff`](final-source/root-final-source.diff) and [`final-source/root-final-source.json`](final-source/root-final-source.json). Root committed this final source locally as `1a46c3074e6862d3fb3186fe6cb83b7ee1d890f9` (tree `e4a8c9f818dfdc9720f420ac84cf6862c0f85c16`, parent `4dbb0dc185a9419fcebabd85e199dd554c382b4f`); it was not pushed or integrated. No build, C# compilation, native acceptance, or CI result is established for that final commit.

The handoff implements three corrections:

1. **Managed HTTP parser-error privacy:** the managed Fastify path logs only the safe parser outcome fields (`statusCode` and a validated error `code`) rather than serializing the parser error and its `rawPacket`. Ordinary Fastify construction keeps its default handler. The report describes the exact 400/431 wire responses, log checks, and first red failure.
2. **Retained encoded-data cap:** the writer dequeues and coalesces records synchronously before awaits, then retains the single write buffer until settlement. The report describes the held-write and rollback tests, the first red failures, and the remaining source-reasoning limits.
3. **Truthful destination-conflict text:** the launcher message and documentation no longer assert that a GraphGoblin process is the holder when it was not identified. Launcher return codes and ownership logic were not changed in the handoff.

The original implementation report and `source.diff` remain historical 16:26 handoff bytes. The later clarification says the launcher may record the refusal in its own log, so the final C# wording is “no gateway log file was changed.” The final-source pair above captures the locally committed version with that wording; compilation, native QA, and CI remain pending.

## Recorded checks and qualifications

The final focused API run recorded **58 passed and 1 pre-existing skip**. The skip is the symlink test skipped on `EPERM` without the relevant privilege. The API no-emit typecheck, scoped API/tooling lint, Prettier checks, and `node --check` for the acceptance script exited 0. No coverage was measured.

The repeat log (`source/logs/09-repeat-new-tests-x5.txt`) contains five iterations. I checked the individual output: every iteration printed four targeted tests passed, two test files passed, and 44 tests skipped. The recorded loop pipes output through `grep`, so its outer exit status alone would not establish those results; the per-iteration summaries are the evidence.

The focused writer suite also ran its existing Windows PowerShell file-holder test, which passed. Thus the provider-final message’s statement that there were no process actions is not literal: a test helper process did run. This was not a product gateway or native launcher acceptance run.

The preserved first failures remain visible in `source/logs/01-red-parser-serve-test.txt` and `source/logs/02-red-writer-test.txt`. The parser failure logged the synthetic 177-byte packet; [`source/red-rawpacket-decoded.txt`](source/red-rawpacket-decoded.txt) is its manifest-bound decode. The writer failure showed retained buffers reachable and caused `afterEach` timeouts while its gates remained held. The corrected tests added `try/finally` release without changing the assertions.

## Not established by this packet

The C# changes and added `NativeChecks` assertions were not compiled or run. The acceptance-script expectation changes were linted and syntax-checked, but the acceptance suite was not run. No `tsc -b`, coverage, full API suite, native launcher QA, browser/image job, CI run, or independent review is included. The focused test did invoke a real managed `serve()` parser path, but it is not the launcher-started native gateway check.

## Packet contents and provenance

- [`source/original-source-SHA256SUMS.txt`](source/original-source-SHA256SUMS.txt) is the original implementation manifest, copied exactly. Its `README.md` row maps to the byte-identical renamed report `source/implementation-report.md.txt`.
- [`provider/launch.json`](provider/launch.json), [`provider/exit.json`](provider/exit.json), and [`provider/provider-final-message.md.txt`](provider/provider-final-message.md.txt) are exact copies. The final message is separate from the detailed implementation report.
- [`source-map.json`](source-map.json) maps every copied source path to its destination and hashes. [`SHA256SUMS.txt`](SHA256SUMS.txt) hashes every packet file except itself.
- Provider `events.jsonl` and `result.json` are excluded as private session/stream data; `latest.md` duplicates the final message; `stderr.log` is empty and outside the requested evidence set. Excluded file sizes and hashes are listed in the source map without copying their contents.

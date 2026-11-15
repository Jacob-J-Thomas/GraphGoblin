# Runtime failure implementation handoff (#381 / #414)

This packet preserves the accepted implementation source and its scoped local checks for the mutation and failure-diagnostic work. The immutable source commit is `615d50bc358d73bc55ad0591f4f625f1a46cb671`, tree `b11616a3087ef47d103a5cb40c07706008a810b5`, parent `f91bd69b79dc417a2997ddb9c7670cb33df7597c`. Root accepted 29 changed paths with a 97-entry SHA-256 manifest. The [source acceptance](provenance/runtime-381-source-root-acceptance.json) and [commit readback](provenance/runtime-381-source-commit.json) preserve that boundary.

## Implementation and local checks

The [immutable implementation folder](implementation/) contains the original 97 manifest-bound files, the manifest, final source copies, patch, and 20 check receipts with their raw stdout/stderr. Markdown sources are copied byte-for-byte as `.md.txt`; the [source-copy map](source-copy-map.json) maps their original manifest paths to packet destinations. Script, TypeScript, patch, JSON, and log bytes retain their original names and content.

The retained local results include:

- `04-candidate-focused`: 1,070 tests passed in 12 files.
- `09-domain-coverage-isolated`: 460 tests passed in 29 files; 98.74% line and 95.98% branch coverage.
- `13-engine-coverage-final`: 1,812 tests passed in 66 files; 96.94% line and 91.22% branch coverage.
- `01-old-source-regressions`: 504 failures and 440 passes on the old-source baseline. Its separate [readback](provenance/runtime-381-red-log-readback.md.txt) and [root acceptance](provenance/runtime-381-red-log-root-readback.json) preserve the 488 matrix rows, 16 targeted failures, and incomplete expanded diagnostics.
- `08-full-check`: failed during coverage after typecheck, lint, layer, migration, token, and dependency checks completed. It recorded domain ADV-007 (`result.status` expected `0`, received `null`) plus partial failing output from engine, infrastructure voice/chat-audio, adapter-codex probe, and plugin-claude. The [offline readback](provenance/runtime-381-full-check-readback.md.txt) records completed packages and evidence limits; causes for the unaffected-suite failures remain unknown. Later isolated domain and engine results are listed above. This packet does not claim that `pnpm check` passed.

## Candidate build and scope

The candidate build receipt records `pnpm.cmd build --force` on Node `v22.23.4`, with 12 tasks, zero Turbo cache hits, and normal TypeScript incremental behavior. The receipt, log, launch, input, and [root build readback](provenance/runtime-381-candidate-build-root-readback.json) are included. The readback records the candidate binding digest; this packet does not duplicate the full binding, which is retained with the later candidate QA evidence.

The host-load sample at 15:40:34Z and Node-process readback at 15:42:16Z were captured after the full check ended at 15:40:05Z. They are post-run context and do not establish load or process state during check 08.

This is implementation and local-check evidence. It contains no candidate native QA result, current-head CI result, or independent formal review. The separate [runtime failure baseline packet](../2026-11-15-runtime-failure-baseline/README.md) preserves the accepted pre-change behavior baseline.

`SHA256SUMS.txt` covers packet files except itself. It verifies packet bytes; `implementation/SHA256SUMS.txt` retains the original 97-entry source manifest.

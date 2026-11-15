# Runtime failure candidate QA: #381 / #414

This packet records two separately admitted candidate executions for source commit `615d50bc358d73bc55ad0591f4f625f1a46cb671`, tree `b11616a3087ef47d103a5cb40c07706008a810b5`, parent `f91bd69b79dc417a2997ddb9c7670cb33df7597c`. Issue #414 was administratively consolidated into #381; this packet does not claim issue closure.

## Outcome and delivery state

Root accepted the one-shot functional run (18 scoped observations) and internal run (13 scoped observations). Both harnesses and supervisors exited 0, and root verified fixture cleanup. At this QA checkpoint, the source was frozen locally but not published or merged; current-head CI and independent formal reviews were pending. The full local `pnpm check` did not pass; its first failures and incomplete coverage are detailed in the [implementation packet](../2026-11-15-runtime-failure-implementation/README.md).

## Candidate build

The candidate build completed 12 tasks with zero Turbo cache hits using normal TypeScript incremental build. The single full [source/output binding](build/candidate-build-binding.json) has SHA-256 `27092d9c638a3b700be996ece33a41f4a06ddb685f32c28250083e7de0f581ed` and records 27,598 source files and 1,231 outputs across 13 trees. The internal post-binding root receipt confirms the same hash after QA; the full binding is included only once. Build and source handoff detail is in the [implementation packet](../2026-11-15-runtime-failure-implementation/README.md).

## Accepted candidate observations

- **Functional:** 8 native and 10 controlled API cases exercised real SQLite, the native gateway, REST, compiled stdio MCP, and a served Edge inspector. Root read three screenshot/DOM pairs and accepted all 18 observations. See the [full report](functional/execution-1/report.md.txt), [final case index](functional/execution-1/case-index.json), and [root acceptance receipt](provenance/runtime-381-functional-candidate-root-acceptance.json). Raw cases, result, and initial index/report are retained alongside them. The sequence wording was clarified after the run without rerunning the harness. Root also corrected a read-only verifier field comparison; that probe stopped before writing acceptance.
- **Internal:** 13 A3/A4 cases used the compiled RunManager, real handlers and per-case SQLite stores, controlled ports, synthetic historical payloads, and two actual local Node script controls. Root accepted the [full report](internal/execution-1/report.md.txt), [case index](internal/execution-1/case-index.json), and [root acceptance receipt](provenance/runtime-381-internal-candidate-root-acceptance.json). Raw case evidence is retained; cleanup readback confirms all 13 stores empty and all 17 recorded PID slots absent. No live provider turn was used.

These are bounded observations, not a blanket native runtime claim. Unreached producers and conditions remain scoped to the cited source/tests. Historical records were not rewritten. #410 stale-parent and #419 disconnect work remain outside this lane. The separate [baseline packet](../2026-11-15-runtime-failure-baseline/README.md) retains red-before results and cleanup history.

Raw Markdown and context sources are preserved byte-for-byte with a `.md.txt` suffix. `source-copy-map.json` records source/destination paths, byte counts and matching SHA-256 values; source paths are relative to the external evidence batch root. `SHA256SUMS.txt` covers every packet file except itself. The proposed register entry is [delivery-register-append.md](delivery-register-append.md); the canonical register is [docs/delivery/2026-11-13-four-intents-register.md](../../delivery/2026-11-13-four-intents-register.md).

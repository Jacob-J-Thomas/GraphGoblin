# Independent QA evidence for #363

The [original, byte-preserved REPORT.md](evidence/REPORT.md) records one native Windows run with **18 candidate controls and one expected baseline-defect control: 19/19 PASS, exit 0**. Candidate `76beeb0f2e99343697578c2713ac06f80d59e7b5`, tree `2544bc2913f9cec0d95a215ea631ab62c7985c1d`, has sole base `02351e2fb932b3be44e7cc3fb3943a61d568226c`. The report SHA-256 is `8c6687280286dcb81a97c5c261f858d39b5f45cc0bda3534013d49e930eab1f7`.

This packet establishes the scope and provenance of that independent QA. It does not close #363 or satisfy opposite-family review, exact-head/current-target CI, full coverage or a fresh independent Astra MAX final audit. It makes no API/browser, owner-acceptance or merge claim.

## Read and reproduce

| Purpose | Original evidence |
| --- | --- |
| Expected outcomes written before the first complete call | [predictions.json](evidence/predictions.json), [run-input.json](evidence/run-input.json) |
| Independently authored fixture and exact run command | [fixture-v1.mjs](evidence/fixture-v1.mjs), [run-native-01.ps1](evidence/run-native-01.ps1) |
| All 19 cases, native requests/errors/paths, ordering, sentinel preservation and cleanup | [observations.json](evidence/observations.json), [direct runtime JSONL](evidence/raw/native-run-01.jsonl), [partial observations](evidence/observations.partial.json) |
| Captured command result and its limitation | [PowerShell transcript](evidence/raw/run-native-01.transcript.txt), [post-run verbatim copy of recorded tool output](evidence/raw/run-native-01.tool-output.json) |
| Source and artifact binding | [source-binding.json](evidence/source-binding.json), [run-input.json](evidence/run-input.json), [source diff](evidence/raw/candidate.patch), [candidate source](evidence/sources/candidate-structured.ts), [base source](evidence/sources/base-structured.ts), [candidate tests read as context](evidence/sources/candidate-structured.test.ts) |
| Discovery/commands, fixture refinements and source claims | [command-ledger.json](evidence/command-ledger.json), [issue snapshot](evidence/raw/current-issue-363.json), [author report treated as claims](evidence/sources/author-REPORT-claims.md) |
| Source instructions and seal method | [AGENTS.md](evidence/sources/AGENTS.md), [issue workflow](evidence/sources/15-issue-workflow.md), [seal-evidence.mjs](evidence/seal-evidence.mjs) |

Replay requires native Windows and project Node `v22.23.4` (`pnpm 12.8.1` was recorded). The original driver imports the bound candidate TypeScript source using Node's `--experimental-transform-types`; it needs no installation or built application. Review its fixed checkout/evidence paths and use a separate fresh owned evidence directory before a replay. Preserve this archive unchanged. The original [run script](evidence/run-native-01.ps1) shows the complete runtime PATH and invocation. No behavior fixture was executed during publication curation.

## Evidence tiers and limits

The fixture calls the actual candidate's public `CodexStructured.complete()` with a local harmless HarnessPort. Native `mkdir`/`mkdtemp`/removal, long paths, collision sentinels and errors are observed on the filesystem. A separate real Node child verifies the exact 249-character allocated cwd under a 226-character root. The baseline is an exact raw Git-source copy imported from the evidence directory, not a production edit. Candidate source SHA-256 is `a471fdb0c9ce929620a9a27dea8d968ed88d131b55d86935eccf9adc9e93445e`; baseline source SHA-256 is `2536d0be91bf17d805a6392f69760f12ccfed728ca40a61f9eb065bd28eff2b0`. Their Git blobs are respectively `715141ca077d3e043bc455e9be5e5fe32e7ffa93` and `447ebfdaf45144221fded674b86f8e83ec704457`.

Collision names, abort/cancel timing and cleanup refusals are controlled. Existing directories, native EEXIST/ENOENT errors, marker survival and cleanup are native observations. The report does not claim a real Codex provider/SDK/CLI turn, unlimited long-path support, later child-file creation, or production cleanup success after a native removal failure. Six intentionally retained synthetic cleanup residues were observed and then recovered by the QA fixture. No numerical coverage, build, broad application regression, API/MCP/browser or external-provider evidence is present.

The independent worker was `i4_363_behavior_qa`. The [coordinator dispatch record](evidence/_provenance/i4-qa-dispatch-record.json) records **coordinator-dispatched GPT-6.1 Sol, xhigh** (`gpt-6.1-sol`, `forkTurns: none`). This records dispatch configuration; it is not a raw provider terminal/model envelope. There is no product-fixture provider model ID, because the fixture makes no provider call.

## Failures, refinements and capture provenance

The expected baseline `ENAMETOOLONG` is a successful discriminating baseline control, not a candidate failure. The command ledger records **one behavior run, zero failed driver runs and no post-execution fixture correction**. Before execution, authoring refined the path-padding loop, simplified owned-root teardown, and corrected the expected synthetic-residue count to six. Intermediate pre-execution script revisions are not retained; the executed fixture, its pre-call hash and all resulting native traces are retained.

PowerShell `Start-Transcript` captured shell metadata and exit status but omitted native stdout/stderr. The separate `run-native-01.tool-output.json` explicitly labels itself a post-run verbatim copy of the recorded tool result, not archived native stream bytes. Actual runtime events and native/control error stacks are in the directly written JSONL/JSON files. The command ledger is also explicitly reconstructed from tool inputs/results; initial read-only discovery stdout remains outside the sealed root in the agent tool history. No absent discovery transcript supports acceptance. The fixture was not rerun to improve capture.

The configured-cwd prediction mentioned both raw and JSON fallback, while those particular calls returned raw text. JSON fallback was observed in the separate fresh-per-call case. The original predictions and report remain unchanged, preserving this distinction.

## Complete sealed-root selection and integrity

All **23 original local members / 348,811 bytes** are included, plus the coordinator dispatch record (**1 file / 852 bytes**): **24 evidence files / 349,663 bytes**. No original member is excluded. This is a complete copy of the enumerated original QA root; it is not a claim that every interaction in the agent tool history was captured there. The fixture-owned scratch root had already been removed by the original QA and has no retained files to publish.

The [original manifest](evidence/manifest.json) enumerates 22 files / 344,976 bytes and excludes itself. All 22 length/hash entries replayed cleanly. Its SHA-256 remains `e4047b7378b612194b3f47ed11e19aac3f2c4d8f80f81c1b46524116ee844c9b`. The [member map](publication-index.json) adds the original manifest itself and hashes every copied member. [verification.json](verification.json) records the byte/hash replay, source-copy/prediction bindings and exact case inventory. [PUBLICATION-SHA256SUMS.json](PUBLICATION-SHA256SUMS.json) covers this packet, including new editorial metadata.

[disclosure-review.json](disclosure-review.json) records the bounded credential-pattern/context check. Absolute user, evidence, runtime and checkout paths remain intentionally as provenance. No live owner credential was identified. No original report, script, JSON, log, prediction or source copy was reformatted, sanitized, edited, moved or deleted. This assembly performed administrative reads, hashing and copies only; it did not mutate the repository, index, branch, issues or PRs.

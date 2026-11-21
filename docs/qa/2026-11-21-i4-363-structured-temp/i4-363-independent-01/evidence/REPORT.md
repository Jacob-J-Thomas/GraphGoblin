# #363 independent behavior QA

**PASS for the bounded allocator criteria:** 18 candidate controls and one expected baseline-defect control passed in a single native Windows run (19/19, exit 0). No candidate failure found. This report is independent QA by `i4_363_behavior_qa`, not the author report or a formal opposite-family review.

Candidate: **76beeb0f2e99343697578c2713ac06f80d59e7b5**, tree **2544bc2913f9cec0d95a215ea631ab62c7985c1d**, sole base **02351e2fb932b3be44e7cc3fb3943a61d568226c**. Checkout `G:/ggq/gg-i4-363-qa/GraphGoblin`, branch `codex/gg-i4-363-qa`; clean before and after. Source remained immutable. Current GitHub issue #363 and repository instructions were read; the copied author report was treated as claims.

## Execution and provenance

Native Windows `win32/x64`, Node **v22.23.4**, pnpm **12.8.1**. The only execution of the behavior driver used `run-native-01.ps1` with the project Node directory first on PATH, then `node --experimental-transform-types fixture-v1.mjs`. The driver imported the actual candidate's public `CodexStructured` class from its TypeScript source. All runtime imports in that source are Node builtins; no installation, application build or paid provider was needed.

Predictions and source hashes were written before the first `complete()` call. The base source was captured as raw bytes using `git show <base>:packages/adapter-codex/src/structured.ts` before execution and imported from the evidence directory. This baseline tier is an exact Git-source copy running natively, with no production source edit. Its blob is `447ebfdaf45144221fded674b86f8e83ec704457`; candidate blob is `715141ca077d3e043bc455e9be5e5fe32e7ffa93`.

The local harmless HarnessPort records public start requests, observes the actual directory, and returns controlled results or deferred cancellation. It never calls a Codex provider, SDK or CLI. A positive case additionally starts the real project Node executable in the created directory and checks its reported cwd/version/platform.

## Observed results

| Criterion | Result and evidence tier |
| --- | --- |
| Baseline contrast under a real 226-character temporary root | PASS expected defect: native `mkdtemp` rejected `ENAMETOOLONG`; zero harness starts and no scratch residue. |
| Candidate under a real 226-character temporary root | PASS: one native exclusive `mkdir` created an empty **249-character** `gg-structured-<8 hex>` scratch; the local harness started once. A real Node child reported that exact cwd, Node v22.23.4 / win32, exit 0 and empty stderr. Native cleanup removed the scratch; long root was empty. Name generation was uncontrolled cryptographic randomness. |
| Freshness and return behavior | PASS: two separate public completions used distinct empty scratch directories and removed both; JSON fallback parsed. The long-root call preferred a structured result over a conflicting finalText and preserved usage. |
| Configured cwd precedence | PASS: request cwd won over the option; the next call used the option. Allocator/cleanup and injected tempDir were never called. Both native caller-marker files survived. Raw reply fallback and read-only/never/no-network/no-web-search settings were preserved. |
| Collision then success | PASS: the first controlled random name selected a real pre-existing sentinel directory. Windows returned actual `EEXIST` from `mkdir`; the second attempt created a fresh scratch. Only the new scratch was removed; sentinel content survived. |
| Four-collision exhaustion | PASS: four distinct pre-existing sentinel directories produced four actual native `EEXIST` errors. No fifth name/attempt, harness start or allocator cleanup. All four markers survived before fixture teardown. |
| Ordinary allocation failure | PASS: a native missing-parent `ENOENT` propagated after one mkdir attempt. No retry, harness, cleanup or newly created path. No fabricated permission errno or host ACL experiment. |
| Abort before allocation | PASS: original caller-reason identity, zero mkdir/mkdtemp/harness/cleanup calls. |
| Abort after native allocation | PASS both native-cleanup and injected-cleanup-error controls: no harness start; original caller-reason identity; one cleanup request for the created scratch. |
| Harness failures and successful result | PASS synchronous start failure, asynchronous result failure, each with cleanup success/error; original failure identity survived. Successful completion also survived a controlled cleanup rejection. |
| Cancellation ordering and error precedence | PASS all four resolve/reject × cleanup-success/error controls. Scratch remained present with zero cleanup while cancel was pending. One cancel settled before one cleanup. A cancel rejection took precedence over the caller reason; successful cancellation preserved the caller reason. Cleanup rejection did not replace either. |
| Source boundary | PASS: after LF normalization, the complete/parseLoose/export tail and options interface equal the base. cli.ts bytes match base; package manifests/dependencies are outside the four-file change. Lock hash unchanged. |
| Ownership and cleanup | PASS: every allocator cleanup targeted a directory whose native mkdir had succeeded in that call. No collision/caller directory was targeted. No scratch remained after successful native cleanup. Each synthetic cleanup refusal intentionally left its known scratch, observed and then removed by QA with explicit absolute containment checks. All six such residues were recovered; the entire unique QA-owned fixture root was removed. |

Exact case-level requests, native error stacks, mkdir/rm arguments, paths, child output, sentinel observations, cancellation order and recovery observations are in `observations.json` and `raw/native-run-01.jsonl`. The native run completed at `2026-11-21T08:59:38.503Z`; no behavior rerun or post-run fixture correction was made.

## Evidence capture and corrections

`fixture-v1.mjs` was authored independently in the evidence directory. Before its first run, its path-padding loop was made deterministic with a nonempty final path segment, and teardown was simplified to read the already-owned root directly. These were pre-execution refinements; there was no failed fixture execution or hidden green retry.

Node emitted the expected experimental TypeScript-transform warning and a typeless-package warning for the baseline copy. The PowerShell transcript retained the shell metadata and exit code but did **not** capture native process stdout/stderr. `raw/run-native-01.tool-output.json` therefore explicitly preserves a verbatim text copy of the recorded tool result after execution, not a claimed archive of native stream bytes. The directly written JSONL and JSON observations retain actual runtime events and all native/control error stacks; the test was not rerun to improve the transcript.

`command-ledger.json` records setup, discovery, source inspection and run commands. `source-binding.json` and `run-input.json` contain pre-run bindings. `manifest.json` records exact bytes and SHA-256 for deliverable files; its own hash is returned separately in the handoff.

## Gaps and remaining gates

- No real Codex CLI/provider turn was run. A local HarnessPort and a separate real Node child prove the bounded allocator/public-call/native-cwd criteria, not arbitrary provider operations or later child-file path creation.
- Collision names were controlled by replacing Node's randomBytes binding in this isolated QA process. Directory existence, `EEXIST`, marker contents, successful allocation and cleanup were native filesystem observations. Abort/cancel scheduling and cleanup refusals were also controlled boundaries.
- Cleanup failure is best effort under existing semantics: injected rejection intentionally left a known scratch until QA recovery. The report does not claim production can remove a directory after its native removal fails.
- No unlimited path-length support is claimed. The observed root/scratch lengths are exactly 226/249 on this host/runtime.
- The behavior driver used Node's experimental TypeScript transform, not a built app or the author's Vitest suite. No full monorepo build, numerical coverage, lint/typecheck, browser/API flow, opposite-family review, current-head/current-target CI or fresh Astra MAX final audit was performed by this agent. Those coordinator-managed gates remain.
- The configured-cwd prediction mentioned both raw and JSON fallback. That particular case returned raw text on both calls; JSON fallback was independently observed in the fresh-per-call case instead. The matrix reports the actual execution, with no rerun or post-run alteration of predictions.
- No tracked source/index edit, commit, push, GitHub mutation, service/port operation, owner config/store change, credential inspection or paid call occurred. The fixture used only its unique, explicitly contained evidence-owned directories.

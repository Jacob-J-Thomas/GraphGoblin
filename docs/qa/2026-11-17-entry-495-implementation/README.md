# #495 tooling entry dispatch

The native run used the disposable issue worktree at `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1` on Windows 10.0.26300, PowerShell 7.6.9, Node 22.23.4 and pnpm 12.8.1. The frozen installation reused the pnpm store and exited 0. `baseline/provenance.json` binds the original script and lockfile hashes to the observed runs. `candidate/provenance.json` records the three replacement guards.

## Native observations

The reproduction put a stale reference document and an unjournalled SQL file in the issue worktree only for the negative cases. Their exact contents are in `reproduce.ps1`. The script restored the reference bytes, removed the SQL fixture and deleted the verified junction without following its target. Both cleanup receipts match the original reference hash and confirm the fixture and alias are gone.

| Command and input                                                    | Baseline real  | Baseline junction | Candidate real | Candidate junction |
| -------------------------------------------------------------------- | -------------- | ----------------- | -------------- | ------------------ |
| `pnpm.cmd check:docs`, current reference                             | 0, current     | 0, current        | 0, current     | 0, current         |
| `pnpm.cmd check:docs`, stale reference                               | 1, stale       | 1, stale          | 1, stale       | 1, stale           |
| `pnpm.cmd docs:generate --output <dir>`                              | 0, both files  | 0, both files     | 0, both files  | 0, both files      |
| `pnpm.cmd check:migrations`, clean ledger                            | 0, no-op       | 0, no-op          | 0, no-op       | 0, no-op           |
| `pnpm.cmd check:migrations`, stray SQL                               | 1, stray SQL   | 1, stray SQL      | 1, stray SQL   | 1, stray SQL       |
| `node tooling/scripts/gen-docs.mjs --check`, stale reference         | 1, stale       | 0, silent         | 1, stale       | 1, stale           |
| `node tooling/scripts/check-migrations.mjs`, stray SQL               | 1, stray SQL   | 0, silent         | 1, stray SQL   | 1, stray SQL       |
| `node tooling/perf/summary.mjs --out=<file> <raw>`, valid raw record | 0, valid file  | 0, absent file    | 0, valid file  | 0, valid file      |
| `node tooling/perf/summary.mjs --out=<file> <raw>`, malformed JSON   | 1, SyntaxError | 0, silent         | 1, SyntaxError | 1, SyntaxError     |

The uninstrumented receipts include invocation cwd, executable, args and exit code. `verified-native-matrix.json` records verified exit and output patterns. Summary readback confirmed schema 2, workload `readiness` and `preflight.databaseReady: true`. The bad raw record wrote no output.

Separate diagnostic runs used `trace-entry.mjs` as a Node preload. pnpm used the physical cwd and argv entry spelling in both directories. Direct Node kept the junction spelling in cwd and argv from that directory while its script path resolved to the physical file. The synthetic `path-probe/records.log` independently records the loader's matching physical module URL in that case. The tested pnpm gates rejected the deliberate defects at baseline. The confirmed silent exit affects the direct Node entry points, including the documented summary CLI.

## Candidate verification

The candidate uses Node's `import.meta.main` for dispatch in the three issue scripts. The exact supported floor documents the flag, introduced in Node 22.18.0. [Node v22.22.2 ESM reference](https://github.com/nodejs/node/blob/v22.22.2/doc/api/esm.md#importmetamain).

`regression-red.log` records three failures on the original scripts and a passing import case. The failures were an accepted stale reference, absent migration confirmation and missing summary output. The candidate targeted run passed 36 tests across 5 files. The first formatting check found a line-wrapping difference in the new test. Prettier formatted that file, then tooling ESLint and the changed-file format check both passed.

The first full tooling coverage run exited 1 with 181 passed and one failure. The sparse worktree excluded the tracked `docs/qa/design-contrast.md`, so its existing freshness test failed. The worktree pattern was corrected to materialize that file from the base commit, and its raw Git blob matched `1957f5e21c6abad9f4a1f778ea3c62189ac675d3`. The standalone contrast gate then exited 0. The one unchanged coverage rerun exited 0 with 182 tests in 18 files, including the maintained browser measurement. Coverage was 95.93% statements, 91.77% branches, 92.28% functions and 96.99% lines. Both coverage runs and their exit receipts are retained.

Independent QA and the repository's later review and CI gates are pending. The native experiment used a directory junction on this Windows host.

## Publication provenance

Root independently verified all 169 source evidence entries and five candidate source hashes before publication. The [publication manifest](publication-manifest.json) maps each retained artifact to its original name and SHA-256. Raw Markdown outputs and the original report retain their exact bytes with a `.txt` suffix; this readable report is formatted separately. The original evidence manifest is retained as [source-evidence-sha256.json](source-evidence-sha256.json). [Root verification](root-verification.json) records zero mismatches. No private provider streams are included.

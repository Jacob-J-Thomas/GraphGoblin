# #495 independent Windows behavior QA

**PASS for native Windows behavior.** All 60 commands met their expected exit, output and artifact assertions in the final run.

Base commit: `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1`. QA branch: `codex/gg-20261117-entry-495-qa`. Windows Node `v22.23.4`, pnpm `12.8.1`, frozen dependency install exit 0. Only the three frozen production scripts were copied into the QA checkout. The validation used the public commands and imports and was designed without reading the implementation's tests or reproduction harness.

## Methods and results

The direct Node runs used the real directory and a plain junction as working directories with relative script arguments. Two further runs used absolute script paths through the plain junction and through `junction résumé 雪` from the real directory. The pnpm runs used all three working directories. [Junction metadata](junctions.json)

| Criterion | Commands and observed results |
| --- | --- |
| Generated docs check | `node tooling/scripts/gen-docs.mjs --check` and `pnpm.cmd check:docs` exited 0 with “Generated docs are up to date.” An appended sentinel in the isolated checkout's `docs/reference/nodes.md` gave exit 1 across all tested paths and identified `docs/reference/nodes.md` as stale. Windows printed the path with native separators. Checks preserved the stale bytes. |
| Generated docs write | `node tooling/scripts/gen-docs.mjs --output <disposable directory>` exited 0 and wrote both current reference documents in all four direct modes. The bytes matched the checked-out references after CRLF normalization. |
| Migration check | `node tooling/scripts/check-migrations.mjs` and `pnpm.cmd check:migrations` exited 0 with “Drizzle generation is a no-op.” An added `qa_495_entry_probe` table without a migration gave exit 1 with `Schema/snapshot drift: drizzle-kit would write 0030_…sql`. The checks detected drift while all shipped SQL, snapshots, the journal and the seeded schema retained their bytes. |
| Perf summary write and readback | `node tooling/perf/summary.mjs --out=<disposable file> <object JSON> <array JSON>` exited 0 and produced identical portable JSON in all four direct modes. Readback verified schema 2, both workload names and their case order, case wall times, and the deduplicated `events.append` port. Replacing the second input with malformed JSON gave exit 1 and `SyntaxError` in every mode, with no partial aggregate. |
| Inert imports | On the real and spaced Unicode junction paths, `node <probe> <script> [CLI args]` set `process.argv[1]` to the apparent script and imported each module from a different entry module. All six imports exited 0 and printed only the expected exports. The stale generated doc and schema drift were still present. No output directories or summary files appeared. |
| Direct baseline comparison | The unmodified base summary and its helper came from `git show`. As a direct Node entry the base wrote a valid summary through the real path. Through the spaced Unicode junction the base returned exit 0, emitted zero bytes and wrote no file. The frozen candidate wrote a byte-identical summary through the same junction. |
| Supported pnpm checks and path resolution | A separate diagnostic pass applied a read-only Node preload to log cwd, argv[1], and the canonical entry path. pnpm gave each gate a real cwd and real entry path when invoked through either junction. Direct Node preserved the junction spelling in argv[1] for relative entries from the aliased cwd and explicit absolute alias paths. The path evidence explains the prior observation that the supported pnpm gates already refused invalid inputs, while direct Node could skip execution. |

The [command matrix](matrix.json) records exact arguments, working directory, exit, output assertions, and SHA-256 of each raw stdout and stderr file under [receipts](receipts). [Independent harness](verify-native.py) · [Preload](fixtures/entry-preload.mjs) · [Import probe](fixtures/import-with-cli-argv.mjs)

## Artifact and source integrity

| Output in each of the four direct modes | Bytes | SHA-256 |
| --- | ---: | --- |
| Generated `nodes.md` | 29491 | `2efa1c27d6885a90e190ffa0596a19a729d847153dc5d76b7bd0a4757ebe1092` |
| Generated `api.md` | 32009 | `5e348e9006614b49d1db057bdc8dc7386f74812520dc6b270e8ed781bb08c14e` |
| Portable summary | 3071 | `496c21ef1a6fd13727e7a140d688d36a1a91d85b2aa84574b6db911476ee05ef` |

| Frozen source | Before and after SHA-256 |
| --- | --- |
| `tooling/scripts/gen-docs.mjs` | `1bcfb875c661daee6d05701cb8dd49b83581666053accb09d65fd8543dfb81c0` |
| `tooling/scripts/check-migrations.mjs` | `cc58ef7582063a516605c5d7e5db5ffaf8bf3a6f3f47ae8b53ec62d2b55cb17c` |
| `tooling/perf/summary.mjs` | `9c784080118366899748db8d77c7045050fdf22b92fea7e75a7b440d2246faa1` |

The deliberately invalid files were restored byte for byte. The full shipped migration directory, checked-out docs and schema matched their starting hashes. Both junctions were verified and removed with nonrecursive `rmdir` and their target was preserved. The original three unstaged frozen scripts were the only tracked differences in the QA checkout. QA performed writes solely in its checkout and evidence directory. [Sources before](source-before.json) · [Sources after](source-after.json) · [Protected files before](protected-fixtures-before.json) · [Protected files seeded](protected-fixtures-seeded.json) · [Protected files after](protected-fixtures-after.json) · [Final Git status](git-status-after.txt)

## Scope and first-run correction

The first harness run expected slash-separated docs paths and flagged seven correct Windows diagnostics with backslashes. Their raw receipts are retained. The rerun changed only the expected separator and used the same controls. [First-run matrix](initial-matcher-run/matrix.json)

The evidence covers the three frozen scripts' native Windows behavior. Linux hosted checks, the full repository gates and formal review are outside this QA run. The separate #503 audit blocker remains open.

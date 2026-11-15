# Canvas review — known native negatives

This packet preserves the original known-negative native report and five run records. The report copy is [native-known-negative-report.md.txt](evidence/source/native-known-negative-report.md.txt), SHA-256 `8752f7bc09a26c360d001803569a487d55c859fa0d5ff4464c9bca84a845d26c`; the original report remains unchanged. Raw copy paths, sizes, and hashes are in [raw-copy-manifest.json](raw-copy-manifest.json), and all exclusions and byte-identical mappings are in [omissions.json](omissions.json).

## Distinct negative reproductions

The evidence keeps three distinct failure causes separate: an ambiguous ordinary public draft; load/hidden F2 behavior; and a batched trusted D3 node-click reproducing F3. The cases are not collapsed into one reproduction and do not establish a fix. Two fixture-correction batches were exhausted; no formal review scan was spent.

| Run                     | Record                                                     | Observed                                                             | Browser log                                                       | Browser snapshot folder                                                  |
| ----------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `first/duplicate`       | [run](evidence/source/runs/first/duplicate/run.json)       | [observed](evidence/source/runs/first/duplicate/observed.json)       | [log](evidence/source/runs/first/duplicate/browser-run.log)       | [snapshots](evidence/source/runs/first/duplicate/.playwright-cli/)       |
| `correction1/reload`    | [run](evidence/source/runs/correction1/reload/run.json)    | [observed](evidence/source/runs/correction1/reload/observed.json)    | [log](evidence/source/runs/correction1/reload/browser-run.log)    | [snapshots](evidence/source/runs/correction1/reload/.playwright-cli/)    |
| `correction1/hidden`    | [run](evidence/source/runs/correction1/hidden/run.json)    | [observed](evidence/source/runs/correction1/hidden/observed.json)    | [log](evidence/source/runs/correction1/hidden/browser-run.log)    | [snapshots](evidence/source/runs/correction1/hidden/.playwright-cli/)    |
| `correction1/node-drag` | [run](evidence/source/runs/correction1/node-drag/run.json) | [observed](evidence/source/runs/correction1/node-drag/observed.json) | [log](evidence/source/runs/correction1/node-drag/browser-run.log) | [snapshots](evidence/source/runs/correction1/node-drag/.playwright-cli/) |
| `correction2/node-drag` | [run](evidence/source/runs/correction2/node-drag/run.json) | [observed](evidence/source/runs/correction2/node-drag/observed.json) | [log](evidence/source/runs/correction2/node-drag/browser-run.log) | [snapshots](evidence/source/runs/correction2/node-drag/.playwright-cli/) |

Five page YAML snapshots were generated; one exact content copy is retained and the other four map to it by hash. All five console logs are retained. The source contains no raw event JSON/JSONL, frame JSON, or PNG screenshot files; the packet does not claim visual screenshot evidence.

## Build, cleanup, and source binding

The packet retains the known-negative runner and build scripts, forced build log and exit record, before-build binding, prior `bc909` artifact inventory, source-closure record, per-run driver versions, and terminal cleanup record. The first gateway cleanup attempt failed with exit code 1; the post-exit checkpoint recording zero is also retained. See [runner source](evidence/source/known-negative.mjs), [Playwright driver](evidence/source/known-negative.playwright.js), [build script](evidence/source/build-known-negative.ps1), [build log](evidence/source/forced-build.log), [source binding](evidence/source/binding-before.json), [source closure](evidence/source/source-closure-before.json), [prior artifact inventory](evidence/source/old-bc909-artifacts.json), and [terminal cleanup](evidence/source/terminal-cleanup.json).

## Exclusions and limits

The source inventory contained 123 files / 11,053,768 bytes. The packet retains 67 unique exact copies / 1,396,206 bytes, including all five run records and all available page/console snapshots. It excludes the 30-file isolated Turbo cache (6,719,566 bytes), five SQLite databases (2,437,120 bytes), and five key files (220 bytes). Sixteen byte-identical copies totaling 500,656 bytes are mapped to retained representatives by source path and SHA-256. The database and key contents were not copied or exposed. All original source files remain untouched.

This is negative evidence only. It does not claim that the reported behavior is fixed, that a formal review passed, or that screenshots/frames exist where the source inventory has none.

`SHA256SUMS.txt` covers all packet files other than itself. `.gitattributes` marks copied evidence as binary so Git does not normalize line endings.

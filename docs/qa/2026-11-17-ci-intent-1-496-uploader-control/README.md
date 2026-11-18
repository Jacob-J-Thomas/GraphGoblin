# Hosted synthetic uploader control for #496

Attempt 1 of run 44247019952 passed at head `6dc157058a36b26d58ed392394300ca3fef94219` on the QA-only `codex/qa/gg-496-uploader-control` branch. This branch must never merge. Job 134608312368 used `actions/upload-artifact@v4` at `ea165f8d65b6e75b540449e92b4886f43607fa02`. Its inputs were ordinary 48-byte synthetic marker files. [Hosted run](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44247019952), [job metadata](jobs-1.json), [raw job log](uploader.raw.log.txt)

| Upload input                                                                        | Result                                                                    |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Historical hidden `.tmp/windows-launcher-artifact-control-*/` pattern with defaults | No archive. [Complete artifact listing](artifacts-1.json)                 |
| Same synthetic hidden path with hidden opt-in                                       | Archive contained the matching marker. [ZIP 14402027186](14402027186.zip) |
| Visible workspace path with defaults                                                | Archive contained the matching marker. [ZIP 14402376056](14402376056.zip) |
| Exact runner-temp marker file with defaults                                         | Archive contained the matching marker. [ZIP 14400894938](14400894938.zip) |

Each ZIP retained its hosted digest and one matching marker. The control establishes default hidden-path filtering by the resolved action. The separate baseline probe establishes that the real baseline outputs existed immediately before its unsuccessful upload. [ZIP verification](verification.json), [connector readback](connector-readback.json), [hosted baseline probe](../2026-11-17-ci-intent-1-496-baseline-probe/README.md)

The candidate exporter requires its own exact-head hosted archive. All ten original control records are archived here. [Raw control report](source-readme.md.txt), [original seal](SHA256SUMS.txt), [publication manifest](publication-manifest.json), [evidence index](../2026-11-17-ci-intent-1/README.md)

# First normal CI attempt for PR #507

Run 44250712750, attempt 1, tested original #407 head `62d443cd2aa321585b45099acb591bf3c24eafaf` against `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1`. The publication and synthetic merge trees matched. The run concluded with a failure at the required dependency audit. [Hosted run](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44250712750), [checkout and job evidence](evidence.json)

| Job              | Result                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Gates            | The sole failed step was the dependency audit. The high-severity Picomatch advisory remained blocking. [Gates log](gates.raw.log.txt)     |
| Browser          | 481 passed, one declared live-provider skip. [Browser log](browser.raw.log.txt)                                                           |
| Windows launcher | All 25 native cases passed. The uploader found no matches in the legacy hidden path. [Windows launcher log](windows-launcher.raw.log.txt) |
| Template image   | The image built and loaded the maintained templates. [Image job log](template-image.raw.log.txt)                                          |

Coverage recorded **9,745 passed and 49 skipped**, and all 13 packages met their coverage floors. The verified download contains all 13 expected summaries. [Coverage ZIP](coverage-14404449251.zip), [coverage and job receipts](evidence.json), [artifact listing](github-artifact-pages.json)

This run covers the original candidate. The separate original POSIX control reproduced the Darwin wildcard grant. The corrected candidate requires fresh hosted evidence, and the audit blocker remains tracked in [#503](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/503). [First POSIX control](../2026-11-17-api-ports-407-hosted-posix-run-01/README.md), [Darwin correction](../2026-11-17-api-ports-407-darwin-correction-02/README.md)

All 20 original artifacts and their seal are preserved. [Raw report](source-readme.md.txt), [original seal](SHA256SUMS.txt), [publication manifest](publication-manifest.json), [evidence index](../2026-11-17-api-ports-407/README.md)

# PR #507 first CI attempt

[Run 44250712750, number 920, attempt 1](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44250712750) completed with **failure**. The required dependency audit was the sole failed step. The build, acceptance, coverage and platform evidence belongs to the original #407 candidate, and the separate #503 gate remains a blocker.

## Tested source

[Draft PR #507](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/507) published head `62d443cd2aa321585b45099acb591bf3c24eafaf` against `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1`. All four checkout logs record synthetic merge `ce8c365d70a221ea358b8c96a7f638a541d0e000`, with the target and head as ordered parents. The publication tree and the synthetic merge tree both equal `5248a4c592c703499f712934bbaeadabc9ba2403`. The base tree is `430d34fda9d7e91752a7dbc93794242b4c17a5aa`. [PR head](github-head-commit.json), [merge object](github-synthetic-merge.json), [checkout line bindings](evidence.json).

GitHub's complete paginated listings identified four jobs and one artifact. The four raw job logs match the connector's independently returned decoded log fingerprints. GitHub's REST jobs records provide actual step and job times and conclusions. [Terminal run metadata](github-run-attempt1.json), [job listing](github-jobs-pages.json), [artifact listing](github-artifact-pages.json), [connector readback](github-connector-readback.json).

## Results

| Job | Conclusion | Elapsed | Observed |
| --- | --- | ---: | --- |
| [Gates](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44250712750/job/134620427512) | Failure | 23m21s | 30 successful steps, actual dependency audit exit 1, one post-setup cache step skipped. |
| [Browser](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44250712750/job/134620427647) | Success | 25m07s | 481 passes, one declared live-provider skip, Edge, zero retries and one worker. Functional step 23m38s. |
| [Windows launcher](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44250712750/job/134620427169) | Success | 5m31s | 25 passes, zero skips or failures. Native step 3m25s. |
| [Template image](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44250712750/job/134620427434) | Success | 1m49s | Built the image and loaded starter, implementation, review and QA templates without network or writable storage. |

Gates completed all thirteen coverage groups and all 22/22 Turbo tasks. Coverage recorded **9,745 passed and 49 skipped** in 15m4.682s of Turbo elapsed time. All 13 maintained API port tests passed on the Ubuntu runner. The API port helper recorded 90.00% line and 70.21% branch coverage. The build, native/API acceptance, static checks, licence allowlist, generated docs and design-token contrast checks were successful. The required high-threshold dependency audit then failed with **GHSA-fc5q-39xc-vjpf**, Picomatch `<=4.0.7`, no patched version listed, and 7 low, 13 moderate and 1 high. Its raw command-start-to-exit interval was 0.296s. [Hosted Gates log](gates.raw.log), [check annotations](github-gates-annotations-pages.json).

The Windows upload reported no matches under `.tmp/windows-launcher-*/` with hidden-file inclusion false. The complete run listing has no Windows archive. The native pass evidence is in stdout. The source of the missing archive remains a #496 concern. [Windows launcher log](windows-launcher.raw.log).

## Coverage archive

The Gates uploader and complete artifact listing agree on [artifact 14404449251](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44250712750/artifacts/14404449251). The [downloaded ZIP](coverage-14404449251.zip) has 22,298 bytes and matches GitHub's SHA-256.

```text
be48743cfd93e95b29487b42c951d701f3f5352aed4d7ed1ab25bd8dba271c36
```

All thirteen expected package summaries were read and hashed. All four required coverage floors were met by every package. Repo minima across package totals were 95.00% lines, 90.49% branches, 90.95% functions and 93.61% statements. [Per-package test denominators, file hashes and step timings](evidence.json), [manifest](manifest.json), [packet checksums](SHA256SUMS.txt).

The [separate exact-parent POSIX control](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44251885185) reproduced the wildcard port grant on its hosted macOS runner. This Ubuntu/Windows CI attempt leaves that Mac defect open. A later Darwin probe candidate has its own evidence lineage.

Collected read-only with no rerun, cancellation, review, issue or source mutation.

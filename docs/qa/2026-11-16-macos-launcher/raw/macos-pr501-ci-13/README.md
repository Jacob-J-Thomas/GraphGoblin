# PR 501 CI13 evidence packet

## Run identity

- Workflow run: [CI #916, Actions run 44024381922](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44024381922), attempt 1; terminal status **success**. Terminal state was observed from the GitHub API at 2026-11-17T05:56:49Z (UTC).
- PR: [#501](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/501); head `4d72503321e587d7a36341462a49e442f3e51a6f` (tree `9d55b09931fcca74688b1408ad663ec55257f6cc`); base `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1` (tree `430d34fda9d7e91752a7dbc93794242b4c17a5aa`).
- CI checkout used synthetic merge `21c570dfec222973a2906307496fd20fce769f31`, tree `9d55b09931fcca74688b1408ad663ec55257f6cc`, parents in order: base `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1`, then head `4d72503321e587d7a36341462a49e442f3e51a6f`. The macOS raw checkout log records this ref; GitHub’s Git commit endpoint independently confirms its tree and parents.
- Run started at 2026-11-17T05:28:42Z (UTC). See `metadata/` for the exact run, jobs, artifact and commit responses.

## Job results

| Job | Job ID | Result |
|---|---:|---|
| Windows launcher | 133841113046 | success |
| Browser | 133841113261 | success |
| Gates | 133841113313 | success |
| macOS launcher | 133841113425 | success |
| Template image | 133841113431 | success |

All five jobs reached terminal **success**. Full decoded logs are under `logs/`; the complete step results are in `metadata/github-jobs.json`.

## Native macOS results

- Mac API integration: **203 passed, 8 skipped** across 10 test files.
- Swift Testing: **168 tests passed**; the recorded command exited 0. The preserved event stream has 793 valid JSONL rows: 189 test starts and ends, 112 case starts and ends, one run start/end, and no recorded issues.
- Swift coverage over 25 source rows (23 executable and 2 declaration-only): **3,492/3,627 lines (96.28%)** and **1,868/2,056 regions (90.86%)**. The collector reports `meetsThreshold: true`. Native branch denominator is 0; LLVM native branch counters are unavailable, so the branch-outcome tests do not imply a measured branch percentage.
- Per-target coverage is retained in `artifacts/extracted/macos-launcher-coverage/coverage-summary.json`. Aggregate results meet the threshold; targets are not each individually at 90% (for example LauncherEntry is 13/31 lines and 6/13 regions).
- The native installer and gateway acceptance step passed. Toolchain: macOS 15.8.2 arm64, Xcode 16.4 / SDK 15.5, Swift 6.1.2, Node 22.23.5, pnpm 10.8.1.

## Shared and browser CI results

- Gates ran 13 Vitest invocations: **9,839 passed, 50 skipped** across the package/app/tooling test suites.
- Browser suite: **481 passed** in 26.2 minutes.
- The uploaded V8 artifact contains 13 per-component coverage summaries. Each reports at least 90% lines and branches:

| Component | Lines | Branches |
|---|---:|---:|
| apps/api | 4568/4797 (95.22%) | 3524/3887 (90.66%) |
| apps/mcp | 255/263 (96.95%) | 229/243 (94.23%) |
| apps/plugin-claude | 38/40 (95.00%) | 20/21 (95.23%) |
| apps/plugin-codex | 65/68 (95.58%) | 22/24 (91.66%) |
| apps/web | 11754/11920 (98.60%) | 12485/13239 (94.30%) |
| packages/adapter-codex | 520/524 (99.23%) | 479/502 (95.41%) |
| packages/adapter-jev | 83/84 (98.80%) | 60/62 (96.77%) |
| packages/api-client | 315/315 (100.00%) | 217/223 (97.30%) |
| packages/contracts | 499/502 (99.40%) | 216/228 (94.73%) |
| packages/domain | 1571/1591 (98.74%) | 1650/1719 (95.98%) |
| packages/engine | 3432/3540 (96.94%) | 3213/3522 (91.22%) |
| packages/infrastructure | 3836/3922 (97.80%) | 3267/3506 (93.18%) |
| tooling | 1957/2017 (97.02%) | 1361/1479 (92.02%) |

Windows launcher acceptance and template image validation also passed.

## Artifacts and integrity

The original GitHub artifact ZIPs are retained under `artifacts/` and their SHA-256 values match GitHub’s artifact digests:

| Artifact | ID | Bytes | SHA-256 |
|---|---:|---:|---|
| coverage | 14303756985 | 22404 | 825b5ae6eab2c92ee798805b8a2136cb0d87bd6884d1f22f596f4b346db1e8f8 |
| macos-launcher | 14301859530 | 354834 | 4b79037a8663254ed22abd871dc31c25450c30ef2893ab7f3533bb05791e6196 |

Extracted native reports and toolchain metadata are under `artifacts/extracted/`. The selected raw V8 coverage summaries are under `artifacts/extracted-v8/`. The packet includes all five job logs, raw artifact archives, extracted native evidence, selected V8 summaries, and GitHub run/job/artifact/commit response records.

`SHA256SUMS` hashes every file in this packet except itself. The manifest’s own digest is reported separately by the sealing message.

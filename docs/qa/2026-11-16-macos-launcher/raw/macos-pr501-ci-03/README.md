# GraphGoblin PR 501 CI packet 03

Read-only hosted CI evidence for PR 501 at exact head commit 635a637c4be4f8d63647c01996cdb80e3c262323, tree 40473ceb73b971532d98560c7218a0367fcfd620, targeting main at 6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1. The pull request was open and draft when checked.

[GitHub Actions CI run 43971560928](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43971560928), run number 906, attempt 1, completed successfully at 2026-11-16 23:00:53 UTC. All five jobs ended successfully.

## Commit identity

The hosted jobs checked out synthetic merge commit 68a9536dcf4c6e1c047deb28f83d910b16e4113d through refs/remotes/pull/501/merge. GitHub's commit object reports this ordered parent list:

1. Base: 6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1
2. Head: 635a637c4be4f8d63647c01996cdb80e3c262323

The synthetic merge tree is 40473ceb73b971532d98560c7218a0367fcfd620, matching the head tree. All five raw job logs record the merge ref and checkout SHA; exact log line references are in run-metadata.json.

## Terminal jobs

| Job | Result | Evidence |
| --- | --- | --- |
| Gates | success | 13 coverage workspaces; 612 Vitest files passed and 8 skipped; 9,796 tests passed and 50 skipped. Turbo reported 22 successful tasks of 22. The coverage upload succeeded. |
| Windows launcher | success | Native acceptance: 25 tests, 0 failed, 0 skipped. The upload step found no files matching .tmp/windows-launcher-*/; no Windows artifact was published. |
| Template image | success | Offline/read-only check loaded starter, implementation, review, and qa templates. |
| macOS launcher | success | Mac API tests: 10 files, 203 passed, 8 skipped. Swift Testing: 105 passed; no skip summary was emitted. Native installer/gateway acceptance: 2 passed, 0 failed, 0 skipped. |
| Browser | success | Edge suite: 481 passed, 1 skipped, 21.4 minutes, zero retries, one worker. Coverage/exclusions step passed. The skipped case was the live Codex inference flow in live.spec.ts. |

No CI failures occurred. No retry, cancellation, rerun, workflow change, source edit, PR comment, or merge was made by this observer.

## Coverage reports

The coverage artifact includes 13 raw V8 coverage-summary.json files under coverage-summary/. API aggregate coverage is 4,568/4,797 lines (95.22%), 3,524/3,887 branches (90.66%), and 897/985 functions (91.06%).

Relevant API file summaries:

| File | Lines | Branches | Functions |
| --- | ---: | ---: | ---: |
| apps/api/src/macos-log/guard.ts | 126/127 (99.21%) | 75/80 (93.75%) | 42/44 (95.45%) |
| apps/api/src/macos-local-key.ts | 25/25 (100%) | 29/29 (100%) | 4/4 (100%) |
| apps/api/src/managed-log/guard.ts | 41/41 (100%) | 23/24 (95.83%) | 13/14 (92.85%) |

The extracted Swift LLVM JSON report is artifacts/macos-launcher-extracted/macos-swift-test/debug/codecov/GraphGoblinMacLauncher.json. Its raw report totals cover 41 files: 4,868/6,320 lines (77.03%), 650/807 functions (80.55%), and 1,650/2,704 regions (61.02%); its branch denominator is zero. An independent production-file mapping of the same JSON maps 21 files from a 25-file source roster and reports 2,177/3,588 lines (60.67%) and 1,015/2,040 regions (49.75%), with no branch denominator. A declaration/entry mapping gap remains, so the mapped subset is partial and does not establish a 90% native-coverage result. The raw JSON's SHA-256 is ceb77d218da290a15ba8538c8c2dd17bb554c23a95da1b0eb01dd18fd8493ea6.

## Artifacts and files

- Coverage: artifact 14279883508, 22,361 bytes, SHA-256 0ce30ae9564cde9dfe73cd8dd3d308ed50d168789363307d0e67d67d27f04ff8. All 13 coverage summaries were extracted (183,740 bytes total).
- macos-launcher: artifact 14279411156, 317,215 bytes, SHA-256 4175c97d8eeae149ec86d5bc899e58d925dc2f12956972ecf329d2f138bf72f5. The archive has 78 entries; the acceptance manifest and Swift LLVM coverage JSON were extracted.
- logs/ contains decoded terminal job logs for all five jobs. Their exact saved UTF-8 byte counts and SHA-256 hashes are recorded in run-metadata.json and SHA256SUMS.txt.
- run-metadata.json records exact PR/run/head/base/merge identity, every terminal job and step, artifact metadata, test counts, coverage data, and file hashes.

This packet records hosted CI evidence only. Independent QA, owner acceptance, and review/sign-off remain separate delivery gates.

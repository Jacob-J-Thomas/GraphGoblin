# GraphGoblin PR 501 CI packet 02

Read-only hosted CI evidence for corrected candidate commit `370a12b5784252356807bfc7676f65f6cb19b5e0`, tree `2207dd91338e0bc3ffdb4f8fc81531eb0ae08b3c`, targeting `main` at `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1`. PR 501 remains open and draft. GitHub Actions run **905** (`43952568750`) completed successfully. The run was discovered for the exact head commit. Hosted jobs checked out synthetic merge commit `a6b450ccb03cfe16f229ef5160ad96db3862357b`.

## Terminal jobs

| Job | Result | Evidence |
| --- | --- | --- |
| Gates | success | Build and acceptance steps passed. Coverage threshold suite passed; license, generated docs, design-token contrast, dependency audit, and coverage upload passed. Thirteen coverage workspaces reported 612 Vitest files passed and 8 skipped. |
| Windows launcher | success | Build and native acceptance passed. Native acceptance log reports 25 tests passed, 0 failed, 0 skipped. Its upload action found no files matching `.tmp/windows-launcher-*/`, so no Windows artifact was published. |
| Template image | success | Image build and offline/read-only installed-template check passed; four templates were loaded. |
| macOS launcher | success | Build, Mac API integration, Swift tests, installer/gateway acceptance, and evidence upload passed. Mac API: 10 files, 203 passed, 8 skipped. Swift Testing: 105 passed; no skip summary was emitted. |
| Browser | success | Edge functional suite: 481 passed in 27.9 minutes, zero retries, one worker. Browser coverage/exclusions step passed. Failure-evidence upload was skipped on success. |

No failures occurred. No run retries, cancellations, workflow changes, source edits, comments, or GitHub mutations were made by this observer.

## Coverage

The `coverage` artifact contains `coverage-summary.json` reports. API aggregate coverage was 4,568/4,797 lines (95.22%), 3,524/3,887 branches (90.66%), and 897/985 functions (91.06%). Per-file function/line/branch counts:

| API file | Functions | Lines | Branches |
| --- | ---: | ---: | ---: |
| `apps/api/src/macos-log/guard.ts` | 42/44 (95.45%) | 126/127 (99.21%) | 75/80 (93.75%) |
| `apps/api/src/macos-local-key.ts` | 4/4 (100%) | 25/25 (100%) | 29/29 (100%) |
| `apps/api/src/managed-log/guard.ts` | 13/14 (92.85%) | 41/41 (100%) | 23/24 (95.83%) |
| `apps/api/src/data-dir-lock.ts` | 26/28 (92.85%) | 161/177 (90.96%) | 124/149 (83.22%) |
| `apps/api/src/serve.ts` | 11/21 (52.38%) | 70/86 (81.39%) | 42/51 (82.35%) |

The actual changed lock module is `data-dir-lock.ts`. The uploaded summaries provide counts but not uncovered function names or source locations.

## Artifacts and logs

- `run-metadata.json` records PR head/base/merge bindings, the terminal job and step metadata, artifact identities, counts, and file hashes.
- `logs/` contains decoded terminal job logs for all five jobs. `SHA256SUMS.txt` records each log and archive digest.
- `artifacts/macos-launcher-14269121506.zip` is the 316,800-byte native evidence artifact; SHA-256 `A3323C1DEF983338F62B306EE441E204CF857FD33BD026EDDE5BB975D3FB40C0`. Its safely extracted copy contains 78 entries (1,571,282 bytes), including the acceptance manifest and Swift coverage JSON.
- `artifacts/coverage-14272785162.zip` is the 22,364-byte coverage artifact; SHA-256 `A66DF4E611CF965EC0A1838FD9E474E01404087D17ECDEB6138D75B488020461`. Its safely extracted copy contains 13 workspace coverage summaries (183,739 bytes).
- The artifact list contains no Windows or Browser artifact. The Windows log preserves the missing-files warning; Browser's failure-evidence upload was skipped because the job passed.

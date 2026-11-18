# API test fixture port reservations (#407)

This packet contains the implementer’s Windows evidence for the candidate based on `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1`. Independent behavior QA, opposite-family review, hosted CI, and the final audit have separate delivery records. The host used Windows 11 Pro build 26300, Node v22.23.4, and pnpm 12.8.1. [Host record](host.json)

## Real worker collision

The two witness specs seed both workers’ first port choice to the same offset in a two-port allocation. The first worker selects a port and creates a key. The second worker then selects a port and authenticates against its own built API. Only then does the first worker start its API. The baseline and candidate use the same compiled API entry, with SHA-256 `3160AC2A1339525DC3F63400BBD9ACA29AEA6663442D625CE6728BD35619325C`. [First worker spec](reproduction/witness-first.test.ts), [second worker spec](reproduction/witness-second.test.ts), [baseline source hashes](sources/baseline-sources.json), [candidate source hashes](sources/final-witness-sources.json)

| Run             | First worker port | Second worker port | Result                                                                                                                                                                                                                                                                                                         |
| --------------- | ----------------: | -----------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline        |             63650 |              63650 | The first API failed with `EADDRINUSE` after the second API authenticated. One test passed and one failed. [Failure log](reproduction/baseline/baseline-actual-two-workers.log.txt), [command receipt](reproduction/baseline/baseline-actual-two-workers.json)                                                 |
| Final candidate |             63650 |              63651 | Both built APIs authenticated. Two tests passed. [Run log](reproduction/final/final-actual-two-workers.log.txt), [first marker](reproduction/final/coordination/first.json), [second marker](reproduction/final/coordination/second.json), [command receipt](reproduction/final/final-actual-two-workers.json) |

The API subprocess fixture and the managed serve, history cleanup, and shutdown HTTP receiver tests use the same allocator for the assigned range. The reservation spans the unbound interval, child startup, restart, and cleanup. Its TCP probe skips existing listeners and closes before the application binds. Give simultaneous Vitest invocations disjoint ranges. [Caller census](caller-census.log.txt)

## Windows verification

The first final API coverage run used four workers and the ten-port range 63650–63659. It passed 2,084 tests with 16 skipped across 135 files. The existing 90% package thresholds passed on all four measures. [Coverage log](gates/final-api-coverage.log.txt), [command receipt](gates/final-api-coverage.json)

| Statements | Branches | Functions |  Lines |
| ---------: | -------: | --------: | -----: |
|     93.95% |   90.92% |    91.67% | 95.36% |

- The earlier caller matrix passed 75 tests with 10 skipped. That run preceded moving the Vitest context injection into a worker setup file. The final worker witness and API coverage ran with the worker setup file. [Earlier caller log](gates/earlier-candidate/candidate-touched-caller-matrix.log.txt), [earlier source hashes](sources/earlier-candidate-sources.json)
- Build, typecheck, lint, formatting, dependency layers, and dependency-cruiser passed on the final candidate. Dependency-cruiser reported four orphan warnings in files outside the change. [Build](gates/final-api-build.log.txt), [typecheck](gates/final-api-typecheck.log.txt), [lint](gates/final-api-lint.log.txt), [formatting](gates/final-format.json), [layers](gates/final-check-layers.log.txt), [dependency-cruiser](gates/final-check-deps.log.txt)
- After coverage, all ten ports could bind again. The observed Vitest reservation directory and the designated witness and coverage stores had been removed. [Port probe](gates/final-api-coverage-ports-after.log.txt), [cleanup receipt](final-cleanup.json)

## Byte provenance

The publication manifest maps each copied file to its source path, repository path, byte count, and SHA-256. The separate final source manifest identifies the 13 candidate source and documentation files and the built API entry used for verification. [Publication manifest](publication-manifest.json), [frozen source manifest](sources/final-sources.json), [raw implementer record](author-record.md.txt)

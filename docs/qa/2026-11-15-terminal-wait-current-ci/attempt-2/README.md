# PR #487 CI: Gates-only retry

This folder preserves attempt 2 of workflow run 43758754651 (run number 885) for the same frozen PR head and synthetic merge as attempt 1. GitHub reports the overall run as completed successfully at 21:34:06Z. The only job executed anew was Gates. The successful Windows launcher, Template image, and Browser outcomes were carried forward from attempt 1; they were not re-executed.

## Identity and outcomes

| Item                   | Value                                                         |
| ---------------------- | ------------------------------------------------------------- |
| PR head                | 0d1b935988c4ff06f5091b645210b0cd88703a16                      |
| Tested synthetic merge | 89fa84597f5aa124cf02d2fdebe27e4656ef1516                      |
| Workflow run           | CI 43758754651, run 885, attempt 2                            |
| Gates job              | 132958879679; started 21:09:19Z, completed 21:34:05Z; success |
| Workflow conclusion    | success                                                       |

The [terminal run record](metadata/run-attempt2-terminal.json), [terminal job metadata](metadata/jobs-attempt2-terminal-gh.json), and [workflow job snapshot](metadata/jobs-attempt2-terminal.json) preserve this result. The tested head, target, tree, and merge parents are documented in the [attempt-1 identity record](../attempt-1/metadata/synthetic-merge-89fa84597f5aa124cf02d2fdebe27e4656ef1516.json).

## Fresh Gates result

All 32 Gates steps passed. The job completed the build, acceptance suites, typecheck, lint, format, layer, migration, design-token, dependency-graph, template-refusal, Chromium-install, coverage, licence, generated-doc, contrast, dependency-audit, and coverage-upload checks.

- The standalone build reported 12 successful tasks and 0 cached tasks.
- The coverage run reported 9,607 passed and 41 skipped tests across 13 package groups. All 13 line and branch coverage floors were at least 90%.
- Turbo reported 22 successful coverage tasks, including 9 cached tasks. The coverage workload took 16m8.931s.
- The configured dependency audit passed and reported 8 low and 13 moderate advisories.
- The 22,026-byte coverage archive is artifact 14181289134, SHA-256 ad666ea32d8ba6b67544a3d644a4dfa9d6ae1642ad7e801bc0981b2258513775. Its [13-member readback](metadata/coverage-attempt2-members.json) records each extracted member hash and coverage percentage.

The original attempt had a separate coverage artifact with the same GitHub artifact name. Both archives are retained under different IDs and filenames: attempt 1 artifact 14180472080 and attempt 2 artifact 14181289134. Eleven of the 13 coverage-summary members are byte-identical. Only apps/web and tooling summaries differ; the retained [member comparison](metadata/coverage-member-diff-vs-attempt1.json) records the exact hashes and percentages. This comparison does not establish a cause.

## Carried companion jobs

The attempt-2 job records for Browser, Windows launcher, and Template image have new job IDs, but their started/completed timestamps remain the original execution times. Fetched decoded logs for those IDs compared exactly equal to attempt 1. The [carried-job identity record](metadata/carried-job-log-identity.json) maps each ID to its original job and log. Their detailed results and qualifications remain in the [attempt-1 packet](../attempt-1/README.md), including the single LIVE-gated Browser skip and the missing native Windows artifact.

## Remaining qualification

The first attempt reached GitHub's 30-minute job limit. This retry passed, but the runtime variation has no cause established here. Follow-up issue [#488](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/488) tracks the repeated timeout and reliability question; this packet does not claim the issue is resolved or that CI policy changed. Node.js 20 action-runtime deprecation and Ubuntu runner-image migration notices remain in the logs.

The full Gates log and steps are in [logs](logs/). Retry authorization and submission records, raw run/job metadata, annotations, both coverage archive records, and root readbacks are linked under [metadata](metadata/) and [provenance](../provenance/). This packet records CI evidence only, with no review or merge disposition.

The [source-copy map](source-copy-map.json) maps payload provenance. [SHA256SUMS.txt](SHA256SUMS.txt) covers the attempt-2 files except itself.

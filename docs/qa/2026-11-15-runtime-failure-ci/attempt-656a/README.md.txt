# PR #485 current-head CI

Run 43737977820 (run 882, attempt 1) completed successfully for PR #485. It tested PR head 656a73214c5d59a25c22a4abf2d8b3bf17976959 against main at f91bd69b79dc417a2997ddb9c7670cb33df7597c. GitHub created synthetic merge 7c8cf9f2b8b099351a9ac138cab43d86ec5ad23f, tree d6c3dc2f3ebf265133fc3761c775ed37b2077388, parents target then head. All four job logs show checkout of refs/remotes/pull/485/merge at that SHA. The run and final job state are captured in terminal-snapshot.json; synthetic commit metadata is in synthetic-merge-identity.json.

This is the first CI attempt on corrected head 656a, not a retry of run 43735208367. The earlier 5082-head run remains a failed first attempt; see the sibling [original CI report](../current-ci-5082/README.md). On corrected head, the narrow .prettierignore patterns preserved the six raw inspector captures while allowing the format check to pass.

## Result

All four jobs completed successfully: Gates, Browser, Windows launcher, and Template image. No separate Routing job is present in this workflow run.

### Gates

All 32 Gate job steps passed. This includes build, seven acceptance steps, typecheck, lint, format, layer and dependency rules, migration no-op, shipped-template checks, tooling browser measurements, unit coverage, licence allowlist, generated docs, design contrast, dependency audit, and coverage upload.

The unit/coverage pipeline reported 9,605 passed tests and 41 skipped across 13 package coverage groups. All 13 groups met the 90% line and branch floors. The uploaded coverage archive contains 13 coverage-summary.json files; its SHA-256 is 76d8fa902fbb476c5b1832d43ffe10d391fc416fe392eaf22437e7a173874f30.

| Package                 |   Lines | Branches |
| ----------------------- | ------: | -------: |
| packages/adapter-codex  |  99.23% |   95.41% |
| packages/adapter-jev    |  98.80% |   96.77% |
| packages/api-client     | 100.00% |   97.30% |
| packages/contracts      |  99.40% |   94.73% |
| packages/domain         |  98.74% |   95.98% |
| packages/engine         |  96.94% |   91.22% |
| packages/infrastructure |  97.80% |   93.18% |
| apps/api                |  95.78% |   90.61% |
| apps/mcp                |  96.95% |   94.23% |
| apps/plugin-claude      |  95.00% |   95.23% |
| apps/plugin-codex       |  95.58% |   91.66% |
| apps/web                |  98.60% |   94.31% |
| tooling                 |  96.89% |   91.67% |

The standalone build summary was 12 successful tasks with no Turbo-cached task. The separate coverage pipeline reported 22 successful tasks, including 9 cached dependency-build tasks. These are task-cache summaries; they do not imply a clean TypeScript rebuild. Skips are retained per suite in the full Gates log; they include guarded live/provider, performance, and environment-specific cases. The 41 unit-level skips are distinct from the Browser job's single skip.

The dependency audit passed at the configured high threshold and reported 8 low and 13 moderate advisories. Dependency-cruiser passed with four warning-only no-orphan findings (zero errors). The logs also include Node.js 20 action deprecation notices (actions were forced to Node.js 24), Node DEP0169 url.parse and DEP0040 punycode deprecations, and a Docker shared-lockfile warning that forced legacy deploy behavior. These warnings did not fail their steps.

### Browser

The Edge 157.0.4341.60 functional suite passed 481 tests and skipped 1 (482 total), with one worker and zero retries; duration was 29.5 minutes. The only skip was live.spec.ts, which requires LIVE=1, an installed Codex CLI, provider login, and subscription quota; CI set LIVE=0. The log states that no other functional spec or test was skipped or gated on provider login or an installed CLI. Browser failure-evidence upload was skipped because the job had no failure evidence.

Optional GG_ROUTING_STRICT_PERF bounds were disabled. The ordinary routing tests passed, but their logged frame percentiles are not a strict-performance pass: the 100-node run observed 33.4 ms frame p95, and the 300-node run observed 50.0 ms frame p95 (about 16.6 ms added). Routing p95 values were 3.2–7.7 ms. Keep those measurements qualified; this run does not establish the disabled 17 ms frame bound.

### Windows launcher and template image

The native Windows launcher job passed 14 tests, with zero failures and skips. Its upload step passed but warned that .tmp/windows-launcher-*/ contained no files, so no native launcher artifact was produced.

The template-image job passed and loaded four installed templates offline and without writable storage: starter (4 draft nodes), implementation (11), review (10), and qa (11). The Docker build logged that the shared workspace lockfile forced the legacy deploy implementation.

## Captured evidence

The complete decoded job logs, terminal step snapshots, run/job/artifact snapshot, early identity readback, and coverage archive are retained here. The manifest records file sizes and SHA-256 values; SHA256SUMS.txt covers every packet file except itself.

- [Gates log](job-logs/gates.decoded.log) · [Gates steps](job-logs/gates.steps.json)
- [Browser log](job-logs/browser.decoded.log) · [Browser steps](job-logs/browser.steps.json)
- [Windows launcher log](job-logs/windows-launcher.decoded.log) · [Windows steps](job-logs/windows-launcher.steps.json)
- [Template-image log](job-logs/template-image.decoded.log) · [Template steps](job-logs/template-image.steps.json)
- [Coverage artifact](coverage-14172112286.zip)
- [Terminal run, jobs and artifact metadata](terminal-snapshot.json)
- [Initial identity readback](identity-readback.json) · [Earlier jobs snapshot](jobs-snapshot-165808Z.json)
- [Synthetic merge identity](synthetic-merge-identity.json)
- [Evidence manifest](evidence-manifest.json) · [SHA-256 inventory](SHA256SUMS.txt)

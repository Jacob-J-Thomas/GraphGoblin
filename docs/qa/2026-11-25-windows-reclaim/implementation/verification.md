# API stale guard contention implementation

Issue #581. The four-file patch was authored in the isolated `codex/windows-reclaim-contention`
worktree at base `600f36fa51cc154a4e9ce6914411652431a087f0`. The implementation ran in the
GPT-6 fallback worker after the Claude subscription reached its five-hour limit. The worker
can observe the GPT-6 family. The parent dispatch record is the source for the requested model
and effort. The worker did not commit or publish.

## Behavior

- Acquisition proceeds to atomic publication on an absent observation and re-observes when
  another contender removed its observed stale marker. It credits successful removals it performed.
- A Windows acquisition-side `recovery-directory-remove` failure with code `EPERM` retains
  the absence check. For a present guard, ordinary contention requires a distinct physical
  directory, one regular single-link marker under a distinct valid UUID, a matching record token,
  a foreign live PID and its matching Windows creation identity. The directory and marker
  identities are checked again after the asynchronous process query. If the guard vanishes
  during the check, an independent `lstat` can establish its absence before atomic publication.
  An unverified current guard leaves the original tagged error intact.
- The added classification is read-only. The existing published release, primary rollback and
  private staging cleanup paths retain their error handling. Both native acceptance scripts
  retain their original assertions and limits.

Deterministic public API tests cover the ordering on an absent guard, a lost UUID marker,
an atomically published live successor, verified absence, a successor released during its
identity check, a persistent empty guard, a denied recheck, malformed and ambiguous records,
unverified creation identities, directory and marker identity replacement, a junction,
a hard-linked marker, non-Windows EPERM and published guard release rollback. Successful
cases check reclamation accounting. Refusals check the original operation and cause or an
ordinary ownership error, and verify successor bytes and private staging cleanup as applicable.

## Checks

macOS 26.6.2 build 25G83, arm64, Node v22.22.2, pnpm 12.8.1. Node was selected from
`/opt/homebrew/Cellar/node@22/22.22.2_2/bin`. Validation used the parent's frozen offline
dependency install.

| Check                                                                                                       | Result                        | Log                       |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------- |
| `corepack pnpm --filter @graphgoblin/api test src/data-dir-lock-failures.test.ts src/data-dir-lock.test.ts` | Exit 0, 81 tests in two files | `final-focused.log`       |
| `corepack pnpm --filter @graphgoblin/api typecheck`                                                         | Exit 0                        | `final-api-typecheck.log` |
| `corepack pnpm exec eslint src/data-dir-lock.ts src/data-dir-lock-failures.test.ts` from `apps/api`         | Exit 0                        | `final-changed-lint.log`  |
| Prettier check of the four changed files and `git diff --check`                                             | Exit 0                        | `final-format-diff.log`   |

The first focused run reached the expected ordinary refusal but failed its assertion because an
absent property differs from an own property set to `undefined`. The final assertion verifies
property absence explicitly. The first targeted lint run found an unnecessary async default
test helper. The final helper accepts an optional callback. Initial logs and all exit files
remain alongside the final runs. `source-sha256.txt` binds the four files after these corrections.

The Windows scenarios in these tests exercise fault injection on the Mac. Native Windows
acceptance, full API coverage and fresh integrated macOS A–E checks remain with the root agent.
The earlier Windows run establishes the original diagnostic failure. Its events leave the exact
native filesystem interleaving undetermined.

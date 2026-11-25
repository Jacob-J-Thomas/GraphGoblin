# D237 gateway lock integration handoff

GPT-6.2 Astra/xhigh resolved the gateway lock on the isolated `codex/gg-macos-current-main` worktree. The integration parents are the published Mac head `6fe12f412cd74b034a77cde10a521bb319e8aa96` and signed main `0f6c325becf3e3e0562ae69dfae2c42bcf1d7129`. The execution slot is released.

| Final source | SHA-256 |
| --- | --- |
| `apps/api/src/data-dir-lock.ts` | `9ac7ee4116896e18de4db3942bc8798aa354e82f478fe5374289fbb05a11c3cc` |
| `apps/api/src/data-dir-lock-failures.test.ts` | `d104eb585ec51afb406d93b7f4de97292922236cb5ab4deec4aa6df37da499fa` |

The primary file is acquired once under the reclamation guard. An attested caller receives proof tied to the file handle that wrote its owner record. The verifier checks the opened device/inode, owner, mode, link count and bytes, and retires proof when release begins. Both overloads receive main’s actual file/guard reclamation facts and typed idempotent release outcome. Guard cleanup failures roll back that same primary acquisition. Failed rollback preserves the in-process hold and both errors. Database acquisition and state use the canonical lock filename. The ordinary lease keeps its original surface.

The combined regression runs the recovery-marker release fault with both the ordinary and attested public overloads. It observes the matching primary and guard records at the failure, the structured cleanup error, primary removal, retained guard ownership and refusal of a second acquisition. Both variants passed in the Windows run. [Ownership results](06-ownership/stdout.log)

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Initial repository build | 12/12 tasks passed | [Exit](01-build/exit.json) |
| First format check | Exit 1, two files required line wrapping | [Output](02-format/stderr.log) · [Exit](02-format/exit.json) |
| Repository formatting and repeat check | Both exited 0 | [Write](03-format-write/exit.json) · [Check](04-format/exit.json) |
| Repository build on final formatted source | 12/12 tasks passed, 6 cached | [Output](05-build-formatted/stdout.log) · [Exit](05-build-formatted/exit.json) |
| Ownership, Mac local key and reset | 119 passed, 18 skipped, 7 files | [Output](06-ownership/stdout.log) · [Exit](06-ownership/exit.json) |
| Built entry, startup and serving | 55 passed, 6 skipped, 5 files | [Output](07-startup/stdout.log) · [Exit](07-startup/exit.json) |
| Shared writer and Windows/Mac log adapters | 122 passed, 3 skipped, 5 files | [Output](08-log-adapters/stdout.log) · [Exit](08-log-adapters/exit.json) |
| Complete API package typecheck and lint | Both exited 0 | [Typecheck](09-api-typecheck/exit.json) · [ESLint](10-api-lint/exit.json) |

The focused suites selected 323 cases. Windows ran 296 successfully and skipped 27. Eighteen `geteuid`-gated tests cover POSIX file proof and Mac-managed key admission. The six skipped entry tests cover two non-Windows fixtures, one physical Darwin managed entry and three Linux signal cases. The log group skipped two Linux Node-adapter cases and a real symlink case that skips on `EPERM`. The Mac guard unit tests use injected operations. Native Windows sharing, ACL and bounded PowerShell cases passed. [Exact test cases](08-log-adapters/stdout.log)

Each stage directory contains independent stdout and stderr captured directly by shell redirection during execution. Its `exit.json` records command arguments, worktree, runtime, UTC start/end, process exit and SHA-256 of each stream. `SOURCE.json` records the initial pre-format state. [Final source identity](FINAL-SOURCE.json) records the bytes used in the final build and tests.

The author changed only the two source/test paths listed above and issued read-only Git object queries. Root owns the pending merge, index and subsequent delivery. Protected Swift, launcher, native tests, original evidence and automatically merged code received no author edits. Actual Claude opposing-family critique, independent QA, full repository gates, hosted current-head/current-target CI, native macOS tests and coverage, interactive Finder/Dock and owner acceptance remain outstanding.

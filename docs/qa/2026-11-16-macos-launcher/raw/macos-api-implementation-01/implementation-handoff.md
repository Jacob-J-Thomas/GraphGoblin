# Mac launcher API implementation handoff

Implemented in the isolated Mac worktree based on merged main 6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1, tree 430d34fda9d7e91752a7dbc93794242b4c17a5aa. The adjacent api-source-manifest.json records all 17 touched/new paths and the two writer move origins. No Git index, build, dependency, native, owner-store or deployment changes were made in this slice.

- Shared guard and writer are in apps/api/src/managed-log. The moved writer changes comments only and its moved test is byte-identical. The Windows adapter remains at windows-log/guard.ts, using the same resolver, named-pipe reservation, ACL inspection, and writer operations. Protocol 2, the exact Windows marker and exits 70–75 are retained.
- The Darwin adapter in macos-log/guard.ts checks the closed snapshot, holds a callback-opened numeric FD reservation, bounds EAGAIN waits and verifies private metadata at the writer seam. Identity values remain BigInt through parsing, opened/named comparisons and the shared writer. Main consumes both reserved key spellings before CLI dispatch or app import. The Swift integration atoms are GG_MACOS_LAUNCHER_LOG_ADMISSION, the exact marker export const MACOS_LAUNCHER_LOG_PROTOCOL = 1;, and the emitted macos-log/guard.js, managed-log/guard.js and managed-log/gateway-log-writer.js.
- Mac-only key admission requires the local SQLite file, two existing leases and either an admissible owned local key by metadata or both authenticated lease artifacts as the only store entries. The proof is unavailable once release begins. The attestation verifies the initially held descriptor identity, mode, owner, link count and bounded exact private record. The gate is before SQLite opens or key generation. Ordinary startup keeps its original acquisition/filesystem path.

## Reached verification

Node 22.23.4, pnpm 12.8.1. Raw command outputs and exit codes are adjacent to this report.

- From apps/api via pnpm filter, vitest run src/main-entry.test.ts src/macos-local-key.test.ts src/database-ownership.test.ts src/data-dir-lock.test.ts src/serve.test.ts src/gateway-logger.test.ts src/windows-log/guard.test.ts src/managed-log/gateway-log-writer.test.ts src/macos-log/guard.test.ts passed 9 suites, 177 tests and 19 platform skips in focused-vitest-01. Final changed Darwin adapter suite passed 42 tests in focused-vitest-03.
- ESLint and Prettier on all 17 current changed/new sources passed in focused-eslint-02 and focused-prettier-02, and again on the final changed Darwin adapter files in focused-eslint-03 and focused-prettier-03. Initial adapter test mocks hit require-await and then a test-type mismatch. Both were fixed, with the original failed logs retained.
- pnpm.cmd --filter @graphgoblin/api exec tsc -p tsconfig.json --noEmit passed including source and fixtures in focused-typecheck-02. git diff --check -- apps/api/src passed. Writer move readback confirms that the source changes are comments only and that the moved test bytes match the base.

## Scheduled integration evidence

After a root-scheduled build, run pnpm.cmd --filter @graphgoblin/api exec vitest run src/main.test.ts for the built marker and entry checks. Run the normal POSIX API suites for real key/lease tests skipped by Windows and the full existing Windows launcher regression. Live Darwin directory reservations, integrated log lifecycle, Mac native launches, and interactive acceptance remain owned by the integrated hosted and owner QA phases.

Windows marker clarification. WINDOWS_LAUNCHER_LOG_PROTOCOL is 1 and MACOS_LAUNCHER_LOG_PROTOCOL is 1. The opaque INSTANCE_PROTOCOL remains 2.

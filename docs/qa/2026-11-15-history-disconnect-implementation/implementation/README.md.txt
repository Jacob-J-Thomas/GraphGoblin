# #419 implementation handoff

The candidate is in the isolated `codex/gg-20261115-history-disconnect` worktree on base
`98692c8a8c7b519e8c83e585e026d595cedc0550`, tree
`9439a500040aa4763613549cca6235023916de58`. The admitted independent baseline acceptance is
`88fa808ef986b1add8f522a7170814788f8415a90d913cc6f93e422572ac0dd6`. Its native summary is
`935f6a4abce16e9633f7342fb35d4bc1ca7e73f8b5c1f0c2f9defae1f989ca3c`. Both hashes were
read back at dispatch. [Baseline acceptance](../runtime-419-baseline-acceptance.json) ·
[Native baseline summary](../runtime-419-native-preparation/evidence-baseline-first/summary.json)

## Source

- The historical route attaches a one-shot listener to the outgoing response before ownership
  lookup and combines that observation with the raw response's destroyed state. Fastify's
  `reply.hijack()` prevents a replacement response after abandonment. Connected failures still
  propagate through the route error policy. The close listener is removed when the handler settles.
- Replay checks the same predicate before the initial thread read, after each repository await and
  after the existing `setImmediate` yield. The current manager read, checkpoint selection,
  page size, sequence bounds and domain replay state retain their existing behavior.
- The new integration test composes the production run and health routes, auth, error handler
  and Zod over real loopback TCP and in-memory SQLite. Disposable wrappers hold individual
  repository promises. It checks close before handler entry, ownership, the initial thread,
  checkpoint selection, checkpoint boundary and page reads. It also tests late rejection,
  Fastify send/error activity, listener cleanup, authorized current reads, health while replay
  is held, a completed bodyless GET, connection reuse, exact serialized body text, validation,
  scope, ownership and missing-thread behavior. Existing tests cover replay bounds, damaged
  later records and checkpoints. The native harness separately checks the inter-page yield.
- The API guide and changelog describe the disconnect behavior. The schema, generated API files
  and independent harness have no modifications. [Five-path source manifest and copies](candidate-source.json)

## Verification

Commands ran in the isolated checkout on Node `v22.23.4` through `pnpm.cmd`. The adjacent JSON
receipts record exact commands, UTC start, elapsed milliseconds and exit.

| Check | Result | Evidence |
| --- | --- | --- |
| Initial regression draft | Exit 1, 133.720 s. One pass and nine failures, including six barrier timeouts. Shared Vitest mock restoration removed the `beforeAll` repository spies. The corrected fixture uses disposable bound delegates and reports premature HTTP or transport failure directly. | [Execution](focused-red.json), [log](focused-red.log), [draft bytes](focused-red-test-draft.ts.txt) |
| Initial fixture type and lint checks | Both exited 1. The draft used `Promise.withResolvers`, which is outside the repository's TypeScript library target. A typed local deferred promise and callback hooks resolved the tooling failures. | [Type log](test-draft-typecheck.log), [lint log](test-draft-lint.log) |
| Final fixture, before product edits | Type and lint exited 0. Red run exited 1 in 10.406 s with seven expected disconnect failures and three passing connected controls. The baseline starts extra repository work after close and routes the abandoned rejection into Fastify's error path. The test file SHA-256 is `1260cb00e9c66895b898541e655b264c25431cda3d7881c50def8524f9339e39`, identical to the candidate test. | [Type](test-pre-red-typecheck.json), [lint](test-pre-red-lint.json), [red execution](focused-final-red.json), [red log](focused-final-red.log), [baseline product and test hashes](focused-red-source.json), [test bytes](final-test-red.ts.txt) |
| Candidate focused tests | Exit 0, 33.830 s. 22/22 pass across four files. | [Execution](focused-green.json), [log](focused-green.log) |
| Candidate static checks | API no-emit type check, scoped ESLint, final five-path Prettier and `git diff --check` passed. | [Type](candidate-typecheck.json), [Lint](candidate-lint.json), [Format](candidate-final-format.json) |
| First API coverage run | Exit 1, 343.063 s. 1,952 passed, 14 skipped, one failed. All ten new tests passed. The single failure was Windows `EPERM` renaming a disposable data directory during setup in `src/reset/tree.test.ts:56`. The rename precedes the junction and product assertions. The failing suite prevented coverage totals from being emitted. | [Execution](api-coverage.json), [full log](api-coverage.log) |
| Isolated reset diagnostic | Exit 0, seven passed. The reset source matches the admitted base. The successful diagnostic leaves the original package coverage result as a failure. | [Execution](reset-tree-isolated-diagnostic.json), [log](reset-tree-isolated-diagnostic.log), [source comparison](reset-tree-source-check.log) |

The in-repository tests use source exports with controlled repository gates. Independent built
native candidate QA, current-head CI and formal reviews remain pending. The worktree files
are available for root review and Git operations.

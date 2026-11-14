# #209 MCP and API-client fixture correction

**Status:** The two test-only corrections pass their focused package checks on candidate 35436eddf51482ca9394347228860afe38b0c412. No production code was changed.

## What changed

- apps/mcp/src/mcp.test.ts no longer tries to publish both twin and Twin through the real API. The existing public MCP lookup-not-found and unpublished-draft assertions remain. A separate test calls public MCP start_run against an injected synthetic /loops response containing two equivalent names. This preserves the resolver's defensive ambiguity error coverage while explicitly acknowledging that the current API rejects equivalent names.
- packages/api-client/src/contract.test.ts gives the three shared-store test fixtures distinct names. The run paging, SSE, and catalog validation assertions are unchanged.

The API's uniqueness contract and startup preflight make these duplicate-name fixtures invalid against a supported current store. This was test setup left behind by the new contract, not a runtime failure.

## Focused verification

Runtime selected for all commands: Node v22.23.4; pnpm 12.8.1.

| Command                                                                                          | Result                               |
| ------------------------------------------------------------------------------------------------ | ------------------------------------ |
| pnpm.cmd --filter @graphgoblin/mcp test                                                          | Pass: 12 files, 60 passed, 2 skipped |
| pnpm.cmd --filter @graphgoblin/mcp test:coverage                                                 | Pass: 96.95% lines, 94.23% branches  |
| pnpm.cmd --filter @graphgoblin/mcp typecheck                                                     | Pass                                 |
| pnpm.cmd --filter @graphgoblin/mcp lint                                                          | Pass                                 |
| pnpm.cmd --filter @graphgoblin/api-client test                                                   | Pass: 11 files, 103 passed           |
| pnpm.cmd --filter @graphgoblin/api-client test:coverage                                          | Pass: 100% lines, 97.30% branches    |
| pnpm.cmd --filter @graphgoblin/api-client typecheck                                              | Pass                                 |
| pnpm.cmd --filter @graphgoblin/api-client lint                                                   | Pass                                 |
| pnpm.cmd exec prettier --check apps/mcp/src/mcp.test.ts packages/api-client/src/contract.test.ts | Pass                                 |
| git diff --check                                                                                 | Pass                                 |

The MCP test and test:coverage scripts build the MCP package before running Vitest. No root/full-web suite or browser/native-provider run was performed.

## Existing build-output readback

No build was invoked for this readback. The current four output trees were compared by relative path and per-file SHA-256 against the retained phase3 listings. Every path and file hash matches; counts have no additions, removals, or changed files. The current aggregate hashes therefore match the phase3 records.

| Output tree                  | Files | Current and phase3 listing SHA-256                               |
| ---------------------------- | ----: | ---------------------------------------------------------------- |
| apps/web/dist                |    28 | 37d2177ec857c85029979e82a2b86afe46f575ca56bbf88e62b2302410c47dd2 |
| apps/web/dist-goblin         |    28 | e45aea7d07aa1e5c01ab97920263dc9f9fef2b8b7b8a2e12e1278b244fd0d652 |
| apps/api/dist                |   306 | bbb1b75763c0fa874f1f1f054bda88dc25098a40c7bf3fe27f68809b4b3b8e13 |
| packages/infrastructure/dist |   293 | fb734ebe04d20e55e4a8081f4b8a88eb13a1c30b833c36dd0d75490d6bbf20f9 |

The retained phase3 output listings are linked in build-readback.json. The first aggregate reconstruction attempt is preserved as build-readback-aggregate-attempt1.json; its mismatch was a listing reconstruction issue, not file drift.

## Preserved failures

The original phase3 failures and the unchanged reproduction are retained in the batch phase3 evidence; this proposal links to them instead of copying:

- [Initial MCP failure](../ui-209-claude-phase3/logs/14-mcp-plugins.log)
- [Initial API-client failures](../ui-209-claude-phase3/logs/16-api-client.log)
- [Unchanged MCP reproduction](../ui-209-claude-phase3/logs/17-recheck-mcp-mcp-test.log)
- [Unchanged API-client reproduction](../ui-209-claude-phase3/logs/17-recheck-api-client-contract.log)

Those logs show one MCP and three API-client fixture failures before correction; they are not current results. The first scoped lint and formatting attempts are also retained in logs/corrected/.

## Provenance and limits

- Immutable test-source baseline: commit c427287b41a4e1b67a397ab4e03e228c6ea62450. The preserved source/ copies are checked against that commit.
- Candidate used for implementation and focused checks: 35436eddf51482ca9394347228860afe38b0c412.
- names-209-mcp-fixture.patch is generated from the preserved source copies to the proposed files. The candidate files match the proposal byte-for-byte, and reverse git apply --check passed.
- API/runtime source remains unchanged. This is test correction evidence, not a claim of independent runtime or browser QA.
- Root committed the test fix as 8a057e25c2b30187f4b4a8fab0fee049ec9fc3be. This worker did not stage, commit, or push.

manifest.json contains SHA-256 hashes, sizes, source blob IDs and the retained command logs.

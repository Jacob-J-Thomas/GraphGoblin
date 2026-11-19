# MCP name lookup author evidence — #473

U2.3 aligns MCP selection with the accepted owner naming policy in ADR-0073. One pure
`@graphgoblin/domain` comparison now serves SQLite admission, current-store verification,
web conflict guidance and MCP lookup: trim, collapse ECMAScript whitespace runs, then
locale-independent lowercase. Display spelling stays verbatim. There is no Unicode
normalization or full folding, new package/dependency, migration or format change.

Exact IDs retain priority. Only `LOOP_NOT_FOUND` from an ID lookup falls back to visible
owner-scoped names. Equivalent ambiguous matches are refused; missing names include
`list_loops` guidance; authentication, scope and other upstream failures remain errors.
The web helper imports the shared rule without changing its interaction.

| Evidence                                                                     | Result                                                                                                                                    |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Unchanged-runtime baseline, actual shipped Codex and Claude manifest entries | 56 expected first MCP outcomes; eight whitespace-equivalence calls returned `LOOP_NOT_FOUND` while ID and ordinary controls succeeded     |
| New maintained regression against baseline                                   | Expected red: 8 failed, 4 passed                                                                                                          |
| Candidate, same native plugin entry method                                   | 56/56 expected outcomes, including positive and negative cases                                                                            |
| Candidate maintained naming suite                                            | 12/12 passed; both ordinary and draft-enabled MCP capabilities                                                                            |
| New domain comparison regression                                             | 7 tests passed; whitespace, Unicode, locale and punctuation distinctions                                                                  |
| Candidate build, selected typechecks, corrected lint                         | Passed: 11 build tasks, 15 typecheck/dependency tasks, six lint packages                                                                  |
| Layers, dependencies, changed TypeScript formatting                          | Passed; dependency check had zero errors and four existing orphan warnings                                                                |
| Domain coverage                                                              | Passed: 467 tests, 98.74% lines, 95.98% branches                                                                                          |
| Codex plugin coverage                                                        | Passed: 9 tests, 1 live-provider test skipped; 95.58% lines, 91.66% branches                                                              |
| Claude plugin coverage                                                       | Passed: 8 tests, 95% lines, 95.23% branches                                                                                               |
| Full infrastructure Windows coverage                                         | Qualified failure: 52 failed, 1106 passed across four failing files; relevant naming suite passed 4/4                                     |
| Full MCP coverage                                                            | Qualified failure: 71 passed, 2 skipped, one existing history test hit its unchanged 5-second timeout; naming suite passed 12/12          |
| Full web coverage                                                            | Qualified failure: 2909 passed, 2 failed tests across 224 files; the two existing editor rename tests failed; no coverage summary emitted |

The infrastructure failures include symlink `EPERM`, Windows filename/POSIX-mode
assumptions in audio/voice tests, SQLite chat cleanup `EBUSY`, and an existing history
cleanup test exceeding 20 seconds. The MCP failure is “MCP reads agree through persisted
failure and resume with stale snapshots.” Full first logs are retained externally. No
timeout, assertion, coverage threshold or exclusion was changed, and these failed broad
runs are not presented as passing gates. Root owns their bounded cross-run comparisons.

The complete web run took 2078.55 seconds with the maintained two-worker setting:
222 files passed and two failed; 2909 tests passed and two failed. “Keeps held section
JSON exactly when a rename makes the applied section equal to it” hit the unchanged
20-second test timeout. “Adds exactly one operation on the repaired source, as one step
after the rename” expected one save PUT but received **two**. The final assertion is
retained in the original check excerpts. No coverage summary was emitted because tests
failed. There was no replacement run or change to deadlines/assertions.

The first lint run caught two `require-await` errors in new synthetic fetch callbacks;
they were corrected with `Promise.resolve`. One test import needed formatting. The
first native-probe attempt sent an inappropriate JSON content type on a bodyless publish
request and correctly received `MALFORMED_BODY` before any MCP call; only the probe
header was corrected. Both original harness/check failures are retained externally.

The native matrix uses real authenticated API/SQLite data and actual built plugin stdio
registrations through the MCP SDK. It checks both `describe_loop` and `start_run`, padded
and repeated whitespace, exact-ID priority over another loop's name, ULID-shaped-name
fallback, foreign-owner invisibility, truthful not-found guidance and distinct Unicode
spellings. Separate controlled-upstream tests establish ambiguity refusal and preservation
of non-lookup API failures. Generated trigger/exit loops make no provider calls.

`public-mcp-results.json` contains all 112 baseline/candidate outcome summaries and 32
selected unchanged original MCP content blocks. `bindings.json` records the admitted
base, combined source commit, repository-relative author file hashes, original manifest
hashes, sanitized registrations and external original-evidence hashes. The accompanying
check excerpts retain original outcomes with private-machine lines omitted. Full source
and original evidence stay external. Native child processes and disposable data
directories were verified absent after cleanup.

This is author evidence. It does not establish independent QA, opposite-family review,
final audit, current-head/current-target CI, merge, deployment or owner acceptance.
No live provider or personal plugin installation was used. Root separately integrates
the independent QA, #472 deletion/reuse regression and admission register changes.

# W — bounded workspace implementation and caller brief

**CONDITIONAL / DO NOT DISPATCH until actual Fable 03 verdict, root selection, exact admission and A's explicit frozen interfaces.** No code/tests are to be written from this preparation alone.

Owner: root-selected performant **GPT Sol xhigh**, exact model/version recorded at dispatch. At most root + A + W + L. You may not spawn helpers or providers.

Read routing.md, selected revision-03 workspace/B26 text and source AGENTS/docs README/15/register. A owns ports.ts and handler.ts; consume their real frozen declarations. Do not redesign/rename types or add exports. WorkspacePort resolve receives only existing temp/fixed spec and runId; the engine renders templates, trims them identically and returns local invalid-template outcome before calling you.

Own exactly:
- packages/engine/src/testing/fakes.ts
- packages/infrastructure/src/fs/workspace.ts
- packages/infrastructure/src/fs/owned-resources.ts
- packages/infrastructure/src/sqlite/workspace-references.ts (trim-ownership comment only)
- packages/engine/src/edge-cases.test.ts
- packages/engine/src/run-manager.test.ts (whole file including resolve override)
- packages/infrastructure/src/fs/fs.test.ts
- packages/infrastructure/src/sqlite/history-cleanup.test.ts
- apps/api/src/history-cleanup.test.ts

Adapt FakeWorkspace, FsWorkspace and OwnedRunResources to the frozen port. Remove template evaluation/view handling from the concrete port, preserve fixed path/relative -> absolute mkdir behavior, temp root identity/ownership and canonical shared-use journal. Do not change sweep semantics. Update every direct resolve call in owned tests. Tests that formerly passed a template to the port must instead pass the engine-resolved fixed/temp spec, with actual engine template/trim validation covered through RunManager. Do not build a compatibility overload or another public directory spec.

Success cases: fixed/temp/relative paths, whitespace-trimmed template equivalence through engine, directory reuse and cache hit after successful resolve, real file contents, temp-only ownership and shared fixed canonical references. Negative cases: invalid/empty engine template yields zero port/mkdir/journal; port mkdir/journal errors stay external; unsuccessful resolution does not poison the cache; malicious/link/ownership and cleanup controls retain existing behavior. Use disposable paths only. Root/A supply any new RunManager-focused expected behavior; you alone edit run-manager.test.ts.

Run focused engine workspace and infrastructure groups in routing.md. API history-cleanup direct test follows pnpm.cmd build; full check/coverage is root's combined gate. Return source/patch hashes, all touched callers (including override), command results and remaining coverage limits. Fakes and implementation tests are not independent real-disk/native/browser QA. No changes to core/shared interfaces, other tests, docs/register, UI, owner state, Git index/branches/commits or providers. If a frozen signature cannot satisfy a caller, return the exact mismatch to root/A and stop that dependent change.

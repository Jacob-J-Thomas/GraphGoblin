# WP-G2 #240, round 4

## 1. Branch and worktree

Branch `codex-wp-g2-240`, worktree `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-wp-g2-240`.
Admission HEAD (the first command) was `400bfdb0663247453121818eebad788f9c664a31`.
This carries the orchestrator's round-3 commit, independent QA record, main merge and committed-byte manifests. Work is uncommitted for orchestrator review and commit; no Git index or publication operations are authorized or performed.

## 2. Per bolt: #240 audit blockers

The supplied Astra round-1 audit was read in full ([report copy](audit-round1-report.md.txt)). The unchanged admission tree was built before production edits ([build](build-before.log.txt)). The audit's two invariant checks were then run against that build over a disposable real API/SQLite instance in installed Edge, with fake harness ports and a controlled valid delivery-state response fixture for B2. This is UI reconciliation evidence, not a claim of native admission or live-provider execution.

Before reproduction: **exit 1, both checks false** ([log](reproduction-before.log.txt), [proof](before-blocker-proof.json.log.txt)).

- **B1:** `beforeCount: 200`, `afterCount: 100`; winning first ID `01M5PRQN2GG3FGY811CXMYRN53` was replaced by `01M5PRQKHB4XJ04MTJ02E70Q0X`, while status still said `Showing the newest events.` Sequence: load two filtered pages, hold A, clear filter, Back, create another matching event, complete B, load its second page, release A.
- **B2:** the loaded hundredth row still said `Pending admission`; explicit Refresh plus Load more changed that same row to `Admitted`. Its live-head read and retained continuation had both excluded it after an arrival.

After the fix and rebuild: **exit 0, both checks true** ([log](reproduction-after.log.txt), [proof](after-blocker-proof.json.log.txt)). B1 retains **200 → 200** identical rows and winner ID `01M5PWV2R90BWR9K7CQW6GS46N` after releasing A. B2 already displays **Admitted before any manual Refresh**; its historical proof property is still named `stale`. The native API process exits 0 in both runs.

The original audit source is preserved as [audit-repro-original.mjs.txt](audit-repro-original.mjs.txt), with its [launcher](server.mjs.txt). The implementation copy [audit-repro.mjs.txt](audit-repro.mjs.txt) runs under `%TEMP%\gg-wp-g2-240-round4\`, preserving the original audit folder. Its store prefix is `gg-wp-g2-240-r4-proof-` and recorded base HEAD is this admission HEAD; assertions were not weakened. The first after attempt used the original four-poll wait and stopped there despite B1 passing and B2 visibly Admitted ([log](reproduction-after-attempt-1.log.txt), [proof](after-blocker-proof-attempt-1.json.log.txt)). Successful receipt updates stop data polling earlier; the old helper also treats limit=100 as a limit=1 probe through substring matching. The final copy changes only that synchronization to wait up to the same 15 seconds for the receipt badge, then executes the unchanged B2 invariant. The metadata-only source used before and on the first after attempt is retained as [audit-repro-before.mjs.txt](audit-repro-before.mjs.txt). The original Temp audit files remain unchanged. Node 22 is selected before all commands. Manual API port is 5920; standard package tests/default browser harness retain their existing isolated automatic ports. Owner ports 4747/4748 and the owner's store/checkout are not used.

## 3. Files changed

Web:

- `apps/web/src/api/queries.ts`: latest-refresh ticket bound to cached query identity; check before and after query cancellation; silent drop with no success/error status for obsolete completions. Receipt reads re-address each loaded page by its inclusive first-row anchor and loaded size, then merge by ID while retaining membership and opaque continuation.
- `apps/web/src/events/EventsPage.tsx`: **unchanged, zero changed lines**, preserving WP-D4 PR #389's integration region.
- `apps/web/src/events/EventsPage.races.test.tsx`: four public-page regressions, covering filter changes and page unmounts plus first/hundredth pending rows after 501 tied head arrivals.
- `apps/web/src/__fixtures__/fake-api.ts`: model the public anchored-list behavior.
- `apps/web/src/events/EventsPage.test.tsx`: distinguish an anchored one-row receipt read from an unanchored `limit=1` availability probe.
- `apps/web/e2e/events-refresh.spec.ts`: controlled-response B1 sequence without timing sleeps, plus B2's hundredth-row boundary. Default configuration and existing spec bodies retained. The first browser run passed six cases but the new B2 fixture also matched the SPA HTML URL and failed JSON parsing before its product assertion ([log](browser-default-attempt-1.log.txt), [context](browser-attempt-1-error-context.log.txt), [trace disposition](NOT-KEPT.md)). Both new route handlers now explicitly require pathname /events; no product behavior changed to correct that fixture.

Final default browser result: **7 passed (2.1m), retries disabled, exit 0** ([log](browser-default.log.txt)). This includes all four Events cases and all three unchanged history cases.

API/client/storage:

- `apps/api/src/routes/triggers.ts`: small additive change confined to existing `GET /events`: optional `anchor`, mutually exclusive with cursor, owner/filter checks and bounded inclusive page; no new endpoint.
- `apps/api/src/routes/event-paging.test.ts`: inclusive tied paging/continuation, owner/filter/validation and damaged-lookahead regressions.
- `packages/infrastructure/src/sqlite/triggers.ts` and its test: optional inclusive anchor boundary in existing `SqliteInboundEvents.page`, retaining bounded raw lookahead before decoding. No receipt-admission or migration changes.
- `packages/api-client/openapi.json`, `src/generated/schema.ts`: regenerated query parameter; `src/resources.test.ts`: supported client serialization regression.
- Docs/07, docs/09, generated API reference, the existing #240 CHANGELOG bullet and implementation evidence. Independent QA files are read-only.

Changed production ranges in the final files: `queries.ts` 283–286, 292–310, 315, 317–342 and 381–392. `EventsPage.tsx`: **zero changed lines**. Shared WP-D4 files: API `routes/triggers.ts` 190–206 and 214–240, confined to GET; infrastructure `sqlite/triggers.ts` 392–406 and 425–434, confined to anchored paging. The POST intake/admission and receipt-write regions are unchanged.

## 4. Tests

Before fix, all four new public-page cases failed ([log](regressions-before.log.txt)):

- `drops Refresh A after filter change, Back, Refresh B and paging` and the page-unmount variant: obsolete A changed the winning 200-row snapshot.
- `updates a pending row at loaded index 0 despite 501 tied head arrivals` and index 99: `Unable to find an element with the text: Admitted.`

The first test attempt synchronized on a mutation-cache settlement callback, before the queued UI notification, so B1's assertions ran too early. That inadequate attempt is retained ([log](regressions-before-attempt-1.log.txt)); the corrected test waits for the public `useIsMutating` hook to render settlement before asserting the page, and both B1 variants demonstrably fail before the production fix. B2's failures were visible in both attempts.

API before: the two new anchored-read cases failed because the parameter was rejected ([log](api-regressions-before.log.txt)). First API after attempt exposed incorrect fixture ordering: a `7ZZ...` ID was not newer than arbitrary fixture IDs. The fixture now uses the maximum alphabetic ID; the original attempt remains ([log](api-targeted-after-attempt-1.log.txt)).

Existing receipt tests originally classified all `limit=1` calls as probes. The new one-row anchored data read exposed that assumption: targeted run **18 passed / 2 failed** ([log](web-targeted-after-attempt-1.log.txt)); required isolated rerun **5 passed / 2 failed** ([log](events-existing-isolated.log.txt)). Their data-read classification now also recognizes `anchor`, retaining the same state-transition and stop-polling assertions. This is a request-contract test update, not a timeout or threshold adjustment.

Focused results: **4/4** new races ([log](web-races-after.log.txt)), **6/6** API paging ([log](api-targeted-after.log.txt)), **29/29** storage tests ([log](infrastructure-targeted-after.log.txt)).

Full web coverage: **132/132 files, 1,647/1,647 tests passed**. Lines **98.94% (7,488/7,568)**, branches **94.98% (7,798/8,210)**, statements **98.02%**, functions **98.48%** ([log](web-coverage.log.txt)). Both required coverage dimensions remain above 90%; no threshold or exclusion changed.

Client full coverage: **1 failed / 7 passed files; 2 failed / 71 passed tests (73 total)**. Both failures are in untouched `src/templates.test.ts`. No percentages were emitted ([log](client-coverage.log.txt)).

Infrastructure full coverage: **5 failed / 46 passed files; 22 failed / 751 passed tests (773 total)**. Failures are in untouched `adversarial.test.ts`, `process/scripts.test.ts`, `claude/process.test.ts`, `claude/readiness.test.ts`, and `sqlite/upgrade.test.ts`; no percentages were emitted ([log](infrastructure-coverage.log.txt)). The changed storage test file passed.

API full coverage: **63 passed / 2 skipped files (66 total); 1,314 passed / 8 skipped tests (1,331 total), one unhandled worker error** in untouched `src/cron-preview.test.ts`, exit code 3221225477. The command exits 1. Emitted coverage is **97.30% lines, 92.81% branches**, statements 95.81%, functions 94.04%; these are partial-run figures because that worker did not finish ([log](api-coverage.log.txt)).

Each untouched failing file was run once through `pnpm.cmd --filter <package> exec vitest run <file> --maxWorkers=1`, after the full runs ended. Original full-run failures are retained. The [driver copy](isolated-reruns.ps1.txt) and [summary](isolated-reruns.log.txt) record the six assertion-failing files; the API worker-crash file is run separately.

| Isolated file                                  | Result                            | Evidence                                                            |
| ---------------------------------------------- | --------------------------------- | ------------------------------------------------------------------- |
| `api-client: src/templates.test.ts`            | 1 failed / 1 passed (2); exit 1   | [Log](client-src-templates-test-ts-isolated.log.txt)                |
| `infrastructure: src/adversarial.test.ts`      | 1 failed / 19 passed (20); exit 1 | [Log](infrastructure-src-adversarial-test-ts-isolated.log.txt)      |
| `infrastructure: src/claude/process.test.ts`   | 3 failed / 2 passed (5); exit 1   | [Log](infrastructure-src-claude-process-test-ts-isolated.log.txt)   |
| `infrastructure: src/claude/readiness.test.ts` | 1 failed / 20 passed (21); exit 1 | [Log](infrastructure-src-claude-readiness-test-ts-isolated.log.txt) |
| `infrastructure: src/process/scripts.test.ts`  | 3 failed / 36 passed (39); exit 1 | [Log](infrastructure-src-process-scripts-test-ts-isolated.log.txt)  |
| `infrastructure: src/sqlite/upgrade.test.ts`   | 3 failed / 23 passed (26); exit 1 | [Log](infrastructure-src-sqlite-upgrade-test-ts-isolated.log.txt)   |
| API cron-preview                               | 13 passed (13); exit 0            | [Log](api-cron-preview-isolated.log.txt)                            |

Full-suite failures remain failures regardless of the isolated rerun results. No root-cause claim is inferred solely from machine load, and no timeout, retry setting, coverage threshold or exclusion is changed.

## 5. Gates

All commands use PowerShell, Node 22 first on PATH, `pnpm.cmd`, worktree root. Commands/results are finalized below.

| Command                                                                                                              | Result                                                                         | Evidence                               |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------- |
| `pnpm.cmd typecheck`                                                                                                 | Pass, 20/20 tasks, including final browser fixture                             | [Final log](typecheck-final.log.txt)   |
| `pnpm.cmd lint`                                                                                                      | Pass; existing ThreadViewer warning                                            | [Log](lint.log.txt)                    |
| `pnpm.cmd format --ignore-path .gg-wp-g2-240-format.ignore`                                                          | Pass; independent QA excluded from writes                                      | [Log](format.log.txt)                  |
| `pnpm.cmd check:layers`                                                                                              | Pass                                                                           | [Log](check-layers.log.txt)            |
| `pnpm.cmd check:deps`                                                                                                | Pass; existing drizzle config no-orphans warning                               | [Log](check-deps.log.txt)              |
| `pnpm.cmd check:tokens`                                                                                              | Pass                                                                           | [Log](check-tokens.log.txt)            |
| `pnpm.cmd check:docs`                                                                                                | Pass                                                                           | [Log](check-docs.log.txt)              |
| `pnpm.cmd format:check`                                                                                              | Pass, includes read-only QA checking                                           | [Log](format-check.log.txt)            |
| `pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=1`                                                    | Pass: 1,647 tests; 98.94% lines, 94.98% branches                               | [Log](web-coverage.log.txt)            |
| `pnpm.cmd --filter @graphgoblin/api-client test:coverage --maxWorkers=1`                                             | Fail: 2 failed, 71 passed; untouched templates tests                           | [Log](client-coverage.log.txt)         |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=1`                                         | Fail: 22 failed, 751 passed; five untouched files                              | [Log](infrastructure-coverage.log.txt) |
| `pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers=1`                                                    | Fail: worker crash in untouched cron-preview.test.ts; 1,314 passed, 8 skipped  | [Log](api-coverage.log.txt)            |
| `pnpm.cmd build`                                                                                                     | Pass                                                                           | [Log](build.log.txt)                   |
| `pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/events-refresh.spec.ts e2e/history.spec.ts --retries=0` | Pass: 7/7 under default configuration                                          | [Log](browser-default.log.txt)         |
| `node "$env:TEMP/gg-wp-g2-240-round4/repro-blockers.mjs"`                                                            | Pass: both invariants true, exit 0; synchronization correction explained above | [Log](reproduction-after.log.txt)      |
| `pnpm.cmd --filter @graphgoblin/api-client generate`                                                                 | Pass                                                                           | [Log](client-generate.log.txt)         |
| `pnpm.cmd docs:generate`                                                                                             | Pass                                                                           | [Log](docs-generate.log.txt)           |

The final browser-only lint also passes ([log](browser-final-lint.log.txt)). Protected evidence check: **257 files, zero changed hashes** ([log](independent-qa-check.log.txt), [before](independent-qa-before.log.txt), [after](independent-qa-after.log.txt)).

The first typecheck rejected explicit `undefined` properties under exact optional-property typing ([log](typecheck-attempt-1.log.txt)); constructing a cloned request and deleting the excluded bound fixed it. The new data/status behavior did not change.

The first formatter invocation used an ignore file in Temp, which resolved outside the worktree and ignored all files; it gets **no gate credit** ([log](format-attempt-1.log.txt)). The valid invocation uses `.gg-wp-g2-240-format.ignore` at the worktree root, copied from [format.ignore.txt](format.ignore.txt). It retains the existing ignore rules and adds only the explicitly protected independent QA folder. Representative production inclusion and QA exclusion were verified before running it. The temporary single file is removed after use; no directory is deleted. Protected-file hashes are recorded before and checked after formatting.

## 6. Docs

Docs/07 documents inclusive anchor semantics, owner/filter behavior, mutual exclusion with cursor, bounded reads and latest-refresh ownership. Docs/09 explains recovery of displaced pending rows and silent obsolete completions. The top #240 CHANGELOG bullet retains the main-merge union and ends `(#240)`. OpenAPI, generated client schema and API reference are regenerated. No ADR, migration or dependency changes.

## 7. Decisions and parameters

- **Refresh ownership:** a symbol ticket is registered synchronously against the QueryClient's canonical cached query object. A weak map follows that object's lifetime, including remounts, without keeping filter keys alive indefinitely. Query identity plus the latest ticket are checked before cancellation and again after its asynchronous boundary. An evicted/recreated scope cannot accept an old result. Only a committed response sets the newest-page status; obsolete success/error states are suppressed.
- **Bounded receipt reads:** existing `before` is timestamp-exclusive and cannot isolate a first row among arbitrary timestamp ties. Existing cursors are opaque and strictly older, so a continuation does not re-read its own boundary. No existing direct-event read is exposed. Add an inclusive `anchor` to the existing list parameters rather than decoding/forging cursors or scanning a history prefix. The store performs one indexed inclusive range using the existing 100-default/500-maximum page policy; the UI requests its loaded page size. Membership, ordering and continuation remain the original snapshot's.
- **Decode only the page:** inclusive selection lives in the existing SQL paging helper, so raw lookahead is still trimmed before decoding. This avoids materializing an extra older record outside the returned page, including at limit one.
- **No extra polling:** retain both two-second cadences. Receipt polling stops as soon as loaded receipts are terminal; idle checks still use only `limit=1`. No new engineering timeout, byte cap or retry policy is introduced.
- **Browser synchronization:** use held real HTTP responses and response consumption/painting, not fixed timing sleeps. B2 controls a valid response's delivery state through the browser transport; it does not assert native webhook admission behavior.

## 8. Caveats and open items

The two #240 audit blockers are fixed in focused and built-app checks. The full gate set is **not green**: client and infrastructure have failures in untouched files, and API has an untouched worker crash. Their isolated reruns are reported separately, without replacing the original failed results. Complete-package coverage for client/infrastructure is unavailable from these failed runs; the API percentages are partial. Reviewer/orchestrator triage and authoritative CI are still needed before claiming full gate completion.

The orchestrator commits, runs independent QA and Astra audit round 2, and owns exact-head sign-off. No implementation verification here grants merge approval. N1 belongs to the orchestrator's completed manifest repair; N2 remains set aside under D-035. No routing algorithm or timeout is changed. WP-D4's targeted Event seeding integration remains a second-merge reconciliation; this round does not anticipate its contract.

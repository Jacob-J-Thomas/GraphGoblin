# WP-F1 round 6 (#179): nested manual admission

## 1. Branch and worktree

`codex-wp-f1-readiness-precision`, worktree `.claude/worktrees/codex-wp-f1-readiness-precision` under the GraphGoblin checkout. Base: `130446c7e9dc3fb16d3e820a95d0d4bbd2f9aa41`. Uncommitted; ready for orchestrator commit after independent review. No index or branch changes, owner-app/store access, installed CLI invocation or paid provider turn.

## 2. Per bolt

The #179 acceptance-audit admission gap is **reproduced and fixed**.

Before the fix, the new public-route regression failed with:

```text
Expected: { status: 422, probes: 1, parentEffect: false }
Received: { status: 202, probes: 0, parentEffect: true }
```

Command: `pnpm.cmd --filter @graphgoblin/api exec vitest run src/nested-readiness.test.ts -t 'rejects a signed-out child' --maxWorkers 1`. One failure, nine filtered cases, before production edits.

A separate built public HTTP reproduction used the native no-turn C# CLIs built from `tooling/fixtures/readiness-cli.cs`, a new `gg-wp-f1-r6-data-*` store, Node 22.14.0 and port **5624**. No installed provider binary was invoked.

| Observation                                   | Before                                                                     | After                                     |
| --------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------- |
| Starting the signed-out Claude child directly | 422 `HARNESS_NOT_READY`; one Claude probe                                  | 422 `HARNESS_NOT_READY`; one Claude probe |
| Starting the mutate → subloop parent          | 202 in 23 ms; zero admission probes                                        | 422 in 934 ms; one Claude probe           |
| Durable parent mutation                       | Recorded                                                                   | No parent run, history or mutation        |
| Child run                                     | Started with the queued pinned version; failed `HARNESS_NOT_AUTHENTICATED` | None                                      |
| Total created runs                            | Two                                                                        | Zero                                      |
| Provider/model turn commands                  | Zero                                                                       | Zero                                      |

Complete HTTP bodies, queued pins, command boundaries and prior durable history are in [round-6-before.json](round-6-before.json) and [round-6-after.json](round-6-after.json). Probe counts are computed from `--version` tokens in the recorded commands, including Claude's suppression-flag prefix. Native timing samples are single local observations under gate load, not a performance guarantee.

Manual UI/API/MCP admission now receives the engine's prepared root and child pins. Readiness traverses executable child definitions with cycle protection and the configured depth limits, then checks all distinct harnesses concurrently through one request-owned memo. The same prepared intent commits only after a successful check. A nested failure returns 422 `HARNESS_NOT_READY`, naming the child loop and node and carrying `loopId`, `versionId` and `nodeId`. It commits no run, queued event or draft snapshot and starts no parent effect.

## 3. Files changed

### Engine

- `packages/engine/src/run-manager.ts`: adds an optional pre-admission policy over the actual frozen plan, releases the pin lock during policy IO, revalidates version existence and commits that same intent.
- `packages/engine/src/start-admission.test.ts`: four public manager tests for refusal without durable effects, immutable pins, lock release and deletion races.

### API

- `apps/api/src/run-readiness.ts`: walks pinned definitions breadth first within execution depth limits, shares concurrent harness probes and returns origin-aware readiness issues.
- `apps/api/src/routes/runs.ts`: applies that policy only to manual starts, replacing the root-only preflight path.
- `apps/api/src/nested-readiness.test.ts`: 19 public-route cases, including both package CLI executables, admission counts, concurrency, pinning, cycles, depth limits and deletion/draft races.

### Documentation

- `CHANGELOG.md`: adds the nested manual-admission guarantee and explicitly preserves other start paths (#179).
- `docs/06-harness-integration.md`: explains pinned recursive admission, memo sharing, depth/cycle rules, origin fields, lock release and unchanged non-manual behavior.
- `docs/qa/2026-10-19-wp-f1-readiness/README.md`: adds owner step 10 for the nested refusal and probe-count checks using the no-turn fakes.
- `docs/qa/2026-10-19-wp-f1-readiness/round-6-before.json`: records the built HTTP failing baseline without local filesystem paths.
- `docs/qa/2026-10-19-wp-f1-readiness/round-6-after.json`: records the built HTTP refusal after the fix without local filesystem paths.
- `docs/qa/2026-10-19-wp-f1-readiness/round-6.md`: this report and verification evidence.

The engine and route edits are the cross-package changes explicitly assigned by this brief. No visual component, model definition, contract schema or fixture implementation is changed.

## 4. Tests

New public API suite: **19 passed**. Existing model-readiness checks also passed alongside the first ten new cases: **26 passed across two files**. New public engine suite: **four passed** after correcting a new test fixture's invalid empty mutation list. The baseline failure above was recorded before the production fix.

Probe counts below are assertions over the public API and fake harness ports. The final two rows also spawn the existing package `.mjs` CLI fixtures through the real harness preflight implementations.

| Scenario                                         | Claude probes | Codex probes | Outcome                                                                                      |
| ------------------------------------------------ | ------------: | -----------: | -------------------------------------------------------------------------------------------- |
| Ready parent without inference, signed-out child |             1 |            0 | 422 before mutation; child loop/node identified                                              |
| Unready Claude parent, ready Codex child         |             1 |            1 | 422; no run created                                                                          |
| Claude in both parent and child                  |             1 |            0 | 202; two synthetic harness turns                                                             |
| Ready Codex parent and ready Claude child        |             1 |            1 | Both probes arrive at a barrier before either is released; 202                               |
| Published Claude child, unpublished Codex draft  |             1 |            0 | 202; published child executes                                                                |
| Numbered Claude v1, newer published Codex v2     |             1 |            0 | 422 from v1                                                                                  |
| Child v2 publishes while v1's probe waits        |             1 |            0 | Queued pin and actual child stay on v1; independent v2 publication makes its own Codex probe |
| Grandchild at depth 2 with middle limit 1        |             0 |            0 | 202; execution depth limit prevents the leaf turn                                            |
| Grandchild at permitted depth 2                  |             1 |            0 | 422 before root starts                                                                       |
| Same child referenced twice, ready / signed out  |             1 |            0 | 202 with two synthetic child turns / 422 with no run                                         |
| Middle node overrides its depth limit to 2       |             1 |            0 | Executable leaf is checked; 422                                                              |
| Cyclic references                                |             1 |            0 | One nested issue, 422; walk terminates                                                       |
| Nested Codex LLM decision, transport failure     |             0 |            1 | 422 with decision node id                                                                    |
| Root draft changes during its probe              |             1 |            0 | 202 with the original frozen draft snapshot                                                  |
| Root / child deleted during a pending probe      |             1 |            0 | Deletion completes without waiting for the probe; start then returns 404 with no run         |
| Claude `.mjs` CLI signed-out JSON                |             1 |            0 | 422; one version/help/auth sequence; no turn command                                         |
| Codex `.mjs` CLI signed-out stderr               |             0 |            1 | 422; one version/exec-help/resume-help/login sequence; no turn command                       |

Coverage and full-suite disposition:

| Package | Test files / tests                                                                     |  Statements |    Branches |   Functions |       Lines | Disposition                              |
| ------- | -------------------------------------------------------------------------------------- | ----------: | ----------: | ----------: | ----------: | ---------------------------------------- |
| engine  | 31 / 540 passed                                                                        |      96.82% |      92.33% |      98.65% |      98.02% | PASS                                     |
| api     | 48 passed / 4 failed / 2 skipped files; 727 passed / 8 failed / 6 skipped tests        |      96.64% |      93.32% |      94.48% |      97.93% | Coverage thresholds pass; test gate FAIL |
| web     | Initial: 114 passed / 1 failed files, 3 unstarted files; 1,426 passed / 1 failed tests | Not emitted | Not emitted | Not emitted | Not emitted | FAIL; see separate-file triage below     |

## 5. Gates

Initial API coverage: **734 passed, one failed, six skipped**, 51 passing files, one failed file
and two skipped files (741 tests / 54 files), 1,433.80 seconds. The unchanged
`triggers/poll-http-bounds.test.ts:81` expected `HTTP_PROBE_BODY_OVERFLOW` but received
`POLL_TRIGGER_FAILED` for `items: true`. The file also failed alone with the initial allocator
(one passed / one failed). That allocator immediately reused a port for consecutive fake HTTP
servers. Rotating ephemeral allocations across the same allowed six ports made that unchanged
file pass alone (**two passed**). The corrected full API coverage run enables
`--coverage.reportOnFailure`, because the initial failure suppressed coverage output. This is
a verification-harness correction, not a product poll change. The initial failed gate is retained.

Initial web coverage: **1,426 passed, one failed** in 114 passing files and one failed file,
plus three worker bootstrap errors, 2,504.74 seconds. `editor/template-readiness.test.tsx:15`
could not find "Ready to publish". Fork workers for `NodeEditorDialog.test.tsx`,
`EditorPage.test.tsx` and `ClaudePolicyField.test.tsx` timed out before those files ran.
The initial run emitted no coverage report. The four affected files were checked separately at one worker. The template file then failed worker bootstrap (no tests ran); NodeEditorDialog ran 30 cases, with 28 passed and two failed (webhook undo retained an empty secret instead of `issue-hook`; Advanced undo/redo timed out at the unchanged 20-second limit). EditorPage passed all 37 cases; ClaudePolicyField passed all seven. Together, the initial run and the three originally missing files exercised all 1,501 unique web cases: 1,498 passed and three failed. This does not make the initial gate green, and it provides no complete coverage percentage. No visual/test source or timeout is changed.

Every pnpm command selects Node **v22.14.0** first on PATH.

| Command                                                                                      | Result                                                                                                                   |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pnpm.cmd typecheck`                                                                         | PASS: 20 tasks; initial narrowing error corrected, then full gate passed.                                                |
| `pnpm.cmd lint --concurrency=2`                                                              | PASS: 11 uncached tasks, 285.189 s; initial type/lint findings in new code/tests corrected.                              |
| `pnpm.cmd format:check`                                                                      | PASS: all matched files use Prettier style.                                                                              |
| `pnpm.cmd docs:generate`                                                                     | PASS; generated references unchanged.                                                                                    |
| `pnpm.cmd check:docs`                                                                        | PASS: generated docs are up to date.                                                                                     |
| `pnpm.cmd --filter @graphgoblin/engine test:coverage --maxWorkers 2`                         | PASS: 540 tests.                                                                                                         |
| `pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers 1`                            | FAIL: initial 734 passed, one failed, six skipped; immediate-port-reuse harness artifact reproduced alone and corrected. |
| `pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers 1 --coverage.reportOnFailure` | FAIL: 727 passed, eight failed, six skipped; coverage thresholds pass; all eight failures pass alone.                    |
| `pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers 2`                            | FAIL: 1,426 passed, one failed, three worker bootstrap errors; no coverage emitted.                                      |
| `pnpm.cmd build`                                                                             | PASS: 11 tasks on the final implementation; Vite build and service worker complete.                                      |
| Edge: the three requested specs, case groups listed below                                    | FAIL: 16 passed / six known failures; all nine readiness cases pass.                                                     |

Corrected API collection: `pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers 1 --coverage.reportOnFailure` returned **FAIL**, with **727 passed, eight failed, six skipped**, 48 passed / four failed / two skipped files, in 2,767.35 seconds. Coverage is statements **1,987/2,056 (96.64%)**, branches **1,287/1,379 (93.32%)**, functions **394/417 (94.48%)**, and lines **1,803/1,841 (97.93%)**. The earlier poll overflow case passed with the corrected port allocator. The eight failures are four native-entry timeouts in `main.test.ts` (60 s), two constructed-recovery cases in `subloop-restart.test.ts` (leaf not observed waiting, then 60 s cleanup timeouts), one 20 s container catalog test timeout and one 20 s template packaging test timeout. Their separate-file triage is recorded below; no test timeout or source is changed.

API separate-file commands, each with `--maxWorkers 1 --reporter=default --reporter=json --outputFile=<disposable-report>` and the corrected port environment:

- `pnpm.cmd --filter @graphgoblin/api exec vitest run src/container.test.ts -t 'reads existing manual catalog entries'`: **one passed**, 26 filtered; 192.11 s total, 17.46 s test body.
- `pnpm.cmd --filter @graphgoblin/api exec vitest run src/templates/catalog-package.test.ts -t 'ships only declared starting-point assets'`: **one passed**, three filtered; 42.35 s total, 18.42 s test body.
- `pnpm.cmd --filter @graphgoblin/api exec vitest run src/main.test.ts` with the exact selection pattern below: **four passed**, five filtered; 152.04 s total; test bodies 37.12 / 34.55 / 18.51 / 20.30 s.
- `pnpm.cmd --filter @graphgoblin/api exec vitest run src/subloop-restart.test.ts -t 'the built API recovers a'`: **two passed**, one filtered; 59.24 s total; test bodies 22.08 / 25.07 s.

```powershell
pnpm.cmd --filter @graphgoblin/api exec vitest run src/main.test.ts -t 'serves authenticated requests|dispatches the API-key|releases ownership on a real corrupt|releases ownership after a real occupied' --maxWorkers 1 --reporter=default --reporter=json "--outputFile=$report"
```

All eight cases from the corrected full run pass in this separate-file triage. The initial/full failed results are retained regardless of these isolated outcomes. The container run spent 117.10 s transforming modules; the passing packaging test also finished close to its existing 20 s test limit. This is evidence of expensive local execution, not proof of the root cause of every failure. A passing coverage threshold is not a passing test gate.

### Edge disposition

After the final build, Edge used `GG_E2E_BROWSER_CHANNEL=msedge`, one worker and `--retries=0`. All **22 unique cases** in the three requested specs executed: **16 passed, six failed**. The failures remain failures; no executed failing browser case was retried.

| Spec                     | Passed | Failed | Disposition                                                                                                                                                                                                |
| ------------------------ | -----: | -----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readiness.spec.ts`      |      9 |      0 | All states, first-load and cached-refresh cases pass.                                                                                                                                                      |
| `claude-harness.spec.ts` |      5 |      2 | Both line 159 variants fail: missing saved-value status for `readiness false`; hidden Model field times out for `readiness true`. These belong to WP-F2b.                                                  |
| `model-picker.spec.ts`   |      2 |      4 | Known #205: line 28 dark/light expect the catalog choice but receive empty; line 94 cannot follow the catalog-help link inside collapsed Advanced; line 151 cannot find Retry model catalog and times out. |

Commands, each preceded by the Node 22/Edge/port environment above:

- `pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/readiness.spec.ts e2e/claude-harness.spec.ts e2e/model-picker.spec.ts --list --reporter=json`: collected 22 unique cases.
- The first Claude line 77 case passed (31.0 s) in an initially mis-grouped invocation; a temporary PowerShell JSON-array selection mistake selected all cases instead of one. That owned invocation was interrupted before a second case completed. The completed pass is retained from CLI output; the helper was corrected, without changing product/spec source.
- `pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/readiness.spec.ts e2e/claude-harness.spec.ts e2e/model-picker.spec.ts --workers=1 --retries=0 "--grep=$pattern" --reporter=list,json --output=<disposable-artifacts>` (`$pattern = [regex]::Escape($title) + '$'`, one collected case title per group): nine case groups completed, four passed / five failed. The next group (model-picker line 151) failed global setup because the server did not start within the existing 60 s deadline; no case executed in that group. That fixture failure remains recorded.
- After concurrent coverage jobs ended, `pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/model-picker.spec.ts:151 e2e/model-picker.spec.ts:195 e2e/model-picker.spec.ts:276 e2e/readiness.spec.ts --workers=1 --retries=0 --reporter=list,json --output=<disposable-artifacts>` ran the 12 still-unexecuted cases: 11 passed / one known line 151 failure (7.3 min). This completes coverage of the collected cases; it does not erase the global setup failure or earlier test failures.

The initial grouping mistake and the existing fixture's retention of multiple listeners made case groups necessary within the six-port constraint. Raw JSON reports and browser artifacts remain under the disposable fixture root for the orchestrator; no screenshot, trace, app data or local path is added to product source.

`pnpm.cmd check:layers`: PASS. `pnpm.cmd check:deps`: PASS with zero errors and one existing no-orphans warning for `packages/infrastructure/drizzle.config.ts`.

Verification-only environment for API/web coverage and Edge: a temporary `NODE_OPTIONS` preload makes excluded TCP ports appear occupied and allocates ephemeral listeners only within **5624–5629**. It changes no product or test source. A real-socket check confirmed ephemeral allocation at 5624, collision retry at 5625 and refusal of 5600. Per-listener logging records 131 binds, all within 5624-5629 (each of the six ports was used); none outside the allowed range. The final audit, after API triage, found zero excluded-port binds. TEMP/TMP/TMPDIR for those suites point inside the newly created `gg-wp-f1-r6-fixtures-*` root. Existing subprocess fixtures otherwise choose 5600–5699 and browser fixtures choose arbitrary ephemeral ports, so the preload preserves the brief's narrower limit. Full command environments and listener audit are summarized with the final results below. The corrected allocator rotates the first candidate within the six-port range to avoid immediate endpoint reuse.

A read-only resource snapshot observed 97 Node processes using about 8,202 MB of working set. That does not attribute them to this task. CIM process inventory was denied; the earlier recorded API worker 48836 was separately confirmed exited. No unrelated process was stopped and no orphan-process diagnosis or fix is claimed.

Turbo emitted shared-cache `Access is denied (os error 5)` warnings while successful build/typecheck tasks continued. No permission override, dependency link, threshold change or timeout adjustment was made.

## 6. Docs

Docs/06 and owner step 10 describe the guarantee across pinned nested definitions. The CHANGELOG adds the #179 behavior change. No schema/route-shape change or new ADR is needed: this enforces D-017 at the existing manual admission boundary. `docs:generate` is run because the route implementation changed; generated references remain unchanged, and `check:docs` confirms they are current. The new optional engine callback is composition policy, not an HTTP request option.

## 7. Decisions and parameters

- Prepare the actual intent under the existing pin lock, run slow policy outside it, then reacquire it to revalidate the source and resolved versions before committing the original intent. This preserves immutable draft/published pins without blocking unrelated starts or deletion behind CLI timeouts.
- Use the execution handler's per-reference depth limit, including `depthLimitOverride`; the schema caps configured limits at 64. Do not invent a second depth constant. Visit versions breadth first, once at the shallowest depth, so a cycle/repeated child cannot multiply probes or hide a shallower executable path.
- Collect inference and LLM decision harnesses independently of catalog readiness, then use the request-owned memo. An unsupported/disabled catalog selection remains a catalog fact; a failed harness check remains a readiness cause.
- Scheduled/webhook admissions, internally started subloops and resumes do not receive the manual policy callback. They retain their existing execution-time behavior, which can fail after earlier effects. A manually admitted descendant is checked in the root operation, without another admission probe when the engine later starts it.
- Unresolved child references retain `SUBLOOP_NOT_FOUND` execution behavior. Readiness observes the definitions pinned at admission; it cannot guarantee provider/account health at a later turn.

## 8. Caveats and open items

Independent review and owner product acceptance are still required before #179 closure. No commit, staging, push, merge, branch switch, installed provider invocation or paid turn occurred. Native HTTP evidence uses only the C# no-turn fakes; successful unit scenarios use synthetic `FakeHarness` turns. The temporary collector and port preload live under the disposable fixture root, not in product source. Temporary directories and generated coverage/browser artifacts are left for orchestrator cleanup; this worker does not delete directories through tools.

API triage is complete: the eight failed cases pass alone, while both full API failures remain recorded. The listener audit contains 131 allowed-port binds and zero excluded-port binds. Web coverage remains unavailable because the failed full gate did not emit it; the isolated file results above do not replace that failed gate. The Edge test gate has six existing failures, including the two cases assigned to WP-F2b in the brief; this worktree does not include that branch's fix.

Cleanup inventory for the orchestrator: the disposable `gg-wp-f1-r6-fixtures-*` root contains the native fake executables, command/scenario files, collectors, port preloads, listener log, gate JSON and browser artifacts; three separate `gg-wp-f1-r6-data-*` stores hold the initial health-path attempt and the before/after native runs. Generated `packages/engine/coverage`, `apps/api/coverage`, and browser test/report outputs may also remain. This worker has not deleted those directories. Exact local locations are available in the tool transcript; the checked-in evidence strips local filesystem paths.

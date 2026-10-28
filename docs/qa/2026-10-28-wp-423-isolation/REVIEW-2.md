SIGN-OFF: WP-423 at 6ce776b5626a29afb9c71162d1460696aee61071 may merge.

Independent review, scan 2 of at most 3, 2026-10-28. The round-one P2 is fixed, including both the listed-server omission and the dotted-override prototype mutation. No new merge-blocking finding. One pre-existing, non-blocking P3 follow-up is recommended below. This sign-off does not claim live-provider or native tree-termination acceptance.

## 1. Finding and follow-up recommendation

1. **P3, non-blocking, outside the adapter fix - reject a reserved contract key explicitly rather than silently dropping it.** Location: `packages/contracts/src/nodes.ts:201-203`, `HarnessOptionsSchema.configOverrides` (`z.record(z.string(), z.unknown())`).

   **Reproduction through the public contract:** create `raw` with `JSON.parse('{"__proto__":{"features":{"plugins":true}},"features.plugins":false}')`, then call `HarnessOptionsSchema.parse({configOverrides: raw})`. The input has own keys `__proto__` and `features.plugins`; the parsed output has only `features.plugins`. Parsing succeeds without reporting the omitted key. The full `Object.prototype` descriptor snapshot remains unchanged.

   **Expected follow-up:** refuse the original reserved key with an explicit validation issue naming `configOverrides.__proto__` before record parsing erases it. Authored configuration should not be silently rewritten. A suitable separate issue is **“Reject top-level **proto** before contract record parsing drops Codex config overrides.”** No GitHub issue was created by this reviewer.

   **Disposition:** yes, this deserves a follow-up issue for contract/data fidelity. It is pre-existing and not an isolation bypass or a blocker for this fix: the key is discarded rather than applied, the adapter now refuses it when supplied directly, and direct HTTP bodies containing a literal `__proto__` key are rejected even earlier with `400 MALFORMED_BODY`. Both top-level and nested/array HTTP cases were independently checked. Do not describe the direct HTTP API as silently accepting this input; the demonstrated silent drop is at the public schema boundary.

## 2. Head, scope, and environment

- Reviewed HEAD: `6ce776b5626a29afb9c71162d1460696aee61071`, confirmed before work and again before the report. It matches the required `6ce776b5` prefix.
- Fix reviewed: `git diff a1991104 HEAD`. Whole WP reviewed in context: `git diff a4fee9a9 HEAD`. The new commit is `6ce776b5`, “Refuse prototype-sensitive and non-plain --config key segments in loop Codex turns (#423).”
- The worktree is currently detached at the supplied head (`git status --short --branch`: `## HEAD (no branch)`). It was clean when this scan began. The reviewer did not switch branches or move HEAD.
- Worktree: `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-review-423`.
- Runtime: Node `v22.23.4`, executable `%USERPROFILE%\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64\node.exe`, first on PATH for builds, gates and probes. pnpm `12.8.1`; all Windows PowerShell invocations used `pnpm.cmd`.
- Dependencies were present. No installation, links/junctions, commits, index changes, push, merge, rebase, stash, manual directory deletion, owner-store access, or sub-agents.
- Disposable gateways used port 6380, sequentially. Test shells used `GG_TEST_PORT_START=7620`, `GG_TEST_PORT_COUNT=40`. All reviewer-created stores, fixtures and logs use `%TEMP%\gg-rev423b-*`. Gateways stripped inherited `GG_*`, `JEV_API_KEY`, `NODE_OPTIONS` and coverage variables before setting their explicit disposable configuration.
- Real Codex turns: **0**. Real Claude turns: **0**. Fake executable turns are not counted as provider evidence. No live process-tree scripts were run.
- `REVIEW-2.md` is this scan's only repository addition. Existing product code, tests and documentation were not edited.

## 3. Verification of the P2 fix

Source review confirms the intended mechanism:

- `isolation.ts:104` builds tables with `Object.create(null)`; defaults, server switches, `expand` and `merge` use that storage. `options.ts:67` also uses it while sanitizing objects, including objects inside arrays.
- `plainSegment()` at `isolation.ts:42` accepts letters, digits, `_` and `-`, and rejects the exact segments `__proto__`, `constructor`, and `prototype`.
- `unplainKey()` at line 50 checks dotted segments, nested object keys and tables inside arrays recursively. `clientOptions` checks the original override at `options.ts:89` before sanitizing or merging it.
- Listed names are validated before `serverSwitches` is reached. A failed listing/name validation is asynchronous turn failure; an invalid node override is a synchronous typed refusal before a listing or SDK turn is started. The engine correctly handles both boundaries.
- The default feature names are fixed plain constants. Node-authored feature keys go through the same recursive override validation.

### Independent public-harness probes

Command: `node %TEMP%\gg-rev423b-harness.mjs`, from the repository root after build. It imports the built public `CodexHarness`, `CodexStructured`, and `HarnessOptionsSchema`, uses the real installed SDK, and runs the repository's `src/fixtures/argv-cli.mjs`. It does not call private adapter functions or substitute the component under review.

**20/20 cases passed.** Before the cases, the probe captured all own-property descriptors of `Object.prototype`. It compared keys and descriptor values after every case, rather than checking only the original marker. Every comparison returned an empty changed-key set.

| Cases                                                                             | Observed behavior                                                                                                                                                                               |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mixed server lists containing `__proto__`, `constructor`, or `prototype`          | `HARNESS_TURN_FAILED`, `submission: definitely-not-submitted`, no SDK exec. Ordinary names earlier in the list do not cause a partial turn to start.                                            |
| Listed `team.docs`, `team docs`, or empty name                                    | Same safe listing refusal; no SDK exec.                                                                                                                                                         |
| Original `review.__proto__.gg_rev423_marker` override                             | `HARNESS_INVALID_CONFIGURATION`, definitely not submitted, no listing or exec, no prototype mutation.                                                                                           |
| Nested and top-level own `__proto__` overrides supplied directly to the harness   | Same configuration refusal before any CLI call. Inputs were created with `JSON.parse` so these were actual own keys.                                                                            |
| `review.constructor.prototype.gg_rev423_marker` and `features.prototype`          | Same configuration refusal; no mutation.                                                                                                                                                        |
| Spaces, quotes, empty dotted segments                                             | Same configuration refusal before any CLI call.                                                                                                                                                 |
| Reserved keys inside nested arrays and dotted prototype paths inside array tables | Same configuration refusal; no mutation.                                                                                                                                                        |
| Ordinary `toString` server, feature/table keys and array-table keys               | Accepted and serialized by the real SDK. The listed server's disable switch is retained; re-enabling an ordinary server preserves the other server's disable switch and the isolation defaults. |
| Resumed turn with a bad server                                                    | Same listing refusal and submission state; no SDK exec.                                                                                                                                         |
| Resumed turn with a bad override                                                  | Same configuration refusal before listing; no mutation.                                                                                                                                         |
| `CodexStructured.complete` with a bad listed server                               | Same listing refusal and submission state; no SDK exec.                                                                                                                                         |

The accepted ordinary control retained all six feature defaults, `notify=[]`, and the final thread policy arguments. Its `toString` server was serialized as `mcp_servers.toString.enabled=false`; there was no inherited-member lookup or disappearing key.

Evidence: `%TEMP%\gg-rev423b-harness.log.txt` and `%TEMP%\gg-rev423b-harness-UoxXo2\results.json`. The contract probe in the same invocation establishes finding 1.

### Built HTTP mapping and recovery

The built API ran on a disposable store at port 6380. The recording executable was compiled without modification from `docs/qa/2026-10-28-wp-423-qa/fake-cli.cs.txt` using Windows PowerShell `Add-Type`. It reads a fixture listing and emits synthetic SDK events; it cannot make provider calls.

The first driver established seven passing observations before encountering the earlier JSON-parser boundary described below. A separate continuation established ten more. Both gateways drained and exited **0**.

| Origin                                                                                                           | Adapter/run evidence                                                                                                                                                                                  | Recovery behavior                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Listed `__proto__`, `constructor`, `prototype`                                                                   | Run code `HARNESS_TURN_FAILED`; `details.adapterCode: HARNESS_TURN_FAILED`; `inference.submission: definitely-not-submitted`; `resumable: true`; zero fake turn invocations on those attempts.        | Resume while the name remains invalid repeats the listing and preserves the cause. Renaming the fixture server allows one successful fresh turn, retaining the ordinary `toString` server's disable switch. |
| Dotted `review.__proto__...`, `features.prototype`, constructor path, and dotted key inside a nested array table | Run code `HARNESS_TURN_FAILED`; `details.adapterCode: HARNESS_INVALID_CONFIGURATION`; `inference.submission: definitely-not-submitted`; `resumable: false`; neither listing nor fake turn is invoked. | Resume returns `409 FAILURE_NOT_RESUMABLE`, without hiding the cause or starting another turn.                                                                                                              |
| Literal own `__proto__` inside nested, array, or top-level JSON overrides                                        | HTTP `400 MALFORMED_BODY` before publication or a harness call.                                                                                                                                       | No run exists to resume; neither listing nor fake turn is invoked.                                                                                                                                          |
| Ordinary `mcp_servers.toString.enabled=true` override and safe array table                                       | Published and succeeded with `mcp_servers.normal.enabled=false`, `mcp_servers.toString.enabled=true`, all six feature defaults, `notify=[]`, and final thread policy.                                 | Normal execution remains available.                                                                                                                                                                         |

This independently verifies the unchanged engine mapping: `HARNESS_INVALID_CONFIGURATION` is a pinned refusal, and explicit submission metadata survives the adapter/engine boundary. It also confirms that resumability differs according to whether the owner can correct external machine configuration or must author a new pinned node definition.

Commands and captures:

- `node %TEMP%\gg-rev423b-http.mjs`: seven checks passed; then the driver stopped on a correctly rejected literal nested `__proto__` body. Capture `%TEMP%\gg-rev423b-http.log.txt`; store `%TEMP%\gg-rev423b-http-A5DpMG`.
- `node %TEMP%\gg-rev423b-http-boundary.mjs`: ten checks passed; capture `%TEMP%\gg-rev423b-http-boundary.log.txt`; store `%TEMP%\gg-rev423b-http-RH2LRb`.
- The continuation explicitly tested the discovered parser boundary and the remaining distinct override cases; no failing product assertion was retried to green. The initial driver exit 1 is preserved as a review-driver expectation error, not a product regression.

## 4. Tests and gates

Adapter coverage was run **once**, forced past Turbo cache:

```text
pnpm.cmd test:coverage --filter @graphgoblin/adapter-codex --force
```

**PASS:** 612 passed, 5 skipped; 15 test files passed, one skipped. Coverage: lines **99.41% (511/514)**, branches **95.51% (468/490)**, statements 98.26%, functions 99.31%. The four live tests and the installed-login probe were skipped in this environment. Evidence: `%TEMP%\gg-rev423b-adapter-coverage.log.txt`.

The selected API tests ran with the requested two-worker limit:

```text
pnpm.cmd --filter @graphgoblin/api exec vitest run src/adversarial.test.ts src/classifiers.test.ts src/container.test.ts src/nested-readiness.test.ts src/prompt-provenance.test.ts src/prompt-sdk-storage-matrix.test.ts src/provider-refusal.test.ts src/readiness-evidence.test.ts src/repair-start.test.ts src/shutdown-controller.test.ts --maxWorkers=2
```

**PASS:** all **516 tests in 10 files**, duration 102.31 seconds. Evidence: `%TEMP%\gg-rev423b-api-codex.log.txt`. There were no timing failures and no isolated rerun or suite retry in this scan.

| Command                                                                                                                             | Result                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm.cmd build`                                                                                                                    | PASS: 11/11 tasks, 5 cached, 17.33 seconds.                                                                                                                                                                                          |
| `pnpm.cmd typecheck`                                                                                                                | PASS: 20/20 tasks, 10 cached.                                                                                                                                                                                                        |
| `pnpm.cmd lint`                                                                                                                     | PASS: 12/12 tasks, 6 cached.                                                                                                                                                                                                         |
| `pnpm.cmd check:layers`                                                                                                             | PASS: layer rules OK.                                                                                                                                                                                                                |
| `pnpm.cmd check:deps`                                                                                                               | PASS: 0 errors, 3 existing no-orphans warnings for `drizzle.config.ts`, `shutdown.config.ts`, and `check-templates.d.mts`.                                                                                                           |
| `pnpm.cmd format:check`                                                                                                             | PASS: all matched files use Prettier style. This newly added record was separately formatted and checked.                                                                                                                            |
| `git diff --check a4fee9a9 HEAD`                                                                                                    | Exit 2 for trailing whitespace/blank EOF lines in the newly retained historical QA logs under `2026-10-28-wp-423-qa`; no product-code whitespace finding. The two original isolation-log EOF issues were removed by the implementer. |
| `git rev-parse HEAD`, `git status --short --branch`, scoped and whole diffs, `git log`, `rg`/`Get-Content` source/record inspection | Head, detached state, changed-file scope and evidence provenance checked.                                                                                                                                                            |

Turbo printed cache-write `Access is denied (os error 5)` warnings in successful gates; those do not change the command results and are not native termination evidence.

The implementer's `red-before-round1.log.txt` records 12 failing cases at `a1991104`. Its public-harness cases cover the original omissions and override paths; its engine case failed with a pre-existing fake-workspace CLI `ENOENT`, so that case alone is not clean before-fix engine-path evidence. This scan's real built HTTP checks independently establish both current engine outcomes. The new regressions pass in the one adapter coverage run; no product files were restored or edited to repeat red-before here.

## 5. Documentation and shared-file review

The updated documents accurately distinguish the segment rule, the two adapter refusal codes, the persisted run code, definite non-submission and the different recovery policies:

- **ADR-0063** states the rule, prototype-free storage, listed-name `HARNESS_TURN_FAILED`/resumable behavior, and override `HARNESS_INVALID_CONFIGURATION`/non-resumable behavior.
- **docs/06** adds one paragraph with the same rule, both codes, persisted `details.adapterCode`, and definite non-submission.
- **Guide 02** states the authored-key rule. **Guide 07** explains the machine-name repair/Resume path and the separate node-edit/publish/new-run path for `HARNESS_INVALID_CONFIGURATION`.
- **CHANGELOG** adds a sentence to the existing #423 bullet with the reserved/plain-segment rule and non-resumable override refusal. It retains the actionable upgrade instructions for re-enabling a server, plugins or sub-agents.

Shared-file changes remain narrow: `options.ts` changes the import, sanitizer's dictionary allocation and pre-merge validation in `clientOptions`; `threadOptions` is untouched. The new scan explicitly authorizes checking `sanitizeConfig`, so this extension of the first round's client-only implementation is appropriate. docs/06 adds two lines without repadding the capability table; CHANGELOG changes one existing bullet. No SDK patch, API implementation, contract schema, Claude implementation, dependency or web source changed in the fix. The other new files in the commit are retained QA/review evidence, not additional product behavior.

The previously disclosed personal-skills/instructions inheritance and lack of a real-turn sub-agent-tool inventory remain owner/acceptance follow-ups. The patch does not claim to resolve them. No extra live call or alternative Codex home was introduced to close those open points.

## 6. Not run and final state

- No live Codex/Claude model turns or new real process-tree observations. Historical worker/QA evidence remains attributed to its original head.
- **Native tree termination and native force-stop acceptance: not run here (D-015).** Exact refusal already observed in scan 1 and retained in the QA record: `taskkill.exe /PID <owned fixture PID> /T /F`, exit **1**, `ERROR: Access denied`. This scan does not retry that denial or describe fixture self-exit/graceful drain as successful tree termination.
- No rerun of the full API coverage suite, broad browser suite, native shutdown-console/process suites, Linux-only tests, or full engine/infrastructure coverage. This scan used the specifically requested adapter coverage and ten API files plus independent built HTTP checks. The round-one unrelated full-suite port collision remains in `REVIEW.md`; it is not silently relabeled as a green full API coverage result.
- No schema/route/dependency/web-source change required generated-doc, licence or token gates, so those were not run.
- Disposable directories are retained for inspection, with no manual cleanup attempted. Reviewer text captures are UTF-8 without BOM, redact profile paths/hostnames/SIDs, and remain below 1,000,000 bytes.
- This scan leaves only `docs/qa/2026-10-28-wp-423-isolation/REVIEW-2.md` as an uncommitted repository addition. No product, test, existing-doc, Git index or HEAD mutation was performed.

The original P2 is closed at this exact head. Finding 1 is a recommended P3 follow-up for the unchanged contract boundary and does not block this sign-off.

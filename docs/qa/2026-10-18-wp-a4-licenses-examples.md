# WP-A4 delivery report: #274 and #250

## 1. Evidence baseline

- Before-fix baseline: `4608440c0c4528a998d7974bb16a90b59102a2a2`.
- Implementation revision: `daefae5`.

## 2. Per bolt

### #274 (B08): confirmed and corrected

The first test change ran against the original parser before implementation: 13 tests, 4 passed, 9 failed. Direct calls with the permissive set `MIT`, `Apache-2.0`, `ISC` emitted these results:

| Expression                             | Quoted original result                                                                | Corrected result                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `GPL-3.0-only AND (MIT OR Apache-2.0)` | `"allowed":true,"violations":[]`                                                      | Rejected: GPL obligation retained                                                    |
| `MIT*`                                 | `"allowed":true,"violations":[]`                                                      | Rejected with a distinct guessed-marker reason                                       |
| `Apache-2.0 WITH LLVM-exception`       | `"allowed":false`; `licence "Apache-2.0 WITH LLVM-exception" is not in the allowlist` | Rejected with an explicit WITH-pair approval reason; an exact allowlist entry passes |
| `(MIT`                                 | `"allowed":true,"violations":[]`                                                      | Rejected: parse error, expected closing parenthesis                                  |
| `MIT OR`                               | `"allowed":false`; `licence "MIT OR" is not in the allowlist`                         | Rejected: parse error, expected licence ID/opening parenthesis                       |
| `AND MIT`                              | `"allowed":false`; `licence "AND MIT" is not in the allowlist`                        | Rejected: parse error at AND                                                         |
| empty string                           | `"allowed":false`; `licence "" is not in the allowlist`                               | Rejected: parse error at end of expression                                           |

The grouped test failure was `Expected values to be strictly equal: true !== false`. Malformed cases that were already rejected failed the new reason assertion because their old reason lacked `parse error`. `MIT*` produced no violation at all. Original fixture calls used package `fixture`, version `1.2.3`; the new violation objects retain versions and the CLI prints name, versions, original expression and reason.

Acceptance evidence in `tooling/scripts/licenses.test.mjs`:

- Grouping and alternatives: `grouping cannot discard a required non-permissive licence`, `nested grouping and SPDX precedence preserve all obligations`, existing AND/OR tests.
- WITH binding and policy: `WITH requires explicit approval of the exact licence and exception pair`, `WITH binds to one licence and never drops its exception`.
- Malformed input: five first-pass parse-error cases and fourteen additional malformed-expression cases; all input is parsed before evaluation, including alternatives that would otherwise pass.
- Markers and provenance: `guessed metadata has a distinct violation reason`, `guessed markers require policy opt-in across every alternative; provenance is retained`.
- Package exceptions: existing metadata override test plus `package metadata overrides do not approve WITH pairs; inherited names are not exceptions`.
- No dependency or allowlisted licence was added. The policy now explicitly sets `allowGuessed: false`.

Real dependency-manifest command: `pnpm.cmd check:licenses`, Node 22.14.0 first on PATH. Output:

```text
$ node tooling/scripts/check-licenses.mjs
Licence allowlist: OK (225 packages checked)
```

No real package required widening the allowlist. This verifies emitted production dependency metadata against repository policy, not legal certification.

### #250 (B10): measured baseline, repaired command drift, executable examples

At the before-fix baseline, the settings, draft wrapper, first-summary definition, API/MCP start payloads and failure example already matched their current contracts. In particular, trigger `type`, exit `returns` and `destinations`, and format 4 were already correct. No compatibility shapes or fabricated schema repairs were introduced.

The two replay examples were drifted. Before repair, the extracted Bash and PowerShell requests both failed with `409 REPLAY_NODE_NOT_REACHED`, detail `run <id> never started node ask`, while the test expected 202. Both now target the actual `summarise` node and succeed. Return-mapping prose used the obsolete `return.mapping` path; it now names `returns` and `destinations`.

Inventory of every existing fenced example, plus the three newly complete examples (29 blocks total). Paired command names are separate source markers and separate parameterized tests:

| Guide / example marker                  | Baseline                           | What changed / automated evidence                                                                            |
| --------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 02 `editor-url`                         | Exact, navigation only             | Marker and route-string check                                                                                |
| 02 `temp-settings`                      | Exact                              | `LoopSettingsSchema`; apply through draft endpoint and execute                                               |
| 02 `version-requests` (two GETs)        | Exact                              | Both execute against the published version                                                                   |
| 02 `export-request`                     | Exact                              | Execute draft export; `LoopExportSchema` validates format 4                                                  |
| 02 `import-request`                     | New explicit HTTP fence            | Public POST route imports each definition                                                                    |
| 02 `draft-request`                      | Exact                              | Public PUT saves the extracted draft body                                                                    |
| 02 `draft-body`                         | Exact                              | Definition schema, import/save/publish/run; Success                                                          |
| 02 `publish-request`                    | New explicit HTTP fence            | Bodyless public POST freezes the version                                                                     |
| 02 `first-summary`                      | Exact JSON                         | Fake harness validates prompt and mapped summary; account-usage note retained                                |
| 02 `bounded-repeat`                     | Prose only; no executable document | Added complete format-4 graph; three work/gate passes, Exhausted, result `{ "passes": 3 }`                   |
| 03 `run-urls`                           | Exact, navigation only             | Marker and route-string check                                                                                |
| 03 `start-request`                      | Exact                              | Public POST starts the extracted request body                                                                |
| 03 `start-filename`                     | Exact, filename only               | Checked against command file references                                                                      |
| 03 `start-body`                         | Exact                              | Actual endpoint and trigger input-schema validation; Success and summary                                     |
| 03 `start-bash`, `start-powershell`     | Exact                              | Extract URL/method/content type/file body; execute equivalent HTTP requests                                  |
| 03 `auth-bash`, `auth-powershell`       | Exact parameter fragments          | Checked as bearer-header fragments; no standalone shell execution                                            |
| 03 `start-mcp`                          | Exact                              | SDK MCP transport starts the exact loop name and input; fake-harness result and `manual.mcp` source verified |
| 03 `resume-bash`, `resume-powershell`   | Exact                              | Resume an actual fake-provider failure to Success; finished-run repeat returns 409                           |
| 03 `replay-bash`, `replay-powershell`   | Drifted                            | `ask` changed to `summarise`; replay succeeds and source result stays unchanged                              |
| 03 `events-bash`, `events-powershell`   | Exact                              | Completed-run SSE includes terminal event                                                                    |
| 03 `reconnect-bash`                     | Exact                              | SSE honours Last-Event-ID 12; all emitted IDs exceed cursor                                                  |
| 03 `returns-bash`, `returns-powershell` | Exact                              | JSON event page includes `return.delivered`                                                                  |
| 03 `failure-shape`                      | Exact response illustration        | `RunFailureSchema` validates it                                                                              |

All fenced blocks have visible `<!-- guide-example: ... -->` markers; the fixed inventory catches missing/duplicate/unlisted marked blocks. Tests use the existing `createTestApp` public helper, in-memory SQLite, disposable directories, fake clock and `FakeHarness.script`; no private state access or monkey-patching. Loop examples go through the import, save (draft/settings example), publish and run endpoints. HTTP command examples are translated to in-process HTTP requests, not launched in a shell. The MCP test additionally sends the exact `start-mcp` body through `start_run` over the SDK transport, then reads the result and thread through MCP tools.

Paid execution exclusion: `first-summary` against a real installed Codex provider requires authentication and consumes account usage. The guide states that running it consumes account usage and the test comment lists the exclusion reason; the exact inference graph is still exercised with scripted fake output. The bounded repeat needs no provider.

Exact focused command:

```powershell
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
pnpm.cmd --filter @graphgoblin/api exec vitest run src/guide-examples.test.ts
```

Initial result: 15 tests passed, including the raw-JSON import and HTTP-method checks. The review follow-up passes 16 tests with a named inventory test, exact reconnect cursor assertion and the explicit bounded-repeat request body. Regression evidence excludes initial helper errors (missing JSON content type, incorrect response-envelope assumptions and resume status); those were test-authoring mistakes, corrected before reporting guide drift.

## 3. Files changed

- Tooling: `tooling/scripts/licenses.mjs`, `licenses.test.mjs`, `check-licenses.mjs`, `tooling/license-allowlist.json`.
- API and MCP: `apps/api/src/guide-examples.test.ts` and the guide-example regression in `apps/mcp/src/mcp.test.ts`; no route, runtime or contract changes.
- Docs: guides 02/03; licensing paragraph in `docs/11-security-and-distribution.md`; this QA handoff.
- Release and testing documentation: `CHANGELOG.md` and the Test layers paragraph in `docs/10-testing-and-quality.md`.

## 4. Tests

- Licence suite: 31 tests passed. Nine first-pass tests failed before the parser fix, as quoted above. Supplemental Node instrumentation measured `licenses.mjs`: 100% lines, 98.39% branches, 100% functions.
- Initial guide suite: 15 tests passed; both original replay commands demonstrably failed before the guide repair. The follow-up passes 16 tests, including `inventories every fence in guides 02 and 03`, and verifies the extracted reconnect cursor explicitly.
- MCP suite: 38 tests passed, including `starts the start-mcp guide example through start_run with the exact loop name` in `apps/mcp/src/mcp.test.ts`. Coverage: 95.31% lines, 95.51% branches, 93.95% statements, 92.94% functions.
- Tooling package: `pnpm.cmd --filter @graphgoblin/tooling test:coverage`: 77 passed. Its existing script is `node --test`, so this package command itself does not emit coverage metrics; the separate instrumented licence run supplies the changed-parser measurement.
- API package coverage command: 624 passed, 1 failed, 2 skipped (627 total). The unchanged `src/templates/catalog-package.test.ts:49` test `ships only declared starting-point assets and removes stale files on rebuild` timed out at 20,000 ms. No coverage summary was emitted on this failing run, so API percentages are unavailable; thresholds/exclusions remain unchanged. This was the initial implementation run. Full API coverage subsequently passed in independent review, as reported in the follow-up brief; this follow-up reruns only the changed guide test file.

## 5. Gates

All gates use Node 22.14.0. The original implementation results below are retained as historical evidence; follow-up results are listed separately.

| Exact command                                                                   | Result                                                                                                                               |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm.cmd typecheck`                                                            | PASS: 20/20 tasks, no cache hits                                                                                                     |
| `pnpm.cmd lint`                                                                 | PASS: 11/11 tasks (10 cached, changed API executed)                                                                                  |
| `pnpm.cmd format`                                                               | PASS (exit 0); completed before format:check; no files outside this package scope changed                                            |
| `pnpm.cmd format:check`                                                         | PASS (exit 0): All matched files use Prettier code style!                                                                            |
| `pnpm.cmd check:layers`                                                         | PASS: `Layer rules: OK`                                                                                                              |
| `pnpm.cmd check:deps`                                                           | PASS (exit 0): 756 modules, 2904 dependencies, 0 errors; existing no-orphans warning for `packages/infrastructure/drizzle.config.ts` |
| `pnpm.cmd --filter @graphgoblin/tooling test:coverage`                          | PASS: 77 tests                                                                                                                       |
| `pnpm.cmd --filter @graphgoblin/api test:coverage`                              | FAIL: unchanged template-package rebuild test timed out at 20,000 ms; 624 passed, 1 failed, 2 skipped; no percentages emitted        |
| `pnpm.cmd check:licenses`                                                       | PASS: 225 packages                                                                                                                   |
| `node --experimental-test-coverage --test tooling/scripts/licenses.test.mjs`    | PASS: 31 tests; parser 100% lines / 98.39% branches                                                                                  |
| `pnpm.cmd --filter @graphgoblin/api exec vitest run src/guide-examples.test.ts` | PASS: 15 tests                                                                                                                       |
| `pnpm.cmd --filter @graphgoblin/api typecheck`                                  | PASS after final test-reader changes; Node reports `v22.14.0`                                                                        |
| `pnpm.cmd --filter @graphgoblin/api exec eslint src/guide-examples.test.ts`     | PASS after final test-reader changes                                                                                                 |
| `pnpm.cmd check:docs`                                                           | Not applicable: no node schema or route changed                                                                                      |
| `pnpm.cmd check:tokens` / browser specs                                         | Not applicable: no apps/web source changed                                                                                           |

### Review follow-up gates

| Exact command                                                                   | Result                                                                             |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `pnpm.cmd --filter @graphgoblin/tooling test:coverage`                          | PASS: 77 tests                                                                     |
| `pnpm.cmd --filter @graphgoblin/api exec vitest run src/guide-examples.test.ts` | PASS: 16 tests                                                                     |
| `pnpm.cmd --filter @graphgoblin/mcp test:coverage --maxWorkers=2`               | PASS: 38 tests; lines 95.31%, branches 95.51%, statements 93.95%, functions 92.94% |
| `pnpm.cmd typecheck`                                                            | PASS: 20/20 tasks                                                                  |
| `pnpm.cmd lint`                                                                 | PASS: 11/11 tasks                                                                  |
| `pnpm.cmd format`                                                               | PASS (exit 0); run before format:check                                             |
| `pnpm.cmd format:check`                                                         | PASS (exit 0): All matched files use Prettier code style!                          |
| `pnpm.cmd check:docs`                                                           | PASS: Generated docs are up to date.                                               |

## 6. Docs

- Docs 11: decided licensing bullet restored verbatim, plus expression grouping/precedence, exact WITH approval, guessed markers, syntax errors, provenance and metadata-only scope.
- Docs 10: source extraction, named inventory test, disposable API and MCP transport execution, provider boundary and exact test command.
- Guides 02/03: visible markers, explicit import/publish requests, deterministic bounded repeat, paid variant label, corrected replay target and return prose.
- CHANGELOG: one additive bullet each ending `(#274)` and `(#250)`.
- No new dependency, ADR, contract, API route or generated reference change. Policy clarifies enforcement of the existing allowlist; it does not expand it. `docs/research/licenses.md` was read and needs no new dependency entry.

## 7. Decisions and parameters

- Dependency-free recursive descent: a small grammar suffices for grouping and WITH/AND/OR precedence; all input parses before Boolean evaluation.
- WITH approval requires the exact base/exception pair in `allowed`; package metadata overrides cannot bypass it, malformed syntax or guessed-marker policy.
- Guessed metadata is rejected anywhere in an expression, including unused alternatives; explicit `allowGuessed: true` opts in without admitting an otherwise disallowed licence.
- Operators are uppercase SPDX keywords; IDs are case sensitive. Parse errors include token position and expected/found values. Unknown syntactically valid IDs remain ordinary allowlist failures.
- Reuse existing public in-process API helper and fake ports; extract source with markers and a small fence/HTTP-command reader.
- Bounded example uses three passes and inherits the default per-node visit cap of 10. Its start request explicitly sends `{ "triggerNodeId": "start", "input": {} }`.
- No runtime configuration, coverage thresholds or package exclusions changed.

## 8. Caveats and open items

- No live provider behavior is established. The exact inference graph runs with scripted fake output; MCP uses the SDK transport and a disposable API.
- The decided licensing bullet and historical extra entries in `tooling/license-allowlist.json` remain inconsistent; this follow-up restores the decided prose and does not alter the JSON or dependency ledger.
- The tooling coverage command is a plain test alias, as documented above; the supplemental instrumentation supplies the changed-parser coverage measurement.
- Historical dependency-cruiser output includes an orphan warning for `packages/infrastructure/drizzle.config.ts:1`; that file is unchanged.

# Independent QA: #427 and #365

**PASS for the bounded docs-only disposition at `8980c27c75e04d33cdcf48736c71db05e35175a3`, tree `7e23133e3d1f6ffdf49d7d025fc7a15aaf290c54`.** The original candidate `f96a4073c3b53af7724d1ef5593eeaf03194c4cd` overstated the decision path; its corrected inference/decision distinction now matches independently executed public behavior. No runtime correction is established by this QA. This is independent QA, not issue closure, owner acceptance, CI or merge authorization.

QA identity: delegated `i4_427_behavior_qa`, separate context and checkout `G:/ggq/gg-i4-427-qa/GraphGoblin`. The QA checkout remains clean at the original candidate. Corrected source was read independently from the clean author checkout and exact Git objects. Product source, index, commits, issues, owner stores/configuration and services were not modified.

## Evidence tiers and binding

- **Real native source test:** candidate `CodexHarness`, actual pinned SDK and bundled native Codex CLI `0.160.0`, disposable child environment and empty working directory, synthetic local Responses server. The provider is a controlled fixture, not OpenAI or a live account-entitlement test. Native historical-refusal and success controls passed in `native-source-attempt-2/manifest.json`.
- **Real built public components:** built API, engine, SQLite, REST, MCP server/client, pinned SDK and native CLI, with controlled-ready preflight and a synthetic loopback Responses endpoint. MCP used the SDK's in-memory transport while making actual REST requests. It did not use the owner's login, plugins or secrets. The real disk store remains under `public-native-attempt-7/store/`; snapshots, events and request bytes are retained beside it.
- **Build reuse:** the coordinator authorized read-only reuse of `G:/ggq/gg-i4-362-qa/GraphGoblin` artifacts built at signed base `02351e2fb932b3be44e7cc3fb3943a61d568226c`. The build log records 12/12 tasks and exit 0. Independent `source-binding.json` and `final-source-binding.json` establish that the only runtime-source changes are comments in `options.ts` and `isolation.ts`, both emit identical JavaScript to the base, and reused emitted JavaScript is equal after removing comments/source maps. Artifact hashes were unchanged after QA. This is not a new independent full build.
- **Real browser:** Playwright CLI with a separate named browser session opened the served built inspector. Four snapshots and screenshots were captured; relevant screenshots were visually inspected. No API mocking or fabricated browser record was used.
- **#365 SDK serialization:** actual candidate option functions and actual SDK spawned a controlled Node argv recorder instead of the native CLI. This proves arguments and ordering only. It does not run/select a Windows sandbox backend or establish effective permissions.

Node was explicitly bound to `v22.23.4`; pnpm was `12.8.1`. Frozen offline installation exited 0 with no lock/dependency changes. TypeScript for independent emission proof was `6.0.3`. Source hashes, the exact full-index candidate patch, final source copies and source excerpts are retained. The native SDK and binary hashes are in the native manifest; the SDK hash is `ae27616562385faf2c4540833d27761f348ab035c4f722076f5d7de45d9390e3`.

## Public/native outcomes: 6 of 6

Author facts were treated as hypotheses. Each final case made exactly **one authored harness start and one local model request**, with the requested model unchanged. The fixture provider explicitly disables request/stream retries. Rejected REST and MCP Resume attempts made no extra harness call or model request. No automatic fallback or replay was observed in these cases.

| Case | Observed public result | Recovery and cause |
| --- | --- | --- |
| Exact historical `gpt-5.5` HTTP 400 / `invalid_request_error` / `model_not_found` body | `HARNESS_TURN_FAILED`; `details.adapterCode: HARNESS_ARGUMENTS_REJECTED`; full historical provider account explanation retained | Non-resumable; REST Resume 409 `FAILURE_NOT_RESUMABLE`; MCP Resume error; native `turn.started` makes provenance `delivery-uncertain` |
| Alternate endpoint/model refusal, HTTP 400 / `invalid_request_error`, `param: model` | Same pinned refusal; alternate provider explanation and parameter retained | Non-resumable; REST and MCP reject Resume |
| Supported-model synthetic success | `succeeded`, one `gpt-6-luna` request | Finished-run Resume unavailable; the authored exit returns no value, correctly |
| Code-only lookalike: HTTP 400 with `other_error`, `code: model_not_found`, no account explanation | Adapter generic `HARNESS_TURN_FAILED`; public `HARNESS_DELIVERY_UNCERTAIN`; synthetic unknown explanation retained | Resume allowed; no account-restriction explanation or pinned-refusal classification |
| HTTP 503 synthetic outage | Native CLI flattens the HTTP failure to text; public `HARNESS_DELIVERY_UNCERTAIN`, adapter generic `HARNESS_TURN_FAILED` | Resume allowed; no account restriction inferred. This does not prove that all native 503s receive `HARNESS_TRANSPORT_FAILED` |
| LLM decision with the same exact historical account-refusal body | `EVALUATION_PROVIDER_FAILED`, `details.code: DECIDER_HTTP_ERROR`, exact safe message `Decision provider request failed` | Non-resumable; no provider/account explanation or raw `model_not_found` code in REST, MCP or public events. The generic category cannot establish account cause |

`public-native-attempt-7/results.json` preserves real REST snapshots and event pages, MCP `get_run`, `wait_for_run`, `read_run_events`, and refused `resume_run` results. `requests.json` preserves synthetic request bytes; `harnessCalls.json` preserves call counts. `nativeCalls.json` records real native MCP-listing calls, not simulated CLI responses. `logs.json` is fixture-local diagnostic evidence and is separate from public data.

For failures, public output was checked for absence of the synthetic private environment marker, disposable CODEX_HOME path, SDK process-exit prefix, prompt-reading banner and native/JavaScript stack framing. The historical and alternate explanations remained intact. The decision control also checked that provider text and adapter codes do not cross its safe boundary. Errors and all native operations were bounded by the controlled fixture and timeouts; arbitrary hostile-provider payload truncation is not claimed.

## Inspector outcomes: 4 of 4

`output/playwright/` holds raw snapshots and screenshots; `browser-observations.json` binds their hashes and asserted content.

| Inspector | Observed |
| --- | --- |
| Historical account refusal | Full provider explanation in the failure alert and timeline; Resume disabled with the authoritative reason |
| Unknown/code-only negative | Delivery-uncertain failure with synthetic unknown text; Resume enabled; no account explanation |
| Decision refusal | Safe `EVALUATION_PROVIDER_FAILED` and generic decision message; Resume disabled; no provider/account explanation |
| Supported positive | `succeeded`, correct no-return exit explanation, no failure alert; Resume disabled because finished |

The browser never clicked Resume or Replay, avoiding new work. Four read-only navigations exercised actual stored runs. The disabled Resume button remains visible; “no Resume” in guidance means the action is unavailable, not that the button is absent.

## #365 documentation parity: 2 of 2 argv controls

`sandbox-argv/results.json` retains the client config, thread options, actual SDK-generated argv and controlled process events. `ThreadOptions.txt` is the installed pinned SDK's type excerpt, with its source hash recorded.

1. Default case emits the authored `--sandbox read-only` and authored approval `never`, but emits no `windows.sandbox` key. SDK ThreadOptions has `sandboxMode` and no dedicated Windows backend option. The inheritance conclusion is source/argument evidence, not a renewed owner-machine experiment.
2. Explicit override emits `windows.sandbox="unelevated"` separately, before the authored `--sandbox read-only`. A deliberately conflicting same-key approval override appears before the authored approval `never`. This proves ordering and distinguishes backend selection from the authored permission level; it does not prove enforcement effects of every sandbox-related key.

## Corrected-prose admission

Independent review of the exact correction diff and final bytes confirms:

- **F1:** new guidance explicitly scopes preserved provider explanations to Codex inference turns and describes the safe decision category and diagnostic limit. This now matches the real decision negative control. The original candidate's overbroad promise is not accepted retrospectively.
- **F2:** static bundled-CLI plan information is distinguished from GraphGoblin's shipped model definitions/catalogue, whose schema has no account-plan field. The guide no longer asks users to diagnose from an unexposed provider code; generic/unknown/transient errors establish no account restriction. The process-default correction now says to restart the API, consistent with configuration being loaded into the container once. Current login/model access remains unmeasured.
- **F3:** option/isolation comments and numbered docs state corresponding-key precedence, rather than an unbounded assertion about all sandbox keys. They explicitly preserve separate Windows backend inheritance/override and avoid a permission-weakening claim.

The corrected guidance preserves deliberate model/login/endpoint choice, the original failed run and provenance, no global model disable, no automatic model substitution and no API-key-only guarantee. The delivery register is historical admission information; this QA does not turn it into completion or acceptance of other units.

## Preserved unsuccessful fixture attempts

No failed attempt was deleted or presented as passing evidence. `native-source-attempt-1.log` and its script preserve the initial pnpm-junction resolution assumption; using the SDK file's actual path corrected this before model requests.

Public attempts 1–6 preserve original scripts, failure JSON, SQLite state, requests and command logs:

1. The fixture incorrectly placed `workingDirectory` in inference config; the real REST schema refused it. It belongs in loop settings. No model request occurred.
2. An empty publish POST incorrectly sent JSON content-type; the real API rejected the empty body. The fixture now sets that header only for a payload. No model request occurred.
3. The positive assertion incorrectly expected terminal `completed`; the actual contract says `succeeded`. The refusal cases passed before that assertion.
4. The fixture expected a literal null `result` field; a no-return exit omits the field. The positive check now asserts its actual success contract rather than inventing a returned value.
5. The unknown-case expectation omitted the engine's accepted-turn uncertainty promotion. The live observation and independent source excerpt established `HARNESS_DELIVERY_UNCERTAIN`.
6. The transient expectation assumed native CLI retained structured HTTP status. The real CLI flattened 503 to text, so this case remains generic delivery uncertainty and is accepted only as a negative account-diagnosis control.

One optional browser `eval` observation failed because of Windows CLI quote handling. Its raw error is retained as `historical-observation.log`; no eval result supports acceptance. Saved accessibility snapshots, screenshots and final independent snapshot assertions supply browser evidence instead. Other initial exploratory path-lookup failures were read-only and are in the tool transcript.

## Replay and cleanup

Replay scripts are `native-source-probe.mjs`, `public-native-probe.mjs`, `sandbox-argv.mjs`, `source-binding.mjs` and `final-binding.mjs`. Use the project Node 22.23.4 PATH; source scripts additionally need `--import=./apps/api/node_modules/tsx/dist/loader.mjs --conditions=development` from the QA checkout. Native/public scripts exclusively create fresh named attempt directories, refusing an existing directory; set `GG_QA_ATTEMPT` to a fresh name for a replay. The public script holds only its own loopback servers for browser observation, ending on its own `release.txt` or a ten-minute deadline. Review the fixed build/source paths before replay.

The named browser session was closed. Both fixture servers closed normally, the public runner exited 0, and `public-native-attempt-7/cleanup.json` records no failure. Generated `.playwright-cli` files were moved from the verified owned QA checkout path into retained evidence. The original/author/reused-build checkouts remained clean; the reused artifacts' hashes remained unchanged. Stores and source/error/request evidence were retained outside production. No broad process kill, recursive cleanup, staging, commit, push or issue write occurred.

Coverage limits: no live provider/account-entitlement turn, owner configuration/login, actual Windows backend experiment, broad UI regression, independent full coverage run or `pnpm check`. Touched public failure/recovery behavior, browser rendering and SDK argument parity have direct independent evidence; exact-head/current-target CI, targeted Claude correction review and fresh Astra MAX final review remain separate coordinator gates.

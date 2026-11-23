# D228 independent production-repair diagnosis

**Disposition: DIAGNOSTIC ONLY — partial source UNACCEPTED.** All **36 distinct desired-outcome component cases have passing evidence across qualified invocations**: the initial once-only suite was **35 passed / 1 failed**, then root approved an exact QA schema correction and **only that failed case ran once and passed**. The original 36-case invocation remains failed; this is not a single 36-case green run. Supporting tests/docs and later browser/gates remain pending.

## Source identity and execution

Candidate `3168250645fe37bced7ace6a664c82fd137b1196`, tree `920a5471f4dc7c374cbfe724984bd7615da395d9`, sole parent `0f500bd9355d22a7497f5e4e211a85376a53151f`. The 5,679-byte candidate receipt SHA-256 is `d8b5b678c8ea427bb0cda377a298bc0f449d31ecbc355e28e5cb2df68072807a`. All 23 literal source members matched both candidate copies and Git blobs before application and after execution. Exactly four production files plus the selector unit file changed from the prior 23-file state; QA applied supplied bytes and made no product edits. `before-source/` retains the previous 23 members, `candidate-source/` the exact executed 23, and `executed-qa-and-protected-source/` the original QA/protected inputs.

Node 22.23.4, existing pnpm 12.8.1/dependencies, owned TMP/TEMP. Tests render the whole inspector/router/providers using the real API client/QueryClient with controlled FakeApi and SSE responses in jsdom. This is public-component evidence, not built-browser, real HTTP/provider, native persistence or owner acceptance. Retries remained zero in both component invocations. Full web typecheck and five-file scoped QA lint passed on the initial QA source; no broader static repeat followed the exact two-identifier schema correction.

## Desired-outcome criteria

| Criterion | Diagnostic result and public evidence |
| --- | --- |
| Earlier 31 independent cases | PASS in the first invocation. C1 cold cursor negative/fresh-terminal positive; predecessor/resume ordering; node attribution; navigation and cleanup; old generation follower/stream, key/client/provider replacement; actual refusal; 21-run eviction with non-aborted old query and real cache installation; refresh budget/persisted shape/actions; exact patch values. |
| R2-1 agreeing cached success #3, no retained cursor, current terminal #3 and observation, current GET held | PASS. Timeline/current tail and observation establish #3; succeeded with event attribution appears before any held GET completes, with no cached position. Releasing the same-ID response qualifies its recorded node. |
| R2-2 warm A receipt, B returned with equal status/sequence and foreign node | PASS only in the scoped closure after fixture correction. The synthetic wrong-ID body actually returns; A's query cache and requested route do not serve B or foreign-position; a later valid A response settles. Initial desired assertions were unreached. |
| R2-3 quiet waiting run, visible same-key recovery, no old request | PASS. Actual 401 shows the key form; user submits the same synthetic key, SSE reopens at cursor #3, one recovered-generation GET starts without a test refresh or new event, fresh response settles waiting. |
| R2-3 old pending 200 across separate rejection/recovery | PASS. The new-generation GET starts while the old handler is still held; releasing only the old response restores no claim, then fresh response settles. |
| R2-3 old pending 401 after separate rejection/recovery | PASS. With the fresh row still held, the retired 401 does not advance or reject the recovered generation or reopen the key form; fresh response settles waiting. |

Each recovery variant observes no run work for 600 ms while rejected. During the following 2.2-second quiet interval, it asserts exactly one recovered-generation run GET, at most one observation read, exactly two lifecycle SSE opens, retained cursor #3, stable waiting, accepted credentials and unchanged recovered generation. No test-side invalidation, focus, navigation or event rescues recovery. The overlap variants start their old GET only before rejection. Existing authored same-generation matching 401, explicit mismatch, anonymous, non-401, same-ID, aborted, live 404/500 controls remain root-owned supporting-gate obligations; this diagnostic does not claim to execute those additional authored tests.

## Preserved fixture error and bounded closure

The initial five-case QA source SHA was `65d87bfc5ef64fc7dc6f68f62ea57df0c168f6c76d3bbc25397ab0aef6ef3232`. R2-2 failed `foreignReturned=false` before producing the intended foreign body. It called strict `RunRecordSchema.parse` on the legitimate GET detail envelope, which includes `recovery`.

Root requested actual cause capture. The isolated `capture-r2-2-schema-cause.mts` invokes only FakeApi and contract validation, with zero App/QueryClient/Vitest/network/listeners. The real synthetic 200 body failed RunRecordSchema with `unrecognized_keys`, key `recovery`; RunSnapshotSchema accepted the same body. `r2-2-schema-cause.json` and raw log retain that result. This is a fixture error, not a product defect or rerun of the desired criterion.

Root approval D229-Q1 permitted replacing only the import and parse identifier `RunRecordSchema` with `RunSnapshotSchema`. Foreign ID/status/sequence/node mutation, all negative and valid-response assertions, request counts and timeouts remained byte-identical. New QA source SHA is `61739227f052c71ecadb3b62be77a655a2831c0f697cd1dd4787745c0712f165`; exact diff SHA is `610f97d9c83cb5b316458d2e4e2ebf662fb16677a7734c2c8765901a9c415648`. Both sources and the proof are retained under `r2-2-schema-fixture-closure-01/`.

After coordination with the supporting worker, the corrected R2-2 case alone passed in 717 ms (9.38 s invocation), with four other file cases unselected/skipped. No 36-case rerun occurred. Initial raw failure: `components.json` / `.log.txt`. Scoped raw pass: `r2-2-schema-fixture-closure-01/component.json` / `.log.txt`. `case-summary.json` preserves initial and closure statuses separately.

## Preservation and remaining work

QA checkout HEAD remains `3a6943a136594162665667a7a55e2b46520912eb`, index SHA `a04bf3d924fe09cee1896f685cfae49ae74066746b08bb57e6b3e930191c2a48`. Common HEAD remains `a60843a9050b3a203726db84f6abf1f45b8bc694`, common index absent. Original Claude spec, held/stale fixture, #385 projection, previous 31 sources and approved browser-drain source remain unchanged. The only QA modification is the approved schema correction. See `apply-source-parity.json` and `post-run-source-provenance.json`.

No fresh build, browser, coverage sweep, actual provider, credentials/private configuration, owner store/port/process, installation, index action, commit, publication, formal scan, review reset or merge approval occurred. All six browser cases and the prepared active-route-drain closure remain obligations of a later stable candidate. If finalization changes supporting tests/docs only, root may explicitly bind these executed production bytes to that stable candidate; do not automatically rerun unchanged cases. Any production or materially relevant runtime-input change needs a new scope decision and exact-source admission. This diagnostic is not acceptance.

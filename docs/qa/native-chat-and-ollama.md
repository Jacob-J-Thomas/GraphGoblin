# Native Chat, paired Goblin clients, and Ollama acceptance

Delivery for [#443](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/443).
Implementation uses GPT 6.1 Sol at extra-high effort; architecture uses GPT 6 Astra
at extra-high effort. Claude Opus 5.5 at extra-high effort supplied the visual design
and architecture challenge passes; an independent Astra reviewer checked that design.
The pull request records the immutable code-review candidate, opposite-family review,
independent outcome acceptance, and final CI results.

## Public-interface acceptance

| System                            | Positive and negative evidence                                                                                                                                                                                                                                                                                    | Result                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Owner Chat and navigation         | `apps/web/e2e/chat.spec.ts`: Chat precedes Loops, system/ordinary grouping, native published-loop replies, lost acknowledgement and reload using the original request identity                                                                                                                                    | Passed in Chromium                                              |
| Paired Goblin application         | `apps/web/e2e/goblin.spec.ts`: native gateway pairing, separate installed-client storage, scoped manifest/cache, explicit reconnect, no offline resend, sign-out, revocation                                                                                                                                      | 3 browser cases passed; physical iOS installation not exercised |
| Model settings and authoring      | `apps/web/e2e/ollama.spec.ts`: connection, discovery, manual refresh, saved enable choices, exact model/effort selection and unsupported policy refusal                                                                                                                                                           | 2 browser cases passed                                          |
| Admission, scope and lifecycle    | `apps/api/src/chat.test.ts`, `apps/api/src/adversarial.test.ts`, `packages/infrastructure/src/sqlite/chat.test.ts`, `packages/engine/src/chat-admission.test.ts`: pairing retries, per-device authorization, native atomic admission, duplicate identity, revocation, tombstones and malformed response rejection | Passed                                                          |
| Process restart and private audio | `apps/api/scripts/chat-restart.acceptance.mjs`: native process restart, lost acknowledgement, no repeated Script side effect, explicit new command, malformed normalizer refusal, expired but referenced audio retention and interrupted-upload cleanup                                                           | Passed                                                          |
| Editable system loops             | `packages/domain/src/chat.test.ts`, `apps/web/src/editor/SystemChatAudio.test.tsx`, `apps/web/src/editor/SystemChatFields.test.tsx`: locked boundary protection, editable drafts, publication validation, one-action voice setup/removal, partial-chain recovery                                                  | Passed                                                          |
| Client recovery                   | `apps/web/src/chat/controller.test.ts`: typed deleted-request/expired-audio recovery is scoped to the affected identity; unknown errors preserve uncertain requests and permit read-only status checks                                                                                                            | Passed                                                          |
| Ollama lifecycle                  | `packages/infrastructure/src/ollama/`, `apps/api/src/ollama-*.test.ts`: startup/connection/five-minute/manual discovery, exact efforts, bounded scans, stale revision refusal, disabled service abort, unavailable selection, new-address isolation and dynamic process-default startup                           | Passed                                                          |
| Current-format upgrade            | `tooling/scripts/upgrade.acceptance.mjs`: preserved existing loop data and clean startup through additive migrations, including the pre-migration catalog probe                                                                                                                                                   | 2 cases passed                                                  |
| Existing process behavior         | Reset, recovery-process, wait-restart, prompt-restart and webhook-retry acceptance scripts                                                                                                                                                                                                                        | Passed                                                          |

The live provider check used an already-installed `qwen3.5:9b-q4_K_M` model with
effort `none` against local Ollama. Discovery, publication, device pairing, a real
HTTP inference, and canonical chat projection succeeded. The reply was
`Qwen check complete.` Repeating the request preserved the original run and turn;
the device credential was refused access to the management loop API. The check
used disposable gateway storage and did not change the owner's running instance.
No paid inference service or smart-home device was involved.

## Regression and visual checks

Coverage thresholds remain at least 90% for lines and branches in every package.
The complete local API, infrastructure, engine, contracts, domain, MCP, adapter,
API-client and plugin suites pass. The final web-suite and full browser results
are recorded on the pull request together with Linux, Windows and container CI.

Dark and light responsive captures cover 360, 768, 1024 and 1440 pixel widths,
with reflow checks at 512 by 384. Independent visual review found no remaining
blocking layout issue after the recovery-copy corrections. The generated contrast
report includes both Chat notice pairs in both themes and has zero failing pairs.
Keyboard/focus, literal-text response rendering, microphone state and unavailable
voice controls have targeted browser/component coverage.

The existing tooling performance suite cannot fully pass on this macOS host:
V8 profiler and `hrtime` use different epochs here, so its unchanged CPU sample
window guard rejects otherwise-correct workloads; its browser benchmark also
requires an unavailable Edge installation. A standalone Node inspector probe
reproduced the clock mismatch without GraphGoblin. Performance code, thresholds,
test exclusions and CI gates were not changed to hide those limitations. The
mandatory Linux Gates job must pass the entire tooling coverage suite before merge.

The first independent Opus code review found Windows JSON-path retention and
optional Ollama preflight regressions. Regression tests now cover escaped paths
through the real SQLite JSON columns, saved connection settings, optional versus
explicit process defaults, and read-only preflight on pending or unsupported
stores. The same review prompted request-only bounded chat polling, consistent
audio-quota responses, and physical private-audio cleanup in explicit reset.
The second independent Opus review accepted these repairs. Its additional
observations led to preserving pending-request recovery guidance during status
polls and narrowing the Goblin entry alias so source checkouts under `/src` work.
The pull request records final candidate review and CI receipts.

Integration with the concurrently merged Terra catalog and Codex plugin policy
preserves their source and tests. Codex system chat follows ADR-0067; native
Ollama remains tool-free. The pull request records the upstream merge, semantic
carryforward checks, and the late-accounted automatic review. Its definite-refusal
regressions verify draft recovery without overwriting newer edits or reusing a
refused request identity; uncertain submissions retain their existing behavior.

The complete local browser diagnostic finished with 425 passes, 23 failures and
one existing live-provider skip. It used the older built candidate while repairs
were in progress, and exposed macOS keyboard/loader differences as well as the
subsequently repaired focus and Settings expectations. It is not final-candidate
acceptance. The pull request's clean Linux browser run is the required full-suite
gate; targeted local browser checks are rerun against the final build.

Real speech transcription requires an owner-configured normalization loop; these
tests verify the audio contract and refusal paths, not a claim that a transcription
provider is installed. Browser emulation does not establish physical iOS Home
Screen installation. Remaining home integrations and Resideo are outside this PR.

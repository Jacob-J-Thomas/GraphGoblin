# Chat and Ollama QA repair delivery

## Authority and release boundary

The owner approved the detailed repair plan on 2026-11-08 and explicitly authorized implementation. This batch has an additional owner **pre-merge** sign-off gate: implement, independently review and verify, open a held PR, and deploy its exact reviewed commit on the owner's Mac for the owner's QA. Do not merge, enable auto-merge or enter a merge queue until the owner later explicitly authorizes merging. This overrides this batch's ordinary post-merge human-QA order, without waiving any engineering check.

The owner additionally requires same-machine pairing acceptance: generating a code, claiming it in a separate local browser session, sending through the paired session and revoking it must work before candidate sign-off. LAN/phone tests are separate and cannot substitute for this check.

Initial base: `2d6dca4710a41ab05c3f8d3c57e41c93a8c0eedb`, current `origin/main` at admission. Branch: `codex/chat-qa-repairs`. Other-device PR #450 was open at admission and must be checked again before final integration. Preserve its graph/editor work. Non-audio attachments remain parked in [#451](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/451).

## Scope and ownership

| Work                                                             | Owner/model             | Acceptance                                                                                             |
| ---------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------ |
| Architecture and cross-family design critique                    | Astra extra-high        | Explicit text capture/context/voice/security/recovery contracts and ADR                                |
| Visual and interaction design; adversarial implementation review | Actual Fable extra-high | Approved minimal dark design, recording state contract and fresh screen/flow QA                        |
| Inference reliability                                            | Sol 6.1 extra-high      | Deterministic chat envelope, preserved text, strict structured workflows, bounded context and deadline |
| PCM recorder                                                     | Sol 6.1 extra-high      | Stop retains, Mic appends, Send/Enter includes final samples once; aggregate limits                    |
| Shared Chat UI/client                                            | Sol 6.1 extra-high      | Scroll, Markdown, history, calm status, recovery, composer and caption behavior                        |
| Pairing                                                          | Sol 6.1 extra-high      | Same-machine and LAN prerequisites, scoped enrollment, hash lifecycle, QR and revocation               |
| Voice backend/setup                                              | Sol 6.1 extra-high      | Canonical WAV validation, upload recovery, guided local/cloud config/probes and safe loop preview      |
| Voice settings UI                                                | Sol 6.1 extra-high      | Guided setup, route disclosure, explicit reviewed loop edits and actionable errors                     |
| PWA update guard                                                 | Sol 6.1 extra-high      | Cross-tab dirty-draft/unresolved-submission update protection                                          |
| Integration/deployment/acceptance                                | Root                    | Combined gates, independent QA, reviewed candidate identity, backup and rollback                       |

Workers have separate file ownership and must preserve concurrent edits. Shared interface changes are coordinated before dependent implementation. Heavy inference and repository-wide gates are serialized; focused test workers are bounded.

## Required behavior

- Preserve editable guarded native system loops and per-device clones. Model output remains a loop result. Do not overwrite customized prompts/graphs or rewrite stored content in schema migrations.
- Prefer measured local transcription; otherwise use an explicitly configured guided cloud connection, with credentials on the gateway. No GraphGoblin-hosted billing service. No implicit inference-key reuse or ambiguous-failure cloud fallback.
- Remove the paperclip. Mic records; Stop retains without sending; recording again appends. Send or composer Enter stops/finalizes and submits once. Shift+Enter and IME retain proper behavior. No autosend at aggregate limits.
- Keep bounded unsent audio in memory per conversation, disclose reload/termination limits, and defer PWA updates while any affected tab has dirty voice or unresolved submission.
- Preserve read-only uncertain-acknowledgement recovery. Never replay commands automatically or promise that cancellation undoes effects.
- Local pairing uses verified server configuration/listener authority, never request Host/Forwarded headers. Network pairing uses an explicit canonical HTTPS origin. Keep owner credentials out of client pairing data.
- Preserve model discovery on connection, five-minute refresh, manual refresh, enabled choices and revision protections.

## Evidence ledger

| Criterion                       | State at admission                                                                                                      | Required closing evidence                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Same-machine pairing            | Reproduced live 409 `CHAT_PAIRING_UNAVAILABLE` on 2026-11-08: missing public URL despite authenticated loopback gateway | Built UI code creation, separate-session claim, paired turn, same-tab link and revoke      |
| Local transcription runtime     | Installed Whisper CLI transcribed its bundled public sample; concurrent Ollama capacity not yet qualified               | Actual canonical WAV through published normalizer and measured coexistence                 |
| Text/schema/context reliability | Prior QA reproduced malformed reply and context loss                                                                    | Bounded real Qwen trials plus strict/fault fixtures on candidate                           |
| Voice draft flow                | Unimplemented at admission                                                                                              | PCM/order/finalization/race tests, browser permission/recording evidence                   |
| LAN/PWA                         | Physical-device installation/mic not yet verified                                                                       | HTTPS/trust/install/pair/text/voice evidence; identify any owner-assisted limit explicitly |
| Preservation/upgrade            | Live store/runtime unchanged at admission                                                                               | Copied-store rehearsal, restart/upgrade checks, reviewed per-loop corrections              |
| Full gates                      | Pending candidate                                                                                                       | `pnpm check`, build, format and affected process/browser suites, required CI               |
| Cross-family review             | Planning consultation completed                                                                                         | Fable code review of Sol; Astra review of Claude changes; findings disposed                |
| Independent final QA            | Pending candidate                                                                                                       | Root and Fable frozen initial reports, cross-critique and disputed-claim resolution        |
| Local owner QA                  | Not started                                                                                                             | Exact reviewed commit deployed; owner tests while PR stays held                            |
| Merge                           | Forbidden pending later explicit owner instruction                                                                      | Record that instruction and applicable candidate before any merge                          |

## Verification snapshot — 2026-11-08 17:55 UTC

Implementation is present on the repair branch; release acceptance is still pending. The live owner's installation has not been switched. See the [evidence packet](../qa/2026-11-08-chat-repairs/README.md) and its finding-to-test matrix for scoped evidence and retained failures.

- Full API coverage: 1,875 passing tests, 24 existing skips, 90.76% branches. Full web coverage: 2,355 passing tests across 194 files, 93.98% branches and 98.49% lines. MCP: 55 passing tests, two existing skips, 94.04% branches. Other backend packages passed their coverage gates in the same combined run.
- Typecheck, lint, dependency/layer/migration/token checks, templates, licensing, generated docs, contrast, and combined build passed. Later test/tooling changes require the affected static checks again. Full formatting is pending completion of the profiling-tooling edit.
- Upgrade and native process recovery passed. Chat restart initially failed because its old upload fixture omitted the new required upload identity; the updated canonical-audio fixture and scoped recovery assertions passed without production changes or relaxed assertions.
- Full coverage stopped in unchanged performance tooling on this Mac. The retained run shows correct workload results but incompatible profiler/monotonic clock origins, plus an absent hard-coded Edge executable. A bounded portability repair is being reviewed and tested; no threshold was lowered. The other device's PR #450 remains open, with a separately diagnosed Linux performance-tooling failure; this Mac evidence does not establish its cause.
- The protected copy of the owner's store passed the guarded old-seed text repair and voice staging/publication rehearsal. Thirteen other loops, prior versions, history, settings and credential records were preserved. The rehearsal used fake inference/transcription and recorded zero native process or network calls; its mutated copy is never a deployment source.
- Root's initial browser QA independently proved local code/link creation, explicit claim in a separate browser session, a real Qwen reply, a distinct device loop and revocation, with no public URL configured. Post-fix final-build retesting remains required. Root's initial report is frozen; its API check-count prose says twelve, but the retained JSON contains eleven. Use the JSON count.
- Four Fable source reviews and architecture dispositions exist. Their resulting fixes need the final changed-source rereview. Fable's independent browser session hit its quota before its initial report; it is scheduled to resume after the 14:20 Chicago reset, with its independent initial report frozen before root findings are shared. No substitute model or completed cross-review is claimed.
- Actual Chromium capture tests use a public fake microphone stream. Physical microphone/Safari/phone installation, home-Wi-Fi certificate trust, and a live cloud-provider connection remain separate unverified rows. Guided cloud behavior has fixture coverage, not a live cloud authorization.

The final candidate still needs the completed browser gate, profiling-tooling gate, opposite-family final review and independent QA cross-critique, exact-commit PR CI, and guarded local deployment/rollback evidence. The PR must remain held for the owner's later QA and explicit merge instruction.

## Deployment safeguards

Drain the sole gateway store owner. Preserve a consistent complete store, keys, artifacts/audio, workspaces and launcher/proxy configuration plus the prior executable build. Rehearse upgrade on a protected copy. Never run two gateways against one store and never reset owner data. Verify the actual serving backend and frontend/service-worker identities, not only Git HEAD. Rollback restores compatible code/config/data together and preserves post-switch QA state before restoring an older snapshot.

Any change after review/QA invalidates affected evidence. Keep the candidate stable during owner QA and clearly identify replacement candidates. A green check is not merge authorization.

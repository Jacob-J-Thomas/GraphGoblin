# 13 - Open questions

Each item names the milestone it blocks. Remove items as they are decided and record the decision in an ADR.

| #   | Question                                                                                                             | Blocks   | Proposed default                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------- |
| 1   | Context thread shape: messages as the spine, or variables plus artifacts with messages as one artifact kind?         | M1       | Messages as the spine, with harness transcripts as artifacts and only final text in messages |
| 2   | Should harness transcripts ever be imported into messages, or only summarised notes?                                 | M1       | Notes only, tagged so they can be dropped                                                    |
| 3   | Per-node outputs: `lastOutput` only, or a map keyed by node id as well?                                              | M1       | Both; the map is small and makes decisions easier                                            |
| 4   | Token estimation strategy for truncation rules                                                                       | M1       | Character-based heuristic in 1.0, replaceable                                                |
| 5   | Which thread parts are visible to templates by default?                                                              | M1       | Everything except artifacts' contents                                                        |
| 6   | Heartbeat node: is the "poll until condition" reading correct, or did the owner mean something else?                 | M2       | As written in 04                                                                             |
| 7   | Wait node timeout default: wait forever, or a long default such as 7 days?                                           | M2       | Wait forever for `input`, required timeout for `signal`                                      |
| 8   | Replay-at-node in 1.0 or after?                                                                                      | M2 or M8 | In 1.0 if M2 finishes on time                                                                |
| 9   | Return channel list: is anything missing, for example posting back into the invoking Codex session asynchronously?   | M2       | Not in 1.0; MCP callers use `wait_for_run`                                                   |
| 10  | Poll trigger in 1.0?                                                                                                 | M6       | Yes if the heartbeat probe model is reusable without extra work                              |
| 11  | `@typesafe-ai/sdk` licence and terms                                                                                 | M4       | Verify; fall back to raw HTTP against the Jev API if unsuitable                              |
| 12  | Exact Codex SDK option names for sandbox, approval, network, web search, model, and effort on the pinned version     | M4       | Use `config` dotted keys, which are documented, until per-thread options are confirmed       |
| 13  | Codex plugin format for skills and the slash-style invocation the owner wants                                        | M7       | Follow the pinned CLI version's plugin layout                                                |
| 14  | Working directory specification: fixed path per loop, templated from the trigger, or a fresh temp directory per run? | M1       | All three as `WorkingDirectorySpec` variants, with fixed path as the editor default          |
| 15  | Should loop drafts be runnable for testing before publish?                                                           | M3       | Yes, as "test runs" flagged in the run list and excluded from triggers                       |

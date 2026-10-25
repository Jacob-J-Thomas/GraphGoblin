# #255 [I07/U21/B57] Show exact values and execution context

state: OPEN | milestone: Later | labels: qa:touched-systems, impl:gpt-6.1-sol, review:claude-opus-5.5, type:bug, area:web, area:api, area:engine, backlog, kind:bolt, status:approved-held
parent: #310 [I07/U21] Make evidence accessible and accurate
sub-issues: -
created: 2026-10-17T00:01:57Z updated: 2026-10-17T20:41:38Z

## Body

Part of #310

<!-- graphgoblin-approved-roadmap:2026-10-17:B57 -->

**Owner-approved plan, 2026-10-17. Implementation is held.** The owner explicitly authorized publishing the agreed backlog and said not to start implementation. This issue has no pickup gate; release requires a later owner dispatch decision.

Authority and complete owner decision record: #278. Current text supersedes older model proposals and historical scheduling/approval statements; comments remain historical evidence, not a competing current specification.

## Bounded change

Show exact values and execution context

## Acceptance criteria

- [ ] Array-append values, readable routes/probabilities, cancellation/provider causes and pinned-definition labels reflect the actual run; exact raw values remain reachable and unknown history is labeled honestly.

## Verification

Representative patch, decision, cancellation, provider failure and renamed-definition runs in browser/API.

## Dependencies

- #116 â€” B51
- #245 â€” B52
- #279 â€” implementation dispatch remains held.

## Scope limits

Only the described behavior and its necessary tests/contracts/docs.

## Delivery and closure

Approved plan; parked pending explicit dispatch. Proposed implementer: GPT-6.1 Sol xhigh; independent reviewer: Claude Opus 5.5 xhigh; independent QA: GPT-6.1 Sol xhigh. QA scope: touched systems, including relevant positive, negative, concurrency, cancellation and restart cases. All tests use supported interfaces; retain existing coverage protections.

**Owner product acceptance required before closure.** PRs use Part of rather than auto-closing this issue until the owner has accepted the running behavior.

No implementation gate labels are applied now. After later dispatch, select the repository gate consistent with owner-review requirements; never combine aidlc-ready and human-in-the-loop.

## Source requirements

#121, #123, #128, #255

## Evidence provenance (not a new test result)

The observations below describe their original assessed baseline. They are not current solution requirements; the approved scope above controls. Reproduce on the accepted target before relying on them.

### Source #121 â€” historical evidence

Source links: [source 1](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/3049b9c160d3bc4726318594f0e04edd89927c90/apps/web/src/runs/projections.ts#L78), [source 2](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/3049b9c160d3bc4726318594f0e04edd89927c90/packages/domain/src/pointer.ts#L46)

### Source #255 â€” historical evidence

Source links: [source 1](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/apps/web/src/runs/RunInspectorPage.tsx#L57), [source 2](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/apps/web/src/runs/RunsPage.tsx#L1), [source 3](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/apps/web/src/runs/inspector/WaitPanel.tsx#L48)

## Consolidated source reports

- #121: Run inspector: show values added by array-append patches.
- #123: Run inspector: readable route labels and probability formatting.
- #128: Exit evidence: distinguish cancellation and use accurate provider diagnostics.

These reports are closed as duplicate tracking records. Their accepted requirements and owner-review conditions remain in this bolt. This bolt is the sole open delivery record; no implementation or acceptance is claimed by consolidation.

## Comments (0)

# #121 [Consolidated] Run inspector: show values added by array-append patches

state: CLOSED

## Body

**Disposition: consolidated into #255; delivery remains open there.**

<!-- graphgoblin-approved-roadmap:2026-10-17:S121 -->

**Owner-approved plan, 2026-10-17. Implementation is held.** The owner explicitly authorized publishing the agreed backlog and said not to start implementation. This issue has no pickup gate; release requires a later owner dispatch decision.

Authority and complete owner decision record: #278. Current text supersedes older model proposals and historical scheduling/approval statements; comments remain historical evidence, not a competing current specification.

## Requirement ownership

This report is consolidated into #255. It is closed as a duplicate tracking record, not as an implemented fix or an abandoned requirement. #255 is the sole delivery and acceptance issue; its scope includes the requirements preserved below.

## Approved acceptance carried by the canonical bolts

**#255:**

- [ ] Array-append values, readable routes/probabilities, cancellation/provider causes and pinned-definition labels reflect the actual run; exact raw values remain reachable and unknown history is labeled honestly.

Required evidence and owner sign-off remain on the canonical bolt. Closing this duplicate report does not satisfy those gates or claim implementation.

## Evidence provenance (not a new test result)

The observations below describe their original assessed baseline. They are not current solution requirements; the approved scope above controls. Reproduce on the accepted target before relying on them.

### Source #121 â€” historical evidence

Source links: [source 1](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/3049b9c160d3bc4726318594f0e04edd89927c90/apps/web/src/runs/projections.ts#L78), [source 2](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/3049b9c160d3bc4726318594f0e04edd89927c90/packages/domain/src/pointer.ts#L46)

## Comments

### Jacob-J-Thomas (2026-10-09T23:19:29Z)

### Parked (2026-10-09)

After QA of PR #151 the owner put further development on hold until the after-merge phase finishes: hands-on product evaluation (#166) and an architecture and tech-debt sweep (#163). This issue moves to `Later` with `backlog` and leaves the queue.

When it is unparked, restore the gate `human-in-the-loop`. Its type, area, QA and routing labels are unchanged.

# #123 [Consolidated] Run inspector: readable route labels and probability formatting

state: CLOSED

## Body

**Disposition: consolidated into #255; delivery remains open there.**

<!-- graphgoblin-approved-roadmap:2026-10-17:S123 -->

**Owner-approved plan, 2026-10-17. Implementation is held.** The owner explicitly authorized publishing the agreed backlog and said not to start implementation. This issue has no pickup gate; release requires a later owner dispatch decision.

Authority and complete owner decision record: #278. Current text supersedes older model proposals and historical scheduling/approval statements; comments remain historical evidence, not a competing current specification.

## Requirement ownership

This report is consolidated into #255. It is closed as a duplicate tracking record, not as an implemented fix or an abandoned requirement. #255 is the sole delivery and acceptance issue; its scope includes the requirements preserved below.

## Approved acceptance carried by the canonical bolts

**#255:**

- [ ] Array-append values, readable routes/probabilities, cancellation/provider causes and pinned-definition labels reflect the actual run; exact raw values remain reachable and unknown history is labeled honestly.

Required evidence and owner sign-off remain on the canonical bolt. Closing this duplicate report does not satisfy those gates or claim implementation.

## Comments

### Jacob-J-Thomas (2026-10-08T19:49:15Z)

Additional actual Opus browser observation from #126 at `ea8ccdc14f99eaa655b71439505ca1647eb43337`: Choice/Score probability lists show bare ID/index values without a Probability heading. Include a clear probability label when refining the existing evidence formatting, preserving canonical numbers and pinned-definition labels. This is F4 of the ten-inspection #99 QA; kept here with the same presentation concern rather than creating a duplicate issue.

### Jacob-J-Thomas (2026-10-09T23:19:30Z)

### Parked (2026-10-09)

After QA of PR #151 the owner put further development on hold until the after-merge phase finishes: hands-on product evaluation (#166) and an architecture and tech-debt sweep (#163). This issue moves to `Later` with `backlog` and leaves the queue.

When it is unparked, restore the gate `human-in-the-loop`. Its type, area, QA and routing labels are unchanged.

# #128 [Consolidated] Exit evidence: distinguish cancellation and use accurate provider diagnostics

state: CLOSED

## Body

**Disposition: consolidated into #255; delivery remains open there.**

<!-- graphgoblin-approved-roadmap:2026-10-17:S128 -->

**Owner-approved plan, 2026-10-17. Implementation is held.** The owner explicitly authorized publishing the agreed backlog and said not to start implementation. This issue has no pickup gate; release requires a later owner dispatch decision.

Authority and complete owner decision record: #278. Current text supersedes older model proposals and historical scheduling/approval statements; comments remain historical evidence, not a competing current specification.

## Requirement ownership

This report is consolidated into #255. It is closed as a duplicate tracking record, not as an implemented fix or an abandoned requirement. #255 is the sole delivery and acceptance issue; its scope includes the requirements preserved below.

## Approved acceptance carried by the canonical bolts

**#255:**

- [ ] Array-append values, readable routes/probabilities, cancellation/provider causes and pinned-definition labels reflect the actual run; exact raw values remain reachable and unknown history is labeled honestly.

Required evidence and owner sign-off remain on the canonical bolt. Closing this duplicate report does not satisfy those gates or claim implementation.

## Comments

# #310 [I07/U21] Make evidence accessible and accurate

state: OPEN | milestone: Later | labels: type:epic, area:editor, area:api, area:engine, area:contracts, backlog, kind:uow, status:approved-held
parent: #289 [I07] Make run history and completion trustworthy
sub-issues: #231(OPEN), #240(OPEN), #255(OPEN), #129(OPEN)
created: 2026-10-17T19:59:06Z updated: 2026-10-18T23:37:46Z

## Body

Part of #289

<!-- graphgoblin-approved-roadmap:2026-10-17:U21 -->

<!-- graphgoblin-approved-revision:2026-10-18 -->

**Owner-approved consolidated revision, 2026-10-18. Implementation remains held by #279.** Latest owner decisions in #278 supersede older proposals and historical comments. This approval authorizes backlog publication only; no implementation, owner-environment change, or provider run is dispatched.

Authority and complete owner decision record: #278. Current text supersedes older model proposals and historical scheduling/approval statements; comments remain historical evidence, not a competing current specification.

## Outcome and acceptance

Users can find complete relevant history and understand the actual execution without losing established capabilities.

## Touched components

- MCP/API paging
- Runs/Events UI
- inspector labels and values
- decision/exit evidence

## Bolts

- #231 **[I07/U21/B55] Carry opaque cursors and validate history filters** â€” API/client/MCP/browser paging preserves opaque cursors and active filters; tied timestamps do not skip/duplicate a fixed dataset and invalid status filters return typed 4xx errors.
- #240 **[I07/U21/B56] Expose manual Events refresh** â€” New events appear on deliberate refresh without silently moving the user's reading position or resetting filters.
- #255 **[I07/U21/B57] Show exact values and execution context** â€” Array-append values, readable routes/probabilities, cancellation/provider causes and pinned-definition labels reflect the actual run; exact raw values remain reachable and unknown history is labeled honestly.
- #129 **[I07/U21/B58] Preserve completion evidence after exit redesign** â€” Capabilities and useful evidence formerly available on loopback exits have an equivalent decision/exit presentation; suppressed outputs are understandable and quiet exits remain valid.

Each nondeferred bolt is the sole implementation record for its scope. Current UoW completion requires their evidence and applicable owner acceptance; parked children do not block current completion. Publication is not dispatch.

## Specific owner feedback

- Do not drop loopback-node functionality or useful evidence unless the replacement decision/exit experience provides it. Preserve applicable Choice list-level help, unique-option constraints and criterion/output explanations under the accepted new contract.

## Evidence provenance (not a new test result)

The observations below describe their original assessed baseline. They are not current solution requirements; the approved scope above controls. Reproduce on the accepted target before relying on them.

### Source #121 â€” historical evidence

Source links: [source 1](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/3049b9c160d3bc4726318594f0e04edd89927c90/apps/web/src/runs/projections.ts#L78), [source 2](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/3049b9c160d3bc4726318594f0e04edd89927c90/packages/domain/src/pointer.ts#L46)

### Source #231 â€” historical evidence

Source links: [source 1](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/apps/mcp/src/tools.ts#L312), [source 2](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/packages/api-client/src/resources.ts#L123), [source 3](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/apps/mcp/src/tools.ts#L269), [source 4](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/packages/infrastructure/src/sqlite/templates.ts#L178)

### Source #238 â€” historical evidence

Source links: [source 1](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/packages/api-client/src/resources.ts#L123), [source 2](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/apps/web/src/runs/RunsPage.tsx#L36), [source 3](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/apps/web/src/events/EventsPage.tsx#L79)

### Source #240 â€” historical evidence

Source links: [source 1](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/apps/web/src/api/queries.ts#L262), [source 2](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/apps/web/src/events/EventsPage.tsx#L79)

### Source #252 â€” historical evidence

Source links: [source 1](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/apps/api/src/routes/runs.ts#L144), [source 2](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/apps/api/src/plugins/errors.ts#L1)

### Source #255 â€” historical evidence

Source links: [source 1](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/apps/web/src/runs/RunInspectorPage.tsx#L57), [source 2](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/apps/web/src/runs/RunsPage.tsx#L1), [source 3](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/apps/web/src/runs/inspector/WaitPanel.tsx#L48)

### Source #258 â€” historical evidence

Source links: [source 1](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/packages/engine/src/run-manager.ts#L1634), [source 2](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/docs/guide/03-run-and-observe.md#L187)

## Comments (0)

# #116 [I07/U19/B51] Reconcile snapshot and event tails

state: OPEN | milestone: Later | labels: qa:touched-systems, impl:gpt-6.1-sol, review:claude-opus-5.5, type:bug, area:web, area:api, area:engine, backlog, kind:bolt, status:approved-held
parent: #308 [I07/U19] Reconcile execution history
sub-issues: -
created: 2026-10-07T19:28:19Z updated: 2026-10-18T23:36:09Z

## Body

Part of #308

<!-- graphgoblin-approved-roadmap:2026-10-17:B51 -->

<!-- graphgoblin-approved-revision:2026-10-18 -->

**Owner-approved consolidated revision, 2026-10-18. Implementation remains held by #279.** Latest owner decisions in #278 supersede older proposals and historical comments. This approval authorizes backlog publication only; no implementation, owner-environment change, or provider run is dispatched.

Authority and complete owner decision record: #278. Current text supersedes older model proposals and historical scheduling/approval statements; comments remain historical evidence, not a competing current specification.

## Bounded change

Reconcile snapshot and event tails

## Acceptance criteria

- [ ] Failure/resume/success is represented consistently in current-thread reads, API snapshots and existing/reconnected browser tabs; reads neither apply unfinished patches nor mutate state.

- [ ] Existing tabs, reloaded/reconnected tabs, API and MCP agree through failure/resume/success despite delayed snapshots. Read reconciliation cannot apply unfinished patches or mutate execution state.

## Verification

Real persisted terminal/resume sequences, delayed snapshots, reconnect and reload.

## Dependencies

- #247 â€” B17
- #279 â€” implementation dispatch remains held.

## Scope limits

Only the described behavior and its necessary tests/contracts/docs.

## Delivery and closure

Approved plan; parked pending explicit dispatch. Proposed implementer: GPT-6.1 Sol xhigh; independent reviewer: Claude Opus 5.5 xhigh; independent QA: GPT-6.1 Sol xhigh. QA scope: touched systems, including relevant positive, negative, concurrency, cancellation and restart cases. All tests use supported interfaces; retain existing coverage protections.

**Owner product acceptance required before closure.** PRs use Part of rather than auto-closing this issue until the owner has accepted the running behavior.

No implementation gate labels are applied now. After later dispatch, select the repository gate consistent with owner-review requirements; never combine aidlc-ready and human-in-the-loop.

## Source requirements

#116, #183, #239

## Evidence provenance (not a new test result)

The observations below describe their original assessed baseline. They are not current solution requirements; the approved scope above controls. Reproduce on the accepted target before relying on them.

### Source #116 â€” historical evidence

Source links: [source 1](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/115), [source 2](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/2f98219fb43620b56d6baf57cbc5987dbd398a522/packages/engine/src/run-manager.ts#L1233), [source 3](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/2f98219fb43620b56d6baf57cbc5987dbd398a522/packages/engine/src/run-manager.ts#L1326), [source 4](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/2f98219fb43620b56d6baf57cbc5987dbd398a522/apps/api/src/sse.ts#L79)

### Source #239 â€” historical evidence

Source links: [source 1](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/apps/api/src/sse.ts#L83), [source 2](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/apps/api/src/sse.ts#L85), [source 3](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/apps/web/src/runs/useRunEvents.ts#L49), [source 4](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/packages/api-client/src/sse.ts#L222), [source 5](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/docs/guide/03-run-and-observe.md#L137)

## Consolidated source reports

- #183: Engine: current-thread reads omit the last node start after an expression failure.
- #239: Run history: show every resumed attempt after an earlier terminal event.

These reports are closed as duplicate tracking records. Their accepted requirements and owner-review conditions remain in this bolt. This bolt is the sole open delivery record; no implementation or acceptance is claimed by consolidation.

## Comments (1)

### Jacob-J-Thomas at 2026-10-09T23:19:24Z

### Parked (2026-10-09)

After QA of PR #151 the owner put further development on hold until the after-merge phase finishes: hands-on product evaluation (#166) and an architecture and tech-debt sweep (#163). This issue moves to `Later` with `backlog` and leaves the queue.

When it is unparked, restore the gate `human-in-the-loop`. Its type, area, QA and routing labels are unchanged.

# #245 [I07/U19/B52] Seed replay from the actual initial thread

state: OPEN | milestone: Later | labels: qa:touched-systems, impl:gpt-6.1-sol, review:claude-opus-5.5, type:bug, area:web, area:api, area:engine, backlog, kind:bolt, status:approved-held
parent: #308 [I07/U19] Reconcile execution history
sub-issues: -
created: 2026-10-17T00:01:27Z updated: 2026-10-17T20:03:37Z

## Body

Part of #308

<!-- graphgoblin-approved-roadmap:2026-10-17:B52 -->

**Owner-approved plan, 2026-10-17. Implementation is held.** The owner explicitly authorized publishing the agreed backlog and said not to start implementation. This issue has no pickup gate; release requires a later owner dispatch decision.

Authority and complete owner decision record: #278. Current text supersedes older model proposals and historical scheduling/approval statements; comments remain historical evidence, not a competing current specification.

## Bounded change

Seed replay from the actual initial thread

## Acceptance criteria

- [ ] Replay reconstruction starts from that replay run's actual seed and produces correct add/replace values and counters; the original run is unchanged.

## Verification

Public replay API plus independent reconstructed-state comparison and browser inspector.

## Dependencies

- #247 â€” B17
- #279 â€” implementation dispatch remains held.

## Scope limits

Only the described behavior and its necessary tests/contracts/docs.

## Delivery and closure

Approved plan; parked pending explicit dispatch. Proposed implementer: GPT-6.1 Sol xhigh; independent reviewer: Claude Opus 5.5 xhigh; independent QA: GPT-6.1 Sol xhigh. QA scope: touched systems, including relevant positive, negative, concurrency, cancellation and restart cases. All tests use supported interfaces; retain existing coverage protections.

**Owner product acceptance required before closure.** PRs use Part of rather than auto-closing this issue until the owner has accepted the running behavior.

No implementation gate labels are applied now. After later dispatch, select the repository gate consistent with owner-review requirements; never combine aidlc-ready and human-in-the-loop.

## Source requirements

#245

## Evidence provenance (not a new test result)

The observations below describe their original assessed baseline. They are not current solution requirements; the approved scope above controls. Reproduce on the accepted target before relying on them.

### Source #245 â€” historical evidence

Source links: [source 1](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/packages/engine/src/run-manager.ts#L849), [source 2](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/apps/web/src/runs/projections.ts#L13), [source 3](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/apps/web/src/runs/inspector/ThreadViewer.tsx#L51)

## Comments (0)

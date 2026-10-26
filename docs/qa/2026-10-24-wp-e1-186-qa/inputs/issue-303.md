# #303 [I05/U14] Bound handling and repair measured costs

state: OPEN | milestone: Later | labels: type:epic, area:web, area:api, area:engine, area:integrations, backlog, kind:uow, status:approved-held
parent: #287 [I05] Keep sustained loops responsive and resource use controlled
sub-issues: #186(OPEN), #117(OPEN), #259(OPEN), #268(OPEN)
created: 2026-10-17T19:58:51Z updated: 2026-10-18T23:37:28Z

## Body

Part of #287

<!-- graphgoblin-approved-roadmap:2026-10-17:U14 -->

<!-- graphgoblin-approved-revision:2026-10-18 -->

**Owner-approved consolidated revision, 2026-10-18. Implementation remains held by #279.** Latest owner decisions in #278 supersede older proposals and historical comments. This approval authorizes backlog publication only; no implementation, owner-environment change, or provider run is dispatched.

Authority and complete owner decision record: #278. Current text supersedes older model proposals and historical scheduling/approval statements; comments remain historical evidence, not a competing current specification.

## Outcome and acceptance

Incidental buffering and identified hot paths are bounded without removing supported data.

## Touched components

- SSE server/client
- HTTP probe
- inspector values
- engine hot paths

## Bolts

- #186 **[I05/U14/B35] Bound streaming replay and slow-consumer buffering** — Replay is paged and buffers are bounded; slow-reader handling uses recoverable cursors or an explicit failure without silently losing history. Reconnect preserves event ordering and visibility.
- #117 **[I05/U14/B36] Bound probe bodies before parsing** — Over-limit response bodies stop at the byte boundary before unbounded decoding/parsing; accepted data remains exact and cancellation releases resources.
- #259 **[I05/U14/B37] Bound large-value rendering** — Large values do not freeze ordinary inspector controls; previews are bounded and exact full values remain accessible without silently modifying stored data.
- #268 **[I05/U14/B38] Correct measured engine/API hot paths** — Each selected change targets a measured cause, preserves public behavior and demonstrates improvement under the same workload; any coordinator extraction has a named responsibility and regression evidence.

Each nondeferred bolt is the sole implementation record for its scope. Current UoW completion requires their evidence and applicable owner acceptance; parked children do not block current completion. Publication is not dispatch.

## Specific owner feedback

- Measure sustained loops early because they are central to the POC. Bounded extraction follows actual responsibility/performance evidence; do not assume file size proves a performance problem or mandate a general RunManager rewrite.

## Evidence provenance (not a new test result)

The observations below describe their original assessed baseline. They are not current solution requirements; the approved scope above controls. Reproduce on the accepted target before relying on them.

### Source #259 — historical evidence

Source links: [source 1](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/apps/web/src/events/EventsPage.tsx#L1), [source 2](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/apps/web/src/runs/inspector/ThreadViewer.tsx#L1)

### Source #268 — historical evidence

Source links: [source 1](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/packages/infrastructure/src/sqlite/db.ts#L92), [source 2](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/apps/api/src/app.ts#L41), [source 3](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/packages/infrastructure/src/sqlite/runs.ts#L1), [source 4](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c379f806ba8a04433779d98ded7e4196c9d4b663/packages/engine/src/run-manager.ts#L1453)

## Comments (0)

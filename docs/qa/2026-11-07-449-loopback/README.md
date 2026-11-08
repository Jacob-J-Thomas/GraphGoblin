# Automatic loop-back styling evidence

Part of [#449](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/449). This records the implementation-stage evidence; final source review, CI results and the merged head are recorded on the delivery PR linked from that issue. No human QA decision or issue-closure authority is inferred from these checks.

## Behavior and boundaries

An edge is a visual loop-back when its destination lies on every trigger-to-source path. All trigger nodes count as entries, including unarmed integrations. Valid self-loops qualify even in disconnected drafts; other disconnected components have no established entry history. Invalid connections are excluded. The same derived set controls styling and return routing, independently of positions, route names and the Repeat marker.

Repeat, pass limits, engine behavior and saved definitions remain unchanged. The patch touches the editor, its tests and documentation. The client work in #444 is carried forward before the final candidate is tested. No owner service, store or installation is changed by this task.

## Executed implementation-stage checks

| Check                              | Observed result                                                                                                                                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Graph helper                       | 12 focused tests passed, including multiple entries, joins, nested loops, invalid drafts and 500 nodes / 2,000 edges.                                                                                                                     |
| Independent graph oracle           | All 4,096 directed graphs on three work nodes plus one entry passed: 24,576 edge comparisons against enumeration of simple entry-to-source paths. The oracle uses a different method from the implementation's node-removal reachability. |
| Canvas and routing units           | 107 focused tests passed after updating expectations for automatically recognized right-facing returns. Fresh and incremental route maps remain equal.                                                                                    |
| New public-interface browser cases | Four cases passed across light and dark themes: unmarked decision/script returns, alternative entry, deletion, undo/redo, reload, saved Repeat-off configuration, right-facing returns and reduced motion.                                |
| Existing routing browser suite     | An initial standalone run passed all 23 cases, including the unchanged 100/300-node timing gates.                                                                                                                                         |
| Combined affected-browser run      | 63 passed; the 300-node performance case failed. See the preserved raw log. Median routing p95 was 11.1 ms against the unchanged 8 ms limit. This run is not represented as a complete pass.                                              |
| Full local web coverage            | Started but deliberately stopped before completion after host CPU saturation was observed. No coverage pass is claimed from that attempt; final coverage and performance gates run in CI.                                                 |

The initial standalone routing medians were 3.3 ms for 100 nodes and 6.5 ms for 300 nodes. Later old/new comparisons varied substantially. A native process sample then showed 100% total CPU, with much of the load outside this task. Only freshly identified task-owned verification processes were stopped. The final candidate must pass the same timing thresholds on the CI runner before merge; no timing, coverage or retry gate is relaxed.

The automatically detected row-wrap returns add nine routed paths in the 100-node fixture and 29 in the 300-node fixture. Deterministic operation-count expectations were recalibrated to that changed workload, with measured counts documented beside the assertions. Browser timing limits, fresh-plan equivalence and obstacle/dependency checks remain intact.

## Preserved evidence

- [Independent oracle source](independent-graph-oracle.mjs) and [raw result](independent-graph-oracle.json). The script preserves the Windows checkout path used for this run.
- [Initial combined browser log](initial-browser.log), including the performance failure.
- [Unmarked decision and script returns, dark theme](returns-dark.png).
- [Alternative entry removes the outer loop-back style, light theme](bypass-added-light.png).
- [Right-facing return remains a loop-back](drawn-rightward-dark.png).

The orchestrator inspected all three included screenshots. Validation badges belong to deliberately incomplete draft/obstacle fixtures; these images demonstrate editor classification and geometry, not successful execution of those fixtures. Automated assertions check the saved configuration and computed stroke/animation properties, which a still image alone cannot establish.

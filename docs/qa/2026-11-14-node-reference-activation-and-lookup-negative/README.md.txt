# Independent native rename-click supplement

At clean `5a4fb439c63755eeb2b5bef945319772623a9905`, tree `caf777a63de7d9938b03dfa81b9ee60e9a1bf3e5`, the first native click on **Add operations** or **Remove operations 2** was lost when it blurred a changed Node id and self-reference repair remounted the form. The runtime was the retained build for `164c01a2e3a52bf0ef69a409e1a428b45817b1b8`. The intervening paths were QA/docs only.

| Gesture | Observed first click |
| --- | --- |
| Steady ID → Add operations | Same button survived down/up, trusted click delivered. One conditional PUT and synced device draft held exactly three rows. |
| Pending rename → Add operations | Old button detached after pointer down and before pointer up. No click was delivered to the button. One conditional PUT and synced device draft held the repaired ID, typed pointer and edges, with exactly the original two operations. |
| Steady ID → Remove operations 2 | Same button survived down/up, trusted click delivered. One conditional PUT and synced device draft held exactly the remaining Coerce row. |
| Pending rename → Remove operations 2 | Old button detached after pointer down and before pointer up. No click was delivered to the button. Rename-only PUT and synced copy still held both rows. |

In both pending cases the same second click activated exactly once. A first Undo reversed that action only. A second Undo restored the original node ID, pointer, full graph and device state. The fixture used actual mouse down/up at the existing enabled button's hit-tested center. DOM capture was passive. It did not dispatch synthetic events or invoke the application store.

The first fixture attempt established the steady Add result but assumed its default Set operation with a blank path would remain device-only. The actual gateway saved it. The corrected fixture required that exact default operation and real synced PUT in the control. No product source changed. Both attempts were preserved.

[Primary structured readback](runs/corrected-activation-canonical-add/observed.json) · [First fixture attempt](runs/corrected-activation/observed.json) · [Cleanup](cleanup.json)

Both process pairs closed with zero live recorded PIDs, listeners, locks, WAL or SHM. Before/after bindings verified 54 tracked source hashes, 11 embedded sources and all 1,227 artifacts across 13 trees. Both have SHA-256 `c66bf3368cd6f9e406ae64c5ec03bbb32bb69c4b069595eac59730ff853a7bcb`. Native scope was Windows Edge and the compiled gateway with disposable file SQLite. Boolean-toggle activation was outside this bounded run.


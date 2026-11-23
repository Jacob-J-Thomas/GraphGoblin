# #386 public component baseline on signed main

The mismatch reproduced twice at signed main 3a6943a136594162665667a7a55e2b46520912eb, tree a88175975c42062a08e3012a7f106396be0c685f. The exact fixture uses the public App route through renderApp and FakeApi in jsdom. Vitest 5.0.3 exited 1 with both intended header assertions failing, expected succeeded and observed running. [Exact corrected fixture](./RunInspector386Baseline.corrected.test.tsx) · [Observed states](./386-02-vitest.stdout) · [Intentional failures](./386-02-vitest.stderr)

| Controlled ordering | Observed result |
| --- | --- |
| Terminal event before released run GET | The initial run badge was running. Timeline showed #3 run.finished succeeded, two subsequent run GETs were held and neither had returned. Header stayed running. |
| Released response with the same event sequence | Timeline showed #3 run.finished succeeded. Both refreshed responses reported lastEventSeq 3 and status running. The new node label appeared in the header and independently confirmed that the refreshed record was rendered. Header stayed running. |

The second case demonstrates why equality of the event and run-record cursors does not establish fresh status. At this source, the engine appends run.finished before saving the thread and calling finish. The SQLite append updates lastEventSeq in its transaction and notifies subscribers. The later finish transition writes terminal status. The UI fixture models that ordering. No separate native timing run was performed. [Engine append](G:/ggq/gg-i5-386-baseline/GraphGoblin/packages/engine/src/run-manager.ts:2790) · [SQLite append](G:/ggq/gg-i5-386-baseline/GraphGoblin/packages/infrastructure/src/sqlite/events.ts:94) · [Later transition](G:/ggq/gg-i5-386-baseline/GraphGoblin/packages/engine/src/run-manager.ts:2896)

The first temporary fixture stopped on a setup mistake. Its text query matched the label inside the badge rather than the element with data-status. The corrected fixture changes only that initial lookup and both tests reach the intended final failure. Both temporary copies were removed after their runs. Signed source, exact index and lock, the existing claude-harness.spec.ts bytes, and common-main HEAD with absent index all verified afterward. No product fix, full suite, build or browser run was performed. [Initial fixture failure](./386-vitest.stderr) · [Final readback](./final-restoration.json)

The two existing #385 projection tests selected by append passed, with 15 other tests skipped. They cover exact appended null, nested arrays and objects, escaped parent pointers and a literal dash property. This is projection evidence only. [Focused existing results](./385-append-vitest.stdout)

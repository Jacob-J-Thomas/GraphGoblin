# Round-3 files changed

18 source/documentation files. Evidence scripts and captures are inventoried in ARTIFACTS.json; hashes are in SOURCES.json. Line ranges describe the final working file.

| File                                                                    | Changed lines                          |
| ----------------------------------------------------------------------- | -------------------------------------- |
| `CHANGELOG.md`                                                          | 7                                      |
| `apps/api/src/stored-loop-defaults.test.ts`                             | 1-90 (new)                             |
| `apps/web/e2e/stored-loop-defaults.spec.ts`                             | 1-59 (new)                             |
| `apps/web/src/editor/LoopSettingsPanel.tsx`                             | 76-78                                  |
| `docs/03-domain-model.md`                                               | 25-30                                  |
| `docs/05-execution-engine.md`                                           | 542-543, 553-554, 568-571              |
| `docs/06-harness-integration.md`                                        | 243-246, 253-255, 604                  |
| `docs/decisions/ADR-0051-structured-completion-deadlines.md`            | 4-6, 15-16, 20-44, 47-48, 54-55, 68-72 |
| `docs/guide/02-build-a-loop.md`                                         | 390-392                                |
| `docs/guide/06-settings-and-secrets.md`                                 | 330                                    |
| `docs/guide/07-troubleshooting.md`                                      | 269-270                                |
| `packages/contracts/src/loop.ts`                                        | 55                                     |
| `packages/engine/src/handlers/common.ts`                                | 227-237                                |
| `packages/engine/src/repair-deadline.test.ts`                           | 1-148 (new)                            |
| `packages/infrastructure/drizzle/0020_completion_deadline_defaults.sql` | 1-57 (new)                             |
| `packages/infrastructure/drizzle/meta/0020_snapshot.json`               | 1-1310 (new)                           |
| `packages/infrastructure/drizzle/meta/_journal.json`                    | 130-136                                |
| `packages/infrastructure/src/sqlite/definition-pins.test.ts`            | 105-252                                |

Shared files: CHANGELOG; docs 03/05/06; guides 02/06/07; contracts/loop; engine/handlers/common; infrastructure migration journal and definition-pins tests; web LoopSettingsPanel. Edits stay within deadline/help/default-migration regions. Reserved migration numbers 0018 and 0019 are untouched. No run-manager, container, SSE, trigger-admission implementation or protected cutover code changed.

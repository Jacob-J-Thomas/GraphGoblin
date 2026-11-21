# D197 bounded corrective review of F3: **ACCEPT FIX**

I found no introduced defect in the six changed paragraphs at `08633913a58cb42c32b4a18c72cd4aed67cfefa6`. Every changed statement matches the source I read, and the three documents agree with each other. This review used read-only file tools only; it is not QA and not merge permission. The sealed scan-3 `CHANGES_REQUIRED` record stands unchanged.

## Changed statements

All four #362-introduced publish instructions that F3 cited are corrected, plus the two generic run-guide passages. I confirmed the set of four against the two archived #362 patches (`docs/qa/2026-11-21-i4-362-batch-commands/author/candidate.patch` and `docs/qa/2026-11-21-i4-362-recovery-docs/freeze/source.patch`).

| Passage | Result |
| --- | --- |
| `docs/04-node-catalog.md:154-164` | Accurate. Carries fresh run, UI published version, API draft start, snapshot, trigger effect, Resume/Replay pin and external repair. |
| `docs/guide/03-run-and-observe.md:175` | Accurate. Same full set; publication is qualified to the UI path. |
| `docs/guide/03-run-and-observe.md:273` | Accurate. Short form, links to "Start through the API"; script consent text unchanged. |
| `docs/guide/03-run-and-observe.md:289` | Accurate. Short form with the same link. |
| `docs/guide/07-troubleshooting.md:150` | Accurate. Short form; `SCRIPT_OUTCOME_UNCERTAIN` consent text unchanged. |
| `docs/guide/07-troubleshooting.md:210-224` | Accurate. The `cmd.exe` `/d` `/c` example, AutoRun explanation and untrusted-text caution are unchanged against the prior patch. |

The working-tree text of all six paragraphs matches the `+` lines of the root-freeze `source.patch`.

## Source trace

- **API draft start:** `apps/api/src/routes/runs.ts:72-129` accepts `versionId` and `allowDraft` and makes no publish or arm call. Line 96 falls back to `loop.currentVersionId`, so `allowDraft: true` alone never selects a draft. All six passages require both elements, which is correct.
- **Editable ID versus snapshot ID:** `packages/engine/src/run-manager.ts:3362-3385` refuses a snapshot ID with `VERSION_NOT_PUBLISHED` even with `allowDraft`, and refuses a draft without it. "Editable draft's `versionId`" is the right term in all six passages.
- **Fresh snapshot:** `run-manager.ts:688-691` and `packages/engine/src/definition-pin.ts:86-95` freeze the draft under a new ID with status `snapshot`.
- **Draft ID stability:** `packages/infrastructure/src/sqlite/loops.ts:408-414` updates the draft row in place on save; `:485-496` clears it on publish. `GET /loops/{id}` returns the draft (`apps/api/src/routes/loops.ts:228-255`).
- **Ordinary constraints still apply:** trigger resolution and input-schema validation (`run-manager.ts:663-682`) and readiness with 422 `HARNESS_NOT_READY` (`runs.ts:118-125`). The docs promise no more than that.
- **UI:** `apps/web/src/runs/new/NewRunPage.tsx:72-75` and `RunLauncher.tsx:23-29,90-94` offer and send only published versions. `allowDraft` does not appear under `apps/web/src`.
- **Resume and Replay pin:** `run-manager.ts:1592-1601` changes lifecycle fields only, `:2342-2369` rereads `run.versionId`, and `:1782-1830` copies `source.versionId` and `source.pinned` into the fork.
- **External repair:** `packages/engine/src/handlers/script.ts:62-72,105-115` re-runs the pinned command and maps `definitely-not-started` to `SCRIPT_START_FAILED`.
- **Publication effect:** `loops.ts:392` calls `armVersion`. `apps/api/src/triggers/trigger-service.ts:215-257` and `packages/infrastructure/src/sqlite/triggers.ts:88-91,230-233` disable other versions' rows and insert the new version's. "Can" is the right qualifier.

## Three-document consistency

- **Each other:** no passage instructs universal publication, and none suggests a snapshot ID can be restarted. The three short passages omit the trigger caveat but link to the start section; the three detailed ones carry it. That satisfies D197.
- **Unchanged neighbours:** the new text agrees with `03-run-and-observe.md:5-7,74,76`, `07-troubleshooting.md:183`, `docs/03-domain-model.md:149`, `docs/05-execution-engine.md:180`, `docs/07-api-and-streaming.md:645-648` and `docs/08-triggers-and-integrations.md:29-37`.
- **Links:** all nine targets and their headings exist (`03:22`, `07:201`, `08:29`).

## Pre-existing items outside D197 (not part of the verdict)

1. **Remaining publish-first wording.** Unqualified "publish and start a new run" advice for other failure classes remains at `07-troubleshooting.md:114,135,145,159,165,166,169` and `03-run-and-observe.md:336`. It is not from #362 and not in this delta. Root's PR body and corrective README should claim the six paragraphs, not that the three files are free of publish-first wording.
2. **REST only.** Root wording should name `POST /loops/{id}/runs`, not MCP. `apps/mcp/src/tools.ts:166` passes a draft ID only when the loop has no published version.
3. **Poll and Event triggers.** Publication also replaces in-memory poll targets (`apps/api/src/triggers/poll.ts:82-98`), and targeted Events resolve against the current published version (`trigger-service.ts:594-601`). The cron/webhook sentence is correct but not exhaustive.
4. **Owner defaults on Resume.** `07-troubleshooting.md:199` says owner defaults apply on "resume", which appears stale against `03:76` and `run-manager.ts:2366-2369`. I did not assess it further.

## Mandatory errata

Both remain intact in the author and QA reports, and nothing here strengthens them:

- The original A/A6 REST drivers disabled authentication and sent no credential.
- The five original native fixture loops were each published once; no same-loop publish/fix/retry was observed.

## Evidence limits

- **No execution.** I ran no git, test, build, formatter or link checker, and recomputed no hash.
- **Commit binding.** The branch ref file reads `08633913…`. Cleanliness, tree `f7b63399`, parent `505060e2` and the three-file boundary rest on the root freeze receipt and QA.
- **Tests read, not run.** I read `packages/engine/src/definition-pin.test.ts:103-215` and `apps/api/src/definition-pins.test.ts:220-359`.
- **Source inspection only.** The UI, trigger-arming and failed-Resume conclusions come from reading source. There was no browser, authenticated REST, cron fire, webhook delivery or native Windows run.
- **Still unobserved.** The combined native same-loop republish scenario remains unobserved.

Current-target CI, canonical native verification and root completion under D035/D042 remain open gates.
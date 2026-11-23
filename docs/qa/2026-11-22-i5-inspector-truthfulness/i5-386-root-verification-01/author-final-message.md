I've implemented #386 as a header-only change and added regression tests for #385, but I haven't run any tests, typecheck, lint, formatting or browser checks. Two tool limits shaped the work. Only Read and Edit worked, so I created the new files with empty-string Edits. With no search, I couldn't check whether existing tests depend on the old header behaviour.

## Changed paths
- `apps/web/src/runs/run-header-status.ts` (new): pure rules for what the header shows.
- `apps/web/src/runs/useRunHeaderStatus.ts` (new): holds the evidence in memory for the run shown and resets when the run changes.
- `apps/web/src/runs/RunInspectorPage.tsx`: wires the header to the new hook and adds two small header components.
- Tests (new): `run-header-status.test.ts`, `useRunHeaderStatus.test.tsx`, `RunInspectorPage.lifecycle.test.tsx`, `apps/web/e2e/inspector-truthfulness.spec.ts`.
- Tests (added to): `RunInspectorPage.test.tsx` and `projections.exact-values.test.ts`.
- `docs/09-frontend-and-pwa.md` (new subsection after the Screens table) and `CHANGELOG.md`.

Unchanged: `useRunEvents.ts`, `projections.ts`, the event store, contracts, polling and coalescing timings. `useRunEvents.ts` didn't need changing: its `onEvents` callback already receives each full batch, so the store's trimming and history mode don't affect the header.

## How the header decides
- **What it remembers:** the latest lifecycle event for the run shown (start, resume, finish, failed, cancelled). It keeps only sequence numbers and the terminal status, plus how far the events seen after that point run without a gap.
- **Where that comes from:** every streamed batch the page accepts, whatever history window is being browsed, and the observation's `lifecycle`. The newest by sequence wins, so a delayed older observation can't undo it. Events for another run are ignored.
- **Not evidence:** cached history from an earlier visit, a selected historical event, and the observation's separate `finished` field.

| Situation | Header shows |
|---|---|
| Latest event is terminal, and the record isn't past what this view has seen (covers the held refresh, a record at exactly the terminal sequence, and later delivery events already seen) | That outcome: `succeeded` (or whatever status the finish recorded), `failed`, `cancelled` or `exhausted`, plus "Status from event #N; the run record is updating." instead of the record's position |
| The record already shows the same status | The record, as before |
| Record is past what this view has seen, with a terminal status | The record's status |
| Record is past what this view has seen, with an active status | "Updating status…" (it could be a lagging record or an unseen resume) |
| A start or resume came after an outcome, and the record is still terminal or older than that outcome | "Updating status…" until the record catches up; a resume is never shown as running |
| Finish with a non-terminal status | Left to the record; never shown as success |

This is presentation only. The record, failure and result, recovery, controls, Wait panel and delivery all still come from the server. The ordinary flow only changes in that the outcome appears sooner.

## Tests added
- **Page tests:** both of your baseline cases (held read, and a stale record at the terminal sequence). Instead of the hidden position label, the second proves the stale record was consumed by checking the query cache. The page tests also cover:
  - the `failed`, `cancelled` and `exhausted` outcomes;
  - a non-terminal finish followed by stream completion;
  - later delivery events already seen;
  - an unseen resume after the stream completed;
  - a same-run resume that parks in a wait, and a new attempt;
  - a delayed older observation;
  - browsing history with an oversized outcome event;
  - a cached terminal plus a selected old failure;
  - navigating to another run.
- **Pure and hook tests:** the remaining combinations.
- **Browser spec:** held and stale variants against a real minimal-loop run, faking only the record response through `page.route`.
- **#385:** a pure test (the `/messages/-` and `/vars/list/-` appends show nothing before and exactly the recorded value after, and non-add operations behave as before) and a page test that selects a real `node.finished` and checks each line of the patch view.

## Verification to run
- `pnpm --filter @graphgoblin/web exec vitest run src/runs/run-header-status.test.ts src/runs/useRunHeaderStatus.test.tsx src/runs/RunInspectorPage.lifecycle.test.tsx src/runs/RunInspectorPage.test.tsx src/runs/projections.exact-values.test.ts`
- The full web suite, plus `pnpm typecheck`, `pnpm lint`, the format check and `pnpm test:coverage`.
- The Playwright `inspector-truthfulness.spec.ts`, and the unchanged `claude-harness.spec.ts`.
- Your baseline fixture: its badge assertions should now pass. Its `at refreshed-record-witness` wait will not, because that position is now deliberately hidden.

## Concerns
1. Existing tests where the stream shows an outcome while the fake record stays non-terminal, and that assert the old badge or "at X" label, would now fail. I couldn't search for them.
2. I moved the observation query ahead of the event stream in `RunInspectorPage.tsx`, so request order changes slightly.
3. Judgement calls for review: a terminal record past this view's events is trusted as the record. "Updating status…" can persist if both the stream and the observation stall; I added no retry.
4. Formatting hasn't been checked, so a few lines may need reflowing.
5. Some page tests use `waitFor` timeouts up to 5 s, which is close to Vitest's default test timeout.
6. Assumptions I couldn't check:
   - The history-mode test pauses through the event store directly rather than the Timeline's paging control.
   - The browser spec assumes the inspector's own record read is the first request for the run.
   - The marker attribute `data-status-updating` is my choice.
7. #385 needed no production change: `projections.ts` is untouched. I recommend closing the issue on this evidence once independent QA confirms. There is no #385 browser case; I didn't look into the mutate node's configuration.
8. The new docs subsection sits after the Screens table because I couldn't find the run-inspector section of the 329 KB doc without search.
# Orchestrator dispositions for the #205 QA round 1 (2026-10-24)

The independent QA at `a258f770` failed on two major and three minor findings; twenty-one inheritance combinations, supported efforts, save, reload and import, loop defaults, keyboard operation, cancellation and restart passed. The orchestrator (Claude Opus 5.5) records these dispositions. All five were fixed in round 3 (`a57156c1`, evidence in `docs/qa/2026-10-23-wp-f2b-205/round-3/`).

- **F1 (major): inherited labels went stale while runs used changed Settings.** Accepted. Owner Settings and process defaults are re-read when a node dialog opens, when the window regains focus or the tab becomes visible, and after a Settings save. A change made through the API without a browser focus change shows on the next focus or dialog open (docs/09).
- **F2 (major): an effort outside Claude's ready capabilities reached the adapter.** Accepted for manual admission: it now resolves each pinned inference and LLM selection with the run's pinned defaults and refuses `EFFORT_UNSUPPORTED` on the node before recording the run. The QA's case used a fake whose probed capability list disagreed with the catalog. In the product, Claude's catalog rows are seeded from the adapter's own capability table, so the catalog check the engine already runs before every adapter request enforces the same efforts in every start path. The engine-side per-request probe the round first added was removed in review (`round-3/ORCHESTRATOR-REVIEW.md`).
- **F3 (minor): the effort label was concrete while the catalog was pending or failed.** Accepted; it reads checking or unavailable.
- **F4 (minor): the LLM decision's model kept a Mode selector.** Accepted; one dropdown starting with `Default (<inherited model>)`, saved shapes unchanged.
- **F5 (minor): accessible descriptions.** Accepted; each control's description names the inherited default and any unsupported-effort warning.
- **Gate failures.** The API-client and API coverage timing failures were in files #205 does not change; their isolated reruns passed, and CI is the clean run.
- **Record edits.** None: the folder is carried as the QA wrote it.

# Orchestrator dispositions for the #343 QA round 2 (2026-10-24)

The independent QA at `a20eaab0` confirmed both round-1 fixes (empty keys refused with nothing stored; the Events page shows target, trigger and admission id) and passed targeting, durability across hard kills, keyed retries, concurrency, upgrade, webhooks and 15 Edge checks. It failed on two new major findings. The orchestrator (Claude Opus 5.5) records these dispositions.

- **D4-343-03 (major): an embedded-NUL request key is accepted, then admission fails with zero runs.** Accepted. SQLite text comparison stops at U+0000, so the stored key reads back as `before` while the frozen intent holds `before\u0000after`, and admission reports `EVENT_INTENT_CONFLICT`. The fix refuses U+0000 in request keys at the contract (400 `VALIDATION_FAILED`, nothing stored) and in webhook-derived keys (422 `KEY_INVALID`), with regressions.
- **D4-343-04 (major): a receipt's retry-metadata write failure starves later due Events.** Accepted. One catch surrounds the whole Event recovery loop in `run-manager.ts`, so a failure on one receipt ends the sweep for every later receipt. The fix isolates each receipt's dispatch, as the webhook sweep already does, with a regression.
- **Gate failures.** Infrastructure native process-control files (register D-015) and bounded API runs, in files #343 does not change. The CI failure on `subloop-restart.test.ts` at this head passed on re-run (a 1-second `vi.waitFor` under load).
- **Record edits.** None: the folder is carried as the QA wrote it.

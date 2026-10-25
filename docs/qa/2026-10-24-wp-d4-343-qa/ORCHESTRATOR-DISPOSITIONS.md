# Orchestrator dispositions for the #343 QA round 1 (2026-10-24)

The independent QA at `9dcf40fa` failed on two defects; the core acceptance, lifecycle, upgrade, hard-kill and protected-webhook checks passed. The orchestrator (Claude Opus 5.5) records these dispositions.

- **D4-343-01 (major): an accepted empty request key became unkeyed.** Accepted. Fixed in round 3 (`cc03d911`): the request key needs 1 to 512 characters, so an empty key is refused with 400 `VALIDATION_FAILED` naming `/dedupeKey` and nothing is stored; every key copy and lookup checks for `undefined` instead of truthiness, so a space or one-character key keeps its delivery and run-envelope key. Evidence in `docs/qa/wp-d4-343/round-3/`.
- **D4-343-02 (minor): the Events page omitted the targeted admission identity.** Accepted. Fixed in round 3: pending and failed recipient rows show the target loop (linked to its editor), the entry trigger and the admission id without needing a run; rows without that metadata say `not recorded`. WP-G2 (#240, PR #394) also changes `EventsPage.tsx`; whichever pull request merges second reconciles the two.
- **Record edits.** None: the folder is carried as the QA wrote it.

QA round 2 runs against the round-3 head with `main` at `0a1ff340` merged.

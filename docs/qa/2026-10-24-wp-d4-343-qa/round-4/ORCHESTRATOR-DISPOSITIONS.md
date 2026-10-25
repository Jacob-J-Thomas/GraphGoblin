# Orchestrator dispositions for the #343 QA round 4 (2026-10-24)

The independent QA at `ad9d9f15` passed: D4-343-05 is fixed on all three key paths (webhook-derived, request and authored Event keys refuse ill-formed Unicode with nothing stored; a literal U+FFFD key admits), the shutdown merge holds (Events and webhooks refused during a drain with nothing stored, an Event accepted before the drain admits, due receipts recover after restart), and rounds 1 to 3's checks still pass, including the Events page at 1440 and 390 px. The orchestrator (Claude Opus 5.5) records these dispositions.

- **Verdict:** accepted. No new product defect.
- **Gate failures.** The unchanged template-client test that timed out under load (it also timed out in isolation on this host; CI runs it) and the native process-control files of register D-015. Not changed by #343.
- **Since this round:** `main` at `c63db245` was merged (#116, #205, #240) and the migration renumbered and regenerated on top of #116's `0018` as `0019_targeted_event_admission` with a timestamp in the past; the maintained browser specs that post Events are being updated to target a published loop, which #343 now requires. Those changes get their own checks before the audit.
- **Record edits.** None beyond the redaction of local user paths, if any, and the manifest recomputed from committed bytes.

# #186 server/transport implementation evidence

Round 1: [implementation report](../2026-10-22-wp-e1-186-report.md). Round 2: [review-fix report](round-2/REPORT.md).

## Round 3: bounded terminal confirmation

Base `3289c122cdaa985d90d1c48e7d10bb8b5c830d58`; uncommitted. QA defect D1 reproduced before the fix: each empty 42,102-event reply performed 331 repository reads and decoded the full history. The final implementation uses two empty replay reads plus one bounded lifecycle lookup (five existing indexed type seeks, at most one marker row). The terminal event precedes status but can precede delivery audits; started/resumed invalidate older outcomes. Both confirmation sites are bounded, and absent current terminal evidence retains defensive grace.

Seven final regressions fail on archived `8b760b6b` SSE source; all 13 catch-up and five SQLite focused cases pass after the fix. Counts, exact before/after timings, source guarantees, coverage, gates and native sandbox limitations are in the [round-3 report](round-3/REPORT.md). [Before](round-3/terminal-before.json), [after](round-3/terminal-after.json), [baseline proof](round-3/baseline-proof.json), [SQL plan](round-3/query-plan.json), [capture manifest](round-3/NOT-KEPT.md). The independent QA record matches HEAD after Git's LF normalization; the report discloses the repaired formatter setup incident. History browsing follows in #186 round 2; this review-fix round does not implement it.

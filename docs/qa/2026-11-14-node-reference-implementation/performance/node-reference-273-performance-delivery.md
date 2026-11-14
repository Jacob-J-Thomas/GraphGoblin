# #273 source-analysis performance correction

Exact clean local candidate `207b3e53067ebded36c8ec4e28dc47de46e1631f`, parent `a770ca57e642998f71b1d113031e69c7080fc324`. Commit scope is eight domain files and ADR-0075. SHA-256 readback verified that all 555 tracked web files match their pre-change working-tree bytes. The branch was committed locally. No push, review scan, listening service, browser test or owner-store action occurred.

The combined graph check discovers typed settings/node sources once. Its per-source inspection uses the existing Liquid parser and checked JSONata compilation, then caches only frozen syntax/reference facts keyed by exact language, scope and source. Cache bounds are 1024 entries, a 1 MiB estimated retained-size budget and a 16 KiB estimated entry budget. Large source strings or dense reference lists bypass reuse. Locations, warning/error decisions, node/reference membership, custom output ownership and rename destination are resolved each time. The cache retains no evaluator AST, parsed templates, replacement closure, graph or issue array.

## Paired public editor validation

Node 22.23.4 with actual `validateDraft` imported from both worktrees. The pre-feature baseline is `308c6285d5f5c4dffaf82613d066aba67c4dcffc`. The original #273 candidate showed an additional 17.86 ms median for a 300-node warm graph with references. The corrected public result matched the pre-feature valid fixtures. Deterministic semantics are covered separately by the focused tests.

| 300-node fixture   | Pre-feature steady median/p95 | Corrected steady median/p95 | Pre-feature one-prompt edit median/p95 | Corrected one-prompt edit median/p95 |
| ------------------ | ----------------------------- | --------------------------- | -------------------------------------- | ------------------------------------ |
| With references    | 10.52 / 12.40 ms              | 5.10 / 8.36 ms              | 10.48 / 13.93 ms                       | 4.55 / 6.81 ms                       |
| Without references | 10.36 / 14.57 ms              | 4.77 / 6.52 ms              | 10.26 / 15.66 ms                       | 5.40 / 7.25 ms                       |

For each 300-node fixture the old candidate parsed 596 times and analyzed 298. The corrected implementation parses and analyzes each of 298 unique cold sources once, zero times on a repeat and once after changing one prompt. Probe inputs use disjoint template text between fixture families. The first correction probe included one unintended shared changed source across fixture sizes. Its log is retained, and the exact commit rerun above uses disjoint keys. These timings concern synchronous CPU work and do not establish a browser paint or drop result.

- [Probe source](node-reference-273-perf-paired.mjs.txt), SHA-256 `9bfac08ddec12d807bbf9a83fa0fe0326cfdc092d25a17ba599eda968ed656b0`.
- [Exact-head timing and parser counts](node-reference-273-perf-exact-paired.log), SHA-256 `3bd8aea1bc74c73fc7ca1191cd57277dc7a7d724f56c2f9113163ea5227be8f1`.
- [Original regression and scope plan](node-reference-273-performance-plan.md).

## Focused verification

- Domain syntax/reference/cache group 60/60 passed. The tests cover cross-loop graph ownership, distinct execution scopes, language, invalid-source ordering, fixed and changed parse counts, frozen facts, rename targets and escapes, count and size eviction, and oversized input and reference-list bypass.
- Exact-head focused API 2/2 passed. The tests exercise blocked publication with draft/prior-version preservation and inherited output through the real in-process engine path.
- Domain typecheck, domain lint, changed-file Prettier and staged whitespace checks passed.
- The first intermediate focused run after replacing cached closures caught a backtick rewrite regression. The literal was corrected and the unchanged regression test passed. The original failed [focused log](node-reference-273-perf-domain-focused-final.log) and corrected [focused log](node-reference-273-perf-focused-corrected.log) remain available.
- Full domain coverage, integrated root gates and built browser timing remain queued under the shared heavy-test slot. Independent review, separate QA and fresh exact-head audit remain gated.

# #97 answer primitives — verification

## Scope

Choice, Noul and Score decisions, against immediate parent `codex/aidlc-foundations` at `478183379e08e26d48b7f14da8ca9571585d9efa`. Existing question rendering, decision context selection and session behavior are unchanged; #38 and #33 are deferred. This child is additive under format 2; #99 owns exit semantics and its later offline cutover. Existing Choice configuration/evidence stays valid.

## Executable gates (2026-10-08)

- Combined typecheck, lint, generated client/reference generation and freshness, formatting, build (11/11), layer rules, design tokens, Node 22 dependency rules, licenses and contrast passed.
- Coverage passed in every package, above all four 90% thresholds. Changed backend suites: contracts 183, domain 284, engine 451, infrastructure 343, Codex adapter 87, Jev adapter 36, API 416, API client 45 tests passed. Live-only tests remain opt-in.
- Web: 97 files / 1,083 tests passed. Statements 98.02%, branches 94.56%, functions 98.64%, lines 98.81%.
- Offline upgrade acceptance: 9 passed, 2 host-dependent file-symlink checks skipped; directory-junction refusal is covered. No owner application data was opened or upgraded by these checks.
- Required high-severity audit gate passed. The unchanged moderate development-only esbuild advisory remains tracked in #114; no dependency or lockfile changed.
- Built-app Edge acceptance: all 12 selected scenarios passed across bounded runs, with zero configured retries. Initial run: 9 passed/3 failed. Targeted repairs: 2 passed/1 failed; final Noul case: 1 passed. Failures were test interactions/setup: clicking a visually hidden radio instead of its visible card, matching both inline and summary validation text, creating an unsupported-capability fixture before admission, and treating a contenteditable editor as a native value input. Assertions retain actual saved/run behavior. No application code changed for those test repairs.

Browser commands use `pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/decision-routes.spec.ts e2e/classifiers.spec.ts --project=chromium`, with targeted grep for failed cases. Edge exercised stable numeric labels/eighth option, side-ID rename with save/reload/run, Score fractional bands and malformed coverage, keyboard connection, capability changes, rejected Noul evidence, custom classifier lifecycle and both themes at 768px.

## Real adapter evidence

The explicitly selected `packages/adapter-jev/src/primitive-live.test.ts` passed with `LIVE=1`: exactly one synthetic Noul and one synthetic Score request, retries disabled. Noul returned trueProbability 0.99; Score returned raw 3 on [0,3] with confidence 1 and the submitted legend. No credential or owner content was printed/sent. The two-request budget is consumed. Deterministic fixtures separately cover fractional values, every boundary, malformed responses, pre-cancellation and provider failures. Catalog readiness is not counted as a provider call.

## Review phases and dispositions

Installed Claude Code Opus 5.5, requested xhigh, reviewed the narrowed plans through one bounded fixed packet and one targeted amendment packet. The final plan verdict was READY. Claude.ai authentication, exact model and no API key were verified; effective effort is not reported by the CLI. This was plan review, not code or browser QA.

Accepted plan findings: explicit manifest resolutions for old provider-exit side criteria in #99, and confidence-gate rejection always nonmatching regardless of match=false. Equality passes; unresolved in-place conversion refuses atomically. These clarifications do not import deferred context work.

Root code review fixed two introduced issues before freeze: preserve compatible provider question/context when switching to Score, and honor recordAlternatives=false in confidence-rejection evidence as well as accepted decisions. Focused regressions cover both.

The first child Codex Review (review 5460188006, head `734843c`) found two in-scope issues: the exported evaluator accepted a Noul-only truth threshold for Choice/Score, and the exit documentation still described decisions as Choice-only. Both are FIX-IN-PR. The evaluator now rejects that configuration before resolving a provider; direct boundary tests cover both primitives. The documentation now distinguishes the three decision primitives from the legacy exits still awaiting #99.

Installed Opus code review of the same immutable head found two in-scope issues: switching an unfinished provider configuration discarded authored fields, and Score probabilities were mislabeled as band probabilities. Both are FIX-IN-PR. Switching now preserves incomplete provider input and its validation state; Score evidence names rubric indices and uses index-keyed fixtures.

The combined repair passed engine coverage (453 tests; 97.27% statements, 93.76% branches, 97.01% functions, 98.45% lines), web coverage (1,085 tests across 97 files; 98.08%, 94.65%, 98.64%, 98.90%), affected typecheck/lint, an 11-package build, and all four affected Edge scenarios with zero retries. Targeted Codex review (comment 6065367408) found no major issues at `3f15ff0`; installed Opus targeted code review returned READY for `734843c..3f15ff0`. Root verified the reviewed patch against source. Opus reported 17 inspection calls against a requested 14; the CLI completed within its hard turn/time limits. Both original GitHub review threads are resolved. The final feature-to-main PR will remain unmerged for owner acceptance after the integrated local feature update, backup and offline conversion rehearsal. The installed app/data remains untouched by this child.

## Actual browser QA and repair

Installed Opus performed ten actual headless Edge inspections against the attested built API/web preview at `3f15ff0`. The preview used isolated synthetic fixtures and scripted classifier results, with no native provider or owner-data access. It exercised accepted/rejected evidence, primitive switches and undo, reconnection and undo, capability filtering, mobile layout and keyboard focus. Verdict: CONDITIONAL PASS; no high/critical finding. This is actual browser evidence, not a hypothetical walkthrough. It does not establish native judgments or save/publish behavior; the separate Edge acceptance tests cover persistence.

Accepted QA findings: F1 missing authored Noul truth threshold, F2 missing rubric on rejected Score, F3 omitted classifier identity on rejection, F7 Noul-only threshold exposed on Choice/Score, and F5 confirmed focus loss on primitive switching. The repair reads the run's exact pinned version to explain the threshold (never the latest draft), retains rejection rubric/provenance, hides an absent inapplicable threshold while leaving invalid authored values available to fix, and restores the selected answer radio's focus only when that user action caused the form remount. Focus is not stolen on history or unrelated changes. Tests cover a pinned 0.2 threshold after a later version changes to 0.9, unavailable history, click/ArrowRight, raw rejection details and invalid-value remediation.

F4 route replacement with a working undo is intended when changing the answer's route contract (NO-CHANGE). Broader labels/float presentation from F6/F8 are deferred to #123; they predate this repair. The owner separately requested #124 default spacing and #125 layout persistence as backlog only; neither is implemented here.

Repair verification: web 97 files / 1,091 tests; statements 98.10%, branches 94.66%, functions 98.65%, lines 98.90%; web typecheck and changed-file lint pass. Root inspected the complete repair, including field override plumbing and focus lifecycle. Build 11/11 and all four affected Edge scenarios pass, zero retries. A bounded targeted actual browser QA of this repair is pending at this checkpoint.

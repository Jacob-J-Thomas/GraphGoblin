# Inspector retained reads and Timeline — QA archive draft

**Draft, prepared outside the repository. #416 and #420 remain open for engineering delivery.** The candidate is `d8bc84937363bbde1d24b561efdcd9e8601a48a7`, tree `e94fb9c910696baddd7278992ed716af4ca747d0`, against main `0f6c325becf3e3e0562ae69dfae2c42bcf1d7129`. The residual author checks passed 229/229 on the exact bytes later frozen at this head. Independent fresh2 passed, but full63 remains failed at 62/63 on one captured feedback assertion. Root disposition of that failure, corrected-source native QA, current whole-web coverage, repository gates, CI, the reserved final MAX audit and signed merge remain separate gates. There is no published final PR or owner acceptance in this packet.

This reader replaces stale *current* claims in the earlier planning drafts. Original reports, first failures, raw evidence and source identities remain unchanged. The proposed repository location is `docs/qa/2026-11-23-inspector-offline-timeline`; no evidence has been inserted there by this preparation.

## Scope and workflow

#416 retains previously qualified run evidence during a relevant transport outage and labels it **Last observed, may be out of date**. A fallback read cannot invent current write authority. Recovery needs a qualifying matching GET that started after the relevant loss and genuinely committed. Health, browser-online and stream-open signals can trigger reads, but cannot authorize writes. A nonzero historical `loss` can remain after recovery: authority requires `committed > loss` together with current run, node, failure, visit, action and evidence identity. Cold seeds, unrelated caches, wrong IDs, definitive refusals and retired receipts remain excluded. [Minimum contract](scope/MINIMUM-CONTRACT.md)

#420 makes the Timeline sequence gutter fit its numbers and permits wrapping while preserving keyboard navigation, selection, Follow live, paging, the 80-row window and existing history budgets. Actual browser geometry is a separate evidence tier from component assertions.

The [issue workflow](../../15-issue-workflow.md) requires independent review and criterion-appropriate QA, with raw bytes retained under `docs/qa/`. The batch also requires its exact-head final audit and signed merge. A component pass does not establish native behavior, CI, owner acceptance or deployment. This reconciliation is documentation and accounting; it is not another review pass.

## Source stages and actual executions

| Stage | Actual evidence | Scope and limit |
| --- | --- | --- |
| Original core `30820901` → corrected core `458f6cb0` | Author 22 pass/3 fail → 25 pass; identical independent fixture 4 pass/3 fail → 7 pass. Actual Fable first **CHANGES_REQUIRED**, then bounded **ACCEPT**. | D240 cancellation/provenance scope only; four independent retirement negatives retained. [Core reader](core/README.md) |
| Initial UI `6924c529` | First focused run 159 pass/5 fail across 11 files; first formatter failure retained. | Initial implementation, not final candidate. [First focused result](raw/i5-416-420-author-focused-01/REPORT.md) |
| UI correction `3c35b3d0` | Corrected focused 165 pass; whole-web 3,159/3,159 across 236 files, 98.67% lines/94.40% branches; independent original 49/49. | Historical source only. These coverage numbers do not qualify `d8`. [Coverage](raw/i5-416-420-web-coverage-01/REPORT.md) |
| First opposing review and old-source D241 reproduction on `3c35` | Full review **CHANGES REQUIRED**. First selector ran zero; structured run 3 pass/9 fail/49 filtered; admitted C1-only run 1 pass/1 fail/59 filtered. | Five findings reached with four passing controls; original setup and unreached-assertion limits retained. [Old reproduction](raw/i5-416-420-review-reproduction-01/old/REPORT.md) |
| D241 correction, actually executed `d71fbe81`; carried to `2231400e` by verified runtime equality | First author focused 226 pass/1 ambiguous lookup fail → 227/227; first independent 60 pass/1 ambiguous lookup fail → 61/61. | The carry changed two docs and an author test; no component rerun at `223` is invented. [Author first](raw/i5-d241-corrected-checks-01/REPORT.md) · [Independent fixture correction](raw/i5-d241-independent-qa-fixture-correction-01/REPORT.md) · [Exact carry](raw/i5-d241-independent-qa-final-carry-01/REPORT.md) |
| Targeted review and residual B1 reproduction on `2231400e` | Formal review 2 remains **CHANGES REQUIRED**. Two independent residual cases failed, with 61 filtered. Each dispatched one old POST and then one valid fresh-choice POST. | Public cache removal control and actual mounted ApiKeyPanel storage-event/generation path with synthetic keys; component scope, not native two-tab/principal acceptance. [Residual reproduction](raw/i5-d241-observation-entry-loss-independent-qa-01/REPORT.md) |
| First native run on `2231400e` | 12 selected, 10 pass/2 fail; no retries/skips. | B3 stopped before Recover script; strict G1 failed at narrow enlarged text. [Native report](raw/i5-416-420-browser12-execution-01/REPORT.md) |
| Native baseline: retained H2 web build equivalent to shipping main `0f6c325b`, separately matched current API harness | Same strict G1 case failed once after all 12 samples. | Comparison build provenance is explicit; no fresh main build is claimed. [Baseline comparison](raw/i5-416-420-baseline-g1-execution-01/REPORT.md) |
| Residual correction bytes checked while based on `223`, then frozen as `d8bc8493` | Web typecheck/scoped lint/format exit 0; focused 229/229 across 14 files. No formatter write, zero errors, five naming warnings. | All 227 earlier case names retained; two regression cases added. Original unexecuted runner pin typo and root's one-character correction are both retained. [Current checks](raw/i5-d241-final-residual-checks-01/REPORT.md) · [Freeze](raw/i5-d241-residual-corrected-freeze-01/FREEZE.json) |
| Independent corrected `d8`, exact unchanged 63-case fixture | Fresh2: 2 pass/61 filtered. Full63: **62 pass/1 fail**. All original 61 passed. | Zero old POSTs, Not sent mutation error and one valid fresh-choice POST reached in both variants. Full63 accepted-key variant failed only captured feedback text/visibility; eventual versus permanent visibility is not distinguished. [Closed report](raw/i5-d241-observation-entry-loss-corrected-qa-01/REPORT.md) |
| Corrected native `d8`, full current gates and final audit | **Pending actual execution/closed evidence and root disposition.** | Future holes in COPY-PLAN.csv have no invented source, hash, bytes or outcome. |

## Decisions, attribution and remaining findings

D240 preserves an existing exact cache revision when cancellation leaves identical object/count/idle state; it does not manufacture new proof. The accepted synthetic internal-state limitation remains. Actual Fable's acceptance is core-scoped, and source carry-forward is bounded by byte identity. The independent helper and tracked regressions stay in ordinary web unit/coverage gates, including dependency updates. [Core decision and alternatives](core/raw/i5-d240-cancellation-correction-admission-01/decision-240.md)

Actual ordinary-Max Claude Opus 5.5/xhigh authored the UI and subsequent D241 corrections. GPT authored core/root verification and formatting; independent agents own their stated QA/review evidence. The residual author closed with 47 paired tools and four allowed changed paths. Its handoff was source reasoning, not a test run. The correction retains the latest committed session-gate identity so an older choice stays expired after visible observation loss, even if receipt replacement resets its counters. [Residual decision and declined alternatives](raw/i5-d241-residual-correction-admission-01/DECISION.md) · [Ordinary author handoff](raw/i5-d241-actual-max-residual-correction-01/ordinary-handoff.md)

D241 also preserves already-sent deletion/script outcomes, scopes outages to their run, qualifies cancellation evidence and retains the existing selected-exit explanation. An explicitly browser-dismissed deletion dialog may permit a new read-only preview while shared pending state still forbids another confirmation; the original outcome remains visible. [D241 canonical decision](raw/i5-d241-review-correction-admission-01/decision-241.md) · [Implementation disposition](raw/i5-d241-review-correction-admission-01/IMPLEMENTATION-DISPOSITION.md) · [Current outcome addendum](D241-IMPLEMENTATION-OUTCOME-ADDENDUM.md)

The first native B3 fixture lacked finalization timestamps, causing legitimate one-second terminal polling that defeated the unchanged 2.2-second quiet barrier. Root admitted exactly three timestamp additions to represent the intended finalized run. Assertions, deadlines, quiet interval, outage schedule and no-POST requirements remain unchanged. The first failure does not establish dialog expiry or script consent safety. [Native failure disposition](raw/i5-416-420-native-failure-followup-preparation-01/ROOT-DISPOSITION.md) · [Exact B3 materialization](raw/i5-d241-residual-corrected-qa-rebind-01/B3-exact.diff)

All 12 candidate `223` samples had zero sequence/type clipping or overlap; baseline overlap was one in every cell. At 320 px/CSS 200%, both builds had 453 px page width against the 321 px strict allowance; outside text ranges fell 31→26. Root accepted the #420 number/type criterion on `223` and parked broader pre-existing reflow as [#563](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/563). **Strict G1 remains failed.** Corrected `d8` geometry still needs actual evidence or justified exact-source equality. [Measurements](raw/i5-416-420-baseline-g1-execution-01/G1-COMPARISON.json)

[#561](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/561) remains parked response-body transport classification work. [#562](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/562) remains parked healthy cross-credential consent work; the residual correction does not claim to fix that no-loss scenario. Neither item expands this batch or waives a gate. S2's three real loopback bodies establish schema/body-shape and finite parse observations only, without outage/recovery or mounted-inspector acceptance. [S2 reader](s2/README.md)

## Open gates and owner catalogue

| Gate | Current status |
| --- | --- |
| Source freeze and residual static/focused checks | Closed evidence at `d8`, scoped as above; not whole-candidate acceptance |
| Independent corrected residual fresh2/full63 | Fresh2 passed; full63 **failed 62/63**. Root disposition and resolution of the captured feedback assertion remain open. No behavioral rerun or fixture/timing change occurred. |
| Corrected-source native 12-case QA | Pending; original 10/2 and strict baseline failure preserved |
| Current whole-web coverage and repository static/layer/dependency/licence/generated-doc gates | Pending; no historical coverage substitution or threshold/exclusion change |
| Review accounting | 2/3 formal passes consumed; 1/3 general scans consumed. Targeted pass 2 remains CHANGES REQUIRED until independent residual proof closes. A new head/agent does not reset either cap. |
| Exact-current CI/native artifact binding | Pending published head, current target/tested merge, required jobs and artifact identities |
| Reserved fresh independent Astra MAX audit | Pending formal pass 3 within the existing cap |
| QA insertion, publication and signed merge | Pending root integration and existing gates |
| Owner catalogue acceptance/rework and later owner QA | **Unchecked**; agent evidence cannot complete either |

Root will integrate the full catalogue. Keep **D01–D03 first**, preserve the **240 existing numbered entries**, and append the current D241 outcome and declined alternatives without renumbering or implying owner approval.

Engineering remains **41/48 overall (85.4%), 24/26 core batch (92.3%), 4/5 intents (80%)**. No increment follows before merge. Mac #456/PR #501 device QA remains external. #64/#125/#221/#323 stay conditional after Mac; #460 remains held and #379 awaits refinement. Acceptance and deployment are separate from these engineering counts.

## Archive handling

COPY-PLAN.csv is the single reconciled plan. Only READY_TO_COPY rows identify physical files; FUTURE_HOLE rows are explicit requirements, never permission to synthesize evidence. Every selected source has an exact byte count/SHA-256 and safe, case-insensitively unique destination. The compact core/S2 packets retain their original seals, maps and omission qualifications. Their historical inner source aliases are not extra copies. Initial failures and intermediate snapshots keep their original dates/source identities and do not define current status.

Preserve raw JSON, TS/TSX, Python, PowerShell, patch and native trace/screenshot bytes. Do not format raw artifacts or follow arbitrary external locators. Model selections contain ordinary handoffs and sanitized process/source/terminal controls only; no raw provider stdout/private reasoning, credentials, owner files, whole temporary trees, node_modules or dist. New prose may be formatted during root integration and must then be rehashed. This is a validated planning checkpoint, not a complete-delivery seal.

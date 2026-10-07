# First seven-loop AIDLC set: live acceptance

Built and tested in `codex-aidlc-full-v1` on 2026-10-06 America/Chicago (2026-10-07 UTC). **All three live acceptance scenarios passed.** The authorized REST parent completed the entire scratch lifecycle: planning, implementation, fresh review, exact-head CI, verdict comment/label, merge, merged-SHA QA, durable proof and issue closure. Separate fix-now and future-issue experiments also passed. GraphGoblin product source, index and history are unchanged. Changes remain uncommitted under `examples/aidlc/`. No subagents, directory deletion, links, instance restart or access to its private data directory occurred.

The earlier blocked assessment was incorrect: REST starts were authorized, and sandbox GitHub credentials said nothing about the API owner's authentication. The orchestrator initialized the API-owned scratch repository/workspace. This follow-up used REST for all starts and observation; only owner-process script nodes performed GitHub writes or scratch pushes. The scratch repository is private. No GraphGoblin GitHub mutation occurred. The two earlier rejected MCP calls created no runs and consumed no worker/Jev budget.

## What ran per loop

**Parent:** run `01M4A3F6G0GMKQXHXPD3W004YY` succeeded with `ParentReport.status=complete`, one completed task (`validate-reversed-clamp-interval`), no remaining tasks, PR #2 and the QA child id. It admitted/claimed open issue #1, called all six children sequentially, inspected their status and outcome, and closed only after the final QA pass. Its real negative fix/rework/cap branches were not exercised; the fix-now negative below uses explicit standalone result handoffs. The real-engine/fake-port suite covers the parent fix, cap and QA-rework mappings.

**Planning:** child `01M4A3FFA29J7SFDT85YME92AB` succeeded. Jev Choice selected plannerB (confidence 1); a fresh Sol/high worker inspected the module, observed two baseline tests passing and returned one bounded `Plan` preserving all three locked criteria. No plannerA or uncertain-judgement worker ran. Slot A remains Astra/high for future Opus 5.5; slot B is Sol/high for future Fable 5.1 after verified provider metadata exists.

**Implementation:** positive child `01M4A3GJ0TQPHJAK1T1NKNA9QT` selected code with Jev and ran fresh Sol/high. The helper committed `3c0387635068b4570417a5c3ca42456155a8f44e` from baseline `2396f30251947e242cb262dcc9754fbcbe57081f`, changing only `clamp.js` and `clamp.test.js`; all four tests passed. Separate live visits injected the controlled fault, repaired it at the reviewed head, and produced finite-input README documentation. Each used a real fresh code worker, script-owned Git commits and hashed check/diff proof. Visual and uncertain routes were not exercised.

**Review:** positive child `01M4A3HW84FMB3917GRYK1CZYG` passed after independent tests and 810 interval/value combinations. All reviewers were fresh Astra/high sessions, with the same-OpenAI-family relaxation explicitly recorded. The negative reviewer returned changes-required with two blocking fix-now findings, then a second fresh reviewer passed the repaired SHA. Future review passed required acceptance, routed future-issue and created linked issue #7 with rationale/acceptance criteria. Full mode still refuses this family map; no opposite-family independence or real GitHub approval is claimed.

**PR/CI/approval:** positive child `01M4A3KW4CBDZNQ7HBWN34EHWA` reconciled PR #2, waited for remote `aidlc-test` success on the exact reviewed `3c038...` head, posted a structured verdict comment, applied `aidlc-review-pass`, and merged with the expected SHA. Observed merge SHA is `f75a3a4c24a2db905b712b27af683b3df952ea39`. `approvedHeadSha` is null: this is the authorized single-identity comment/label mode, not an approving review. A second eligible identity is required for real approval. Negative experiments stop at reviewed draft PRs and prohibit merge/closure.

**QA:** positive child `01M4A3MNDCVHB8A4Q24SRNK4YJ` verified the merged PR and checked out `f75a3a4c24a2db905b712b27af683b3df952ea39`. Fresh Luna/high independently reran four tests and returned pass for `aidlc-in-range`, `aidlc-bounds` and `aidlc-reversed`, with proofComplete true. Checklist hash is `e8fb226ce84a32688ac709024a50d6a4b27225a204654e44e726aef895e025dd`. The helper verified proof bytes and published the QA log/report at immutable proof commit `d0f9ec8917d9f362392d037b34ad62b45fe00f41` on `aidlc-proof`. No failed-QA live retry or adversarial evidence-only audit ran.

**Closing:** positive child `01M4A3P4M3MS0MD2FQ39A73JEY` verified pass, matching merge/checklist hashes, proof, succeeded QA result and sibling-parent provenance, no pending task and closure authorization. It commented the proof and closed issue #1. No issue was auto-closed by PR linkage: the PR used `Part of #1`.

## Three acceptance scenarios

### Positive: passed

Input: API-owned `.tmp/aidlc-control/aidlc-positive-input.json`; workspace `.tmp/aidlc-scratch`. Actual owner baseline is `2396f30251947e242cb262dcc9754fbcbe57081f`, superseding the old sandbox-only baseline in the earlier report. The parent ran from 02:35:50 to 02:39:45 UTC. [Issue #1](https://github.com/Jacob-J-Thomas/gg-aidlc-scratch/issues/1) is closed; [PR #2](https://github.com/Jacob-J-Thomas/gg-aidlc-scratch/pull/2) is merged. All seven run ids appear above. Paid counts: 4 fresh worker starts, 0 repair/resume turns, 2 Jev evaluations.

Durable proof: [test log](https://github.com/Jacob-J-Thomas/gg-aidlc-scratch/blob/d0f9ec8917d9f362392d037b34ad62b45fe00f41/.aidlc-proof/aidlc-1-f75a3a4c24a2db905b712b27af683b3df952ea39-check-0.txt) and [QA report](https://github.com/Jacob-J-Thomas/gg-aidlc-scratch/blob/d0f9ec8917d9f362392d037b34ad62b45fe00f41/.aidlc-proof/aidlc-1-f75a3a4c24a2db905b712b27af683b3df952ea39-qa.json). The log's SHA-256 is `89a87df3fcd42c39565e1e79c84ebb9979f8a46ac64098b1d79edc7796857825`. The issue stays open until those post-merge results exist.

### Fix-now: passed

[Experiment issue #3](https://github.com/Jacob-J-Thomas/gg-aidlc-scratch/issues/3), isolated owner-created `.tmp/aidlc-fix-now`, baseline `f75a3a4c24a2db905b712b27af683b3df952ea39`. A real implementer was explicitly asked to inject a fault; this is not evidence of spontaneous worker error. The immutable checklist was preserved. Three retained tests passed despite the missing reversed-interval guard/test, demonstrating why script green alone cannot qualify acceptance.

| Stage              | Run id                       | Observed result                                                                                       |
| ------------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| Injection          | `01M4A3VHSAZ5CJE0NKP3A6FCVW` | Candidate `da363253dabedd6b64c1966025b1e4281307eee8`; 3 tests pass                                    |
| Fresh review       | `01M4A3XS28ZNVSAMYGJ59T7GBJ` | changes-required; expression route fix-now; R1 missing guard and R2 missing regression, both blocking |
| Fix implementation | `01M4A40P3931NBQ55NPJ8E2TYR` | Findings bound to `da363...`; repaired head `78f8fc57e8f851a52e8a673abe0f5202f82adeda`; 4 tests pass  |
| Fresh re-review    | `01M4A43DNR0TZMAV4EQDQST8D9` | pass at `78f8fc...`; independently checks locked criteria and fixes                                   |

Review observed `clamp(5,10,0)` returning 0 and the RangeError assertion failing. The helper opened draft PR #5, posted the rejected-head findings, then pushed the repaired head and posted a separate head-bound pass comment. The existing PR was reconciled rather than duplicated. The experiment stops before PR/CI approval, merge, QA and closing. Issue #3 and draft PR #5 remain open. Counts: 4 fresh workers, 0 repair/resume, 2 Jev.

### Future-issue: passed

[Experiment issue #4](https://github.com/Jacob-J-Thomas/gg-aidlc-scratch/issues/4), isolated owner-created `.tmp/aidlc-future-issue`, baseline `f75a3a4c24a2db905b712b27af683b3df952ea39`. The task is finite-input README documentation; a non-finite input policy is explicitly out of scope. The reviewer receives a controlled hint to defer a concrete optional policy/test enhancement with rationale, while preserving all required acceptance. This tests disposition/issue creation, not unbiased discovery frequency.

Implementation run `01M4A4628KB88HSZ6C37Q1NDA2` produced head `d20d181824903fa36e98ca7f77195b85ffb39e95`, changing only `README.md`; four tests passed. Fresh review run `01M4A49KJKDGN6XVW7Y2V0Q364` independently checked the examples, verified evidence and returned pass for every locked criterion. Its expression chose future-issue. The helper opened [draft PR #6](https://github.com/Jacob-J-Thomas/gg-aidlc-scratch/pull/6), created [future issue #7](https://github.com/Jacob-J-Thomas/gg-aidlc-scratch/issues/7), and posted the structured review on the PR. Finding `clamp-nonfinite-policy` is nonblocking, deferred, linked to #7, and has a rationale for exclusion from finite-input scope. Its acceptance text specifies NaN/Infinity/-Infinity in each argument, documenting the chosen policy, regression tests, and preserving the locked finite-input criteria. The issue body links task #4 and PR #6 at the exact head. Merging and closing are prohibited. Counts: 2 fresh workers, 0 repair/resume, 1 Jev. Issues #4/#7 and draft PR #6 remain open.

## Instance and evidence

All seven finished exports remain published at version **3**, without changes to their previously validated definitions. No runtime-source edit or republish was necessary for the successful live lifecycle. [full-v1-evidence.json](full-v1-evidence.json) records current version ids, normalized export equality, sessions, decisions, results, counts and owner-process GitHub inventory.

| Loop           | Id                           | Version |
| -------------- | ---------------------------- | ------- |
| Planning       | `01M4A1ZWQA1G8AWNJXRC8VKQXY` | 3       |
| Implementation | `01M4A20AXYYXMKJQ265Y3ACECG` | 3       |
| Review         | `01M4A20AZ69E2FK2W23WGWJ23M` | 3       |
| PR/CI          | `01M4A20B05SZ4F1ZYGDVDVR8Z8` | 3       |
| QA             | `01M4A20B0Y7K7V6WS1FMJEQTTG` | 3       |
| Closing        | `01M4A20B1QPZNYG5A1AMPW711P` | 3       |
| Parent         | `01M4A20B5KQQVB63NHGP5JF0WV` | 3       |

Temporary script-only loop `aidlc-acceptance-support`, id `01M4A3SQ55QJ04VFNNHGZGW9DV`, created fixtures and collected scratch inventory with no inference/Jev. Its first run `01M4A3SVF7G8QM7GC6YDXG0AEB` failed before any side effects; version 2 corrected its endpoint. Retry `01M4A3TSYFX510AW4S3XV8KX3P` succeeded, cloning both workspaces and creating issues #3/#4. Version 3 added workspace readback; inventory run `01M4A4DF512AZJZ438EX7E48A1` succeeded. **The throwaway loop was deleted** after its run/transcript/version evidence was saved; directories are retained. The seven finished loops and earlier trial remain untouched by that deletion.

REST captures and transcript artifacts are saved under `.tmp/aidlc-control/aidlc-run-*.json` and `aidlc-transcript-*.json`. Paid counts use fresh `harness.session` events and completed Jev `decision.made` events, reconciled against the conservative script reservation ledger. No ledger was reset. Collector starts refuse overlapping acceptance invocations. Evidence audits worker intervals to establish maximum concurrency **1 for GraphGoblin acceptance workers**. The pre-existing Codex GitHub integration independently auto-reviewed PR #2 when it was marked ready; see the external limitation below.

## Defects and gaps by severity

**High: none observed in the product.** The full positive lifecycle completed without a blocked child, repair turn, provider failure or worker launch retry. This does not prove unexercised routing, hostile confinement or recovery behavior.

**Medium capability gaps:** opposite-family roles await #26; full mode refuses current same-family bindings, while Codex-only mode records the explicitly authorized relaxation. Strict evidence-only QA isolation/auditor soundness is not demonstrated, so that setting blocks before running an audit worker (#32 amendment and design isolation rule). No hostile canary or weaker audit was run. These are known prerequisites, not newly reproduced product defects.

**Medium external acceptance limitation:** scratch repository Codex automatic review was already configured. Marking PR #2 ready triggered one cloud review activity, recorded by its `codex-pull-request-review-summary` comment (created 02:38:57 UTC, completion shown 02:39:59 UTC). This overlaps the local QA worker interval. Reproduction: mark a draft ready in this scratch repository with that existing integration enabled. Global one-worker serialization would require owner configuration/control of that independent integration; the instance can only serialize its own sessions. No cloud review was explicitly requested, no GitHub review object/approval exists, and that comment was not used as a merge gate. The negative PRs stayed draft, avoiding more automatic ready-triggered reviews. Counts below separate the 10 instance starts from this one observed external review activity; the cloud integration's internal worker/session count is unavailable. No new product defect is inferred.

**Low authoring error, corrected:** the temporary fixture helper initially requested `gh api repos/Jacob-J-Thomas/gg-aidlc-scratch/` (trailing slash), returning HTTP 404. Reproduction: start helper version 1 with action fixtures, run `01M4A3SVF7G8QM7GC6YDXG0AEB`, events show nonzero script exit and the exact endpoint. Expected: repo read without trailing slash before private-repository admission. Removed the slash, republished the same helper name as version 2 and retried successfully. No GitHub object or worker/Jev evaluation was created by the failed attempt. This is a support-script fault, not GraphGoblin product code.

**Low known template/capability gaps:** literal role compilation/helper installation remains manual (#28); fixer continuity awaits #33 and uses fresh sessions with explicit SHA-bound findings. Event entry awaits #29; parent and QA are manual/synchronous. Extra human cycles/reminders, separately admitted top-level rework, supplemental/generated exhaustive QA criteria and the auditor remain unimplemented. Actual UI routing, uncertain judgement, opposite-family review, real GitHub approval, live parent three-cycle cap/QA failure, provider failure, replay recovery and cross-workspace proof-branch concurrency were not demonstrated. No new GraphGoblin execution defect was reproduced in this follow-up.

## Checks, counts and retained state

Local verification: **15/15 passed**, using actual core/runtime helpers and real engine with fake external ports for pass, fix-now, future-issue, cap and QA rework. This is separate from the three live scenarios. `support/verify-live.mjs` passed assertions against actual captured results, exact-head feedback, disposition routes, remote inventory and protected checklist state. Required final `pnpm.cmd format:check` **passed** and `pnpm.cmd check:docs` **passed**; results are recorded in the evidence.

Final actual counts: **16 instance runs** (7 positive parent/children, 4 fix-now, 2 future-issue, 3 script-only setup/inventory); 15 succeeded, 1 temporary-helper setup failure. **10 runs started Codex workers; 10 fresh worker starts / 30, 0 repair/resume turns; 5 Jev evaluations / 30.** Conservative reservations remain at 20 worker turns and 5 Jev evaluations. There was also **1 observed external Codex GitHub review activity**, outside the instance ledger; conservatively that is 11 observed Codex activities, with cloud internal worker counts unknown. Instance worker concurrency was 1; global concurrency is not claimed.

The owner-owned positive workspace remains detached at `f75a3a4c24a2db905b712b27af683b3df952ea39`; the fix workspace is clean on `aidlc-issue-3-aidlc-fix-now-candidate` at `78f8fc...`, and the future workspace is clean on `aidlc-issue-4-aidlc-future-issue-candidate` at `d20d...`. Checklists match their input and carry Windows read-only attributes. Positive and clone byte hashes differ due to checkout newline conversion; parsed locked contents are identical and no worker changed them. The remote has those three candidate branches, `main` at `f75a3a...`, and `aidlc-proof` at `d0f9ec...`. Every proof and capture directory is retained. The index remains untouched; only examples/support/report changes are left uncommitted.

## GitHub objects for orchestrator verification

The sandbox cannot independently authenticate private-repository reads. Results above come from owner-process script outputs/events. The inventory run read back every object below at 02:52 UTC and records complete comment bodies, labels, current-head checks, PR heads/merge state and refs in the evidence. The orchestrator should independently verify that inventory with owner `gh`. All mutation destinations are `Jacob-J-Thomas/gg-aidlc-scratch`.

- Owner bootstrap: private repository, baseline on main, task issue #1 and seven configured labels. The loops claimed issue #1, removed aidlc-ready, applied aidlc-in-progress then aidlc-pr-open, and removed delivery labels on closure; final issue #1 has no labels.
- Positive: [PR #2](https://github.com/Jacob-J-Thomas/gg-aidlc-scratch/pull/2), exact-head verdict label aidlc-review-pass, merge `f75a3a...`, proof branch `d0f9ec...`, closed [issue #1](https://github.com/Jacob-J-Thomas/gg-aidlc-scratch/issues/1). Current-head [required CI](https://github.com/Jacob-J-Thomas/gg-aidlc-scratch/actions/runs/37562931746/job/112604090616) is success at `3c038...`; two successful aidlc-test check runs exist on that SHA (push and PR workflow triggers).
- Negatives: created [issue #3](https://github.com/Jacob-J-Thomas/gg-aidlc-scratch/issues/3), [issue #4](https://github.com/Jacob-J-Thomas/gg-aidlc-scratch/issues/4), [draft PR #5](https://github.com/Jacob-J-Thomas/gg-aidlc-scratch/pull/5), [draft PR #6](https://github.com/Jacob-J-Thomas/gg-aidlc-scratch/pull/6) and [future issue #7](https://github.com/Jacob-J-Thomas/gg-aidlc-scratch/issues/7). Issues #3/#4 retain aidlc-ready + aidlc-pr-open; #7 has aidlc-future; draft PRs have no verdict label. Their current-head aidlc-test checks are success in readback, but no negative PR/CI loop, merge or QA is claimed.
- Seven configured labels exist: aidlc-ready, aidlc-in-progress, aidlc-pr-open, aidlc-blocked, aidlc-needs-human, aidlc-review-pass and aidlc-future. Other default repository labels predate these loop mutations. No approving GitHub review object exists on any PR.

All **8 loop-authored comments** to verify:

| Purpose                 | URL                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| Claim issue #1          | [6029706564](https://github.com/Jacob-J-Thomas/gg-aidlc-scratch/issues/1#issuecomment-6029706564) |
| Positive head review    | [6029732043](https://github.com/Jacob-J-Thomas/gg-aidlc-scratch/pull/2#issuecomment-6029732043)   |
| Head-bound verdict      | [6029735109](https://github.com/Jacob-J-Thomas/gg-aidlc-scratch/pull/2#issuecomment-6029735109)   |
| QA results/proof        | [6029745826](https://github.com/Jacob-J-Thomas/gg-aidlc-scratch/issues/1#issuecomment-6029745826) |
| Closing proof           | [6029746684](https://github.com/Jacob-J-Thomas/gg-aidlc-scratch/issues/1#issuecomment-6029746684) |
| Rejected negative head  | [6029806309](https://github.com/Jacob-J-Thomas/gg-aidlc-scratch/pull/5#issuecomment-6029806309)   |
| Repaired head review    | [6029847761](https://github.com/Jacob-J-Thomas/gg-aidlc-scratch/pull/5#issuecomment-6029847761)   |
| Deferred future finding | [6029891437](https://github.com/Jacob-J-Thomas/gg-aidlc-scratch/pull/6#issuecomment-6029891437)   |

The ninth inventory comment, [6029738128](https://github.com/Jacob-J-Thomas/gg-aidlc-scratch/pull/2#issuecomment-6029738128), is the independent Codex GitHub automatic review summary. It is not loop-authored, an approval or a schema-forced reviewer result.

## Issue wording for the orchestrator

These are explicit first-version differences/omissions; no GraphGoblin GitHub issue was edited. The 2026-10-06 amendments already resolve the seven-child structure, non-closing linkage and QA-before-closure changes.

- **#4:** original three issue/PR/merge-triggered gallery templates and per-node resume differ from seven raw exports with a manual parent and fresh sessions. Gallery/event/continuity criteria remain future acceptance.
- **#30:** original `Closes #N` conflicts with QA-before-closure; this set uses configurable `Part of #N`, as amended. Label/event autonomous pickup, split branches and separately admitted persisted future attempts remain absent. The new future issue is a linked follow-up, not a demonstrated autonomous retry.
- **#31:** "merge only on approval ... or a human's explicit choice" needs the authorized single-identity verdict-comment/label test exception; it is not real approval. The promised human pause plus three extra cycles/reminders differs from the parent returning needs-human at its cap; only the PR policy gate has a bounded input wait. Same-family review is a recorded Codex-only relaxation. Missing/failing CI cannot be overridden.
- **#32:** original "issue stays closed" and reopen-after-merge framing differs from QA-before-closure, as the amendment resolves. Generated/exhaustive criteria and always-running adversarial review are not the locked-checklist QA delivered here. Strict audit halts, as amended. Merged-event entry, supplemental criteria generation, sound isolated audit and new top-level retry admission remain future work.

## Left open

The requested positive, fix-now and future-issue live paths are complete. Broader capability work remains with #26/#28/#29/#33 and the documented #4/#30/#31/#32 criteria above. Experimental issues #3/#4, deferred issue #7 and draft PRs #5/#6 intentionally stay open as evidence. A second identity is still needed for real approval. Owner verification of GitHub inventory and automatic-review configuration remains external to this sandbox. No product defect has been filed or product fix attempted.

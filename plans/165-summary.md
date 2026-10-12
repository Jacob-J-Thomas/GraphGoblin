# Issue #165: owner approval summary

This proposal follows the owner's October 9 decision to retire template automation and delete `examples/aidlc`. It is a research plan. No implementation, installation change, issue update or commit has been made.

## What changes and what stays

Keep the post-PR #151 versions of Starter, implementation, review and QA. PR #151 merged on October 10, including #158-#161 and #160's gallery with only "Use <name>". Each action creates an independent draft in the ordinary editor. You can change nodes, instructions, models, directories and limits. Editing one copy leaves other copies and installed assets unchanged. Those issues remain open for your re-test and closure; #165 does not close them.

Template settings, configured instances and their private automation are removed. The retained implementation loop can plan, change accessible source and assess verification. The review loop can review and request bounded fixes. The QA loop can assess evidence and challenge the assessment. They do not automatically claim issues, create worktrees, push branches, open or merge pull requests, publish authenticated proof, reopen issues or change labels. Their output does not establish an enforced isolation boundary. Any GitHub work you want must be configured explicitly through ordinary nodes in your copy.

The existing run list and inspector continue to work for ordinary runs and safely converted Starter runs. Run paging moves out of the template store before that store is deleted. Template-specific run filters and origin warnings disappear. Catalogue errors still receive clear installation guidance. The older `examples/aidlc` graphs and scripts are deleted; their Git history and previous reports remain historical evidence.

The listed follow-ups are reconciled by retiring their affected runtime: #131, #132, #133, #136, #138 through #146, #148, #149 and #153 can close as retired once the final code and recovery paths are gone. This does not mean their old automation passed its tests. #140's template-specific discovery problem disappears, while generic polling failure behavior remains separate. #134 stays open and narrows to the installed catalogue and draft assets. Only the automation part of #32 is retired; the ordinary QA worksheet stays. You re-test and close #28, #30 and #31 yourself. The technical comment gives a code reference for every disposition.

## Decisions for the owner

### 1. Where retired automation history will be available

**Recommendation: preserve it in the offline archive and recovery bundle.** After the cutover, old configured implementation, review and QA runs will no longer appear in the normal run list or open in the run inspector. Their old URLs will not open a live run. You will still have their original definitions, events, outputs, snapshots, consumed attempts, signed journals and worktree evidence, indexed by the original IDs. You can inspect that evidence through the offline audit command and preserved files. The upgrade will not restart the old automation or retry uncertain GitHub actions. Ordinary runs and supported Starter history remain visible in the product.

**Alternative: keep those retired runs visible in the live inspector.** This needs a general way to retain historical versions while making them permanently non-executable. Every execution route, including replay, subloops and startup recovery, must enforce that state, and the inspector must explain it. Estimate **3-5 additional worker days**, with one or two additional PRs and independent review and QA. That estimate has medium confidence and requires a revised storage and API design before implementation. It is not safe simply to remove bindings and leave the old graphs runnable.

Under either choice, keep the evidence indefinitely for now. This plan does not delete physical worktrees, journals, branches or artifacts, or rotate credentials. You approve the actual per-instance data dispositions later, after seeing the inventory. Approving this architecture does not approve an unseen data manifest.

### 2. Approve exact archived private-report dispositions

The joint rule owned by #164 refuses active runs, pending receipts or frozen admission intents, unfinished child notifications or timers, and unfinished terminal finalization. The old build settles them first; conversion never abandons, drains or executes them. The sole exception is a retired terminal template run whose only unfinished item is its private report. You must approve an exact per-run manifest disposition with a recorded reason and preserved evidence. This exception is settled across the plans; it does not permit unresolved returns, pushes, merges or other work to be archived as completed.

### 3. Parked storage prerequisites

**Recommendation: unpark #118 and #152 before the final cutover.** #118 addresses deletion of a loop leaving runs without their historical versions. #152 makes fresh database schema creation and its format marker commit together. Both are parked today, so this plan does not assume permission to implement them.

The alternative for #118 is to keep it parked and have the cutover inventory require separately reviewed orphan resolutions. Missing definitions cannot be guessed, and refusal does not authorize deleting ordinary history. For #152, the alternative is an explicitly approved equivalent initialization fix inside the shared cutover work. Without one of those approved fixes, fresh-store acceptance remains blocked. #127 can remain parked: this delivery uses uncached verification so stale local test results cannot qualify it.

### 4. Settle #167 before the format-4 data upgrade

**Recommend option 3 (variant C), with medium confidence, as #167 recommends and #164 agrees.** Decisions choose policy, a Continue node owns `maxPasses` with repeat and exhausted connections, and terminal exits declare outcomes and returns. A separate cumulative per-node safety cap is initially seeded from the same old `maxIterations`. A possible one-Continue-per-loop limit is a design limit for your review, not settled policy. Choosing the design now includes it in the single format-4 cutover; choosing it later requires another cutover. The owner decision still gates exits and the final upgrade. #164's current estimate includes this work.

## Effort and confidence

The #165 estimate is **6-9 worker days**: 5-7 for removal and 1-2 for shared conversion and rehearsal. The programme total with option 3 is **34-51 worker days**: #164 12-19, #165 6-9 and #168 16-23, excluding owner turnaround and optional live-history work. It grew from #164's original 3-5-day estimate because it now includes Continue semantics, cross-system history and device conversion, storage safeguards, and reviewed rehearsal rather than only decision authoring. Confidence is high in removal boundaries and medium in unseen data effort. Peer tests are not claimed as new tests here.

## Child PRs, in order

Use the step numbers in #164's single integration sequence, section 6 of its technical plan:

- **Steps 01-04:** Freeze format 3, complete authorized storage prerequisites, and establish shared format, inventory and snapshot foundations.
- **Step 05, A:** Move ordinary paging and remove template read metadata and filters.
- **Step 06, B:** Disconnect authority, credential dispatch and finalization wrappers; make loading draft-only.
- **Step 07, C1:** Remove implementation and review support services and tests.
- **Step 08, C2:** Remove QA support services and tests.
- **Step 09, D:** Remove configured contracts, APIs and storage; include four reduced manifests and prepare 0012, in about 26-40 files.
- **Step 10, E:** Keep ordinary assets and finish editor, gallery and guides, editing the same gallery files changed by #160.
- **Step 11, F:** Delete legacy examples and active references.
- **Steps 12-19:** #164 completes decisions (steps 12-13), then the selected exit design: step 14 for option 1, steps 15-16 for option 2, or steps 17-19 for option 3.
- **Steps 20-25:** #168's trigger children follow the exits portion, without exception.
- **Steps 26-28:** Compose the exact converter, finish device preservation, then qualify SQL, rehearsal and restore in the shared cutover.

All children target `feat/format-4-integration`. None is installed independently. The agreed reservations are `0012_retire_template_instances`, `0013_trigger_configuration` and `0014_format_four_cutover` only if additional metadata tables are needed. #164 owns the numbering, manifest and one offline transaction. Type-dependent child boundaries can move to keep each PR compiling and under about 40 changed files.

## Main risks

The largest risk is letting an old privileged graph run after its authority checks have been removed. Complete retirement and explicit data dispositions prevent that. Another risk is losing recovery evidence that lives outside the GraphGoblin data directory; separate repository and worktree copies are required. Pending admissions, active descendants, orphan history or uncertain ordinary return delivery cannot be silently cleared. Drizzle's current snapshots are incomplete, so the final schema snapshots and a no-change generation check are required before accepting the migration.

The plan absorbs debt items D1, D2, D3, D24 and D27. It shares D12 with #164 and #168: #165 supplies the removal schema, while #164 coordinates the final snapshots and generation check. It does not use the debt register as authorization to unpark other issues.

## What you can review in the running product, and when

After the relevant children are built on disposable data, you can review the four gallery actions, create repeated copies, edit one independently, and run the ordinary graphs with supplied task context. You can inspect their honest results, blocked paths and retry limits, as well as ordinary run paging and catalogue error messages. These demonstrations use isolated stores and safe working directories.

Before the integration branch merges to main, you receive independent review and touched-system QA, the final #167 behavior, and a rehearsal on supplied stopped-store copies with inventory, archive counts, replay checks and restore evidence. You then review the exact data manifest and your selected history disposition. Your installed instance is upgraded manually only through a separate authorized operation. This planning turn starts no server and touches neither port 4747 nor `~/.graphgoblin`.

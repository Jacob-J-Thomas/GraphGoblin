# Issue #165: owner approval summary

This proposal follows the owner's October 9 decision to retire template automation and delete `examples/aidlc`. It is a research plan. No implementation, installation change, issue update or commit has been made.

## What changes and what stays

The gallery keeps Starter, implementation, review and QA. Each "Use template" action still creates a new, independent draft and opens the ordinary editor. You can change its nodes, instructions, models, working directory and limits, then publish and run it. Editing one copy does not change another copy or the installed template.

Template settings, configured instances and their private automation are removed. The retained implementation loop can plan, change accessible source and assess verification. The review loop can review and request bounded fixes. The QA loop can assess evidence and challenge the assessment. They do not automatically claim issues, create worktrees, push branches, open or merge pull requests, publish authenticated proof, reopen issues or change labels. Their output does not establish an enforced isolation boundary. Any GitHub work you want must be configured explicitly through ordinary nodes in your copy.

The existing run list and inspector continue to work for ordinary runs and safely converted Starter runs. Run paging moves out of the template store before that store is deleted. Template-specific run filters and origin warnings disappear. Catalogue errors still receive clear installation guidance. The older `examples/aidlc` graphs and scripts are deleted; their Git history and previous reports remain historical evidence.

The listed follow-ups are reconciled by retiring their affected runtime: #131, #132, #133, #136, #138 through #146, #148, #149 and #153 can close as retired once the final code and recovery paths are gone. This does not mean their old automation passed its tests. #140's template-specific discovery problem disappears, while generic polling failure behavior remains separate. #134 stays open and narrows to the installed catalogue and draft assets. Only the automation part of #32 is retired; the ordinary QA worksheet stays. You re-test and close #28, #30 and #31 yourself. The technical comment gives a code reference for every disposition.

## Decisions for the owner

### 1. Where retired automation history will be available

**Recommendation: preserve it in the offline archive and recovery bundle.** After the cutover, old configured implementation, review and QA runs will no longer appear in the normal run list or open in the run inspector. Their old URLs will not open a live run. You will still have their original definitions, events, outputs, snapshots, consumed attempts, signed journals and worktree evidence, indexed by the original IDs. You can inspect that evidence through the offline audit command and preserved files. The upgrade will not restart the old automation or retry uncertain GitHub actions. Ordinary runs and supported Starter history remain visible in the product.

**Alternative: keep those retired runs visible in the live inspector.** This needs a general way to retain historical versions while making them permanently non-executable. Every execution route, including replay, subloops and startup recovery, must enforce that state, and the inspector must explain it. Estimate **3-5 additional worker days**, with one or two additional PRs and independent review and QA. That estimate has medium confidence and requires a revised storage and API design before implementation. It is not safe simply to remove bindings and leave the old graphs runnable.

Under either choice, keep the evidence indefinitely for now. This plan does not delete physical worktrees, journals, branches or artifacts, or rotate credentials. You approve the actual per-instance data dispositions later, after seeing the inventory. Approving this architecture does not approve an unseen data manifest.

### 2. Terminal automation whose old reporting is unfinished

**Recommendation: allow an explicitly approved archive disposition for terminal template runs whose private reporter did not finish.** All processes must have stopped, and the manifest must name the complete retired execution and its unresolved effects. The archive preserves uncertainty; it does not claim a comment, merge or return happened. This is a narrow exception that #164 and #168 must adopt together. If it is rejected, those records must be reconciled under the old build before the cutover, which may require repairing the old reporting path. Ordinary unfinished returns, active runs and every pending delivery still block conversion under either choice.

### 3. Parked storage prerequisites

**Recommendation: unpark #118 and #152 before the final cutover.** #118 addresses deletion of a loop leaving runs without their historical versions. #152 makes fresh database schema creation and its format marker commit together. Both are parked today, so this plan does not assume permission to implement them.

The alternative for #118 is to keep it parked and have the cutover inventory require separately reviewed orphan resolutions. Missing definitions cannot be guessed, and refusal does not authorize deleting ordinary history. For #152, the alternative is an explicitly approved equivalent initialization fix inside the shared cutover work. Without one of those approved fixes, fresh-store acceptance remains blocked. #127 can remain parked: this delivery uses uncached verification so stale local test results cannot qualify it.

### 4. Settle #167 before the format-4 data upgrade

**Recommendation from the supplied research: keep exit loop-back for now, with medium confidence.** The owner has not decided. If you prefer the middle option, where decisions choose whether to continue and a continuation node owns the iteration budget, decide now and include it in format 4. Choosing it later would require another stored-data cutover. Its extra implementation effort belongs to #164 and must be estimated in that revised plan. #165 can proceed with approved removal work, but the final upgrade and retained retry graphs wait for this decision.

## Effort and confidence

The base removal is estimated at **5-7 worker days**, plus **1-2 worker days of #165 participation** in the shared converter and rehearsal. This excludes #164, #168, optional live-history work and owner review time. Confidence is high in the removal boundaries and medium in data effort, because this planning session has not inventoried the owner's store. The debt register is under review; its relevant findings are incorporated without presenting its reported reproductions as new tests performed here.

## Child PRs, in order

1. **Shared prerequisite:** #164 freezes the current format-3 schemas and conversion semantics before any source contracts are removed.
2. **A:** Move ordinary run paging and remove template-specific read metadata and filters.
3. **B:** Disconnect private runtime authority, credential dispatch and finalization wrappers.
4. **C1:** Remove implementation and review support services, entries and dependent tests.
5. **C2:** Remove QA support services, entries and dependent tests.
6. **D:** Remove settings and instance contracts, APIs and storage code; prepare migration `0012_retire_template_instances`.
7. **E:** Package only the ordinary starting-point assets and finish editor, guide and catalogue changes.
8. **F:** Delete the legacy `examples/aidlc` files and active references.
9. **Shared follow-through:** #164 completes decisions and the owner-selected exits; #168 completes triggers; the final PR combines inventory, approved conversion, SQL, rehearsal and restore evidence.

All children target `feat/format-4-integration`. None is installed independently. The agreed reservations are `0012_retire_template_instances`, `0013_trigger_configuration` and `0014_format_four_cutover` only if additional metadata tables are needed. #164 owns the numbering, manifest and one offline transaction. Type-dependent child boundaries can move to keep each PR compiling and under about 40 changed files.

## Main risks

The largest risk is letting an old privileged graph run after its authority checks have been removed. Complete retirement and explicit data dispositions prevent that. Another risk is losing recovery evidence that lives outside the GraphGoblin data directory; separate repository and worktree copies are required. Pending admissions, active descendants, orphan history or uncertain ordinary return delivery cannot be silently cleared. Drizzle's current snapshots are incomplete, so the final schema snapshots and a no-change generation check are required before accepting the migration.

The plan absorbs debt items D1, D2, D3, D24 and D27. It shares D12 with #164 and #168: #165 supplies the removal schema, while #164 coordinates the final snapshots and generation check. It does not use the debt register as authorization to unpark other issues.

## What you can review in the running product, and when

After the relevant children are built on disposable data, you can review the four gallery actions, create repeated copies, edit one independently, and run the ordinary graphs with supplied task context. You can inspect their honest results, blocked paths and retry limits, as well as ordinary run paging and catalogue error messages. These demonstrations use isolated stores and safe working directories.

Before the integration branch merges to main, you receive independent review and touched-system QA, the final #167 behavior, and a rehearsal on supplied stopped-store copies with inventory, archive counts, replay checks and restore evidence. You then review the exact data manifest and your selected history disposition. Your installed instance is upgraded manually only through a separate authorized operation. This planning turn starts no server and touches neither port 4747 nor `~/.graphgoblin`.

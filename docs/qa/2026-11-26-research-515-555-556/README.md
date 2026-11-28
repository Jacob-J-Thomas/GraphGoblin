# Windows editor timing and guarded PWA research (#515, #555, #556), revision 3

Issues #515, #555 and #556 stay open, and their causes are unresolved. This packet publishes revision 3 of the research report on them. The report records what the retained artifacts establish and what they do not. The earlier revisions were authored by GPT. Claude Opus 5.5 prepared revision 3 by applying the findings of the two Claude reviews of revision 2. It used existing logs, Git objects, artifacts and read-only Git and GitHub reads only: no tests, reproductions, browser sessions or builds ran for revision 3. [Report](raw/RESEARCH-515-555-556.md.txt) · [Changes from revision 2](raw/CHANGES.md.txt)

## The three investigations

### #515: editor draft writes and held JSON

**Original failure.** In the original author's candidate web coverage run (source `14a84a1` on base `d3f651c`), a one-save assertion saw two captured draft PUT calls, and the separate held-JSON test exceeded its 20-second deadline.

**Later evidence.** At the study source `154e78d` the focused pointer and held cases passed, and both broad web runs passed 3,190 of 3,190 tests across 236 files. The original run had 2,911 tests in 224 files, so the suite composition differs. In the broad uninstrumented run the held case finished 2,369 ms under its deadline. A separate acknowledgement-gated hold control produced two accepted revisions in the component fixture; it is not a reproduction.

**Unresolved.** The original PUT bodies, conditional tokens and timing were not retained, and the retained fragments establish neither simultaneous execution nor workload equivalence. Neither the extra PUT nor the timeout has an identified cause. The report lists what a separately authorized recurrence investigation should retain.

### #555: guarded update after closing a dirty tab

**Original failure.** In Linux run 44934348117 the first dirty-tab veto held. The second Update click completed, and the main frame never reloaded. After the 60-second deadline the fixture's reset POST failed against a closed context, and the log prints the generic timeout followed by that cleanup error.

**Later evidence.** The exact Linux case passed once at `154e78d` (hosted job 138929614571). It then failed again in PR #582 CI (run 45571609471, Browser job 139059364536, merge `8af4a224`) with the same runner image, Edge 158.0.4370.33, case position and printed errors. At `8af4a224`, 10 of the 11 selected paths carry the original failing blobs; only `.github/workflows/ci.yml` differs, and its effect is not assessed. The exact Windows cases passed.

**Unresolved.** One pass and one later failure are single executions and establish neither frequency nor cause. The original failure's page and worker protocol stage is unknown. The recurrence's trace and its retained `browser-failure` artifact, listed as expiring on 2027-02-23, were not analysed. The test-only error-precedence correction is a separate change with its own packet, [2026-11-26-pwa-test-error-precedence-555](../2026-11-26-pwa-test-error-precedence-555/README.md); it does not repair the product failure.

### #556: cold offline banner on Windows Edge

**Original failure.** The archived instrumented Windows case showed "Cannot reach the GraphGoblin API" with the "Loops needs the GraphGoblin API" notice, and failed the exact "You are offline" check.

**Later evidence.** An uninstrumented Windows run of the maintained case passed the whole oracle, including reconnect, in 3,550 ms. A separate observer's JSON and PNG support narrower observations. The PNG shows "You are offline", but the JSON records no banner text and is tied to the PNG only by file name and control flow. Of the 22 paths selected for the comparison between the failing base `29e165e` and `154e78d`, only `apps/web/src/api/queries.ts` changed. Seventeen unselected non-test files under `apps/web/src` also changed and were not compared.

**Unresolved.** The effects of the archived diagnostic overlay, of the unselected changes and of the environment are not established, and no cause is asserted.

## The two Claude reviews of revision 2

Both reviews returned CHANGES REQUIRED. Each recomputed the figures it checked and found them matching, and both agreed that the report asserts no cause and that all three issues remain investigated and unresolved.

- **Formal review** (opposite-family read of GPT's revision 2):
  - R1: add the PR #582 recurrence of #555, which revision 2 omitted although the #555 thread recorded it, and state that the `154e78d` pass and the `8af4a224` failure are single executions.
  - R2: give the #556 22-path comparison the same scope qualifier as #555. "API client" was not the whole client, and `api-key.ts` and `bootstrap.tsx` changed outside the selection.
  - Non-blocking N1–N6: the original #515 ref, infrastructure row citations, the suite composition, labels whose receipts do not record cleanliness, "not a reproduction" for the acknowledgement-gated control, and the origin of the sampler errors.
  - Outside the report, it noted that the public #556 comment of 2026-11-25T02:58Z overstates the observer.
- **Artifact QA review.** It checked every number, row, run ID, commit, blob and hash against the raw artifacts. All matched, and the packet and study seals were intact.
  - R1: record the #582 recurrence.
  - R2: scope the #556 comparison, including the unselected `status.tsx` notice.
  - R3: fix two #515 citations that pointed at a projection lacking the supporting rows.
  - R4: name and bind the record behind the #556 clean run's commit attribution.
  - Optional precision notes P1–P5.

Revision 3 applies every required finding and every recommended or optional note but one: it leaves out a remark about a worktree's state after a run, which it did not re-check. [CHANGES](raw/CHANGES.md.txt) maps each finding to its edit and evidence and settles three discrepancies between the reviews. The reviews are retained outside this packet, at `G:/ggq/delivery-evidence/2026-11-24-followups/research-515-555-556-claude-roles/`:

| Review      | File                                     | SHA-256                                                            |
| ----------- | ---------------------------------------- | ------------------------------------------------------------------ |
| Formal      | `claude-window-formal-02/REVIEW.md`      | `1dd56c2096ce4194ca2c1f765b15529fec5a1405e440f63f43a311b14ecad095` |
| Artifact QA | `claude-window-artifact-qa-02/REVIEW.md` | `518a8db77cab941a33bad32ac0fd1326721aec2e1bcf693d7fe12630a91db2b2` |

## Status

Revision 3 has not been independently reassessed. The opposite-family (GPT) delta check of Claude's revision 3 edits is still owed. The packet proposes no issue closure and claims no product repair. A correction to the #556 issue comment was drafted with revision 3; it is not part of this packet and has not been posted.

## Files

[`MANIFEST.json`](MANIFEST.json) lists every packet file with its source, size and SHA-256. `raw/` keeps revision 3's files byte for byte, and the packet's `.gitattributes` keeps `raw/**` byte-exact:

- `raw/RESEARCH-515-555-556.md.txt` and `raw/CHANGES.md.txt`: the report and its change record, stored as `.md.txt` originals.
- `raw/excerpts/`: exact-row excerpts and the Git and GitHub readbacks behind revision 3's new citations.
- `raw/MANIFEST.json`: revision 3's own manifest. It gives the SHA-256 and size of each file in its folder and of each referenced input outside it. All entries were re-checked when this packet was assembled.

The report's links are relative to its evidence folder, `G:/ggq/delivery-evidence/2026-11-24-followups/research-515-555-556-revision-03/`. Its `excerpts/` links also resolve under `raw/`. The revision 2 inputs it cites under `../research-515-555-556-revision-02/inputs/` are not copied here. `raw/MANIFEST.json` identifies them by SHA-256 under `referencedExternal`. The packet leaves out the folder's readback, excerpt and manifest scripts and the drafted #556 correction comment, which `raw/MANIFEST.json` still lists with their hashes.

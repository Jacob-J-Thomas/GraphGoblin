# #235 input-presence evidence bundle (proposed)

**Status: proposed evidence curation only. The phase 2 proposal is superseded. Phase 3 correction and independent QA remain pending; this is not an accepted final candidate.**

Root rejected the phase 2 coarse-pointer Omit control because its drawn target measured **41.75 × 20 px**, below the existing 44 × 44 px convention. Phase 2 did remove the invisible overlapping hit box and its recorded taps stopped discarding text inside the input; those results do not close the target-size requirement. A separate phase 3 correction is in progress to allocate a real 44 × 44 px layout area. This bundle intentionally contains no claim that phase 3 is complete or accepted.

## What the evidence records

- **Input semantics (phase 1):** an absent map entry remains untouched/omitted; cleared text is an empty string and validated; blank/incomplete numeric input reports the number error; raw editor input remains undefined until edited; empty-string enum values display as an empty string; “Not set” stores undefined; Omit is optional-only; focus moves to the control; raw-editor Omit is available only when the schema accepts null. See the formatted [phase1/handoff.md](phase1/handoff.md) and byte-preserved [phase1/handoff.md.txt](phase1/handoff.md.txt).
- **Original touch data loss:** at the phase 2 candidate, the invisible pseudo-element target reached into the current input. The original raw records show real taps causing Omit and losing typed text. original-touch-loss/ is the root-retained first-overlap capture; phase2/logs/touch-overlap-candidate.json is the later phase 2 run. They are distinct captures and preserve their own source hashes.
- **Rejected first hitbox correction:** phase2/logs/tap-map-fix1-current-comment.json records 528 real taps, including 57 that wrongly omitted from the input and 21 from the previous field. The full retained report describes the rejected 44 × 36 px correction and later failures.
- **Phase 2 proposal (superseded):** after removing the invisible hit box and adding coarse-pointer spacing, phase 2 recorded 0 mis-omissions in its tap-map cases, and full web coverage passed 2,460 tests at 98.51% line and 94.07% branch coverage. Its full Edge form-controls file passed 8/8 and the targeted responsive cases passed 4/4. These results are historical evidence for the phase 2 source only; they do not establish that phase 2 meets the 44 px target requirement.
- The human-readable full report is [phase2/phase-report-retained.md](phase2/phase-report-retained.md); its byte-preserved source is [phase2/phase-report-retained.md.txt](phase2/phase-report-retained.md.txt). The wrapper's report.md was replaced with a short summary and is not used here. The original external archive remains at C:\Users\98jak\graphgoblin-qa\2026-11-13-aidlc-batch\ui-235-claude-phase2; its large event stream, screenshots, mutation build output and trace zips are excluded from this compact selection.

## Session and source provenance

phase1/launch.json, phase1/session-result.json, and phase1/exit.json, plus corresponding files under phase2/, preserve launch configuration and runner session metadata. The runner result.json files describe Claude sessions; they are not GraphGoblin API run results.

- Phase 1 launch requested claude-opus-5-5 at xhigh; its session result reports canonical model claude-opus-5-5, success, and 113 turns.
- Phase 2 launch requested claude-sonnet-5-5 at xhigh; its session result reports canonical model claude-sonnet-5-5, success, and 181 turns. The retained report notes per-turn metadata displaying reasoning_effort 30; effective effort was not independently verified. Do not present requested xhigh as verified effective effort.
- Phase 2 worktree HEAD: f3254bb19b2507cc45e8b7af6b9dc599e402a656. Source and built-asset hash records are in phase2/logs/33-final-source-hashes.txt, 34-dist-hashes-final.txt, 43-dist-hashes-final2.txt, and 53-final-source-hashes.txt; the full report records the derived build-manifest hash. The full tracked diff is retained in phase2/final-phase2-tracked.diff.
- Phase 3 is a separate Opus correction being handled outside this proposal. Its final status and evidence are not included here. Add its frozen handoff, real tap results, final tests, and source/build hashes after the phase completes; independent QA remains separate.

## Reproduction dependencies and limitations

The formatted [phase2/drivers/README.md](phase2/drivers/README.md) documents the repeatable drivers; its byte-preserved source is [phase2/drivers/README.md.txt](phase2/drivers/README.md.txt). common.mjs, touch-overlap.mjs, tap-map.mjs, and tap-sweep.mjs remain byte-preserved. Formatted human-readable copies sit at their documented paths; markdown-publication-hashes.json records their raw-source and publication hashes. They use Node 22.23.4, the matching checked-out GraphGoblin worktree with pnpm build output under apps/web/dist, installed @playwright/test, and Microsoft Edge. The in-memory e2e server uses an ephemeral loopback port and the drivers stop their owned browser/server. The source archive's driver guide gives the exact supported invocations and environment variables. The captured tests use a controlled Playwright touch environment; they do not model every physical device or prove painted operating-system high-contrast mode. No model/provider or owner store/service was used.

## U22 baseline bundle verification

The canonical 31-file U22 bundle is referenced at [docs/qa/2026-11-14-i08-u22-baseline](../2026-11-14-i08-u22-baseline/) and is not duplicated here. u22-baseline-source-manifest.json and u22-baseline-verification.json record per-file byte counts and SHA-256 comparisons against the phase 1 source manifest, original external retained copy, active worktree retained copy, and a temporary staging copy. All 31 entries matched; the staged copy was then removed to avoid duplicating the canonical bundle. The phase 2 initial and final hash-list files remain under phase2/logs/.

A read-only Prettier check with Node v22.23.4 found that the original README needs formatting. The formatted canonical replacement is [canonical-replacement/docs/qa/2026-11-14-i08-u22-baseline/README.md](canonical-replacement/docs/qa/2026-11-14-i08-u22-baseline/README.md); its byte-preserved source is [u22-baseline-raw/README.md.txt](u22-baseline-raw/README.md.txt). The source README and active worktree were not edited.

## Bundle manifest

source-evidence-manifest.json inventories the byte-preserved raw evidence and source hashes. markdown-publication-hashes.json records before/after SHA-256 values for each Markdown publication copy. publication-manifest.json inventories the complete proposed bundle after formatting, with byte sizes, hashes, and source paths. Large raw captures not required to substantiate the compact evidence remain in the original external phase directories.

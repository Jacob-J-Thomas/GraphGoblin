# Canvas postdeletion QA: scoped positives and confirmed post-pan blocker

This packet preserves the exact 123-file independent evidence set for the stacked #207 candidate, plus a curation wrapper and integrity records. The original evidence files are under `raw/`; the original packet README is preserved as `raw/README.md`. The two complete reports are retained byte-for-byte as `.md.txt` files.

## Disposition

The evidence contains **12 bounded positive groups with 109 exact browser draft PUTs**, and a **separate confirmed Remove activation blocker** immediately after a canvas pan. This is mixed, scoped QA evidence, not an all-green result.

At clean candidate head `64a955887962f72287e532824be1b8cb32c5f055`, tree `a6691516210eb25887cb92abdcbd8c7abe1a4bb3`, the 12 groups demonstrated their stated outcomes against comparison base `35bb3fbdc724a82064d0d9e65b551608542c6b22`, with actual main `a817e5ccb4fd598ca56089b97b4ce55e9cb6f58c`:

| Scoped group                | Exact draft PUTs | Positive outcome summarized in the retained report                                                                                     |
| --------------------------- | ---------------: | -------------------------------------------------------------------------------------------------------------------------------------- |
| Shared ports and dialogs    |               18 | Six node kinds draw, remove, and redraw to distinct Exit nodes; Exit outcomes have input only.                                         |
| Script                      |                9 | Default, Retry, and Report round-trip and reload; duplicate labels and unsupported declaration refusal are checked.                    |
| Decisions, settled zoom     |               42 | Five decision families pass exact port inventories, drawing, removal, redraw, and reload, including Score and supported repeat routes. |
| Repeat execution and pins   |                4 | Published immutable v1 supports provider-free runs pinned to v1; ordinary completion and Limit reached paths are distinguished.        |
| Declaration editing         |                8 | Label/order edits, stable-ID rename, cancel, route removal, and Undo are exercised.                                                    |
| Geometry and history        |                7 | Route nudging, removal/redraw history, Undo, and route-only Reset are exercised.                                                       |
| Coarse Remove               |                1 | A native browser touchscreen tap in touch-enabled Edge emulation removes the selected edge while preserving others.                    |
| Refusals                    |                4 | Invalid or wrong-direction interactions preserve the graph; repairing the authored ID allows the intended connection.                  |
| Stranded recovery           |                8 | Missing endpoints and removed Script ports recover with Undo/Redo while preserving the route.                                          |
| Keyboard and focus          |                5 | Backspace/Delete, inert inactive input, and accessible Undo focus are checked.                                                         |
| Protected Chat              |                2 | Protected gestures are refused; ordinary continuation stays editable and published Chat remains immutable.                             |
| Modal rename and held input |                1 | Coerce self-pointer repair preserves row identity/focus; unrelated held malformed text remains exact until discard.                    |

## Confirmed post-pan blocker

The separate [passive pan diagnostic report](raw/pan-diagnostic-report.md.txt) confirms that, immediately after an ordinary mouse drag pans the canvas and releases, a separate trusted click on the selected edge's enabled, attached Remove control is canceled. The control is hit-testable on both down and up; the click is trusted and enters the button path, but does not reach window bubble. The attempt made **zero draft PUTs**. Full public API and synced IndexedDB readbacks remained equal to their pre-click values, including token `5f8c98b0556bc8d0`.

The report's source analysis makes D3's transient window-capture click suppression a strong, source-consistent explanation. The run did not instrument listener registration, so it does **not** prove the identity of the listener that canceled the click. The blocker is the observed failed action, independent of that mechanism inference.

The [failed same-session zoom-control setup record](raw/runs/corrected-decisions-pan-diagnostic/run.json) preserves the assertion before any gesture; it is not counted as an interaction result. The distinct earlier [settled-zoom control observations](raw/runs/corrected-decisions-zoom-control/observed.json) and [run record](raw/runs/corrected-decisions-zoom-control/run.json) contain 42 exact Decision PUTs and support the five-family scoped positive result. They do not negate the post-pan blocker.

## Identity and evidence boundary

The [full native stacked report](raw/native-stacked-report.md.txt) records the twelve group outcomes, build admission and limits. The [raw source packet README](raw/README.md), [run index](raw/run-index.json), [final cleanup record](raw/pan-diagnostic-cleanup-final.json), and [native cleanup record](raw/native-cleanup.json) provide supporting context. The native tier was Windows desktop Edge, a real compiled API and disposable file SQLite. Node 22.23.4 was used; the retained forced build completed 12/12 packages with exit 0.

Before/after artifact binding remained exact at SHA-256 `1bd7d02cea6d72f733d1bb075fd57413a14be8aa294316506de8a215091e3dcf`, covering 77 source hashes, 17 embedded source entries and 1,227 artifacts across 13 distribution trees. Terminal cleanup recorded zero live fixture PIDs/listeners or invalid records across 20 fixtures, with no residual fixture locks/WAL/SHM. Touchscreen input was emulated in the browser; physical touch hardware, providers and screen-reader coverage are outside this evidence.

The evidence is for the stacked candidate only. PR #478 was just opened as DRAFT at the same frozen product head for stacked CI; CI is pending and the review scan count is 0/3. This packet makes no readiness, main-integration, current-target-gate, adversarial-review or owner-acceptance claim.

## Integrity

The exact [source retain manifest](retain-manifest.json) has SHA-256 `27446a99b8c3630bdb75f091e3ffc2b49935fb4a05b126f0441a3e99a731be89` and inventories 123 files totaling 4,746,913 bytes. [The outer manifest](retained-files-manifest.json) maps each exact raw copy to its source path and hash. `SHA256SUMS.txt` covers all packet files other than itself; `link-checks.json` records local links checked in this wrapper. `.gitattributes` disables text conversion so the retained evidence keeps its original bytes.

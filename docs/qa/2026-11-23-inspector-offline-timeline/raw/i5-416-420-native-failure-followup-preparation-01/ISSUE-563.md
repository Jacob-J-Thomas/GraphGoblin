Independent browser QA for #416/#420 reproduced a broader, pre-existing Run inspector reflow defect. Parked outside the approved five-intent batch; this does not add work to that batch or waive its technical gates.

At a 320px viewport with actual CSS text enlarged to 200% (computed sizes doubled, not device-scale emulation), the Run inspector's document and body measure 453px wide. Navigation, the Run identifier and several existing controls/text ranges extend beyond the viewport.

The same strict 12-cell browser fixture compared signed main `0f6c325becf3e3e0562ae69dfae2c42bcf1d7129`-equivalent web bytes with the #416/#420 candidate `2231400e7986f349376d7c19ebd62ae71f7708a4`:

| Viewport / text scale | Main-equivalent document/body width | Candidate document/body width |
| --- | --- | --- |
| 1440px / 100% | 1440px | 1440px |
| 1440px / 200% | 1440px | 1440px |
| 320px / 100% | 320px | 320px |
| 320px / 200% | 453px | 453px |

Each cell covers sequence10593,123456 and123456789012345. At320px/200%, qualified out-of-viewport text ranges are31 on baseline and26 on candidate. The Run ULID's right edge is427.8125px at scrollX25 in both (about453px document coordinates); Menu, retained Activity text, existing controls and version text also contribute. Range counts are observations, not an attribution of every range to an independent root cause.

The #420-specific sequence/type overlap improves from one overlap in every baseline sample to zero in every candidate sample. Neither build clips sequence/type text in these samples. Therefore the global reflow failure is retained separately from that scoped fix; the strict whole-page test still failed and is not relabelled a pass.

Reproduce with a long, populated run at320px, enlarge computed CSS font sizes2x, visit the inspector and measure body/document scrollWidth plus paintable text ranges. Cover normal/enlarged text and both320/1440px. Include long identifiers and the navigation/control sections, not just Timeline rows.

Acceptance:
- Main-page controls and prose remain reachable and readable at320px with200% text, without horizontal document overflow.
- Long identifiers wrap or use a deliberate contained presentation; preserve their full value and copy/access behavior.
- Keep Timeline number/type separation, accessible names, keyboard order, focus and single-tab-stop behavior.
- Record native screenshots, geometry and keyboard checks with positive and negative long-content cases; preserve source/build provenance.
- Actual Claude Code owns UI design/implementation, with independent GPT review and QA and unchanged repository coverage/CI gates when admitted.

Duplicate check on2026-11-23: all-state searches for reflow, horizontal/enlarged text, inspector reflow and ULID overflow; inspected closed #41 (broader historical responsive work) and closed #380 (a different expanded Node progress long-value defect). No open issue found for this exact inspector320px/200%-text case. This is not a request to reopen those completed deliveries.

Evidence retained for the originating delivery: `i5-416-420-browser12-execution-01` and `i5-416-420-baseline-g1-execution-01`, including two raw failure reports,24 measurement/screenshot pairs, source/build bindings and the aligned comparison. These will be linked from the originating PR's retained QA archive. The baseline used a verified retained H2 build with shipping source equal to main, identical font bytes, and a separately bound API/test harness equal to main; it is not misreported as a fresh main build.

Reason deferred: the failure exists on the release baseline and spans app-level reflow beyond the bounded #416 availability and #420 event-number change. The original strict evidence remains available for this follow-up and for final owner decision review.

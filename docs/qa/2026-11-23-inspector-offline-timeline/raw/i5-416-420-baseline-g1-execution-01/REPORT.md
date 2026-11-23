# Strict G1 baseline comparison

The single unchanged G1 case ran once from 11:36:43.199 to 11:36:56.170 UTC with one worker, no retries and the existing deadlines. It exited 1 after recording all 12 samples, their 12 PNGs and one trace. The baseline uses the verified H2 web build equivalent to signed base `0f6c325b` for shipping source and build inputs, served through the Git-equivalent development-source API harness at `2231400e`. The original native candidate evidence remains separate. [Command](baseline-g1.json) · [Raw reporter](browser-results.json) · [Build and API identity](BASELINE-WEB-MANIFEST.json) · [Result](RESULT.json)

## Per-sample comparison

Widths below are document/body scroll widths in CSS pixels. The three overlap measurements in each row are for the 5-, 6- and 15-digit sequences respectively. Every baseline measurement had one sequence/type intersection, and every candidate measurement had zero. Neither build had sequence/type clipping in any sample. Computed sequence/type fonts were 12/12.5 px at normal scale and 24/25 px at enlargement in both builds. [Exact 12-cell comparison](G1-COMPARISON.json) · [Baseline matrix](geometry/real-geometry-matrix.json) · [Candidate matrix](../i5-416-420-browser12-execution-01/geometry/real-geometry-matrix.json)

| Viewport and text scale | Baseline/candidate document and body widths | Baseline overlap widths for 5 / 6 / 15 digits | Candidate overlaps | Outside text ranges per sample, baseline → candidate |
| --- | --- | --- | --- | --- |
| 1440 px, normal | 1440/1440 for both | 5.203 / 12.406 / 77.203 px | 0 / 0 / 0 | 0 → 0 |
| 1440 px, 200% | 1440/1440 for both | 48.406 / 62.813 / 180 px | 0 / 0 / 0 | 0 → 0 |
| 320 px, normal | 320/320 for both | 5.203 / 12.406 / 77.203 px | 0 / 0 / 0 | 0 → 0 |
| 320 px, 200% | 453/453 for both | 48.406 / 62.813 / 180 px | 0 / 0 / 0 | 31 → 26 |

The largest baseline global range was the Run ULID, ending at 427.8125 px in viewport coordinates and about 453 px in document coordinates at `scrollX: 25`. Its candidate endpoint was the same. Both runs report the Menu label ending at 335.75 px, the delete-ready review at 353 px and withdrawal at 359.625 px. Resume guidance, the retained-activity note, version context and row descriptions also contributed horizontal ranges. Whole-page width overflow at 320 px with doubled text is reproduced in the baseline. The candidate removes the measured Timeline sequence/type intersections and reports fewer outside text ranges, while the strict whole-page oracle still fails. [Baseline diagnostics](geometry/real-geometry-matrix.json) · [Candidate source comparison](../i5-416-420-browser12-execution-01/G1-SOURCE-LOCATORS.json)

The 223 API source, linked index, dependency pins, three core files and five overlays matched before and after, including the closed 63-case component overlay. The retained H2 dist and original candidate dist matched their build manifests. The owned baseline dist was restored. No build, retry, B3 materialization, source edit or product acceptance followed from this run. [Adopted B1 closure](ADOPTED-B1-CLOSURE.json) · [Before](BROWSER-BEFORE.json) · [After](BROWSER-AFTER.json)

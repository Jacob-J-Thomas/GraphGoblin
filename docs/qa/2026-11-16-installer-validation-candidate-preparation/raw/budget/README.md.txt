# #436 candidate hosted matrix budget proposal

Preparation only. Run 895 attempt 2 completed the old-source 32-case native matrix in 304.7677105 seconds against its 310-second scheduling limit. The final three installer calls received clipped 23-, 16- and 8-second waits. A fresh candidate adds a bounded private validation call on installs that reach staged publication. It also stages native artifacts and performs ordered final publication. The candidate product timing and private argument remain unmeasured until the actual reviewed source is frozen. [Baseline timing receipts](../launcher/436-hosted-baseline-retry/timing-readback.json) · [Approved candidate stages](../launcher-436-readmission-preparation.md)

## Bounds

| Boundary | Baseline | Proposed candidate |
| --- | ---: | ---: |
| Driver scheduling | 310 s | 450 s |
| Supervisor wait on direct driver | 335 s | 475 s |
| Maximum per direct driver child | 25 s | 25 s |
| Driver child pipe close | 5 s | 5 s |
| Supervisor child pipe close | 10 s | 10 s |
| Full supervisor workflow step | Remaining Windows job time | Remaining Windows job time |
| Existing Windows job | 20 min | 20 min |

The baseline's 49 direct child birth-to-exit intervals sum to 47.34846 seconds. That includes 32 installer calls (median 0.944 s and maximum 1.356 s), 15 seed installs (median 1.194 s and maximum 1.423 s) and two bootstrap calls. About 257.419 seconds elapsed outside those intervals, covering driver work and process/receipt boundaries. The proposed schedule adds 145.232 seconds to the measured runtime and preserves the 25-second outer tail margin. Across 47 installer calls that is an aggregate allowance equivalent to about three seconds per call if spent entirely inside those children. It also accommodates variation in hosted filesystem, native link and listener readback time. Treat this as a bound, with actual candidate timings and first overruns attributed from the new receipts.

The ordinary Windows suite took 171 seconds on the accepted run. With its measured pre-matrix time and observed supervisor overhead, a candidate consuming the entire 450-second scheduling budget would bring the job to about 13 minutes. If every supervisor child used its maximum, the subprocess waits total 840 seconds including two 120-second binders, two 10-second canaries, the 475-second driver, the 45-second decoder and six 10-second close allowances. The full supervisor workflow step also covers trace setup, query and stop, XML correlation, receipts and other in-process work. Its workflow uses the remaining time under the 20-minute Windows job limit. That job limit also covers earlier setup, build, the ordinary native suite and later archiving.

The exact same 32 cases and PowerShell 7 invoker stay in the driver. Each child wait remains bounded by the lesser of 25 seconds and the remaining schedule, with the existing minimum launch margin and 50-call guard. The supervisor still requires exactly 49 direct receipts. The product's private processes are traced as descendants of existing installer children. Before the candidate admission, read the actual private/compiler timeout and command path against the per-child limit. A timed-out child or an incomplete matrix remains a failed first attempt. Windows PowerShell 5.1 product regression and post-mutation rollback each need their separate reviewed observations. [Independent rollback preparation](../launcher-436-rollback-preparation/README.md)

The observer retains the 32 MiB sequential cap, one-second flush, actual loss counters and exact session/canary checks. The baseline recorded 304 64 KiB buffers over about 305 seconds. At that observed rate a 475-second interval would use about 29.7 MiB. This is a projection. Additional process activity can fill buffers faster. Any cap hit, loss or ambiguous lifetime makes the witness incomplete and leaves its raw evidence. [Baseline trace disposition](../launcher/436-hosted-baseline-retry/README.md)

## Candidate admission

1. Freeze the reviewed product commit and tree as a descendant of the exact post-#435 target. Include the production changes, permanent regression, relevant docs, the accepted prerequisite evidence packets and #435 register append in the frozen product commit as reviewed. Keep the temporary workflow and execution preparation in a separately reviewed commit. Bind that product commit, actual GitHub synthetic merge SHA/tree/parents, installed tools, successful fresh build and exact product-to-merge diff. The existing candidate binder already separates the target base from the reviewed product ancestor.
2. Materialize the two fixed-member packets from byte-preserved QA archives. Preserve both seals and original evidence. Keep every carrier path explicit, including the workflow and reviewed preparation/evidence paths under `docs/qa`. The binder rejects application, package, script, tooling and core build config paths from this carrier diff. Bind the actual candidate validator argument from reviewed source, never the template placeholder. Verify its exact descendant evidence in each supported-route case, including `-NoShortcuts`.
3. Verify the native seal in the binder literal, admission example, carrier example, instantiated workflow and actual admitted native manifest. Verify the execution seal and all six native and ten execution members in the staged index and materialized packet. The admitted candidate output name, phase, actual product/source IDs and validator argument must match the rendered workflow and upload paths. The ordinary Windows and other CI gates retain their existing behavior. Archive only the owned evidence/supervisor/control paths.
4. Admit one candidate attempt only after inspecting its exact source and composed packet. Require all 32 dispositions, closing binding equality, actual child and closure records, native file and process proofs, and the separately authorized rollback observation. Publish the final candidate evidence and remove the temporary CI carrier after verifying product bytes match the tested candidate. No candidate execution or GitHub mutation was performed by this preparation.

[Prepared driver](native/README.md) · [Prepared supervisor and binder](execution/README.md) · [Static budget/coherence witness](coherence-readback.json)

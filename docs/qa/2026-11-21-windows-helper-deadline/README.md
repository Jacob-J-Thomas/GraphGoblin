# Windows helper caller-deadline correction

This archive records the F5 correction for [#459](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/459) and [PR #541](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/541). Tested source is `184c95ac2d08590e258c084723eb9ab379f0bbe5`, tree `404700711621832629aef6d505b69076972474da`, sole parent `c6f08d4a62c1488690096f69f577a68c6d382cbc`, against main `47ca4640793a81efa5bec661dba25627de314774`.

The [third general audit](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/541#issuecomment-7058520258) returned **CHANGES REQUIRED**: preparation before a fresh helper stopwatch could extend a held retry into the cleanup reserve. [D167](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/459#issuecomment-7058549018) selects one monotonic absolute cutoff carried through preparation, native creation, validation and ownership-result consumption. Equality expires. Initial identity and ownership checks each retain 15 seconds; a retry expires at the earlier of admission plus 15 seconds and the release deadline minus two seconds. The strict ownership parser and separate cleanup deadline retain their behavior.

## Independent behavior QA

A fresh actual Claude Code Opus 5.5 xhigh session returned **PASS** for the exact source and target above. It compiled its own production source and harnesses in a separate checkout. The [independent packet](independent/README.md) preserves the original report provenance, observed results, source and assembly bindings, and explicit publication projections.

| Check                                        | Actual result                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| Independently designed deadline cases        | 11/11 cases; 79/79 assertions                                              |
| Independently designed native control groups | 6/6 groups; 97/97 assertions                                               |
| Unchanged frozen F3 ownership replay         | 16/16 CONFORMS; 176/176 per-case controls; 88/88 corrected-contract checks |
| Selected maintained bounded-log group        | 9/9 TAP tests: one parent and eight subtests; no skips                     |

The audit's 50 ms preparation plus 225 ms work example refuses when only 250 ms were admitted; the 50 + 199 ms positive control succeeds. This uses the real production deadline seam with a controlled clock and real helper processes. It is not an OS scheduling-race reproduction or an execution of that timing scenario against the held source. A separate real-clock case refused after 619 ms against a 600 ms cutoff and prevented the helper's later completion marker.

Ordinary native controls establish timely held-to-free admission, no new helper when time is insufficient, retained held guidance after a stalled retry, expired entry with no child marker, and the initial identity cap. A disposable real gateway survived launcher exit, was reused warm with the same PID and identity, and stopped through its ordinary shutdown API; an unrelated sentinel survived. Fixture gateway markers in other cases establish only startup admission. The F3 replay retains all seven expected differences from the original held-source prediction; they are not erased or relabelled as failed corrected-contract checks.

## Original failures and scope accounting

The [author packet](author/README.md) retains both its failed native compiler attempt and corrected 9/9 result, separate compiler-command error, 40/40 recorder tests with module-only coverage, and individually named static gates. The author's direct `--work-deadline-checks` mode contains 11 logical scenarios. Expired-entry and validation-equality checks belong separately to `HelperChecks`; they are not extra scenarios in that direct mode. The maintained group's nine TAP tests are a third denominator.

[D168](context/decision-168.original.txt) records the coordinator's administrative disposition. The independent session executed six new native groups **plus** the separately permitted maintained group: seven groups total, exceeding the brief's six-total wording. The extra group is retained explicitly as a bounded scope variance; it exercises already authorized F4 and protocol controls in disposable resources. This does not add a general review or waive a technical gate.

The coordinator subsequently read both original compiler-command batches. Each failed for all three intended assemblies: **two failed batches, six failed compiler invocations and two setup invocation adjustments**, with zero fixture-source corrections and no behavioral case failures. The first batch suffered Git Bash switch conversion; the second still had source-path failures and a consequent missing-assembly error. The Node build adapter then compiled successfully. All setup attempts preceded the frozen harness and behavioral execution.

[D169](context/decision-169.original.txt) corrects the original report and D168's earlier undercount, and explicitly admits the second pre-freeze setup adjustment. No product source, fixture expectations or test thresholds changed. The subsequent official builds and actual tested assembly hashes remain verified. The F3 driver's own zero setup-fault result retains its separate scope. Original report, decision and provider bytes remain unchanged and distinguishable from this correction.

## Evidence limits and remaining gates

The real `ReadHelper`/`StoreHasLiveOwner` wiring, final consumption check and held-retry late-free mapping are source integration plus the compiled seam. No controlled scheduling or kernel race was injected. Charging synchronous OS calls on return is source evidence; native delayed creation was not exercised. The initial ownership 15-second cap has component and source evidence; the native 15-second observation covers identity only. The maintained F4 decision controls and ordinary confirmed cleanup passed, while unconfirmed-cleanup mapping, pending-I/O transfer and Win32 faults retain their earlier limits.

The earlier 23 PASS / 0 FAIL / 8 LIMIT result, C14/C25–C31 limitations and failed local aggregate checks retain their original scopes. Visible error-dialog QA remains **NOT PERFORMED**. No owner store, live personal gateway, GUI acceptance, additional provider turn or deployment is established here.

All three general scans remain consumed, and the original third verdict is preserved. The existing D-035/D-042 path still requires scoped Fable correction review, fresh exact-head/current-target CI with coverage and canonical native-artifact verification, and an explicit coordinator completion disposition before signed merge. This archive records behavior evidence; it is not a fourth scan, renewed Astra sign-off, merge approval or owner acceptance. PR #460 remains held, #543/#544 remain parked, and consolidated owner decision review and any requested rework precede owner QA.

The archive manifest binds every included byte. Nested author evidence is copied unchanged; the independent publication projection identifies any omitted or edited private material and both original and published hashes. Older archives remain unchanged and retain their own source bindings.

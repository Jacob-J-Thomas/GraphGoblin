# Intent 1 CI evidence for #488 and #496

These packets preserve the original author implementation, independent QA, read-only performance diagnosis, and two hosted controls. The implementation and QA packets describe the original candidate based on `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1`. The correction packet records the three accepted QA findings and their author verification; independent follow-up and hosted results remain separate gates.

| Packet                                                                                           | Evidence                                                                                         |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| [Original implementation](../2026-11-17-ci-intent-1-implementation/README.md)                    | Source bindings, local gates, native Windows outcomes, and fan-in controls                       |
| [Independent QA](../2026-11-17-ci-intent-1-independent-qa/README.md)                             | Three accepted findings on the original candidate and separate native controls                   |
| [Author correction 01](../2026-11-17-ci-intent-1-correction-01/README.md)                        | Corrected source bindings, retained red/green controls, regressions and first full coverage pass |
| [Independent correction QA](../2026-11-17-ci-intent-1-correction-independent-qa/README.md)       | Original regressions pass, two evidence-consistency controls fail, and hosted-overlay provenance |
| [Author correction 02](../2026-11-17-ci-intent-1-correction-02/README.md)                        | Run identity and rejection accounting corrections, author verification and genuine native replay |
| [Independent correction 02 QA](../2026-11-17-ci-intent-1-correction-02-independent-qa/README.md) | Both remaining evidence-consistency regressions fixed and retained native evidence revalidated   |
| [Prepared hosted controls](../2026-11-17-ci-intent-1-hosted-controls/README.md)                  | Seven workflows verified locally, hosted execution pending                                       |
| [Performance timeout recurrence](../2026-11-17-ci-intent-1-perf-timeout-recurrence/README.md)    | First local tooling failure, two later passing runs, and read-only fixture evidence              |
| [Hosted uploader control](../2026-11-17-ci-intent-1-496-uploader-control/README.md)              | Synthetic marker uploads, downloaded ZIPs, and hidden-directory filtering                        |
| [Hosted baseline probe](../2026-11-17-ci-intent-1-496-baseline-probe/README.md)                  | Native baseline pass, fixture metadata before upload, and zero archives                          |

Each publication manifest maps the retained source paths to the archived names, byte counts, and SHA-256 hashes. The hosted control branches must never merge. The controls explain the historical #496 upload failure. The corrected runner’s positive and negative exports, exact-head hosted gates, formal review, and final audit require separate records. The dependency audit blocker remains tracked in [#503](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/503).

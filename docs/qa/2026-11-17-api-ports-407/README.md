# #407 API subprocess port evidence

| Packet                                                                                       | Evidence                                                                                   |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [Original implementation](../2026-11-17-api-ports-407-implementation/README.md)              | Reproduced the two-worker port collision and checked the first reservation design.         |
| [Original independent QA](../2026-11-17-api-ports-407-independent-qa/README.md)              | Preserved the Windows wildcard and contention failures.                                    |
| [Author correction](../2026-11-17-api-ports-407-correction-01/README.md)                     | Preserved the correction, rejected prototypes, and author verification.                    |
| [Independent correction QA](../2026-11-17-api-ports-407-correction-independent-qa/README.md) | Verified the corrected behavior in one native Windows witness.                             |
| [First normal PR #507 CI](../2026-11-17-api-ports-407-pr507-ci-01/README.md)                 | All coverage floors and platform jobs passed; Gates failed at the dependency audit.        |
| [First hosted POSIX control](../2026-11-17-api-ports-407-hosted-posix-run-01/README.md)      | macOS reproduced the wildcard grant. Ubuntu passed all maintained and witness cases.       |
| [Darwin correction](../2026-11-17-api-ports-407-darwin-correction-02/README.md)              | Extends the existing Windows probe list to macOS and retains the Windows regression check. |

The corrected Windows witness passed 8/8. The first hosted macOS lane passed 11 of 13 maintained cases and 1 of 2 witness cases. The Darwin correction's hosted control and full CI require fresh exact-head results. Formal review and the final audit have separate delivery records.

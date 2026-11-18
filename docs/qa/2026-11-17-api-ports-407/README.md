# #407 API subprocess port evidence

| Packet                                                                                       | Evidence                                                                                 |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [Original implementation](../2026-11-17-api-ports-407-implementation/README.md)              | Reproduced the two-worker port collision and checked the first reservation design.       |
| [Original independent QA](../2026-11-17-api-ports-407-independent-qa/README.md)              | Preserved the Windows results that found D1 wildcard conflicts and D2 contention errors. |
| [Author correction](../2026-11-17-api-ports-407-correction-01/README.md)                     | Preserved the correction, rejected prototypes, and author verification.                  |
| [Independent correction QA](../2026-11-17-api-ports-407-correction-independent-qa/README.md) | Verified the corrected behavior in one native Windows witness.                           |

The original QA findings and first failures remain part of the record. The corrected Windows witness passed 8/8. POSIX checks, including the unverified macOS wildcard hypothesis, require separate evidence. Formal review and the final audit have separate delivery records.

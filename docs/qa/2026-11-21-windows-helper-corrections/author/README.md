# #541 D166 author evidence subset

Read [REPORT.md](REPORT.md) for author results and explicit evidence limits. This package is not independent QA or a merge sign-off. Its source identity is frozen at `37803eeef9f55c2a316289aa502798025a7873be`; source-binding fields describe the author handoff, not a new live checkout inspection.

| File                              | Role                                                                      |
| --------------------------------- | ------------------------------------------------------------------------- |
| `REPORT.md`                       | Formatted author verification and retained limitations                    |
| `command-outcomes.json`           | Curated terminal command/results and focused coverage denominator         |
| `protocol-cases.json`             | Unchanged 30-case declaration                                             |
| `source-binding.json`             | Unchanged source/tree, patch and native-binary hash metadata; no binaries |
| `native-focused.projection.log`   | Scrubbed focused native TAP projection                                    |
| `native-log-transformations.json` | Original/projection hashes, sizes and explicit byte replacement           |
| `MANIFEST-SHA256.json`            | Deterministic per-file hashes/bytes/UTF-8 declaration, excluding itself   |

The original native log is preserved in the private author evidence; its digest/size are retained here without copying its host path. Private planning files, environment/argument dumps, binaries, generated coverage HTML and repetitive build logs are excluded. Original failures and independent evidence are neither rewritten nor replaced by this subset.

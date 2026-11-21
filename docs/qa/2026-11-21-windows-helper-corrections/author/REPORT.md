# D166 correction: author verification

This is an author evidence subset for commit `37803eeef9f55c2a316289aa502798025a7873be`, tree `647d297990837f7f21e0054c5be15a0109fab2f1`, correcting F3/F4 on parent `2164cd11624c88d66ae64d1ac86ae26505a6c1ea`. PR base is `47ca4640793a81efa5bec661dba25627de314774`. It is separate from independent QA, review, hosted CI and owner acceptance.

The local commit changes nine scoped files, 340 insertions and 23 deletions. It implements single-pass strict ownership JSON validation before trimming and cleanup credit only for a complete observation before 2,000 ms. Identity padding, job/pipe ownership, byte limits, work budgets, retained-held guidance and privacy remain. No new dependency, compatibility path, register/archived-QA change or #543/#544 work is included. The author made no push, publication, merge or general-review request.

## Terminal verification

Every result below is a terminal exit 0. Command summaries and original log hashes are in `command-outcomes.json`. The selected runtime was Node 22.23.4.

| Verification                                                                    | Observed result                                                                      |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Build                                                                           | 12 tasks passed                                                                      |
| Maintained compiled native bounded group                                        | 9/9 tests passed, including eight subtests; 134.290 s                                |
| New ownership admission controls within that group                              | 30 cases: 23 invalid, three valid-free, two valid-held, two retained-held retries    |
| Shared cleanup decision controls                                                | Six deterministic compiled controls passed                                           |
| Focused evidence-module unit/coverage run                                       | 40/40 tests passed; 99.47% lines, 97.38% branches, 98.97% statements, 100% functions |
| Typecheck / lint                                                                | 21 / 13 tasks passed                                                                 |
| Layers, migrations, tokens, deps, licenses, templates, contrast, generated docs | Each passed                                                                          |
| Changed-file formatting and diff whitespace                                     | Each passed                                                                          |

The focused coverage denominator is **only** `tooling/scripts/windows-launcher-evidence.mjs`. The existing 90% thresholds for lines, branches, functions and statements were retained; repository thresholds/exclusions were not changed. This result is not the full tooling-package or monorepo coverage gate. Known failed broad local aggregates were not repeated without a relevant cause; exact-head hosted gates remain required.

## Native observations and their limits

The compiled public launcher ran with disposable helper/main protocol fixtures. Malformed syntax, duplicate decoded names, wrong shapes, trailing material, invalid escapes and non-JSON outer whitespace refused startup. Valid producer JSON, legal JSON whitespace, reordered/escaped fields and Unicode paths were accepted. A controlled main-entry witness appeared only for valid-free cases and then exited 75; it was not a real serving gateway. Invalid/held cases left the witness absent. Assertions checked original lock/guard bytes and filesystem identities, decoded held paths, held retry guidance and synthetic-canary exclusion from public output/logs. `protocol-cases.json` lists the unchanged authored case set and expected classifications; the passed loop establishes the assertions, not separately retained raw records for every case.

The native C# production/test bytes were unchanged after this run and normalize to the committed source blobs. **The run preceded commit, and test JavaScript was subsequently Prettier-formatted only.** `source-binding.json` preserves this boundary and the executable hashes. A fresh immutable-head independent QA/CI pass is a separate gate.

The six cleanup controls exercise the actual shared production decision with a deterministic observation/clock seam at 1,999/2,000/2,001 ms, including a poll crossing the deadline. They prove decision ordering and the strict cutoff. They do not demonstrate delayed kernel termination, delayed cancellation completion, an actual late native cleanup race or a newly observed `helper-cleanup-unconfirmed` kernel event. Ordinary helper/descendant and log/gateway controls in the selected maintained group passed separately.

The author lane did not reproduce the original findings on the prior head. Baseline source facts and parent-owned independent baseline/candidate observations are not reclassified here.

## Prior limits remain

- Earlier local aggregate failures remain retained separately: Windows symlink/POSIX-mode fixture limits, unresolved SQLite EBUSY cleanup, a browser measurement CLI timeout and an unexplained identity-child failure. They are not all assigned a proven host cause or erased by these scoped passes.
- These ownership fixtures do not supply a new real-WMI four-path negative matrix, first-WMI-after-boot provenance, WMI-service/provider witness or full supported-host/platform matrix. Earlier UI-only nesting-refusal and setup-failure observation limits are unchanged.
- Original record preservation is not an adversarial live replacement-owner race. No such race is established by this subset.
- Managed presentation checks are not visible error-dialog pixels. No Computer Use workaround or new kernel/permission/race experiment was performed; the visual gap remains.
- D160–D165/D166, the separate #460 hold, independent QA/review/CI gates, owner decision/QA and the three-total-general-scan budget remain. The parent owns those gates and any later publication or merge.

## Projection provenance

`native-focused.projection.log` is a **scrubbed projection, not the raw original**. One JSON `artifacts` location value was replaced with a neutral fixture label; all other bytes, including line endings, are unchanged. `native-log-transformations.json` records the original SHA-256/byte count, projected SHA-256/byte count and exact transformation. Original evidence remains preserved outside this publication subset.

The subset contains no binary, generated HTML coverage, repetitive build log, private proposal or raw environment/argument dump. `source-binding.json` and `protocol-cases.json` are byte-identical copies of the already safe author evidence. The manifest is deterministic, excludes itself and binds every included file. All included files are UTF-8.

# Administrative clarification of the #362 case count

The original [REPORT.md](evidence/REPORT.md) at line 23 and [provider final message](evidence/provider/provider-final-message.md) at line 3 say “64 PASS” / “64 pass.” Those original bytes and hashes are preserved. Their PASS total is overstated by one relative to the machine observations.

The exact accounting in [observations.json](evidence/observations.json), reproduced from all saved raw inputs, is:

| Kind | Result | Records |
| --- | --- | ---: |
| acceptance | PASS | 33 |
| control | PASS | 22 |
| discriminating-control | PASS | 2 |
| supporting | PASS | 6 |
| adjacent-pre-existing-observation | OBSERVED-AS-PREDICTED | 1 |
| **All kinds** | **63 PASS + 1 OBSERVED-AS-PREDICTED** | **64** |

The adjacent record is `H1-heartbeat-script-probe-cmd`. It observed the predicted pre-existing internal runner token in heartbeat probe output. It is not a script-node acceptance PASS and must not be relabeled one. The six supporting records aggregate existing focused unit-test evidence; they are separate from the 33 acceptance records, and a supporting record can contain multiple command invocations.

The [administrative replay script](replay-case-accounting.mjs) reads the **unchanged original** `fixtures/build-observations.mjs` bytes and evaluates them in a VM with confined evidence reads and an in-memory intercepted output write. It does not load product modules, execute fixtures, start processes, call providers or rerun tests. Every field of every one of the 64 cases—expected, actual, kind, tier, result and evidence paths—matches the original observations. Only the newly generated timestamp is ignored. Each case's referenced selected evidence is also present and hashed in [case-accounting-replay.json](case-accounting-replay.json). The original builder console summary is retained there.

This is an accounting clarification, not a waiver of an assertion, acceptance criterion, discrepancy or engineering gate. No original outcome was edited, and no product behavior was newly established by the replay. There are zero recorded `FAIL` cases, plus one adjacent observation with its own distinct result type.

The report's O1 (internal token exposure through non-script-node probes), O2 (batch-file actionability) and O3 (test gaps) remain for explicit coordinator disposition. This note does not close them, close #362, accept a change for merge, or replace opposite-family review, the fresh independent Astra MAX final audit or current-target native-Windows CI. The packet's public summaries must use the typed counts above.

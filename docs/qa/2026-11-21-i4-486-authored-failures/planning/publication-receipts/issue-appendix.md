## #486 selected written plan and public evidence — D188

The coordinator selects immutable architecture revision 03 **with the A1/A2 amendments below**, after actual Claude Fable 5.2 xhigh returned **ACCEPT REVISED PLAN**. This is the owner's delegated blocker-decision route recorded in D188; it supersedes the generic manual plan hold for this bounded admission. It is not human `plan-approved`, owner QA sign-off, or completed engineering delivery. Owner review/rework of delegated decisions remains due before owner QA.

The five original documents retain their original bytes and historical “pending” wording. Relative filenames/source/probe links inside them refer to the retained local packet; the public comment mapping is:

| Original revision 03 member | Full public text |
| --- | --- |
| `README.md` | [Plan overview](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/486#issuecomment-7061823595) |
| `boundaries.md` | [All 26 boundary decisions](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/486#issuecomment-7061823961) |
| `expression-provenance.md` | [Evaluator provenance and alternatives](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/486#issuecomment-7061824217) |
| `verification.md` | [Verification and delivery handoff](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/486#issuecomment-7061824554) |
| `critique-disposition.md` | [R1–R6 / S1–S6 dispositions](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/486#issuecomment-7061825006) |

The packet binds source `02351e2fb932b3be44e7cc3fb3943a61d568226c`, tree `d289bb12b943557584c5659bc33447d1baebc2f6`, and architecture SHA256SUMS `1785227456c24297a90e68f96c18156e583f797d066c5363d5a8f3a3ce52728c`. Local source/probe/dependency inputs remain retained provenance; they are not all published as issue comments.

- [Actual Fable 03 report, verbatim](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/486#issuecomment-7061825341) — genuine successful provider terminal, exit 0, `claude-fable-5-2` / `xhigh`; SHA-256 `8a1c4fb12687d395daedfa59a099fe1779e93b6c675b2239cc0f6f035fc5243f`.
- [D188 selection and alternatives, verbatim](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/486#issuecomment-7061825658) — SHA-256 `5f67b74aeed4b0abaf3eb39aefe35e1c28611b1bd20133442ac49bacc1aacca6`.
- [Historical Fable 01 REVISE PLAN, verbatim](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/486#issuecomment-7061825963) — applies to revision 01 and remains history.
- [Attempt 02 quota history](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/486#issuecomment-7061826279) — provider exit 1 / `is_error=true`, no planning verdict. Its original quota message remains retained.

### Selected amendments over the unchanged revision 03 text

A1 selected verbatim clarification: Compile and unsafe-regex reasons attach only to the top-level compile(expression) of the invocation's own pinned source. The same checks reached through CHECKED_EVAL fail a run-time string inside the evaluator call and yield only the neutral evaluation-rejected fact. Add explicit tests for malformed and unsafe-regex $eval strings. Do not attribute their syntax to the successfully parsed authored field. Direct engine compile/unsafe-regex negative cases may bypass publish validation and must be labeled synthetic reachability.

A2 selected: At the newly typed JSONata sites the evaluator's own message is neither published nor logged, as at B20. Confirm removal of that old internal-fallback private record at those sites; update the affected docs05 diagnostic row and ADR0088. Fixed safe field/cause/action remains public. Existing harness/provider text, historical rows, P01/P02/B20/B25 and unrelated private diagnostics retain their contracts. Other new local diagnostics follow the selected bounded correlation policy. This is a scoped logging change, not a claim that all existing logs omit raw text.

### Implementation roles and retained gates

D188 escalates shared/core evaluator architecture plus inference/child integration to **`gpt-6.2-astra`, xhigh**. **`gpt-6.1-sol`, xhigh** handles bounded workspace, leaf-handler and public-child test tasks after the actual shared interface is frozen. The existing Sol issue label remains unchanged and describes bounded routing; it does not downgrade the selected Astra core role. Routing packet SHA256SUMS: `b00df574b3171926a0c953f8bab8fe53f63ea30f296207ccf4864b3f92972710`.

Exclusive file ownership, root-only index/commit/gates, actual Claude Opus xhigh opposite-family implementation review, independent touched-system QA, existing numerical coverage, current-head/current-target CI, the three-general-scan cap, reserved fresh Astra MAX final audit and signed merge remain required. Fable planning critique satisfies neither implementation review nor QA. Native filesystem, disk SQLite/restart, script counters, loopback HTTP and REST/MCP/browser evidence must stay distinct from scripted provider evidence. No implementation or acceptance result is claimed by this publication.

After all nine public comments were freshly read back byte-identically, admission removes **only** `needs-plan-approval`, retains `aidlc-ready` and every other label, and adds no `plan-approved` label.


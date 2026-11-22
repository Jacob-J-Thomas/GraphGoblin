# D203 author correction: bounded Claude refusal diagnosis

Implemented the final3 F3 liveness correction in exactly five unstaged paths. A genuine
no-PID refusal now starts a private absolute monotonic 1,000 ms diagnostic budget,
including a default turn whose request timeout is null. Expiry returns the actual
spawn code with unknown cause and definite non-submission. It does not invent timeout,
cancellation or missing-path facts. Fast metadata keeps its existing fixed cause.

Source remains uncommitted at HEAD `580aded6d295061897b047ac16811e5da230d9e0`,
tree `49f4ae66198c4699867cab6c4f95c9ab4bf863b7`. There is no candidate commit/tree
claim. Source ownership is released to root at this freeze.

| Changed path | Purpose |
| --- | --- |
| `packages/infrastructure/src/claude/process.ts` | Bound only optional refusal diagnosis; check the monotonic deadline before lookups, metadata acceptance and timer settlement; clear the timer through the existing finish path. |
| `packages/infrastructure/src/claude/process-failure.test.ts` | Maintain public default-turn liveness, late success/rejection immutability, no follow-on reads, cleanup, delayed event-loop acceptance, timely cause, shorter deadline/abort and normal started-process controls. |
| `docs/06-harness-integration.md` | Describe the private budget, conservative fallback and native-stat cancellation boundary. |
| `docs/decisions/ADR-0089-bounded-claude-refusal-diagnosis.md` | Record D203, alternatives, tradeoff and delivery limits. ADR0088 remains reserved. |
| `docs/decisions/README.md` | Index ADR0089. |

No production harness, dependency, lockfile, schema, stored data, owner configuration,
threshold or historical archive changed. Earlier output-loss and help-only corrections
remain in production `harness.ts`. No extra launch, retry, fallback, PATH resolver or
kill of a refused child was added. Already issued native stat operations may finish
later; they are not cancelled by this change. A delayed event loop must resume before
any JavaScript result can be delivered, and cannot make late metadata timely.

## Validation and retained failures

All commands used Node `v22.23.4` from the project-scoped runtime and `pnpm.cmd`.
Task-process TEMP/TMP resolve to `G:\ggq\qa-scratch\i4-364-deadline-author-01`;
machine-global environment and existing frozen/provider paths were untouched.
Exact argv, timestamps, exit codes and original output hashes are in each command's
JSON/log pair. These are author checks, not independent QA.

| Check | Result |
| --- | --- |
| First focused process-failure file | 44/44 pass. |
| Exact old-source control, new public-turn tests only | Expected 2 failures / 42 filtered skips: both finite `terminal === true` assertions fail at 1,000 ms. |
| First full focused Claude run | **304 pass, 2 fail**, retained unchanged. Native help fixtures fail their exact TEMP spelling check; this run is not passing. |
| Direct Node TEMP spelling diagnosis | `dirname(join(tmpdir(), ...)) !== tmpdir()` with the original slash spelling; exact false-equality witness retained. |
| Corrected process-local TEMP spelling, focused Claude run | 306/306 pass across 13 files, including existing native start-refusal, process, harness and previous correction cases. |
| Scoped process.ts V8 diagnostic coverage | Same 306 cases pass; lines 100% (120/120), branches 95.27% (121/127), functions 100% (22/22), statements 97.31% (145/149). |
| Infrastructure typecheck and lint | Pass. |
| Five-path scoped formatting and diff checks | Pass. |

The coverage run overlaps the focused run; it is not an additional independent sample
and does not establish full infrastructure coverage. No full Windows infrastructure
coverage, live model/provider call, API/browser acceptance, installation or full build
was run. Required package typecheck performs its declared TypeScript build/check tasks.
Naturally stalled native filesystem behavior was not observed. Existing native refusal
tests and controlled metadata-delay tests remain separate evidence tiers.

The default public regression runs successful version/help/auth prerequisites through
the real `runClaudeProcess`, then a single refused turn with `timeoutMs: null`, no
watchdog and no external abort. Its required stat remains unresolved through the private
deadline, while a child close is delivered. It checks the exact public fixed failure and
`definitely-not-submitted` event, no kill/retry, no false timeout, timer/listener release
and stable results after both late metadata success and rejection. Additional controls
check absolute-deadline acceptance before delayed timer delivery, early timer recheck,
wall-clock changes, a budget starting at refusal, earlier 15 ms request deadline/abort,
and an unbounded process that actually started. Existing stronger-outcome cases passed.

The old-source control replaced **only** process.ts with the byte-exact clean
`580aded6` version while retaining the authored tests. Both targeted tests failed the
specific finite liveness oracle. The candidate process bytes were restored in `finally`
and then passed the complete focused suite. Original process SHA-256:
`c44ed660f69b7e4999f0d89704818164ca027356b9f4c6b8c4ec99fb827ad322`.
Restored/final process SHA-256:
`4103c271a989d3e2b309771e14d202d59de5392ea0bc36301aefb1b6e9f58fc5`.
See `old-source-control-01.log`, its original exit receipt and
`old-source-restoration.json`. No unchanged product failure was repeatedly retried.

The three distinct instrumentation corrections reached the authorized cap:

1. Stopped the task's initial overbroad inventory of 34,048 historical QA paths and
   narrowed byte checks to the six relevant packets, retaining the complete QA Git
   tree identity and whole-source change scope. No source edits had started.
2. Corrected helper console encoding after the expected old-source failure. The raw
   log and exit receipt were already complete; Python's cp1252 console printing then
   raised UnicodeEncodeError. The old-source run was not repeated.
3. Corrected only task-process TEMP/TMP slash spelling after the direct diagnosis.
   The resolved G path, source and test assertions remained unchanged.

All original helper versions, failed run logs and the exact diagnosis are retained.
`instrumentation-history.json` also records read-only discovery errors and clearly
labels the console trace transcription from the retained tool result. No further
instrumentation or assertion changes were made.

## Freeze and handoff

`frozen-source-receipt.json` gives exact before/after SHA-256 and candidate Git blob IDs
for all five paths. `before-source/` and `candidate-source/` contain one canonical
copy of those respective source bytes; `source.diff` and `new-adr.diff` expose the
complete patch. Input hashes bind the brief, D203, final3 report and repository rules.
The final3 report remains negative at its reviewed revision; it was not rewritten.

The physical index is byte-identical before/after, SHA-256
`d68ad7bc9b0953e359372c21c0be9af8e50ca670e8d17da8da59f2a333fd3a78`;
the staged diff is empty. Final status contains exactly the four modified tracked
paths and one new ADR listed above. All 1,929 inherited archive files retain exact
before/after bytes, SHA-256, Git blob and mode: 158 original #364, 210 correction,
243 #427/365, 339 original #363, 272 corrective #363 and 707 #442. Streaming Git-blob
hashes of all 1,929 current files independently match HEAD. The overall historical
`docs/qa` tree is unchanged; archive payloads were not duplicated into this packet.

`process-release.json` records no remaining matching native Claude fixture processes.
Recorded commands exited; controlled child streams are destroyed by test teardown.
The task's Node compile cache remains local on G and was not deleted. No provider,
server, service or owner application was launched. No stage, commit, push, publication
or other checkout/index/master mutation was performed.

Root retains the final3 hold and remaining delivery gates: actual Fable 5.2/xhigh
corrective review, separate actual Opus 5.5/xhigh criterion QA, fresh exact-head/target
CI/native verification and coordinator D035/D042 completion before any merge. The
native fixture requires canonical Windows TEMP/TMP spelling, which independent QA
must retain. This handoff is implementation evidence, not independent review/QA,
engineering completion, a fourth general scan, merge approval, deployment or owner
acceptance. No owner action is requested by this packet.

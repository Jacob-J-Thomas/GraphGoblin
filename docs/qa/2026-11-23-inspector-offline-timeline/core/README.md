# D236/D240 core cancellation QA and targeted Claude confirmation

This archive binds the original core `30820901e97e2ba3af0e9796b39f14b5d421b99d`
(tree `eab694eaaf05d3698d359f4983872d7c4c08fba1`) to corrected core
`458f6cb06eded5cfeb2cf243093b60521a46f676`
(tree `09b29aabeef6ab7e4c4d53dc4f8d2b3b5444d5d6`, parent `308209`).
It preserves the original failures and the later bounded acceptance. It is
prepared outside the worktree for root insertion after the UI author freezes.
It grants no general PR, UI, merge or owner approval.

## Finding, correction and execution

Actual Fable 5.2/xhigh's original D236 review returned **CHANGES_REQUIRED**.
Cancelling a paused read before its GET, or cancelling between retry attempts,
could restore the previously observed cache revision while retiring its proof.
The same problem affected last-observer removal and offline remount. D240 keeps
revisit behavior in scope and removes only the live-attempt requirement from
the identical-object/count, idle restoration check. It also corrects the loss
comment without changing the latched-outage behavior.
[Original ordinary critique](raw/i5-d236-actual-max-core-review-01/ordinary-handoff.md)
· [Root finding disposition and alternatives](raw/i5-d240-cancellation-correction-admission-01/ROOT-REVIEW-DISPOSITION.json)
· [Canonical D240 rationale/declined alternatives](raw/i5-d240-cancellation-correction-admission-01/decision-240.md)
· [Exact two-path patch](raw/i5-d240-core-freeze-01/correction.patch)

| Executed selection | Old308209 | Corrected458f |
| --- | --- | --- |
| Author's focused provenance file | 22 passed, **3 failed**, no skips | **25 passed**, no failures/skips |
| Independent identical seven-case fixture | 4 passed, **3 failed**, no skips | **7 passed**, no failures/skips |

Both independent behavior invocations were the first at their admitted heads;
no behavioral retry, deadline increase or coverage change erased a failure.
Author formatter-only wrapping and exact before/after test sources are retained.
Full web typecheck, scoped lint and format passed as recorded. The initial
root reader's wrong receipt-field failure remains qualified, without test rerun.
[Author old](raw/i5-d240-core-regression-test-author-01/REPORT.md)
· [Author corrected](raw/i5-d240-core-regression-test-author-corrected-01/REPORT.md)
· [Root author readback](raw/i5-d240-core-freeze-01/AUTHOR-ROOT-READBACK.json)
· [Independent report](raw/i5-d240-cancellation-independent-qa-01/REPORT.md)
· [Root finite QA disposition](raw/i5-d240-root-qa-disposition-01/DISPOSITION.json)

The exact independent fixture survives twice as executed, SHA-256
`ff386e99e6e1c8a31590e6de29551bbe646d7377f433656697b1f96b26e2764c`:
[old fixture](raw/i5-d240-cancellation-independent-qa-01/old/06-executed-fixture.tsx)
· [corrected fixture](raw/i5-d240-cancellation-independent-qa-01/corrected/04-executed-fixture.tsx).
Its **four restoration negatives** retain manual retirement, refusal retirement,
different body-object and different update-count controls. They passed at both
heads and forbid the tested attempts to regain proof. All raw test JSON,
receipts, stdout/stderr, fixture formatting and source/module command summaries
are retained. Root deliberately fast-forwarded the disposable QA checkout
between phases; indexes were unchanged within each phase, not across the rebind.

## Actual named confirmation and authority boundary

Actual Fable 5.2/xhigh then returned **ACCEPT** for B1/S1 on `458f`. It made 18
paired Read operations, no writes and ran nothing. Root verified the exact
source/controls and accepted that named correction; the original negative
report remains unchanged. Both reviews' normal direct-process/stream closure,
terminal and source-after receipts are retained. They prove no account-wide or
descendant inactivity.
[Actual corrected ordinary report](raw/i5-d240-actual-max-core-confirmation-01/ordinary-handoff.md)
· [Root semantic acceptance](raw/i5-d240-max-core-root-acceptance-01/ACCEPTANCE.json)

Cancellation preserves existing evidence; it does not authorize recovery,
raise `committed`, clear the loss boundary or resurrect retired proof.
**`loss` may remain nonzero after recovery: qualifying-read authority requires
`committed > loss`, together with the current run/node/failure/visit/action
identity and all other gates.** `loss > 0` alone does not identify an ongoing
outage. The accepted synthetic limitation remains: an internal caller producing
the same object/count/idle shape can retain existing proof; this is not
universal internal-state forgery protection.

## Continuing gates and evidence limits

**Mandatory:** the helper and tracked provenance tests stay in the ordinary
web unit/coverage gate, including future query/dependency updates. Do not lower
thresholds or exclude them. Dependency updates must re-exercise the applicable
cancellation/provenance contracts. The archived fixture preserves all four
independent negatives as repository evidence; an archival file is not itself
registered as a normal unit-test file.

These are public QueryClient/useRun tests with repository fakes/custom transport
and controlled online state. Real-listener eligibility/RunSnapshotSchema/body
shape and parse cost, UI/actions/Timeline, browser geometry, independent UI
review/QA, complete web/repository coverage/static gates, exact-current CI,
final audit, signed merge and owner review remain. No new general review scan,
provider, live-listener, browser or device acceptance follows from this archive.

## Selection and omitted evidence

[Copy manifest](COPY-MANIFEST.csv) records every physical source/destination,
byte count and SHA-256. Originals are copied unchanged; pending labels in old
reports remain historical and later root dispositions supply bounded closure.
[Source bindings](SOURCE-BINDINGS.json) summarize the exact phases.

The original independent manifest describes 73 members; 68 are physically copied
along with that complete manifest. Four 11.2 MB source inventories and the 3.2 MB
NUL-delimited Git roster remain external with exact original hash descriptors.
**41,003 tracked descriptors are not 41,003 physical hashes:** 39,235 historical
QA entries were sparse-omitted; the original QA/root verified 1,768 materialized
source files. Its corrected report/COMPARISON qualifies the immutable old
packet's shorthand. No omitted inventory is newly hashed by this assembly.

[Omissions and references](OMISSIONS-AND-REFERENCES.json) also identifies the
historical D236 predecessor report/manifest and both public briefs without
copying them or recursively chasing their locators. Provider raw
streams/results/thinking, credentials/auth settings/private material, the
active UI outputs and whole catalogues are excluded. This preparation performs
no worktree, Q, Git/index, provider, test or publication action.

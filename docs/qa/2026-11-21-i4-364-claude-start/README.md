# Claude start-refusal evidence for #364

The bounded independent native and public QA passed for source commit
`99f1de7863dfc6a05b63a9140f7fc7a6833fcb20`, tree
`911b2400b7622b5b04b58b3b03092d9ea90f55a3`, based on
`02351e2fb932b3be44e7cc3fb3943a61d568226c`. This archive preserves the original
author, independent review and behavior QA records. Publication preparation adds
no product change, test execution, coverage result, merge approval or acceptance.

Windows can refuse process start with `ENOENT` when the executable exists but its
working directory is missing, is a file or cannot be used for native start. The
candidate reports a missing executable only when bounded read-only observations
establish that fact. Missing/file turn directories become configuration failures;
ambiguous refusals stay unknown. The same process boundary consumes never-started
pipe errors and keeps started-output loss conservative. [D176](decisions/D176.md)
records the selected behavior, rationale and declined alternatives.

## Original records and attribution

| Record                                                                                                                             | Role and scope                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Author report](author/REPORT.md), [brief](author/BRIEF.md) and [provider terminal](author/provider/result.json)                   | Actual Claude Code Opus 5.5, configured xhigh; original author source, failed attempts, native probes, mutations, logs and provider envelopes retained          |
| [Formal review 1](reviews/review-1/REVIEW.md) and [structured verdict](reviews/review-1/review.json)                               | Prior independent GPT worker code/evidence review: APPROVE, zero introduced blocking or non-blocking findings; no reviewer test execution                       |
| [Independent QA report](independent/REPORT.md), [predictions](independent/PREDICTIONS.md) and [result](independent/qa-result.json) | Fresh behavior/native/public QA context, separate from implementation and formal review                                                                         |
| [Dispatch metadata](dispatch-metadata.json)                                                                                        | GPT 6.1 Sol/xhigh is configured QA dispatch metadata supplied by the coordinator, not a provider terminal; fixture model IDs do not establish provider behavior |
| [Issue readback](live-issue/issue-live.json) and [comments](live-issue/issue-comments-live.json)                                   | Live closure-condition readback used while preparing the draft PR; no issue mutation                                                                            |

The original author report's `committed: false` checkpoint precedes root's
candidate commit. The exact candidate binding above and the independent source
binding preserve that distinction without rewriting the original report.

## Evidence tiers and original failures

These tiers overlap. Their counts must not be added into an aggregate test or
coverage total.

| Execution                               | Recorded outcome                                                                                                               | Evidence                                                                                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native process/runner/harness           | 42/42 predicates passed across eight cases                                                                                     | [Observations](independent/native-observations.json), [fixture](independent/native-qa.mjs)                                                                                             |
| Real built HTTP API, engine and SQLite  | Corrected attempt 55/55 passed; original attempt has one draft-admission fixture error and six setup/cleanup passes            | [Corrected observations](independent/public-attempt2-observations.json), [original failed attempt](independent/public-attempt1-observations.json)                                      |
| Long TEMP/check folders                 | 23/23 passed through native harness and three built API instances                                                              | [Observations](independent/probe-path-observations.json)                                                                                                                               |
| Controlled lifecycle seams              | Original 19/20, with one DOMException predicate error; fresh bounded correction of only that case 3/3                          | [Original observations](independent/controlled-seam-observations.json), [correction](independent/cancel-predicate-correction.json), [repair rationale](independent/FIXTURE-REPAIRS.md) |
| Exact parent-source negative control    | 3/3 control checks: parent falsely reports missing installation for an existing 259-character cwd; candidate oracle rejects it | [Control](independent/baseline-negative-control.json)                                                                                                                                  |
| Author focused Claude checks            | Latest 259 passed / 2 skipped; scoped coverage 99.82% lines / 98.15% branches                                                  | [Author report](author/REPORT.md), [latest focused log](author/evidence/final-focused-checks-2.log)                                                                                    |
| Author aggregate infrastructure attempt | **51 failed / 1,153 passed / 2 skipped**, including 50 symlink EPERM failures and one SQLite EBUSY; no package coverage pass   | [Original failed log](author/evidence/infrastructure-coverage-1.log)                                                                                                                   |

One independent coordinated build succeeded: 12/12 tasks, five cached, Node
v22.23.4. The build slot was released afterwards. Its [log](independent/build.log),
[runtime/source binding](independent/source-runtime-binding.json) and
[1,271-file build manifest](independent/build-artifact-manifest.json) remain
original evidence. No product execution or test was repeated during this archive
preparation.

## Established behavior and limits

The native fixture starts in ordinary and exact 258-character directories. An
existing 259/260-character cwd refuses with no PID and yields TURN_FAILED rather
than an installation claim. At 260 characters, raw native stdout/stderr emit
ENOTCONN; the candidate parent and public API survive. Missing/file turn cwd
refusals are definitely-not-submitted and persist as non-resumable configuration
failures. They stay pinned after repair, with public Resume returning 409.

For an absent absolute executable, the public run is restorable and no actual
turn starts. Restoring the exact configured executable and using observed-sequence
Resume returns 200, succeeds and creates exactly one actual harmless turn across
the scenario. New failure/preflight/recovery diagnostics contain none of the
planted path, prompt, argv or native-error canaries. Authored loop data and local
synthetic markers are not claimed to be globally redacted.

The real filesystem workspace adapter creates missing fixed directories. Public
missing/file launch-boundary cases therefore use an owned, controlled filesystem
race behind an actual no-turn auth-probe gate. [The fixture design](independent/PUBLIC-FIXTURE-DESIGN.md)
states that method before execution. This is not a claim that ordinary missing
fixed directories survive workspace resolution.

Synthetic PID/output-loss/cancellation seams establish ordering rather than
native kernel races. Fake readiness/model/auth records establish no installed
Claude account, provider capability or paid-turn acceptance. No actual owner
credentials, stores, services, configuration or ports 4747/4748 were used. Recorded
cleanup establishes 107 unique API/fixture PIDs absent and five ephemeral
listeners released. No browser, Linux/macOS, full regression or independent
coverage run is claimed. Exact-head/current-target CI, ordinary coverage and the
reserved fresh independent final audit remain required.

## Byte preservation and selected publication

[The member map](archive-selection.json) enumerates all 174 source members,
their original absolute locations, hashes and selection reasons. Exactly 150
original members are published here. Twenty-four disposable synthetic SQLite
store/key files and compiled fixture executables remain fully retained at the
mapped local paths. Every observation, transcript, prediction, script, source,
failed report/log and actual author provider envelope is included. Compiled
fixture C# sources, executable hashes and actual start/turn markers remain
published even when executable bytes are retained only locally.

[Original-manifest verification](original-manifest-verification.json) checked
all 75 independent QA entries, 32 author entries and 52 review entries with zero
mismatches. The original independent manifest describes its complete local
packet, including the explicitly mapped unpublished scratch members; it is not
rewritten as a manifest of only this selected archive.

Exact subtree formatting and Git attributes preserve copied bytes under
`independent`, `author`, `reviews/review-1`, `decisions` and `live-issue`. The new
editorial README remains normal formatted text. Exact metadata JSON attributes
also protect the new seals and mappings from text normalization. No test,
application or coverage exclusion is added.

[Credential context review](credential-context-review.json) found no selected
credential-pattern candidates and distinguishes intentionally synthetic markers
from real credentials. Original bytes were not redacted or rewritten. This was
publication preparation, not a broader credential inventory or security audit.

[The archive seal](archive-seal.json) hashes every other archived file.
[The ignored-log list](ignored-log-paths.json) enumerates the exact archive paths
that Git ignores and root must explicitly include when staging. The external
publication packet verifies every prospective Git blob, including the seal,
metadata, README and changed attribute/format files, without touching the index.
Root still verifies staged and committed objects before publication.

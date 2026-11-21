# Stored-first preflight model catalog evidence for #448

The actual independent Claude QA final is **CONDITIONAL PASS**, preserved
verbatim. Its documentation condition was selected in [D186](decisions/D186.md)
and applied as the exact Claude-authored prose, without changing runtime code.
Current-head/current-target CI, ordinary coverage and the reserved fresh final
audit remain required. This archive is not a new QA pass, merge approval, owner
acceptance or deployment. Issue #448 remains for the owner to close.

## Source and evidence bindings

| Role                           | Exact binding                                                                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Tested runtime candidate       | `b45807f033601a53919f2c9e16e0de751971a518`, tree `8e5c0998e40ecf51394ea2fc1d23260cb67c75ec`, parent `02351e2fb932b3be44e7cc3fb3943a61d568226c` |
| Initial table correction       | `083d7264ffaeaadba44ebd2f929efb4ac526a127`, tree `485df640b90c94ac9a79bc8fe682b311748dd876`                                                    |
| Frozen corrected documentation | `8ca66df21490e72fd65c63b10471ccc225925f12`, tree `fa0077d9a33c68fe45149e21b0e36351ba0162af`, parent `083d7264`                                 |

The corrected documentation head has no runtime or lockfile delta from the tested
runtime candidate. [Source binding](source-binding.json), the [root freeze
receipt](source-freeze/receipt.json) and the [exact prose
receipt](correction/correction-receipt.json) keep those heads separate. A later
evidence-only publication commit must be bound independently by root.

The original runtime record is Node v22.23.4/pnpm 12.8.1. The base/runtime/doc
heads share lock blob `92a751dbb2c4ead02c57adadbf1afcbd4d63aca5`. The original
single full build passed 12/12 tasks with five cache replays. Ten retained built
artifact hashes and all 51 recorded source/driver/fixture/build binding checks
were reverified without new product execution. These checks include overlapping
bindings; they are not 51 unique artifacts or a test denominator.

## Original records and roles

- [Author checkpoint](author/README.md): assigned GPT 6.1 Sol/xhigh, with original
  failures, limited unavailable-log disclosures, source snapshots and focused
  checks. No author provider terminal is invented.
- [Actual QA01 criteria](independent/qa-01/observations/criteria.json),
  [run 01](independent/qa-01/observations/run-01/summary.json) and
  [run 02](independent/qa-01/observations/run-02/summary.json): independent Claude
  Opus 5.5/xhigh native/public evidence. Its [original provider
  terminal](independent/qa-01/provider/result.json) is a quota error, exit 1. The
  wrapper `subtype: success` is not a successful QA verdict.
- [Actual QA continuation final](independent/continuation-02/provider/provider-final-message.md):
  genuine completed exit-zero Claude Opus 5.5 terminal, SHA-256
  `42d6e3e807c0e5dd6a4b65fd844050141c4ec222351b12bb79b5a1acdc7ede56`.
  It gives CONDITIONAL PASS and reinterprets retained evidence without rerunning
  tests. It corrects the child counts and explains why run 01's stricter failures
  were valid observations against the old documentation.
- [Formal review 1](reviews/review-1/provider/provider-final-message.md): actual
  Opus APPROVE at the runtime candidate, static evidence only, with its original
  binding and execution limits intact.
- [Shared correction review 2](reviews/shared-correction-review-2/provider/provider-final-message.md):
  actual Opus ACCEPT CORRECTION for #448's table delta at `083d7264`. Its complete
  original also covers slice A for #427/#365 and remains verbatim. It is not
  converted into a #448-only report or another general scan.
- [D172](decisions/D172.md), [D184](decisions/D184.md), [D186](decisions/D186.md),
  original follow-up readbacks and D186's #545/#546 correction receipts retain
  the decisions and distinct parked policies. #262 is not admitted by this work.

[Provenance](provenance.json) separates configured routing, actual provider
terminal fields, static reviews and fake CLI model/auth metadata. Two original
formal reviews remain consumed; the fresh designated Astra final audit is scan 3. Actual QA continuation does not reset that budget.

## Typed counts and original failed tiers

These tiers overlap and use different predicates. Do not add the runs, controls,
criteria or focused suites into a combined clean pass rate.

| Native driver record                    | Run 01          | Run 02         |
| --------------------------------------- | --------------- | -------------- |
| Offline P scenarios                     | 17              | 18             |
| Named startup S01–S11                   | 11              | 11             |
| Startup children including G0 bootstrap | 12              | 12             |
| Owned API children                      | **29**          | **30**         |
| Original driver cases: pass / fail      | **40: 18 / 22** | **42: 41 / 1** |
| Original checks: failed                 | **515: 49**     | **580: 1**     |

Original C14 said “30 each.” The [external correction
record](preparation-history/count-correction-record.json) and actual QA final
correct that prose without editing it. Child exits, zero timeouts and no tracked
running child are driver records; process absence is separately supported by the
original final CIM readback (`owned_process_refs=0`) and nonce-verified cleanup
log. Zero timeouts alone are not proof of absence.

The typed [case accounting](case-accounting.json) keeps P/S product scenarios,
G0 bootstrap, seven fixture variants, three public-method controls, M04 native
cleanup and M05 sidecar isolation distinct. Versioned drivers, original expected
and actual fields, transcripts, raw requests/output and provider records remain
included. No separate pre-execution predictions document is invented.

- Independent API: 61/61 tests, exit 0, with **ten recorded and blocked** attempts
  to fetch default `127.0.0.1:11434/api/tags`. Passing tests do not hide that
  hygiene observation.
- C12 infrastructure remains **55 passed / 1 failed EBUSY**, exit 1. The author
  candidate records the same 55/1 class; one immutable-baseline cleanup case
  records 1 failed / 9 skipped. This establishes the class before #448, not its
  native-handle cause or a broad base-binary preflight pass.
- C13 native close/cleanup remains a failed tier. In run 02, read-only client
  files remained EBUSY until an explicit GC; no retry-to-green or runtime fix is
  claimed.
- Author original wrong-disabled expectations (2 failed / 9 passed), intentional
  stored-only counterfactual (3 failed / 8 skipped) and interrupted incorrectly
  scoped aggregate remain visible. The unavailable complete raw output is not
  fabricated; the original checkpoint's limited transcript remains unchanged.
- Scoped passes do not establish aggregate coverage. No new test, build or
  provider/product execution was run for this archive.

## Read-only data versus reader sidecars

The runtime change shares the same pure stored-first projection at preflight and
startup. Only missing exact `(harness, model)` seed pairs are appended in memory;
stored metadata and disabled preferences win. [D172](decisions/D172.md) preserves
the separate Codex disabled-default WARN/0, Claude FAIL/1 and invalid-only startup
admission policies. No automatic model substitution or offline seed/migration is
added.

The original native observations preserve database bytes, logical rows, schema
and migration markers, and any existing WAL bytes. They also demonstrate that a
read-only open can physically create a **zero-byte WAL and 32 KiB SHM** beside a
WAL-mode store that had no WAL. Zero frames do not mean no file was created.
Run 01 correctly failed the stronger old no-new-sidecar wording; run 02 openly
changed its predicate to permit an empty WAL and record the fact. Its 41/42 is not
proof of the old wording.

The actual QA final proposed exact §7a/7b and both §7c cells. D186 selected them;
the [correction records](correction/correction-receipt.json) prove all four
snippets stayed byte-identical after formatting. Only table padding changed
outside those snippets, and the warning cell stayed unchanged. Root froze the
two-file prose change at `8ca66df2`. This addresses the documentation condition
under the coordinator's disposition; it does **not** rewrite CONDITIONAL PASS
as a new QA PASS. The final audit still judges the bound runtime/prose.

M05 observes the sidecar behavior through the unchanged guard and independent
Node SQLite readOnly. Broad pre-existing parity remains a source-backed
inference, not a measured base-binary result. Non-Windows/restricted filesystems,
later-writer behavior, live provider entitlement and browser acceptance remain
unmeasured. Fake readiness records do not establish actual owner account access.

Original #545/#546 follow-up text and the D186 before/after readbacks are retained
under `followups/`. #546 had a literal no-create-WAL clause; #545 had broader
read-only wording. Both remain parked outside this batch, and #262's model
retirement policy remains separate.

## Exact selected publication

[The member map](archive-selection.json) covers **392 original members**:
**378 byte-identical copied originals** and **14 retained local SQLite
snapshot/sidecar members** with exact paths, sizes and hashes. Their complete
local bytes remain available; all original SHA256SUMS, logical/byte observations,
failed runs, scripts/source, transcripts and provider envelopes remain published.
No standalone fixture executable/key/cache/build tree is invented as an
exclusion.

All 307 previously proposed include paths and 14 retained paths remain accounted
for. The earlier QA02 brief was a mutable continuation input before actual launch;
its root count correction and old point-in-time hashes are explicit. Historical
draft files in `preparation-history/` remain verbatim, including their then-OPEN
status. They do not override the actual final report or current binding.

Exact archive subtrees and metadata Git attributes preserve the copied bytes;
the new editorial README alone is normally formatted. [Original hash
verification](original-hash-verification.json) and the [archive
seal](archive-seal.json) make provenance inspectable. The external final
preparation receipt checks every prospective Git blob, including the new seal,
metadata and scoped ignored-log list; root must verify the real index and commit
again before publication. No staging or commit is performed by this preparation.

[Privacy context review](privacy-context-review.json) records no strong
credential-pattern candidate in the selected bytes and identifies the explicitly
synthetic fixture key. Original bytes are not redacted. This is a bounded
publication check, not a generalized security verdict.

Current-target CI with ordinary coverage, fresh final audit scan 3, authorized
merge, owner-only issue closure and separate owner deployment/acceptance remain
open.

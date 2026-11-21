# Draft #448 evidence publication preparation

**OPEN: this is an external administrative draft, not a QA final verdict, final archive, publication seal or merge decision.** No author/QA checkout, index, original evidence or public record was changed. Actual Claude QA continuation 02, the WAL-sidecar documentation correction/new source head, current-head/current-target CI and the designated fresh Astra final audit remain open.

The current runtime candidate is `b45807f033601a53919f2c9e16e0de751971a518`, tree `8e5c0998e40ecf51394ea2fc1d23260cb67c75ec`, based on `02351e2fb932b3be44e7cc3fb3943a61d568226c`. Its current doc-only child is `083d7264ffaeaadba44ebd2f929efb4ac526a127`, tree `485df640b90c94ac9a79bc8fe682b311748dd876`; only doc 11 differs. A future source binding must replace this draft's admission fields after the actual Claude prose is available. This draft copies nothing into either checkout.

## Original evidence and roles

- `i4-448-author-01`: original GPT author checkpoint, failures, baseline/candidate source copies, focused logs and candidate manifest. The README identifies assigned GPT 6.1 Sol/xhigh; there is no invented author provider terminal. Some original incorrectly scoped/disabled-expectation output was not redirected and exists only as the limited original checkpoint transcription. A complete raw log must not be fabricated.
- `i4-448-independent-01`: actual independent Claude Code Opus 5.5/xhigh native/public work, original run 01 and corrected run 02, versioned drivers, expected/actual case records, bindings, retained fixture snapshots, focused checks, provider envelopes and cleanup. Its terminal says `is_error: true`, exit 1 and session usage limit. The misleading wrapper `subtype: success` is **not** a successful QA verdict. Its `criteria.json` is retained worker case assessment, not an overall terminal final.
- `i4-448-independent-02`: continuation brief/spec only in this point-in-time inventory. The actual provider final and exact proposed prose remain absent/open; this preparation neither substitutes a model nor supplies a verdict on Claude's behalf.
- `i4-448-opus-review-01`: actual Opus formal review 1 APPROVE at the runtime candidate, static only. Original source/verification limits remain verbatim.
- `i4-doc-correction-review-02`: actual Opus targeted correction review 2 ACCEPT CORRECTION for slice B at the doc child. The whole original includes slice A for #427/#365 and must remain verbatim; inclusion does not make it new #448 QA or a new general scan. The third designated fresh Astra final audit remains reserved.
- Original D172, D184 and follow-up connector readbacks are selected unchanged. #545 and #546 remain parked; #262 retains the existing model-retirement/stale-metadata policy question. None is newly admitted by this draft.

There is no separate dated predictions file in the inventoried QA01 root. Original expected predicates and case purposes are retained in the versioned drivers, brief, per-case `expected`/`actual` records and full provider record. This draft must not be relabelled as predictions written before execution.

## Typed scenario accounting

`typed-case-accounting-draft.json` preserves per-kind source IDs and original pass/fail fields without adding overlapping tiers into a combined pass rate.

| Original native driver tier | Run 01 | Run 02 | Interpretation |
| --- | --- | --- | --- |
| Built offline preflight, P scenarios | 17 scenarios: 4 pass / 13 fail | 18 scenarios: 18 pass / 0 fail | Run 01 failures include the original no-new-empty-WAL assertions; retain them. Run 02 distinguishes unchanged data/frames from empty sidecar creation. |
| Named ordinary startup, S01–S11 | 11 scenarios | 11 scenarios | These counts exclude G0. |
| Startup child starts, including G0 first-run bootstrap | 12 child starts: 5 passing scenarios / 7 failing scenarios | 12 child starts: 12 passing scenarios / 0 failing scenarios | Seven original startup-refusal failures concern strict WAL-presence assertions. |
| Built public methods, M01–M03 | 3 scenarios: 2 pass / 1 fail | 3 scenarios: 3 pass / 0 fail | Stored-first, availability and counterfactual observations; overlaps behavior criteria. |
| Fixture-variant controls, V-* | 7 scenarios: 7 pass | 7 scenarios: 7 pass | Setup/control checks, not extra independent product acceptance. |
| Native close/cleanup probe, M04 | 1 failed scenario | 1 failed scenario | Real EBUSY cleanup tier remains failed; run 02 read-only native handle released only after explicit GC. |
| Read-only sidecar isolation probe, M05 | Not in run 01 | 1 scenario, recorded pass | Separates existing read-only-open behavior from the projection change. |

The original C14 prose and continuation brief say 30 API children in both runs. Actual summary arrays record **29 in run 01** (17 P + 11 S + G0) and **30 in run 02** (18 P + 11 S + G0). `count-correction-record.json` binds the exact raw summaries and preserves the original incorrect prose. Root will supply the correction to actual QA02; this draft edits no original criterion or brief.

Raw child exit records report exit 0/1, zero timeouts and no tracked running children. Absence is **not inferred from zero timeouts**: original final `binding/git-state-after.txt`, captured at 09:16:34 UTC, records CIM `owned_process_refs=0` and `owner_port_listeners=0`. The original cleanup log records nonce-verified scratch removal and 27 suite leftovers. These are attributed historical observations, not new process checks.

Separate focused/check tiers also remain separate:

- Independent API: 61/61 tests, exit 0, with a recorder blocking **10** in-test requests to default `127.0.0.1:11434/api/tags`. That hygiene observation is retained; a passing test count does not hide attempted default-network probes.
- Independent infrastructure: **55 passed / 1 failed**, exit 1, original catalog cleanup EBUSY. Author candidate also records 55/1; its single immutable-baseline cleanup test records 1 failed / 9 skipped. Those establish a pre-existing failure class, not its cause and not broad base-binary preflight parity.
- Author original wrong-disabled-default expectation: 2 failed / 9 passed; D172 selects preservation of the existing harness-specific policy. Author stored-only counterfactual: intentional 3 failed / 8 skipped. The later 11-test pass overlaps the 61-test focused API suite. The pure two-test projection tier overlaps broader infrastructure.
- Original independent full build: 12/12 tasks, exit 0. No new build, test, product invocation or coverage run was performed during preparation. Whole-workspace coverage and current-target CI are not established by these logs.

## WAL-sidecar contradiction and remaining copy work

The original P/M observations establish unchanged database bytes, logical rows, catalog content, migration/schema markers and any already-existing WAL bytes. They also establish that a read-only open of a WAL-mode store whose WAL is absent can physically create a **zero-byte WAL and 32 KiB SHM**. M05 observes this in the unchanged guard path and in independent `node:sqlite` readOnly. Zero frames do not constitute row writes, but physical sidecar creation cannot be described as “no WAL created.”

The original run 01 strict assertions and source docs are not rewritten. The selected actual Claude continuation is to give its final criterion disposition and exact replacement prose for doc 11/CHANGELOG. Until then, the WAL documentation correction and final source head remain **OPEN**. The same copy proposal can clarify that an entirely unconfigured Claude default skips its check, whereas a configured entry with a missing/invalid model or effort fails, without changing D172's Codex WARN/Claude FAIL distinctions.

The saved #546 acceptance text explicitly says never “create or alter the inspected database/WAL,” which conflicts with the observed empty-sidecar possibility. The saved #545 text says to preserve “read-only database/WAL behavior” and the SHM exception; it does **not** literally contain the same no-create sentence, but should receive consistent qualification if root chooses to clarify it after actual QA's verdict. Exact quotations and source hashes are retained in `evidence-issues-draft.json`. No issue edit is performed here.

## Binding and draft selection

`source-and-original-hash-verification-draft.json` verifies the seven author source hashes, independent seven-file source binding, original driver/fixture SHA256SUMS and ten retained built artifacts. `hash-verification-addendum.json` verifies six retained baseline/candidate source snapshots and the exact shared-review B patch. **All 51 recorded hash/binding checks match**; these are checks, not 51 unique artifacts. The original lock blob is identical at base, runtime candidate and doc child (`92a751dbb2c4ead02c57adadbf1afcbd4d63aca5`), with the retained runtime record Node v22.23.4/pnpm 12.8.1. The exact built API/SQLite call-site and artifact binding is retained; no model attestation is inferred from fixture IDs.

`member-selection-draft.json` inventories **321 original members**: 307 proposed byte-identical inclusions (8,550,624 bytes), and 14 retained synthetic SQLite snapshot/sidecar members kept fully at their mapped local paths (3,068,360 bytes). Every script, source, raw run, transcript, prediction/expected field, failed report/log, provider envelope, quota terminal, original hash list and logical/byte observation remains selected. All 14 exclusions have precise source path, hash, byte length and full-local-retention reason. No standalone compiled executable/key/cache/dependency/build tree exists among these packet members, so none is invented as an exclusion.

`privacy-candidates-draft.json` records zero strong credential-pattern candidates in the selected evidence. The driver explicitly defines its synthetic 32-byte key from `Buffer.alloc(32,0x48)`. No original bytes were redacted, and no owner credential file was read. This is a bounded publication check, not a generalized security verdict.

The proposed archive-only ignore/attribute snippets are external drafts. They are not applied. Final selection, newly arrived actual QA prose, final source/dependency/build bindings, exact metadata attributes, prospective/staged/committed blob verification and a final archive seal must wait for root's next admission. **No final seal exists.**

The draft PR body uses **Part of #448** and **Part of #279**. Issue #448 has an explicit owner-only closure condition. Actual QA final, WAL/default-copy correction, current-head/current-target CI, reserved final audit, owner closure and owner deployment/acceptance are not completed by this administrative draft.

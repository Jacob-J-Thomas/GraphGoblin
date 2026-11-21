# #363 marker correction and independent verification

The final audit found a race in a test fixture: its completion marker became visible before the JSON write finished, and an observer failure could skip the explicit abort. D190 selects a bounded correction under the existing completion policy after the three general scans. The original negative final audit remains unchanged.

The fixture now writes and closes an exclusively owned sibling before renaming it into place. Observation failures abort and await the SDK work before reporting the original fault. Production code, the SDK patch and the lockfile are unchanged by this correction.

- [Original final Astra audit](original-final-audit/REPORT.md): CHANGES_REQUIRED, retained with its source witness. No natural race or orphan was claimed.
- [Correction author report](correction-author/REPORT.md): nine focused tests, 678 adapter tests passed / four live tests skipped, 99.41% lines / 95.50% branches, typecheck/lint/format. The failed first counterfactual assertion and corrected old-only observation remain separate.
- [Actual Fable correction review](fable-correction-review/provider/provider-final-message.md): ACCEPT FIX, limited static review of the three files. This is not a fourth general scan or renewed Astra approval.
- [Independent actual Opus QA](independent-qa/REPORT.md): 11 native host cases, 422/422 criterion checks, five predictions and two instrument controls; the maintained nine-test suite also passed. The three expected observer-fault cases exited 1 as predicted. Native filesystem/process checks establish an externally held publication window, closed complete sibling, exact final bytes, original error, SDK settlement and process absence.
- [Selected decision and alternatives](context/decision-190.md), [source binding](source-binding.json), [full original selection](selection-map.json) and [prior archive verification](prior-archives-verification.json).

The empty-marker case had no parsed record, so the host could not perform its own PID check; the independent driver established absence. A killed paused fixture leaves its owned pending/pause files in its test root, while the SDK schema directory is cleaned. These limits remain explicit. No native Codex/account/provider execution, natural OS race or live-provider behavior is claimed.

Every original file in the selected audit, author, freeze, Fable and QA packets is copied byte-for-byte, including failed attempts and actual provider envelopes. Original #363 and inherited #547 archives remain unchanged at their original paths. The source manifest seals every member except itself; exact Git attributes preserve raw bytes.

Current corrected-head/current-target CI, native artifact verification and explicit coordinator completion remain required before merge. The earlier final-audit verdict is not rewritten. Owner acceptance and the rest of the five-intent batch remain separate.

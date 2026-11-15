# PR #478 merge and audit completion record

This record preserves the exact-head final audit and merge evidence for PR #478 as a proposed input to the later history #480 packet.

## Identity and disposition

- Audited head: `48dddb1af1239bbdddc7d7c9c8b0e47c0431c6c6`, tree `10fa2793ec1c2ee63e45143a40af5d6ba1a93f0b`.
- Target/main: `41bde22c80a796bf8c4bec8ab5dec8e755271f9e`.
- Earlier native source freeze referenced in audit metadata: `dbc55454b224e350f7005cdaf58b8655c4b9e71e`; this packet does not duplicate its source tree.
- The final Astra max report is SHA-256 `72d074e03fdb859dbd98d692f33ce6b836dbb1ab2c805dadda86ccea6da5a74f`. It signed off that head for merge as formal scan 2 of the shared 3-scan cap; scan 1 remains historical negative evidence. The report was published at [PR comment 6889484381](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/478#issuecomment-6889484381).
- PR #478 was then merged at 2026-11-15 05:01:21Z as `1cfca9bce3967c9d41950266c83aab636667e0ab`. The merge commit has the audited tree and ordered parents main `41bde22c80a796bf8c4bec8ab5dec8e755271f9e`, then head `48dddb1af1239bbdddc7d7c9c8b0e47c0431c6c6`. CI ran on synthetic merge `10164569c6260723495470479b065c52f5bdd0c9`, with the same tree and parent order.
- A fresh readback leaves issue #207 open/backlog. Its first engineering criterion is checked; owner acceptance remains unchecked and tracked in [comment 6889501515](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/207#issuecomment-6889501515). PR merge does not complete I08 or owner acceptance.

## Verification and limits

- The final audit independently passed one focused run: 6 files, 173 tests passed, 0 failed, 31.92 seconds. The full current-head CI packet is preserved separately at [current-head CI](../2026-11-15-canvas-current-ci/README.md); all five jobs passed on attempt 1.
- The CI Gates job reports 2,689 web tests in 213 files (98.57% line, 94.18% branch coverage). All 13 package coverage gates passed; minima were 95.00% lines and 90.55% branches. Dependency audit reported 21 advisories (8 low, 13 moderate; none high).
- Native QA records 15 distinct product passes across 17 fixture launches. The original pan preservation attempt remains inconclusive because it failed before serializing its sampled trace; a later bounded correction passed the unchanged input and criteria. The optional headed Windows mouse check stopped at its display/DPI guard before native input, so there is no OS-generated mouse or physical-device proof.
- Browser CI recorded 481 passes and one declared live-Codex-provider skip, with zero retries. This is not live-provider acceptance.
- Routing reported 33.3 ms frame p95 at 300 nodes. The normal PR gate covers routing times, not the separate optional <17 ms frame target. Earlier #478 evidence recorded similar frame timing; this is not a controlled current-main baseline, a new-regression finding, or 60-fps proof.
- Source comparison is represented by identity and verification metadata; no source tree or large generated diff is duplicated here. Deferred issues #479 and #481 remain separate. Formal scan 2/3 is the report’s signoff; no additional scan is recorded in this packet.

## Preserved evidence

- [Raw final audit report](evidence/final-audit-report.md.txt) and [audit brief](evidence/audit-brief.md.txt)
- [Completion record](evidence/completion.json), [independent verification](evidence/independent-verification.json), [independent CI job readback](evidence/independent-ci-jobs.json), and [focused test log](evidence/focused-tests.log)
- [Candidate identity](evidence/identity.json), [audit dispatch record](evidence/dispatch.json), [non-QA changed-path list](evidence/non-qa-paths.txt), and [fresh merge/issue readback](evidence/merge-final-readback.json)
- [SHA-256 file manifest](SHA256SUMS)
- [Evidence copy and exclusion manifest](evidence-manifest.json)

The current-head CI proposal beside this packet contains the decoded raw job logs and its own manifest. They are not duplicated in this completion packet. The dispatch JSON is an earlier running-status snapshot; the later completion record carries the audit result. Raw source report bytes are stored with a `.md.txt` suffix; `.gitattributes` disables line-ending conversion for raw evidence.

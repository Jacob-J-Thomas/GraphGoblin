# PR #475 merged completion evidence

This packet records the final audit disposition, exact merge identity, current-target CI, and open owner follow-up for the save/publish change. Retained report, readback, and log files are copied byte-for-byte. Its preparation made no repository, issue, or GitHub changes.

## Final disposition

PR #475 merged at 2026-11-15 01:06:24 UTC as commit `41bde22c80a796bf8c4bec8ab5dec8e755271f9e`. Its parents are actual main `8fadcb0d44ac2caf80ff6279fe4648ce9398afd9` and the reviewed PR head `30b24ce35d9bcc247579acf54d4efb8153ca0348`. The merge tree `6cdf7c4369ae3494bafddaa6f9f83cf9335f2029` equals the reviewed head tree. The verified merge object and fresh merge readback are retained below.

Fresh GPT-6 Astra max whole-PR scan 2 of 3 signed off on head `30b24ce35d9bcc247579acf54d4efb8153ca0348` against actual main `8fadcb0d44ac2caf80ff6279fe4648ce9398afd9`. All four original findings were resolved; the report admits no new findings or deferrals. The audit was published as comment [6887049928](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/475#issuecomment-6887049928), and the retained readback records a fresh GET matching its body. The third formal scan remains unused.

## Current-target CI

The current-head workflows completed before merge on their first attempts: CI run [43657427543](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43657427543) and routing run [43657427557](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43657427557). The CI checkout used merge ref `a283b790836207b23e3126d6f794f78433334d3b`, with parents actual main `8fadcb0d44ac2caf80ff6279fe4648ce9398afd9` and head `30b24ce35d9bcc247579acf54d4efb8153ca0348`; its tree matched the reviewed head.

- Gates passed 22 coverage tasks: web 2,598 tests across 210 files; domain 459 across 29 files; API 1,917 passed with 20 skipped; infrastructure 1,149 passed with 8 skipped.
- Browser passed 479 tests with one expected live-provider skip and zero retries.
- Windows launcher passed 14 tests. Template image and routing jobs passed.
- The configured high-severity dependency audit threshold passed with 8 low and 13 moderate advisories.

All five decoded current-CI logs are retained with their exact original bytes, along with final CI jobs, routing job, run metadata, and the GitHub merge Git object. The logs' SHA-256 values and byte lengths are also recorded in the final audit gate-status readback.

## Native verification

The final actual-main native packet records 19 first-pass outcomes across 14 fixtures on tested ancestor `bf9f287652a23177b87488df110dfd6147acaad0`. Its source/build binding remained equivalent through the final head; no product, test, or build-input delta followed the native-tested source. The native evidence is kept in the committed [final native packet](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/30b24ce35d9bcc247579acf54d4efb8153ca0348/docs/qa/2026-11-14-publish-final-main-native/README.md), rather than duplicated here.

## Earlier CI outcomes

The earlier `bf9` and `1867` candidates are retained as historical records, not presented as green checks. The audit report records their format-gate failures and canceled Browser runs. The `1867` candidate used main `8fadcb0d44ac2caf80ff6279fe4648ce9398afd9`; its identity and source/evidence readback are retained. Original transport responses containing the older job logs, plus the `1867` final job metadata, remain byte-exact in `raw/historical-ci-bf9/` and `raw/historical-ci-1867/`. See the [bf9 workflow](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43655173378), [1867 CI workflow](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43656350388), and [1867 routing workflow](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43656350808) for provider-hosted run records.

## Owner follow-up and limits

Issue [#237](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/237) remains open and parked pending owner product acceptance. The machine-checkable criteria are recorded as checked; no owner store, service, or instance was changed. This packet does not claim human acceptance, issue closure, or a change to the owner's environment.

## Evidence index

- [Final Astra audit report](raw/final-audit/report.md.txt), [review brief](raw/final-audit/brief.md.txt), and [root disposition](raw/final-audit/root-final-disposition.md.txt).
- Exact publication and current-CI records: [audit comment GET](raw/final-audit/audit-publication-readback.json), [current-CI readback](raw/final-audit/publication-current-ci-readback.json), and [gate status](raw/final-audit/gate-status.json).
- [Reviewed identity](raw/final-audit/identity.json), [source and evidence readback](raw/final-audit/source-and-evidence-readback.json), [non-QA path list](raw/final-audit/non-qa-paths.txt), and [non-QA diff](raw/final-audit/non-qa.diff).
- [Premerge PR readback](raw/final-audit/premerge-pr-readback.json), [merge readback](raw/final-audit/merge-readback.json), [owner issue readback](raw/final-audit/owner-acceptance-issue-readback.json), and [completion record](raw/final-audit/completion.json).
- Current exact decoded logs: [gates](raw/current-ci-30b24/gates.log), [browser](raw/current-ci-30b24/browser.log), [Windows launcher](raw/current-ci-30b24/windows.log), [template image](raw/current-ci-30b24/template.log), and [routing](raw/current-ci-30b24/routing.log). The [job metadata](raw/current-ci-30b24/jobs-final.json), [routing job](raw/current-ci-30b24/routing-job-final.json), [workflow runs](raw/current-ci-30b24/runs-final.json), and [CI merge Git object](raw/current-ci-30b24/merge-git-object.json) bind these logs.
- Earlier candidate identity/readback: [1867 identity](raw/historical-1867/identity.json) and [1867 source/evidence readback](raw/historical-1867/source-and-evidence-readback.json). The historical CI directories retain the raw log-bearing transport records and final 1867 job metadata.

The final audit report has SHA-256 `1a8b30756b94e23a571f824d2008f74068cb4663e2b6df54b74a6768c501120e`. The final 28,831,727-byte full binary diff is not copied; its SHA-256 is `9e0b92c2ce52a965921d268010c4d3f9420d39a37b9124d751f95184e7132810`. The earlier 28,831,820-byte `1867` full diff is also omitted and identified in `retained-files-manifest.json`. Current transport wrappers are omitted because exact decoded CI logs and separate run/job metadata are retained. Omitted files remain in the external source evidence directory.

See [retained-files-manifest.json](retained-files-manifest.json), [omissions.json](omissions.json), [link-checks.json](link-checks.json), and [SHA256SUMS.txt](SHA256SUMS.txt) for file-level integrity and link results. `.gitattributes` disables text conversion under `raw/` so copied evidence bytes remain stable.

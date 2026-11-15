# PR #475 stacked-candidate CI evidence

This packet contains the five decoded job logs and completion metadata captured for PR #475. The copied log bytes retain their original observed LF or CRLF endings; transport JSON duplicates and the log-decoding helper are excluded.

| Evidence                             | Result                                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Gates, CI run 43634737570            | [Log](gates.log) · [Completed jobs](jobs-complete.json)                                              |
| Browser, CI run 43634737570          | [Log](browser.log) · no-retry step                                                                   |
| Windows launcher, CI run 43634737570 | [Log](windows.log) · 14 passed, 0 failed or skipped                                                  |
| Template image, CI run 43634737570   | [Log](template.log) · completed job verifies installed templates without network or writable storage |
| Routing performance, run 43634737582 | [Log](routing.log) · [Completed job](routing-jobs-complete.json)                                     |
| Workflow completion                  | [Workflow metadata](workflows-complete.json) · [Log byte manifest](log-manifest.json)                |

All five selected jobs passed in their captured CI and routing runs. The Gates job records 22 post-build workflow steps as complete, including typecheck, lint, format, layer and dependency checks, coverage, license allowlist, generated docs and acceptance suites. Coverage totals were web 2,572 tests across 206 files, domain 452 across 29 files, API 1,917 passed plus 20 skipped, and infrastructure 1,149 passed plus 8 skipped. Line/branch coverage was 98.53%/94.12% for web, 98.79%/96.2% for domain, 95.77%/90.55% for API and 97.8%/93.18% for infrastructure. The browser run reports 479 passed and one skipped live Codex inference test; its workflow step is explicitly no-retry. The Windows launcher suite reports 14/14. The template job completed its installed-template check. Routing medians were 4.3 ms at 100 nodes and 4.1 ms at 300 nodes, with a maximum measured routing p95 of 5.1 ms.

The Gates log shows pnpm audit --audit-level=high succeeded while reporting 21 advisories: 8 low and 13 moderate. This is a pass at the configured high threshold, not a claim of zero advisories.

The PR snapshot file was captured at approximately 20:23:58Z, after the two workflows completed and before the later green-body update. Its embedded GitHub updated_at value (20:18:10Z) is record data, not the snapshot capture time. The snapshot records PR #475 as open and draft, head 35bb3fbdc724a82064d0d9e65b551608542c6b22, and comparison base 164c01a2e3a52bf0ef69a409e1a428b45817b1b8; the tested tree is 42bfce66017eb91f3fcd50ffdfb24876a47558f6. Actual main remained a817e5ccb4fd598ca56089b97b4ce55e9cb6f58c.

This is stacked-candidate CI evidence only. Actual-main integration, final-target CI and a fresh Astra 2 review remain pending. The browser skip means no provider turn was run. These records do not establish physical-device behavior, full reemit or owner acceptance.

The [retained-file manifest](retained-files-manifest.json) records the ten exact source artifacts and their SHA-256 hashes. See [local link checks](link-checks.json) and [SHA-256 sums](SHA256SUMS.txt). .gitattributes disables text conversion for all retained bytes.

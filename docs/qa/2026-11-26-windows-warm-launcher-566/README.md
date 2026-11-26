# Windows warm launcher and installer follow-ups QA

This packet records the review and QA evidence for [PR #589](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/589) on branch `codex/gg-followups-20261124`. The PR closes #566, #544, #498, #532, #520, #536, #493, #543 and #494, and is part of #499. Every file under `raw/` is a byte-for-byte copy of delivery evidence, and [MANIFEST.json](MANIFEST.json) records its source path, size and SHA-256. Markdown originals are kept as `.md.txt` and raw logs and TAP as `.log.txt` or `.txt`.

The opposite-family GPT review of the commits made in the Claude-only window, the fresh Astra MAX final audit and owner acceptance are still pending. This packet does not replace any of them.

## Candidate

| Item                  | Value                                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Head                  | `a068a7b45f0ead8f70041371561d0dc23f1b7ecf`: test-only fix for the native QA finding F1                                                                            |
| Independent native QA | `9f11b6e6bf0f7bff1e3674ad1edfe17a8fdf682d`, the parent of the head                                                                                                |
| Integration with main | Merge `ac007e3889441f9b88d88b0234bc2eaff8ed1805` of main `4e1037c9e9922ffa27237fe79850403b6b54fc70`                                                               |
| Warm launcher         | `d2093221` (#566, #544), merged with main `5063107b` as `ab1ca9c3`                                                                                                |
| Installer             | `0776af43` (#498, #532, #520), merged as `b07e1524`                                                                                                               |
| Shortcut identity     | `f77940fe` (#536)                                                                                                                                                 |
| Claude-only window    | `b95c2d69` (#499), `f786b902` (#493), `9c9614fd` (#543), `9e4462e6` (#494), merge `ac007e38`, `9f11b6e6` (docs for the #499 link cases), `a068a7b4` (F1 test fix) |

## Results by issue

Native QA means the independent local run at `9f11b6e6` unless the row says otherwise. Every native test also passed on hosted CI at the head, but that job is red because of rejected evidence records (see [Hosted CI on the current head](#hosted-ci-on-the-current-head)).

| Issue       | Change                                                                                                                                                                               | Review                                                                         | Native QA                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| #566        | A click reuses a running gateway whose launch identity and configured target match the installer's enrollment, without startup-only helper checks. Cold start keeps the full checks. | Design critiques, then two blocked formal reviews, both corrected and accepted | PASS WITH LIMITS (headless arm)                                                                                                             |
| #544        | Native regression of cold refusal under helper containment and helper-free warm reuse                                                                                                | Same as #566                                                                   | PASS, calibrated                                                                                                                            |
| #498        | Reinstall, rollback and stage-cleanup regressions in CI                                                                                                                              | Formal review 2 READY                                                          | FAIL (test defect F1); fixed in `a068a7b4`, which passed in a local re-run and on hosted CI                                                 |
| #532        | Compiler path-length failures refused with `-InstallDir` guidance                                                                                                                    | Formal review 2 READY                                                          | PASS                                                                                                                                        |
| #520        | Default shortcut discovery and collision refusal                                                                                                                                     | Formal review 2 READY                                                          | PASS                                                                                                                                        |
| #536        | AppUserModelID written before the shortcut's single save                                                                                                                             | Formal review 1 READY                                                          | PASS WITH LIMITS                                                                                                                            |
| #493        | docs/10 documents the checkout-alias case and its symlink prerequisite                                                                                                               | Interim Claude review                                                          | Docs only; the alias case passed on hosted CI only                                                                                          |
| #543        | ADR-0086 indexed with its delegated selection and pending owner review                                                                                                               | Interim Claude review                                                          | Docs only                                                                                                                                   |
| #494        | Built identity helper imported through a real wrapper entry                                                                                                                          | Interim Claude review                                                          | PASS                                                                                                                                        |
| #499 (part) | Installer refuses reparse-point sources and outputs, such as cloud placeholders                                                                                                      | Interim Claude review                                                          | INCOMPLETE locally (symlink prerequisite missing); both link subtests passed on hosted CI at `9f11b6e6` and `a068a7b4`; Cloud Files not run |

## Changes

- **#566.** `/healthz` adds `X-GraphGoblin-Launch-Identity`, a versioned digest of the effective non-secret settings and the canonical store and serving paths. The installer enrolls it once and binds it to the launcher's checkout, Node, data directory, port and `GG_*` inputs. A click probes the port first and reuses a ready gateway with that identity whose store still resolves to the enrolled locations. Startup locks, helper containment and the full fingerprint check apply only to cold start. A mismatched or foreign listener is reported, never stopped. ADR-0090 records the decision and narrows ADR-0086's warm-click refusal.
- **#544.** The native readiness case `warm reuse under an outer active-process limit attempts no admission (#544)` calibrates an outer job's active-process quota, shows that a cold click is refused under it, and shows that a warm click succeeds with no admission attempt.
- **#498, #532, #520.** The PowerShell 5.1 installer case keeps first install and same-path reinstall, rollback under a read-only sharing hold, the compiler resource and non-resource refusals, and zero-argument default discovery with collision and missing-source refusals.
- **#536.** The shortcut's AppUserModelID is written and committed through the new shortcut object's own property store before its only `Save`, instead of through a store reopened from the already-saved file.
- **#499 (part).** The installer refuses a PWA source or an existing output that Windows reports as a reparse point, before its digest, any stage or any shortcut read. The late source check re-reads the selected path. `9f11b6e6` documents both link subtests and their file-symbolic-link prerequisite in docs/10.
- **#493.** docs/10 describes the native checkout-alias case and its directory-symlink prerequisite.
- **#543.** The decisions index lists ADR-0086 with its delegated selection and pending owner review.
- **#494.** The identity test runs a real wrapper file as Node's entry, which imports the compiled helper through a checkout alias and must stay silent under `GG_PORT=invalid`.

## Review history

### Warm launcher (#566, #544)

- **Design critiques (Claude Opus 5.5).** Three critique runs on the architecture at `d2df8600`. The first ended at its 720-second deadline with no report ([exit receipt](raw/warm-design/claude-design-review-01/CLAUDE-EXIT.json)). The second returned CHANGES REQUIRED ([critique](raw/warm-design/claude-design-review-02/ARCHITECTURE-CRITIQUE.claude.md.txt)). The revised architecture was critiqued again and returned CHANGES REQUIRED with five ranked amendments ([critique](raw/warm-design/claude-revised-review-01/ARCHITECTURE-CRITIQUE.claude.md.txt)).
- **Formal review 1 (GPT-6.2 Astra, xhigh): BLOCKED**, four P1 and three P2 findings, R1 to R7 ([review](raw/warm-review/review-01/REVIEW.md.txt)). Decision FUP-043 accepted all seven and admitted a bounded Claude correction ([decision](raw/warm-review/correction-review1-01/ROOT-ADMISSION.json), [correction report](raw/warm-review/correction-review1-01/IMPLEMENTATION-REPORT.claude.md.txt)).
- **Formal review 2 (GPT-6.2 Astra): BLOCKED.** R2, R4, R5 and R7 were resolved; R1 (drain bound to the verified connection), R3 (authoritative file identity for a case-only store match) and R6 (deadline after the last proxy lookup) stayed open ([review](raw/warm-review/review-02/REVIEW.md.txt)).
- **Correction 2.** Decision FUP-057 admitted it ([decision](raw/warm-review/correction-review2-01/ROOT-ADMISSION.json)). Its five wrappers passed: build 12/12, focused native 7/7 and readiness 20/20 ([report](raw/warm-review/correction-review2-01/IMPLEMENTATION-REPORT.claude.md.txt)). The adjudication held the source for three read-only commands outside the allowlist ([adjudication](raw/warm-review/correction-review2-01/ADMISSION-HANDOFF.md.txt)), and FUP-072 then accepted it for integration and independent QA only ([decision](raw/warm-review/correction-review2-01/ROOT-SOURCE-ADMISSION.json)).
- Two of three formal scans are used. The R1, R3 and R6 corrections have not been re-reviewed independently; the third scan is the fresh Astra MAX final.

### Installer (#498, #532, #520) and #536

- **Installer.** Formal review 1 blocked on one P2 (a nested `CS1619` inside a `CS1029` message). After a Claude correction, **formal review 2 (GPT-6.1 Sol, xhigh) returned READY** with no actionable findings ([review](raw/installer/review-02/REVIEW.md.txt)). Independent Claude component QA then passed 8 of 8 outcomes on the frozen four-path candidate at `154e78d5` ([QA report](raw/installer/component-qa-02/QA-REPORT.claude.md.txt), [root adjudication](raw/installer/component-qa-02/ROOT-QA-ADJUDICATION.json)). That QA excluded Explorer pinning, Chrome/PWA, cloud folders, warm integration and CI.
- **#536.** An eight-call native diagnosis found `IPropertyStore.Commit` returning `0x80070497` after the first save. **Formal review 1 (GPT-6.1 Sol, xhigh) returned READY** with no P1 or P2 ([review](raw/installer/shortcut-staging-536/review-01/REVIEW.md.txt)).

### Claude-only window (#499, #493, #543, #494)

- **Author (Claude).** Static checks passed: Windows PowerShell 5.1 and bundled PowerShell 7 parsers, `node --check`, Prettier, ESLint and the diff check. A focused identity test passed. None of the #499 cases ran at that point ([author report](raw/claude-window/a2-windows-chain/REPORT.md.txt)).
- **Interim independent review (Claude Opus 5.5): CHANGES REQUIRED** with one docs-only P2 and three P3s ([review](raw/claude-window/r1-interim-review/REVIEW.md.txt)).
  - **F1 (P2):** the #499 link subtests need file symbolic links, which was undocumented. Fixed in `9f11b6e6`.
  - **F2 (P3):** the refusal depends on the reparse bit being visible, and a standard PowerShell 7 install was not measured. Deferred to the still-open #499.
  - **F3 (P3):** the decisions index misses 12 ADRs and no gate checks it. Deferred as a follow-up candidate.
  - **F4 (P3):** output refusals derive the parameter name from array position. Deferred as a follow-up candidate.
- The opposite-family GPT review of these commits, and of `ac007e38`, `9f11b6e6` and `a068a7b4`, is still owed.

## Integration

The branch was merged with main `4e1037c9` as `ac007e38`. Only `CHANGELOG.md` conflicted, resolved as a union in main's order ([integration report](raw/claude-window/w1-windows-integration/INTEGRATION.md.txt)). On the merged tree:

- the whole repository built (12/12 tasks);
- the focused instance-identity and Thread route tests passed (32/32), and both launcher-identity cases passed;
- typecheck, lint, format, layers, dependency, QA-packet and generated-docs checks passed;
- `Launcher.cs` and `NativeChecks.cs` compiled with zero warnings under the installer's and acceptance suite's `csc` arguments, including `/warnaserror+` ([compile summary](raw/claude-window/w1-windows-integration/native-compile.summary.txt)).

## Independent native QA of `9f11b6e6`

A separate Claude Opus 5.5 QA agent ran the four contract selections once each on Windows 10.0.26300 with Node v22.23.4 and Windows PowerShell 5.1. It used a sanitized environment, a scoped port pool and disposable fixtures ([QA report](raw/w2-native-qa/QA-REPORT.md.txt), [binding](raw/w2-native-qa/BIND.json)). Its verdict was **FAIL**, because of one test defect.

| Selection                              | Result                                                                | Raw                                                                                                                                                                                         |
| -------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API instance identity                  | exit 0, 22/22                                                         | [output](raw/w2-native-qa/1-api-identity/stdout.log.txt), [record](raw/w2-native-qa/1-api-identity/meta.json)                                                                               |
| Launcher identity (#494)               | exit 0, 2/2                                                           | [output](raw/w2-native-qa/2-launcher-identity/stdout.log.txt), [record](raw/w2-native-qa/2-launcher-identity/meta.json)                                                                     |
| Native readiness (#566, #544)          | exit 0, TAP 20/20, every required title, `noAttemptGate: "witnessed"` | [TAP](raw/w2-native-qa/3-native-readiness/stdout.log.txt), [qualification](raw/w2-native-qa/3-native-readiness/tap-qualified.json), [record](raw/w2-native-qa/3-native-readiness/meta.json) |
| PowerShell 5.1 installer, run 1        | exit 1, 6 ok and 4 not ok                                             | [TAP](raw/w2-native-qa/4-windows-powershell-run1/stdout.log.txt), [record](raw/w2-native-qa/4-windows-powershell-run1/meta.json)                                                            |
| Installer run 2, link subtests skipped | exit 1, 6 ok and 2 not ok                                             | [TAP](raw/w2-native-qa/5-windows-powershell-run2-link-subtests-skipped/stdout.log.txt), [record](raw/w2-native-qa/5-windows-powershell-run2-link-subtests-skipped/meta.json)                |

- **#544 calibration.** The quota job read back active limit 3. The setup probe was denied (error 1816). The cold click was refused with one denial and no gateway. The warm click exited 0 with no denial, only the launcher admitted, and the same gateway, leases and sibling afterwards. The final probe was still denied.
- **Installer run 1.** The #498 reinstall subtest failed its cross-install equality (finding F1). The two #499 link subtests failed with `EPERM` at link creation before any installer call: a failed venue prerequisite, not a product result. The other six subtests passed, and so did the parent body, including the final gateway start.
- **Installer run 2.** At the orchestrator's venue decision, run 2 skipped only the two link subtests. It is supplementary evidence for the other subtests. F1 failed again and the other six passed.
- **#536 supplement.** 240 native `--stage-shortcut` calls all passed with AppUserModelID, target and argument readback. Two negative controls were refused ([summary](raw/w2-native-qa/6-stage-shortcut-536-x240/536-stage.stdout.log.txt)). The QA report notes that 0/240 is consistent with the fix but does not prove it.

### F1 and its fix

The QA agent's review classed F1 as a P2 test defect with no product defect ([review](raw/w2-native-qa/REVIEW.md.txt)). The #498 reinstall subtest compared both installed configurations with only `Environment` ignored. Since #566, each install embeds an `Enrollment` whose `Inputs` and `Launch` digests change with `GG_LOG_LEVEL` by design, so the assertion could never pass, and the pinned-shortcut assertion after it never ran. Hosted CI at `9f11b6e6` failed at the same assertion ([job log](raw/w2-native-qa/ci-hosted-run45753412843-windows-job/job-139686296647.log.txt): 50 tests, 48 pass, 2 fail).

`a068a7b4` changes only `tooling/scripts/windows-launcher.acceptance.mjs`. Each install now asserts its own enrollment digests. Across installs, the configuration without `Environment` and `Enrollment` stays equal, the stable enrollment fields are equal, and `Inputs` and `Launch` differ. The pinned-shortcut check runs again.

The fix was run locally before the commit ([TAP](raw/f1-correction/installer-run.stdout.log.txt), [before](raw/f1-correction/run.before.txt), [exit](raw/f1-correction/installer-run.exit.txt)). The run was on `9f11b6e6` with the edit uncommitted, and the record does not hash the edited file. The commit was made 13 seconds after the run ended. Results:

- **#498 reinstall subtest:** ok, including the pinned-shortcut assertion. The other six non-link subtests were also ok, and the parent body's final gateway start exited 0. Hosted CI on the committed `a068a7b4` passed the same subtest.
- **The two #499 link subtests:** not ok, with `EPERM` at symlink creation (the same venue prerequisite), so the parent reported 2 failed subtests (exit 1).
- **Static checks on the edit:** `node --check`, Prettier, ESLint and the diff check all passed ([node](raw/f1-correction/node-check.txt), [Prettier](raw/f1-correction/prettier.txt), [ESLint](raw/f1-correction/eslint.txt), [diff](raw/f1-correction/diff-check.txt)).

## Hosted CI on the current head

Run [45792402211](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/45792402211) tested `a068a7b4` on hosted runners ([run readback](raw/hosted-ci/run-45792402211/run.json)). Its synthetic merge `a3c11ce6` with main `4e1037c9` has the same tree as `a068a7b4` (`7d64cf38`), as the evidence manifest records ([manifest](raw/hosted-ci/run-45792402211/windows-launcher-evidence-manifest.json)). The run concluded **failure**. Browser, Coverage, Gates, Repository checks, Template image and macOS launcher passed; Windows launcher failed.

- **Windows launcher: every native test passed, but the job failed.** The suite reported 50 tests, 50 pass, 0 fail, 0 cancelled and 0 skipped ([job log](raw/hosted-ci/run-45792402211/windows-launcher-job.log.txt)). That includes the #498 reinstall subtest with its pinned-shortcut check, both #499 link subtests, the 19 readiness subtests with #544, the Junction and SymbolicLink checkout cases (#493), the lock-contention and bounded-logs cases and the review1 selection.
- **Why the job failed.** The next step, `windows-launcher-evidence.mjs finalize`, reported `status: "incomplete"` with `missing: ["records-rejected"]` and exited 1. The recorder had rejected 13 of its records: one `fixture` and twelve `cleanup` ([evidence result](raw/hosted-ci/run-45792402211/windows-launcher-evidence-result.json)).
- **Cause, as far as the evidence shows.** In the evidence artifact's observation stream ([observations](raw/hosted-ci/run-45792402211/windows-launcher-evidence-observations.ndjson.txt)), all 13 rejections were written between the end of the bounded-logs case (09:38:33.72Z) and the end of the review1 selection (09:39:07.77Z). The review1 test, added with the warm launcher in `d2093221`, records a `fixture` and calls shared cleanup helpers outside `ciEvidence.observeTest`, and review1 is not one of the recorder's cases. Its records therefore lack the case scope the recorder's schema requires. This comes from reading the source, not from a reproduction. The finalize result of the earlier run at `9f11b6e6` already listed `records-rejected`, next to the F1 failure. This packet changes no code; the fix belongs to the review1 test's CI evidence wiring.

## Not established

- **#566 GUI/PWA arm.** Real Chrome PWA install, window deduplication of overlapping clicks, foreground return of the same window, browser refusal and its diagnostic, and the PWA-only window mutex under real Chrome have not run. The venue and operator for this arm are pending an owner decision.
- **#566 architecture cases without a native test in these selections.** Cutover from a gateway without the launch header, observation of a draining or failed-shutdown gateway, and equality across a real in-place Node or build replacement. Child-PID readiness is observed only through its outcome. No native ReFS or case-sensitive-directory observation backs the R3 correction.
- **#499 Cloud Files and standard PowerShell 7.** Placeholder refusal, non-hydration under the new early source check and the absence of a stage after refusal were not tested with a Cloud Files provider. The reparse-attribute view of a standard PowerShell 7 install was never measured (interim review F2). Commercial sync providers are not covered. The link subtests have not run on a local venue that can create file symbolic links; they passed only on hosted CI. #499 stays open.
- **#536 historical cause.** The intermittent trigger behind the original diagnosis is unresolved, and there is no dedicated maintained regression.
- **Hosted-only evidence.** The #499 link subtests, the checkout-alias case (#493), the review1 selection and the #544 hosted outer-job policy were not executed locally; they rest on hosted CI. The hosted Windows launcher job on the current head is red because of the rejected evidence records described above.
- **Pending gates.** A green hosted Windows launcher job, which needs the review1 evidence records fixed; the opposite-family GPT review of the Claude-window commits (including `9f11b6e6` and `a068a7b4`), the fresh Astra MAX final audit (not before 2026-11-28) and owner acceptance.

## Packet contents

| Folder               | Contents                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `raw/warm-design/`   | Claude design critiques and their exit receipts                                                                            |
| `raw/warm-review/`   | Astra formal reviews 1 and 2, decisions FUP-043, FUP-057 and FUP-072, correction reports and the correction 2 adjudication |
| `raw/installer/`     | Installer formal review 2, #536 formal review 1, component QA report and its root adjudication                             |
| `raw/claude-window/` | Author report for #499, #493, #543 and #494, the interim review, the integration report and the compile summary            |
| `raw/w2-native-qa/`  | Independent native QA report, its F1 review, binding, run records, raw TAP and the hosted job log at `9f11b6e6`            |
| `raw/f1-correction/` | Local re-run of the installer case with the F1 fix and its static checks                                                   |
| `raw/hosted-ci/`     | Hosted CI readback of the current head: run, Windows launcher job log and its evidence artifact                            |

Empty stderr logs (0 bytes each), wrapper scripts, lock sequence logs, fixtures, compiled executables and the per-call #536 result file were not copied. They remain in the delivery evidence folders named in the manifest.

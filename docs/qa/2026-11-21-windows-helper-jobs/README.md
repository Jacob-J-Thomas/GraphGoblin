# Windows helper-job lifetime QA

**PASS for bounded independent native QA: 23 criteria PASS, 0 FAIL, 8 LIMIT.** This is not a
claim that all 31 criteria were independently exercised. Genuine Claude Code Opus 5.5 xhigh
completed at source `11214dadbde049af01dd0280b9b701ad10a0f50a`, tree
`409fc7e0fcefd23b68541926ad72cfbfe70d5244`, against signed target
`47ca4640793a81efa5bec661dba25627de314774`. The terminal was inspected after actual exit 0;
provider terminal report SHA256 is `86c4337ada17cc4b41a0ec8b190b9f20f50e65ff6b10b35429a8f7ab85ab9209`.

## Runs and retained corrections

| Lane                                         | Actual outcome                                                                                                                                                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original formal baseline                     | 20 cases: **10 passing controls, 10 expected failures**, zero setup faults. The original 9/11 report headline remains preserved; original summary/cases establish 10/10.                                                         |
| Matched candidate, unchanged baseline driver | **20/20 pass**, zero setup faults; 23 baseline-failing assertions now pass, 66 baseline-passing assertions stay passing.                                                                                                         |
| Candidate inside compatible enclosing job    | **20/20 pass**, same unchanged driver.                                                                                                                                                                                           |
| Frozen extended candidate                    | **11/11 pass**, zero setup faults.                                                                                                                                                                                               |
| Same extension on main                       | 9 expected baseline failures, 1 control pass, 1 wrong baseline prediction, zero setup faults. The compatible-job short-child assertion also passed on main because another member held pipe EOF; it does not discriminate there. |
| Earlier extension development                | First run 9 passes/2 setup faults in incompatible-job fixtures; setup-only correction was frozen before formal runs. The second development check passed 2/2. Both remain recorded.                                              |
| Maintained helper control                    | The candidate checkout's unmodified `NativeChecks --helper-checks` passed; its scope stays separate from independent fixture runs.                                                                                               |

The [combined map](acceptance-map.json) links baseline cases to actual candidate outcomes. The
[original independent matrix](candidate/acceptance-map.json) retains all 31 statuses and evidence
references. The [candidate packet](candidate/README.md) and its raw JSON retain first results,
including development faults and the extended-baseline prediction mismatch. All 345 baseline and
826 candidate original manifest entries were verified without changing their files. This archive
contains public subsets; private raw configs, process streams and runtime handshake/privacy
tokens remain private.

## Native interpretation and explicit limits

Fixtures substitute scenario helpers/gateways in disposable trees. The real lane uses the built
helper/API, real WMI and normal gateway drain. Exact retained handles and creation/exit facts
bind only driver-owned processes. Launcher collection and driver teardown remain distinct;
release/watchdog teardown cannot satisfy a collection requirement.

The driver's `exitedBeforeLauncherExit` boolean allows **32 ms OS timestamp slack**
(`EXIT_SLACK_MS`). It is not strict chronological-before proof. Use the numeric
`exitedRelativeToLauncherExitMs` together with that tolerance. An abrupt creator-death sample
contains **+5ms** and boolean true: this is measured cleanup after creator death, not contradictory
data or proof that termination happened before death. Keep the original numeric records.

| Independent LIMIT | Retained boundary                                                                                                                                                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C14               | Effective outer UI restrictions permitted the tested nested creation on Windows 11. The UI-only nesting-refusal premise remains unestablished. D163 accepts this compatible control plus a separately verified active-process-quota refusal; it does not turn C14 into PASS. |
| C25               | The 2 s cleanup-unconfirmed expiry and completion-owner transfer were not natively exercised; source/cleanup-confirmed maintained control only.                                                                                                                              |
| C26               | Full simultaneous-outcome precedence remains source evidence.                                                                                                                                                                                                                |
| C27               | Other Win32 fault seams and atomic assignment before the first machine instruction remain source/API evidence. 58/58 first helper handshakes were already in a job; this is an observed positive, not instruction-level measurement.                                         |
| C28               | `--validate-install` was **not run at all in the independent pass**. Supplemental compatible-host validation is separately attributed.                                                                                                                                       |
| C29               | Dialog rendering and the remaining independent concurrency/host/replacement/store/WMI-negative matrix were not exercised. Specific supplemental observations do not cover every variant.                                                                                     |
| C30               | First-WMI-after-boot provenance is unknown.                                                                                                                                                                                                                                  |
| C31               | The WMI service/provider process was not witnessed. Queried-process or gateway survival is not service-process evidence.                                                                                                                                                     |

[D163's accepted evidence amendment](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/459#issuecomment-7055986230)
retains the original UI-specific limit. The active-process-limit probe observed actual creation
refusal; cold and warm clicks then returned `helper-containment` before a helper started, while
preserving the unrelated sibling/sentinel and the existing fixture gateway. No host privilege
or production job flags were changed to manufacture the UI premise.

## Supplemental evidence stays separately attributed

The [author-supplied, parent-verified mapping](supplemental/REPORT.md) and its
[verbatim map](supplemental/map.json) bind 25 dispositions to exact source and hosted artifact
rows. It is not a new independent QA run. The parent checked 8 inputs, 6 committed sources and 97
referenced observations against the original 304-record corpus.

For C28, the compatible hosted child actually ran `--validate-install` successfully. The installer
ordering is partly source evidence; no capability-failure publication refusal was observed at
that seam. For C29, named hosted concurrency, identity/refusal and managed text/privacy controls
supplement only their precise claims. They do not establish a live replacement-owner swap,
valid-record WMI failure/timeout, `store-acquiring`, or a rendered error dialog.

Two Computer Use bootstrap attempts failed before application initialization; no fixture or app
was opened and no UI action occurred. The [verbatim receipt](supplemental/ui-bootstrap-result.json)
therefore records **visual evidence NOT PERFORMED**, not a candidate failure. NativeChecks
public-method privacy tests and the source's use of the same sanitized message for stderr and
MessageBox are separate text/source evidence; they provide no window pixels, layout or modality
observation. C29's visual limit remains.

[D164's accepted bounded disposition](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/459#issuecomment-7056081015)
permits proceeding through the technical gates with the scoped native and hosted observations
and compiled shared-message privacy proof. It retains **visual dialog NOT PERFORMED** for the
consolidated owner review and QA. Source-only limits remain review obligations; D164 waives no
technical assertion or delivery gate.

## Initial source CI and failed local aggregates

[Initial CI run 44849433190](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44849433190)
passed **6/6 jobs** at the exact product source above: **10,032 unit tests, 52 skips, 488 browser tests,
26 Windows cases and 304 canonical native records**. Tested merge
`bd57a85061b9433c268021e5ca76635148698075` has the same tree as the source. The
[concise receipt](initial-ci-summary.json) includes original verifier, coverage and native ZIP/member
hashes. This is initial-source CI, not CI for the as-yet-unknown final QA publication head.

The [retained local summary](local-checks-summary.json) keeps full `pnpm check` and full tooling
coverage **FAILED**. Infrastructure had 52 failures: 47 symlink fixture EPERMs, 2 mode assertions,
2 SQLite cleanup EBUSYs and 1 audio-fixture ENOENT. The latter cleanup/fixture causes remain
unresolved. Plugin/engine timing failures and later isolated passes are separate observations;
the original perf timeout and identity-child failure are not erased by the later 2/2 identity pass.
The local native 24/26 includes one symlink prerequisite plus its parent, and early binaries are
mixed-source development controls; only the late bounded-log root compiled at the frozen head.
No single host cause is asserted for all failures. D162 retained existing thresholds, timeouts
and assertions and used the required hosted platform lanes as separate evidence.

## Byte preservation and remaining gates

Raw JSON/JavaScript/TypeScript/C#/PowerShell bytes remain unchanged. Only Markdown convenience
copies are formatted. Raw source documentation is saved as `README.original.txt`; restore that
filename as `README.md` in a disposable replay copy for original bundle hashes. Historical
source-hash receipts refer to those original documentation bytes, while archive manifests bind
the final formatted convenience copies. The supplemental author report is explicitly derived
from sealed CP1252 into UTF-8, with one corrected raw-job-log reference and original/public hashes;
the supplemental map retains its original CRLF bytes under the parent's raw archive attributes.

The baseline submanifest is unchanged. Candidate and root archive manifests bind this integrated
snapshot. No tests, native reproduction, permission/race diagnostic, instrumentation, formal
scan, staging, commit or publication was performed for this evidence integration.

Opposite-family review, final publication-head/current-target checks, fresh final audit and signed
merge remain parent-owned. D160's consolidated owner decision review and any rework are still
before owner QA; no personal plan-approval signature is claimed. D163 changes an evidence fixture,
not those technical gates, and the separate #460 hold remains. This bounded QA PASS is not merge
approval, visual QA completion or owner acceptance.

# Intent 1 execution — dependable delivery gates

The owner authorized starting the five intents now, in order, while keeping all technical
gates. [Sequencing amendment](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/279#issuecomment-6969001971).
The [five-intent register](2026-11-17-five-intents-register.md) owns the accepted scope.

## Contract

Make supported checks execute reliably, retain useful native CI evidence, and prevent test
fixtures from interfering with later work. Preserve all required checks, the full workload,
coverage floors, assertion semantics, browser no-retry policy and ownership of unrelated
processes/files. Begin with discriminating observations; an unreproduced report does not
require manufacturing a code change.

Base: main `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1`. Each implementation uses an isolated
`codex/gg-20261117-*` branch. Root owns this register and publication. Implementers do not
stage, commit, publish or merge; root integrates only the reviewed, verified bounded result
under the owner's existing delivery authorization. Commits carry no assistant attribution.

## Units and ownership

| Unit | Issue | Implementation responsibility                                                       | Initial state                                                |
| ---- | ----- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| U1.1 | #495  | GPT 6.1 Sol xhigh, `i1_entry_495`                                                   | Supported-command alias diagnosis, then warranted correction |
| U1.2 | #488  | GPT timing/architecture diagnosis; actual Claude Code Opus 5.5 xhigh implementation | Read-only timing and workflow design                         |
| U1.3 | #496  | GPT evidence-contract design; actual Claude Code Opus 5.5 xhigh implementation      | Native artifact retention diagnosis/design                   |
| U1.4 | #407  | GPT 6.1 Sol xhigh, `i1_ports_407`                                                   | Test-worker port ownership diagnosis and correction          |
| U1.5 | #466  | Actual Claude Code Opus 5.5 xhigh                                                   | Probe fixture ownership/settlement implementation            |
| D1   | #453  | GPT 6.1 Sol xhigh diagnostic lane                                                   | Admitted; waiting for bounded diagnostic capacity            |
| D2   | #489  | GPT 6.1 Sol xhigh diagnostic lane                                                   | Admitted; waiting for bounded diagnostic capacity            |

Independent units may proceed concurrently within this intent. U1.2/U1.3 share workflow
ownership and must be integrated coherently; no two implementers may edit that workflow
simultaneously. Tests and evidence commands use the supported project Node 22 runtime and
pnpm, and preserve first-attempt/failure provenance. Heavy local checks are bounded to avoid
unnecessary resource contention.

D1 and D2 each have an initial budget of retained-evidence inspection plus at most two
discriminating disposable reproduction attempts. Record established causes and a bounded
correction, or explicit unresolved disposition and next prerequisite. No unrestricted retry,
speculative timeout increase, disabled assertion or indefinite diagnostic loop is authorized.

## Gate accounting

No formal review scan has run for a new intent 1 PR. Every resulting PR retains the maximum
of three total formal scans, including opposite-family review and the reserved fresh
independent Astra MAX final audit. Separate independent behavior QA uses a distinct context;
implementation checks and diagnostic design do not complete that gate. Exact reviewed head,
target, changed-file ownership, findings and dispositions must be recorded before delivery.

GPT implementation is independently reviewed by actual Claude Code; Claude implementation
is independently reviewed by GPT. Claude also handles suitable behavioral/native QA and
adversarial tasks. A frozen coherent candidate precedes formal review; new findings are
batched by root cause and verification is meaningful to the affected behavior.

Required checks include the applicable targeted regressions/negative controls, coverage,
typecheck, lint, architecture/licence/docs checks, touched-system acceptance and current-head/
current-target CI. Changes to supported workflows require actual hosted CI; Windows artifact
acceptance requires downloading and inspecting the archive bound to that run/head/job.

The high picomatch advisory in [#503](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/503)
currently blocks a passing dependency-audit gate. This is a separate prerequisite and not
an exemption or a reason to misreport a run as green. Preserve every gate until a conforming
resolution is verified. No next-intent implementation, dependency-policy change or model
substitution is implied by intent 1 admission.

## Protected work and deferred states

The Mac QA work remains with the owner's local Mac session. PR #501 stays independent,
with two of its three formal scans consumed and final audit pending. PR #460's owner hold,
the installed Windows app/store, unrelated dirty work and reserved ports 4747/4748 are
untouched. Owner acceptance and closure obligations remain separate from engineering.

## Implementation checkpoint

U1.1 has a candidate using native `import.meta.main` in three CLI entry points. The supported
pnpm commands rejected deliberately invalid inputs through the tested Windows junction at
baseline; direct Node invocations silently skipped work, including the documented summary
CLI. The correction passes its red/green controls and all 182 tooling tests with 96.99% line
and 91.77% branch coverage. Root verified all 169 evidence entries and five candidate source
hashes. A first full run failed because the new sparse checkout omitted a tracked contrast
fixture; restoring that exact baseline file resolved it in one unchanged rerun. Both runs
remain recorded in the [implementation packet](../qa/2026-11-17-entry-495-implementation/README.md).
Independent behavior QA by GPT 6.1 Sol xhigh, `i1_entry_495_qa`, passed all 60 public-command
checks in a separate checkout. Its own first harness run incorrectly expected forward slashes
in native Windows diagnostics; the corrected matcher passed without a candidate source
change, and both attempts are retained in the [QA packet](../qa/2026-11-17-entry-495-independent-qa/README.md).
Formal review and hosted CI remain pending.

U1.2/U1.3 have a GPT-authored timing and evidence contract and are being implemented by
actual Claude Code Opus 5.5 xhigh. U1.4 has a controlled two-worker red/green witness against
the unchanged built API and is completing whole-package verification. U1.5 is being
implemented by actual Claude Code Opus 5.5 xhigh with deterministic lifecycle controls.

D1's diagnostic path is already shipped and passed its focused synthetic regression. The
original Linux child failure remains unexplained because its exit code and signal were not
captured. D2 passed the seven native reset-tree tests and one controlled metadata-handle
rename; the historical `EPERM` remains unreproduced. Its two-attempt budget is consumed.
Neither investigation warrants a code change. Root verified the 21-file diagnostic evidence
manifest in the [diagnostic packet](../qa/2026-11-17-gate-diagnostics-453-489/README.md).
#453 retains owner-only closure. These are bounded dispositions, not claims that
the original failures have been fixed.

No new intent 1 unit has completed formal review, merged or closed. #503 remains an explicit
audit blocker; its fresh read-only dependency investigation cannot change policy or waive CI.

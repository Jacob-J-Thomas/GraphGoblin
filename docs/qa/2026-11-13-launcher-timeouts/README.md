# Windows launcher timeout investigation

Base: `b3b5e1874a8252cc01c065d18fef42cbfbe075b4`.

Tracking: [#458](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/458).

## Change contract

The owner requested investigation and a preventive fix for launcher timeouts, using the
repository's AIDLC pipeline with adversarial Claude reviews at key checkpoints.

Outcome: correct shortcut and taskbar launches tolerate supported slow startup and cannot
deadlock on helper output; failed checks remain bounded and identify the failed stage.

Scope: Windows launcher helper execution, its read-only API helper if evidence warrants,
native regression tests, diagnostics, documentation and local installation verification.
Preserve one writer per canonical store/database, fail-closed ownership, runtime/configuration
identity checks, detached gateway lifetime and managed shutdown. Never use owner data for
regression tests or infer stale ownership from a timeout. No reset, permission changes,
supervisor, autostart, installer redesign, or unrelated parked #434–#438 work.

Authority: investigation, implementation, Claude provider reviews, disposable tests and the
requested local repair are authorized. The invoked PR pipeline covers a branch, commits and
a reviewable PR. Merge remains subject to explicit owner authorization after a concrete
reviewed candidate exists. No owner gateway restart is necessary during diagnosis.

Verification: controlled native reproduction against the baseline; focused regression tests;
`pnpm build`, `pnpm check`, formatting and native launcher acceptance; independent QA and
Claude diagnosis/design review followed by one stable implementation review and at most one
targeted correction review (a third implementation pass only for a new introduced blocker).
Use Node 22.23.4 throughout. Record exact head and raw evidence. Owner shortcut behavior
after a clean gateway stop is distinct from warm focus/reuse.

## Incident evidence

- Launcher errors at 2026-11-13 19:03:02 and 19:03:59 America/Chicago report the generic
  read-only identity/ownership helper timeout. Both correspond to the fixed 15-second
  `ReadHelper` wait; the old log does not distinguish which helper ran or record its output.
- Desktop, Start-menu and taskbar links use the same installed launcher/configuration.
- The owner subsequently started the executable successfully and confirmed both shortcuts
  work again. Gateway PID 33348 served health, management and Goblin shells successfully.
- Warm direct helper observations: identity 1.49 s, ownership 1.92 s. These do not establish
  the duration or cause of the earlier failed attempts.
- Source waits for exit before draining stdout and never drains stderr; both can fill a
  redirected pipe. Both helpers also load the SQLite barrel and have a fixed outer 15-second
  deadline independent of the configured 60-second startup timeout. Ownership can perform
  several individually bounded WMI queries. These are hypotheses until reproduced.

## Reproduced defects

The public native CLI regressions in `tooling/scripts/windows-launcher-helper.acceptance.mjs`
both fail against the unchanged baseline source: a helper that emits a valid identity after
filling stderr times out, and an otherwise successful 16-second helper is killed despite a
25-second startup setting. Raw results: `baseline-helper-tests.txt` (0/2 pass, expected).
The pipe wait order also matches Microsoft's documented
[redirected-stream deadlock](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.standardoutput?view=netframework-4.8.1).

Independent QA exercised the actual built ownership helper using four valid stale records
and a disposable PowerShell stand-in returning four successful creation identities in 4.1
seconds each. The helper correctly reported `free` in 18.12 seconds; the baseline launcher
with a 60-second startup setting aborted after 16.61 seconds. No gateway was started and all
four records remained byte-identical. A separate single 7-second query remained correctly
`held` under the existing 5-second foreign-process deadline. Real WMI resolved the four
stale fixtures in 3.20 seconds. The repair must retain that conservative timeout behavior.

Warm identity and free-state measurements were 1.37–1.73 seconds. Importing the SQLite barrel
cost 1.34–1.52 seconds versus 1.19–1.31 seconds for its database module. This does not explain
the historical 15-second stall, and narrowing that import alone offers little benefit. No
API dependency/path refactor is justified for this repair.

## Ledger

Diagnosis/design review: complete, Claude Opus 5.5 xhigh, session
`88cebc97-e2f9-420e-b580-adb0e19d5200`, base `b3b5e187`; raw response and report are
`claude-diagnosis.json` and `claude-diagnosis.md`. The design was reviewed against the baseline
and provisional test/contract; implementation began once controlled reproductions were available,
and the report's accepted constraints were incorporated before stable verification.

Accepted (`FIX-IN-PR`): concurrent chunk drains; one monotonic exit/EOF budget; bounded UTF-8
stdout with overflow refusal; stderr counts only; a 15-second helper floor preserving existing
short readiness settings; remaining-budget ownership retries and no redundant final check;
stage-specific errors and cleanup-race handling; slow-success metadata; CI wiring and adversarial
tests; replacing only the installed executable, preserving configuration. These are inside the
owner's repair scope, including pre-existing causes directly exercised here.

`NO-CHANGE`: dependency/path extraction has no measured need for this repair; distinct public
helper exit codes are unnecessary for the accepted stage/exit diagnostics.
`DEFER-ISSUE`: [#459](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/459) tracks the existing
helper-descendant lifetime limitation after timeout (P2). A job-object or equivalent owned-tree
protocol is a separate native lifecycle change; no claim of automatically terminating arbitrary
descendants is made. Original ownership probes and their fail-closed 5-second policy remain
unchanged.

Additional incident check: the Windows PowerShell lifecycle log contains four events between
19:00 and 19:06 local time, all for PID 33348 after the successful launch (400/403 at
19:05:08.413/09.278 and 19:05:17.985/18.316; records 9927039/40 and 9927047/48). No WMI helper
start is recorded during either failed click. User, machine and this process had no
`NODE_OPTIONS`; no power/resume event was found in the queried 18:50–19:06 window. The successful
gateway's process creation preceded the record's `startedAt` by 9.53 seconds; source creates
that timestamp before awaiting its own WMI query. This supports slow pre-query startup/imports
as the leading incident explanation, not a proved exact cause. The old logs cannot identify
the stalled helper or Windows scheduling/IO condition.

Independent QA: `qa-candidate.md` records 4/4 ownership CLI cases plus actual built-API slow
ownership/start/health/both-shells/managed-drain proof at the recorded source hash. A native
Win32 fixture proves bounded inherited-pipe closure; the first Node descendant fixture did
not reliably preserve the handles, so it was replaced rather than counted as evidence.

Gates: initial build 11/11 passed. Native launcher acceptance passed 24/24 in 212 seconds
(`native-final.txt`), followed by an added UTF-8 held-path assertion passing in its targeted
native check. Tooling lint and repository format check passed. First `pnpm check` stopped on an unrelated adapter-codex
5-second test timeout and its following mock-cleanup assertion under concurrent coverage load
(`check-first-attempt.txt`). The same package's isolated coverage run passed with 99.42% lines
and 95.61% branches; no adapter source or test was changed. Sequential complete coverage then
reached unchanged infrastructure tests that require symlink privileges and POSIX file semantics
unavailable in this Windows session (47 EPERM errors, plus path/mode and SQLite cleanup failures;
52 failing tests in total). `coverage-windows-attempt.txt` preserves the run. No assertions,
permissions, exclusions or coverage thresholds were changed. Typecheck, lint, layers,
migrations, token/dependency rules passed before the first coverage attempt; templates,
licenses, generated docs and contrast checks also passed. The complete Linux CI gate and
Windows CI job are required on the published candidate before delivery.

Stable implementation review pass 1: Claude Opus 5.5 xhigh reviewed exact candidate
`4ba9031a7b6b61b8f31dd3cccd5c4e2a44270925`, session
`1b6e31a3-5929-45e0-9e4b-1525c46ca99c`; raw response and report are
`claude-implementation-pass1.json` and `.md`. All four CI jobs at that candidate passed
([run 43542440710](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43542440710),
`ci-pass1.json`). The implementation review requested two corrections before readiness:

- `FIX-IN-PR` F1: after a valid held result, an inconclusive retry must retain the complete
  no-second-gateway/do-not-stop/do-not-delete guidance. The correction shares the held refusal
  text and adds only release timing to a failed recheck, without suggesting WMI is broken.
  Three native cases exercise persistent 800 ms held replies with a four-second release wait,
  then failed-exit and malformed-result retries. A note on #459 records that helper termination
  near the release deadline also exposes its existing descendant-lifetime limitation.
- `FIX-IN-PR` F2: an oversized result must have a valid retained prefix. The fixture now sends
  identity plus 300,000 whitespace bytes plus a private sentinel. Without the size guard,
  trimming the retained prefix produces a valid identity, so the corrected test must fail.
- `FIX-IN-PR` small documentation order correction: introduce the native suite before the
  supplementary helper suite.
- `NO-CHANGE` uncommon anonymous-pipe exceptions: no reachable failure beyond the handled I/O
  and disposal cases was established, and unexpected errors still refuse startup. Broad exception
  taxonomy is not required for these two corrections.
- `NO-CHANGE` optional fixture-artifact retention: the helper fixtures are disposable protocol
  inputs, and CI retains assertion/timeout output in its job log. This patch does not promise
  durable copies of every fixture directory. Source/replay and local raw results are preserved.
- `DUPLICATE-STALE` descendant cleanup: already deferred as #459; no new safety blocker found.

The correction's launcher source SHA-256 is
`198d226e2ca5253796613a53b05b9247949ed8e63dc86cdab540faf2d2d22bee`.
Independent correction QA includes mutation checks: removing the size guard fails the overflow
test, and restoring the old catch fails both deterministic recheck guidance cases. See
`qa-correction.md` and its raw/replay artifacts. The complete corrected native suite passed
27/27 in 208 seconds (`native-correction.txt`); tooling lint and changed-file formatting passed.
One targeted Claude correction review remains;
the review budget is one full implementation review plus this targeted pass.

PR: [#460](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/460). Final CI, targeted review and
local repair outcomes will be recorded in its discussion at the exact final head. The exact
historical stall remains unconfirmed; synthetic reproduction demonstrates repair of reachable
defects, not historical causality. No owner service/store/configuration has changed at this
commit. Merge remains subject to explicit owner authorization.

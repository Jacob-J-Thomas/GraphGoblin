# ADR-0086: Windows launcher helpers own a private job

Status: Selected under delegated coordinator authority (D160); consolidated owner review pending.

## Context

Read-only launcher identity and store checks can create PowerShell processes. Waiting for Node
before draining stdout can deadlock, unread stderr can fill, inherited writers can prevent EOF,
and descendants can survive Node with neither pipe open. Killing a PID tree cannot establish
generation-safe ownership. The detached gateway has a separate lifetime and logging contract
(ADR-0081). The independently reviewed plan is on [#459](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/459#issuecomment-7033190957).
D160 changes only the timing of that plan's human review; see the batch register.

## Decision

Each helper gets an unnamed, non-inheritable Windows job with kill-on-close and no breakaway.
One hidden `CreateProcessW` assigns it through `PROC_THREAD_ATTRIBUTE_JOB_LIST`, alongside an
explicit handle list containing only readable NUL stdin and the two writable pipe ends.
Assignment occurs before helper user code. Process/thread handles and attribute backing storage
have one owner. The gateway continues through its separate detached launch with NUL stdio.

Windows 10 or Windows Server 2016 or later and compatible enclosing jobs are required. Staged
installation validates attribute capability before replacing configuration or shortcuts. Every
click actually starts the identity helper in its job before attempting gateway reuse, so an
incompatible host refuses even a warm click; an existing gateway remains callable directly.
This avoids a user-mode suspended-process assignment gap. Windows promises no transactional
rollback for arbitrary interruption inside the creation system call.

The parent concurrently drains two random, first-instance, single-client local byte pipes with
an ACL restricted to its identity. Remote clients are rejected and the connected writer's PID
must be the launcher. Parent readers use overlapped I/O; child writers block normally. Each
reader has one fixed buffer and at most one outstanding operation. Stderr is discarded and
stdout retention is capped at 256 KiB. Strict UTF-8 and the complete stage protocol are validated
inside the work window. Success requires the exact root's natural zero exit, both EOFs and zero
active processes from private-job basic accounting. Ordinary short-lived members may quiesce
within that same window. Observers retaining handles do not change the decision rule.

Monotonic time bounds helper setup, creation, process/EOF/job observation and validation. The
initial identity and ownership checks each retain main's 15,000 ms cap. Four sequential 5,000 ms
WMI lookups across locks and guards can exceed it; a legitimate slow first check therefore still
refuses. Exhaustion never means stale ownership. Synchronous Windows creation is charged when
it returns and cannot itself be interrupted by the launcher.

After a held result, subsequent ownership checks reserve 2,000 ms of the remaining release
window for cleanup. Their work window is the smaller of 15,000 ms and that remainder less the
reserve. A retry starts only if it can fit the previous completed sample's measured duration or
200 ms, whichever is larger, recalculated after the capped sleep and port probe. A responsive
matching gateway may be reused. Only a valid, in-budget free sample permits a fresh startup.
An inconclusive retry keeps the last held reason, bounded lock location and full refusal advice;
a late release may require another click. HTTP, log and synchronous OS calls have separate limits.

An unconditional finally runs before mutex release, logging or dialog presentation. Unsuccessful
work terminates only the private job with exit code `0xE0470459`, even after Node exits, stops
reads, cancels pending operations and observes their completion. One 2,000 ms cleanup allowance
covers root/job and I/O verification. At expiry the last job handle closes and any outstanding
operation transfers its SafeHandle, OVERLAPPED, event and buffer to a completion owner. A cancel
request alone never proves completion and storage is never freed while Windows can use it.

[D166](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/459#issuecomment-7056880570)
clarifies two boundaries after the final source audit. Ownership is parsed once as a flat strict
JSON object of the exact free/held string fields, from raw decoded output before trimming.
Property names are decoded before duplicate and allowlist checks. Legal JSON whitespace, field
order, Unicode and path escaping remain supported; no serializer round-trip equality or general
parser dependency is introduced. Identity retains its existing padding behavior. Cleanup elapsed
time is sampled after the complete root/job/stream observation pass and must be strictly below
2,000 ms to credit confirmation. Later safe disposal never upgrades an expired outcome. The
shared deterministic observation/clock checks establish that timing decision, not a kernel race.

Closed failures distinguish containment, runtime unavailability, stage timeout, natural nonzero
exit, invalid protocol and unconfirmed cleanup. At a decision point unconfirmed cleanup leads,
then retained held guidance on an inconclusive retry, expired work, known natural nonzero exit,
and invalid output. A cleanup exit is never described as a prior natural exit. No raw output,
exception or configuration value reaches the dialog, bounded log or typed native evidence.

## Consequences and evidence

WMI's service, a queried process, provider sessions and the gateway are outside this job. No
permissions, store formats, lock policy or supervision service change. Held PR #460's wider
initial allowance and slow-success diagnostics remain excluded; a later reconciliation must
rebase onto this job and ADR-0081 under its own owner decision.

Native acceptance uses disposable stores and ports, generation-specific exact fixture handles,
parent-death-insensitive descendants, same-executable survivors, separate stream inheritance,
protocol/flood/deadline controls, held-store transitions, actual WMI, enclosing jobs and creator
death. Job accounting is launcher self-observation; exact native handles independently witness
termination within the shared allowance. Cold WMI is claimed only with first-use-after-boot
provenance; otherwise measurements are fresh-runner observations with prior use unknown.

On the tested Windows 11 build, effective outer-job UI restrictions still permitted the
launcher's nested creation shape. [D163](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/459#issuecomment-7055986230)
refines the original UI-incompatibility acceptance case into that measured compatibility
control and a separate active-process limit that actually refuses creation. Cold and warm
refusals occur before helper execution while unrelated processes and the existing gateway
survive. UI-only nesting refusal remains unobserved on this host. This evidence refinement
does not change the private job's flags or establish behavior on every supported Windows build.

Microsoft references: [process attributes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute),
[nested jobs](https://learn.microsoft.com/en-us/windows/win32/procthread/nested-jobs),
[overlapped completion](https://learn.microsoft.com/en-us/windows/win32/api/ioapiset/nf-ioapiset-getoverlappedresult),
and [cancellation](https://learn.microsoft.com/en-us/windows/win32/api/ioapiset/nf-ioapiset-cancelioex).

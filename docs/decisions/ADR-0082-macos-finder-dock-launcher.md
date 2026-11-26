# ADR-0082 - Per-user macOS Finder and Dock launcher

Date: 2026-11-16. Status: Accepted architecture for #456, following the
[owner-approved plan](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/456#issuecomment-6872747350).
The owner clarified that its “in-app shutdown” wording means the existing authenticated shutdown
API, with no new web control ([approval](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/456#issuecomment-6935644999)).
Extends the checkout installation and bounded logging described in
[ADR-0081](ADR-0081-bounded-windows-launcher-logs.md).

## Problem

A Finder or Dock launch has no terminal's environment or process lifetime. Opening a browser
address alone cannot establish that the intended checkout and store are ready, and keeping
the gateway attached to a launcher would interrupt work when the launcher exits.

## Decision

Ship a Swift AppKit application for Apple Silicon macOS 15 or later. The public installer is
`scripts/install-macos-launcher.sh`; it compiles from an already built checkout using Swift 6,
then installs a per-user `~/Applications/GraphGoblin.app`. Installation saves the physical
checkout, native arm64 Node 22.22.2 or later within major 22, local data directory, port and
the closed set of supported options. The launch uses these saved inputs without a login shell.
Node and the checkout remain external prerequisites. This is not a signed distribution,
automatic updater, login item or dedicated PWA-window implementation.

**Validate, observe, then start once.** One monotonic 60-second gateway admission and observation
budget begins before preflight.
Graphical and `--ensure-gateway` entry points also arrange an independent completion watchdog,
eligible one second after that budget. This tail permits a reached refusal and best-effort
diagnostic to finish; it never extends admission or permits a late management handoff. A system
call blocked by an unresolved macOS privacy decision cannot leave the attempt awaiting that call
indefinitely: the watchdog answers from the synchronized attempt state without filesystem I/O.
It reports uncertainty for an already committed spawn, which may still complete. It does not
stop a worker thread or release that thread's locks; those remain held until the call returns or
the launcher process exits. Timer scheduling and system sleep can delay delivery, so this is not
a strict wall-clock launch promise. The presentation's existing Show Log offer remains separately
bounded, and a blocked filesystem can leave no diagnostic for the abandoned attempt.
Bounded helpers establish the effective instance fingerprint and authoritative store ownership.
Cooperating launcher locks serialize admission across the canonical directory, database and
port, but the API's two writer leases remain authoritative. A fresh connection refusal and
fresh free-store observation are required before the synchronized spawn commitment. A Quit
that wins that guard prevents a start. After commitment there is never a second spawn or a
gateway termination request from the launcher.

A matching service must provide its exact health response, fingerprint, PID, phase and both
built HTML shells, followed by a fresh identity/phase check. Active drain and failure phases
open the existing management page to observe state. The browser's Wait and Force choices are
available only after a drain initiated elsewhere reaches the API's choice phase; they use the
existing authenticated shutdown API. The launcher adds no web control. Final release phases
wait for observed release. Unknown listeners, malformed observations and held or uncertain stores
refuse conservatively. Child exit, definite spawn failure, startup timeout and unverified
startup are distinct outcomes. Direct `posix_spawn` uses a new session, close-on-exec defaults,
null standard descriptors and the saved checkout as child cwd. The gateway outlives the app
and browser. Only owned read-only helpers can be cancelled and reaped.

**AppKit owns presentation.** The engine exports closed stage/outcome enums and numeric ports,
never raw helper errors, paths or response URLs. A delayed progress panel can be hidden while
the attempt continues; Finder or Dock reopen raises the existing state. Quit requests
cancellation synchronously and suppresses subsequent presentation and browser submission.
Repeated Quit preserves the same bounded cleanup wait. The default browser receives exactly
one literal IPv4 loopback `/app/` URL with a separate 10-second acknowledgment deadline.
OS acceptance is not page-load evidence. Rejection and missing confirmation offer Copy Address;
launch failures may offer a revalidated Show Log in Finder action. There is no in-process retry.

**Managed installation has independent ownership.** An alternate `GraphGoblin <suffix>.app`
receives a distinct installation ID, bundle ID and log directory. A private receipt under
`~/Library/Application Support/GraphGoblin/LauncherInstalls` binds the application name and
physical identity to the expected bundle contents; an Info.plist value alone proves nothing.
The installer validates an exclusively created same-volume staged bundle before publication.
It serializes on the physical Applications directory and uses exclusive publication or atomic
exchange of a verified managed target. During replacement the receipt witnesses both complete
generations. It retains recoverable old bytes until final verification, and never removes a
foreign or uncertain target or sweeps an earlier interrupted stage. Failure guidance distinguishes
a verified previous install, a verified absent target and recovery requiring inspection.

**Private bounded logs share the existing writer.** The gateway writer moves to
`apps/api/src/managed-log` with the same record, queue, rotation and failure behavior. The
Windows adapter and its log protocol remain unchanged at version 1; the separate opaque
instance protocol remains version 2. The Mac entry declares
`export const MACOS_LAUNCHER_LOG_PROTOCOL = 1;` within its first 4 KiB and consumes the reserved
`GG_MACOS_LAUNCHER_LOG_ADMISSION` before application loading. Its closed snapshot binds the
physical private APFS directory and unsigned 64-bit device/inode values. Swift validates
descriptor ownership, mode and ACL state. The API takes the directory's Darwin exclusive
reservation through a numeric FD, rechecks identity and file metadata, then adopts the shared
writer. Only actual `EAGAIN` contention is retried, for at most 1.5 seconds.

The standard log directory is `~/Library/Logs/GraphGoblin/Launcher`; alternate installs use
`~/Library/Logs/GraphGoblin/LauncherInstances/<id>`. Gateway logs retain two 4 MiB files,
with 64 KiB records and 256 KiB total encoded backlog. Native launcher logs retain two
256 KiB files with 4 KiB records. A non-cancelled failure, including deadline expiry, gets a
best-effort final diagnostic with a separate wait of at most 250 ms. That diagnostic tail
cannot extend gateway admission, submit another helper or authorize a spawn. Quit remains
prompt, and log failure never stops the gateway.

**A detached start requires a local key source.** Saved configuration supports only the local
SQLite file and `<dataDirectory>/master.key`. Existing or indeterminate data without an owned
regular local key refuses. A genuinely empty store may create its first key. The API repeats
this check after acquiring both writer leases and before SQLite or key creation, discounting
only artifacts attested by this attempt's actual leases, exact private records and opened
identities. Attestation ends as soon as release begins. Ordinary shell startup keeps its
existing key-source and database options.

## Verification and consequences

The additive macOS CI lane runs the Swift suites under full Xcode, the affected API tests and
the public installer plus real gateway acceptance on disposable stores and alternate ports.
The existing Windows, Linux and V8 coverage gates remain. Command Line Tools can build the
production component but may lack the Swift Testing module; a failed test discovery is not
a passing suite. Actual Finder, Finder alias, retained Dock pin, browser activation, focus,
keyboard and accessibility observations remain distinct from headless and scripted tests.
Issue #456 and its parent retain the required post-merge owner acceptance.

No stored format or schema changes. Updating a saved checkout or Node location requires
rerunning the installer. Closing either launcher or browser leaves active work running. Stop a
running gateway through the existing authenticated shutdown API; the browser's Wait and Force
choices do not initiate a drain. See [Gateway shutdown](../07-api-and-streaming.md#gateway-shutdown-224).

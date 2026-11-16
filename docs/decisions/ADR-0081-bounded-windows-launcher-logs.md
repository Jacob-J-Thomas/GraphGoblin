# ADR-0081 - Bounded private logs for the Windows launcher's gateway

Date: 2026-11-16. Status: Accepted for #438. Refines [ADR-0064](ADR-0064-windows-desktop-launcher.md)
and [ADR-0069](ADR-0069-windows-lock-process-identity.md); keeps [ADR-0080](ADR-0080-run-failure-diagnostics.md).

## Problem

The launcher passed the detached gateway an append-only `gateway.log` handle as stdout and
stderr. The gateway kept it after the click exited, so the file grew without limit, rotation by
name could leave a live writer appending to an old file, and a later launch could not cap it.
Startup failures before Pino existed reached the same unbounded file, or nowhere useful.

## Decision

**One bounded private writer inside the gateway.** The detached gateway owns `gateway.log` and
`gateway.log.1` in the launcher's configuration folder, at most 4 MiB each. Each record is
complete UTF-8 ending in LF and at most 64 KiB; a larger record becomes a fixed marker. One file
operation is in flight at a time and queued plus in-flight encoded bytes stay at or below
256 KiB; excess records are dropped immediately and a bounded drop summary precedes the next
accepted record. Logging never waits for I/O or capacity and a logging fault never signals,
restarts or stops the gateway. Rotation closes the active slot, rename-replaces it onto the
previous slot and recreates the active slot exclusively. There is no staging, spill or TEMP file
and a denied rename never falls back to truncation. A partial write rolls back to the last complete
boundary; if that fails the writer stops. After a fault, records are dropped during backoff (1 s
doubling to 60 s) and the eighth consecutive fault stops the writer until the next gateway start.
Startup accounts the actual opened size, repairs an incomplete trailing record and replaces an
oversized slot (unbounded history from the earlier launcher) under verified ownership; that
history may be discarded. The writer's filesystem operations, transitions and flush completion are
a narrow production seam (`apps/api/src/windows-log/gateway-log-writer.ts`) for tests and QA.

**Private content, closed outcomes.** The managed gateway keeps the configured Pino level, the
listening record and engine diagnostics, including the correlated run/node error name, message and
stack that ADR-0080's safe public failure refers to. Only HTTP access records are narrowed: their
request and response serializers carry the method, the registered route template when one
matched, and the status. Startup failures introduced here use fixed stages (`import`,
`configuration`, `store`, `recovery`, `http`, `bind`), closed cause codes and fixed text. The
ordinary shell keeps Pino's default stdout configuration.

**Guarded canonical entry.** The launcher still runs exactly `"<Node>" "<Repo>\apps\api\dist\main.js"`.
`main.js` statically imports only Node built-ins and the built-ins-only guard
(`apps/api/dist/windows-log/guard.js`); dependency-bearing modules load dynamically. Importing it is
inert and `main()` and the `--preflight`, `--create-api-key` and `--reset` commands keep their
behavior. The built entry declares `export const WINDOWS_LAUNCHER_LOG_PROTOCOL = 1;` within its
first 4 KiB; the native validator (used by the launcher and the staged installer) requires that
exact declaration and the guard module, so a stale `main.js` beside a current guard refuses before
spawning. The launcher sets the internal, case-insensitively reserved `GG_WINDOWS_LAUNCHER_LOG_DIR`
only for the detached gateway, after assembling its environment; it is never a configuration
override, helper input, `ApiConfig` field or fingerprint input. The entry removes it under every
spelling before any application or provider code loads and acts on it only on Windows.

**One owner per physical root.** The guard resolves the folder through aliases to one canonical
local NTFS directory and keys a Node core named pipe,
`\\.\pipe\GraphGoblin.GatewayLog.<sha256("graphgoblin-gateway-log-root/v1\0dev=<volume>\0ino=<index>")[0..40]>`,
from its volume serial and 64-bit file index. It binds the pipe before inspecting or opening any
managed name and before importing code that can open a store, destroys every connection
immediately and holds the listener until the process exits. A bind conflict is outcome 70; it
neither grants logging nor proves which gateway holds the pipe. Windows security metadata, read
by the bounded system PowerShell query, must show the root and the exact managed names owned by
the operator, SYSTEM, Administrators or TrustedInstaller, with no allow entry for any other
principal and no null DACL. Managed names must be regular, single-link, non-reparse files; the
writer compares each name with its opened handle before writes, truncation and rotation and
leaves any refused name and its target untouched. A later loss of safe log I/O only drops
diagnostics.

**Coordinated cutover.** The opaque instance protocol advances to 2, so this launcher refuses warm
reuse of a still-serving earlier gateway. Before a fresh spawn the launcher validates the same root
and opens an existing `gateway.log` for read without write sharing. A sharing violation means a
live writer, including an earlier gateway's inherited append handle on another store and port;
the launcher waits within its existing startup deadline (a deliberately stopped gateway keeps the
file until exit) and then reports destination in use without spawning. The probe never writes or
prunes. Matching current warm reuse, including from another configuration folder, is unchanged.
The supported upgrade stops the old gateway deliberately and replaces the build and launcher
together. Concurrent obsolete launchers and same-user or privileged filesystem mutation are outside
this ownership guarantee, as are cross-user and cross-session guarantees.

**Detached process and launcher outcomes.** The child receives readable NUL stdin and writable NUL
stdout/stderr as the only inherited handles. The launcher keeps the `CreateProcess` handle for exit
observation and closes it on every return. Internal exits before readiness select closed guidance:
70 log folder in use, 71 unsafe or unavailable, 72/73 module load failed with/without a written
diagnostic, 74/75 startup failed with/without a written diagnostic; any other early exit is unknown
and assumes no record. A diagnostic is "written" only when that specific record completed within
250 ms. After normal cleanup, a graceful exit also allows 250 ms to flush; emergency exits keep
their behavior and fatal exits can lose queued records. The public `--ensure-gateway` failure stays
exit 1 with stderr and the dialog for interactive clicks; success stays quiet. Presentation contains
fixed text and only validated, rooted locations without control or formatting characters, capped at
260 characters.

**Native launcher pair.** `launcher.log` and `launcher.log.1` hold at most 256 KiB each of complete
JSON records of at most 4 KiB. The launcher writes and rotates them only after one 250 ms
acquisition attempt of `Global\GraphGoblin.LauncherLog.<key>`, keyed like the pipe from the same
root identity, using validated handles; contention, an unsafe entry or an I/O fault drops the
record. stderr and the dialog are the only fallback.

## Consequences

A gateway started by the launcher can no longer fill the disk with its own diagnostics, and its
work survives the launcher's exit and any logging fault. A profile or install folder that grants
other local accounts access (for example sandbox tools that add themselves to the user profile)
is refused until the operator restricts it. The upgrade requires stopping the running gateway,
rebuilding and reinstalling the launcher together. #458/#460 helper streams and #471 store locking
are unchanged.

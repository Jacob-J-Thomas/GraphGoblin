# ADR-0064 - Windows desktop and taskbar launch through gateway readiness

Date: 2026-11-07. Status: Accepted for the owner-dispatched bounded launcher work (#276, #325).

The PID-only ownership precheck is superseded by
[ADR-0069](ADR-0069-windows-lock-process-identity.md); other decisions remain unchanged.

## Decision

An optional, per-user Windows launcher opens an existing built checkout and an existing Chrome
GraphGoblin PWA. It is a small x64 .NET Framework executable, compiled locally by
`scripts/install-windows-launcher.ps1`. Configuration names absolute repository, Node 22 and
data-directory paths, the loopback port, explicit GG_* overrides and the installed PWA shortcut.
It does not build, install providers, start on login, update the application or supervise crashes.
The gateway remains the persistent execution owner. MCP stdio remains client-owned; this launcher
does not introduce or start an HTTP MCP service.

Clicks serialize by store and port within the Windows session. The launcher computes an expected
opaque gateway fingerprint through a read-only built helper, using the selected runtime and
configuration. `/healthz` publishes `X-GraphGoblin-Instance`, `X-GraphGoblin-Pid` and
`X-GraphGoblin-Phase`, keeping its existing JSON body and public-route policy. The fingerprint
includes canonical effective data/database/web paths, runtime, entry point and non-secret process
settings; it excludes master-key and Jev seed values. It identifies local configuration, not an
authenticated peer or the complete source revision. A wrong/missing fingerprint is refused.
After a cold start the PID must also match the child this click created. A healthy gateway must
serve `/app/` before the PWA opens. An existing store owner is never bypassed during slow startup.

The gateway starts with a hidden, separate native process group and an explicit inherited handle
list containing only NUL input and its durable append-only log. The launcher can exit, browser
windows can close and native caller pipes can reach EOF while execution continues. Startup failure
and bounded readiness failure show actionable diagnostics and log locations. Neither one kills
processes, deletes lock files, resets a store nor retries provider work.

The API, offline key writer and confirmed reset share a canonical SQLite-file sidecar lock,
`<database-file>.graphgoblin.lock`, in addition to the existing directory lock. A reset preview
checks that ownership read-only. Different `GG_DATA_DIR` values and directory junction aliases
cannot admit two owners of one SQLite file. A database with multiple hard links is refused because
path-based ownership cannot establish one owner across those aliases. Existing conservative
dead-PID reclamation rules apply; read-only preflight does not acquire a writer lock.

The installed Chrome PWA belongs to the configured IPv4 loopback origin. Its app ID must equal
Chromium's double-SHA256 encoding of the absolute `/app/` manifest ID; a mismatched origin requires
installing the PWA from the intended origin. See Chromium's
[manifest identity definition](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/webapps/common/web_app_id.h)
and [app ID generation](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/web_applications/app_id_helpers.cc).

Desktop and Start-menu shortcuts target the native executable with a stable launcher
AppUserModelID. After readiness, the launcher finds only the selected Chrome installation's
matching PWA window, or starts that PWA and waits for it. Before foregrounding it, it sets the
window's Windows AppUserModelID and RelaunchCommand/DisplayName/Icon properties. The relaunch
command includes the executable and, for a nondefault configuration, its explicit path; the default
configuration is next to the executable. A pin of that running window returns through readiness
on a cold start. Existing direct Chrome pins must be replaced;
rewriting a `.lnk` alone does not establish Explorer's cached pin identity. The installer uses
Unicode native shell-link interfaces and preserves the PWA's icon.

An ordinary taskbar click focuses an already-open PWA without executing a new command. After a
deliberate gateway stop with that window retained, the desktop shortcut or taskbar's new-window
action invokes readiness again. This is not crash supervision. Windows limits the window relaunch
command to MAX_PATH; a long custom configuration command uses existing 8.3 path aliases where
available, otherwise the launcher asks for a shorter installation/configuration path.

## Shutdown and limits

ADR-0049 is unchanged. A matching gateway that is draining, awaiting a choice, forcing or reporting
a shutdown failure is reopened for observation and existing controls. A ready/exiting gateway is
given a bounded opportunity to release ownership. Closing the PWA never sends a shutdown action.
The launcher does not cancel drain or force exit to make a click succeed.

Per-session mutexes serialize cooperating launchers. The API's filesystem locks preserve actual
store ownership across sessions and direct starts. An unrelated/manual process may still bind the
port between the last observation and startup: the launcher refuses the observed mismatch or
reports the API's bind failure. It never takes that process over. Shell pinning, foreground policy
and the installed Chrome PWA are native integration boundaries and require actual Windows shell
evidence in addition to process/API acceptance. Owner acceptance on #276/#325 remains separate
from implementation, native regression tests, independent QA and merge.

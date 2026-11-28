# ADR-0090 - Windows launcher warm discovery through an enrolled launch identity

Date: 2026-11-24. Status: Accepted under coordinator admission for #566 and #544, from the plan on
`d2df8600c2c8574bec420947de686b936910b245`. Independent review, independent QA, hosted CI and the
#459 owner obligations remain separate gates; Mac PR #501 is separate.

This refines [ADR-0064](ADR-0064-windows-desktop-launcher.md): a click no longer computes the
expected gateway fingerprint, or serializes on the store and port, before it observes a running
gateway. It supersedes the warm-click part of
[ADR-0086](ADR-0086-windows-helper-job-lifetime.md): warm reuse starts no helper, so only a cold
start needs, and proves, helper containment. Their other decisions are unchanged.
[ADR-0092](ADR-0092-configured-windows-helper-allowance.md) later gives the cold start's
enrollment and ownership checks `max(15, StartupTimeoutSeconds)` seconds each and makes that the
held-store retry cap; the installer enrollment keeps the 15-second work allowance described here.

## Context

Every click ran the read-only identity helper and took the store and port startup mutexes before
reusing a running gateway (#566). A healthy gateway was reused only after slow WMI, a held mutex
or a missing runtime or checkout file had been survived. Under a host job policy that refuses
process creation, even a warm click was refused although it needed no new process (#544).

## Decision

### Launch identity

`/healthz` adds `X-GraphGoblin-Launch-Identity: v1:<sha256>`. The route captures it and the full
fingerprint once, from the loaded effective configuration and one observation of its store and
serving paths, so an alias changed between two resolutions cannot split the two headers. The
hashed text is an ordered list of `[name, value]` pairs: the
projection version, the current `INSTANCE_PROTOCOL`, the canonical checkout root, and then every
`ApiConfig` field in declaration order. A compile-time exhaustiveness check over `ApiConfig`
requires a deliberate projection or secret exclusion for each new field; `masterKey` and
`jevApiKey` are the excluded secrets. Paths are canonical: the data directory, a file database's
target and the web and Goblin serving roots when effective, including a bundled root selected
because its build exists. A non-file database contributes an internal hash of its configuration
and is published only as its kind. Nested objects are key-sorted, so equivalent manually
configured settings agree. A golden vector pins the projection and its digest.

The digest excludes the Node executable path and version, the entry file name, build bytes,
startup markers and secret values. It attests configuration equality against an ordinary wrong
listener; it does not authenticate a peer. The full `X-GraphGoblin-Instance` fingerprint keeps
its protocol-2 bytes, and the JSON body, PID and phase headers and Mac consumers are unchanged. A
change of `INSTANCE_PROTOCOL` changes the launch digest too.

### Enrollment

The built helper's `--launch-enrollment` mode returns one flat string-only JSON line from one path
snapshot: the launch digest, the full fingerprint, the canonical data directory and either the
file database's lookup and canonical target or the non-file kind. The lookup is the decoded
absolute path from the existing SQLite resolver (`databaseFilePath`), keeping a relative or alias
spelling; no raw URL or credential leaves the helper. Both digests and the store metadata derive
from that one snapshot, so a later resolution of a retargeted alias cannot pair a launch digest
for one store with a full fingerprint for another. The full fingerprint keeps its exact
protocol-2 text: the configuration's own key order, the raw non-file database value inside the
hash, omitted absent serving roots and the runtime, version and entry. The launcher parses the
line with the same strict flat reader as the ownership protocol, whose modes and bytes are
unchanged.

The staged installer is the only producer. `GraphGoblin.exe --enroll-install` runs that helper
once through the contained configured runtime with the cold launch environment, within the
helper's 15-second work and 2-second cleanup allowance and a 40-second stage bound. The installer
embeds the versioned record as `Enrollment` in the JSON it already publishes, before validation
and before any installed file is replaced. `Enrollment.Inputs` is a SHA-256 of the exact gateway
inputs: a fixed tag, Repo, Node, DataDir, Port, the override count and each ordinally sorted
`GG_*` name and value, every field length-prefixed as strict UTF-8. Override names repeated with
different letter case are refused. PWA-only fields and startup file bytes are excluded. Editing
any gateway input requires running the installer again; the launcher never refreshes or rewrites
its enrollment.

### Warm probe

A click reads its configuration through one handle, keeping the bytes, their SHA-256 and the
file's volume and index. It validates the JSON, the enrollment's binding to the current inputs and
the PWA routing metadata; the Chrome proxy executable need not exist at this point. Before
startup files, logs, jobs or either startup mutex, it probes IPv4 loopback with no proxy, redirect,
cache or shutdown action. A ready match needs the enrolled launch digest, a positive PID, an
observable phase and `/app/` 200, and the configured data directory and enrolled database lookup
must currently resolve, through read-attributes handles with full sharing, to the enrolled
canonical targets. When the final path differs from the enrolled target only in letter case, the
enrolled target is opened while the lookup's handle is still held, and both handles must report
the same full `FILE_ID_INFO` identity: the 64-bit volume serial and all 128 ID bits, since the
legacy 64-bit index can collide on ReFS. A case-sensitive directory can hold distinct `Store` and
`store` objects, while an ordinary case-insensitive alias of one object is still accepted, and an
unavailable or unusable identity is refused with no fallback to the legacy index. The proof covers
that one comparison of two held handles, not a lasting pin of either path; log and installer
identities keep the legacy volume and index. A matching draining
or failed-shutdown gateway is reopened for observation. Runtime and checkout files play no part.

A different identity (including an older build without the header), an unknown phase, a
retargeted store or a definitely missing web shell (a matching gateway whose `/app/` answers 404
or 410) is refused at once, before either startup mutex, without stopping anything. A transport
outcome without a definitive answer, another HTTP error status, or a matching gateway that is
closing proceeds to the locked path. Every completed HTTP response, including an error status,
is disposed by the probe.

### Locked path and cold start

The existing store and port mutexes now cover only cold start and release progression. After
waiting, the click reopens its configuration and refuses if it disappeared, changed identity or
changed bytes. It then observes again: a matching ready gateway succeeds without a helper, a
still ambiguous or occupied unusable endpoint is refused and never treated as free, and a closing
gateway gets the existing release bounds. Only a confirmed free port reaches cold prerequisites:
Node, the built entry, helper and web files and the log protocol. A fresh contained enrollment
must match the installed one; drift of the actual effective settings or store targets is refused
with re-enrollment guidance. The ownership parser, held-store rechecks and deadlines are
unchanged, and the configuration is checked once more before the detached spawn. Readiness
requires the launch digest, the fresh full fingerprint and the spawned child's PID. A mismatch
never stops a process. The store and port mutexes are released before Chrome opens.

### Browser handoff

An existing PWA window is activated directly. Otherwise a session-local, PWA-only mutex keyed to
the selected Chrome installation directory, profile and app ID (upper-cased like window selection)
serializes simultaneous clicks. One bounded window budget, started before the first window
discovery, covers its acquisition, a window rediscovery under it, the Chrome start and the wait;
it never covers gateway readiness or startup. Chrome starts only while at least one 200 ms window
poll remains: a click that acquires the mutex nearer its deadline refuses as busy without starting
Chrome, so it neither reports a failure for a window it just opened nor lets the next click start
a second one, and polling never sleeps past the deadline. The proxy path check, arguments and
start information are prepared first, and the final remaining-time sample is taken directly before
the process start is issued, so preparation that consumes the last margin also refuses. Scheduler
delay and work inside the issued start call are outside that sample.
A missing or refused `chrome_proxy.exe` is reported at this handoff with the verified gateway's
address, which keeps running; it is not a startup failure. The installer still validates its
selected PWA source.

### Cutover

Install the updated API and enroll the new launcher together. An older gateway without the launch
header needs one deliberate stop; there is no helper fallback, legacy converter or store reset. An
updated manually started gateway with matching settings is reused at once. Selecting a different
runtime path needs updated launcher configuration, while replacing the runtime or build in place
keeps the enrollment when settings and store agree. Changed effective defaults, serving
selections or store targets need deliberate enrollment.

## Consequences

Warm reuse creates no process. Under an outer job that refuses process creation a warm click
succeeds without an admission attempt, while a cold click still refuses before helper code runs
(`helper-containment`). A restricted host can therefore reuse a gateway it cannot start. The
maintained native acceptance calibrates that claim on one job observer: an actual active-process
limit read back from the job, exact member accounting, a verified one-free-slot creation probe,
the actual cold helper refusal observed as `JOB_OBJECT_MSG_ACTIVE_PROCESS_LIMIT` in its own fenced
window, then a warm click with no denied or admitted creation and a final probe showing the
observer still reporting refusals. Windows does not guarantee job message delivery, so a quiet warm
window without that calibration establishes nothing, and the gate then stays open. Headless
gateway reuse is distinct from actual PWA window behavior, which needs real shell evidence.

The fixtures own what they start. The compatible control's outer job is kill-on-close and held by
its native owner until an explicit release after the warm measurement, so cancelling the test,
even while the control's gateway is still starting, settles the launcher, its helpers, the gateway
and their descendants; an unrelated sibling is observed alive before cleanup. A fixture gateway is
drained only as its verified owner (enrolled identity, Windows creation identity, executable,
command line, lease bytes and the shutdown incarnation captured with the owner, revalidated around
the observed token on one private loopback connection that never reconnects, with redirects
refused); a replacement listener, including one bound after the final proof, or an unverified
start receives no shutdown request. Every
fixture child starts from one host environment with every `GG_*` and `JEV_API_KEY` spelling
removed.

The public digest detects ordinary wrong listeners but is not a credential. A running gateway
whose store alias has been retargeted is refused, not stopped; restoring the alias restores reuse.

# Crash report readback correction 02

The first probe returned an unchanged installed A witness, no original PID or same-checkout gateway in the process sample, no listeners on 62241 or 62242, and an absent fixture data directory. Its DiagnosticReports check refused before reading a crash file. Those were timestamped observations from the first probe. [Preserved result](../macos-native-launcher-crash-diagnosis-01/receipt/summary.json)

This follow-up records lstat type, UID, GID, mode, device, inode and realpath for the exact DiagnosticReports directory and its parent before scanning. The fixed DiagnosticReports leaf may be group-writable when it is owned by the bound user, physical, on the bound device, and anchored to the same owned physical Logs parent. World write access and identity drift still refuse. The generic directory rule, file ownership and identity checks, no-follow open, byte caps, exact PID/time/executable/bundle matching, and local raw IPS verification are unchanged.

The local wrapper is byte-identical to the first packet. `preview.json` binds the changed remote helper. Run only after root review with `node <absolute path>/run-crash-probe.mjs --run <preview commandSha256>`. The same 25-second and 4 MiB limits apply. This packet has been syntax-checked and previewed locally. It has made no SSH connection, run no remote operation, and changed no product state.


# Plugin builder metadata preservation

PR #462's independent audit reproduced loss of NTFS alternate data streams at `934971a3f3dd0a17489883907127721c12752b18`. Separate native macOS QA reproduced loss of extended attributes and a resource fork at that same revision. The correction checks metadata alongside the existing inventory and file digests. Each checked object must be free of unexpected metadata before the builder replaces the previous output.

## Windows

The [copied compiled CLI](verify-344-win-streams.mjs) ran 13 native child processes with Node `v22.23.4` on NTFS. It rejected streams on the empty output root, owned output root, generated subdirectory, generated skill, and ownership marker. Each refusal preserved the byte payload and root inventory. The marker carried a zero-byte stream literally named `$DATA`. The run also exercised metacharacters and Unicode in paths, a clean rebuild, and a copied helper that exited early. A new unused destination still assembled after the helper was made unavailable. The first development fixture incorrectly replaced `SystemRoot` and failed before Node could start the CLI. The retained run simulates helper failure inside the copied fixture. [Windows CLI results](windows-cli-results.json)

`pnpm pack` included both platform scripts in the `@graphgoblin/tooling` tarball. An offline `pnpm deploy --prod --legacy --ignore-scripts` fixture retained byte-identical runtime helpers in the installed dependency. This fixture used `--config.allow-unused-patches=true` because the plugin deployment leaves out the unrelated patched Codex SDK. The installed CLI completed fresh and repeated builds, then refused a generated-file stream and preserved its bytes. [Production deployment readback](windows-prodn-readback.json)

Windows uses one in-box Windows PowerShell process for both metadata inspections. An observed `Add-Type` startup spawned `csc.exe`. The deadline terminates the direct helper and closes the builder's own pipes. The bounded timeout test covers an inherited pipe. Compiler descendant termination was outside this check.

## Linux

The [native filesystem driver](verify-344-linux-filesystem.mjs) exercised the exported builder on the Ubuntu WSL2 Linux filesystem under `/tmp`, with Node `v22.23.4`, Python `3.12.3` at `/usr/bin/python3`, and `LC_ALL=C`. It refused and preserved `user.*` attributes at the same five boundaries, including an empty value on the marker, and completed a clean repeat. Source hashes are in the result. The official Node archive was hash-checked and used in the isolated fixture. [Linux filesystem results](linux-filesystem-results.json)

Linux and macOS inspect the attributes visible to the invoking user. Privileged namespaces outside that visibility were outside the QA scope.

## Local checks

- The focused tooling run passed all 34 selected cases. The coverage run selecting only these cases exited 1 against the unchanged package-wide thresholds because the other tooling suites were outside the selection. Per-module coverage was 97.26% lines and 92.77% branches for `plugin-output.mjs`, and 98.57% lines and 97.87% branches for `plugin-output-metadata.mjs`.
- Codex package coverage passed with nine tests and the opt-in live-provider test skipped. Coverage was 95.58% lines and 91.66% branches. Tooling lint, changed-file format, and `git diff --check` passed.
- The repository-wide Linux CI and the independent corrected-head regression run are tracked separately.

# Mac product build transport

This packet implements the selected [build proposal](../macos-product-build-transport-preparation-01/README.md) for a future exact-source owner Mac compile. The integrated source freeze and root execution admission remain pending.

The owner lane is now build-only. The component run compiled `LaunchContract` and all 11 presentation sources, then failed test compilation because the active Command Line Tools could not import `Testing`. Its Swift process exited 1 with both EOFs and no tests executed. Hosted macOS 15 full Xcode owns Swift suite execution. The owner transport still includes the actual test files referenced by the final package. It invokes no Swift test command or test-framework setup. Both emitted launcher-log marker literals use version `1`. Instance protocol `2` is separate. [Owner Swift result](../macos-presentation-test-preparation-01/receipts/presentation-a82f9a136865461aa736a82a953b59e1/validation.json) · [Source evidence](source-map.json)

## Source freeze

After root reviews the real integrated product commit, set `$worktree`, `$head`, `$tree` and a fresh external `$freezeDirectory`. The local freeze uses the pinned Windows Node 22 shell runtime and the established Git for Windows executable. Supply the actual reviewed head and tree. The helper reads Git objects from that head and does not read worktree source bytes.

```powershell
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
node --version
node $freezeHelper $worktree $head $tree $freezeDirectory
```

`$freezeHelper` is `freeze-product-source.mjs`. It picks the reviewed tracked root set and direct non-QA `docs/` children, leaves the `docs/qa` subtree out of blob reads and transport, verifies raw Git blobs by Git object ID and SHA-256, and audits the exact Git-generated gzip tar against that independent inventory. The source model permits only regular Git modes `100644` and `100755`. It validates the directory prefix closure, checksums and member bytes and rejects additional or conflicting names, links, submodules and unexpected PAX records. The fresh directory holds the exact `source-freeze.json` and `source.tar.gz`. Review the actual file list, final Swift package graph, lockfile and destination before producing an execution admission.

## Preview and admission

Set `$wrapper` to `Invoke-OwnerProductBuild.ps1` in this packet and choose a fresh lowercase 32-hex `$token`. PowerShell 7 preview returns `Request`, the exact `RemoteCommand`, its Windows argv bound, the header and manifest bytes and the root admission fields. It hashes the archive without launching SSH.

```powershell
$preview = & $wrapper -Token $token -FreezeDirectory $freezeDirectory -Preview
$preview.AdmissionFields
```

Root writes a separate JSON admission with the reviewed `$preview.AdmissionFields`. Execution checks the packet seal and held archive handle against those bindings before making one strict known-host SSH attempt.

```powershell
& $wrapper -Token $token -FreezeDirectory $freezeDirectory -Admission $admissionPath
```

The small loader in argv decompresses only the sealed fixed executor, checks its uncompressed SHA-256 and imports it. The actual source freeze bytes and prior pnpm file pins are inside a bounded stdin manifest. Binary stdin carries `GG456BUILD1\n`, the big-endian 32-bit manifest size, the manifest and the exact gzip bytes, then EOF. The encoded manifest is capped at 1 MiB, the archive at 32 MiB compressed and 64 MiB inflated. The archive spool and source are created exclusively beneath `/Users/jake/Library/Caches/graphgoblin-456-product-build-<token>` after current owner and physical parent checks. Remote validation repeats the local tar audit before writing source files.

## Owner phases and receipts

The build rechecks the exact Node 22.22.2 executable, all 437 retained pnpm 12.8.1 files and 106 tool directories, active Command Line Tools, Swift compiler and SDK before running the package. HOME, temp, XDG, pnpm store/config and SwiftPM scratch/cache/config stay beneath the fresh private stage. The tracked project settings and frozen lockfile govern dependency fetches.

1. Run the pinned pnpm `install --frozen-lockfile --store-dir <private-store>` and `build` from the frozen staged repo.
2. Run `xcrun --sdk macosx swift build` twice on the actual full launcher `Package.swift`, with explicit private paths, arm64 release settings and products `GraphGoblin` and `GraphGoblinLauncherInstaller`.
3. Read the matching release bin path with `--show-bin-path`, verify both executable hashes and the thin arm64/macOS 15.0 metadata, and hash the emitted API entry/helper/guards/writer and both built web shells. The two exact version-1 marker literals must appear in the first 4 KiB of `main.js`. Recheck original staged source bytes and the retained pnpm tree.

Each child has a separate exit and EOF receipt, a five-second drain window and up to 4 MiB per raw pipe. The fixed phase limits are 600, 300, 240, 240 and 30 seconds. The stdin allowance is 90 seconds, setup is 120 seconds and final readback is 30 seconds. The remote owned worker group has an 1,800-second hard limit and local SSH has 1,860 seconds plus its bounded EOF drain. The supervisor may stop only its own live group. Five phases use at most 40 MiB of raw output plus bounded metadata within the 50 MiB SSH stdout cap. Local receipts retain raw sources and checked binary result frames under `receipts/product-build-<token>/`. Incomplete transfers may leave additional evidence only in the preserved remote stage. No automatic retry or cleanup is built in.

The transport never runs the built artifacts, public installer, gateway, ports, test harness, browser or owner UI. Runtime, installer and interactive acceptance remain separate.

[Wrapper delta](wrapper-from-component.diff) · [Executor delta](executor-from-component.diff) · [Source map](source-map.json) · [SHA-256 seal](SHA256SUMS.txt)

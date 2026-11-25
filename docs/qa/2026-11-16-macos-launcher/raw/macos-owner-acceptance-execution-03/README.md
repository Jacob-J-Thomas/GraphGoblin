# Owner Mac native engineering acceptance execution packet

This packet is bound to the successful build `d75d293f66da44ffb60198a07d8fa2e2`, candidate `4341d1f8882f4b69651bfb0b5988345b7f074339`, tree `a5f8fa3e13fb297cbcdb386ae445cb8159156617`. It prepares exactly one execution of the committed acceptance driver. The successful corrected build and its retained source freeze supersede the previously executed acceptance inputs. [Successful build validation](../macos-product-build-transport-implementation-01/receipts/product-build-d75d293f66da44ffb60198a07d8fa2e2/validation.json) · [Driver handoff](../macos-api-implementation-01/acceptance-handoff.md)

## Admission and exact command

PowerShell 7 uses the established single known-host, explicit-key, noninteractive SSH wrapper. Choose a fresh lowercase 32-hex `$token`; set `$wrapper` to `Invoke-OwnerMacAcceptance.ps1` and `$admissionPath` to a fresh external JSON record.

```powershell
$preview = & $wrapper -Token $token -Preview
$preview.AdmissionFields
```

After reviewing the exact command and admitted side effects below, root writes `$preview.AdmissionFields` to the admission record. The wrapper checks all packet seals, exact successful local build receipts including exit and pipe EOF, the original source freeze, readiness and pnpm receipts, and binds the rendered command and binary stdin manifest. Candidate files remain in their existing frozen stage.

```powershell
& $wrapper -Token $token -Admission $admissionPath
```

The remote command checks physical cache-parent and stage identity, the retained build inode `178893353`, every one of the 1,765 frozen source files, all ten successful artifact records, the audited driver and installer bytes, and the selected Node, Swift/SDK and 437 retained pnpm files. It checks the exact archive-source stage contains no `.git`. It stages a separate private mode-0700 root and passes its private `TMPDIR` and fresh case directory, plus exact `GG_MACOS_LAUNCHER_SOURCE_COMMIT` and `GG_MACOS_LAUNCHER_SOURCE_TREE`. The only acceptance invocation, with the retained repository as cwd, is the following.

```sh
/opt/homebrew/Cellar/node@22/22.22.2_2/bin/node --test \
  /Users/jake/Library/Caches/graphgoblin-456-product-build-d75d293f66da44ffb60198a07d8fa2e2/repo/tooling/scripts/macos-launcher.acceptance.mjs
```

## Authorized effects of the committed driver

| Surface | Effect |
| --- | --- |
| Private case tree | The driver uses the staged private `TMPDIR` for a fresh fixture base; it creates `store α %`, a contender store, a recheck log directory, a synthetic marker/database canary and a symlink from its fixture to the exact alternate log root. The fresh gateway can create its own key, SQLite and leases. |
| Alternate publication | The driver derives the real authenticated home and selects `~/Applications/GraphGoblin QA <32 lowercase hex>.app`. It uses the committed public script twice. The installer uses a private per-user Darwin-temp build directory with its own trap cleanup, builds both Swift products, then validates and publishes or replaces that one alternate app through a same-volume `.graphgoblin-launcher-stage-*` and private receipt under `~/Library/Application Support/GraphGoblin/LauncherInstalls`. Replacement checks the default name's metadata only to exclude an alias. The driver's manifest records the actually installed binary hash. The earlier release products prove the build gate. |
| Logs and anchors | Alternate log slots are under `~/Library/Logs/GraphGoblin/LauncherInstances/<installation-id>`. Common approved product directories may be created when absent. Cooperating directory/database/port anchor files in `~/Library/Application Support/GraphGoblin/LauncherLocks` remain after the driver releases its handles. |
| Processes and ports | Two fixtures reserve distinct OS-assigned IPv4 loopback ports and exclude `4747` and `4748`. The driver starts the real alternate bundle using closed headless flags, probes the new gateway and runs exact built API control cases. It exercises the existing `/system/shutdown` drain only after rechecking the fixture PID, birth, lease identities and fingerprint and confirming no runs. No browser, Finder, Dock, owner-store or provider action is part of this invocation. |
| Successful cleanup | The committed driver verifies and removes its exact alternate app, its receipt, the alternate log root and the private fixture base after the proven drain. It retains case evidence and leaves common parents and anchor files present. |
| Failed or interrupted run | The driver closes its fixture listeners and attempts a qualified drain only when its ownership witness exists. Failed or uncertain artifacts stay in place. A detached fixture committed before a witness was recorded can survive. The transport adds no drain, product signal, removal, retry or broad process scan. |

The wrapper's deadline can stop only the live process group created for its own worker. A detached gateway outside that group is reported according to the driver evidence. A lost connection alone leaves remote disposition unverified. Finder/Dock and other interactive acceptance remain a separate native QA step.

## Bounds and results

- The driver sets its own 450-second case timeout. The direct Node command has a 480-second outer limit and a separate five-second pipe drain. Remote group hard limit is 650 seconds. Local SSH is bounded at 700 seconds, input at 12 seconds and final pipe drain at five seconds.
- Node stdout and stderr retain independent exits, EOFs, bounded raw bytes and SHA-256. Each stream is capped at 4 MiB. The same SSH attempt returns up to 512 allowlisted flat case files and 40 MiB of raw case evidence. The exact held-store.launcher.log basename has a 256 KiB cap and is required for success. The total, including framing, stays below the 50 MiB stdout cap. A failed read leaves the private evidence on the Mac.
- Local `receipts/acceptance-<token>/` holds the bound request, transport raw streams, decoded driver logs, `cases/manifest.json` and available raw case files, and the acceptance summary. Success requires a zero child result, both EOFs, nine driver checkpoints, the exact source and API binding, fixture-only ports and successful post-case source, artifact and tool readback.

This execution rebinds only the build pins. The shell template, synchronous host check, held-store evidence allowlist, transport limits and existing success checks are unchanged. Build 04 pins the malformed-locale acceptance controls and the existing drain checkpoints. Root owns the final preview, admission and SSH. This packet has passed PowerShell and Node syntax checks without executing the wrapper or acceptance. [Source map](source-map.json) · [Binding readback](binding-readback.json) · [Wrapper diff](wrapper-from-execution-02.diff) · [Executor diff](executor-from-execution-02.diff) · [SHA-256 seal](SHA256SUMS.txt)

## Execution 03 readback

The committed driver adds one Node loopback-reset regression before the existing macOS suite. On success read the retained acceptance-stdout.raw for two passing Node tests within the original 4 MiB per-stream limit. The driver manifest still contains nine macOS case checkpoints. Review its coldLauncherLocale and drain fields, both cold process exit/EOF receipts, and the held-store log from the existing exact basename. The proof of a client HTTP 202 is the complete-response checkpoint in that manifest. Previous execution 02 and its failed evidence remain unchanged. Independent native and interactive QA follow separately.

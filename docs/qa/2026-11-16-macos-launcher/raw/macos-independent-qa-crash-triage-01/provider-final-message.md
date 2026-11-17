I did not launch anything. This is diagnosis only: no review verdict and no product or driver edits.

# GG #456 / PR501: S2 cold-canary SIGSEGV diagnosis

## Bottom line

- **This is a real native crash, not a transport artifact.** The installed launcher process itself (PID 45243) was killed by SIGSEGV before it wrote its headless result. Both streams reached EOF, nothing overflowed, it did not time out and there was no spawn error. The S2 hard check `envelope-open-management-running` is legitimately unmet.
- **The cause is unknown.** The evidence cannot tell a product defect apart from a crash caused by the hostile test environment. The backtrace decides that. One existing control narrows the search (see "S1 already ran this binary").
- **The state after the crash was never observed.** My driver only drains a gateway it has already registered, and none was registered here. It took no post-stop snapshot. So a gateway on 62241 that outlived the crashed launcher, a created store, lock anchors or a log directory may exist, and nobody has checked. `remote-result.json` says the same ("descendants not inspected"). This is a gap in my driver.

## What the evidence shows

1. **`0014-cold-canary.json`:**
   - It ran `…/GraphGoblin QA ü-54a825d1.app/Contents/MacOS/GraphGoblin --ensure-gateway` with cwd `/`, stdin `/dev/null` and piped stdout and stderr.
   - The environment had 22 canary variables. `HOME`, `USER`, `LOGNAME` and `SHELL` were absent.
   - Result: exit code null, signal `SIGSEGV`, 751 ms, 0 bytes on both streams.
2. **The S2 preconditions passed:** port 62241 was refused, the store was absent and no gateway was running. Anything found there now came from PID 45243 or something later.
3. **The crash came before any result was written.** With stdout empty, it happened before `HeadlessResult.printAndExit()` wrote its line (`Headless.swift:47-57` writes, then calls `exit()`). That rules out a crash during exit after an outcome had been computed.
4. **SIGSEGV narrows the kind of fault (my inference, not yet confirmed).**
   - On arm64, Swift runtime traps (force-unwrap, bounds, overflow, `fatalError`) show up as SIGTRAP.
   - Uncaught ObjC exceptions, exclusivity violations and dyld load failures show up as SIGABRT, and the last two print to stderr.
   - SIGSEGV points to a bad memory access, which includes running out of stack. The crash report confirms or refutes this.
5. **The 751 ms cannot locate the crash.** It covers exec, up to three Node helper spawns if they were reached, and an unknown amount of crash-handling time.

## S1 already ran this binary, but only in a clean environment

The installer can only exit 0 after `validateStage` (`LauncherInstaller.swift:103-121, 246-273`) passes.

- **The run:** the staged `GraphGoblin --validate-installation`, with env `{HOME, PATH=/usr/bin:/bin:/usr/sbin:/sbin, LANG=en_US.UTF-8}` and cwd set to the bundle.
- **What it must return:** exactly `installation-valid`, exit 0, with empty stderr.
- **Same file:** the staged witness becomes the installed witness, so it was the same executable (sha `56766e12…`).

**Covered by that run** (`validateStaged`, `NativeLaunchEngine.swift:136-151`), on this Mac and against the same saved config:
- loading and framework startup;
- `Bundle.main`;
- reading home from the password database;
- bundle inspection and the receipt;
- `LaunchInputs` (the decomposed `%41 #1` store path, built files, TMPDIR);
- the Node runtime check;
- the fingerprint helper.

**Not covered:** the canary environment, cwd `/`, the cooperating locks, the loopback check, the store-state helper, the log directory and admission, the gateway spawn, `verifyChild`, and the diagnostic tail.

The engineering acceptance runs also used a benign environment (`macos-launcher.acceptance.mjs:498-504`: HOME, a sane PATH, `LC_ALL=C`, a real TMPDIR) with ASCII app names. They give no coverage of this kind of input.

That leaves four possibilities: (A) the environment triggers it anywhere, including before `main`; (B) it is in the `--ensure-gateway`-only code regardless of environment; (C) it depends on cwd, which is unlikely because the product uses absolute paths only; (D) it is nondeterministic. There is only one sample.

## How the product treats its own environment (from source)

- The launcher reads exactly one variable from its own environment: `LANG` (`LaunchInputs.swift:85-91`). The canary value contains `/`, so it falls back to `en_US.UTF-8`.
- `HOME` comes from the password database (`NativeFiles.swift:73-80`) and `TMPDIR` from `confstr` with an ownership check. PATH and every `GG_*` value come from the saved config.
- Helpers and the gateway get an explicit environment through `posix_spawn` (`ChildProcess.swift:166-171`).
- It uses raw sockets, so the proxy variables have no effect.
- No product code consumes `NODE_OPTIONS`, `DYLD_*`, `LC_ALL`, `TMPDIR` or `GG_*` from its own environment. If the environment is the trigger, it acts through system code inside the launcher process, not through product logic.
- **What should have happened:** S2 expects exactly `{"version":1,"code":"open-management-running","port":62241}\n`, exit 0, empty stderr. The exit table is closed (`unexpected`, 70, is the contained catch-all), so dying from a signal is outside the contract whatever the trigger.
- **What the contract covers:** the accepted contract (`macos-closed-contract-proposal.md:109`) forbids passing preload, dynamic-loader or proxy settings on to child processes. Nothing promises that the launcher process itself tolerates `DYLD_*` in its own environment. A real Finder or Dock launch always has `HOME` set.

## Can dyld or Foundation fail before `main`?

- **In principle, yes.** Before `LauncherEntry.main`, dyld loads AppKit, Foundation, CryptoKit and the Swift libraries, then runs their startup code. The product adds no code that runs before `main`: it is all Swift, and Swift globals start lazily. So a crash before `main` would be in system code.
- **`DYLD_*` reaches this binary.** The install script has no codesign step (`install-macos-launcher.sh:60-86`), so the binary is ad-hoc signed by the linker without hardened runtime, and dyld honours `DYLD_FALLBACK_LIBRARY_PATH`. The `codeSigningFlags` field in the crash report will confirm this.
- **But the usual dyld failure doesn't match.** A missing library normally produces SIGABRT, a `DYLD` termination reason and "Library not loaded" on stderr. A SIGSEGV with empty stderr does not fit that; a fault inside dyld itself is not ruled out.
- **HOME, LANG/LC_ALL and TMPDIR:** CoreFoundation falls back to the password database for home, and libc ignores `LANG`/`LC_ALL` unless `setlocale` is called, which the product never does. I know of no way these crash library startup, but I can't rule it out.

## How to classify it once a backtrace exists

| Crash report shows | Classification |
|---|---|
| A `DYLD` termination reason, or faulting frames only in dyld or library startup before `LauncherEntry.main` | Platform behaviour caused by the launcher's own hostile environment. S2 stays unmet as recorded. Any change to S2 needs root approval and a written validity note backed by the evidence. Canary fields are not dropped silently. |
| Faulting frames in the GraphGoblin binary, or in system frames called from it after `main` | Product failure: an input produced a crash instead of a closed outcome. Real-world severity depends on whether a benign environment also reproduces it. |
| Faulting thread on the `com.graphgoblin.launcher.diagnostics` queue | Product failure in the best-effort diagnostic tail. |
| A stack-guard region in the VM info, or deep recursion | Product failure. |

## Fields the delegated probes must capture

**From the crash report (`GraphGoblin-*.ips`, including `Retired/`, newer than 2026-11-16T21:04:13Z):**
- Header: `app_name`, `timestamp`, `bug_type`, `os_version`, `incident_id`.
- Identity:
  - `pid` = 45243, `procPath` = the exact QA app path, `parentPid` (expected 45123), `procLaunch`, `captureTime`;
  - `bundleInfo` (expected `com.graphgoblin.launcher.instance.c908e6ef…`), `cpuType`;
  - `codeSigningID`, `codeSigningFlags` (is hardened runtime set?), `codeSigningValidationCategory`.
- Crash:
  - `exception.type`, `.signal`, `.subtype`, `.codes`;
  - `termination.namespace`, `.code`, `.indicator`;
  - `vmRegionInfo`, `asi` (application-specific info, including any dyld message), `faultingThread`.
- Threads:
  - for the faulting thread: queue and thread name, every frame (`imageIndex`, `imageOffset`, `symbol`), and `threadState` `pc`, `lr`, `sp`, `far`, `esr`;
  - frames for every other thread, especially the main thread.
- `usedImages`:
  - name, path, `uuid`, `base` and `size` for each image;
  - the GraphGoblin binary's UUID matched against the installed executable;
  - any image path that is not a system path.
- If frames are unsymbolicated, run `atos` against the installed binary, reading only.

**From the listener and lease probe (this brackets where in the launch sequence the crash happened):**
- **Listeners:** any listener on 62241 or 62242, on any address including `127.0.0.2`.
- **Processes:**
  - any `node` running `<checkout>/apps/api/dist/main.js` or `instance-identity.js`, with ppid, pgid/sid, lstart and cwd;
  - confirmation that PID 45243 is gone.
- **Store:**
  - a byte-exact `lstat` of `<scope>/data/QA data ü %41 #1`, using the decomposed spelling as saved;
  - the listing of `<scope>/data`;
  - the two writer leases, the `.reclaim` guards, `master.key` and `graphgoblin.db`.
- **Instance logs:** `~/Library/Logs/GraphGoblin/LauncherInstances/c908e6ef553d4cb4871644a9674a5c7b`: whether it exists, its entries, the `launcher.log` record (checked for the canary token), and whether `gateway.log` exists.
- **Lock anchors:** new entries under `LauncherLocks` compared with the four at S0, matched to sha256 of the exact config strings (data directory, data directory plus `/graphgoblin.db`, and `"62241"`). Only new names are informative.

**How to read the bracket:**
- No new anchors → it crashed before the lock step finished.
- Anchors but no log directory → between the locks and the first "store free" result.
- A log directory but no store → at or before the gateway spawn.
- A store, `gateway.log` or a listener → a gateway was spawned and may still be running. The state is then not "stopped", and only an admitted, verified drain may touch it.
- A `launcher.log` record → it names the failure outcome, and the crash came in or after the diagnostic tail.

## Smallest next diagnostic

0. **No execution: the crash report plus the state bracket above.** If that gives symbolicated faulting frames, stop there and classify with the table.
1. **Only if the report is missing, ambiguous or unsymbolicated:** two side-effect-free runs of the same installed binary. Use the exact 22 canary values from `0014-cold-canary.json`, cwd `/`, stdin `/dev/null`, ideally with the driver's Node spawn semantics, a 15 s limit, and no signal sent.
   - **P0:** an unknown argument, which takes the usage path (`Entry.swift:25-26`). This tests only loading and `Bundle.main`. Expected: `{"version":1,"code":"usage"}\n`, exit 64.
   - **P1:** `--validate-installation`. The installed receipt has no stage name, so the read-only check refuses. Expected: `{"version":1,"code":"installation-invalid"}\n`, exit 10. It creates nothing (`create:false`), takes no locks, writes no logs and starts no child processes.
   - **If P0 or P1 crashes:**
     - Run leave-one-out with the same probe, removing one variable per run: `DYLD_FALLBACK_LIBRARY_PATH` first, then restore `HOME`, then valid `LANG`/`LC_ALL`, then a real `TMPDIR`.
     - Add one repeat of the full canary to check whether the crash is deterministic.
     - That is at most about six runs, with each crash report tied to its PID.
     - A P0 crash means a startup-time, environment-triggered crash. A P1 crash with P0 clean means product code after `main`.
2. **Only if P0 and P1 are clean and no report exists:** reproduce `--ensure-gateway` itself, which has side effects. That needs root admission, a fresh state check, and a drain path the current admission does not include (`observe` and `drain` were excluded).

The S2 assertion and canary fields stay unchanged, and I am not editing the driver. For a later preparation, root may want the driver to take a read-only state snapshot and list crash reports whenever a run stops.

## What I could not check

I cannot run programs here, so I did not verify by hash that the worktree's launcher source matches the frozen tree; I relied on the brief. I also did not confirm that the binary still has symbols, or the platform's signal mapping for this crash.
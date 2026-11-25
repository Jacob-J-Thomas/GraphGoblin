# PR #501, scan 2 of 3: Claude Opus 5.5 xhigh review of the GPT-authored macOS engine, installer and API integration

**Verdict (source review only): CHANGES_REQUIRED.** I found three actionable defects, all low or low-to-medium severity. None affects store ownership, publication atomicity, the detached gateway's lifetime, the GUI/engine boundary or key handling. All three can be fixed without design changes. This verdict does not approve a merge. CI, the hosted Swift suites, native installer and interactive acceptance, independent behavior QA and the final Astra MAX audit are all still outstanding.

## Identity and comparison boundary
- **Reviewed checkout:** `C:/Users/98jak/.codex/worktrees/gg-20261116-macos-launcher/GraphGoblin`
- **Head / tree / base:** `8bddb93aaa61ebb1b962385efa97a468a379929d` / `d0f7b3eefda54c888e044715bd21ac30201003b3` / `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1`. These come from the brief; I could not run Git to confirm them.
- **Baseline checkout:** `C:/Users/98jak/.codex/worktrees/gg-20261116-launcher-logging/GraphGoblin` does not exist. So I could not check the handoff's claims that the moved writer has comment-only source changes and a byte-identical test. I reviewed the writer as it is now and how both the Windows and Mac adapters use it. I also did not recompute the SHA-256 of `LaunchContract.swift`.
- **Method:** Read, Glob and Grep only. I did not compile, test, execute, use the network or modify anything.

## What I read
- **Governance:** AGENTS.md, docs/README.md, docs/15-issue-workflow.md, and lines 1–75 of the four-intents register.
- **Authoritative context:** plan.md, macos-closed-contract-proposal.md, macos-native-layout-root-selection-01.md, the API implementation and acceptance handoffs plus the API source manifest, and the native implementation handoff plus its source inventory.
- **Native code, read in full:** Engine/{NativeLaunchEngine, ChildProcess, LaunchInputs, NativeFiles, Loopback, Diagnostics, Installation, Headless}.swift, Entry.swift, Package.swift, LaunchContract.swift, Installer/Core/{LauncherInstaller, BundlePublisher, InstallerOptions}.swift, Installer/Entry.swift, Tests/Engine/{ACL, Child, EngineContracts}Tests.swift, Tests/Installer/PublisherTests.swift, and scripts/install-macos-launcher.sh.
- **API code, read in full:** main.ts, serve.ts, macos-local-key.ts and its test, macos-log/guard.ts, managed-log/guard.ts, windows-log/guard.ts, data-dir-lock.ts, instance-identity.ts, canonical-path.ts and main-entry.test.ts.
- **API code, read in the relevant parts:** container.ts (lease, key and failure paths), managed-log/gateway-log-writer.ts (seams and constants), routes/system.ts `/healthz`, plugins/static.ts and auth.ts, shutdown.ts phases, master-key.ts, config.ts, and infrastructure `databaseFilePath`.
- **Tooling and docs:** tooling/scripts/macos-launcher.acceptance.mjs (all of it), .github/workflows/ci.yml (macOS job), tooling/vitest.config.mjs, root package.json scripts, ADR-0082, guide 01 (macOS section), guide 07 (troubleshooting), docs/09, docs/11, and the CHANGELOG entry.
- **Presentation (seams only):** LauncherPresentationEntry.swift, LaunchPresentationController.swift (start and quit) and PresentationCopy.swift (Show Log offers and copy).

## Findings

### F1 · Low: two kinds of pre-commit failure get the wrong outcome code
**(a) An identity-helper spawn failure is reported as a gateway start failure.**
- `LaunchInputs.fingerprint` (LaunchInputs.swift:185-189) does not catch errors from `capture` → `captureReadOnly` → `startCapturing` → `SpawnCommand.spawn`.
- That spawn raises `ChildSpawnError.noChild` when `posix_spawn` or file-action setup fails (ChildProcess.swift:172-175, 180-182, 249-253).
- `execute` catches `noChild` with no commit check (NativeLaunchEngine.swift:219-221). The result is `.startFailed`: headless exit 30, a `child=spawn-failed` launcher.log record, and the copy "macOS couldn't start GraphGoblin" (PresentationCopy.swift:256-259).
- Triggering sequence: `verifyRuntime` succeeds, then the helper spawn fails transiently at NativeLaunchEngine.swift:205 (EAGAIN or ENOMEM process limits, or Node removed in between). This happens before the locks are taken and before any commit.
- The contract says otherwise. Proposal line 95 and the line-59 paragraph reserve start-failed for the committed gateway spawn. Line 91 puts helper and dependency failures under cannot-verify. `verifyRuntime` already maps the same failure to runtime-unavailable (LaunchInputs.swift:161-173).

**(b) Contained local failures before commit become `.cannotVerify` and never `.unexpected`.**
- Examples are an unsafe ACL or mode on the lock-anchor directories, or an `flock` error other than EWOULDBLOCK (NativeLaunchEngine.swift:45-52, 69-74). All of these fall into the generic catch at :222-223.
- `.unexpected` can only come from a second `begin()` (:175).
- Contract line 100 assigns "contained unexpected failure before spawn commitment" to `unexpected`. The cannot-verify copy tells the user to "wait a moment", which never helps with a persistent local setup fault.

**Correction:** only map `ChildSpawnError.noChild` to `.startFailed` when `state.didCommit` is true; before commit it should fall through to `.cannotVerify`. Map non-observation local failures before commit (lock-anchor validation, unexpected errno) to `.unexpected`. Add one engine test for a helper spawn failure.

### F2 · Low–Medium: outcomes that end at the deadline never write a launcher.log record
- The record is only written under the condition `!time.expired` (NativeLaunchEngine.swift:225-226).
- Every outcome that ends at the deadline has, by construction, an expired budget:
  - `launchBusy` (:76)
  - the loop-exit outcomes `releaseUnconfirmed`, `storeBlocked` and the expiry case of `cannotVerify` (:255, :313-316)
  - commit refused at expiry (:301-302)
  - `startTimedOut` (:323, :340-341)
- So these outcomes never produce a record at all.
- The presentation still offers Show Log for every one of them (PresentationCopy.swift:47-52). The copy for start-timed-out and startup-unverified says "the launcher's log may say why" (:269, :274). The approved plan asks for a useful refusal with the relevant stage and log location (plan.md:11) and the same startup diagnostic behavior as Windows (plan.md:27). The Windows launcher records a closed launcher.log record for each failed step (guide 07:5-6).
- The acceptance case `held-store` (21) does not check launcher.log, so nothing catches this.

**Correction:** keep the outcome itself bounded by the 60 s budget, but allow the existing bounded write of at most 250 ms after expiry for non-cancelled outcomes. Alternatively, reserve a small final slice of the budget for the record, as `captureReadOnly` does with its 40 ms reserve. Add an assertion on the record to one deadline case in the acceptance suite.

### F3 · Low (docs and recovery guidance): troubleshooting and docs/09 are missing for macOS, and recovery-required leads nowhere
- The approved plan (plan.md:37) and AGENTS.md's docs-sync rule require updates to docs/09 and the troubleshooting guide.
  - docs/09:3-23 covers only the Windows entry point.
  - guide 07:3-40 has a detailed Windows launcher section and no macOS counterpart. Nothing explains the headless or alert outcomes, gateway.log startup stages and causes, or exits 70–75.
- The install guide says "Retain any reported recovery files … do not delete ownership files" (guide 01:152-153). But the installer's output names no files (InstallerOptions.swift:111-119), and ADR-0082 promises "recovery requiring inspection" without a procedure.
- Concrete dead end: a pending receipt can still reference a stage that no longer exists, for example a hidden stage folder deleted by the user or a cleanup tool. Then `existing()` throws recovery-required on every later install (LauncherInstaller.swift:181-193). The launcher itself keeps working, but the documented path offers no way forward.

**Correction:** add a macOS troubleshooting section that covers:
- each refusal outcome and what to do;
- gateway.log stage and cause;
- the private log and lock locations;
- a recovery-inspection procedure: which receipt and stage files to examine, and when removing which file is safe;
- the strict-layout and fresh-store refusal causes listed under "Optional follow-ups" below.

Add the Mac entry point to docs/09.

## Areas checked with no defects found (static reading only)
- **Path and receipt ownership:**
  - The receipt is canonical-JSON-exact and bound by ID to the Applications identity and name.
  - Both bundle generations are witnessed during replacement.
  - The alternate-name to default-name collision is refused.
  - Name-spelling aliases resolve to the receipt's name.
  - Show Log access is gated by the validated installation ID and revalidated before use.
- **Publication:**
  - `RENAME_EXCL`/`RENAME_SWAP` with readback and rollback.
  - Interruptions at every step I traced leave either a verifiable previous generation or a stage that the next install carries forward.
  - Foreign targets are never modified.
- **Cancellation and helper reaping:**
  - Quit is polled at least every 25 ms.
  - Only the owned read-only helper receives SIGKILL, then is reaped within 250 ms of the original deadline.
  - The engine returns well inside the presentation's 2 s quit grace.
- **Detached launch:**
  - `SETSID`, `CLOEXEC_DEFAULT` (so the cooperating lock descriptors are not inherited) and `/dev/null` standard descriptors.
  - The working directory is set with the macOS 15 `_np` fallback.
  - Commit and Quit are arbitrated under a single lock.
  - Readiness is accepted only from the child's own PID, and post-commit errors map to `startupUnverified`.
- **ACL, file modes and 64-bit identities:** sign-extended `dev_t` matches Node's `BigInt.asUintN(64)` on both the Swift and TypeScript sides. Directories are 0700 and files 0600 or 0700.
- **Log admission:**
  - The Darwin `O_EXLOCK` reservation is retried only on EAGAIN, for at most 1.5 s.
  - The reserved descriptor is close-on-exec through libuv.
  - Identity is checked again before every write.
- **Local key:** the check runs after both writer leases are held and before SQLite is opened or a key is generated. Lease proof becomes unavailable once release starts, and both leases are released on refusal (container.ts:192-221, 622-632).
- **Common writer:** the Windows adapter still uses `nodeLogFileSystem`, and the Windows launcher still requires only `windows-log/guard.js`.
- **Protocol markers:** both launcher-log marker versions are 1 and the instance protocol is still 2.
- **CI:** tooling coverage excludes `*.acceptance.mjs`.

## Optional follow-ups (non-blocking)
1. After a verified publication and final receipt write, a failure while cleaning up the old generation is reported as "Publication could not be verified" (LauncherInstaller.swift:134-140, 155-156). That message overstates the failure.
2. The Swift key check rejects a group-writable data directory (LaunchInputs.swift:135-136); the API does not. A store created under umask 002 is refused with key-file guidance at both install and launch.
3. The strict bundle layout (Installation.swift:292-301) and the rule that a fresh store must be completely empty (LaunchInputs.swift:152-153; macos-local-key.ts:55-64) refuse some ordinary Finder side effects. Examples are a custom icon file (`Icon\r`) or `.DS_Store` inside the app bundle, and `.DS_Store` in a data folder the user created in Finder. These should at least be documented (see F3).

## Evidence limits and checks still pending
- I compiled, tested and ran nothing. The authored tests are not evidence that anything passes.
- The owner release build is a compilation-only receipt.
- CI on `14fd` failed the native compile, and the corrected head has no full CI run yet.
- The hosted Xcode Swift suites, the public installer and gateway acceptance, and native interactive QA are all pending.
- Native behavior that only the actual Mac checks can settle:
  - **Launch arguments:** any argument injected by LaunchServices would hit the strict usage route and print usage instead of opening the app (Entry.swift:12-27).
  - **Dock pin after replacement:** the pin's bookmark must still resolve to the app after the swap and the deletion of the old generation (BundlePublisher.swift:22-24; LauncherInstaller.swift:138-139).
  - **Real ACL behavior:** `fstatx_np`/`filesec` behavior on actual files; the authored ACL tests are fully mocked.
  - **Protected folders:** macOS privacy prompts attributed to the app when the checkout lives in a protected folder such as ~/Documents.
  - **Acceptance time budget:** whether two clean release builds plus the 60 s store-blocked wait fit inside the 450 s test timeout.

I started no other scan or worker and made no source, Git or remote changes.
# Independent assessment: native behavior QA 06 (#456 macOS launcher)

QA06 ran to completion and met every criterion, and I found no product defect. A Finder/Dock GUI session can follow once root hash-binds the fixture manifest and runs a fresh read-only observe. Finder, real alias, Dock and default-browser behavior are still entirely unexecuted. This is not a review, a formal scan, a QA pass or a merge-readiness statement.

How I worked: read-only, files only. I ran no subprocesses, so I recomputed no SHA-256 values; identity rests on the checks the transport and driver did themselves. I did not read any private provider stream.

Citation roots, relative to `launcher/`:
- `R/` = `macos-independent-qa-transport-correction-06/receipt-1606855fbd714db98f19388db31152a4/`
- `E/` = `R/evidence/`
- `D:n` = `macos-independent-qa-execution-preparation-04/gg456-native-qa.mjs`, line n
- `A4/` = `macos-owner-acceptance-execution-04/receipts/acceptance-debeff189cd14fe6a1f80ec78de59031/`

## 1. Execution identity and transport status

| Item | Observed | Source |
|---|---|---|
| Admission | Token `1606855f…`, admitted once at 22:54:59.73Z; optional S8 excluded | `…-06/root-intake-1606855f….json` |
| Candidate | `18089bba`, tree `c6781a4d`, base `6d7fcc98`; build `6389524e`, result `2fe2c657` | `R/admission.json`, `R/binding.json` |
| Driver / binding | `bafe9533…` (107,620 B); binding `67250e62…` (2,430 B); fixture `fde14a78`, ports 62241/62242, 45 min, on-stop drain, no node move | `R/request.json`, `E/admission.json` |
| SSH | Started 22:54:59.821Z, exit 0 (no signal) at 22:59:15.734Z, not stopped, upload finished. stdout 351,379 B with EOF and no overflow; stderr 0 B with EOF | `R/ssh-result.json` |
| Local validation | No failure; remote status `driver-and-evidence-captured` | `R/validation.json` |
| Remote driver | PID 51140, 22:55:00.025Z → exit 0 (no signal) at 22:59:15.546Z; EOF on both streams; 183 B stdout / 0 B stderr; not stopped, no kill sent; transport code 0 | `R/remote-result.json` |
| Evidence | 225 files / 316,475 B reported, and 225 present locally. The local side checked each frame's SHA-256 and the totals (`invoke-qa.mjs:139-158`) | — |

**What the hashes rest on.** The remote side checked the uploaded driver and binding digests (`remote-qa.mjs:119-126`). The driver hashed itself against the binding (D:883-884) and checked 8 built-file hashes plus the 46-file launcher source digest `ecfdca3f`. The returned admission binding was compared field by field with the upload (`remote-qa.mjs:151-153`).

**Transport success is not product QA success.** `driver-and-evidence-captured` only means the driver finished cleanly and its evidence arrived intact. The product verdict is the driver's own `E/result.json`:
- status `completed-all-criteria-met`
- no unmet checks, no failure, no recovery drain
- no contender or gateway left registered at stop
- marked "not a pass"

The transport did not inspect descendant processes, so "no QA process left" rests on S9.

**A 14.6 s gap at the end.** `result.json` was written at 22:59:00.914Z but the driver exited at 22:59:15.546Z. This fits S7's 15 s race timer (D:1302), which stays live after the contender exited at 22:58:59.927Z. That is my inference from the timing. It is harmless: nothing was written after `result.json`.

## 2. Stages and assertions

There are 342 recorded checks and every one, hard or soft, is ok. This includes all three new hard checks root retained: `draft-bound-to-loop`, `run-pins-new-draft-snapshot` and `run-pin-retained-across-restart`.

| Stage | Window (Z) | Hard / soft checks |
|---|---|---|
| S0 scope and owner snapshot | 22:55:00.155–.190 | 2 / 0 |
| S1 install A | –22:55:28.507 | 14 / 11 |
| S2 cold canary launch | –22:55:36.021 | 21 / 16 |
| S3 spelling and update | –22:56:34.259 | 47 / 16 |
| S4 wait-run drain and retention | –22:57:21.000 | 43 / 3 |
| S5 second install, concurrent starts | –22:57:57.589 | 40 / 12 |
| S6 foreign listeners | –22:57:58.487 | 13 / 6 |
| S7 shell-held store | –22:59:00.530 | 38 / 2 |
| S9 stopped fixture and manifest | –22:59:00.914 | 25 / 33 |

**Lifecycle (headless launches).**
- The cold launch exited 0 in 1,629 ms with the exact 60-byte response.
- Gateway PID 51267 is fully detached (`E/stage-S2…json`):
  - parent is launchd, own session and process group, no terminal
  - stdin/stdout/stderr on `/dev/null`
  - working directory is the canonical checkout, running the bound Node
- It survived the launcher exiting and two in-place updates. The warm launch (424 ms) reused it.
- All four drains (two in S4, one in S5, one in S7) returned 202 `draining` and never reached forcing. Each then showed the port refused at about 254 ms, the PID gone, leases and guards gone, and the store helper reporting `free`.
- The restart in S4 produced a new gateway (51267 → 51530) with the same fingerprint.
- Not tested: survival after the SSH session ends. Every gateway was drained inside the session.

**Canary environment.**
- The cold launch ran with HOME unset and the full hostile set (`E/0014-cold-canary.json`):
  - `LC_ALL` set to the canary token, an invalid `LANG`, hostile PATH and NODE_OPTIONS, proxies
  - forged GG_* values including host 127.0.0.2, a fake master key and a forged log admission
- The gateway's environment contains exactly the 13 allowed names (`E/cold-gateway-environment.filtered.json`):
  - no canary token and no extra names
  - `LANG=en_US.UTF-8` and no `LC_ALL`
  - host 127.0.0.1 and port 62241
  - the exact database URL
  - log admission bound to inode 179129040
- The store has one correctly decoded directory and a mode-600 key. The canary appears nowhere in store names, logs, launcher output or config.
- Both web shells and their first assets were served byte-exact. No browser connected, and a successful launch wrote no launcher.log entry.
- Two limits:
  - The environment is read by splitting `ps -E` text.
  - The "independent" fingerprint helper used the data path the product saved (D:486-493).

**Spelling, alias and update (filesystem/installer behavior only).**
- Installing under the NFD spelling and, on a case-insensitive volume, under a case variant both acted as in-place managed updates. Each one:
  - kept ID `8d57594d…` and the original name bytes
  - settled the receipt and produced a new bundle generation (inodes 179128989 → 179130117 → 179131115)
  - left no new stage residue
  - left gateway 51267 undisturbed
- In S5, the symlinked data alias was saved as the canonical store path, byte-identical to A's.
- None of this is Finder alias behavior.

**Wait-run drain and retention.**
- *Draft and snapshot identity.* The stage record shows:
  - loop `…WC3`, and draft `…WC4` bound to it (status draft, version 1)
  - run `…XGR` pinned to a new snapshot `…XGT`, distinct from the draft, loop and run IDs, source draft, version 1
  - the same pin after restart

  The raw HTTP bodies were never saved (D:270-275), so these fields exist only in the driver's record. The gateway log corroborates the sequence and timing (`E/final-log-a-gateway.log.excerpt` lines 43–60):
  - `POST /loops` 201 at 22:56:34.266Z
  - start-run 202 at .274Z
  - `POST /system/shutdown` 202 at 22:56:35.376Z

  The IDs' embedded timestamps (22:56:34.263Z for loop/draft, .268Z for run/snapshot) match the log. This supports the record but does not reproduce the body fields independently.
- *The accepted 202.* It shows phase `draining`, `activeRunIds: []` and `unconfirmedRunIds: []`, both real arrays. The pre-drain check also had `activeRunIds: []`. So the shutdown logic never counted the waiting run as active. `waiting-run-not-unconfirmed` passes, but it only shows the run wasn't flagged; it doesn't show the drain waited for work. That matches the documented behavior that durable timers don't hold a drain. No intermediate phases were observed.
- *Was the timer still pending when the gateway was released?* The driver never recorded the timer's deadline, so there is no recorded deadline to compare. A bounded comparison works instead:
  - The wait started between run creation (22:56:34.268Z) and the first `waiting` reading (by 22:56:35.298Z), so the 45 s deadline fell between about 22:57:19.27Z and 22:57:20.30Z.
  - Release was at about 22:56:35.63Z (`E/0048…json`), at least 43.6 s before the earliest possible deadline.
  - After restart the run read `waiting`/timer at about 22:56:37.68Z. The last waiting poll was 22:57:19.29Z and `succeeded` first appeared at 22:57:20.30Z (log lines 159–162).
  - That matches the original deadline. A full 45 s re-arm from restart would have finished at 22:57:22.6Z or later.
- *Not checked:* the draft itself after restart. `loop-retained` only checks that the loop is listed with at least one run (D:1149).

**Concurrent starts against the aliased store.**
- B got a distinct installation ID and bundle ID, and its parsed config is deep-equal to A's even though the bytes differ.
- Launching A, A and B at once: all three exited 0 with the correct response. Eight polls about 220 ms apart saw exactly one gateway, PID 51685.
- The logs go beyond sampling:
  - B's gateway.log contains only PID 51685, with exactly three launcher verification sequences at 22:57:51.242–.315Z.
  - A's gateway.log contains only 51267 and 51530.
  - So B's launcher started the single gateway and all three launchers verified it.
- Remaining gap: a gateway that died within about 220 ms, before it started logging, would evade both checks.

**Foreign listeners.**
- Both QA-owned listeners got exit 20 `port-in-use` in about 410 ms, with one probe each.
- The listener and the store were untouched, and no gateway started.
- Each app's launcher.log gained exactly `stage=checking outcome=port-in-use`.

**Shell-held store.**
- The shell contender (PID 51733, with a different fingerprint) held the store lease.
- Launcher A exited 21 `store-blocked` after 60,011 ms. In 116 samples about 520 ms apart, the launcher's port never answered and no other gateway appeared.
- The contender was unchanged, managed gateway logs were unchanged, and launcher.log gained exactly `stage=waiting-for-store outcome=store-blocked`.
- After its drain the contender exited 0.
- Limit: the contender used the saved NFD path spelling, so a shell user typing the NFC spelling is untested.

**Summary by category.**
- **Confirmed product defects:** none.
- **Unmet criteria:** none.
- **Unexecuted paths:**
  - GUI steps G0–G9, including G1 (LaunchServices readiness); real Finder alias; Dock; default-browser handoff; browser-close survival
  - S8 (moved or wrong runtime). It wasn't admitted, and its absence supports no claim either way.
  - Drain while work is actually executing (the observe-shutdown path); the waiting-for-release and release-unconfirmed outcomes
  - Installer interruption and recovery; installer argument refusals; moved checkout; `--validate-installation`
  - SSH-session survival; an NFC-spelled shell contender
  - Malformed-locale installs and concurrent launches (covered only by acceptance04)
  - macOS 15, Intel and other browsers; Quit at logout
- **Oracle and fixture limitations:**
  - The fingerprint helper borrows the saved data path.
  - Each install recompiles the executable: four different binaries of 725,576 B, none of them the pinned build artifact. Identity rests on the source digest and receipts.
  - Raw response bodies are not saved.
  - Process checks are sampled (220 ms and 520 ms).
  - The waiting run never appears among active runs.
  - The timer deadline is not recorded.
  - Draft retention after restart is not checked.
  - The installer saved the NFC-requested store path in NFD form. This is an observation with no criterion attached.
  - The manifest's list of pending GUI steps leaves out G1, although the case map includes it.

## 3. Does the hostile-locale cold launch now pass?

Yes, in this suite. `E/0014-cold-canary.json` launched with an invalid `LC_ALL` and `LANG` plus the full hostile set. It exited 0 in 1,629 ms with empty stderr and the exact response. The gateway's log admission document arrived with its keys unsorted, so the encoding path that used to crash ran without sorting.

That is one observation and the only malformed-locale coverage in QA06. Every installer run and all three concurrent launches used `LANG=en_US.UTF-8` with no `LC_ALL` (`E/0008`, `0031`, `0036`, `0057`, `0062`, `0064`).

The public installer under a malformed locale is covered only by the separate acceptance04 run, which is not this suite's coverage. I read its raw manifest (`A4/cases/manifest.json`):
- Locale settings:
  - installer: `LC_ALL` set to a canary
  - cold launchers: a malformed `LANG` and `LC_ALL`
- The public install exited 0, and both cold attempts exited 0.
- The drain sequence ran in order: 202 at 22:12:33.738Z, then listener and leases released (.749), process gone (.756), store free (22:12:34.074Z), then verified cleanup.
- `A4/acceptance-stdout.raw` shows 2 of 2 tests passing with nine checkpoints.
- The per-process records don't store the environment, so tying each locale to its process rests on the acceptance script's source.

The build04 installer crash is still preserved. Its partial stage directory `.graphgoblin-launcher-stage-0669c5da…` is present and unchanged.

## 4. Fixture disposition and readiness for GUI work

The manifest (`E/fixture-manifest.json`, state `stopped-verified`, written 22:59:00.907Z) records what was kept. No cleanup has run.

| Kept item | Details |
|---|---|
| App A | `~/Applications/GraphGoblin QA ü-fde14a78.app`, ID `8d57594d45c347c5b23853ade14c4635`, bundle inode 179131115, receipt inode 179131124 (`088cd1b5…`), log directory inode 179129040 |
| App B | `…ü-fde14a78-b.app`, ID `80f735b1146c47bd845b5502890859f5`, bundle inode 179132193, receipt inode 179132204 (`3fa79ef5…`), log directory inode 179132228 |
| QA scope | `~/Library/Caches/graphgoblin-456-qa-fde14a78`, inode 179128026 |
| Store contents | Loop `01M7K975EQM2WR3Q6NE7SR3WC3`; run `01M7K975EWB4KHDH0DQX0N7XGR`, succeeded; snapshot `…XGT` |
| Lock anchors | Two new anchors. The port-62241 anchor already existed before this run and is correctly excluded from cleanup. |

**State at S9 (22:59:00.53–.91Z):**
- both ports refused; no QA process; leases free; store helper reports `free`
- A and B unchanged since their last readback
- logs private, bounded and canary-free
- owner changes limited to QA entries; default app, store and production logs untouched
- the owner's service on 4747 (PID 76881) unchanged
- no new crash reports
- built files, launcher source and checkout listing unchanged

Then the driver exited at 22:59:15.546Z and SSH at 22:59:15.734Z. Nothing has been observed since.

Four earlier QA apps and the stage residue are also still in `~/Applications`. Every app reports the bundle name `GraphGoblin`, so GUI steps must pick the app by exact path.

**Can GUI observation proceed?** On the native side, yes. Ten S9 soft checks run after the manifest is written (D:1415-1421), and all ten are ok. The stage is `criteria-met` and `result.json` reports everything met, S9 included.

That is necessary but not sufficient. Before the first GUI action:
1. Root hash-binds the manifest.
2. Root runs a fresh read-only observe against it.
3. G0 console admission: the owner is logged in at the console. Accessibility access was false and screen capture unknown in preflight-02, so the owner's physical input is the instrument. Record the default browser.

## 5. Smallest remaining Finder, alias, Dock and browser sequence

What public-method tests already establish should not be retested in the GUI:
- run, stop and history retention (S4)
- a single gateway under concurrent starts (S5)
- refusals (S6, S7)
- environment closure (S2)
- presentation logic for Quit, Hide, reopen, keys and accessibility identifiers, which CI03's Swift tests cover

Each step is owner input, with a read-only observe before and after. I performed none of these.

1. **G2, Finder cold launch.** Double-click A by exact path. Expect:
   - exactly one new gateway born after the click, with the manifest's fingerprint and the closed environment
   - the launcher exits
   - the default browser connects to 127.0.0.1:62241 and shows one `/app/` page

   Opening the app over SSH (`open`) only exercises LaunchServices, not Finder.
2. **G3, warm.** Double-click again. Expect the same PID and start time, and no second gateway.
3. **Browser-close survival.** Quit the browser. Expect the same gateway PID to remain.
4. **G4, real Finder alias.** Use Finder's Make Alias on A and place it outside `~/Applications`; confirm it is an alias, not a symlink. Double-clicking it should reach the same gateway and hand off to the browser.
5. **G5, Dock.**
   1. Choose Keep in Dock. A warm click should reach the same PID.
   2. Return to stopped through the in-app Stop or a manifest-bound drain, and confirm release.
   3. A cold Dock click should start a new gateway born after the click.
   4. Glance at run history.
6. **G6, pin and alias after replacement.** Root reruns the public installer for A under the same name. Then click the existing Dock pin and double-click the step-4 alias. Expect no "?" icon and no "original item can't be found". The pin and alias must exist before the replacement, because the installer swaps the bundle for a new inode.
7. **Close out.** Drain, take a final observe, then remove the pin and alias (G9). Cleanup happens only with separate root authorization.

Optional, root's call: one port-in-use window with Show Log in Finder (G8), and one store-blocked panel with Hide and reopen (G7a). These add only real AppKit presentation evidence.

**Post-merge human acceptance is separate.** #456 and its parent keep the owner's acceptance of the merged build: default install, everyday Finder and Dock use, focus, keyboard, accessibility, and Quit at logout. It is recorded as described in `docs/15-issue-workflow.md`, and agent evidence cannot complete it. macOS 15, Intel and other browsers remain residual; the owner's Mac runs 26.6.2.

## 6. Next step

Nothing failed, so no correction or retry is needed. The smallest next step is for root to hash-bind `E/fixture-manifest.json`, run one manifest-bound observe into a fresh output directory, and then do G0 admission.

Other gates:
- **CI03 (run 43971560928).** The local packet in `macos-pr501-ci-03/` is terminal: all five job logs reach cleanup with no error annotations.
  - It tested merge commit `68a9536d` (`635a637c` into `6d7fcc98`), not `18089bba` directly. That their product paths are equal is root's claim; I did not recheck it.
  - macOS job: Xcode 16.4; 105 Swift tests passed (XCTest ran 0, as all tests use Swift Testing); acceptance 2 of 2.
  - Gates job: 22 of 22 tasks. Browser job: 481 passed.
  - I did not read a run-level conclusion from GitHub.
  - It establishes nothing about Finder or Dock.
- **Swift coverage policy:** still pending (60.62% lines / 49.66% regions, no branch counters, no waiver). The existing V8 thresholds stand.
- **Formal review:** the budget stays at 2 of 3 and this assessment does not touch it. The fresh AstraMAX final scan 3 still follows the technical and GUI gates.
I found no product defect in this evidence, and I can't sign off the PR from it. Most of the claimed native, API and file passes are backed by the artifacts. Two claims say more than the artifacts show: the drain request was "authenticated", and process and lease release were "verified at drain". All the GUI criteria are still open, and both blockers are environment or tool failures.

**Scope:** I read all 23 manifest artifacts, plus `evidence-manifest.json`, `transfer-verification.json` and three files outside the manifest (`launch.json`, `exit.json`, `final.md`), and I viewed the screenshot. I didn't run anything, so I didn't re-hash files. The manifest sizes add up to 143128 bytes, and the transfer rows match the manifest rows. I also did one narrow source lookup, explained in challenge 1.

## Supported observations

- **Fixture identity and process incarnation.** In `01-baseline-native/observation.json` at 04:52:28Z:
  - PID 58208 runs the expected Node binary with the frozen `apps/api/dist/main.js`. It has PPID 1, PGID 58208, TTY `??`, and stdin/stdout/stderr point to `/dev/null`.
  - There is exactly one loopback listener on 62241, nothing on 62242, and both lease files name 58208.
  - The environment matches: port 62241, the NFD data folder, Ollama off, API key not required, and the log-admission root names installation `8d57594d…`. `tokenHits` is 0.
  - Chrome Helper PID 58780 has a live connection to 58208, which ties the screenshot to this process.
  - The same PID and start time (`birth`) are checked again at 04:56:39 (`named-incarnation`, `registered-owner`). That brackets the API reads, whose health header also says 58208.
  - The start time is Mac local time, which is UTC−6. I worked that out from the crash-report file names against their modification times. So 19:59:30 local is 01:59:30Z, which is before the earlier warm-Finder sighting of PID 58208 at 03:35:47Z. That is consistent.
- **Provider-free graph.** `03-loop-created.json` contains only a manual trigger, a 1800-second wait and an exit, with no harness overrides and no issues. The `codex/gpt-6-luna` entry under `pinned.defaults.process` is an inherited default that no node uses.
- **Snapshot pinning.** The run's snapshot ID `…DW` differs from the draft ID `…B5`, and `pinned.source`=draft, version 1. The snapshot ID and pinned data stay the same across the start, two waiting reads, the cancel response and the final read. The timer deadline of 05:24:45.611Z is the start time plus 1800 s.
- **Cancellation.** `api-qa.mjs` checks the run ID, loop ID, snapshot ID and pinned data before calling cancel on that single run. The cancel returned 200 with `cancelled`. The event counter went from 6 to 8 and the run was still on `pause`. Finalization is recorded at 04:56:19.753Z.
- **Drain.** The drain request was accepted with 202, the phase became `draining`, and both run-ID lists were empty. `forcing` stayed null. Probes got ECONNRESET at 1 ms and ECONNREFUSED at 258 ms, and the store check returned `{"state":"free"}`.
- **Same-path replacement.** Before and after files show:
  - The app bundle inode changed from 179131115 to 179160993, and the receipt inode from 179131124 to 179161002.
  - The installation ID, the Applications folder inode and the Info.plist hash (`91ab9736…`) are unchanged. That supports the bundle-ID retention claim.
  - The new receipt's hashes for the bundle, executable, plist and config all match the files on disk.
  - The installer exited 0, stdout is 43 bytes and stderr is empty.
- **Final state.** At 04:58:39Z, app A's bundle and receipt already differ from the originals, so this check came after the replacement. It shows no listeners, gateway, launcher, helper or connections, and all four lease files are absent.

## Challenged claims

1. **"Authenticated 202" (report "Ordinary API drain").** No artifact shows a token was sent. In the head checkout (not the frozen tree), `apps/api/src/routes/system.ts` lines 69–81 make `x-graphgoblin-shutdown-token` optional. It is a check against the current process, revision and phase, not a login, and a request without it still gets 202. The drain driver's code isn't in the packet. The rest of the drain pass stands; this is a reporting and harness issue, not a product defect.
2. **"Process release … lease release" at drain** (report; `final.md` says "verified process, listener and lease release"). In the drain file, `fixture:released.detail` contains only the connection probes. The only direct proof of no process and no leases is the 04:58:39 observation, taken after the installer ran. The end state is proven; tying it to the drain depends on trusting the unshipped driver.
3. **"Immutable" snapshot.** The snapshot's own definition was never fetched. Its node list is inferred from the draft plus the node IDs in `recovery.replay`. Nobody edited the draft after the run started, and there was no restart. So what is proven is a distinct snapshot that stayed the same within one process.
4. **Preserved store and config.**
   - No store evidence was taken before or after replacement, such as a database file check or a history read.
   - The test loop and run are said to "remain in the fixture" but were never read again.
   - Config values are the same, but the `launcher.json` hash changed (`9284b34c…` → `cb4bd517…`) and its key order differs. So `configRetained` means the values match, not the bytes.
5. **Provenance gaps (not product issues).**
   - The old receipt hash `088cd1b5…` appears only in report.md; `07-replacement-before.json` has no receipt hash.
   - The executable hash changed (`96df6b50…` → `4bbccb17…`) even though the launcher source digest is the same, and nothing explains why.
   - "The manifest SHA256 is `e6dacf39…`" refers to the fixture manifest, not this evidence manifest (`85b5c49b…`).
   - The source digest covers only the launcher code and installer script. The running API code is tied to commit `18089bba` only through the fixture manifest's recorded hash.
6. **Ordering and scope.** `cua-results.json` has no per-call timestamps, so "the reads span the CUA failure" rests only on file naming. Cancel scope is shown by how the request was built. No other runs were listed before or after it; the drain at 04:56:39 only shows `activeRunIds` was empty.
7. **Older log lines.** App A's `launcher.log` contains `port-in-use` and `store-blocked`. They are unchanged during this session and this packet doesn't explain them. The parent packet should account for them; I am not calling them a defect.

## Unresolved GUI criteria

Two environment or tool failures block these, not product failures: Finder access was denied, and Computer Use failed with "native pipe startup failed".

- Opening and resolving the existing Desktop alias.
- Pinning to the warm Dock and clicking it. No Dock pin has been verified, and the gateway is now stopped.
- Browser-close survival: open a dedicated window, close it natively, observe afterwards, and reopen from the Dock. This needs a **new** provider-free run, because run `…DT` is cancelled.
- A cold launch from the retained Dock, with a new PID and start time.
- Alias and Dock resolving to the new bundle (inode 179160993) after replacement.
- Retained history and snapshot through the restarted public API, for both the test run (loop `…B4`, run `…DT`, snapshot `…DW`) and the original fixture run (`01M7K975…`).

Two side effects for whoever plans the next session:
- **Pre-replacement checks are gone.** Because replacement came first, the existing alias and cold Dock checks can no longer be run against the original bundle (inode 179131115). Someone needs to decide whether checks against the replaced bundle satisfy those criteria.
- **Chrome may confuse the next test.** It still has three GraphGoblin tabs pointing at 62241, and the Cmd+N press may have left an unknown blank window. Inventory these before judging whether the launcher opened the browser.

## Fixture final state

As of the last check at 04:58:39Z:

- **Gateway:** stopped. No 62241/62242 listeners and no lease files.
- **App A:** replaced at the same path. Installation ID `8d57594d…` kept, receipt `8d7f6303…`, config values unchanged.
- **App B:** unchanged.
- **Desktop alias:** inode 179144264 and hash `f5255a32…` unchanged; whether it resolves to the new bundle is unverified.
- **Test data:** the test loop and cancelled run are said to remain in the store, but nothing re-read them.
- **Other:** no new crash reports, and `gateway.log` grew to 790769 bytes with no token leaks (`tokenHits` 0).
- **Runner:** the Codex runner exited with code 0 at 05:01:57Z.
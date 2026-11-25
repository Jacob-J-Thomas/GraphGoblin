# #456 macOS launcher: independent owner-native QA driver (execution preparation 04)

**Status: prepared and not run.** Preparation 04 is a byte-for-byte copy of execution preparation 03 with three S4/S5 oracle corrections, listed in `correction-handoff.md`. QA05 stopped in S4 because the draft run was started without the draft's `versionId`. The three corrections are:
- S4 now starts the created draft explicitly and checks the new pinned snapshot identity.
- S4 now judges `unconfirmedRunIds` from the accepted drain's own 202 snapshot.
- S5 now compares the two installs' saved configurations by exact parsed equality, ignoring member order.

The local checks were all under the project Node 22.23.4 on Windows:
- `node --check`;
- the offline controls and the mutation sanity pass beside this file;
- a recorded portless API-contract run through the repository's own test composition;
- SHA-256 hashes.

Nothing was executed on macOS. It is QA harness authoring. It is not a review, not an adversarial scan and not a pass. Author: Claude Code `claude-opus-5-5` (xhigh), acting as the independent behavior QA worker, on 2026-11-16. It builds on the prior plan in `../macos-independent-qa-preparation-01/` and keeps its case IDs.

| File | Purpose |
| --- | --- |
| `gg456-native-qa.mjs` | One finite Node 22 driver with no dependencies. Modes: `run`, `observe`, `drain` and `digest`. |
| `binding.template.json` | The 8bddb93a preparation baseline, with `"final": false`. The driver refuses to run until root rebinds it. |
| `case-map.json` | C1–C10 bindings with citations, the stage-to-case map, every check with its hard or soft level, and the coverage split. |
| `README.md` | This file: admission steps, invocation, effects and the follow-up commands. |
| `correction-handoff.md` | The preparation 04 delta and its cause, the exact diffs, the checks actually run, the source and output hashes, and the native status. |
| `offline-oracle-controls.mjs` | Controlled offline controls. They run the exact S4 and S5 stage bytes of drivers 03 and 04 against a loopback fake API with stubbed native probes, and use the actual QA05 configuration records. |
| `offline-oracle-controls.result.json` | The retained output of its recorded run. |
| `mutation-sanity.mjs` | Re-introduces each defect, and some near-miss regressions, into temporary copies of driver 04, and confirms the controls fail on every one. |
| `mutation-sanity.result.json` | The retained output of its recorded run. |
| `portless/` | An external Vitest config and test. They drive the repository's portless Fastify `createTestApp` with driver 04's exact fixture and helpers. The folder also holds the retained observations and run log. |

The built-asset regression for preparation 03 (`../macos-independent-qa-execution-preparation-03/offline-asset-bound-regression.*`) is not repeated. `shells()`, `http()` and `CAP` are byte-identical in driver 04.

**Hashes:** listed in `correction-handoff.md`. Root re-verifies them after it inspects the files and binds `driverSha256` itself.

## 1. Admission by root before execution

1. Run `node --check gg456-native-qa.mjs` and read the file. It imports only `node:` built-ins and never reads `process.env` for a child: every child gets an explicit environment.
2. Copy `binding.template.json` to a new `binding.json` and bind every value to the **final** candidate and its owner-Mac build receipt:
   - candidate `head`, `tree` and `base`;
   - the `build` token and hashes;
   - `node.path`, `version` and `sha256`;
   - `checkout`, the physical build `repo` path;
   - `files`, the built-file hashes from the receipt;
   - `owner.uid`, `user` and `os`;
   - `launcherSourceDigest`;
   - `driverSha256`, the SHA-256 of the exact driver bytes that were inspected.

   Then set `"final": true` and give `boundBy` a value. `ports` may stay `null`, which picks two free random ports in 49152–65535, or be set to `[P, P2]`. `runId` may stay `null`, which picks 8 random hex characters.
3. **`launcherSourceDigest` rule:** the SHA-256 of the sorted (UTF-8 byte order) lines `"<sha256>  <posix path>\n"`, covering every regular file under `apps/macos-launcher/` plus `scripts/install-macos-launcher.sh`. The command `node gg456-native-qa.mjs digest --checkout <tree>` prints it. Compute it from the exact frozen bytes (not from a CRLF-converted Windows checkout), or on the Mac build stage after its manifest has been verified.
4. **Owner-Mac preconditions:**
   - the bound checkout is present and built;
   - no gateway from that checkout is running;
   - the Swift 6 Command Line Tools are present, because the public installer compiles on every run.

   Admission re-verifies all of this and stops with `admission-refused` (exit 2, nothing created) on any mismatch:
   - platform, UID and user;
   - the driver and Node hashes;
   - the built-file hashes and the launcher digest;
   - the macOS version;
   - an existing scope or QA app names;
   - a `~/Applications` that is a symlink, not a directory, not owned by the user or writable by group or other, or unreadable. An absent `~/Applications` (ENOENT only) counts as empty when home is a user-owned directory without group or other write; the public installer then creates it, and the driver never does;
   - free ports.
5. **Transport:**
   - Put the driver and `binding.json` outside the checkout, `~/Applications` and the QA scope.
   - Run the driver with the bound Node.
   - Root supplies the outer finite transport bound. The driver's own deadline is not a hard wall-clock cutoff (see §2), so give it at least `maxMinutes` plus 15 minutes.
   - Capture stdout, stderr and the exit status.
   - Afterwards, copy `~/Library/Caches/graphgoblin-456-qa-<r8>/evidence/` back.
   - Only `run` is admitted for the initial execution. `observe` and `drain` are excluded (see §7).

## 2. Invocation

```sh
/opt/homebrew/Cellar/node@22/22.22.2_2/bin/node /path/gg456-native-qa.mjs run --binding /path/binding.json
#   [--run-id <8 hex>] [--on-stop drain|leave] [--include-node-move]
```

- **Duration:** expected 10–15 minutes, about 3 more with `--include-node-move`.
- **Total deadline:** `maxMinutes`, 45 by default. It is checked between operations (before each child process, at each stage start and in each poll loop), not enforced as a hard wall-clock cutoff, so one bounded operation that starts just before the deadline can run to its own bound (an installer up to 600 s). After a stop with `--on-stop drain`, the recovery drain gets a bounded 180 s extension. Worst case is about `maxMinutes` plus 14 minutes, which is why root's outer transport bound must be at least `maxMinutes` plus 15 minutes.
- **Per-process bounds:** installer 600 s, headless launcher 75 s, identity helper 15 s, every probe 10 s, HTTP request 3 s.
- **Capture caps:** 64 KiB per installer or launcher stream, 4 MiB per probe, 96 MiB of evidence in total.
- **HTTP caps:** 4 KiB per health response and 2 MiB per API or HTML shell response. A built JS or CSS asset referenced by a shell is capped at its exact built length; a built asset above 4 MiB stops the stage before it is fetched. The 2,132,126-byte `/app/` entry asset at 4341d1f8 uses about half of that ceiling.
- **stdout:** a single JSON line.
- **Exit status** (never a pass):

| Exit | Meaning |
| --- | --- |
| 0 | Every criterion met |
| 1 | Stopped, or some criteria not met |
| 2 | Admission refused, no effects |
| 3 | Internal error |
| 64 | Usage error |

## 3. Stages and what each adds beyond engineering acceptance

The engineering driver `tooling/scripts/macos-launcher.acceptance.mjs` was used only as an interface reference. Its scenarios (a generic install, warm and two-launch reuse, same-name replacement, and the basic refusals) are not repeated as QA evidence. The full check lists are in `case-map.json`. Every stage is a native observation on the owner Mac.

| Stage | Prior case | What it adds |
| --- | --- | --- |
| S0 | O0 | A new private scope, a symlinked checkout link `links/QA checkout ü 漢`, and a read-only owner snapshot. An absent `~/Applications` gives an empty stage-residue baseline here and in the admission name check only. After an install, its absence is an error. |
| S1 | O1, O2 | The public installer runs through the symlinked non-ASCII checkout with the NFC name `GraphGoblin QA ü-<r8>.app` and the store `data/QA data ü %41 #1`. Checks exact bundle, Info.plist, config and receipt identity; that the canonical checkout (not the link) is saved; that only QA entries appear in owner locations; and that the installer leaves the candidate checkout unchanged. |
| S2 | O3, O6 (same session) | A cold launch from a closed environment with HOME unset and hostile PATH, NODE_OPTIONS, DYLD, proxy, LANG, TMPDIR, GG_* and GG_MASTER_KEY values plus a forged log admission. The canary `GG_HOST` is the distinct literal loopback `127.0.0.2`, never a wildcard, so even an inherited-host regression stays local. Checks: parent is launchd, session leader, no tty, stdio on /dev/null, canonical cwd and runtime, the closed environment set, `GG_DB_URL` decoding exactly into the `%41 #1` store with no mis-decoded sibling, an independently computed fingerprint, both built HTML shells and their first referenced asset served with HTTP 200 and the exact built bytes, no leftover helper, no browser connection, and canary-free private logs. |
| S3 | O5 | A managed update through the NFD spelling and, on a proven case-insensitive volume, the suffix-case variant, while the gateway runs. The variant keeps the exact `GraphGoblin ` prefix, so it must succeed exactly like NFD. Both require one bundle with the original name bytes, the same ID, a new generation, and an undisturbed gateway that a warm launch reuses. A refusal of either spelling is unmet. On a case-sensitive volume the variant is skipped. |
| S4 | O7 adapted, G5 native part | A provider-free durable 45 s wait run, created through the public API. It is started as an explicit draft run: the created draft's `versionId` with `allowDraft: true`, sent only after the draft ID and its binding to the loop are validated. The run pins a new immutable draft snapshot, whose run, loop, snapshot and source identity is recorded. The ordinary token-bound drain completes with the run active and is never forced. The accepted drain's own 202 snapshot must carry an `unconfirmedRunIds` array that excludes the run. A verified release is followed by a cold relaunch. The same run, loop and pinned snapshot are retained, and the run completes. No provider child process starts. |
| S5 | O10 | A second alternate, `GraphGoblin QA ü-<r8>-b.app`, installed from the canonical script with a symlink-aliased `--data-dir` that is saved canonically, with a distinct ID and log directory. Its saved configuration equals A's by exact parsed equality, ignoring member order, with each receipt bound to its own bytes. Three concurrent cold launches (A, A and B) leave exactly one gateway at every 200 ms poll. |
| S6 | O11 | Two deterministic foreign listeners on P: plain health with no identity headers (the shape of an older build) and a well-formed but wrong identity. Both give `port-in-use`. The listener and the store are untouched, and each install's own `launcher.log` gets one record. |
| S7 | O8 | An ordinary shell API holds the store on P2. It starts with the clean expected gateway environment, including the exact byte-encoded `GG_DB_URL`, so it opens the same `%41 #1` store, and gets no log admission. The launcher reports `store-blocked` in the 60–63 s band; P is never served and nothing is spawned; the contender is unchanged; shell output stays out of the managed logs. A's `launcher.log` gains exactly the fresh line `stage=waiting-for-store outcome=store-blocked`, with no rotation, no `child=spawn-failed` and no canary. The contender is stopped by an ordinary drain. |
| S8 (optional) | O9b | A disposable Node copy in the scope; renaming it gives `runtime-unavailable` with no spawn. Restoring it starts a gateway with a different fingerprint. B is then restored to the bound Node. The candidate checkout is never moved. |
| S9 | X1 observation only | A verified stopped fixture: no QA process, both ports refused, the store free, both installs unchanged, logs bounded and canary-free, owner diffs limited to QA entries, the checkout unchanged, and `fixture-manifest.json` written. |

**Pre-spawn Quit and repeated Quit** are presentation behavior. The launcher accepts only `--ensure-gateway` and `--validate-installation`, so no headless Quit flag is invented; these remain GUI (G7) and Swift-suite evidence.

## 4. Effects and safety

**Created:**
- In the scope `~/Library/Caches/graphgoblin-456-qa-<r8>/`:
  - `evidence/`;
  - `links/`, holding the checkout symlink and `data alias ü`;
  - `data/QA data ü %41 #1`, the store, created by the API;
  - `contender/`;
  - `runtime/`, only with `--include-node-move`.
- Through the public installer: the two QA app bundles in `~/Applications` (and `~/Applications` itself if it was absent; the driver never creates it), their receipts under `LauncherInstalls/`, and their `LauncherInstances/<id>` log directories.
- Three hashed anchors in `LauncherLocks/`, created by the launcher.
- Installer scratch builds under `DARWIN_USER_TEMP_DIR`, which the script removes itself.
- Possible LaunchServices registrations.

**Never done:**
- connecting to ports 4747 or 4748;
- writing to the default app, the store `~/.graphgoblin` or the production `Launcher` logs;
- sending any signal or using `force`;
- opening a browser, the GUI, the Dock, TCC or Apple Events;
- invoking a provider. The gateway's own startup behavior is product behavior; its child processes are recorded by name.

**Privacy:**
- Raw `ps -A` and `ps -E` output is never persisted; only filtered QA rows and SHA-256 values are kept.
- Environment values are kept only for the allow-list; other names get a hash and a canary flag.
- `master.key` is checked with `stat` only.
- Owner directories keep names only for GraphGoblin entries; everything else is folded into digests.
- Canary values are synthetic. The random canary token is recorded in `admission.json` and in the manifest.

## 5. Failure semantics

- **Hard criterion fails:** the stage stops and all state is preserved. With `--on-stop drain` (the default), only a registered QA gateway or contender is drained. Before that, the driver re-verifies its PID, birth, fingerprint, command and leases, and uses the gateway's own control token. If verification fails, nothing is stopped.
- **Soft criterion fails:** it is recorded as unmet and the run continues.
- **Process exceeds its bound:** its pipes are released and it is recorded as uncertain. It is never killed, and there is no silent retry or cleanup. Its state stays uncertain. Absence is concluded only from a refused connection plus the process table and lease checks, never from process exit and end-of-stream alone.
- **Total deadline passes:** the next check stops the run (see §2).
- **Root's outer transport bound expires:** the driver and its children are in an uncertain state. Root records that and does not silently retry or clean up.
- **No cleanup is performed.** A stopped run keeps its scope; a new run needs a new run ID.

## 6. Evidence layout (`<scope>/evidence/`)

- `admission.json`
- `stage-<id>.json`: the checks, their details and notes
- `NNNN-<label>.json`, with `.stdout` and `.stderr` beside it where raw output is allowed: argv, the child environment, timing, exit status, EOF and overflow flags, and SHA-256 values
- `owner-snapshot-s0.json` and `owner-snapshot-final.json`
- `installed-*.json`
- `cold-gateway-environment.filtered.json`
- `concurrent-gateway-polls.json`
- `store-blocked-watch.json`
- `contender-start.json`
- `final-log-<role>-<file>.excerpt`: head and tail, 256 KiB each
- `fixture-manifest.json`
- `result.json`

## 7. Retained fixture and GUI continuation

The successful fixture stays stopped and verified. `fixture-manifest.json` binds:
- the scope;
- both apps: path, name bytes, ID, bundle ID, bundle device and inode, file hashes, and receipt identity and hash;
- the log directories;
- the store spelling and identity;
- the alias;
- the ports and the fixture fingerprint;
- the stored `loopId`, `runId`, `draftVersionId` and pinned `runVersionId`, for G5 history;
- the lock anchors;
- the canary token;
- a `deferredCleanup` list of exact identities. It is not executed and is only for after the GUI cases.

No Dock pin, Finder alias or browser action is created. The concrete GUI handoff belongs to root after all engineering work is done; the pending cases are G0–G9 (see `case-map.json`). Preflight-02 recorded Accessibility as not trusted and screen capture as unknown, so the instrument is the owner's physical input.

**Follow-up utility** (same file, bound to the manifest, never a general shell). `observe` and `drain` are excluded from the initial execution admission and are not redesigned here. Before any later use, root separately hash-binds the generated `fixture-manifest.json` and verifies a fresh physical `--out` parent.

```sh
node gg456-native-qa.mjs observe --manifest <scope>/evidence/fixture-manifest.json --out <new dir> [--repeat N --interval-ms M]
node gg456-native-qa.mjs drain   --manifest <scope>/evidence/fixture-manifest.json --out <new dir> --pid <pid> --birth "<lstart from observe>"
```

- **`observe`** is read-only. It records:
  - the listeners on P and P2;
  - the fixture gateway's health, process, filtered environment and open files;
  - launcher and helper processes, matched by run-ID marks;
  - established connections on P (browser evidence);
  - the leases and the bundle and receipt identity;
  - log listings with the last launcher records;
  - GraphGoblin crash reports.

  `--repeat` is capped at 240 and `--interval-ms` must be at least 250.
- **`drain`** acts only on the manifest's port P gateway with the named PID and birth. It requires a match on fingerprint, command, port, store and leases, then uses the ordinary token-bound drain.
- G7 and G8 need a shell contender and a foreign listener that root starts at the time; they are not provided here.

## 8. Corrections to the prior plan

These come from the bound contracts; the details are in `case-map.json` under `correctionsToPriorPlan`.

1. **Launcher log records.** A successful launch writes no `launcher.log` record. Failures other than `cancelled` write `stage=… outcome=…` in a separate best-effort tail of at most 250 ms after the gateway attempt ends, including after the unchanged 60 s deadline. So `store-blocked` writes `stage=waiting-for-store outcome=store-blocked`. The 8bddb93a preparation assumption that it writes none is historical, not current behavior.
2. **Installer cost.** Every installer run except a lone `--help` compiles Swift, which is why O4 is not in this driver.
3. **Installer defaults.** The installer defaults to port 4747 and `~/.graphgoblin`, so both are always passed.
4. **LANG.** A valid inherited `LANG` passes through to the gateway.
5. **App-name case.** The `GraphGoblin ` prefix is case-sensitive.
6. **Drain.** Durable waits do not hold drain, so observe-shutdown is not deterministically reachable with a provider-free fixture.
7. **Draft start (preparation 04).** A loop created by `POST /loops` has only its draft. A start without `versionId` therefore answers 404 `LOOP_NOT_FOUND`, which is how QA05 stopped. The start names the created draft and sets `allowDraft`. The run answers with a new snapshot `versionId`, never the draft ID.
8. **Drain snapshot (preparation 04).** The accepted `POST /system/shutdown` 202 is its own snapshot. S4 reads `unconfirmedRunIds` from it, not from the pre-drain GET.
9. **Configuration member order (preparation 04).** 18089 deliberately saves `launcher.json` without key sorting, so two independent installs can differ in bytes and SHA-256 while holding identical values. S5 compares the parsed objects.

## 9. Residuals and known limitations

**Retained as engineering, hosted or Swift coverage:**
- O4 installer argument refusals;
- O9 moved checkout;
- an observed draining phase or observe-shutdown;
- `waitingForRelease` and `releaseUnconfirmed`;
- installer interruption.

**Not exercised:**
- survival after the SSH session ends (O6 beyond parent, session, tty and stdio);
- macOS 15 Finder or Dock;
- Intel, other browsers, and Quit through logout.

**Driver assumptions, never run on macOS:**
- `ps -E` shows the gateway environment for a process of the same user. If it does not, `environment-observable` is recorded as unmet and the environment assertions are skipped; the other canary surfaces are still checked.
- ps may vis-encode non-ASCII bytes. `GG_DATA_DIR` is therefore compared after unvis as a soft check; the hard store-identity checks are the fingerprint, the leases and `GG_DB_URL`.
- Ports are checked free at admission and re-checked as preconditions by the stages that bind them (S2, S4, S5, S6, S7), but they are not reserved in between.
- The 60–63 s band is a QA tolerance and includes the ≤250 ms diagnostic tail; the hard limit is 65 s.
- The installer success text, bundle inventory, Info.plist key set and launcher record format come from reading the interface, not from public docs. They are soft checks, marked as such in `case-map.json`. The one exception is the S7 `store-blocked` record, which is hard because the corrected product behavior requires it.

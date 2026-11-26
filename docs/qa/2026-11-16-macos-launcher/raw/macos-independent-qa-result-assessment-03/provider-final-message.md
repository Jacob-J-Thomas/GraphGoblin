# QA03 native QA assessment for #456 (candidate 4341d1f8): incomplete, harness correction prepared

QA03 stopped partway through S2 on a QA-harness defect, not a product failure. It is not a QA pass. I have prepared a corrected driver as preparation 03 and checked it locally only. A fresh fixture and transport still have to rerun the whole suite.

Paths below are relative to `launcher/`. **R03** means `receipt-643542c98b7b489f856a0a90acf11d81/`.

## 1. Outcome of this execution

**Exact inputs.** All of these hashes match the admission, and the receipt's `binding.json` is byte-identical to `macos-independent-qa-final-binding-03.json`.

| Item | Value |
| --- | --- |
| Candidate | head `4341d1f8`, tree `a5f8fa3e`, target main `6d7fcc98` |
| Build | build04 `d75d293f…` (build result hash `738c56a1…`) |
| Driver | driver02 `1e5e4b03…` |
| Binding | `c53960cd…`, `final: true` |
| Mac | owner uid 501, macOS 26.6.2, Node 22.22.2 |
| Fixture | `91191432`, ports 62241 and 62242 |

**Transport state.**
- The SSH connection exited with code 1 and no signal, and the upload finished.
- stdout was 78,361 bytes and stderr 0 bytes; both reached end-of-stream with no overflow (`R03/ssh-result.json`).
- The driver process (PID 47237) exited 1 with both end-of-streams, no stop and no kill sent (`R03/remote-result.json`).
- `launch.json` showing `exit: null` is only the start record.
- I re-parsed the transport stream myself: all 55 evidence frames match their digests and the local files byte for byte (67,293 bytes).
- This proves the evidence was captured intact. It is not product QA success.

**Driver result** (`R03/evidence/result.json`):
- `status: stopped`, `notAPass: true`, `unmet: []`.
- The failure was `Error: response exceeded the QA cap` at `driver.mjs:236:38`.
- `fixtureManifest: null`.

**Cause, established before any edit:**
- The last recorded S2 check is `no-canary-in-store-names`. The driver's next statement (line 1005) is `shells()`.
- `shells()` fetches each built HTML shell and its first referenced asset through `http()`, whose default cap is 2,097,152 bytes.
- The first asset in the `/app/` shell is `/app/assets/index-C5U89dQm.js`. Build04's own build log lists it at 2,132.12 kB.
- A pre-existing local build matches build04 exactly: both shell hashes equal the binding's, and the asset hash `a01db82b…` equals what acceptance03 recorded on the Mac for the same checkout. The asset is exactly 2,132,126 bytes, 34,974 over the cap.
- Every other shell or asset is under 2 MiB. Acceptance03 uses the same asset-selection rule with a 16 MiB cap and fetched this asset with HTTP 200 on that checkout at 21:35:08Z.
- **Limit:** QA03 kept no per-request record, so which URL overflowed is inferred from sizes and the selection rule, not observed directly.

## 2. Stages and checks

**S0 – met.**
- `scope-private-physical` (mode 700) and `checkout-link-resolves` passed.
- Stage residue was 0 at the start.

**S1 – met.** All 25 checks passed, in 28.9 s.
- The installer exited 0 in 28,874 ms with the exact success text.
- Bundle inventory, file modes and single links, the arm64 Mach-O executable and the absence of quarantine all passed.
- Installation ID `ea6e210f…` and its matching bundle identifier passed.
- The saved config keys and values passed, and the canonical checkout path was saved rather than the link.
- The receipt is private, bound to the bundle and settled.
- Only QA entries appeared in `~/Applications` and the receipts folder, and no default resources were created.
- The installer left the checkout listing and launcher source digest unchanged.
- **Observation, not a defect:** the installer saved the data directory as NFD bytes (`75cc88`) where the input was NFC (`dataDirectoryBytesEqualInput: false`). The hard check compares normalized forms and passed. The store on disk is NFD.

**S2 – stopped after 1,967 ms. All 31 recorded checks passed:**
- **Hostile launch.** The headless launcher was given hostile PATH, NODE_OPTIONS, DYLD, proxy, LANG, LC_ALL, TMPDIR and GG_* values with HOME unset. It exited 0 in 1,592 ms with both end-of-streams. stdout was exactly `{"version":1,"code":"open-management-running","port":62241}` and stderr was empty (`R03/evidence/0014-cold-canary.json`).
- **Gateway process.** The gateway is PID 47364, parent PID 1, session and group leader (`Ss`), no terminal. It is the only listener, on `127.0.0.1:62241`, and holds both leases. Its identity was stable across two health reads.
- **Fingerprint.** It equals what the identity helper computed independently: `cde0bce5…`.
- **Process attributes.** stdio 0–2 are `/dev/null`, the working directory is the canonical checkout, and the runtime is the bound Node.
- **Environment.** No canary token appears anywhere in the gateway process. Its environment is exactly the 13 expected names, with no hostile-only names. Values:
  - `GG_HOST=127.0.0.1`, port 62241, API key and Ollama both false;
  - `LANG=en_US.UTF-8` and no `LC_ALL`;
  - `GG_DB_URL` decodes exactly into the `%41 #1` store;
  - the log admission is bound to the real instance directory's device and inode (`R03/evidence/cold-gateway-environment.filtered.json`).
- **Store.** There is exactly one store directory with the database inside it, a private `master.key` (mode 600, 44 bytes), and no canary in any store name.

**S2 checks that never ran** because of the stop:
- `both-shells-served` (soft);
- `no-helper-or-launcher-left` (soft);
- `single-gateway` (hard; it is a process-table check);
- `headless-opened-no-browser` (soft);
- `no-canary-in-logs` (hard);
- `log-directory-private` (soft).

So these are not established for the hostile launch: canary-free logs, the process-table single-gateway check, and the absence of a browser connection.

**Recovery R – met** (13 checks, 377 ms). The driver re-confirmed the same PID, start time, fingerprint, command and leases before acting. The shutdown endpoint showed `running`, and the ordinary drain was accepted with 202 (`draining`). There was no forcing. The connection was refused at 32 ms, and the follow-up process poll plus lease check reported the process gone and both leases free; that poll's raw output is not persisted. `--store-state` then returned `{"state":"free"}`.

**Not run:** S3–S7 and S9 (cases O5, O7/G5-native, O10, O11, O8 and X1). S8 was optional and not requested.

**Classification:**
- **Harness defect:** the 2 MiB cap applied to a legitimate built asset. Separately, any exception inside `shells()` turns the soft `both-shells-served` check into a hard stop. I kept that behavior so failures are not suppressed.
- **Product defects observed:** none. No QA-pass conclusion is supported.
- **Fixture or oracle problems:** only the asset cap.
- **Unverified product risk** (my reading, not observed): `Installation.swift:119` still uses `JSONSerialization` with `.sortedKeys`. It runs in the installer process (`LauncherInstaller.swift:228`), which inherits the caller's environment (`install-macos-launcher.sh:86`). That is the pattern that crashed in causal case E. Every install so far used `LANG=en_US.UTF-8` with no `LC_ALL`. The other remaining `.sortedKeys` use, the receipt encoder at `Installation.swift:245`, is the typed `JSONEncoder` pattern that did not crash in case D.

## 3. Locale crash

- **Original failure.** In QA02, the same driver02 bytes and the same canary shape (`LANG=<token>/not-a-locale`, `LC_ALL=<token>`) crashed the 370a/db37bfdf launcher: PID 45243, SIGSEGV at 751 ms, no output. Crash diagnosis 04 matched the crash report exactly (PID, time, bundle) and found no gateway or store afterwards.
- **Causal controls** (standalone Foundation processes):

  | Case | Serializer | Locale | Result |
  | --- | --- | --- | --- |
  | A | sorted | clean | exit 0 |
  | B | sorted | both invalid | SIGSEGV |
  | C | unsorted | both invalid | exit 0 |
  | D | typed `JSONEncoder`, sorted | both invalid | exit 0 |
  | E | sorted | invalid `LC_ALL` only | SIGSEGV |
  | F | sorted | invalid `LANG` only | exit 0 |

- **Corrected product.** The fix removes `.sortedKeys` from `admissionDocument`. QA03's unchanged hostile canary then exited 0, and acceptance03's two concurrent malformed-locale cold launches both exited 0.
- **Limits:**
  - No same-run before/after comparison was made.
  - The fix is supported by one QA launch plus two acceptance launches, and the probes are not integrated product runs.
  - The AppKit GUI path and the installer have not been tested under a malformed locale.

## 4. Fixture disposition and GUI readiness

**Last observed state, 21:37:55Z, with no later readback:**
- The app `~/Applications/GraphGoblin QA ü-91191432.app` is still installed (ID `ea6e210f…`, bundle inode 179008464). It is configured for port 62241 and the scope's store.
- Its receipt and its instance log directory (inode 179008506) remain. The log contents have not been read.
- The scope `~/Library/Caches/graphgoblin-456-qa-91191432/` remains, including the store `data/QA data ü %41 #1` with its database and `master.key`, now with leases free.
- Gateway 47364 was drained and released.
- Launcher lock anchors were not observed.
- The transport stage directory is also still there.
- Fixture `54a825d1` from QA02 is also retained.

**GUI continuation is not safe or ready:**
- there is no fixture manifest, so the driver's `observe` and `drain` modes cannot bind to this fixture;
- second app B was never installed;
- the S9 owner-diff, canary-free-log and stopped-fixture checks did not run.

Do not use app A for GUI work.

## 5. Remaining checks after a successful rerun

**Native stages still owed:** S3–S9 must complete under the corrected driver.

**Physical owner sequence still needed.** Accessibility control is not trusted (preflight-02), so this must be the owner's own input. SSH or headless launches are not Finder or Dock acceptance. The smallest sequence that does not repeat headless or Swift-suite evidence:
1. Finder double-click from stopped, then a warm relaunch. Expect exactly one `127.0.0.1:<P>/app/` page in Chrome that loads.
2. Finder alias launch.
3. Pin to the Dock, use the in-app Stop, then cold-launch from the Dock. Expect the run history from the manifest's run to be present.
4. Same-path replacement, after which the existing pin still launches the app.
5. Store-blocked and port-in-use windows, each with a root-started blocker: progress panel, Hide and reopen, pre-spawn Quit and repeated Quit, keyboard, focus and VoiceOver, Copy Address, and Show Log in Finder.
6. Remove the pin and alias.

These are case-map G0–G9, merged into one session. ADR-0082 also requires post-merge owner acceptance on the merged build. macOS 15 and Intel remain unexercised.

## Correction prepared: `macos-independent-qa-execution-preparation-03/`

**Driver diff** (three hunks; new driver hash `9be9a517…`):
- updated header comment;
- new `CAP.asset = 4 MiB`;
- in `shells()`, a built asset larger than `CAP.asset` stops the stage with a named error, and the served asset is fetched with `cap: builtAsset.length`.

**Unchanged:**
- the HTTP 200 and exact-hash assertions;
- `http()` itself and the 2 MiB `CAP.http` for API and shell responses;
- the 4 KiB health cap;
- timeouts, canaries, ownership and drain checks;
- `binding.template.json`, byte-identical, still `final: false`.

The README and case-map were updated, and `correction-handoff.md` has the exact diffs, source and output hashes, and evidence limits. Preparation 02 and the QA03 receipt are unchanged.

**Offline regression.** I ran it once under Node v22.23.4 on Windows, using the exact extracted driver code against a local loopback test server; it exited 0, and all 10 cases behaved as expected.
- On the legitimate 2,132,126-byte asset, driver02 stops with the cap error and driver03 passes. This holds for synthetic bytes and the actual build04 bytes (cases R1–R4).
- A one-byte-flipped, short or HTTP 404 asset is not a match (N1, N3, N4).
- One extra byte still hits the cap error (N2).
- A built asset over 4 MiB stops before it is requested (N5).
- An HTML shell over 2 MiB still hits the cap error (N6).
- A byte-level guard confirmed everything outside the three hunks is identical.

**Limits.** This was not run on the Mac (Node 22.22.2 there) and not against the product's own static server.

**Not done:** no driver run, admission, SSH, installer or product launch. The only Git, GitHub or worktree actions were read-only. The worktree's uncommitted `.gitattributes`, `.gitignore` and `.prettierignore` edits are scoped to `docs/qa/2026-11-16-macos-launcher/raw/**`, and I left them untouched.

## Still open

Hosted CI02 passed at 370a, not at 4341. Fresh final-head CI and a fresh independent Astra MAX audit are still pending. Two of three formal scans have been used, and this QA work does not replace either. No READY verdict.

**Next steps:**
1. Root reviews preparation 03, then binds a fresh `final: true` binding, run ID, ports and transport, and reruns the full suite.
2. Separately, a bounded check is needed of the installer with a malformed `LC_ALL`, on a disposable app name.
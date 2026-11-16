# GraphGoblin #438 independent native Windows QA preparation

This preparation follows the [approved QA plan](../launcher-438-qa-preparation/plan.md).
The scripts have syntax readback only. A pass becomes executable when root
binds actual merged #436 main, the built baseline or candidate, and the exact
case inputs. Preserve this directory and its manifest as reviewed.
The [initial snapshot](../launcher-438-native-preparation/SHA256SUMS.txt)
remains intact. This revision corrects the request fixture after source review.

## Native evidence

- The Windows launcher uses its existing `--config … --ensure-gateway` path.
  The compiled binary is supplied by the reviewed build. The harness uses
  real disposable SQLite and the built gateway's existing REST routes. No
  browser, provider, installer, shortcut or registry action is needed.
- Assert normal Pino records in the managed gateway log, then issue finite
  harmless GET traffic without an Authorization header after the launcher exit.
  Each response verifies the
  same gateway PID, canonical identity and running phase. Compare native
  PID creation FILETIME, launcher parent PID, exact Node and entry arguments,
  both SQLite leases, and run/Script node state before and after pressure.
  Release the Script node and require success. It has its own finite timeout.
- The baseline must exceed 8 MiB under a real uncapped writer to prove the
  byte oracle rejects the bug. The candidate must show at least three
  rotations and recent successful request records. Managed active, previous
  and declared temporary file bytes are sampled per batch. Each file is capped
  and the full launcher total spans both its primary and TEMP directories.
  Unstable inventories are retained as such.
- Warm and incompatible launches preserve the real serving gateway, its log
  destination and store ownership. The optional common-destination case uses
  independently allocated ports and stores with the same effective canonical
  log destination. An owned harmless foreign port listener stands in for an
  unrelated service and must remain up through refusal. Candidate diagnostics
  follow the admitted safe stage strings. The script places invented path,
  authorization and credential-looking query canaries in actual inputs.
- A dedicated invalid bearer request expects 401 with `UNAUTHORIZED`.
  Independent header-free 200 health probes bracket it and verify the live
  PID, fingerprint and phase. Keep the raw sampled gateway tail and record
  whether it contains a completed 401 and the synthetic bearer value. The
  inspected baseline Fastify request serializer emits the URL and selected
  fields and omits Authorization. Header absence establishes the contents of
  the sampled bytes. A fixture that delivers the header to the serializer
  is needed to establish additional redaction coverage.
- The optional TEMP case opens the primary file with Windows
  `FileAccess.Read` and `FileShare.Read`, proving denial of other write and
  delete opens while sampling can continue. Scope the exact failure outcome
  and fallback path in admission. The budget is shared. If the implementation
  drops a diagnostic to respect retained bytes, verify the closed operator
  outcome as well as the absent write. Native normal-output diagnostics,
  legacy oversized stopped-writer import/replacement, clean restart and a
  direct ordinary-shell console control have separate observations.

## Root binding inputs

Fill the two example JSON files outside this preparation directory. For the
baseline set `mode: "baseline"`, change the attempt prefix, set the entry to
`apps/api/dist/main.js` with empty extra arguments/config/environment, and set
fallback to null. The current append layout uses the install config directory.
Reconfirm it on actual post-#436 main. Candidate entry, argv, log paths,
temporary file names and exact diagnostic stages come from reviewed source.
The current inventory marks unexpected log-root entries unsafe. At candidate
admission, explicitly bind any documented fixed writer-ownership metadata
path and how its bytes are accounted for. An observed extra file is
insufficient to classify it as safe.
For a candidate with a validated sharing-denial route set
`faults.nativeFallback` to
`{"kind":"read-share-denies-write-delete","expected":"persists"}` or use
`"drops"` only for the documented behavior of the admitted case. Enable
`faults.sharedDestination` only after checking that the two configs resolve to
one real log root. Enablement is recorded in raw admission.

All directory inputs are relative to the disposable root created by the
runner. Use `%INSTALL%`, `%TEMP%`, `%DATA%` and `%DISPOSABLE%` only for
admitted fixture substitutions in config, environment and argv fields. The
runner starts from an explicit environment and applies only explicitly named
logging composition inputs. Keep `NODE_OPTIONS` absent.

Use the actual complete `collectArtifacts` object from the hash-bound #410
producer and all tracked source bytes. Its dependency coverage is the
reviewed subset of physical runtime entries and workspace links. The build
and compiler exit JSONs must record `exitCode: 0`. Bind the actual compiled
launcher and compiler source receipt separately. Verify tracked source,
complete current output trees, selected dependencies, exact revision/tree and
index, node/binary and raw build receipts at the start and close. This is a
source/output verifier. Compilation and build remain separate.

Later, after root admission, invoke PS7 with the absolute paths and the
lowercase SHA-256 of the completed admission. Replay to a fresh attempt if
separately admitted. The wrapper persists raw runner stdout, stderr, PID and
exit independently under `receipts/<attempt>`; the Node driver stores
individual child attempts, outputs, native identity and observed exits under
`attempts/<attempt>/evidence`.

```powershell
& '<absolute path to launch.ps1>' -Admission '<absolute admitted JSON>' -Sha256 '<sha256>' -ReceiptName '<admitted attempt>'
```

First failure is recorded before cleanup. Managed drain requires the exact
same serving identity, Windows creation FILETIME and SQLite lease ownership.
Verify both original births and owned listeners are gone, then census the
recorded launcher parents. Independently attest no reparse entries and
exclusive open of all named SQLite DB/WAL/SHM files together before removal.
Only the exact owned disposable root is removed. Any unresolved ownership or
cleanup condition retains the disposable tree and exits incomplete. Evidence
outside that tree stays available. The detached process's PID disappearance
and readiness come from native checks. The launcher and wrapper own raw exit
codes for the short-lived processes they create.

## Evidence still required

- Need actual candidate layout, guarded entry/identity, controlled writer
  seam and exact native compile sources. The referenced source/output
  inventories depend on post-#436 artifact shape. The example admissions are
  placeholders.
- The driver samples live bytes and routine native process behavior. A
  controlled sink/filesystem harness must verify pre-write and intermediate
  caps, UTF-8 boundaries, oversize/drop behavior, queue bursts, failed
  rename/write, disk full and interruption. No writer substitute is provided.
- A native fully occupied primary and fallback rotation case needs the bound
  candidate launcher record format and safe seeding procedure. Direct
  contender, guarded import/native-addon failure, descriptor inspection,
  reparse/hardlink/foreign ownership and live gateway rotation failures need
  exact product inputs and isolated fixtures. A late startup failure whose
  process never presents complete ownership is retained for exact reviewed
  cleanup. Baseline and candidate each need their own successful binding and
  cleanup receipts. A core matrix result does not complete all #438 QA.
- Ordinary shell verifies normal Pino logs and unchanged managed slots.
  Preserve #381 engine-side correlated private logging calls. Correlation and
  safe projection at the opt-in sink need a separately bound controlled
  composition witness, while normal shell diagnostics retain their existing
  behavior.

I've prepared driver 04 with all three QA-harness defects corrected and checked it locally; it has not been run natively and this is not a QA pass. Each defect was confirmed against the candidate source and the QA05 receipt before editing. The QA05 receipt (all 109 files), prep03 and the contract note are byte-identical before and after. The template still has `final: false`, and I made no repository, Git, SSH or remote changes.

**Packet:** `C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/launcher/macos-independent-qa-execution-preparation-04/`
**Driver 04 SHA-256:** `bafe95338dc22402a29b5805f0f0ec4862d8d3c6155220f03ca005946be4729e` (driver03 was `9be9a517…`)

**The corrections.** Everything outside these lines is byte-identical to driver03, which the controls check mechanically.
1. **S4 draft start.** The driver checks the created draft (valid ID, belongs to the new loop, status draft) before sending anything, then sends exactly `{versionId: <draft.id>, allowDraft: true}`. The 202 and valid-run-ID check is unchanged. A new check requires that the run pins a *new* snapshot ID, never the draft's own ID, with source `draft` and the same loop and version. A third check compares that same identity on `GET /runs/{id}` after restart. The draft and snapshot IDs are also recorded in the manifest data.
2. **Drain source.** `drainVerified` behaviour and deadlines are unchanged. It now also returns a separate `accepted` record taken from the POST 202 response, keeping only safe fields and never the control token. The S4 check stays soft. It now needs a real `unconfirmedRunIds` array in that 202 response that excludes the timer run. Missing, null, wrong-type or malformed lists count as not met.
3. **S5 configuration.** The comparison of the two installs' saved configurations is now exact parsed equality ignoring member order (`isDeepStrictEqual`), still soft. There is no normalisation, and extra or missing fields fail. The closed-key, value, store-spelling and per-receipt byte-binding checks are unchanged.

**Decision for you:** the three new checks are hard (`must`). They are the draft check, the new-snapshot check and the after-restart identity check. I read the existing "same run and loop retained" requirement as covering the pinned snapshot; downgrade any of them if you prefer.

**Checks run** (Node 22.23.4 on Windows, all passed; each was run twice and the second run is kept):
- **`node --check`, JSON parse and line endings:** all OK.
- **Offline controls, 49/49:**
  - What they run: the actual S4 and drain code, the actual S5 stage up to its next precondition, `checkInstalled` and the new helpers. These run against a local fake API on 127.0.0.1, with stubs only for the Mac-side probes (process table, leases, launcher, installer).
  - On driver03 they reproduce all three original failures: the 404, the drain check passing when it shouldn't, and the reordered config marked unmet.
  - On driver04 they cover every case you required.
  - The three QA05 config hashes are exactly reproduced from the parsed values in their recorded key orders. This shows they differ only by order.
- **Mutation pass, 8/8:** each defect, plus near-miss mistakes such as dropping the draft-to-loop check or recording the token, was put back into a scratch copy of driver04. The controls failed on every one.
- **Portless API check:** this runs your repository's own `createTestApp` with driver04's exact fixture and helpers, with config and test kept in the packet. Observed:
  - create 201;
  - driver03's request gives 404 "has no published version";
  - the corrected request gives 202 with a new snapshot ID;
  - the snapshot is readable, matches the draft, and is refused if started directly;
  - the run reads back flat and waiting on a timer;
  - the loop lists with a run count of 1;
  - the real drain 202 has an empty unconfirmed list.

**Concurrent commit:** your commit `635a637c` landed mid-task. I checked it separately: it touches only evidence and metadata, with no product paths. The product source I read and tested is identical to `18089bba`. Your `ROOT-COORDINATION-NOTE.md` matches that.

**Limits:**
- The offline controls and mutants use a fake API. Their app B record is derived from QA05's app A records, since QA05 never created B.
- The portless check covers route contracts only: in-memory store, timers off, no real process exit or restart. The after-restart identity and completion checks are therefore proven only offline until the native run.
- I didn't re-review S5–S9 beyond the line changed, and found nothing else blocking in what I read.
- Still open: the Swift coverage decision, final CI, actual GUI and the fresh Astra MAX audit. Formal scans 2/3 are unchanged.

The next step is yours: review the driver, bind it to a fresh fixture and run it once. Fixture `7c5ae3c2` can't be reused (its scope exists and it has no manifest).

Files are in the packet directory:
- correction-handoff.md (not self-hashed; SHA-256 `78056a28b2476e467d18f99f21c2647921a1cdc40e03d4cfe03ed8cfc4598f00`; contains the exact diffs, commands and all hashes)
- gg456-native-qa.mjs
- README.md
- case-map.json
- binding.template.json
- offline-oracle-controls.mjs
- offline-oracle-controls.result.json
- mutation-sanity.mjs
- mutation-sanity.result.json
- portless/
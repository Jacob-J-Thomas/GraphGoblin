The corrected fixture at `b1cdd204` met every criterion I checked, and every outcome matched the prediction I wrote down before running anything. This is behaviour-QA evidence only; it is not a review, sign-off, merge approval or acceptance.

**What ran (each case once, no retries):**
- **My own driver:** 11 cases against the unchanged host and producer at `b1cdd204`, using my own folders, settings, schema bytes and test marker files. 422 of 422 checks passed, all 5 predictions held, and both instrument checks passed. Exit code 0.
- **The maintained `sdk-schema.test.ts`:** 9 of 9 passed on Node v22.23.4, exit 0.
- **Expected-fault cases:** three cases (M8, M9, X3) exited with code 1. That was the declared expected result for each, not a generic pass.

**By criterion:**
- **Pause before the final rename (X1):** my driver, not the test host, held the pause for 1849 ms. In two samples 1847 ms apart:
  - The final marker did not exist.
  - The pending file was complete JSON (838 bytes) and unchanged, and no process still had it open.
  - The SDK's schema file was still present, so the SDK work had not finished.
  - The child and host were both alive, and the host had produced no output yet.
  - Windows process data showed the child was the SDK's harmless `node.exe` call under my host, with no network connections.

  After I released it, the final marker was byte-identical to the held pending file. The run then aborted and settled, the child and schema folder were gone, and the pending file was gone. M7, the maintained self-releasing version, agreed.
- **Read error and bad JSON (M8, M9):** each exited 1 with the original error in stderr: `ENOENT` for M8, and `SyntaxError` with the marker being exactly `{` for M9. No AbortError text replaced either one. The SDK work was aborted and settled, the child was gone and the schema folder was removed.
- **Empty final marker (X3):** this is the one new failure case I added, because the maintained fault tests inject the fault themselves. During a hold I created a 0-byte final marker, which is exactly what the old bug could expose. The corrected host failed with the original `SyntaxError: Unexpected end of JSON input`, aborted and settled.
- **Short and 226-character runs, success/error/abort (M1–M6):** the schema bytes were exactly mine. The 226-character runs produced the 243 and 255 path lengths. Marker files and the TEMP folder were unchanged, and my driver's environment was unchanged. The SDK arguments contained no model, base URL, API key or other config.
- **Proof of process exit:** in every run that read a record, the host's own check reported the child gone. My driver separately confirmed all 11 children absent, and in X1 and X3 I matched each child's identity while it was alive.

**Non-blocking findings for the reviewers:**
- In X3, where no record could be read, the host skips its own child-exit and schema-cleanup checks and reports those fields as empty. Those facts came only from my driver. The maintained fault tests avoid this by reading the record before injecting the fault. D190's requirement to abort and wait for settlement was still met.
- The host's `observerWaiting: true` is a hard-coded value, so only X1 independently shows the observer was waiting.
- If the child is killed while paused, its pending file and pause file stay behind in the test folder, not in TEMP.
- Each node process had a `conhost.exe` child; all were gone afterwards.

**Not covered:** no natural OS race or orphan is claimed, and I did not re-run the old-source counterfactual. Typecheck, lint, coverage, build, CI and native Codex/provider runs were not done here. Network checks only exist for the two held cases.

**Slips, all recorded in the report:**
- One temporary diff was briefly written to the system TEMP during setup; I deleted it in the same command and confirmed it was gone.
- One log header (`finalize-scratch.log`) describes that command's environment wrongly; I left the log as written.
- I ran plain `git status` a few times in the QA checkout before the driver; this can refresh git's cached file info but changes no content.
- The driver stayed alive an extra 15 s after finishing because of a leftover timer; this didn't affect any evidence.

**Cleanup:**
- **Processes:** no host or child needed killing. The only kill was my own test process in instrument check C2, by its own handle.
- **Scratch:** only `G:\ggq\qa-scratch\i4-363-marker-qa` was removed, after I listed its contents and checked it contained no links.
- **Checkout:** the QA checkout is still clean at `b1cdd204`.
- **Earlier packet:** `i4-363-sdk-independent-02` is byte-for-byte unchanged.
- **Untouched:** ports 4747/4748, owner stores, the author checkout, GitHub, product and test source.

The original Astra CHANGES_REQUIRED and all three general-review outcomes stand. The Fable review, fresh CI, native artifact check and coordinator completion are still open.

Everything is in `C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-363-marker-independent-01`:
- `REPORT.md`
- `PLAN.md`
- `run-01/` (per-case raw results)
- `SHA256SUMS.json` (145 files, SHA-256 `0f8d2295…32c0`)
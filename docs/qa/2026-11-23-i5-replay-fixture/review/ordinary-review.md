# Review verdict: **ACCEPT**

The six-line change synchronizes the test on the right authority, the browser's full run record. It does not weaken any product guarantee.

## Why the synchronization is correct

- **The failure was a test-precondition race, not a product fault.**
  - The `[data-status="succeeded"]` wait observes `HeaderStatusBadge`. Per `RunInspectorPage`, that badge can be event-qualified and lead `runQuery.data`. The source comment says it is "Presentation only; controls, recovery and the failure stay the record's."
  - The test-side `eventually(...finalizedAt)` poll reads the server, not the browser cache.
  - Neither wait bounds the record that `RunControls` receives. So the Replay click at 18.768 froze `setReplaySeq(run.recovery.observedSeq)` = 12 from the still-running record.
  - The server then correctly refused it (`recovery.observedSeq !== input.observedSeq` → `RECOVERY_STALE`).
- **The new waits read the same object the opener reads.**
  - `DeliveryPanel` and `RunControls` are both rendered inside the same `QueryState` callback from the same `run`.
  - `"Execution: succeeded. …"` is rendered from `run.status`. `"Fully finalized."` requires `run.finalizedAt` and no pending deliveries. This definition configures no webhook, so finalization alone decides it.
  - Once both are visible, the next Replay click's `setReplaySeq(run.recovery.observedSeq)` uses a finalized record. The trace shows such a record carries seq 18.
- **The old failed incarnation is excluded.**
  - The failed record rendered `Execution: failed.` and could have rendered `Fully finalized.`. The `role="status"` filter alone would be ambiguous.
  - While running and non-terminal with no deliveries, `DeliveryPanel` returns `null`. The exact `Execution: succeeded.` text therefore requires the new terminal record.
  - Ordering the succeeded-text wait first prevents the old finalization from satisfying the gate.
- **Locator mechanics look sound.**
  - `getByText(..., { exact: true })` matches the `<p>` whose textContent joins the three React text nodes.
  - The anchored `hasText` regex on `role=status` isolates the finalization line and avoids strict-mode ambiguity with other status regions.

## No weakening or masking

- **Header is not trusted as authority.** The change moves the gate from header-derived evidence to the record, which matches the inspector's stated contract.
- **Frozen consent is untouched.** `replaySeq` is still captured at modal open and not refreshed while the dialog is open. The server guard is unchanged. The test only opens the modal once the record has settled, which is what a successful-path test should do.
- **Prior failed state stays covered.** The earlier assertions are unchanged: `Failed: SCRIPT_OUTCOME_UNCERTAIN`, the alert text, the Cancel path, the consent-gated earlier Replay, and `status === 'failed'`.
- **No assertions were relaxed.** `202`, the fork id, the URL, the source link, `count()===3`, the unchanged source history and the source status `succeeded` all remain. No timeouts or retries changed, and there are no production bytes.
- **The stale-refusal path is not hidden.** A real user who opens Replay during the header/record gap gets the designed 409 "Refresh and review" refusal. That is intended semantics, not a defect this test was meant to cover.

## Residual assumptions (non-blocking)

1. **Finalization must be the last seq-advancing step for the source run.** The diff relies on this. The supplied sources do not show it directly. The trace (finalized GET has seq 18; the POST was refused because 12 ≠ the server's seq) is consistent with it, and the retained `202` assertion would still catch any violation.
2. **Resume must clear or replace the failed incarnation's `finalizedAt`.** If a succeeded-but-not-yet-finalized record could carry the old `finalizedAt`, `Fully finalized.` could pass before final seq. The resume/finalization code is not supplied, so this is unverified here. Again, the `202` assertion guards against a silent pass.
3. **The two expectations are checked sequentially, not atomically.** Since `succeeded` is terminal, regression between the checks is not realistic.
4. **Optional hardening, not required:** scope both texts to one Finalization card locator, or also assert that `Status from event #…; the run record is updating.` is absent.

## Evidence limits

- I ran no tests, executed nothing, and inspected nothing beyond the supplied diff, the four source excerpts and the trace summary.
- Nothing here establishes the runtime claims; they come from the supplied trace.
- The independent exact-case PASS (1/1, workers 1, retries 0) is a single sample and not flake-rate evidence.
- Trace and cleanup closure is still pending separately.
- Original CI 45085137009 remains failed. A fresh full CI run, native validation and a signed merge are still mandatory before this can be treated as resolved.
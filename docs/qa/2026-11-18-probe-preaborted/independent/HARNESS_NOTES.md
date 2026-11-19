# Scope and retained harness preparation

This is the compact public subset of a larger external behavior-QA packet. All 18 paired runs retain their raw Vitest JSON, full event streams, actual command/cleanup receipts, selected case sources/configs, source binding and harness hashes. Full stdout/stderr, every exploratory attempt and all prepared inputs remain in the external parent packet. The replay paths in receipts intentionally retain their actual C:/D: locations.

Only snapshot-02 was tested as the correction. Snapshot-01 was never executed. The coordinator subsequently confirmed snapshot-02 is the final source. The testing-document hash is explicitly attributed to the coordinator; this behavior lane did not review that document.

The public cancellation transport control is exploratory and remains in the full packet. It established genuine Vitest interruption and already-aborted beforeEach exit before any maintained case runs. Its initial driver predates the additional after-close observation field; it is not used as corrected-candidate acceptance evidence. Every meaningful baseline/candidate run used the same driver and native runner whose hashes are retained here.

The initially prepared baseline helper-double-fault input combined two observation import blocks. This unexecuted input was retained and superseded before use. The actual baseline run uses baseline-control02-helper-double-fault, retaining the previously validated independent error-control body verbatim with the maintained helper. No failed execution was replaced or discarded. One early status read occurred before the final baseline helper's summary existed; the original run continued and completed normally, without restarting it.

The Node API reports a real user-interrupted run with process exit 1 even when its selected test is skipped with zero errors. Also, its aggregate pending counter can include a cancelled container while the selected assertion still passed on the broken baseline. Acceptance therefore uses the actual selected assertion status together with zero body-owned roots, children and errors; it does not infer a skip merely from run interruption or aggregate counters.

Both Vitest and the outer runner own temporary data. The nanoid directory present at beforeEach is unchanged at the worker's final observation and disappears on vitest.close(); the outer run TEMP directory itself remains until the wrapper's final, verified disposable cleanup. The deliberate root-removal-fault control retains precisely its empty case root after close, reports the injected error, and disposes it externally only after the successor and receipts have observed it.

No author D: lane, shared package store, owner process, original packet, Git/index or remote state was modified. There was no install, source repair, general/adversarial review, publication or other-intent work in this lane.

The retained driver uses the installed public `vitest/node` export. The version actually exercised was Vitest 5.0.3 with project Node 22.23.4.

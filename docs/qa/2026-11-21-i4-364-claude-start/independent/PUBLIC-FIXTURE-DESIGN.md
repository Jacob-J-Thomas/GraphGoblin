# Public fixture design refinement, before execution

Live source inspection shows `FsWorkspace.resolve` creates fixed working directories recursively. Supplying a missing path to REST alone therefore does not establish a process-start refusal: the engine repairs it before Claude launches. A file in its place would instead fail in the workspace layer.

To exercise this patch through the real composition without altering engine/provider source, every test loop has a public input-wait before inference. After admission readiness, the independent harmless native fixture can gate its final auth probe on a sidecar file. The controller releases the public input wait, waits for the actual gated auth launch marker (workspace resolution has already completed), removes/replaces only the owned cwd, then releases the probe. The native turn sees the missing/file cwd. This is an intentionally controlled real-filesystem race, not a claim that an ordinary missing fixed path survives workspace resolution.

For missing-executable recovery, remove the owned fake executable while the run waits, then release input. The harness's prerequisite probe refuses before any turn; restore the same executable path and use the public Resume action at its observed sequence. This predicts restorable installation failure followed by exactly one actual successful turn.

The gate expires after ten seconds to prevent an abandoned test from holding a child. Every API operation and marker is retained. Real provider authentication is simulated and cannot establish installed Claude account/provider behavior.

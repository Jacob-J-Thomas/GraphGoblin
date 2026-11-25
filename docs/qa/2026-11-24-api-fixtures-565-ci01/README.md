# Windows canonical-path test correction for #565

The new Windows API entry step in [CI attempt 1](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/45528867812/job/138918896484) exposed five assertion failures. Its temporary root uses `RUNNER~1`, while the existing ownership implementation reports the canonical `runneradmin` path. Native launcher acceptance passed before the API step failed. The failed log is preserved, not replaced by a rerun.

The correction requires the exact `realpath` of each existing lock or reclamation directory in the diagnostic. The fixture still supplies the original temporary path. Exit codes, complete one-line refusal checks, owner records and live-owner HTTP assertions remain unchanged. No product behavior, timeout, retry or skip changed.

A local disposable junction control reproduced the same five failures before correction (9 passed, 5 failed, 5 platform skips). The corrected source passed all 14 Windows-applicable cases with the same 5 platform skips. This is canonical-path alias evidence; the hosted log separately establishes the actual Windows short-name case. Both local invocations used test-owned stores and ports 62000–62099; provider isolation stayed enabled. Source bytes stayed unchanged during each run.

API typechecking, scoped formatting and whitespace checks passed after the correction. This packet is an author checkpoint, not independent review or QA. Separate actual Claude review and QA await its reported subscription reset; a fresh hosted run and designated final audit remain required before merge. Original review and QA remain bound to the previous head in the [first packet](../2026-11-24-api-fixtures-565/README.md).

The manifest binds the original raw bytes. Packet-local Git attributes retain them without newline conversion. The control script retains local replay paths; it creates only disposable directories and invokes the selected built-entry test file.

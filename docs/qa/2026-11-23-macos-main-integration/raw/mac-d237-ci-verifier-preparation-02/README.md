# D237 macOS CI verifier correction

**Prepared for independent recheck.** Offline controls exercised retained artifact formats and synthetic mutations. The first-attempt result for the current integration candidate is still unbound. This packet has no publication, merge, review, device-local GUI, or owner acceptance status.

The first preparation and its independent refusal remain sealed. The two reported mutations passed the original checker. This successor rejects each through the hosted Mac verification path. [Original preparation](../mac-d237-ci-verifier-preparation-01/README.md) · [Independent refusal](../mac-d237-ci-verifier-independent-01/REPORT.md)

## Bind a future run

Use Python 3.9 or later, an existing authenticated GitHub CLI, and an explicit Node 22.22.2-or-later executable in the Node 22 line. Provide the current PR, first run ID, full head and main-target SHAs, a fresh evidence directory outside the checkout, the integration checkout path, and the reviewed Windows canonical replay driver. The checkout path is used for the Windows replay directory safeguard.

```text
python -B verify-mac-ci.py PR RUN HEAD TARGET OUTPUT --workspace WORKSPACE --node NODE_EXE --windows-replay REPLAY_ARCHIVES_MJS
```

The authorized Windows replay driver is [replay-archives.mjs](C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/pr508-marker-independent-qa/replay-archives.mjs). Its SHA-256 is pinned. The verifier loads the Windows evidence module from the tested Git tree, pins its bytes to the Git blob ID, and reuses the driver's exact-result comparison. The wrapper does GitHub API reads and a local Windows evidence replay when actually dispatched. Failed or partial evidence remains in the fresh output directory. The top-level `verified.json` appears only after all checks and the final current-PR, main-target and run readbacks. The existing Windows receipt schema is retained in `windows/verified.json`.

The verifier requires the exact reviewed seven-job workflow digest `e64133d66dbd3506db5f9c6e371abd964488cab89922c5934cea7d7b1021c778`. A workflow revision needs a new reviewed bind. This includes the named successful steps, the ordered targets of the synthetic tested merge, exact checkout SHAs in six logs, audit without high or critical findings, all 13 V8 workspace summaries with all four thresholds, shipped template observations, and Edge with zero retries and the one declared live-provider skip. There is no path that accepts a previous job topology, a rerun or a partial gate.

## Evidence scope

- The hosted Mac ZIP metadata and upload digest bind the downloaded bytes to the current run. The toolchain, installer, and gateway receipts bind that evidence to its exact tested commit and tree. An Actions digest is a checksum. This verifier performs no signed-attestation verification.
- The tested tree enumerates the tracked Swift roster. The production source inventory and per-file SHA-256 values match all 25 production Git blobs and both executable entry points. The retained LLVM zero and observed exports reconcile by source and target, with at least 90% of both lines and regions. The verifier checks the successful tool receipts, exact profile paths and object order, and SHA-256 of the recorded streams for the production, zero and presentation exports and their profile merges. The combined profile's binary header is checked. Raw profile inputs and command provenance rely on their existing hosted witnesses because the artifact does not retain each input binary.
- The Swift event stream reconciles all declared suites and functions with ordered starts and passing ends. Parameterized functions reconcile the declared, started and ended case multisets using their retained IDs and display names. The number of completed functions matches the terminal count in both the event stream and retained stdout. Passing names bind the explicit branch-outcome tests, and any reported LLVM branch denominator is retained.
- The Mac installer and gateway evidence includes the successful install and replacement, selected refusal/contender exit codes, cold/warm observations, both gateway shells, and the recorded drain and cleanup. The gateway fingerprint fields describe hosted built output. This verifier does not rebuild Swift or the gateway and does not claim device-local GUI acceptance. The checked native captures establish the hosted role described by the workflow.
- The old CI14 root verifier checks a historical run that failed the combined gate. Publication validators 13 and 14 pin historical archive/index bytes and help locate those fixtures. Their counts and prior native outcomes are excluded from current admission.

Run the offline controls with `python -B test-offline.py` in this packet. They use the existing six-job CI logs and archived Mac and Windows artifacts only as format fixtures. The original seven checks still pass. The two additional checks reproduce the original acceptance of failed or absent LLVM export receipts and a Swift stream with only eight events. They verify refusal of both and cover wrong profile, object and stream bindings, unmatched, omitted and reordered case events, a missing suite, and missing named branch-outcome evidence. The Windows process call is mocked.


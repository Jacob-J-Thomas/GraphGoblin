# #419 candidate offline QA preparation

These tools are prepared for independent readback after root admits a frozen candidate and obtains the true native child exit and pipe-close receipts. The tools adapt the accepted baseline’s read-only verifier for the same sealed fixture. The candidate tools have no execution receipts.

`verify.mjs` reads the candidate’s full supervisor binding by reference. It confirms the admitted head, tree and launch-admission hash, clean checkout, matching post-#410 merge and index, complete tracked/output path inventories, relevant source and loaded binary hashes, selected dependencies, both frozen preparation packets, separate native exit and stream close, and owned store cleanup. The independent source sample includes changed runtime TypeScript paths. The verifier reads the retained baseline summary and root acceptance at their known hashes and checks the supervisor and candidate both consumed that baseline.

For each of eight actual TCP closes it checks the exact operation progression, only the initially held operation settling after close where applicable, and no new repository calls, writes, sends or Fastify error hooks after close. It checks listener cleanup, the controlled rejection, both page-two responsiveness controls, exact status/content type/body bytes for all eleven positives against the accepted baseline, all ten typed negatives, and preserved seeded history rows. For an incomplete native result or a failed offline verification, preserve the first failure and read the raw process dispositions and harness summary for the available observations.

After root supplies the attempt suffix, frozen head and tree, and native launch admission SHA-256, run from a fresh external report directory using the project Node and PowerShell. `read-process-listener.ps1` reads the exact recorded PIDs and local port using host process and TCP tables.

```powershell
& $qaNode (Join-Path $qaPrep 'verify.mjs') $qaSuffix $qaHead $qaTree $qaLaunchAdmissionSha256 1> $qaStdout 2> $qaStderr
& (Join-Path $qaPrep 'read-process-listener.ps1') -Suffix $qaSuffix 1> $qaProcessReadback
```

Cite the full build binding and kernel/stream receipts, raw summary, first offline stdout/stderr, and current process/TCP observations in the eventual report. Evidence covers compiled production routes composed in instrumented Fastify over TCP and file SQLite with controlled gates and synthetic histories. Ordinary gateway startup and browser behavior need separate evidence. [Accepted baseline](../runtime-419-native-baseline-first-report/README.md) · [Frozen harness](../runtime-419-native-preparation/README.md) · [Launch preparation](../runtime-419-execution-preparation/README.md)

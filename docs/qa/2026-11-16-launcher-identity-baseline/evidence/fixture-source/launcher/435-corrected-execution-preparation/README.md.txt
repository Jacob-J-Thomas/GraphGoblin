# #435 corrected native execution

The first junction attempt reproduced the product defect and stopped during the native
matrix when a PowerShell process observation emitted CLIXML startup progress. Its exact
exit, pipe closure, fixture evidence and subsequent recovery remain in the original packet.
The corrected fixture suppresses progress in that observation. [Original first failure](../../launcher-435-native-preparation/evidence-baseline-first/first-failure.json)
· [Corrected junction](../../launcher-435-native-preparation-progress-correction/README.md)
· [Corrected symlink](../435-native-symlink-preparation-progress-correction/README.md)

## Admission

1. Root verifies `SHA256SUMS.txt` and prepares a new external launch admission from
   `launch-admission.example.json`. The example reuses the original junction baseline
   admission and accepted build binding. Fill in the corrected supervisor hash and set
   `state` to `root-admitted` only for the intended pass.
2. For the symlink pass, select `fixture: symlink` and supply a hash-bound v1 verification
   input for the same phase, kind and build. Use the original preparation's v1 launch
   example to create that input. It is consumed only by `job.mjs verify-launch`. The old v1
   supervisor is never invoked by the overlay. For a later candidate, supply that phase's
   separately admitted completed build binding and matching v1 verification input.
3. Use a fresh `evidence-<phase>-<suffix>` name under the chosen corrected fixture and
   a fresh `launcher\435-native-corrected-<kind>-<phase>-<suffix>` supervisor directory.
   Keep canonical Windows paths and use PowerShell 7.2 or later with `NODE_OPTIONS` and
   `NODE_PATH` absent. Read each completed result before admitting subsequent work.

```powershell
$qaPrep = 'C:\Users\98jak\graphgoblin-qa\2026-11-13-aidlc-batch\launcher\435-corrected-execution-preparation'
& "$qaPrep\launch.ps1" -AdmissionPath $qaCorrectedAdmission -AdmissionSha256 $qaCorrectedAdmissionSha256
```

The old `job.mjs verify-launch` checks the successful build receipt, current tracked source and
index, all 13 build-output trees, the selected dependencies and workspace links, Node, system
binaries and both original fixture seals. The overlay uses that proof before and after native
execution. It requires the original agreed phase, kind, Node and build binding to match the
corrected admission. A previously used v1 admission is suitable because verification reads its
product proof and source fixtures without creating the paths named in the old plan.

The overlay separately checks the exact correction manifests and all their members, before and
after the corrected run. `preflight.json` records the old verifier's readback under
`originalProof` and the actual `executedRunner`, `correctedFixtures`, argv and evidence paths at
the plan level. The corrected junction runner loads the adjacent corrected `native.mjs`. The
corrected symlink runner binds that same corrected junction manifest, runner and native utility
in its own records, and the overlay verifies those three references against the corrected seal.

## Results

The [source delta](source-delta.patch) retains the original supervisor's native process,
birth/PID, actual exit, raw pipe-close and 270-second observation mechanics. The fixture's
245-second watchdog continues to apply. The overlay sends no process signals and leaves any
unresolved disposition explicit. `gg435-corrected-native-launch-result/v1` binds the preflight,
actual corrected runner, both corrected seals and underlying build proof.

Code 0 and `matrix-finished-for-review` require the actual zero exit, both pipes closed, the
same closing proof and matching fixture provenance. Independent QA reads the per-case and
cleanup evidence. Code 2 and `capability-unavailable` require the actual true-symlink
`EPERM` or `EACCES` creation refusal with the link absent before native work. Such a result
leaves symlink acceptance open. Other failures remain incomplete.

Preparation verification covered syntax and hashes. Build, binding capture and native execution
remain outside this preparation.

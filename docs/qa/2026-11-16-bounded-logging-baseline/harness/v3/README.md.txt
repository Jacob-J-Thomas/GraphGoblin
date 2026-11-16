# GraphGoblin #438 native Windows QA preparation V3

**Preparation only.** This revision addresses one harness transport artifact before another root-admitted run. No fixture, gateway child, CIM query, cleanup probe or native test was executed while preparing V3.

## V2 failure and owned drain

V2 baseline attempt 2 had already started a quiet gateway successfully. The first native identity read then failed in `runPowerShell`: Windows PowerShell 5.1 wrote progress-only CLIXML to stderr, including “Preparing modules for first use.” The helper correctly requires exit code 0 and empty stderr, so the assertion stopped the run. The same helper failure also blocked its cleanup path. The original failure receipt remains in V2 at `attempts/baseline-attempt-2/evidence/first-failure.json`; V2 and its attempt evidence are unchanged.

Root later drained only the identity-bound process PID 12212, creation FILETIME `134392970609838060`, port 55313. The retained result reports the exact birth gone, listener closed, lease/reclaim guards absent, recorded parent children absent, fixture tree retained and no deletion. The result remains external at `../launcher-438-baseline-02-owned-drain/result.json`; it was not copied into V3.

## Narrow helper change

V3 copies the ten V2 sealed payloads. The old V2 README is retained byte-exact as [original-readme.md.txt](original-readme.md.txt). The V3 `native.mjs` starts from the V1 helper and changes only the source passed to UTF-16LE/base64 encoding: it prefixes `$ProgressPreference = 'SilentlyContinue';` plus a newline. Exit-code 0, empty-stderr assertion, 9-second timeout, process identity and ownership assertions are unchanged. This does not filter stderr or suppress errors or warnings.

The V3 [binding module](binding.mjs) changes exactly two fixed paths to this V3 `native.mjs`. The example admission updates `nativeModuleSha256` to the new helper hash; the remaining example values are placeholders. The original V2 source manifest is retained at its source path and hash in [copy-delta-provenance.json](copy-delta-provenance.json); a new [V3 SHA-256 manifest](SHA256SUMS.txt) seals this directory.

Microsoft’s [PowerShell 5.1 preference-variable documentation](https://learn.microsoft.com/en-us/PowerShell/module/microsoft.PowerShell.core/about/about_preference_variables?view=powershell-5.1) lists `Continue` as the default for `$ProgressPreference` and says `SilentlyContinue` runs the command without displaying progress. This supports the narrow harness adjustment; the Windows helper behavior still needs root’s separately admitted positive and error controls.

## Evidence boundary

V3 contains preparation files only. Its modules receive syntax checks and `launch.ps1` receives PowerShell 7 parser-only validation; neither checker invokes the native helper or any fixture. The full V2 attempts, failure receipts, disposable fixture and root drain evidence remain in their original locations. This is not native QA acceptance, source review or a successful baseline result. Root controls ACLs, helper controls and any new run admission.
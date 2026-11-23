# QA459T independent #459 D166 F4 candidate timing extension (v1)

Independent, candidate-specific extension frozen **before** its execution. It is not product code,
not a maintained test and not the author's `NativeChecks --cleanup-deadline-checks` mode.

## What it exercises

`qa459t-f4.mjs` compiles the candidate's unmodified committed `apps/windows-launcher/Launcher.cs`
together with `harness/Qa459tCleanupDecision.cs` in **one** `csc` invocation
(`/target:exe /optimize+ /platform:x64 /main:Qa459tCleanupDecision`, references
`System.Windows.Forms.dll` and `System.Web.Extensions.dll`). Being in the same assembly, the harness
reaches the intended shared internal seam `HelperProcess.AwaitCleanup(Func<bool>, Func<long>)`
(declared at `Launcher.cs:1011`, called by the production cleanup path at `:986`) by ordinary
internal access. There is no reflection, private member access, product edit or substitute decision
implementation. Every verdict is the product method's own `bool` return value.

The driver binds the checkout head/tree (clean), the `Launcher.cs` sha256 and git blob, the harness
sha256 and the compiled assembly sha256. It stops on a failed compile and never reuses an assembly.

## Cases (8; frozen)

Each case records the returned bool, the exact delegate call order (`O` = observe, `E` = elapsed
sample) and the elapsed values read.

| Case | Clock / observation                                                       | Expected | Order                 |
| ---- | ------------------------------------------------------------------------- | -------- | --------------------- |
| T1   | complete, sampled 1,999 ms                                                | `true`   | `OE`                  |
| T2   | complete, sampled 2,000 ms (equality)                                     | `false`  | `OE`                  |
| T3   | complete, sampled 2,001 ms                                                | `false`  | `OE`                  |
| T4   | clock 1,999 at pass start; the pass advances it to 2,001 and completes    | `false`  | `OE`                  |
| T5   | incomplete at 1,999; next pass complete at 2,001                          | `false`  | `OEOE`                |
| T6   | incomplete at 1,998; next pass complete at 1,999                          | `true`   | `OEOE`                |
| T7   | incomplete at 2,000; no further pass                                      | `false`  | `OE`                  |
| T8   | real `Stopwatch` started just before; pass sleeps 2,050 ms then completes | `false`  | `OE`, sample >= 2,000 |

Acceptance for this extension: harness exit 0, 8/8 cases PASS, `CleanupMilliseconds == 2000`.

## Limits

These are deterministic **shared-decision** observations. A `bool` result alone does not prove the
production mapping of `false` to `helper-cleanup-unconfirmed`, retained held guidance, pending-I/O
completion ownership, job closure or later-disposal ordering; those remain source integration
evidence unless reached by a separately named actual public native control. No OS cleanup, race,
late-kernel completion or new fault seam is attempted.

## Run

```
node qa459t-f4.mjs --checkout <checkout> --scratch <scratch> --out <out> \
  --expect-head <sha> --expect-tree <sha>
```

Writes `private/f4/<runId>/` (raw harness result, stdout/stderr, run record) and
`public/f4/<runId>/` (path-scrubbed projections). Existing run folders are never overwritten.

# QA459N relevant ordinary native regressions (v1)

Independent selection, frozen **before** execution, of existing ordinary native controls relevant to
the D166 correction: helper success/refusal, private-job/pipe cleanup, containment capability,
detached-gateway NUL stdio with a retained handle, unrelated-sentinel preservation and the shared
cleanup decision. It is not a new test and not the broad 31-criterion matrix or full tooling
regression.

## Exact existing entries

All three are modes of the maintained `apps/windows-launcher/NativeChecks.cs` program, executed by
the existing acceptance subtest **'native closed outcomes, launcher pair bounds and NUL stdio checks'**
inside the test **'bounded Windows logs: stale entry, closed outcomes, one writer per root, legacy
writer and unsafe names'** (`tooling/scripts/windows-launcher.acceptance.mjs`). `qa459n-native.mjs`
reproduces that subtest's exact commands: the same `csc` command and flags, argument order, timeouts
(60 s, 60 s, 10 s), environment (inherited minus `GG_*` and `JEV_API_KEY`, isolated `TEMP`/`TMP`),
private `install α` folder ACL and expected stdout. It stops at the first failing mode, as the
subtest does.

| Entry | Mode                        | Relevant content (from the committed source)                                                                                                                                                                   |
| ----- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| N1    | `--bounded-log-checks`      | Closed child-exit outcomes, privacy of presentation/records, closed ownership detail, log root admission/rotation, and a detached `NativeProcess.Start` child with NUL stdio whose retained handle reports exit 73 |
| N2    | `--helper-checks`           | `CheckCapability`; clean/slow/padded success; raw untrimmed validator input; six refusals with closed codes and no canary; four inheritance modes whose live descendants are collected by the private job with `0xE0470459` within the shared allowance; unrelated same-executable sentinel survives; 15 s cap |
| N3    | `--cleanup-deadline-checks` | The author's maintained deterministic `AwaitCleanup` decision checks (six `Check` calls)                                                                                                                       |

Each mode is a grouped native control: it exits non-zero at the first failing internal `Check`, so
individual internal assertions are not separately observable; only the mode verdict is counted.

## Differences from the maintained subtest (declared before execution)

- The fixture base is an owned disposable scratch folder, not `<checkout>/.tmp`; the node:test
  wrapper and the `ciEvidence` recorder (disabled outside hosted CI) are not used.
- The maintained subtest is one test; it is counted here as three native entries (N1-N3) so each
  mode's outcome stays visible. The sibling subtests of that test, including the author's strict
  ownership subtest and real-gateway subtests, are not run.
- No port is used by these modes. No real gateway, store, WMI query, GUI, shortcut or provider is
  involved.

## Run

```
node qa459n-native.mjs --checkout <checkout> --scratch <scratch> --out <out> \
  --expect-head <sha> --expect-tree <sha>
```

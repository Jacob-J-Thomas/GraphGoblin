# QA167I independent D167 behavior QA harness (v1)

Independent behavior QA for the D167 F5 correction of #459 at source
`184c95ac2d08590e258c084723eb9ab379f0bbe5` (tree `404700711621832629aef6d505b69076972474da`, sole
parent `c6f08d4a62c1488690096f69f577a68c6d382cbc`, target main
`47ca4640793a81efa5bec661dba25627de314774`). Not product code, not a source review, not a replacement
timing implementation. Expectations in `qa167i-cases.json` and the assertions in `Qa167iDeadline.cs`
were written from the D167 decision, ADR-0086 and the candidate source before any execution.

## Assemblies (`qa167i-build.mjs`)

1. `GraphGoblin.exe`: the checkout's unmodified `apps/windows-launcher/Launcher.cs` with the installer's
   csc flags (`/target:winexe /optimize+ /platform:x64`, Windows Forms and Web Extensions references).
2. `Qa167iDeadline.exe`: the same unmodified `Launcher.cs` plus `Qa167iDeadline.cs` in one assembly
   (`/main:Qa167iDeadline`). Same-assembly compilation is what reaches the intended internal seam
   (`WorkDeadline` constructor, `Recheck`, `Within`, `Check`, `Remaining`, `Expired`); no reflection.
3. `Qa167iPublicEntry.exe`: references `GraphGoblin.exe`; public members only
   (`WorkDeadline.Start`, `HelperProcess.Read`, `Program.Quote`, `LauncherFailure`).

## Cases

- D01-D11 (`qa167i-deadline.mjs` runs `Qa167iDeadline.exe` once): eleven deadline cases, 79
  assertions. Evidence classes: component-deterministic (production members, controlled clock),
  native-deterministic (public `HelperProcess.Read` with real Node children; the shared deadline's clock
  advances only from caller/validator callbacks), native-real-time (real Stopwatch, real waits). None
  injects an OS scheduling fault. Private `Gateway.ReadHelper`, `StoreHasLiveOwner` and `Ensure` are not
  called; the D cases mirror ReadHelper's shape (`Within` around preparation plus `Read` with the same
  deadline).
- N1-N6 (`qa167i-native.mjs`): six grouped public native controls. N1-N4 and N6 run the compiled
  launcher's ordinary quiet entry `GraphGoblin.exe --config <file> --ensure-gateway` (no dialog, no PWA);
  N5 runs the public helper-entry harness. N1-N3 and N6 use the disposable fixture repository in
  `fixtures/repo` (helper protocol and a gateway main that records a marker and exits 54 without
  listening). N4 uses the real built checkout on a disposable store and port and tears the gateway
  down with the ordinary drain request.

## Ownership and teardown

The driver owns the launcher processes it spawns (exact libuv handles, watchdog only), one unrelated
same-executable sentinel (exact handle, killed at teardown), and the N4 drain request. It never signals
a helper; stalled helpers write heartbeats so their termination by the launcher's private job is
observable without PID lookups. Ports: bind-checked 25880-25899; an unavailable port is skipped, never
inspected or cleared. Raw originals go under `<out>/private`, path-scrubbed projections under
`<out>/public`.

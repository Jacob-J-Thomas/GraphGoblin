# QA459I independent #459 correction QA driver (v2)

v2 is v1 with one expectation correction and no other change: case Q06 accepts one or more
ownership samples (`ownershipCalls: [1, 60]`, previously `[2, 60]`) in both its baseline
prediction and corrected expectation. ADR-0086 admits a held retry only when the remaining window
less the 2 s reserve fits the previous sample's measured duration, and the actual producer's first
sample took 3,375 ms on this host in the v1 run. The harness, fixtures, build step and every other
case are byte-identical to v1.

Independent behaviour QA for the D166 F3 correction of #459. This is not product code, not a
replacement parser and not a source review. F4 is outside this driver (source-only at the held
baseline; the candidate phase uses the product's own shared deterministic timing seam).

## What it exercises

`qa459i-build.mjs` compiles the checkout's unmodified `apps/windows-launcher/Launcher.cs` with the
installer's csc flags into `GraphGoblin.exe`, then compiles `harness/Qa459iHarness.cs` against that
assembly. The harness calls only public members: `Configuration` setters and `Validate(true)`,
`LogRoot.Admit`, `new Gateway(config, logDir).Ensure()`, `LauncherFailure` fields,
`Program.Present` and `LauncherLog.Build`. It never calls `Program.Main`, a private member,
reflection or GUI code, takes no launcher mutex and writes no `launcher.log`.

`Gateway.Ensure` runs its real identity and ownership helpers through the compiled
`HelperProcess` private-job path. The disposable fixture repository replaces only
`apps/api/dist/instance-identity.js` (scenario-driven helper bytes, or a byte-for-byte relay of
the actual built ownership producer from the checkout) and `apps/api/dist/main.js` (a gateway main
script that appends a driver-owned marker and exits 54 without listening).

A marker means the actual compiled `Gateway.Ensure` reached its ordinary gateway-start path
(`NativeProcess.Start`). The launcher's own retained handle then reports exit 54 as
`unknown-exit`. This is controlled admission/start-path evidence, never a ready gateway.

## Run

```
export PATH="$HOME/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64:$PATH"
node qa459i-build.mjs --checkout <checkout> --scratch <scratch> --record <build-record.json>
node qa459i-driver.mjs --checkout <checkout> --scratch <scratch> --out <out> \
  --build-record <build-record.json> --label baseline|candidate [--cases Q01,Q02] \
  [--expect-head <sha>] [--expect-tree <sha>]
```

The checkout must be installed and built (`pnpm install`, `pnpm build`). The driver only reads
it. Each run writes `private/runs/<runId>/` (raw originals: response bytes, harness result,
helper events, markers, real producer stdout/stderr) and `public/runs/<runId>/` (path-scrubbed
projections). Existing run folders are never overwritten.

## Cases and judgement

`qa459i-cases.mjs` holds 16 cases with exact response bytes, a baseline prediction derived from
source before observation, and the D166 corrected expectation. Each case reports:

- `status`: `MATCHED-PREDICTION`, `DIFFERED-FROM-PREDICTION` or `SETUP-FAULT`;
- `correctedContract`: `CONFORMS` or `VIOLATES` (the observed revision against the D166 contract).

Controls in every case: closed `LauncherFailure`, no private canary in message, presentation or
bounded log record, store bytes preserved, owner record preserved, nothing written to the log
folder, natural zero helper exits, marker/exit agreement, port free afterward and an unrelated
same-executable sentinel alive. A setup fault stops the run without retry.

## Ports and processes

Ports come only from the independent reservation 25840-25859 after a loopback bind check; an
unavailable port is recorded and skipped, never inspected. The driver retains exact libuv handles
for the harness and the sentinel. A harness watchdog (90 s) and sentinel teardown are driver
actions, recorded separately from the launcher's own helper-job cleanup.

# Sustained-run measurements — 2026-10-18 (#190)

**Result: measured, preliminary round-1 observations.** This work adds measurement
tooling and evidence; it implements no product optimization or behavior change.
The product checkout measured was `4608440c0c4528a998d7974bb16a90b59102a2a2`;
the round-1 harness snapshot is `d5e0478`.

Environment: AMD Ryzen 5 3600, 6 cores / 12 logical CPUs, 68,662,202,368 bytes RAM
(63.95 GiB), Windows build 10.0.26300, Node 22.14.0.
Fresh workloads ran first at 99.6–100% aggregate host CPU load; aged workloads ran
later as load fell to 56.6%. Profiler modes also differed for the first cyclic
invocation. **These are unpaired observations, not comparable fresh/aged trials.**
They establish candidate costs, not an aging penalty/benefit, throughput capacity,
latency SLA or predicted speedup. Official comparisons require the rerun protocol below.

## Reproduction and retained evidence

Set Node 22 first on PATH, then build once:

```powershell
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
pnpm.cmd build
```

[The script README](../../tooling/perf/README.md) documents all workloads and flags.
The portable [summary](2026-10-18-sustained-run-measurements/summary.json) contains
per-case timings, event-loop delay, checkpoint curves, correctness, replay/browser/
readiness summaries and repository-relative CPU locations. Shared dictionaries
identify port methods and CPU frames; row columns are declared in the JSON. Measurement records reference the root cases array; cases reference root browserPages and replays arrays.
Primary port spans are retained individually; other ports are aggregated. Checkpoint
curves retain up to six points and CPU summaries retain the top three frames.

Each invocation directly emits this trimmed `summary.json`, plus an untracked
`raw-summary.json`, invocation metadata, complete SQLite store and artifacts,
memory JSONL, API CPU profile and (for browser workloads) screenshots. Raw evidence
is intentionally outside the versioned tree. Output directories are never deleted.
The summary generator can combine raw invocation records without including local
paths, process command arguments or preflight stdout.

## Rerun protocol

Use one mode, **`--profile=inspector`**, for every run. On a quiet host, run each
fresh/aged pair back to back, with at least two trials: fresh then aged in trial 1,
aged then fresh in trial 2. Keep workload sizes identical within each pair and use
a new output directory for every invocation. Record actual load conditions and
retain individual results rather than pooling the round-1 observations as pairs.

```powershell
foreach ($taskTrial in 1,2) {
  $taskAges = if ($taskTrial -eq 1) { @(0,2000) } else { @(2000,0) }
  foreach ($taskWorkload in @('long','context','replay','artifacts','readiness','browser')) {
    foreach ($taskAge in $taskAges) {
      node tooling/perf/measure.mjs $taskWorkload --aged=$taskAge --profile=inspector --load-conditions="quiet host; trial $taskTrial"
      if ($LASTEXITCODE -ne 0) { throw "Measurement failed" }
    }
  }
}
```

Long/context defaults are 100, 1,000 and 10,000 passes; artifacts default to
100 and 1,000. Readiness has no pass-size parameter. Aging populates 2,000 real
completed trigger-to-exit runs and reports population cost separately. Each command
uses its own file-backed store; sizes within a command accumulate earlier cases.
This represents populated history, not months of fragmentation.

## Attribution method and round-1 limitations

Timed public ports are supplied through RunManager's constructor. Inclusive spans
cover transaction, serialization, mutex wait and yield costs. Wall minus port
spans and checkpoint work is a residual, **not exclusive engine CPU**. Queue
controls submit 16 concurrent SELECT 1 requests; created-to-start time includes
admission/dispatch. Neither isolates pure mutex wait.

API CPU profiles and per-case execution windows locate candidates. Samples are
not elapsed milliseconds or speedup percentages; native symbol names alone do not
prove repeated database opens. Filtered execution sample counts must be positive
and no larger than the profile total. The first cyclic invocation used Node flag
profiling; later ones used after-load Inspector profiling. The existing 10 ms
serialized-client yield policy is unchanged. Initial flag-profiled import controls
stalled while an unprofiled import completed; the native cause remains unproven.

Ten work checkpoints in the raw output measure persisted thread size, getThread
and JSON/UTF-8 byte-count time. The committed summary retains a bounded curve.
Heap/RSS and DB/WAL are sampled at 250 ms with GC before/after each run; fake-harness
request descriptors contribute to process memory. Logical file sizes do not measure
total write traffic. Event encoding probes run after execution in pages of 1,000,
with hashing outside the timed encoding span. Mutation events hold fixed-size
append patches, not the accumulated array. Existing caps remain 10,000 per node,
with a gate maxPasses of N and an initializer outside the growing-context cycle.

**Round-1 inspector readiness is shell-only.** At the recorded 1,773.6 ms fresh
shell time the inspector had about 110 DOM nodes and zero session-storage bytes.
History was first observed at 6,426 ms (22,968 nodes). The aged shell likewise had
112 nodes and zero stored bytes. Loaded-history readiness was not measured in
round 1; its historical summary field is null. Current instrumentation separately
records shellReadyMs and historyReadyMs, waiting for the Timeline item/heading count
to reach the pre-navigation server cursor. CDP, DOM, storage and long tasks are
sampled every 250 ms from initial navigation loading through the observation,
including a final sample. These are operational readiness measures, not Web Vitals TTI.

**Round-1 replay buffering growth with lag was not measurable.** Fetch could
prebuffer the response and API polling could not run inside synchronous replay
reads/writes. Historical heap/write-queue columns below are post-replay samples,
not measurements of peak in-flight buffering. The full-history materialization
finding remains supported by unlimited repository reads and source inspection.
Current replay instrumentation uses a paused raw HTTP socket (64 KiB high-water
mark, initial one-second hold, then the configured pause between reads), enables
the API event-loop monitor for each replay, and compares public socket.bytesWritten
with wire bytes consumed by the client. Outstanding-wire-byte samples include
kernel/client buffers and are asynchronous lower bounds, not pure JS queue size.
SSE framing and payload bytes are counted separately; exact payload hashes verify
full/late/slow/reconnect sequences against the durable log.

Round-1 cold readiness used the harness worker and must not be read as native
entry-point startup. Current cold readiness spawns `apps/api/dist/main.js` on a
free alternate port, with the disposable store and absent provider binaries,
then polls /runs every 100 ms. Startup-to-first-response includes that polling
granularity. The cold main process is unprofiled; Inspector mode profiles the
measurement API worker. Preflight database checks are real; exit 1 is expected
with absent harness binaries and does not establish live-provider readiness.

Historical correctness checks passed for all 20 executions / 443,976 durable
events, plus 12,000 population runs. Initial fresh cyclic/context counts were
also checked after execution: six cases / 155,454 events. This was a correctness
validation, not a performance rerun.

## Round-1 commands and load conditions

| Workload  | Prior runs | Profile        | Host busy | Free RAM before GiB | Exact command                                                               |
| --------- | ---------- | -------------- | --------- | ------------------- | --------------------------------------------------------------------------- |
| long      | 0          | node (initial) | 99.9%     | 32.3                | `node tooling/perf/measure.mjs long --passes=100,1000,10000 --aged=0`       |
| context   | 0          | inspector      | 99.6%     | 33.8                | `node tooling/perf/measure.mjs context --passes=100,1000,10000 --aged=0`    |
| replay    | 0          | inspector      | 100.0%    | 29.2                | `node tooling/perf/measure.mjs replay --passes=1000 --aged=0`               |
| artifacts | 0          | inspector      | 100.0%    | 28.9                | `node tooling/perf/measure.mjs artifacts --passes=100,1000 --aged=0`        |
| readiness | 0          | inspector      | 100.0%    | 29.6                | `node tooling/perf/measure.mjs readiness --aged=0`                          |
| browser   | 0          | inspector      | 100.0%    | 32.4                | `node tooling/perf/measure.mjs browser --passes=1000 --aged=0`              |
| long      | 2000       | inspector      | 99.6%     | 33.7                | `node tooling/perf/measure.mjs long --passes=100,1000,10000 --aged=2000`    |
| context   | 2000       | inspector      | 98.4%     | 31.8                | `node tooling/perf/measure.mjs context --passes=100,1000,10000 --aged=2000` |
| replay    | 2000       | inspector      | 85.0%     | 35.7                | `node tooling/perf/measure.mjs replay --passes=1000 --aged=2000`            |
| artifacts | 2000       | inspector      | 71.4%     | 36.2                | `node tooling/perf/measure.mjs artifacts --passes=100,1000 --aged=2000`     |
| readiness | 2000       | inspector      | 71.1%     | 35.8                | `node tooling/perf/measure.mjs readiness --aged=2000`                       |
| browser   | 2000       | inspector      | 56.6%     | 35.7                | `node tooling/perf/measure.mjs browser --passes=1000 --aged=2000`           |

Output-directory arguments are omitted for portability. Rows are unpaired observations; use the controlled rerun protocol for comparisons.

## Round-1 execution, persistence and resource results

| Workload / prior runs / passes | M items | Item/context bytes | Wall s   | CPU s  | ms/pass | Events | Append s | Append mean/p95 upper ms | Snapshot writes s | Residual s | Sampled heap/RSS MiB | Store growth MiB | Loop delay mean ms | Loop delay p99 ms | Loop delay max ms | Checks |
| ------------------------------ | ------- | ------------------ | -------- | ------ | ------- | ------ | -------- | ------------------------ | ----------------- | ---------- | -------------------- | ---------------- | ------------------ | ----------------- | ----------------- | ------ |
| long / 0 / 100                 | 2       | 120/n/a            | 12.10    | 3.98   | 121.01  | 908    | 4.55     | 5.65 / 24.41             | 0.31              | 1.67       | 52.3 / 144.9         | 4.1              | 25.74              | 102.43            | 1,089.47          | pass   |
| long / 0 / 1000                | 2       | 120/n/a            | 143.37   | 33.91  | 143.37  | 9008   | 68.67    | 8.58 / 43.25             | 4.30              | 16.36      | 69.9 / 167.2         | 3.5              | 31.16              | 166.20            | 4,366.27          | pass   |
| long / 0 / 10000               | 2       | 120/n/a            | 3,245.21 | 394.73 | 324.52  | 90008  | 1,182.73 | 14.78 / 76.62            | 66.95             | 1,331.76   | 228.3 / 356.3        | 42.3             | 60.84              | 467.40            | 40,869.30         | pass   |
| context / 0 / 100              | n/a     | n/a/128            | 9.43     | 2.77   | 94.32   | 510    | 5.24     | 12.87 / 47.57            | 0.65              | 1.46       | 50.6 / 142.0         | 4.0              | 29.83              | 111.74            | 158.47            | pass   |
| context / 0 / 1000             | n/a     | n/a/128            | 109.07   | 24.70  | 109.07  | 5010   | 59.97    | 14.97 / 63.32            | 6.10              | 18.09      | 64.6 / 159.6         | 2.5              | 35.14              | 174.72            | 2,056.26          | pass   |
| context / 0 / 10000            | n/a     | n/a/128            | 1,914.52 | 685.06 | 191.45  | 50010  | 500.14   | 12.50 / 47.57            | 455.81            | 315.29     | 125.9 / 271.0        | 25.2             | 32.69              | 247.86            | 12,834.57         | pass   |
| replay / 0 / 1000              | 32      | 256/n/a            | 104.57   | 69.39  | 104.57  | 39008  | 71.56    | 1.88 / 2.48              | 2.26              | 9.11       | 156.8 / 259.3        | 21.8             | 13.49              | 24.31             | 4,731.17          | pass   |
| artifacts / 0 / 100            | 8       | 4096/n/a           | 8.10     | 5.16   | 81.04   | 1508   | 3.71     | 2.64 / 3.99              | 0.36              | 0.85       | 58.2 / 148.2         | 10.0             | 16.07              | 59.47             | 180.36            | pass   |
| artifacts / 0 / 1000           | 8       | 4096/n/a           | 83.29    | 55.08  | 83.29   | 15008  | 28.43    | 2.03 / 2.48              | 5.41              | 9.09       | 171.0 / 302.3        | 64.3             | 18.02              | 26.57             | 12,960.40         | pass   |
| browser / 0 / 1000             | 2       | 120/512            | 130.50   | 60.69  | 130.50  | 11010  | 24.55    | 2.45 / 4.39              | 13.43             | 52.99      | 88.5 / 190.1         | 11.2             | 15.80              | 33.75             | 3,621.78          | pass   |
| long / 2000 / 100              | 2       | 120/n/a            | 4.26     | 3.61   | 42.61   | 908    | 1.54     | 1.91 / 2.73              | 0.33              | 0.68       | 54.7 / 179.2         | 0.3              | 15.31              | 25.46             | 118.16            | pass   |
| long / 2000 / 1000             | 2       | 120/n/a            | 39.83    | 29.62  | 39.83   | 9008   | 15.27    | 1.91 / 2.48              | 2.29              | 6.62       | 71.2 / 179.6         | 3.5              | 14.78              | 24.66             | 406.06            | pass   |
| long / 2000 / 10000            | 2       | 120/n/a            | 570.28   | 337.44 | 57.03   | 90008  | 204.49   | 2.56 / 3.30              | 33.25             | 135.25     | 204.8 / 334.8        | 42.2             | 17.91              | 74.06             | 12,171.87         | pass   |
| context / 2000 / 100           | n/a     | n/a/128            | 2.69     | 2.16   | 26.88   | 510    | 0.77     | 1.90 / 2.48              | 0.25              | 0.55       | 53.4 / 160.8         | 0.3              | 13.03              | 19.71             | 45.94             | pass   |
| context / 2000 / 1000          | n/a     | n/a/128            | 30.74    | 20.30  | 30.74   | 5010   | 7.72     | 1.93 / 2.48              | 3.20              | 5.51       | 63.0 / 169.0         | 2.5              | 15.13              | 22.22             | 2,797.60          | pass   |
| context / 2000 / 10000         | n/a     | n/a/128            | 745.64   | 609.34 | 74.56   | 50010  | 121.88   | 3.05 / 5.31              | 199.66            | 109.17     | 157.1 / 283.7        | 25.2             | 18.42              | 61.01             | 2,669.67          | pass   |
| replay / 2000 / 1000           | 32      | 256/n/a            | 93.20    | 66.66  | 93.20   | 39008  | 67.20    | 1.77 / 2.25              | 2.25              | 8.02       | 134.5 / 242.2        | 18.0             | 12.72              | 22.25             | 1,198.52          | pass   |
| artifacts / 2000 / 100         | 8       | 4096/n/a           | 4.81     | 4.26   | 48.06   | 1508   | 2.29     | 1.63 / 2.25              | 0.24              | 0.57       | 58.0 / 177.7         | 6.3              | 13.22              | 22.53             | 69.21             | pass   |
| artifacts / 2000 / 1000        | 8       | 4096/n/a           | 57.63    | 47.78  | 57.63   | 15008  | 23.89    | 1.71 / 2.25              | 4.69              | 8.23       | 137.5 / 241.9        | 64.2             | 14.97              | 25.23             | 462.68            | pass   |
| browser / 2000 / 1000          | 2       | 120/512            | 98.02    | 43.48  | 98.02   | 11010  | 15.69    | 1.57 / 2.25              | 8.88              | 51.32      | 77.1 / 196.4         | 7.4              | 12.77              | 23.71             | 268.17            | pass   |

Spans are inclusive; residual is not exclusive engine CPU. Peak memory is sampled,
including fake harness/profiler overhead. Store growth includes WAL and artifacts.
Histogram percentiles are upper bucket bounds (within 10% above 1 us).
The fake streams items back to back, without provider pacing.

## Round-1 sqlite and heap growth

| Workload / prior runs / passes | DB start/end MiB | WAL start/end/peak MiB | Heap after pre-GC / peak / after post-GC MiB | Sampling points |
| ------------------------------ | ---------------- | ---------------------- | -------------------------------------------- | --------------- |
| long / 0 / 100                 | 0.0 / 0.6        | 0.4 / 3.9 / 3.9        | 35.1 / 52.3 / 37.0                           | 44              |
| long / 0 / 1000                | 0.6 / 4.0        | 3.9 / 3.9 / 3.9        | 37.0 / 69.9 / 37.9                           | 493             |
| long / 0 / 10000               | 4.0 / 46.3       | 3.9 / 4.0 / 4.0        | 37.5 / 228.3 / 41.4                          | 9458            |
| context / 0 / 100              | 0.0 / 0.4        | 0.4 / 3.9 / 3.9        | 35.3 / 50.6 / 36.8                           | 38              |
| context / 0 / 1000             | 0.4 / 2.8        | 3.9 / 4.0 / 4.0        | 36.9 / 64.6 / 38.1                           | 386             |
| context / 0 / 10000            | 2.8 / 26.9       | 4.0 / 5.2 / 5.2        | 37.9 / 125.9 / 38.4                          | 6128            |
| replay / 0 / 1000              | 0.0 / 18.2       | 0.4 / 4.0 / 4.0        | 35.4 / 156.8 / 38.4                          | 391             |
| artifacts / 0 / 100            | 0.0 / 3.2        | 0.4 / 3.9 / 3.9        | 34.4 / 58.2 / 36.5                           | 34              |
| artifacts / 0 / 1000           | 3.2 / 35.7       | 3.9 / 4.1 / 4.1        | 36.5 / 171.0 / 38.0                          | 279             |
| browser / 0 / 1000             | 0.0 / 7.2        | 0.4 / 4.4 / 4.4        | 35.4 / 88.5 / 37.7                           | 496             |
| long / 2000 / 100              | 8.4 / 8.8        | 4.0 / 4.0 / 4.0        | 39.0 / 54.7 / 39.2                           | 19              |
| long / 2000 / 1000             | 8.8 / 12.3       | 4.0 / 4.0 / 4.0        | 38.8 / 71.2 / 39.1                           | 157             |
| long / 2000 / 10000            | 12.3 / 54.5      | 4.0 / 4.0 / 4.0        | 38.5 / 204.8 / 40.0                          | 2112            |
| context / 2000 / 100           | 8.4 / 8.7        | 4.0 / 4.0 / 4.0        | 38.1 / 53.4 / 38.0                           | 13              |
| context / 2000 / 1000          | 8.7 / 11.1       | 4.0 / 4.0 / 4.0        | 37.7 / 63.0 / 37.1                           | 112             |
| context / 2000 / 10000         | 11.1 / 35.2      | 4.0 / 5.2 / 5.2        | 36.6 / 157.1 / 38.2                          | 2834            |
| replay / 2000 / 1000           | 8.4 / 26.5       | 4.0 / 4.0 / 4.0        | 39.0 / 134.5 / 37.7                          | 363             |
| artifacts / 2000 / 100         | 8.4 / 11.6       | 4.0 / 4.0 / 4.0        | 38.9 / 58.0 / 38.6                           | 21              |
| artifacts / 2000 / 1000        | 11.6 / 44.0      | 4.0 / 4.1 / 4.1        | 38.2 / 137.5 / 37.8                          | 227             |
| browser / 2000 / 1000          | 8.4 / 15.4       | 4.0 / 4.4 / 4.4        | 39.0 / 77.1 / 40.1                           | 389             |

DB and WAL are reported separately from artifact growth. GC is before and after each case; post-GC heap is a whole-process figure and includes retained fake-harness request descriptors, not an isolated retained-engine measurement. The summary keeps a bounded checkpoint heap curve; raw output retains the complete 250 ms trace.

## Round-1 growing-context measurements

| Prior runs / passes | History items/bytes per item | First/last sampled snapshot KiB | First/last getThread ms | Last snapshot JSON/bytes ms | All-event JSON/bytes ms | HTTP thread bytes/ms |
| ------------------- | ---------------------------- | ------------------------------- | ----------------------- | --------------------------- | ----------------------- | -------------------- |
| 0 / 100             | 100 / 128                    | 2.7 / 14.2                      | 0.64 / 0.68             | 0.06                        | 19.98                   | 14606 / 85.99        |
| 0 / 1000            | 1000 / 128                   | 14.2 / 129.4                    | 0.55 / 1.06             | 0.34                        | 298.28                  | 132519 / 114.67      |
| 0 / 10000           | 10000 / 128                  | 129.4 / 1,280.7                 | 0.98 / 6.64             | 3.51                        | 4,410.55                | 1311528 / 359.93     |
| 2000 / 100          | 100 / 128                    | 2.7 / 14.2                      | 0.57 / 0.46             | 0.06                        | 5.38                    | 14606 / 82.15        |
| 2000 / 1000         | 1000 / 128                   | 14.2 / 129.4                    | 0.41 / 0.77             | 0.31                        | 20.17                   | 132517 / 9.26        |
| 2000 / 10000        | 10000 / 128                  | 129.4 / 1,280.7                 | 0.66 / 4.38             | 3.05                        | 209.64                  | 1311528 / 36.02      |

The first snapshot is sampled at one tenth of the configured work visits, not at an empty thread. The last work snapshot precedes the final gate/exit. Raw output retains full ten-point curves; the portable summary retains bounded checkpoint curves and primary port spans.

Mutation events contain a fixed-size append patch, not the full accumulated array. All-event stringify therefore scales with event count here; snapshot stringify and getThread probes measure growing-context cost separately.

## Round-1 artifact growth

| Prior runs | Passes | Items - bytes | New transcript files | New MiB | Put calls | Mean ms | p95 upper ms | Total put ms |
| ---------- | ------ | ------------- | -------------------- | ------- | --------- | ------- | ------------ | ------------ |
| 0          | 100    | 8 - 4096      | 100                  | 3.2     | 100       | 10.12   | 24.41        | 1,011.82     |
| 0          | 1000   | 8 - 4096      | 1000                 | 31.7    | 1000      | 6.13    | 18.34        | 6,127.10     |
| 2000       | 100    | 8 - 4096      | 100                  | 3.2     | 100       | 2.09    | 3.99         | 208.96       |
| 2000       | 1000   | 8 - 4096      | 1000                 | 31.7    | 1000      | 2.34    | 4.39         | 2,336.14     |

Transcript IDs vary per turn, preventing content-addressed deduplication from hiding directory growth. Put spans include hashing/access/write; JSON construction before the call is outside the put span.

## Round-1 aged-store population and queue controls

| Workload  | Completed runs | Populate s | Admission mean/p95 upper ms | Created-to-start mean/p95 upper/max ms | Store MiB |
| --------- | -------------- | ---------- | --------------------------- | -------------------------------------- | --------- |
| long      | 2000           | 84.2       | 15.16 / 24.41               | 741.86 / 1,336.96 / 1,688.00           | 12.4      |
| context   | 2000           | 83.7       | 16.71 / 24.41               | 724.16 / 1,215.42 / 2,936.00           | 12.4      |
| replay    | 2000           | 99.8       | 18.56 / 43.25               | 885.58 / 2,153.18 / 5,878.00           | 12.4      |
| artifacts | 2000           | 64.4       | 11.97 / 22.19               | 552.73 / 1,004.48 / 1,143.00           | 12.4      |
| readiness | 2000           | 102.4      | 19.07 / 52.33               | 905.51 / 3,152.47 / 7,505.00           | 12.4      |
| browser   | 2000           | 63.4       | 11.73 / 20.18               | 545.25 / 1,004.48 / 1,202.00           | 12.4      |

| Workload / prior runs / passes | Idle SQL burst wall/mean/max ms | Admission-phase SQL burst wall/mean/max ms | Run created-to-start ms |
| ------------------------------ | ------------------------------- | ------------------------------------------ | ----------------------- |
| long / 0 / 100                 | 16.25 / 13.77 / 16.01           | 27.82 / 21.80 / 23.64                      | -                       |
| long / 0 / 1000                | 16.25 / 13.77 / 16.01           | 66.26 / 21.31 / 66.20                      | -                       |
| long / 0 / 10000               | 16.25 / 13.77 / 16.01           | 3.39 / 3.00 / 3.34                         | -                       |
| context / 0 / 100              | 9.26 / 7.03 / 9.15              | 36.28 / 30.66 / 36.05                      | 254.00                  |
| context / 0 / 1000             | 9.26 / 7.03 / 9.15              | 1.61 / 1.14 / 1.56                         | 71.00                   |
| context / 0 / 10000            | 9.26 / 7.03 / 9.15              | 39.78 / 35.43 / 39.69                      | 410.00                  |
| replay / 0 / 1000              | 1.63 / 1.00 / 1.49              | 0.90 / 0.51 / 0.84                         | 25.00                   |
| artifacts / 0 / 100            | 4.82 / 1.70 / 3.56              | 1.15 / 0.61 / 1.09                         | 39.00                   |
| artifacts / 0 / 1000           | 4.82 / 1.70 / 3.56              | 0.93 / 0.51 / 0.89                         | 10.00                   |
| browser / 0 / 1000             | 2.03 / 1.03 / 1.90              | 0.97 / 0.57 / 0.90                         | 116.00                  |
| long / 2000 / 100              | 1.07 / 0.60 / 0.97              | 0.84 / 0.46 / 0.79                         | 15.00                   |
| long / 2000 / 1000             | 1.07 / 0.60 / 0.97              | 4.54 / 4.13 / 4.49                         | 9.00                    |
| long / 2000 / 10000            | 1.07 / 0.60 / 0.97              | 3.65 / 3.16 / 3.59                         | 121.00                  |
| context / 2000 / 100           | 1.20 / 0.63 / 1.05              | 0.91 / 0.49 / 0.86                         | 10.00                   |
| context / 2000 / 1000          | 1.20 / 0.63 / 1.05              | 1.00 / 0.57 / 0.95                         | 10.00                   |
| context / 2000 / 10000         | 1.20 / 0.63 / 1.05              | 3.74 / 3.20 / 3.64                         | 11.00                   |
| replay / 2000 / 1000           | 1.09 / 0.61 / 0.98              | 1.14 / 0.63 / 1.08                         | 10.00                   |
| artifacts / 2000 / 100         | 0.64 / 0.36 / 0.57              | 0.59 / 0.32 / 0.55                         | 8.00                    |
| artifacts / 2000 / 1000        | 0.64 / 0.36 / 0.57              | 0.54 / 0.30 / 0.52                         | 7.00                    |
| browser / 2000 / 1000          | 0.93 / 0.56 / 0.83              | 1.02 / 0.59 / 0.96                         | 7.00                    |

Each SQL burst is 16 concurrent SELECT 1 requests. Population uses one slot and batches of 50 admissions. Created-to-start includes durable admission and dispatch; SQL spans combine native work, mutex wait and yielding. These controls do not isolate a pure lock-wait duration or establish a steady-state queue bound.

## Round-1 finished-run SSE replay

| Prior runs | Replay      | After cursor | Pause ms | Reads | SSE body MiB | Events | First ms | Total ms  | Repository read ms | Post-replay heap samples MiB | Post-replay RSS/external samples MiB | Post-replay queued-write samples MiB | Gaps | Payload hash |
| ---------- | ----------- | ------------ | -------- | ----- | ------------ | ------ | -------- | --------- | ------------------ | ---------------------------- | ------------------------------------ | ------------------------------------ | ---- | ------------ |
| 0          | first       | 0            | 0        | 1163  | 17.9         | 39008  | 5,221.53 | 9,128.14  | 4,938.47           | 38.2 / 149.2                 | 263.4 / 2.8                          | 0.0                                  | 0    | pass         |
| 0          | late        | 35107        | 0        | 117   | 1.8          | 3901   | 581.35   | 701.11    | 527.37             | 38.3 / 52.1                  | 258.0 / 2.8                          | 0.0                                  | 0    | pass         |
| 0          | slow        | 0            | 50       | 1091  | 17.9         | 39008  | 6,685.25 | 79,972.38 | 4,762.41           | 38.3 / 142.5                 | 264.3 / 3.0                          | 0.0                                  | 0    | pass         |
| 0          | interrupted | 0            | 0        | 387   | 6.0          | 13031  | 3,554.97 | 4,921.39  | 3,230.19           | 37.6 / 114.1                 | 219.2 / 2.8                          | 0.0                                  | 0    | prefix       |
| 0          | reconnected | 13031        | 0        | 775   | 11.9         | 25977  | 1,570.96 | 4,559.89  | 1,380.36           | 36.1 / 107.5                 | 217.8 / 2.8                          | 0.0                                  | 0    | pass         |
| 2000       | first       | 0            | 0        | 1163  | 17.9         | 39008  | 1,322.26 | 1,714.88  | 1,086.86           | 37.3 / 144.1                 | 252.4 / 2.9                          | 0.0                                  | 0    | pass         |
| 2000       | late        | 35107        | 0        | 117   | 1.8          | 3901   | 132.78   | 173.36    | 100.34             | 37.2 / 51.4                  | 245.1 / 2.8                          | 0.0                                  | 0    | pass         |
| 2000       | slow        | 0            | 50       | 1091  | 17.9         | 39008  | 1,284.26 | 69,729.46 | 974.98             | 37.2 / 114.1                 | 249.1 / 3.0                          | 0.0                                  | 0    | pass         |
| 2000       | interrupted | 0            | 0        | 387   | 6.0          | 13031  | 1,018.85 | 1,116.40  | 826.51             | 37.3 / 119.2                 | 226.3 / 2.8                          | 0.0                                  | 0    | prefix       |
| 2000       | reconnected | 13031        | 0        | 775   | 11.9         | 25977  | 625.70   | 820.66    | 489.43             | 37.4 / 106.8                 | 227.0 / 2.8                          | 0.0                                  | 0    | pass         |

First-event time for the slow reader includes its deliberate initial pause. The reconnect suffix hash is cumulative with the interrupted prefix; late replay uses its stored suffix hash. Temporary server memory is measured in the API process, separately from the reader; native/kernel socket buffers are excluded.

These samples cannot establish buffering growth with lag. Round 2 uses the raw socket and replay event-loop instrumentation described above.

## Round-1 readiness (historical harness-worker cold start)

| Prior runs | Preflight ms/exit | Harness-worker cold first response ms | Harness-worker first GET ms | Warm boot/first GET ms |
| ---------- | ----------------- | ------------------------------------- | --------------------------- | ---------------------- |
| 0          | 9,945.19 / 1      | 6,153.23                              | 65.04                       | 214.62 / 21.90         |
| 2000       | 2,833.50 / 1      | 3,588.13                              | 101.34                      | 114.89 / 44.97         |

Preflight database checks pass; CLI exit 1 is expected because the harness executable paths are deliberately absent. These timings do not establish live-provider readiness.

## Round-1 Edge browser (shell readiness only)

Edge 155.0.4283.62, headless msedge. historyReadyMs was not measured.

| Prior runs | Page         | Shell-ready ms | Long tasks | Long-task sum ms | Max task ms | Peak JS heap MiB | Peak DOM nodes | Session storage MiB | Execution during observation | Page errors |
| ---------- | ------------ | -------------- | ---------- | ---------------- | ----------- | ---------------- | -------------- | ------------------- | ---------------------------- | ----------- |
| 0          | events-empty | 686.95         | 1          | 188.00           | 188.00      | 8.1              | 54             | 0.0                 | running - running; -seq 157  | 0           |
| 0          | inspector    | 1,773.62       | 4          | 795.00           | 340.00      | 17.4             | 22968          | 2.9                 | running - running; -seq 319  | 0           |
| 0          | events       | 1,381.63       | 2          | 301.00           | 188.00      | 11.7             | 716            | 0.0                 | running - running; -seq 547  | 0           |
| 2000       | events-empty | 452.23         | 1          | 139.00           | 139.00      | 8.2              | 54             | 0.0                 | running - running; -seq 176  | 0           |
| 2000       | inspector    | 509.23         | 7          | 521.00           | 128.00      | 111.6            | 22120          | 2.8                 | running - running; -seq 625  | 0           |
| 2000       | events       | 552.67         | 1          | 125.00           | 125.00      | 11.8             | 716            | 0.0                 | running - running; -seq 672  | 0           |

| Prior runs | Page         | First/last sample since navigation ms | Script ms | Task ms  | Layout ms | Style recalculation ms |
| ---------- | ------------ | ------------------------------------- | --------- | -------- | --------- | ---------------------- |
| 0          | events-empty | 692.17 / 692.17                       | 230.88    | 292.44   | 7.53      | 4.14                   |
| 0          | inspector    | 1,777.96 / 6,426.41                   | 738.82    | 1,632.42 | 324.75    | 102.36                 |
| 0          | events       | 1,385.49 / 5,424.03                   | 256.05    | 700.38   | 240.28    | 10.60                  |
| 2000       | events-empty | 455.64 / 455.64                       | 168.78    | 221.64   | 5.09      | 4.33                   |
| 2000       | inspector    | 518.54 / 4,615.40                     | 1,748.35  | 3,136.27 | 583.39    | 84.06                  |
| 2000       | events       | 555.20 / 4,597.42                     | 161.41    | 450.92   | 155.40    | 7.28                   |

Long-task/CDP totals run through the last sample, not the final screenshot. Fresh loaded-history heap has only one observed sample. The aged inspector shows a rising heap curve after history arrives.

## Ranked bounded candidates for #268

| Rank | Measured evidence                                                                                                                                                                                         | Cause and source                                                                                                                                                                                                                         | Bounded intervention / expected effect                                                                                                                                                                                    | Verification                                                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Maximum loop delay: fresh long/10k 40,869 ms; aged 12,172 ms; fresh context/10k 12,835 ms; fresh replay workload 4,731 ms. These closely match the longest events.read span.                              | Finalisation calls events.read(runId) without a limit: packages/engine/src/run-manager.ts:1615. packages/infrastructure/src/sqlite/events.ts:122-140 materializes all rows; toEvent parses JSON and schema-validates each synchronously. | Read only the terminal event, required exit/return inputs and prior return-delivery evidence, or page the read with yields. Preserve the complete stored log. Expected: reduce the single history-sized event-loop stall. | Compare loop-delay max plus read spans at 100/1k/10k; identical exit results, return delivery, recovery and durable event sequences.                      |
| 2    | Fresh context/10k metadata get/update spans total 628.596 s; snapshots 455.808 s. Final sampled snapshot 1,311,486 bytes.                                                                                 | Full run rows are selected/returned and their unused thread JSON decoded: packages/infrastructure/src/sqlite/runs.ts:104,116,128.                                                                                                        | Use thin metadata projections, preserving explicit thread/checkpoint reads and full stored snapshots. Expected: less copying/JSON decoding; required snapshot writes remain.                                              | Same context curves and CPU profiles; unchanged counters, thread values, event payloads and recovery.                                                     |
| 3    | Fresh long/10k API CPU 394.734 s. The full three-size V8 profile has 84,645/85,617 optimized execute self hits at the fresh-visit guard.                                                                  | packages/engine/src/run-manager.ts:1328 calls countEntries (:242), scanning accumulated events per fresh entry. attemptFor (:231) is a distinct reverse scan.                                                                            | Rebuild per-node fresh-entry counts once from persisted history, updating after committed fresh starts. Expected: avoid repeated full-history visit counting; no RunManager rewrite.                                      | CPU/pass curves, resume/wake, retries, failed append and exact visit-cap boundaries; identical event/counter semantics.                                   |
| 4    | Stream-heavy fixture: 38,005 append calls, 71.560 s inclusive append time / 104.568 s wall; 217.490 ms post-run JSON/byte counting. This share is workload-shaped by the fake harness back-to-back burst. | Transaction and sequence lookup per append: packages/infrastructure/src/sqlite/events.ts:59-101; execute append boundary: packages/engine/src/run-manager.ts:1206.                                                                       | Investigate bounded progress batching only after isolating transaction cost. Preserve every event, order and commit-before-publish. No general provider latency conclusion follows from the burst.                        | Repeat burst and paced streams; compare append cost and first-event response, with exact payload hashes, terminal ordering, return delivery and recovery. |

Other unlimited RunManager log reads carry the same history-sized parsing cost
on resume, cancel and recovery: `run-manager.ts:1181`, `:678`, `:704-707`, `:1008`
and `:1018`. Their path-specific costs need verification; finalisation is the
measured stall above. No yield-policy removal, artifact redesign or preflight
optimization is admitted by these observations.

## Inputs for #186: buffering and history browsing

| Rank | Evidence and source                                                                                                                                                                                                                                                                                    | Bounded follow-on / verification                                                                                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Full replay materializes 39,008 events in one repository call (fresh 4,938 ms), before first event at 5,222 ms. Late suffix first event: 581 ms. apps/api/src/sse.ts:53 omits the limit accepted by sqlite/events.ts:122.                                                                              | Page replay and bound the live handoff, preserving the complete SQLite log. Sweep history bytes/counts; verify time to first event, delay max, memory and exact cursor/payload/terminal delivery.                          |
| 2    | Paused reader took 79,972 ms versus 9,128 ms, but round-1 Fetch/IPC observations do not measure buffering growth. sse.ts:82,99-101 ignores res.write return values; live events buffer at :36-39.                                                                                                      | Bound writes/live queues and honor backpressure. Use paused raw socket consumption and outstanding wire bytes; distinguish JS queue, kernel/client buffering and post-replay memory.                                       |
| 3    | Fresh inspector: one loaded-history CDP heap sample, 17.4 MiB (18.2 MB decimal / 18,203,784 bytes). Aged CDP heap grows 39.1 to 111.6 MiB from 1.532 to 4.615 s (3.083 s). apps/web/src/runs/event-store.ts:59 copies the per-run array and :73-80 persists JSON; MAX_RUNS does not bound one history. | Bound retained history/cache and implement history browsing/windowed Timeline rows here (#186). Verify older-event selection, reload/quota/reconnect and heap/storage/DOM curves. Stored server evidence remains complete. |

## Inputs for #259: rendering cost

| Rank | Evidence and qualification                                                                                                                                                                                                                                                                                                                                           | Follow-on / verification                                                                                                                                                                                                                                                     |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | The historical 1,773.6 ms inspector value measures the shell, not loaded history; it is not valid loaded-history TTI evidence. Post-load 22,968 nodes and 795 ms cumulative long tasks warrant isolation of main-thread work. apps/web/src/runs/RunInspectorPage.tsx:66-78 scans events; apps/web/src/runs/inspector/ThreadViewer.tsx:57-63 reconstructs the thread. | Profile after historyReadyMs; bound repeated projection/reconstruction work. Timeline row windowing belongs to #186. Compare shell/history readiness, scripting/layout/tasks and continued execution with equivalent loaded histories; separate cache cost from render cost. |
| 2    | Events: 50 nested 32 KiB values; shell-ready 1,381.6 ms versus empty 687.0 ms. CDP layout 240.3 versus 7.5 ms. apps/web/src/events/EventsPage.tsx:128,163 eagerly renders/pretty-prints payloads; shared load prevents exclusive formatting attribution.                                                                                                             | Evaluate lazy payload detail formatting and bounded visible rendering after controlled byte/count sweeps. Verify opening details, accessibility, task/layout cost and continued execution.                                                                                   |

## Correctness observation for #255

An observed array append at `/vars/history/-` displayed `(absent)` on both sides
while the Variables pane and durable checks showed the growing array. Keep this
as a display observation for **#255**, not a storage-loss finding and not #259.
Sources: `apps/web/src/runs/inspector/ThreadViewer.tsx:28-31,62` and
`apps/web/src/runs/projections.ts:97-107` (reads the literal append pointer on both sides).
No product fix is included.

## Review-fix smoke verification ? 2026-10-19

Only the changed workloads were rerun, on fresh disposable stores with Inspector
profiling. No 10,000-pass workload or official paired rerun was executed. Portable
commands below omit their local output-directory arguments. The compact summary
includes these three smoke records separately from the round-1 observations.

| Command                                                                  | Key result                                                                                                                                                                                           |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node tooling/perf/measure.mjs replay --passes=100 --profile=inspector`  | 3,908 stored events; full/late/slow/reconnect payload checks pass. Full first event 410.140 ms, total 468.785 ms.                                                                                    |
| `node tooling/perf/measure.mjs browser --passes=100 --profile=inspector` | Inspector shellReadyMs 678.386; historyReadyMs 761.890; Timeline 457 items >= pre-navigation cursor 440. 22 quarter-second/final samples. Both observed pages advance while running, no page errors. |
| `node tooling/perf/measure.mjs readiness --profile=inspector`            | Native `apps/api/dist/main.js` reaches first response in 6717.303 ms; successful GET 24.942 ms. Poll interval 100 ms. Preflight 6983.173 ms, expected exit 1, database ready.                        |

| Replay            | Event-loop mean/p99/max ms | Socket bytes handed / wire bytes consumed | Sampled max bytes in flight |
| ----------------- | -------------------------- | ----------------------------------------- | --------------------------- |
| full              | 50.962 / 364.380 / 364.380 | 1,894,238 / 1,894,238                     | 0                           |
| paused raw socket | 11.891 / 20.414 / 140.247  | 1,894,238 / 1,894,238                     | 1,894,238                   |

The paused replay completed in 2749.469 ms. Outstanding wire bytes show
consumer lag, including kernel/client buffering; they do not isolate JS queue size.
Native cleanup was checked with Get-Process against 15
owned Node/Edge process IDs obtained from the harness and public CDP SystemInfo:
**zero remained**. The native cold child was terminated and awaited; this is not
a claim about graceful signal handling on Windows.

Validation with Node 22: `pnpm.cmd --filter @graphgoblin/tooling test:coverage`
passed 58/58 tests, including seven observer tests. New tests cover fragmented raw
HTTP decoding, CPU sample bounds and summary redaction/shape. Direct tooling
ESLint, root typecheck (20/20), package lint (11/11), layers, deps and formatting
passed. Dependency cruising retains the existing drizzle.config.ts orphan warning.
Build passed 11/11 before browser verification. The tooling test command emits no
line/branch coverage percentage; thresholds/exclusions are unchanged.

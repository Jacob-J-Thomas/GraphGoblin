# Sustained-run measurements — 2026-10-18 (#190)

**Result: measured.** This bolt adds repeatable measurement tooling and records a
development baseline; it implements no optimization or product behavior change.
Numbers below are preliminary shared-workstation observations. The orchestrator
must rerun the documented commands on a quiet machine for official comparison.

The measured checkout is `4608440c0c4528a998d7974bb16a90b59102a2a2` on
`codex-wp-e1a-sustained-measurements`, with this measurement tooling uncommitted.
Hardware: AMD Ryzen 5 3600, 6 cores / 12 logical CPUs, 68,662,202,368 bytes RAM
(63.95 GiB), Windows build 10.0.26300, Node 22.14.0. The host was shared with other
workers and normal workstation activity. A live one-second CPU sample had zero idle time on all twelve logical CPUs. Short tooling checks and a readiness smoke also overlapped the first long-run invocation; the main workload queue ran sequentially. Formatting/lint checks, durable-log revalidation and corrected fresh-browser driver trials also overlapped aged-store execution. No CPU affinity, power-plan change,
cache flush, provider work, or owner-instance operation was performed. Windows
load averages are always zero and are not evidence of an idle host; each summary
records the actual interval's aggregate CPU busy fraction and free RAM.

## Reproduction and evidence

Set Node 22 first on PATH, then build once:

```powershell
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
pnpm.cmd build
```

The command for each measured invocation appears below. Run it from the repository
root; use a fresh output directory. Remove `--out=...` to let the script allocate
one under system temp. Add `--aged=2000` to reproduce a populated store.
[Tooling instructions](../../tooling/perf/README.md) explain every flag and field.

All stores are file-backed SQLite/WAL, in newly allocated disposable directories.
Aging consists of 2,000 **real completed** trigger-to-exit runs, including durable
admission/events/snapshots/finalization. Population time is measured separately.
This is populated history, not a claim to simulate real-world fragmentation.
Within one command, sizes run in order on the same store, so later cases also
contain the earlier cases' completed history. The aged/fresh difference is 2,000
additional completed runs; neither workload silently erases evidence.

The harness uses the supported API composition and engine ports, with a scripted
fake harness, real repositories/filesystem, one execution slot and free loopback
ports. One gate repeats the work node, with `maxPasses=N` and
`maxNodeVisits=10000` **per node**, following ADR-0036. Growing context uses a
one-time initializer outside the cycle and appends one literal string to
`vars.history` on every work visit. Streaming controls suppress messages and
transcript capture; the artifact workload explicitly enables unique transcripts.

Each output directory retains `invocation.json`, `summary.json`,
`memory.jsonl`, `api.cpuprofile`, and the complete store and artifacts. Browser
outputs also include screenshots and `browser.json`; readiness includes a
separate fresh-process `readiness-cold.cpuprofile`. Raw evidence under `.tmp/`
is intentionally local and ignored by Git. The [companion JSON record](2026-10-18-sustained-run-measurements.json) retains
reviewable summaries; raw stores/profiles are available to the orchestrator in
this worktree. Nothing was pruned or truncated.

## Attribution method and limits

Public port decorators are supplied through `RunManager`'s constructor; they time
repository calls without replacing methods or reading private state. Timings
include actual transaction/serialization/lock/yield cost. Histograms are bounded
in memory; percentile values are bucket upper bounds, within 10% above 1 us.
Measurements remain outside `test:coverage`.

Per-pass wall time includes the intentional between-node timer yields, fake work,
queue scheduling, context validation, persistence and interpreter work. The sum
of awaited port spans is inclusive, not a CPU total. Residual wall time subtracts
those spans and checkpoint observation time; it **does not mean pure engine CPU**,
and admission/execution may overlap. Concurrency counters expose that limitation.
The fake harness retains public request descriptors as well as producing one
scripted turn at a time. Heap/RSS are whole API-process measurements, including
those descriptors, event history, observers and native-library allocations.

Ten work checkpoints measure direct repository `getThread` latency, serialized
snapshot size and JSON serialization time as context grows. These extra reads and
stringification are timed separately from repository spans. Heap/RSS and
DB/WAL file sizes are sampled every 250 ms; explicit GC runs before and after a
case. Artifact put latency includes hashing, deduplication checks and file writes.
Logical file size includes the current WAL; WAL checkpoints may reduce it.

Every stored event is validated/read after execution in pages of 1,000. A separate
JSON-stringify plus UTF-8 byte-count probe reports encoding time and bytes for those pages; SHA-256 hashing is outside that timed span. Snapshot serialization probes likewise include byte counting.
A post-run HTTP thread read, where present, includes API validation/serialization,
network and body consumption; it is not an exclusive serializer timing.

Sixteen concurrent `SELECT 1` requests through the real serialized client form
idle and admission-phase queue probes. They measure lock wait plus native work and
the existing yield policy, not pure mutex wait or sustained queue depth.
The durable created-to-start interval, where present, includes admission and
dispatch and is not an isolated scheduler measurement.

The first cyclic invocation used `--expose-gc --cpu-prof`. Subsequent Windows
invocations use `--expose-gc` and the built-in Inspector V8 CPU profiler, started
after dependencies load, with a 1 ms sample interval. `--profile=node` remains
available to reproduce profiling from process start; the default on Windows is
`--profile=inspector`. The JSON records the selected mode. This is a tooling
workaround, not a product change. Raw profiles cover the complete
process; per-case self-sample summaries restrict timestamps to the execution
window, excluding startup/population and final correctness/serialization probes.
Inspector profiles exclude dependency loading; cold-request wall times still include it. Sample percentages locate candidates and do not establish a predicted speedup.
The existing 10 ms database yield policy remains unchanged.

SSE clients run in a separate parent process. The first cursor is zero, the late
cursor is floor(90% of stored events), the slow reader pauses 50 ms before its
first read and between chunks, and reconnect resumes after an actual received
cursor at or beyond one third of the log. The observer checks SSE id against JSON
seq, ordering, counts, final cursor and SHA-256 payload equality. The reconnect hash covers the combined prefix and suffix; late replay is checked against the corresponding stored suffix. Hash computation is outside the serialization probe timing. API replay read spans are timed through decorated public repositories; lag samples include consumption progress. Memory and public response
`writableLength` are sampled every 25 ms. Sampled peaks are lower bounds and
exclude kernel buffers. Deliberate reader pauses are included in first-event time.

Browser measurements use isolated, headless Microsoft Edge contexts, one per
page, on the actual built web app. The inspector observes a streaming run with a mutation appending 512 bytes per pass and a 50 ms fake completion delay; history warms to one quarter of the configured passes before Edge opens. A one-second empty Events control runs first;
the populated Events page receives 50 stored inbound events with nested 32 KiB values.
The inspector is not the inbound Events page. TTI is a documented proxy: visible
h1 plus an actionable loop link or loaded Events table, followed by two animation
frames. CDP Performance metrics, JS heap, main-thread long tasks, DOM node counts,
session-storage bytes and evaluation round trips are retained. Run records before
and after each page's observation show whether execution continued.
No standardized TTI score, latency SLA or live-provider claim is made.

Preflight executes the real built CLI against the stopped store, including process
startup. Harness executable paths are intentionally absent, so CLI exit 1 is an
expected provider-availability failure; the database check is real. It is not a
measurement of successful provider readiness. Cold first-request timing launches
a fresh fake-backed API process over the populated store, including module import
and startup. The additional warm reopen figure is labeled separately.

CPU sample counts rank self-time locations; they are not elapsed milliseconds or exclusive speedup estimates. Native symbol labels differ between profiler modes (including a libsql database-open label in an aged profile); that label alone does not prove repeated database opens. The source path and repository spans are needed to form each hypothesis. SSE memory probes use nominal 25 ms RPC polling; stalls can delay or cluster observations and their IPC work is part of observer overhead.

## Profiling startup finding (tooling; separate from #268)

The profiler startup path needed an explicit control on this host. A plain import
of the built API completed in **7,615 ms**. The same import launched with
`--cpu-prof` did not finish within a bounded **60,516 ms** control and was
terminated; an earlier workload setup also hit its original two-minute deadline
before admitting any run. Evidence is retained in
`.tmp/profiler-control.log` and `.tmp/perf-hash-smoke/summary.json`.
These observations do not establish the native cause or a general Node defect.

The after-load Inspector control completed, wrote a valid CPU profile, and passed
all 125-event full/late/slow/reconnect payload-hash checks. The final harness has a
separate configurable ten-minute setup allowance and a one-hour IPC workload
ceiling. These are measurement recovery parameters, not execution guardrails or
latency SLAs. No failing product test was retried to green.

The first cyclic invocation predates the post-run HTTP-thread probe, replay read
decorators, live sample export and payload hashes. It measured the same execution
graph and repository calls; those later additions occur outside its execution
window. Its unused startup coordinator remained idle with its normal recovery
poll; later invocations stop that coordinator before installing the decorated one.
The authoritative quiet-machine rerun should use the final scripts consistently.

The initial fresh cyclic/context stores were reopened after their timed trials for
public-repository verification of all node entry/finish counts, attempts, terminal
events, history values and exact durable payload hashes. All six cases / 155,454
events pass. Evidence: `.tmp/initial-validation.json` and
`node --experimental-import-meta-resolve .tmp/revalidate-initial.mjs`; the
companion JSON includes these backfilled checks. No performance number was rerun
or replaced by this validation.

<!-- MEASURED_TABLES -->

## Commands and load conditions

| Workload  | Prior runs | Profile        | Host busy | Free RAM before GiB | Exact command                                                                                                |
| --------- | ---------- | -------------- | --------- | ------------------- | ------------------------------------------------------------------------------------------------------------ |
| long      | 0          | node (initial) | 99.9%     | 32.3                | `node tooling/perf/measure.mjs long --passes=100,1000,10000 --aged=0 --out=.tmp/baseline-long-0`             |
| context   | 0          | inspector      | 99.6%     | 33.8                | `node tooling/perf/measure.mjs context --passes=100,1000,10000 --aged=0 --out=.tmp/baseline-context-0`       |
| replay    | 0          | inspector      | 100.0%    | 29.2                | `node tooling/perf/measure.mjs replay --passes=1000 --aged=0 --out=.tmp/baseline-replay-0`                   |
| artifacts | 0          | inspector      | 100.0%    | 28.9                | `node tooling/perf/measure.mjs artifacts --passes=100,1000 --aged=0 --out=.tmp/baseline-artifacts-0`         |
| readiness | 0          | inspector      | 100.0%    | 29.6                | `node tooling/perf/measure.mjs readiness --passes=1000 --aged=0 --out=.tmp/baseline-readiness-0`             |
| browser   | 0          | inspector      | 100.0%    | 32.4                | `node tooling/perf/measure.mjs browser --passes=1000 --aged=0 --out=.tmp/baseline-browser-0-final`           |
| long      | 2000       | inspector      | 99.6%     | 33.7                | `node tooling/perf/measure.mjs long --passes=100,1000,10000 --aged=2000 --out=.tmp/baseline-long-2000`       |
| context   | 2000       | inspector      | 98.4%     | 31.8                | `node tooling/perf/measure.mjs context --passes=100,1000,10000 --aged=2000 --out=.tmp/baseline-context-2000` |
| replay    | 2000       | inspector      | 85.0%     | 35.7                | `node tooling/perf/measure.mjs replay --passes=1000 --aged=2000 --out=.tmp/baseline-replay-2000`             |
| artifacts | 2000       | inspector      | 71.4%     | 36.2                | `node tooling/perf/measure.mjs artifacts --passes=100,1000 --aged=2000 --out=.tmp/baseline-artifacts-2000`   |
| readiness | 2000       | inspector      | 71.1%     | 35.8                | `node tooling/perf/measure.mjs readiness --passes=1000 --aged=2000 --out=.tmp/baseline-readiness-2000`       |
| browser   | 2000       | inspector      | 56.6%     | 35.7                | `node tooling/perf/measure.mjs browser --passes=1000 --aged=2000 --out=.tmp/baseline-browser-2000`           |

The initial long-run command used the then-hardcoded Node flag profiler. With the final scripts, append `--profile=node` to reproduce that mode. Other Windows commands default to after-load Inspector profiling. There is one trial per size/store combination; within-call percentiles are not cross-trial confidence intervals.

## Execution, persistence and resource results

| Workload / prior runs / passes | M items | Item/context bytes | Wall s  | CPU s | ms/pass | Events | Append total s | Append mean/p95 upper ms | Snapshot writes s | Residual s | Peak heap/RSS MiB | Store growth MiB | Checks |
| ------------------------------ | ------- | ------------------ | ------- | ----- | ------- | ------ | -------------- | ------------------------ | ----------------- | ---------- | ----------------- | ---------------- | ------ |
| long / 0 / 100                 | 2       | 120/?              | 12.1    | 4.0   | 121.01  | 908    | 4.5            | 5.65 / 24.41             | 0.3               | 1.7        | 52.3 / 144.9      | 4.1              | pass   |
| long / 0 / 1000                | 2       | 120/?              | 143.4   | 33.9  | 143.37  | 9008   | 68.7           | 8.58 / 43.25             | 4.3               | 16.4       | 69.9 / 167.2      | 3.5              | pass   |
| long / 0 / 10000               | 2       | 120/?              | 3,245.2 | 394.7 | 324.52  | 90008  | 1,182.7        | 14.78 / 76.62            | 66.9              | 1,331.8    | 228.3 / 356.3     | 42.3             | pass   |
| context / 0 / 100              | -       | ?/128              | 9.4     | 2.8   | 94.32   | 510    | 5.2            | 12.87 / 47.57            | 0.6               | 1.5        | 50.6 / 142.0      | 4.0              | pass   |
| context / 0 / 1000             | -       | ?/128              | 109.1   | 24.7  | 109.07  | 5010   | 60.0           | 14.97 / 63.32            | 6.1               | 18.1       | 64.6 / 159.6      | 2.5              | pass   |
| context / 0 / 10000            | -       | ?/128              | 1,914.5 | 685.1 | 191.45  | 50010  | 500.1          | 12.50 / 47.57            | 455.8             | 315.3      | 125.9 / 271.0     | 25.2             | pass   |
| replay / 0 / 1000              | 32      | 256/?              | 104.6   | 69.4  | 104.57  | 39008  | 71.6           | 1.88 / 2.48              | 2.3               | 9.1        | 156.8 / 259.3     | 21.8             | pass   |
| artifacts / 0 / 100            | 8       | 4096/?             | 8.1     | 5.2   | 81.04   | 1508   | 3.7            | 2.64 / 3.99              | 0.4               | 0.9        | 58.2 / 148.2      | 10.0             | pass   |
| artifacts / 0 / 1000           | 8       | 4096/?             | 83.3    | 55.1  | 83.29   | 15008  | 28.4           | 2.03 / 2.48              | 5.4               | 9.1        | 171.0 / 302.3     | 64.3             | pass   |
| browser / 0 / 1000             | 2       | 120/512            | 130.5   | 60.7  | 130.50  | 11010  | 24.5           | 2.45 / 4.39              | 13.4              | 53.0       | 88.5 / 190.1      | 11.2             | pass   |
| long / 2000 / 100              | 2       | 120/?              | 4.3     | 3.6   | 42.61   | 908    | 1.5            | 1.91 / 2.73              | 0.3               | 0.7        | 54.7 / 179.2      | 0.3              | pass   |
| long / 2000 / 1000             | 2       | 120/?              | 39.8    | 29.6  | 39.83   | 9008   | 15.3           | 1.91 / 2.48              | 2.3               | 6.6        | 71.2 / 179.6      | 3.5              | pass   |
| long / 2000 / 10000            | 2       | 120/?              | 570.3   | 337.4 | 57.03   | 90008  | 204.5          | 2.56 / 3.30              | 33.3              | 135.3      | 204.8 / 334.8     | 42.2             | pass   |
| context / 2000 / 100           | -       | ?/128              | 2.7     | 2.2   | 26.88   | 510    | 0.8            | 1.90 / 2.48              | 0.3               | 0.6        | 53.4 / 161.8      | 0.3              | pass   |
| context / 2000 / 1000          | -       | ?/128              | 30.7    | 20.3  | 30.74   | 5010   | 7.7            | 1.93 / 2.48              | 3.2               | 5.5        | 63.0 / 169.0      | 2.5              | pass   |
| context / 2000 / 10000         | -       | ?/128              | 745.6   | 609.3 | 74.56   | 50010  | 121.9          | 3.05 / 5.31              | 199.7             | 109.2      | 157.1 / 283.7     | 25.2             | pass   |
| replay / 2000 / 1000           | 32      | 256/?              | 93.2    | 66.7  | 93.20   | 39008  | 67.2           | 1.77 / 2.25              | 2.2               | 8.0        | 134.5 / 242.2     | 18.0             | pass   |
| artifacts / 2000 / 100         | 8       | 4096/?             | 4.8     | 4.3   | 48.06   | 1508   | 2.3            | 1.63 / 2.25              | 0.2               | 0.6        | 58.0 / 177.7      | 6.3              | pass   |
| artifacts / 2000 / 1000        | 8       | 4096/?             | 57.6    | 47.8  | 57.63   | 15008  | 23.9           | 1.71 / 2.25              | 4.7               | 8.2        | 137.5 / 241.9     | 64.2             | pass   |
| browser / 2000 / 1000          | 2       | 120/512            | 98.0    | 43.5  | 98.02   | 11010  | 15.7           | 1.57 / 2.25              | 8.9               | 51.3       | 77.1 / 196.4      | 7.4              | pass   |

Wall time includes admission and observation work; browser cases include the UI observation phase. Residual is inclusive wall time minus awaited port spans and checkpoint observation, not exclusive engine CPU. Peak memory is sampled and includes the fake harness and profiler. Store growth is logical data-directory bytes, including WAL and artifacts; WAL checkpointing can make it non-monotonic. Streaming item bytes are not context bytes: growing history is enabled only for context and browser workloads. Browser turns have a 50 ms fake completion delay.

Largest-case repository attribution (inclusive spans; these are not exclusive CPU totals):

| Workload / prior runs / passes | Run get s | Run update s | Thread writes s | Event append s | API user+system CPU s | Port concurrency max |
| ------------------------------ | --------- | ------------ | --------------- | -------------- | --------------------- | -------------------- |
| long / 0 / 10000               | 101.6     | 137.5        | 66.9            | 1,182.7        | 394.7                 | 1                    |
| context / 0 / 10000            | 265.0     | 363.5        | 455.8           | 500.1          | 685.1                 | 1                    |
| long / 2000 / 10000            | 44.1      | 67.8         | 33.3            | 204.5          | 337.4                 | 2                    |
| context / 2000 / 10000         | 122.0     | 189.8        | 199.7           | 121.9          | 609.3                 | 2                    |

## SQLite and heap growth

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

DB and WAL are reported separately from artifact growth. GC is before and after each case; post-GC heap is a whole-process figure and includes retained fake-harness request descriptors, not an isolated retained-engine measurement. Ten checkpoint heap observations form a coarse time curve in the companion JSON; the complete 250 ms trace remains in each raw summary/JSONL.

## Growing-context measurements

| Prior runs / passes | History items/bytes per item | First/last sampled snapshot KiB | First/last getThread ms | Last snapshot JSON/bytes ms | All-event JSON/bytes ms | HTTP thread bytes/ms |
| ------------------- | ---------------------------- | ------------------------------- | ----------------------- | --------------------------- | ----------------------- | -------------------- |
| 0 / 100             | 100 / 128                    | 2.7 / 14.2                      | 0.64 / 0.68             | 0.06                        | 19.98                   | 14606 / 85.99        |
| 0 / 1000            | 1000 / 128                   | 14.2 / 129.4                    | 0.55 / 1.06             | 0.34                        | 298.28                  | 132519 / 114.67      |
| 0 / 10000           | 10000 / 128                  | 129.4 / 1,280.7                 | 0.98 / 6.64             | 3.51                        | 4,410.55                | 1311528 / 359.93     |
| 2000 / 100          | 100 / 128                    | 2.7 / 14.2                      | 0.57 / 0.46             | 0.06                        | 5.38                    | 14606 / 82.15        |
| 2000 / 1000         | 1000 / 128                   | 14.2 / 129.4                    | 0.41 / 0.77             | 0.31                        | 20.17                   | 132517 / 9.26        |
| 2000 / 10000        | 10000 / 128                  | 129.4 / 1,280.7                 | 0.66 / 4.38             | 3.05                        | 209.64                  | 1311528 / 36.02      |

The first snapshot is sampled at one tenth of the configured work visits, not at an empty thread. The last work snapshot precedes the final gate/exit. Full ten-point curves, GC samples, all repository timings and event-loop delay are retained in the companion JSON/raw summaries.

Mutation events contain a fixed-size append patch, not the full accumulated array. All-event stringify therefore scales with event count here; snapshot stringify and getThread probes measure growing-context cost separately.

## Artifact growth

| Prior runs | Passes | Items - bytes | New transcript files | New MiB | Put calls | Mean ms | p95 upper ms | Total put ms |
| ---------- | ------ | ------------- | -------------------- | ------- | --------- | ------- | ------------ | ------------ |
| 0          | 100    | 8 - 4096      | 100                  | 3.2     | 100       | 10.12   | 24.41        | 1,011.82     |
| 0          | 1000   | 8 - 4096      | 1000                 | 31.7    | 1000      | 6.13    | 18.34        | 6,127.10     |
| 2000       | 100    | 8 - 4096      | 100                  | 3.2     | 100       | 2.09    | 3.99         | 208.96       |
| 2000       | 1000   | 8 - 4096      | 1000                 | 31.7    | 1000      | 2.34    | 4.39         | 2,336.14     |

Transcript IDs vary per turn, preventing content-addressed deduplication from hiding directory growth. Put spans include hashing/access/write; JSON construction before the call is outside the put span.

## Aged-store population and queue controls

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

## Finished-run SSE replay

| Prior runs | Replay      | After cursor | Pause ms | Reads | SSE body MiB | Events | First ms | Total ms  | Repository read ms | Heap before/peak MiB | Peak RSS/external MiB | Sampled queued-write MiB | Gaps | Payload hash |
| ---------- | ----------- | ------------ | -------- | ----- | ------------ | ------ | -------- | --------- | ------------------ | -------------------- | --------------------- | ------------------------ | ---- | ------------ |
| 0          | first       | 0            | 0        | 1163  | 17.9         | 39008  | 5,221.53 | 9,128.14  | 4,938.47           | 38.2 / 149.2         | 263.4 / 2.8           | 0.0                      | 0    | pass         |
| 0          | late        | 35107        | 0        | 117   | 1.8          | 3901   | 581.35   | 701.11    | 527.37             | 38.3 / 52.1          | 258.0 / 2.8           | 0.0                      | 0    | pass         |
| 0          | slow        | 0            | 50       | 1091  | 17.9         | 39008  | 6,685.25 | 79,972.38 | 4,762.41           | 38.3 / 142.5         | 264.3 / 3.0           | 0.0                      | 0    | pass         |
| 0          | interrupted | 0            | 0        | 387   | 6.0          | 13031  | 3,554.97 | 4,921.39  | 3,230.19           | 37.6 / 114.1         | 219.2 / 2.8           | 0.0                      | 0    | prefix       |
| 0          | reconnected | 13031        | 0        | 775   | 11.9         | 25977  | 1,570.96 | 4,559.89  | 1,380.36           | 36.1 / 107.5         | 217.8 / 2.8           | 0.0                      | 0    | pass         |
| 2000       | first       | 0            | 0        | 1163  | 17.9         | 39008  | 1,322.26 | 1,714.88  | 1,086.86           | 37.3 / 144.1         | 252.4 / 2.9           | 0.0                      | 0    | pass         |
| 2000       | late        | 35107        | 0        | 117   | 1.8          | 3901   | 132.78   | 173.36    | 100.34             | 37.2 / 51.4          | 245.1 / 2.8           | 0.0                      | 0    | pass         |
| 2000       | slow        | 0            | 50       | 1091  | 17.9         | 39008  | 1,284.26 | 69,729.46 | 974.98             | 37.2 / 114.1         | 249.1 / 3.0           | 0.0                      | 0    | pass         |
| 2000       | interrupted | 0            | 0        | 387   | 6.0          | 13031  | 1,018.85 | 1,116.40  | 826.51             | 37.3 / 119.2         | 226.3 / 2.8           | 0.0                      | 0    | prefix       |
| 2000       | reconnected | 13031        | 0        | 775   | 11.9         | 25977  | 625.70   | 820.66    | 489.43             | 37.4 / 106.8         | 227.0 / 2.8           | 0.0                      | 0    | pass         |

First-event time for the slow reader includes its deliberate initial pause. The reconnect suffix hash is cumulative with the interrupted prefix; late replay uses its stored suffix hash. Temporary server memory is measured in the API process, separately from the reader; native/kernel socket buffers are excluded.

## Readiness

| Prior runs | Preflight ms/exit | Cold process - first response ms | Cold first GET ms | Warm boot/first GET ms |
| ---------- | ----------------- | -------------------------------- | ----------------- | ---------------------- |
| 0          | 9,945.19 / 1      | 6,153.23                         | 65.04             | 214.62 / 21.90         |
| 2000       | 2,833.50 / 1      | 3,588.13                         | 101.34            | 114.89 / 44.97         |

Preflight database checks pass; CLI exit 1 is expected because the harness executable paths are deliberately absent. These timings do not establish live-provider readiness.

## Edge browser

Edge 155.0.4283.62, headless msedge, 0 prior runs.

Edge 155.0.4283.62, headless msedge, 2000 prior runs.

| Prior runs | Page         | TTI proxy ms | Long tasks | Long-task sum ms | Max task ms | Peak JS heap MiB | Peak DOM nodes | Session storage MiB | Execution during observation | Page errors |
| ---------- | ------------ | ------------ | ---------- | ---------------- | ----------- | ---------------- | -------------- | ------------------- | ---------------------------- | ----------- |
| 0          | events-empty | 686.95       | 1          | 188.00           | 188.00      | 8.1              | 54             | 0.0                 | running - running; -seq 157  | 0           |
| 0          | inspector    | 1,773.62     | 4          | 795.00           | 340.00      | 17.4             | 22968          | 2.9                 | running - running; -seq 319  | 0           |
| 0          | events       | 1,381.63     | 2          | 301.00           | 188.00      | 11.7             | 716            | 0.0                 | running - running; -seq 547  | 0           |
| 2000       | events-empty | 452.23       | 1          | 139.00           | 139.00      | 8.2              | 54             | 0.0                 | running - running; -seq 176  | 0           |
| 2000       | inspector    | 509.23       | 7          | 521.00           | 128.00      | 111.6            | 22120          | 2.8                 | running - running; -seq 625  | 0           |
| 2000       | events       | 552.67       | 1          | 125.00           | 125.00      | 11.8             | 716            | 0.0                 | running - running; -seq 672  | 0           |

| Prior runs | Page         | First/last sample since navigation ms | Script ms | Task ms  | Layout ms | Style recalculation ms |
| ---------- | ------------ | ------------------------------------- | --------- | -------- | --------- | ---------------------- |
| 0          | events-empty | 692.17 / 692.17                       | 230.88    | 292.44   | 7.53      | 4.14                   |
| 0          | inspector    | 1,777.96 / 6,426.41                   | 738.82    | 1,632.42 | 324.75    | 102.36                 |
| 0          | events       | 1,385.49 / 5,424.03                   | 256.05    | 700.38   | 240.28    | 10.60                  |
| 2000       | events-empty | 455.64 / 455.64                       | 168.78    | 221.64   | 5.09      | 4.33                   |
| 2000       | inspector    | 518.54 / 4,615.40                     | 1,748.35  | 3,136.27 | 583.39    | 84.06                  |
| 2000       | events       | 555.20 / 4,597.42                     | 161.41    | 450.92   | 155.40    | 7.28                   |

Empty Events is the small-data control. Inspector and populated Events observations nominally last five seconds after the TTI proxy; transport/measurement work can lengthen the interval. Long-task counts and cumulative CDP durations run through the last sampled metric, before the final sleep/screenshot; exact sample times are above. Heap/DOM peaks are sampled lower bounds. Browser cost is measured directly through performance entries/CDP, not by subtracting the wall times of different engine graphs. Screenshots and detailed metrics are in each browser output.

## Measurement completion

All twelve accepted workload/store invocations completed without harness, shutdown, profile or correctness errors (the corrected fresh-browser trial replaces the failed driver trials).

## Evidence-ranked follow-on scope

These are finite candidates, not changes implemented or promised speedups. Rank
reflects the observed cost and a bounded intervention; confirm the order with the
same final scripts on a quiet host before admitting #268. Wall times from different
load/profiler intervals cannot establish an aging penalty or benefit.

**Hot paths for #268**

| Rank / owner | Measured evidence                                                                                                                                                                                                                                                             | Hypothesis and source                                                                                                                                                                                                                                                           | Bounded intervention / expected effect                                                                                                                                                                                                                                          | Verification                                                                                                                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 / #268     | Fresh 10,000-pass context: `runs.get` 265.046 s, `runs.update` 363.550 s, snapshot writes 455.808 s. Final sampled snapshot 1,311,486 bytes. Of 548,972 execution CPU samples, 348,960 are native libsql row iteration; Drizzle JSON decode has 32,640 self samples.          | Metadata reads select the entire run row, including growing snapshot/initial-thread columns: `packages/infrastructure/src/sqlite/runs.ts:104`, `:116`, `:128`. The returned RunRecord discards these thread fields.                                                             | Introduce explicit thin column projections for metadata reads/returning paths. Keep explicit thread/checkpoint reads and full persisted evidence. Expected: less native row copying and redundant JSON decode; required snapshot writes remain.                                 | Repeat both context curves and aged variants; compare repository spans and CPU profiles. Verify identical thread values, run counters, terminal state, event sequence/hash and recovery behavior.                                     |
| 2 / #268     | Fresh 10,000-pass cyclic run: 394.734 s API CPU, 90,008 events. In that command's full raw V8 profile (all three sizes), 84,645 of 85,617 optimized execute-function self hits point to the fresh-visit guard (built JS line 1108); `countEntries` is also a sampled hotspot. | `packages/engine/src/run-manager.ts:1328` calls `countEntries` (`:242`), scanning accumulated history for each fresh entry. `attemptFor` (`:231`) is a different reverse-scan helper; do not conflate them.                                                                     | Maintain per-node fresh-entry counts, reconstructed from persisted history on resume and updated only after committed fresh starts. Expected: avoid repeating whole-history visit counting. No general RunManager rewrite, altered cap, dropped event or retry-semantic change. | Compare fixed-context CPU/pass at 100/1,000/10,000, including aged store. Exercise wake/recovery, failed append, retries and visit-limit boundaries; identical event/counter outcomes are mandatory.                                  |
| 3 / #268     | Fresh stream-heavy run: 38,005 append calls for 39,008 stored events, 71.560 s inclusive append time out of 104.568 s wall; mean 1.883 ms, p95 bucket upper bound 2.479 ms. Post-run JSON encoding/byte counting of all events is 217.490 ms.                                 | Every append uses a transaction and sequence lookup (`packages/infrastructure/src/sqlite/events.ts:59-101`); the execute loop's append boundary is `packages/engine/src/run-manager.ts:1206`. Persistence dominates the isolated stringify probe, but spans include wait/yield. | Investigate bounded append batching at the progress boundary, preserving every event, order and commit-before-publish. First profile transaction/sequence-allocation cost; batching is conditional on that evidence and existing delivery semantics.                            | Rerun stream-heavy, artifact and live/reconnect cases. Compare transaction/call counts, append CPU/time and first-event responsiveness; assert no lost payloads, sequence changes within a run, terminal reordering or recovery gaps. |

**Buffering and history inputs for #186**

| Rank / owner | Measured evidence                                                                                                                                                                        | Hypothesis and source                                                                                                                                                                                                  | Bounded intervention / expected effect                                                                                                                                                                                                                   | Verification                                                                                                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 / #186     | Fresh full replay reads 39,008 events in one repository call (4,938 ms), first event 5,222 ms, server heap sampled at about 149 MiB. Late replay reads 3,901 events, first event 581 ms. | `apps/api/src/sse.ts:53` reads an unlimited suffix before sending headers; `packages/infrastructure/src/sqlite/events.ts:122` accepts an optional limit that this call does not supply.                                | Page replay and bound the replay/live handoff queue while retaining the complete SQLite log. Expected: lower history-dependent first-event and transient heap cost. This is buffering/history ownership, separate from the engine hot-path list.         | Sweep event count and bytes, check first-event/peak heap curves, concurrent append during replay, exact cursor/payload hashes and terminal reconnect.                                           |
| 2 / #186     | Paused fresh replay takes 79,972 ms versus 9,128 ms normally, with all payloads intact. The sampled response write queue maximum is zero in this trial.                                  | `apps/api/src/sse.ts:82,99-101` ignores the return value of `res.write` and can synchronously enqueue a replay; live events buffer during the initial read (`:36-39`). A 25 ms timer can miss synchronous queue peaks. | Bound server write/live queues and honor backpressure in a replay/publish design. The trial establishes lag sensitivity and whole-history materialization; it does **not** measure a proven monotonic lag-to-buffer bound or prove absence of buffering. | Add controlled byte-rate/longer-lag sweeps and write-boundary queue instrumentation in #186. Check RSS/external/heap and queued bytes against lag, disconnect cleanup and exact durable replay. |
| 3 / #186     | Fresh inspector at roughly 4,000 events: 3,032,428 estimated UTF-16 bytes in session storage, 18,203,784 bytes sampled JS heap.                                                          | `apps/web/src/runs/event-store.ts:59` copies the complete per-run event array; `:73-80` persists it as JSON. The 20-run bound does not bound a single run's log.                                                       | Bound the client history/cache with explicit cursor and paged-history semantics, preserving the complete server log. Coordinate with #259; limiting visible DOM alone will not bound retained event data.                                                | Sweep 1k/10k/longer histories, reload/quota/reconnect and older-event selection. Track retained heap, storage bytes and payload completeness separately from DOM size.                          |

**Rendering inputs for #259**

| Rank / owner | Measured evidence                                                                                                                                                                                                                                  | Hypothesis and source                                                                                                                                                                                                | Bounded intervention / expected effect                                                                                                                                                                                                          | Verification                                                                                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 / #259     | Fresh inspector TTI proxy 1,773.621 ms; four long tasks total 795 ms (max 340 ms), 22,968 sampled DOM nodes. Run advances 319 events during observation.                                                                                           | `apps/web/src/runs/inspector/Timeline.tsx:47` renders every event. Inspector selection/filtering (`RunInspectorPage.tsx:66-78`) and `ThreadViewer.tsx:57-63` recompute from the growing event list.                  | Window timeline rows and bound repeated render/replay work with indexed or checkpointed view derivation. Keep complete history accessible and coordinate retained-data ownership with #186. Expected: fewer DOM nodes and less per-update work. | Same warmup, history bytes and Edge observation interval, plus older-event navigation and keyboard access. Compare DOM, long tasks, scripting/layout time, heap and continued server execution independently. |
| 2 / #259     | Populated Events (50 payloads, 32 KiB string each): TTI proxy 1,381.626 ms, two long tasks total 301 ms, 716 DOM nodes. Empty control: 686.950 ms, one 188 ms task, 54 nodes. Cumulative CDP layout is 240.278 ms populated versus 7.532 ms empty. | `apps/web/src/events/EventsPage.tsx:128,163` eagerly renders rows and pretty-prints each payload. The shared host/load difference means this comparison is suggestive, not an exclusive JSON-formatting attribution. | Evaluate lazy payload detail formatting and bounded row rendering after the higher-cost inspector work. Expected: reduce initial formatting/layout for large payload lists.                                                                     | Sweep payload bytes at fixed row count and row count at fixed bytes on a quiet host; measure CPU tasks, layout, DOM, opening payload details and continued run progress.                                      |

No artifact-store redesign or preflight optimization is admitted by these trials.
Artifact puts and readiness costs are measured above; neither alone establishes a
hot path requiring a change. No latency SLA or speedup percentage is invented. The existing serialized-client yield policy remains part of the baseline; residual wall time alone does not justify removing it.
Cross-run comparisons must normalize IDs/timestamps before comparing event
semantics; each run's replay is checked against its own exact durable payload hash.

## Correctness and observations outside scope

Completed execution cases validate contiguous durable sequences, gate/work visit
counts, exact expected streamed-item counts, one terminal event and exact growing
history values. Replay variants additionally validate the exact durable payloads,
including the interrupted prefix plus reconnect suffix. The tables report these
checks explicitly; fake-harness checks establish no live-provider behavior.

One browser screenshot shows an array-append patch at `/vars/history/-` with
`(absent)` on both sides, although the Variables pane and durable checks show the
growing array. This is a **candidate display finding for #259**, not a storage-loss
finding. Evidence: `.tmp/baseline-browser-0-final/browser-inspector.png`;
`apps/web/src/runs/inspector/ThreadViewer.tsx:28-31,62` and
`apps/web/src/runs/projections.ts:97-107` (reads the literal append pointer
for both sides). Resolve the append-pointer
display semantics in its owning bolt; no product fix is made here.

The first browser driver expected wrapped GET responses and then navigated to the
API route instead of the SPA's `/app` route. Those failed driver trials are
retained in `.tmp/baseline-browser-0`, `-fixed` and `-routes-fixed`; the corrected
`-final` trial supersedes them. These are tooling mistakes, not product failures.
The corrected trial overlaps aged-store execution and must not be presented as a
quiet or isolated browser benchmark.

## Verification and delivery boundary

All commands below used Node 22.14.0 first on PATH. Logs are retained under `.tmp/`.

| Command                                                | Result                                                                                                                                                                                   |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd build`                                       | Passed, 11/11 tasks, before browser measurements.                                                                                                                                        |
| `pnpm.cmd typecheck`                                   | Passed, 20/20 tasks, uncached. No TypeScript source was added.                                                                                                                           |
| `pnpm.cmd lint`                                        | Passed, 11/11 package tasks, cache hits.                                                                                                                                                 |
| `pnpm.cmd exec eslint tooling/perf`                    | Passed directly for the new MJS tooling.                                                                                                                                                 |
| `pnpm.cmd format:check`                                | Passed.                                                                                                                                                                                  |
| `pnpm.cmd check:layers`                                | Passed.                                                                                                                                                                                  |
| `pnpm.cmd check:deps`                                  | Passed; existing `no-orphans` warning for `packages/infrastructure/drizzle.config.ts`, no errors.                                                                                        |
| `pnpm.cmd --filter @graphgoblin/tooling test:coverage` | Passed, 55/55 tests. The existing tooling command uses Node's test runner and emits no line/branch percentages. No threshold or exclusion changed; no production package source changed. |
| `node --test tooling/perf/observers.test.mjs`          | Passed, 4/4 observer/fixture tests.                                                                                                                                                      |
| `pnpm.cmd check:docs`                                  | Not run: no route or node schema changes.                                                                                                                                                |
| `pnpm.cmd check:licenses`                              | Not run: no dependencies added or changed.                                                                                                                                               |
| `pnpm.cmd check:tokens` / normal web specs             | Not run: no `apps/web` source changes. The new measurement driver ran actual installed Edge against the built app, fresh and aged.                                                       |

The four new short tests cover fragmented SSE frames/cursor gaps and ID mismatch,
bounded histogram counts/percentile bounds, a legal capped cyclic fixture with its
initializer outside the cycle, and reconnect payload hashing that ignores transport
comments. These are measurement-observer tests; no product regression fix is
claimed. Long experiments remain outside routine tests and coverage.

Standalone MJS was chosen to drive real child processes, IPC, profiling, SQLite
files, SSE reader pauses and Edge with one command per workload, without adding a
workspace package, dependency or production instrumentation. Public constructor
injection supplies timed ports. The settled caps remain unchanged. Sizes, polling
intervals, fake completion delay, population batching and measurement timeouts are
engineering parameters documented in the script README, not owner-approved SLAs.

Only tooling and documentation change. `docs/10-testing-and-quality.md` gains a
performance-baseline link; the historical libsql-yielding results remain intact.
The additive Unreleased CHANGELOG bullet names #190. No ADR, generated reference,
schema, migration, index operation, commit, publication or optimization is included.
Shared-file edits are limited to those two additive documentation entries.

Result for #190 / UoW #302 / intent #287: **measured**. The deliverables are the
repeatable harness, this preliminary baseline with retained evidence, and the
finite #268/#186/#259 candidates. Official quiet-host numbers and Claude Opus 5.5
review remain with the orchestrator. The host/load and profiler differences forbid
turning the fresh/aged wall-time comparison into a causal aging or capacity claim.

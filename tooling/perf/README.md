# Sustained-run measurements (#190)

Build once with Node 22 first on PATH:

```powershell
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
pnpm.cmd build
```

Run from the repository root. Each command starts its own API on a free loopback port,
uses a new temporary file-backed store and a scripted fake harness, and makes no
provider calls. Edge runs headlessly using the installed Microsoft Edge channel.
No owner instance, home store, browser profile, or service worker is modified.

| Workload                  | One command                                                 | Default size                                                                                                           |
| ------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Cyclic streaming          | `node tooling/perf/measure.mjs long`                        | 100, 1,000, 10,000 passes; 2 items/turn                                                                                |
| Growing context           | `node tooling/perf/measure.mjs context`                     | 100, 1,000, 10,000 passes; append 128 bytes/pass                                                                       |
| Finished-run SSE replay   | `node tooling/perf/measure.mjs replay`                      | 1,000 passes; 32 items/turn, 256 bytes/item                                                                            |
| Transcript artifacts      | `node tooling/perf/measure.mjs artifacts --passes=100,1000` | 8 items/turn, 4,096 bytes/item; unique transcripts                                                                     |
| Readiness                 | `node tooling/perf/measure.mjs readiness`                   | Real CLI preflight, reopen, cold-process first GET /runs, then warm reopen                                             |
| Edge inspector and Events | `node tooling/perf/measure.mjs browser`                     | 1,000 streaming + mutation passes; 2 items/turn; 512 bytes/pass; 50 ms fake completion delay; 50 inbound 32 KiB values |

Append `--aged=2000` to any command for the aged comparison. Population runs real
trigger-to-exit graphs through API admission and the engine, in batches of 50 with
one execution slot. The measured population time includes those batches draining.
It is a populated current-format store, not a simulation of months of fragmentation.

Sizes can be changed with `--passes=100,1000,10000`, `--items=2`,
`--item-bytes=120`, `--context-bytes=128`, `--pause-ms=50` (between SSE reads,
and before the first read), and `--browser-ms=5000` (per page). `--setup-timeout-ms=600000` is the API import/setup ceiling, adjustable separately from workload sizing.
`--out=.tmp/my-measurement` selects an evidence directory; otherwise it is a new
directory under the system temp folder. Use a **new output directory for each invocation**.
The gate and per-node visit limits remain at or below 10,000. Initialization runs
once outside the context-growth cycle. An allowed repeat increments the one-based
gate count; the Nth work visit ends through Limit reached.

Use `--load-conditions="quiet host; other workers stopped"` to record the actual
rerun conditions in JSON. Without it the conditions are labeled unspecified;
host CPU busy fraction and free RAM are always recorded. The checked-in baseline
documents the shared-workstation activity during its trials.

Profiling uses `--profile=inspector` by default on Windows: the built-in V8
profiler starts after dependencies load and writes the standard Chrome CPU profile.
`--profile=node` uses `--cpu-prof --cpu-prof-interval=1000` from process start
(and is the default on other platforms). The baseline investigation observed
profiled imports stall on this Windows host while an unprofiled import completed;
the after-load mode avoids profiling that initialization phase. Both modes sample
the real API process at 1 ms, and the mode is recorded in the JSON. Cold-request
wall time always includes imports; inspector CPU profiles exclude them.

Every invocation writes `invocation.json` immediately, `summary.json` as work completes,
`memory.jsonl`, `memory-live.jsonl` (streamed to the parent during execution), `api.cpuprofile`, and its disposable store. Browser runs also write
`browser.json` and screenshots. A successful command prints one machine-readable
`PERF {...}` line (sample arrays are compacted to counts/endpoints/peaks there; the JSON files retain the full arrays); progress and the evidence path go to stderr. A measurement or
correctness failure exits nonzero, preserving existing evidence. Data and artifacts
are intentionally retained; reusing an evidence directory is rejected; the harness does not delete directories. The 10-minute setup ceiling and 1-hour IPC
command ceiling is a tooling timeout, not a product SLA.

The script automatically restarts itself with Node 22's experimental
`import.meta.resolve` parent-resolution flag. This resolves public package entry
points from the API/web composition roots without adding dependencies or importing
private source files. The worker uses built code. Standalone JavaScript keeps these
long, file-backed experiments outside Vitest and coverage; no TypeScript package or
product instrumentation is added.

Browser warmup polls once per second for up to ten minutes; page locators and the
post-run thread HTTP read have two-minute limits. These bounds preserve a finite
failed measurement on a stalled host; they do not set product latency targets.

## Interpretation

- Public-port decorators passed to a new `RunManager` time repository operations,
  including append, snapshot writes, artifact puts, and run metadata reads. They
  do not patch repositories or private methods. Existing container startup is real.
- Per-pass wall time includes deliberate between-node yields, scheduling, fake
  production, persistence, and engine work. The port total is inclusive awaited
  time; residual wall time is **not exclusive engine CPU**. Admission can overlap
  execution; `maxConcurrentPortCalls` flags that limitation.
- A fixed logarithmic histogram retains counts, mean, max, and percentile upper
  bounds (within 10% above 1 microsecond), instead of retaining every call duration.
- Ten work checkpoints measure persisted snapshot size, JSON stringification,
  direct repository `getThread`, and heap. Those extra reads are outside port
  timings and their observation time is reported separately.
- Heap/RSS and DB/WAL sizes are sampled every 250 ms during execution. Explicit GC
  occurs before and after each run, never at every pass. File sizes are logical
  bytes; database plus WAL can fluctuate at checkpoints. Artifact content is unique.
- Event serialization is a post-run JSON stringify plus UTF-8 byte-count probe over all stored events in
  pages of 1,000. Hashing, database validation and network cost are excluded. Snapshot serialization probes also include byte counting. The SSE endpoint
  itself is unchanged and may read the whole replay.
- SQL queue controls submit sixteen `SELECT 1` requests concurrently through the
  real serialized client, idle and just after run admission. They measure combined
  lock wait/native/yield cost, not pure mutex wait or steady-state queue depth.
- CPU profiles cover the API process only. Per-case summaries filter samples to
  the execution window, excluding import/startup/population and final correctness
  reads. Self-sample counts identify candidates, not causal speedup percentages.
- SSE clients run in the parent process. First-event time includes any deliberate
  reader pause. Server memory and `ServerResponse.writableLength` are sampled every
  25 ms; sampled maxima are lower bounds and exclude kernel/socket buffers.
  Reconnect interrupts after at least one third of the history at an actual
  received cursor. Counts, ordering, and SHA-256 payload hashes are checked against the durable log, including the combined reconnect prefix and suffix. Repository read time is reported separately from total replay time; lag samples record bytes/events consumed.
- Browser history warms to one quarter of the configured passes before Edge opens. An empty Events-page control precedes the inspector and populated Events page. The fake completion delay keeps the stream active during observation. Browser TTI is an operational proxy: visible h1 plus an actionable inspector
  loop link, or the Events empty state/table, followed by two animation frames. It is not a
  standardized Web Vitals TTI score. CDP Performance metrics, PerformanceObserver
  long tasks, DOM counts, session-storage bytes, and browser heap are retained.
  Each page uses its own isolated context. The empty Events control lasts at most one second; other observations use the configured duration. Run records before/after show whether
  execution continued during observation; screenshots show the measured views.
- Correctness checks include contiguous stored sequences, progress count,
  gate/pass/visit counters, exact growing-array length and values, one terminal event and
  replay/reconnect completeness. Fake-harness results establish no provider behavior.

See [the measured baseline](../../docs/qa/2026-10-18-sustained-run-measurements.md)
for results, load conditions, attribution limits, and the finite follow-on list.
Short observer tests run with tooling's normal tests; measurements never do.

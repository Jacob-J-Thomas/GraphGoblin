# Sustained-run measurements (#190)

Build once with Node 22 first on PATH:

```powershell
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
pnpm.cmd build
```

Run from the repository root. Each command starts its own API on a free loopback port,
uses a new temporary file-backed store and fake execution (plus native main.js for readiness), and makes no
provider calls. Edge runs headlessly using the installed Microsoft Edge channel.
No owner instance, home store, browser profile, or service worker is modified.

| Workload                  | One command                                                 | Default size                                                                                                                   |
| ------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Cyclic streaming          | `node tooling/perf/measure.mjs long`                        | 100, 1,000, 10,000 passes; 2 items/turn                                                                                        |
| Growing context           | `node tooling/perf/measure.mjs context`                     | 100, 1,000, 10,000 passes; append 128 bytes/pass                                                                               |
| Finished-run SSE replay   | `node tooling/perf/measure.mjs replay`                      | 1,000 passes; 32 items/turn, 256 bytes/item                                                                                    |
| Transcript artifacts      | `node tooling/perf/measure.mjs artifacts --passes=100,1000` | 8 items/turn, 4,096 bytes/item; unique transcripts                                                                             |
| Readiness                 | `node tooling/perf/measure.mjs readiness`                   | Real CLI preflight, native main.js cold first GET /runs, then warm harness reopen                                              |
| Edge inspector and Events | `node tooling/perf/measure.mjs browser`                     | 1,000 streaming + mutation passes; 2 items/turn; 512 bytes/pass; 50 ms minimum fake completion delay; 50 inbound 32 KiB values |

Append `--aged=2000` to any command for the aged comparison. Population runs real
trigger-to-exit graphs through API admission and the engine, in batches of 50 with
one execution slot. The measured population time includes those batches draining.
It is a populated current-format store, not a simulation of months of fragmentation.

Execution sizes can be changed with `--passes=100,1000,10000`, `--items=2`,
`--item-bytes=120`, `--context-bytes=128`, `--pause-ms=50` (between SSE reads,
with an initial hold of at least 1,000 ms), and `--browser-ms=5000` (per page). `--setup-timeout-ms=600000` is the API import/setup ceiling, adjustable separately from workload sizing.
`--out=.tmp/my-measurement` selects an evidence directory; otherwise it is a new
directory under the system temp folder. Use a **new output directory for each invocation**.
`--port=5740` binds the worker API to an assigned loopback port instead of a free
ephemeral port; `--store-prefix=gg-wp-e1-186-` names its disposable store directory.
Use the same observation options for a before/after pair. Worker cleanup uses the
public raw run-reference enumeration so retired run-decoding APIs are not required.
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

Every invocation directly writes a portable `summary.json` and a complete,
untracked `raw-summary.json`, plus `invocation.json`, `memory.jsonl`,
`memory-live.jsonl`, `api.cpuprofile`, the disposable store and artifacts.
Browser runs also write `browser.json` and screenshots. The portable summary
uses shared port/CPU-location dictionaries and root case/page/replay arrays, specification/correctness row columns, primary port spans plus other-port
totals, up to six checkpoints, three top CPU frames and bounded replay/browser
curves. It excludes absolute paths, command arguments and preflight stdout.
Aggregate raw invocation records with:

```powershell
node tooling/perf/summary.mjs --out=summary.json first-raw-summary.json second-raw-summary.json
```

A successful measurement prints `PERF {...}`; progress and its private evidence
path go to stderr. A measurement/correctness/profile failure exits nonzero.
Output directories are **never deleted** and cannot be reused. Budget at least
24 to 59 MB for typical round-1 long-run store data per output directory, with
additional space for profiles, traces and artifacts; artifact cases can exceed
that range. Small smokes use less space. The ten-minute import/setup and one-hour
IPC ceilings are measurement recovery limits, not product SLAs.

The script automatically restarts itself with Node 22's experimental
`import.meta.resolve` parent-resolution flag. This resolves public package entry
points from the API/web composition roots without adding dependencies or importing
private source files. The worker uses built code. Standalone JavaScript keeps these
long, file-backed experiments outside Vitest and coverage; no TypeScript package or
product instrumentation is added.

Browser warmup polls once per second for up to ten minutes; page locators and the
post-run thread HTTP read have two-minute limits. These bounds preserve a finite
failed measurement on a stalled host; they do not set product latency targets.

## Controlled rerun protocol

Use **inspector mode throughout**, a quiet host, and at least two trials per
workload. Run each fresh/aged pair back to back, reversing order for trial 2:

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

Use a new output directory per invocation (omitting `--out` allocates one).
Keep sizes, pacing and profiler settings identical within a pair. Preserve all
individual trials. Round 1 ran fresh first at 99.6 to 100% load and aged later under
changing load; its rows are **not comparable paired trials**. The controlled
large-workload protocol is for the official rerun; review-fix verification uses
only `replay --passes=100`, `browser --passes=100`, and `readiness`.

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
  reads. Filtered sample counts must be positive and at most the profile total. Self-sample counts identify candidates, not causal speedup percentages.
- SSE clients use a raw HTTP/1.1 socket with a 64 KiB high-water mark. The slow
  reader pauses for at least one second initially, then `--pause-ms` between
  reads; no Fetch body prebuffering hides lag. Replay enables the API event-loop
  histogram and records mean/p99/max. Public socket bytes written minus raw wire
  bytes consumed estimates outstanding bytes, including kernel/client buffers;
  it is not an isolated JS queue measurement. At most one 25 ms memory RPC is
  outstanding. Post-replay samples remain labeled separately. Round-1 buffering
  growth with lag was not measurable; full-history materialization was observed.
  Counts, ordering and hashes cover first/late/slow/reconnect payloads exactly.
- Browser `shellReadyMs` checks the heading/actionable link or Events state.
  Inspector `historyReadyMs` additionally waits for the Timeline list/heading to
  reach the pre-navigation server cursor. CDP/heap/DOM/storage/long tasks are
  sampled every 250 ms during loading and observation, plus a final sample.
  Browser contexts are isolated; process IDs come from public CDP SystemInfo for
  scoped cleanup checks. Run cursors before/after show execution continued.
  Fake completion delay is `max(50, ceil((3*browserMs+20000)/passes))` ms, allowing
  small smokes to span all page observations. Defaults remain 50 ms for 1,000
  passes. The 20 s margin is a measurement parameter, not a latency target.
- Readiness cold start spawns the real `apps/api/dist/main.js`, an alternate free
  port and the disposable store, with absent harness binaries, then polls /runs
  every 100 ms. It is unprofiled; Inspector mode covers the measurement worker.
  First-response time includes polling granularity. The owned native child is
  terminated and awaited; warm reopen is separately labeled. No `--passes`
  argument applies to readiness. CLI preflight exit 1 is expected for absent
  providers; the database-ready result is retained without stdout in the summary.
- Correctness checks include contiguous stored sequences, progress count,
  gate/pass/visit counters, exact growing-array length and values, one terminal event and
  replay/reconnect completeness. Fake-harness results establish no provider behavior.

See [the measured baseline](../../docs/qa/2026-10-18-sustained-run-measurements.md)
for results, load conditions, attribution limits, and the finite follow-on list.
Short observer tests run with tooling's normal tests; measurements never do.

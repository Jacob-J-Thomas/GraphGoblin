# #273 Node reference implementation and performance evidence

**Status: evidence curation only. Exact-head domain coverage later passed; native and browser UI acceptance remain pending.**

## Integrated scope and remaining gates

The phase 1 UI handoff records an implementation candidate based on 77e14b. Root later froze the UI source at bebed488 and integrated it at main commit a770ca57e642998f71b1d113031e69c7080fc324. The bounded source-analysis cache correction is commit 207b3e53067ebded36c8ec4e28dc47de46e1631f over a770. The supplied current clean head is 207b3e53067ebded36c8ec4e28dc47de46e1631f.

Full domain coverage subsequently passed at the exact integrated clean head 207b3e53067ebded36c8ec4e28dc47de46e1631f: 428/428 tests across 29 files; 98.72% lines, 95.56% branches, 97.83% statements, and 98.23% functions, all above unchanged thresholds. The command used Node v22.23.4 and pnpm.cmd --filter @graphgoblin/domain test:coverage; the byte-preserved [exact-head coverage log](performance/node-reference-273-perf-exact-domain-coverage.log) records the result. This later run supersedes the older delivery report's time-bounded pending-coverage note; that historical report remains unchanged. Native editor/browser verification and independent UI behavior QA remain pending. The [phase 2 native plan](ui/phase2-native-plan.md) is still a plan; its browser scenarios have not run. Do not use this evidence as UI acceptance or a merge-readiness claim.

The independently performed backend QA is retained as its own canonical sibling bundle: [207b3e backend QA README](../2026-11-14-node-reference-backend-independent/README.md). Its exact-head [207b3e source retain manifest](../2026-11-14-node-reference-backend-independent/retain-manifest.json) records the copied source hashes. The earlier 77e14b assessment remains in its separate evidence archive. This implementation bundle does not duplicate the backend bundle, runner, observations, or failure files.

## Performance result and limits

The initial 77e14b candidate showed a synchronous CPU regression against pre-feature 308c6285: on the paired 300-node fixture with references, validateDraft moved from an 11.02 ms median to 28.88 ms, an added 17.86 ms. The first UI-generated benchmark measured 50.5 ms median / 60.8 ms p95, with its own 300-node fixture. These are separate samples and fixtures; see the retained plan, probe source and logs.

The corrected exact-head 207b3e probe reused immutable per-source facts. In paired Node 22.23.4 samples, public validation results matched the baseline. For each 300-node fixture it parsed/analyzed 298 unique cold sources once, zero times on repeat and once after a one-prompt edit:

| 300-node fixture   | Baseline steady median / p95 | Corrected steady median / p95 | Baseline one-prompt edit median / p95 | Corrected one-prompt edit median / p95 |
| ------------------ | ---------------------------- | ----------------------------- | ------------------------------------- | -------------------------------------- |
| With references    | 10.52 / 12.40 ms             | 5.10 / 8.36 ms                | 10.48 / 13.93 ms                      | 4.55 / 6.81 ms                         |
| Without references | 10.36 / 14.57 ms             | 4.77 / 6.52 ms                | 10.26 / 15.66 ms                      | 5.40 / 7.25 ms                         |

The first paired cache-correction probe reused one changed source across fixture families; that run is retained but is not the exact corrected result. The corrected paired probe uses disjoint fixture keys. All reported timings measure synchronous Node CPU work. They do not measure browser paint, input-to-paint latency, drag-frame routing, or drop latency.

## Contents and provenance

- [Formatted phase 1 handoff](ui/handoff.md) and its byte-preserved [raw Markdown](ui/handoff.md.txt) describe the UI candidate, source hashes, tested behavior, first failures, and the negative controls.
- [Formatted native phase 2 plan](ui/phase2-native-plan.md) remains a plan; the raw source is [preserved separately](ui/phase2-native-plan.md.txt).
- The exact UI diff and three new source files are under [ui/](ui/). Session launch/result/exit metadata is included; the multi-megabyte event stream and wrapper summary copies are omitted.
- [Formatted performance delivery](performance/node-reference-273-performance-delivery.md) and [formatted original performance plan](performance/node-reference-273-performance-plan.md) sit beside their raw .md.txt copies. Their linked probe sources and initial/corrected logs are preserved in the same directory, including the later [exact-head full-domain coverage log](performance/node-reference-273-perf-exact-domain-coverage.log).
- [Candidate source manifest](candidate-source-manifest.json) records all 11 hashes from phase 1. Three new-file bytes are archived and hash-verified; eight modified tracked files are represented by the recorded diff and their handoff hashes, not full-file copies.
- [Raw source evidence manifest](source-evidence-manifest.json), [Markdown before/after hashes](markdown-publication-hashes.json), and the [final publication manifest](publication-manifest.json) preserve provenance and publication hashes.

Claude phase 1 used the launch configuration in ui/launch.json: claude-opus-5-5, xhigh assigned. The session result reports actual canonical model claude-opus-5-5, success, 183 turns, and exit code 0. The launch records the requested effort; effective runtime effort was not independently verified. The runner's result.json is session metadata, not a GraphGoblin run result.

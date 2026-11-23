All six D216 criteria pass at `e630bb83679bdb055bdd90d2b30e25fbf60571ac`, and the genuine 8.3 short-name case was actually run, not reported as unavailable. This is a result for this targeted supplement only. It gives no root final admission, CI/native verification, cap closure or merge acceptance. The older 6de QA results were not reused or relabeled.

| # | Criterion | Result |
|---|---|---|
| 1 | Uppercase G TEMP | **PASS** |
| 2 | Genuine 8.3 short-name C TEMP | **PASS** |
| 3 | e630 full `fs.test.ts`, ordinary G TEMP | **PASS**: 20 tests, 20 passed, 0 skipped (count observed, not assumed) |
| 4 | e630 junction G TEMP: temp, fixed, template | **PASS**, 3 of 3 |
| 5 | e630 with cwd on G and C TEMP in the test worker only: adapter mixed-relative and engine relative | **PASS**, 1 of 1 each |
| 6 | Delta, fixture restore, binding, cleanup | **PASS** |

**1. Uppercase G TEMP.**
- **Probe:** with no instrumentation, ordinary JS `realpathSync` kept the uppercase spelling. `realpathSync.native` and `fs/promises.realpath` both returned the same physical spelling, and it was the same file (same dev/ino).
- **6de control:** run with the observer recording only, it failed at `fs.test.ts:143:52`. Expected was the uppercase `G:\GGQ\QA-SCRATCH\…\UPPER-TEMP\gg-wp-e3-7Gzz36\workspaces\…01`; received was the physical `G:\ggq\qa-scratch\…\upper-temp\…`.
- **e630:** passed in the same environment.

**2. Genuine 8.3 alias.**
- **Alias found:** Windows' existing behaviour gave my tiny owned C fixture the short spelling `C:\Users\98jak\GR58B7~1\D216-S~1\SHORT-~1`. I changed no volume settings, privileges or mappings.
- **Same directory:** the short path has the same dev/ino/birthtime as the long one, it is not a link, and a marker written via the long path read back via the short one. Native sync and promise realpath both return the long path; JS realpath keeps the short one.
- **6de control:** all three cases failed as expected.
  - temp failed at `:143` on the cwd check (short spelling expected, long received).
  - fixed and template got past the lexical cwd and result-file checks at `:143`/`:144`, then failed at `:147` on `journal.use` (short canonical expected, long native received).
- **e630:** passed 3 of 3, once recording only and once with passthrough taps. The taps showed each dataDir spelled through the short path.

**3–5.** S5 ran in the real test worker: the relative input was not absolute, the target was on G and the dataDir on C. A real 15-byte `result.txt` was written via the relative path, and no `gg-wp-relative-*` directories were left behind.

**6. Delta, restore, binding, cleanup.**
- Rewriting only the two `realpathSync(…)` → `realpathSync.native(…)` sites in the 6de file reproduces the e630 file exactly, ignoring whitespace. All assertion token counts are identical.
- Both 6de controls restored the candidate bytes `723d7333…` inside `finally`, with empty git status. Each test worker's own record shows it ran the intended fixture bytes.
- At the end, HEAD/tree/parent, index, fixture, lock and `.modules.yaml` all match the binding. Status is empty and nothing is staged.
- Cleanup removed every QA directory after an identity check, each empty and without recursion. The junction was unlinked as a link, without following it. No C fixture remains.
- I made no commit, stage, push or GitHub/owner-store action, and ran no install or build.

**How it was run.**
- **Instrumentation:** the reference observer was reused byte-exact (`62a5a655…`), still leaving `realpathSync.native` untouched. The new runner was derived once (`c160f6dc…`) and never revised.
- **Runs:** 9 test runs plus 4 probes, each run once, with no retries or timeouts and no `phase-error` events.
- **Failed write attempts:** two attempts to write the runner file from the shell failed before anything ran: one hit the Windows command-line length limit, the other a bash parse error. I then wrote the file with the Edit tool.

**Limits.**
- **Controlled set-ups:** all environments are QA-created, not real incidents. The 6de controls swapped one test file inside the e630 checkout rather than using a separate 6de checkout.
- **TEMP scope:** in criteria 1, 2 and 5 only the test worker got the special TEMP; vitest's main process and pnpm stayed on ordinary G TEMP.
- **8.3 scope:** short names were only checked on C. The alias includes the existing short name of the QA parent folder (`GR58B7~1`).
- **8.3 setting unreadable:** querying the volume's 8.3 setting with `fsutil` was denied without elevation, so availability rests on direct observation.
- **Checks not run:** I ran no lint or typecheck; the author's gates and final CI are separate.
- **C free space:** C had about 2.5 GiB free. It dropped 716,800 bytes over the run, which I can't attribute to this QA since its C directories were empty when removed.
- **C tool-output copies:** I can't confirm whether the CLI harness itself saved any tool output on C. All raw output went to G.

Files are in `G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-486-d216-independent-02`:
- REPORT.md
- qa/RESULTS.json
- qa/raw/60-baseline-failure-blocks.json — full Expected/Received text; vitest's JSON output truncates long paths
- qa/SHA256SUMS.json — 181 files, all re-verified; covers REPORT.md and everything under `qa/`, excluding `provider/` and the `dispatch.*` stream; manifest sha256 `3eaa90f1a2169c21b74ece8862d38131bc5736936a9904f3946870cbd0a31def`
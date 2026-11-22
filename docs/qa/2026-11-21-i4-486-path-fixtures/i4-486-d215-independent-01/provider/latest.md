**Verdict: CRITERION PASS** for the admitted D215 scope at `6de50cb`, with one residual limit you should decide on before disposition. This is criterion QA only: not a scan 4, Astra approval, cap completion or merge permission. Scan 3 stays CHANGES_REQUIRED. CI/native, the Fable review and the D035/D042 disposition remain yours.

## Scenarios

All eight runs came out as planned. Each test worker recorded at startup which fixture it actually ran: baseline for 1–2, corrected for 3–6.

| # | Setup | Result |
|---|---|---|
| 1 | Baseline fixture, ordinary G TEMP | Passes (positive control) |
| 2 | Baseline fixture, real Windows junction TEMP | Fails as expected at `fs.test.ts:141:52`. Expected `…\junction-alias\gg-wp-e3-jPSIr1\workspaces\…01`, received `…\junction-physical\…` |
| 3 | Corrected fixture, whole file, ordinary G TEMP | 20 of 20 pass |
| 4 | Corrected engine temp case, same junction | Passes; the test compared against the physical path, and a 15-byte result file appeared in the physical directory |
| 5a/5b | Corrected fixture, cwd on G, test TEMP on C | Both pass (details below) |
| 6a/6b | Corrected fixed and template cases, junction TEMP | Pass; assertions used the supplied alias spelling, and the temp-only realpath step was not applied |

In 5a/5b the old b812 formula, evaluated in the same worker with that run's C data dir, gave absolute `C:\…` paths. The corrected inputs were genuinely relative (`gg-wp-relative-rMiS7X\workspace` and `gg-wp-relative-watq6s\workspace`). The production `FsWorkspace.resolve` received them, and the real files were created and then removed in the G checkout. Nothing relative landed on C.

## Gates and preservation

- Infrastructure typecheck, eslint on the file, prettier and `git diff --check` all exit 0; I confirmed both typecheck and lint actually covered fs.test.ts.
- All 77 original `expect(` lines survive unchanged. The only additions are the two `isAbsolute(...) === false` checks.
- No skip, timeout, retry or chdir was added, and no production file changed.

## Cleanup

The junction was unlinked without touching its target, and every owned fixture was removed after an identity check, including the tiny C directory. The checkout ends clean at `6de50cb`, with index, fixture and lock bytes identical to the binding.

## What you need to decide

- **Newer author commit:** while this QA was running, the author committed `e630bb8`, a child of `6de50cb`. It switches both realpath calls in the test to `realpathSync.native`. **This QA does not cover `e630bb8`.** If that becomes the head under disposition, it needs its own QA.
- **Short-name gap (traced, not run):** the corrected expectation uses JS `fs.realpathSync`, but production uses native realpath. On this host, `realpathSync('C:\PROGRA~1')` returns `C:\PROGRA~1` while native returns `C:\Program Files`. With a TEMP spelled through an 8.3 short name (such as `RUNNER~1`), the corrected temp assertion would likely still fail. The baseline fails there too, so it isn't a D215 regression. I didn't run that configuration because it wasn't admitted. In every scenario I did run, the two agreed.

## Other limits

- **Worker-only C TEMP:** in scenario 5 only the test worker got the C TEMP. Vitest's main process writes about 220 transformed-module files to its own TEMP, so I kept it on G to keep that cache off C. The test only reads the worker's TEMP and cwd, and both were recorded.
- **Typecheck half not run:** the emitting `tsc -b` part of the package typecheck was skipped. It excludes test files, writes `dist/`, and its inputs are identical to b812.
- **Instrumentation changed mid-run:** I revised the runner and observer three times. The old copies are preserved, and no test was re-run because of a revision.
- **Harness copies on C:** the harness saved two oversized tool outputs on C under `.claude\projects\…\tool-results`. They are not QA logs or fixtures, and I left them alone.

Everything is in `G:\ggq\delivery-evidence\2026-11-17-five-intents\i4-486-d215-independent-01`:
- REPORT.md
- qa\RESULTS.json
- qa\SHA256SUMS.json — sha256 `3114f1fc…f6d7b1`, 119 files
- qa\raw\ (per-run outputs)
- qa\tools\ (runner and analysis scripts)
# D242 independent component regression handoff

Unarmed. The accepted D241 lineage uses the exact 76,934-byte `55a0c5a29f8f7dc6de1045d3d4858d790fdca548385237684ec3bbb5c6f31c3a` fixture. The PowerShell runner changes one line to use a fresh D242 output directory. Its Node 22.23.4 and pinned pnpm launcher, selected module probe, static checks, fresh2 selection and separate unfiltered full63 command are unchanged. Fresh2 selects 2 of 63 with 61 filtered, then full63 selects all 63 with zero filters. Both use one worker, zero retries and the existing 20-second limits. [D241 execution](../i5-d241-session-feedback-corrected-qa-01/REPORT.md) · [One-line runner diff](runner.diff)

## Root sequence after the Opus closure and focused checks

1. Complete and preserve the old native repro or explicitly disposition its original-index hold. The old-repro packet pins the live UIQA index to `9feea17c…` and serves the retained a0 `owned-web-dist` through the recorded f642 shipping equivalence. The D242 corrected-native template also starts with that old index pin. If it runs after UIQA advances, rebind its protected UIQA index to the actual advance receipt when admitting the corrected build. Finish the component closure before rebuilding UIQA's working web dist. [Old native plan](../i5-d242-b2-native-qa-preparation-01/PLAN.md)
2. Copy `ROOT-FF-ADMISSION.template.json` to `ROOT-FF-ADMISSION.json` here. Root sets the explicit FF and original-index release booleans while keeping component execution unarmed. Supply preparation `MANIFEST.json` SHA-256, the actual corrected `source` object with head/tree/ordered parents, and exact canonical public file refs with `source, bytes, sha256` for the actual freeze, focused proof and old-native disposition. `correctedFiles` maps only actual changed names to raw `bytes, sha256` from the freeze. All placeholders remain null in preparation.
3. The rebind preflights UIQA's recorded a0 head/tree/raw linked index/stage digest and five untracked overlays. It matches the accepted 1,431-entry a0→f642 archive delta, including the historical attribute/ignore metadata, then independently requires the exact root-frozen f642→corrected delta inside the eight authorized paths. Its only Git mutation is the accepted UIQA-only `merge --ff-only <corrected-head>`. It preserves raw before/after index copies, five overlay originals, patched Git bytes, stage digest, runtime/module cohorts, and working and retained frozen distributions. Root reads the new `REBIND.json` and `after.json` before authorizing component execution. Original D241 evidence directories remain available at their sealed bytes. [Advance diff](rebind.diff)
4. Copy `ROOT-EXECUTION-ADMISSION.template.json` to `ROOT-EXECUTION-ADMISSION.json`. With the sole slot assigned, set its booleans, actual corrected `source`, preparation-manifest SHA-256 and exact canonical `rebind` ref. The bind command repeats source/control checks and materializes `ROOT-BINDING.admitted.json`. Then execute the exact runner once. It sees only protected UIQA, with the source frozen on the admitted head and a fresh output path. A nonzero phase, selection mismatch or missing JSON remains the first result and stops progression.
5. After observing actual wrapper exit 0 and releasing the slot, fill `ROOT-CLOSURE.json` from its template using the actual numeric wrapper session plus canonical rebind and admitted-bind file refs. Extract the untouched fixture's actual bounded diagnostics, and run the derived closure reader. It checks all 63 names/order, old literal prefix bytes, exact DOM/readback scope, before/after source/index/overlays/dependencies, stream digests and both frozen web distributions. Add an actual `REPORT.md` in the execution directory and seal. The component result supports the existing FakeApi/session and DOM schedules. Script/deletion browser behavior still requires its separately admitted D242 native evidence.

## Commands for the authorized phases

```powershell
$qaEvidence = 'G:/ggq/delivery-evidence/2026-11-17-five-intents'
$qaPrep = Join-Path $qaEvidence 'i5-d242-b2-independent63-preparation-02'
$qaRebind = Join-Path $qaEvidence 'i5-d242-b2-independent63-rebind-01'
python -I (Join-Path $qaPrep 'rebind.py') --root-execute-ff
# After root reads exact parity and creates the separate execution admission.
python -I (Join-Path $qaPrep 'rebind.py') --root-bind-execution
pwsh -NoProfile -File (Join-Path $qaPrep 'run-corrected.ps1') -BindingPath (Join-Path $qaRebind 'ROOT-BINDING.admitted.json') -Execute
# After wrapper closure, receipt binding and heavy-slot release.
python -I (Join-Path $qaPrep 'extract.py')
python -I (Join-Path $qaPrep 'close.py')
# After recording actual observations in the new execution REPORT.md.
python -I (Join-Path $qaPrep 'seal.py')
```

The retained exact full63 command is the pinned pnpm executable with `--filter @graphgoblin/web exec vitest run src/runs/RunInspectorPage.independent-416.qa.test.tsx --maxWorkers=1 --retry=0 --reporter=default --reporter=json --outputFile=<fresh E execution>/07-full63.json`. The runner retains the structured argv, process receipt, result JSON and streams. The preparation inspected prior scripts and receipts only. Actual future source, index and execution authority remain unset.

Preparation 02 corrects the pre-advance selected-source baseline lookup. The exact component runner and all authority templates carry forward intact. [One-line correction](rebind-01-to-02.diff)

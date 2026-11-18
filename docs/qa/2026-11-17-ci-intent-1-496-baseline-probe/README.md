# Hosted native baseline probe for #496

Attempt 1 of run 44247043760 succeeded at head `ee14592a94ef9273c8a5000e49022a4a87cf7e1a` on the QA-only `codex/qa/gg-496-baseline-probe` branch. This branch must never merge. The probe workflow used the original native workload and the original upload pattern. [Hosted job 134608389418](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44247043760/job/134608389418), [run receipt](run.json), [job metadata](jobs.json)

All 25 native tests passed. Immediately before upload, four fixture roots existed and three checked outputs were ordinary files. The probe retained existence, attributes, and lengths. The historical `.tmp/windows-launcher-*/` upload with default hidden exclusion reported no matches. The complete artifact listing contains zero archives. [Pre-upload probe](verification.json), [raw job log](baseline.raw.log.txt), [complete listing](artifacts.json)

Both hosted controls resolved the action to `ea165f8d65b6e75b540449e92b4886f43607fa02`. The baseline fixture metadata and the synthetic positive and negative uploads together establish default hidden-directory filtering as the historical failure. The corrected candidate’s export requires separate verification. [Synthetic uploader control](../2026-11-17-ci-intent-1-496-uploader-control/README.md), [connector readback](connector-readback.json), [issue evidence reference](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/496#issuecomment-6970435921)

All seven original baseline records and their source seal are archived here. [Raw baseline report](source-readme.md.txt), [original seal](SHA256SUMS.txt), [publication manifest](publication-manifest.json), [evidence index](../2026-11-17-ci-intent-1/README.md)

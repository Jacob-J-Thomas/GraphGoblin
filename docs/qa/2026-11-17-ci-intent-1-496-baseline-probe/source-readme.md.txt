# #496 hosted baseline native probe

[Run44247043760](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44247043760/job/134608389418), attempt1, succeeded at QA-only head `ee14592a94ef9273c8a5000e49022a4a87cf7e1a` based on `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1`. The branch `codex/qa/gg-496-baseline-probe` must never merge. Its only change is a separate QA workflow; the native workload and original ci.yml remain unchanged.

All25 native tests passed, zero failed. Immediately before the historical upload, `.tmp` and four fixture roots existed. Three known outputs were ordinary, non-link files: fixture.exe56320bytes, GraphGoblin.exe56320bytes and launcher.log3498bytes. The probe read only existence, attributes and lengths; no fixture contents were read or exported. The default `.tmp/windows-launcher-*/` uploader then reported no matches, and the complete artifact listing contains zero archives.

The resolved action SHA `ea165f8d65b6e75b540449e92b4886f43607fa02` equals the [synthetic control](../496-hosted-uploader-control/README.md). That control demonstrates hidden-path filtering and positive uploads from synthetic opt-in, visible workspace and runner-temp locations. Together these observations establish default hidden-directory filtering for this baseline failure. They do not establish delivery of the candidate exporter.

Evidence: [verification](verification.json), [connector readback](connector-readback.json), [raw job log](baseline.raw.log), [run](run.json), [jobs](jobs.json), [complete artifact listing](artifacts.json). The root [issue comment](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/496#issuecomment-6970435921) was independently read back exactly.

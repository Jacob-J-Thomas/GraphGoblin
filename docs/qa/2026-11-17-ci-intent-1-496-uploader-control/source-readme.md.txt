# #496 hosted uploader control

[Run44247019952](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44247019952), attempt1, passed on the QA-only branch `codex/qa/gg-496-uploader-control` at `6dc157058a36b26d58ed392394300ca3fef94219`, based on `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1`. This branch must never merge. Only its branch name was adapted from the authored control. No checkout, install or real fixture data exists in the control job.

The Windows job134608312368 resolved actions/upload-artifact@v4 to `ea165f8d65b6e75b540449e92b4886f43607fa02`. Immediately before upload, all three ordinary marker files existed, had no link type, were48bytes and shared SHA256 `698309a8c761cbebf7a3b44ebc4114442133420203d12a332dbe25bcd674250d`.

- Historical `.tmp/windows-launcher-artifact-control-*/` pattern with default hidden exclusion: warning and no archive.
- Same synthetic-only hidden path with hidden-file opt-in: archive14402027186 delivered the marker.
- Visible workspace path with defaults: archive14402376056 delivered the marker.
- Exact runner-temp file with defaults: archive14400894938 delivered the marker.

All three archives were downloaded through the GitHub connector, matched their hosted ZIP digests, and contained exactly one matching marker. Full paginated artifact metadata confirms no hidden-default archive. The independent connector log/artifact readback agrees with raw GitHub job logs and metadata. See [verification.json](verification.json), [connector receipt](connector-readback.json), [raw log](uploader.raw.log), [run](run.json), [jobs](jobs-1.json), and [artifacts](artifacts-1.json).

This establishes default hidden-path filtering for the resolved uploader action in the synthetic control. The separate baseline native pre-upload probe must establish whether real baseline outputs exist. Exact candidate positive/negative archives remain required; no issue or review gate is completed by this control alone.

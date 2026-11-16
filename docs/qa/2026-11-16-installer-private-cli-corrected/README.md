# Corrected private installer CLI regression (#436)

This packet preserves the completed independent Opus component regression for the narrow F1 correction in the private `--validate-install` and `--stage-shortcut` modes. It is not the hosted public-installer matrix, rollback, full CI, a PR scan, or owner acceptance.

## Result

- The corrected run executed 29 of 29 cases and passed 384 of 384 checks. The native harness exited 0 with no first failure; the provider report completed with exit 0.
- C11a and C11b are now observed: the drive-relative config and final-EXE probes were refused with the expected fixed messages. Six added C12 cases cover drive-relative and current-drive-root-relative forms for config, staged link, and final EXE. All eight relative-path probes were refused with exit 1, zero stdout, and no fixture changes or canary execution.
- Absolute-path positives C01, C07, and C08 still pass. The two staged links retain the expected final targets, config arguments, working directories, icon and AppUserModelID. C08 verifies `sub\..` final-EXE normalization.
- The root acceptance receipt records Claude Opus 5.5 at xhigh effort, verifies 32 raw receipt triples, 135 original work-seal rows and all six live source hashes. The report itself says the worker could not observe its requested effort setting; the actual effort qualification comes from the root receipt.

The earlier first run remains archived separately at [the first behavior QA packet](../2026-11-16-installer-private-cli-first/README.md). The narrow [private-path correction packet](../2026-11-16-installer-private-path-correction/README.md) documents the source change and focused local regression.

## Preserved evidence

`full-report.md.txt` is the report byte-for-byte. `launch.json`, `exit.json`, `provider-final-message.md.txt`, and `root-acceptance.json` preserve run and acceptance provenance. `work-evidence.zip` is a local archive of the complete owned `work/` directory, not a GitHub artifact. It contains 136 file members totaling 515,040 uncompressed bytes plus three empty directory entries, for 139 ZIP entries total. The pre-archive walk found no reparse points. The original `work/SHA256SUMS.txt` has 135 rows covering every other work file; the packet's `work-member-inventory.json` hashes all 136 file members and lists the three directory entries separately. No work file is copied outside the ZIP.

`events.jsonl` and `result.json` are excluded because they contain private provider data; `stderr.log` is empty and excluded. `latest.md` is omitted because it is byte-identical to the retained provider final message. No file from the source work directory was modified.

## Limits

This was native PowerShell 5.1/.NET Framework/NTFS/Shell Link component evidence with inert Node, ChromeProxy and final-EXE canaries. It did not test UNC, slash or device-path variants; use a real Node, Chrome, gateway, browser/PWA, owner profile or store; use ETW; directly observe named mutexes; automate UI; or run the hosted public 32-case matrix, rollback, CI or formal review. See the full report for remaining qualifications.

See `source-copy-map.json` and `SHA256SUMS.txt` for source mapping and packet hashes.

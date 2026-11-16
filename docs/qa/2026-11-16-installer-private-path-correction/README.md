# Private installer path correction

Independent Claude Opus QA found that the new private validator accepted a drive-relative Windows config path. The [first result](../2026-11-16-installer-private-cli-first/README.md) remains a failed probe, with its separate harness postprocessing error retained. This correction requires fully qualified Windows paths for the private config, staged shortcut and final executable. Public PowerShell relative-path handling is unchanged.

The [complete correction report](raw/README.md.txt), before/after snapshots and exact diffs preserve the narrow two-file change. The [fresh six-file manifest](corrected-candidate-source.json) binds the corrected candidate. The installer and publisher function hashes remain unchanged.

The focused Windows PowerShell 5.1 installer group passed, including six path refusals against a proven valid installed config. The first format check failed and was corrected; final lint, formatting and diff checks passed. Focused execution preceded a formatting-only test-file change. The original outputs remain in the [raw evidence](raw/source-copy-map.json). Independent Opus regression, the hosted public matrix and rollback, all ordinary CI and formal reviews are still required.

[Copy map](source-copy-map.json) records 42 exact copies. Raw Markdown uses .txt to preserve bytes; the original 40-row seal remains in raw/SHA256SUMS.txt. [Packet seal](SHA256SUMS.txt) hashes every retained file.

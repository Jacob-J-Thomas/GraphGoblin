The first requested cleanup exec_command was rejected before execution by automatic policy review. The proposed action was native PowerShell removal of these two owned TEMP roots, after absolute containment, Resolve-Path, no-reparse-point and recorded-Node-absence guards:

- G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-416-api-shape-independent-qa-01/scratch
- G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-416-api-shape-independent-qa-01/attempt-02/scratch

The command used Remove-Item -LiteralPath -Recurse -Force. Tool output stated `rejected: blocked by policy`; no more specific reason was supplied. No command output/receipt or mutation occurred. The sequential module/source captures queued after it did not execute. The safer replacement is a readable PowerShell script using checked, nonrecursive per-file and empty-directory removals, preserving the same owned roots and guards.

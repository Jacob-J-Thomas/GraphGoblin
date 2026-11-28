# Integration note

This folder is PR #460's evidence for its own implementation on base `b3b5e1874`, where the
launcher still ran its helper through `Process.Start` with a fixed 15-second wait. That helper
was later replaced by the private-job helper of #459
([ADR-0086](../../decisions/ADR-0086-windows-helper-job-lifetime.md)), and the evidence here is
kept unchanged as history; it does not describe the merged code.

When #460 was integrated into #612 on 2026-11-28, only its configured helper allowance, measured
diagnostics and slow-success note were ported onto the current launcher
([ADR-0092](../../decisions/ADR-0092-configured-windows-helper-allowance.md)). The current
regressions are `tooling/scripts/windows-launcher-helper.acceptance.mjs`, the helper and
work-deadline checks in `apps/windows-launcher/NativeChecks.cs`, and the held-store cases in
`tooling/scripts/windows-launcher.acceptance.mjs`, all run by `pnpm test:windows-launcher`.

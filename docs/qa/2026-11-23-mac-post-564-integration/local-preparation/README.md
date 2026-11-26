# Mac post-564 bounded local checks

Unarmed at Mac freeze `d91386a7509a77db4bccdab6f95a3d01e730ad50`, tree `b7f195c32652729270960b0e4cb08557e500ee28`. The original static runner changes in exactly four lines: checkout, fresh output, source diagnostic and completion footer. Its existing Node probe, single process-invocation mechanism, before/after controls, 18-file checks, first-failure stop and command receipts are unchanged. The template drives only three commands after the probe. [Runner diff](runner.diff) · [Source18](SOURCE18.json)

1. Ordinary pnpm build.
2. The planned 11-file API selection under D243, omitting `src/main.test.ts` from local execution. The existing mandatory hosted and native startup selections remain separately required.
3. The exact planned nine-file web selection.

Both Vitest commands use one worker and zero retries. The planned argv is retained literally in the binding template. The 11 Mac protected paths and seven D243 fixture dependencies each matched the frozen mode/blob and physical bytes through one read-only `ls-tree` call and local digest checks. The rest of the actual source/index binding remains unset pending root verification.

## Parent launch environment and admission

Root assigns the sole local heavy slot and launches from a sanitized child-process environment. Bind both `TEMP` and `TMP` to the same fresh owned evidence scratch directory. Bind the API Vitest setup's lease root beneath that scratch and the nonowner candidate range through `GG_TEST_PORT_START=62400` and `GG_TEST_PORT_COUNT=40`. Preserve only explicitly admitted fixture variables and clear ambient configuration and provider credentials from the parent environment. Keep the project Node 22.23.4 and pinned pnpm runtime. The runner still sets `GG_OLLAMA_ENABLED=false` and `LIVE=0` for its command children. The port helper can briefly bind wildcard addresses to check for conflicts; its fixture service uses loopback. Keep actual skips and residual owned-resource observations in the closure. [D243 placement](../mac-post-564-local-admission-decision-01/DECISION.md) · [Fixture boundaries](../mac-post-564-fixture-admission-preparation-01/REPORT.md)

Fill a fresh root admission and its bind record from the templates. Name the exact frozen source, actual environment and owned paths, clean status, absent common index, current local main, raw linked index hash, staged entries and common HEAD digest. Verify the freeze's lock and module pins externally. Keep runtime, source18, gates and child-environment controls identical to the sealed template. Bind the preparation manifest and actual admission hashes, then set the two execution flags only for the admitted run. The runner must create the fresh execution directory itself.

```powershell
pwsh -NoProfile -File 'G:/ggq/delivery-evidence/2026-11-17-five-intents/mac-post-564-local-checks-preparation-01/run-local-checks.ps1' -BindingPath '<absolute root-admitted binding>' -Execute
```

No probe, build, test or provider ran in this preparation. The Mac native/GUI gate, current hosted CI, acceptance and formal review budget remain separate.

No command below is currently admitted or executed. Root first fills OLD-ROOT-BINDING.template.json, its explicit root admission and preparation seal, preserving selection `repro`, known f642 source and the preserved28-file distribution. The independent runner and assertions remain identical for the later corrected binding; corrected selection `all` is not admitted until a new freeze/build is supplied.

Original f642 replay, after root read/admission and sole-heavy-slot allocation:

```powershell
pwsh -NoProfile -File 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-d242-b2-native-qa-preparation-01/run-native.ps1' -BindingPath 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-d242-b2-native-qa-preparation-01/OLD-ROOT-BINDING.admitted.json' -Execute
```

Fixed old output: `E/i5-d242-b2-native-old-f642-execution-01`, with raw argv/stdout/stderr/exit receipts and owned temp. Native per-case JSON/PNGs/protected-file snapshots are under its `native` child. The directory must not exist. The wrapper executes the pinned standalone pnpm behind pnpm.cmd, project Node first on PATH, with exact argv:

```text
--filter @graphgoblin/web exec node <PREPARATION>/native.cjs --binding <exact admitted binding> --execute
```

The prospective corrected command has the same wrapper and CJS, using `CORRECTED-ROOT-BINDING.admitted.json`, selection `all`, and new `E/i5-d242-b2-native-corrected-execution-01` output. Its source/build/equivalence holes remain null. No install/build/API server/controller or provider is part of either runner. Do not change source/fixtures, repeat a failed case, relax deadlines or replace first results without a new explicit root disposition.

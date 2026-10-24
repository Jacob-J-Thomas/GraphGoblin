# Orchestrator dispositions for the #205 QA round 2 (2026-10-24)

The independent QA at `8cb8bff4` reproduced no product defect: 111 checks passed, including F1 to F5 from round 1, placement, 21 inheritance combinations against recorded requests, save, reload, export and import, supported and unsupported efforts, pending and failing lookups, and keyboard operation at both widths. Its verdict was "fail" only because three gates did not complete cleanly. The orchestrator (Claude Opus 5.5) records these dispositions.

- **Repository format check interrupted** before it produced a result on the loaded host. CI ran `format:check` at this head and passed.
- **API-client coverage:** the unchanged `templates.test.ts` exceeded its 5-second limit by 0.8 seconds under load. CI passed it at this head.
- **API coverage:** ADV-008 in `adversarial.test.ts` (20.4 s against 20 s), the unchanged `main.test.ts` CLI dispatch (60.3 s against 60 s) and `catalog-package.test.ts` (20.1 s against 20 s). All three timed out by under half a second, and the two unchanged files passed alone. CI (`Gates`, which includes API coverage) passed at this head.
- **Fixture errors** in the QA's own scripts (a nonexistent radio, Escape before Done) were corrected by the QA and are not product findings.
- **Record edits.** The QA's finalisation script copy (`finalize.mjs.txt`) had the local user name in a pattern, now written as `<user name>`; its `SHA256SUMS.log.txt` is recomputed from the committed bytes.

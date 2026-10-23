# Artifacts not duplicated in this folder

<!-- prettier-ignore -->
| File | Reason |
| --- | --- |
| `failure-evidence.integration.mjs` | Maintained source is already tracked under apps/api/scripts; its source checksum is kept, and the port-only replay copy is retained here. |
| `prompt-restart.integration.mjs` | Maintained source is already tracked under apps/api/scripts; its source checksum is kept, and the port-only restart copy is retained here. |
| `prompt-restart.fixture.mjs` | Original fixture remains tracked under apps/api/scripts and is used unchanged. |
| `check-qa-refs.mjs` | External orchestrator checker is not copied; its final stdout is retained as refs-check.log.txt. |

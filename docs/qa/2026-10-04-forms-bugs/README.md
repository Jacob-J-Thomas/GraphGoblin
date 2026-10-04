# Issue #51 form verification

Before screenshots use the original production code at `fce5cb57b387fadf11e6add5cb33f56d9ded0da3`. After screenshots use the fixed production build. Both were captured in Microsoft Edge through `apps/web/e2e/forms.spec.ts`, against `e2e/server.ts` on an ephemeral loopback port with its temporary data directory and in-memory database. The test teardown stops the server.

The viewport is 1280 × 900; the loop panel is 380px wide. The narrow screenshots constrain that same panel to 280px, without changing repository layout code. Images are cropped to the affected real controls. Themes use `document.documentElement.dataset.theme`.

| Control               | Dark before                         | Dark after                        | Light before                         | Light after                        |
| --------------------- | ----------------------------------- | --------------------------------- | ------------------------------------ | ---------------------------------- |
| Variable record       | [Before](before-record-dark.png)    | [After](after-record-dark.png)    | [Before](before-record-light.png)    | [After](after-record-light.png)    |
| Empty heartbeat Until | [Before](before-heartbeat-dark.png) | [After](after-heartbeat-dark.png) | [Before](before-heartbeat-light.png) | [After](after-heartbeat-light.png) |

Additional narrow record views: [Dark](after-record-narrow-dark.png), [Light](after-record-narrow-light.png). The record tests click and type, Tab from key to value, and read the saved variable schema through the API at both widths. Editable content measures 265px at normal width and 165px at narrow width, compared with the original 31.5px. The heartbeat tests also enter a malformed expression and clear it again. Edge version: 154.0.4258.53.

To refresh after screenshots, build first, then run in PowerShell:

```powershell
$env:GG_FORMS_QA_PHASE = 'after'
pnpm.cmd --filter @graphgoblin/web test:e2e forms.spec.ts
```

The normal E2E gate does not rewrite screenshots unless `GG_FORMS_QA_PHASE` is set. See [verification report](REPORT.md) for root causes, failing-first evidence, gates, and limits.

# Evidence not retained

Baseline Playwright traces referenced by tool output were not copied into this evidence folder. The command log and both page snapshots are retained.

```json
[
  {
    "path": "apps/web/test-results/stored-loop-defaults-edito-4dc81--additive-deadline-defaults-chromium/trace.zip",
    "bytes": 1144071,
    "sha256": "560a02fd10594844302e9172b2dd7940a202eff881bf4feceaefc294098f5a54",
    "kept": false,
    "reason": "Playwright-generated trace; baseline run log and text page snapshot retained instead. Normal future Playwright runs may replace ignored test-results."
  },
  {
    "path": "apps/web/test-results/stored-loop-defaults-edito-86ad3--additive-deadline-defaults-chromium/trace.zip",
    "bytes": 1144130,
    "sha256": "65b1592d3665a65d57971b39cddc751246e9170ff5f207026cd569c0984b3d12",
    "kept": false,
    "reason": "Playwright-generated trace; baseline run log and text page snapshot retained instead. Normal future Playwright runs may replace ignored test-results."
  }
]
```

## Disposable cold-reopen store

Store files remain in the specifically named temporary directory for orchestrator cleanup and are not copied into this evidence folder. File sizes and SHA-256 values are recorded in [temporary-resources.log.txt](temporary-resources.log.txt). The native run log and exact runner are retained.

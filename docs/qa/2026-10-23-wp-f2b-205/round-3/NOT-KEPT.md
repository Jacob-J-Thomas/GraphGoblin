# Captures not retained

The first cross-tab browser failure trace was 1,500,697 bytes, SHA-256 `e122335d83b545f9d7d0f9fab7588e7dadea1f2e0cdd9ccc94e4a60cb20b07c6`. It exceeded the 1,000,000-byte retention limit and was not copied from `%USERPROFILE%/source/repos/GraphGoblin/.claude/worktrees/codex-wp-f2b-205/apps/web/test-results/model-effort-open-inherite-37380--and-match-the-next-request-chromium/trace.zip`. A subsequent Playwright run may overwrite that ignored output. The failure context and extracted Settings traffic are retained as `browser-first-failure-context.log.txt` and `browser-first-settings-traffic.log.txt`.

The focus diagnostic trace at the same ignored path was 1,426,031 bytes, SHA-256 `092f71166750c9c622e2d5647aff7f9e8bcc0c2f20f9f46200ef990ad05547a5`. It was not copied because it also exceeded the limit. `browser-focus-diagnostic.log.txt` retains the observed public DOM events and page focus/visibility states.

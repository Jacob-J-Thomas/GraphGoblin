# Task temp directories left for the orchestrator

The following directories were observed after the task's failed/aborted fixture cleanup.
They have this bolt's assigned prefix. They were not manually deleted: COMMON.md prohibits
workers from deleting directories. Inspect before any cleanup; this list is not deletion
approval. Successful adapter and API lifecycles use their normal own-directory cleanup.

- `%USERPROFILE%\AppData\Local\Temp\gg-wp-f3-270-9O2W1M`
- `%USERPROFILE%\AppData\Local\Temp\gg-wp-f3-270-rWhzJ2`
- `%USERPROFILE%\AppData\Local\Temp\gg-wp-f3-270-tOQyCj`
- `%USERPROFILE%\AppData\Local\Temp\gg-wp-f3-270-tUjo9m`
- `%USERPROFILE%\AppData\Local\Temp\gg-wp-f3-270-ZcdfvA`

Generated package `coverage/`, build `dist/` and browser `test-results/` directories also
remain inside the worktree. They are build/test outputs, not source changes to commit.

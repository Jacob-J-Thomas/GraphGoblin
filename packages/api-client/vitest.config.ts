import { createVitestConfig } from '@graphgoblin/tooling/vitest';

// The contract tests boot the real API in-process, which loads libsql's native addon. It crashes or
// hangs on Windows when loaded only inside a worker thread that exits, so run in child processes,
// never `threads` or `vmThreads`. See docs/research/sqlite-libsql.md.
export default createVitestConfig({ test: { pool: 'forks' } });

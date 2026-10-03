import { createVitestConfig } from '@graphgoblin/tooling/vitest';

// libsql's native addon crashes or hangs on Windows when it is loaded only inside a worker thread
// and that thread exits, and the sqlite folder's tests load it, so this package must run in child
// processes, never `threads` or `vmThreads`. See docs/research/sqlite-libsql.md.
export default createVitestConfig({ test: { pool: 'forks' } });

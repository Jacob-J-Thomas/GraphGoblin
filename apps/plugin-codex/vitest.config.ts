import { createVitestConfig } from '@graphgoblin/tooling/vitest';

// The LIVE=1 check boots the real API in-process, which loads libsql's native addon. It crashes or
// hangs on Windows when loaded only inside a worker thread that exits, so run in child processes.
// See docs/research/sqlite-libsql.md.
export default createVitestConfig({ test: { pool: 'forks' } });

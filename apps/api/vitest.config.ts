import { createVitestConfig } from '@graphgoblin/tooling/vitest';

// libsql's native addon crashes or hangs on Windows when it is loaded only inside a worker thread
// and that thread exits, so this package must run in child processes, never `threads` or
// `vmThreads`. See docs/research/sqlite-libsql.md.
// Some tests spawn processes or generate key files and have timed out at 5 s under full-parallel
// load on the development machine, so this package allows 20 s per test and hook.
// File-backed SQLite tests collect closed native statements before removing their files on
// Windows, matching infrastructure: expose gc at worker startup rather than changing V8 flags.
export default createVitestConfig({
  test: {
    pool: 'forks',
    execArgv: ['--expose-gc'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    globalSetup: ['./wait-storage.global-setup.ts'],
  },
});

import { createVitestConfig } from '@graphgoblin/tooling/vitest';

// Expose gc at worker startup so the stream-retention test can force collection, as the
// infrastructure and API packages do, without changing V8 flags at runtime in a shared worker.
export default createVitestConfig({ test: { pool: 'forks', execArgv: ['--expose-gc'] } });

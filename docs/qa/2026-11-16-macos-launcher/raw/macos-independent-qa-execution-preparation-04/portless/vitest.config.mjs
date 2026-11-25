// External Vitest configuration for the preparation 04 portless API-contract check. It lives outside the repository
// and imports nothing; it mirrors the apps/api settings that matter here (development export condition, node
// environment, forked workers for libsql on Windows, 20 s bounds). The Vite cache goes to the OS temp directory.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

export default {
  root: here,
  cacheDir: join(tmpdir(), 'gg456-prep04-portless-vite-cache'),
  resolve: { conditions: ['development'] },
  test: {
    include: ['draft-start.portless.test.mjs'],
    globals: true,
    environment: 'node',
    pool: 'forks',
    execArgv: ['--expose-gc'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    watch: false,
  },
};

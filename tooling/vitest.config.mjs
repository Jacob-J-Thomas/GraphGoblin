import { createVitestConfig } from './vitest.shared.mjs';

export default createVitestConfig({
  test: {
    maxWorkers: 2,
    // Keep native imports and subprocess V8 ranges at the same byte offsets.
    server: {
      deps: { external: [/[/\\]tooling[/\\](?:scripts|perf)[/\\](?!.*\.test\.mjs$).*\.mjs$/] },
    },
    include: ['scripts/**/*.test.mjs', 'perf/**/*.test.mjs'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      autoAttachSubprocess: true,
      include: ['scripts/**/*.mjs', 'perf/**/*.mjs', 'vitest.shared.mjs'],
      // Acceptance files are executable test suites, not maintained runtime modules.
      exclude: ['**/*.test.mjs', '**/*.acceptance.mjs', '**/__fixtures__/**'],
    },
  },
});

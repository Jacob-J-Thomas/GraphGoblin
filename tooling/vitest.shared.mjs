import { defineConfig, mergeConfig } from 'vitest/config';

/**
 * Shared Vitest configuration for every package and app.
 *
 * Coverage thresholds are the repository policy (docs/10-testing-and-quality.md):
 * more than 90% of lines and branches in every package. They are not tunable per
 * package; raise them repo-wide or add an exclusion for generated code only.
 *
 * @param {import('vitest/config').UserConfig} [overrides]
 */
export function createVitestConfig(overrides = {}) {
  const base = defineConfig({
    test: {
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      environment: 'node',
      clearMocks: true,
      restoreMocks: true,
      coverage: {
        provider: 'v8',
        reporter: ['text-summary', 'json-summary', 'lcov'],
        reportsDirectory: './coverage',
        all: true,
        include: ['src/**/*.ts', 'src/**/*.tsx'],
        exclude: [
          'src/**/*.test.ts',
          'src/**/*.test.tsx',
          'src/**/*.d.ts',
          'src/**/__fixtures__/**',
          'src/**/generated/**',
        ],
        thresholds: {
          lines: 90,
          branches: 90,
          functions: 90,
          statements: 90,
        },
      },
    },
  });
  return mergeConfig(base, overrides);
}

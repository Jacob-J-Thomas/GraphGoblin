import react from '@vitejs/plugin-react';
import { createVitestConfig } from '@graphgoblin/tooling/vitest';

// Component tests run in jsdom with Testing Library. `main.tsx` is the browser entry and is covered
// by a test that mocks the bootstrap module; everything else is exercised through components.
// Fake-engine integration tests live in scripts so browser source never imports the engine.
export default createVitestConfig({
  plugins: [react()],
  test: {
    coverage: {
      autoAttachSubprocess: true,
      include: ['scripts/generate-icons.mjs'],
      exclude: ['scripts/**/*.test.ts'],
    },
    // Keep per-file isolation without a separate Windows process startup for every file.
    pool: 'threads',
    isolate: true,
    // Bound simultaneous jsdom/V8 work; deadlines and coverage thresholds stay configured below.
    maxWorkers: 2,
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
    setupFiles: ['src/__fixtures__/setup.ts'],
    css: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});

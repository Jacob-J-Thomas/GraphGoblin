import react from '@vitejs/plugin-react';
import { createVitestConfig } from '@graphgoblin/tooling/vitest';

// Component tests run in jsdom with Testing Library. `main.tsx` is the browser entry and is covered
// by a test that mocks the bootstrap module; everything else is exercised through components.
// Fake-engine integration tests live in scripts so browser source never imports the engine.
export default createVitestConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
    setupFiles: ['src/__fixtures__/setup.ts'],
    css: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});

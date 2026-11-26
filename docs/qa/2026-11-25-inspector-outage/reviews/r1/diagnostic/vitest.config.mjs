import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
const fixture = fileURLToPath(new URL('../../../inspector-repair/apps/web/src/__fixtures__/setup.ts', import.meta.url));
export default {
  cacheDir: './.vite-cache',
  server: { fs: { allow: [fileURLToPath(new URL('.', import.meta.url)), fileURLToPath(new URL('../../../inspector-repair/', import.meta.url))] } },
  resolve: { conditions: ['development'] },
  plugins: [react()],
  test: { include: ['*.test.ts'], setupFiles: [fixture], environment: 'jsdom', testTimeout: 20000, maxWorkers: 1, css: false },
};

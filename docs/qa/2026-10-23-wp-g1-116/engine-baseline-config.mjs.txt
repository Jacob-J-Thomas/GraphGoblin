import base from '../vitest.config.ts';
import { fileURLToPath } from 'node:url';
export default {
  ...base,
  resolve: {
    ...base.resolve,
    alias: [{ find: /^(?:\.\.?\/)+run-manager\.js$/, replacement: fileURLToPath(new URL('./run-manager.ts', import.meta.url)) }],
  },
};

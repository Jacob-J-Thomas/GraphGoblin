import { fileURLToPath } from 'node:url';
import { copyCatalog } from './catalog-package.js';
const source = process.argv[2] ?? fileURLToPath(new URL('../../templates', import.meta.url));
const target = process.argv[3] ?? fileURLToPath(new URL('../catalog', import.meta.url));
await copyCatalog(source, target);

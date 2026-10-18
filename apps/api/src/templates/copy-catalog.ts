import { fileURLToPath } from 'node:url';
import { copyCatalog } from './catalog-package.js';
const source = fileURLToPath(new URL('../../templates', import.meta.url));
const target = fileURLToPath(new URL('../catalog', import.meta.url));
await copyCatalog(source, target);

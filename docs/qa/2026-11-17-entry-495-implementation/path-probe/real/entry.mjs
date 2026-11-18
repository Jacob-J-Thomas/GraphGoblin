import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const entry = process.argv[1];
console.log(JSON.stringify({cwd: process.cwd(), entry, module: fileURLToPath(import.meta.url), entryRealPath: realpathSync.native(entry), entered: entry === fileURLToPath(import.meta.url)}));

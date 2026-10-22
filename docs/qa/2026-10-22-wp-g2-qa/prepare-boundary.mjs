import { readFile, writeFile } from 'node:fs/promises';
let source = await readFile('docs/qa/2026-10-22-wp-g2-qa/exercise.mjs', 'utf8');
source = source
  .slice(0, source.indexOf('\ntry {\n  await start();'))
  .replace("'functional.jsonl'", "'boundary-browser.jsonl'");
source = "import {readFile} from 'node:fs/promises';\n" + source;
const body = await readFile('docs/qa/2026-10-22-wp-g2-qa/boundary-body.txt', 'utf8');
await writeFile('docs/qa/2026-10-22-wp-g2-qa/boundary-browser.mjs', source + body);

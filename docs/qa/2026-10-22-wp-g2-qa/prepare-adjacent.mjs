import { readFile, writeFile } from 'node:fs/promises';
let source = await readFile('docs/qa/2026-10-22-wp-g2-qa/exercise.mjs', 'utf8');
source = source
  .slice(0, source.indexOf('\ntry {\n  await start();'))
  .replace("'functional.jsonl'", "'adjacent.jsonl'");
source = "import {readFile} from 'node:fs/promises';\n" + source;
const body = await readFile('docs/qa/2026-10-22-wp-g2-qa/adjacent-body.txt', 'utf8');
await writeFile('docs/qa/2026-10-22-wp-g2-qa/adjacent.mjs', source + body);

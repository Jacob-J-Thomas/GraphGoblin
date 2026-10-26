import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const dir = 'docs/qa/2026-10-22-wp-g2-qa';
const text = await readFile(join(dir, 'suite-infrastructure.txt'), 'utf8');
const cases = [...text.matchAll(/^\s*FAIL\s+(\S+\.test\.tsx?)\s*>\s*(.+)\r?$/gm)].map((m) => ({
  package: 'infrastructure',
  file: m[1],
  name: m[2].trim(),
}));
await writeFile(join(dir, 'triage-cases.json'), JSON.stringify(cases, null, 2));
console.log(
  JSON.stringify(
    {
      cases: cases.length,
      files: [...new Set(cases.map((x) => x.file))],
      summaries: text
        .split('\n')
        .filter((x) => /Test Files|Tests\s+\d|All files|% Coverage|EXIT:| Duration/.test(x)),
    },
    null,
    2,
  ),
);

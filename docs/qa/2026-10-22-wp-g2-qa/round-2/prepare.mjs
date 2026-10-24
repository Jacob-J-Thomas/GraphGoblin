import { readFile, writeFile } from 'node:fs/promises';
const base = 'docs/qa/2026-10-22-wp-g2-qa/';
let source = await readFile(base + 'exercise.mjs', 'utf8');
source = source
  .replace(
    'import { mkdir, writeFile, appendFile }',
    'import { mkdir, writeFile, appendFile, mkdtemp }',
  )
  .replace('import { resolve, join }', 'import { resolve, join, basename }')
  .replace(
    "out = resolve('docs/qa/2026-10-22-wp-g2-qa')",
    "out = resolve('docs/qa/2026-10-22-wp-g2-qa/round-2')",
  )
  .replace(
    "temp = join(tmpdir(), 'gg-qa-231-9896cf-independent')",
    "temp = await mkdtemp(join(tmpdir(), 'gg-qa-g2-a9df185-'))",
  )
  .replace(
    'await mkdir(data, { recursive: true });',
    "await mkdir(data, { recursive: true });\nawait writeFile(join(out, 'fixture-location.json'), JSON.stringify({ tempLeaf: basename(temp), port: 5633 }, null, 2));",
  )
  .replace("'functional.jsonl'", "'checks.log.txt'")
  .replace(
    ".split(process.env.USERPROFILE).join('<user>');",
    ".split(process.env.USERPROFILE).join('<user>').replace(/(?<![A-Za-z0-9_-])gg_[A-Za-z0-9_-]{32}(?![A-Za-z0-9_-])/g, '<generated-api-key>');",
  )
  .replace(
    "await rec({ id, steps, expected, actual: clean(e.stack), result: 'FAIL' });",
    "process.exitCode = 1;\n    await rec({ id, steps, expected, actual: clean(e.stack), result: 'FAIL' });",
  )
  .replace("'native-process.txt'", "'native-process.log.txt'");
const end = source.indexOf("\n} catch (e) {\n  await rec({ id: 'harness'");
if (end < 0) throw Error('Round-1 harness insertion point missing');
source =
  source.slice(0, end) +
  "\n  await (await import('./latest-run.mjs')).run({ page, check, api, sql, base, snap, start, stop });" +
  source.slice(end);
await writeFile(base + 'round-2/exercise.mjs', source);
await writeFile(
  base + 'round-2/browser-cases.mjs',
  await readFile(base + 'browser-cases.mjs', 'utf8'),
);
console.log('Prepared round-2 copies; original round-1 scripts unchanged.');

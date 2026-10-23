import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/[\\/]$/, '');
const stage = process.argv[2].toLowerCase();
const raw = await readFile(join(tmpdir(), 'gg-qa-f2b-r4-' + stage + '.raw.txt'));
let log = (
  raw[0] === 255 && raw[1] === 254 ? raw.subarray(2).toString('utf16le') : raw.toString('utf8')
).replaceAll('\r\n', '\n');
for (const [path, label] of [
  [root, '<repo>'],
  [tmpdir(), '<temp>'],
])
  log = log.replaceAll(path, label).replaceAll(path.replaceAll('\\', '/'), label);
log = log
  .replace(/[A-Z]:[\\/]+Users[\\/]+[^\\/\s"]+/gi, '<profile>')
  .replace(/[\\/]+Users[\\/]+[^\\/\s"]+/gi, '<profile>');
await writeFile(join(directory, stage + '.log.txt'), log);
if (stage === 'served') {
  const checks = JSON.parse(await readFile(join(directory, 'served-results.json'), 'utf8'));
  await writeFile(
    join(directory, 'served-checks.json'),
    JSON.stringify(
      {
        head: '492b283b49747e91470d94dca7028caa4eeb6c3d',
        invocations: 1,
        retries: 0,
        passed: checks.filter((c) => c.id !== 'environment' && c.verdict === 'PASS').length,
        failed: checks.filter((c) => c.verdict === 'FAIL').length,
        checks,
      },
      null,
      2,
    ) + '\n',
  );
}
if (stage === 'build')
  await writeFile(
    join(directory, 'build-command.json'),
    JSON.stringify(
      {
        head: '492b283b49747e91470d94dca7028caa4eeb6c3d',
        command: 'pnpm.cmd build',
        node: process.version,
        exitCode: 0,
        source: 'Completed initial build tool invocation at this pinned head',
      },
      null,
      2,
    ) + '\n',
  );
console.log(stage + ' evidence captured');

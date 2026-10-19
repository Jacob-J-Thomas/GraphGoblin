// After pnpm build: collect no-turn evidence through package-owned component drivers.
import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const reports = [];
for (const name of ['infrastructure', 'adapter-codex']) {
  const result = await execute(
    process.execPath,
    [resolve(root, 'packages', name, 'scripts/readiness-native.mjs')],
    { windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 },
  );
  if (result.stderr.trim())
    throw new Error('Native collector returned stderr; evidence is invalid');
  reports.push(JSON.parse(result.stdout));
}
process.stdout.write(
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      node: process.version,
      snapshotSource: reports[0].snapshotSource,
      directories: reports.map((item) => item.directory),
      claude: reports[0].claude,
      codex: reports[1].codex,
      codexCli: reports[1].codexCli,
      codexProbeCancellation: reports[1].codexProbeCancellation,
      lifetime: reports.flatMap((item) => item.lifetime),
    },
    null,
    2,
  ) + '\n',
);

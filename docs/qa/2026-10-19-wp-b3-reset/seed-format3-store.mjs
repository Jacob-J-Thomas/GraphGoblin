// QA tooling for the #266 refusal and reset checks, not product code: nothing in the build,
// the tests or the gates imports it. It seeds a disposable data directory with an unsupported
// (format-3) store holding one run, its artifacts and run workspace, a user directory under
// workspaces/, a master key, and a run-workspace link to an outside "repository" that the reset
// must leave intact. Point it only at disposable directories, never at a real data directory.
//
// Usage, after `pnpm build` in the checkout:
//   node docs/qa/2026-10-19-wp-b3-reset/seed-format3-store.mjs <checkout> <data-dir> <outside-dir>
import { Buffer } from 'node:buffer';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const [checkout, dataDirArgument, outsideArgument] = process.argv.slice(2);
if (!checkout || !dataDirArgument || !outsideArgument)
  throw new Error('usage: seed-format3-store.mjs <checkout> <data-dir> <outside-dir>');
const dataDir = resolve(dataDirArgument);
const outside = resolve(outsideArgument);
const { openDatabase } = await import(
  pathToFileURL(resolve(checkout, 'packages', 'infrastructure', 'dist', 'sqlite', 'index.js')).href
);

const run = '01JQA266RUNAAAAAAAAAAAAAAA';
await mkdir(dataDir, { recursive: true });
const handle = openDatabase({ url: pathToFileURL(join(dataDir, 'graphgoblin.db')).href });
await handle.migrate();
await handle.client.execute({
  sql: 'INSERT INTO runs (id, owner_id, loop_id, version_id, invocation_id, status, iteration, created_at, initial_thread) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  args: [
    run,
    'local',
    'loop',
    'version',
    'invocation',
    'succeeded',
    1,
    '2026-10-18T00:00:00.000Z',
    '{}',
  ],
});
// A complete format-4 store, then its marker rewritten to format 3: exactly what this build refuses.
await handle.client.execute('UPDATE gg_upgrade_state SET format_version = 3');

await mkdir(join(dataDir, 'artifacts', 'text'), { recursive: true });
await writeFile(join(dataDir, 'artifacts', 'text', 'abc123'), 'artifact body');
await mkdir(join(dataDir, 'workspaces', run, 'src'), { recursive: true });
await writeFile(join(dataDir, 'workspaces', run, 'src', 'out.txt'), 'run output');
await mkdir(join(dataDir, 'workspaces', 'my-notes'), { recursive: true });
await writeFile(join(dataDir, 'workspaces', 'my-notes', 'keep.txt'), 'user directory');
await writeFile(join(dataDir, 'master.key'), Buffer.alloc(32, 9).toString('base64'));
await mkdir(join(outside, 'src'), { recursive: true });
await writeFile(join(outside, 'src', 'precious.txt'), 'must survive the reset');
await symlink(
  outside,
  join(dataDir, 'workspaces', run, 'repo'),
  process.platform === 'win32' ? 'junction' : 'dir',
);
// libsql keeps the database open until exit; exit once the line is written.
process.stdout.write(`seeded a format-3 store in ${dataDir}\n`, () => process.exit(0));

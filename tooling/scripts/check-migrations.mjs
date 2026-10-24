#!/usr/bin/env node
/** Generate against a disposable copy; shipped SQL/journal/snapshots are never mutated. */
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const infrastructure = resolve(import.meta.dirname, '../../packages/infrastructure');
const require = createRequire(join(infrastructure, 'package.json'));

/**
 * drizzle-kit numbers the next migration from the last journal index and diffs against the
 * lexically latest snapshot; the migrator skips an entry older than the newest applied one.
 * So every entry's index must equal its position and its tag number, timestamps must rise,
 * and the snapshots that exist (data-only migrations may have none) must chain by prevId.
 */
export async function checkJournal(folder = join(infrastructure, 'drizzle')) {
  const problems = [];
  const { entries } = JSON.parse(await readFile(join(folder, 'meta/_journal.json'), 'utf8'));
  const sql = new Set((await readdir(folder)).filter((name) => name.endsWith('.sql')));
  entries.forEach((entry, position) => {
    const number = Number(/^(\d{4})_/.exec(entry.tag)?.[1]);
    if (entry.idx !== position || number !== position)
      problems.push(`${entry.tag}: index ${entry.idx} at position ${position}`);
    if (!sql.delete(`${entry.tag}.sql`)) problems.push(`${entry.tag}: no SQL file`);
    if (position > 0 && !(entry.when > entries[position - 1].when))
      problems.push(`${entry.tag}: timestamp not after ${entries[position - 1].tag}`);
  });
  for (const name of sql) problems.push(`${name}: not in the journal`);
  const snapshots = (await readdir(join(folder, 'meta')))
    .filter((name) => /^\d{4}_snapshot\.json$/.test(name))
    .sort();
  let previous = '00000000-0000-0000-0000-000000000000';
  for (const name of snapshots) {
    if (Number(name.slice(0, 4)) >= entries.length) problems.push(`${name}: no journal entry`);
    const snapshot = JSON.parse(await readFile(join(folder, 'meta', name), 'utf8'));
    if (snapshot.prevId !== previous) problems.push(`${name}: prevId does not chain`);
    previous = snapshot.id;
  }
  if (problems.length)
    throw new Error('Migration journal is inconsistent:\n  ' + problems.join('\n  '));
}

export async function checkMigrations(schema = join(infrastructure, 'src/sqlite/schema.ts')) {
  await checkJournal();
  const directory = await mkdtemp(join(tmpdir(), 'gg-check-migrations-'));
  try {
    const out = join(directory, 'drizzle');
    await cp(join(infrastructure, 'drizzle'), out, { recursive: true });
    const before = new Set(await readdir(out));
    const config = join(directory, 'drizzle.config.cjs');
    await writeFile(
      config,
      'module.exports = ' +
        JSON.stringify({
          dialect: 'sqlite',
          schema: schema.replaceAll('\\', '/'),
          out: './drizzle',
          strict: true,
        }) +
        ';\n',
    );
    const generated = spawnSync(
      process.execPath,
      [
        join(dirname(require.resolve('drizzle-kit/api')), 'bin.cjs'),
        'generate',
        '--config',
        config,
      ],
      {
        cwd: directory,
        encoding: 'utf8',
        timeout: 60_000,
        input: '',
      },
    );
    if (generated.error) throw generated.error;
    if (generated.status !== 0)
      throw new Error('drizzle-kit generate failed:\n' + generated.stdout + generated.stderr);
    const migrations = (await readdir(out)).filter(
      (name) => name.endsWith('.sql') && !before.has(name),
    );
    if (migrations.length)
      throw new Error(
        'Schema/snapshot drift: drizzle-kit would write ' +
          migrations.join(', ') +
          '. Regenerate the migration and its snapshot together.',
      );
    if (!generated.stdout.includes('No schema changes, nothing to migrate'))
      throw new Error(
        'drizzle-kit did not confirm a no-op:\n' + generated.stdout + generated.stderr,
      );
    return 'Drizzle generation is a no-op.';
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(await checkMigrations());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

#!/usr/bin/env node
/** Generate against a disposable copy; shipped SQL/journal/snapshots are never mutated. */
import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const infrastructure = resolve(import.meta.dirname, '../../packages/infrastructure');
const require = createRequire(join(infrastructure, 'package.json'));
export async function checkMigrations(schema = join(infrastructure, 'src/sqlite/schema.ts')) {
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

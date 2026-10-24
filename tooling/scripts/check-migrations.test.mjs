import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { cp, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkJournal, checkMigrations } from './check-migrations.mjs';

const infrastructure = resolve(import.meta.dirname, '../../packages/infrastructure');
const require = createRequire(join(infrastructure, 'package.json'));
async function migrationHashes() {
  const folder = join(infrastructure, 'drizzle');
  const files = [
    ...(await readdir(folder)).filter((name) => name.endsWith('.sql')),
    ...(await readdir(join(folder, 'meta'))).map((name) => 'meta/' + name),
  ];
  return Promise.all(
    files.sort().map(async (name) => [
      name,
      createHash('sha256')
        .update(await readFile(join(folder, name)))
        .digest('hex'),
    ]),
  );
}
test('migration gate confirms no-op generation and leaves shipped migrations untouched', async () => {
  const before = await migrationHashes();
  assert.match(await checkMigrations(), /no-op/);
  assert.deepEqual(await migrationHashes(), before);
});
test('migration gate rejects a journal that would renumber, skip or misdiff migrations', async () => {
  await checkJournal();
  const cases = [
    // A tag numbered ahead of its index makes the next generation repeat its number.
    async (folder, journal) => {
      const last = journal.entries.at(-1);
      const tag = last.tag.replace(/^\d{4}/, String(last.idx + 1).padStart(4, '0'));
      await rename(join(folder, `${last.tag}.sql`), join(folder, `${tag}.sql`));
      last.tag = tag;
      return /index \d+ at position/;
    },
    // An older timestamp is skipped on stores that already applied a later migration.
    async (_folder, journal) => {
      journal.entries.at(-1).when = journal.entries.at(-2).when;
      return /timestamp not after/;
    },
    // A future timestamp sorts after the next migration drizzle-kit generates with the clock.
    async (_folder, journal) => {
      journal.entries.at(-1).when = Date.now() + 86_400_000;
      return /timestamp in the future/;
    },
    async (folder) => {
      const name = (await readdir(join(folder, 'meta'))).filter((n) =>
        n.endsWith('_snapshot.json'),
      );
      const path = join(folder, 'meta', name.sort().at(-1));
      const snapshot = JSON.parse(await readFile(path, 'utf8'));
      await writeFile(path, JSON.stringify({ ...snapshot, prevId: snapshot.id }));
      return /prevId does not chain/;
    },
    async (folder) => {
      await writeFile(join(folder, '9999_stray.sql'), '');
      return /not in the journal/;
    },
  ];
  for (const breakIt of cases) {
    const directory = await mkdtemp(join(tmpdir(), 'gg-migration-journal-test-'));
    try {
      await cp(join(infrastructure, 'drizzle'), directory, { recursive: true });
      const path = join(directory, 'meta/_journal.json');
      const journal = JSON.parse(await readFile(path, 'utf8'));
      const expected = await breakIt(directory, journal);
      await writeFile(path, JSON.stringify(journal));
      await assert.rejects(checkJournal(directory), expected);
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
});
test('migration gate rejects an additive schema change without writing shipped migrations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gg-migration-gate-test-'));
  const before = await migrationHashes();
  try {
    let source = await readFile(join(infrastructure, 'src/sqlite/schema.ts'), 'utf8');
    for (const dependency of ['drizzle-orm/sqlite-core', 'drizzle-orm'])
      source = source.replaceAll(
        "from '" + dependency + "'",
        "from '" + require.resolve(dependency).replaceAll('\\', '/') + "'",
      );
    source = source.replace(
      "name: text('name').notNull(),",
      "name: text('name').notNull(), migrationGateProbe: text('migration_gate_probe'),",
    );
    const schema = join(directory, 'schema.ts');
    await writeFile(schema, source);
    await assert.rejects(checkMigrations(schema), /Schema\/snapshot drift/);
    assert.deepEqual(await migrationHashes(), before);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

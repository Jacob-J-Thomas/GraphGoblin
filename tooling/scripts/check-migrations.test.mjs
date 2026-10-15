import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkMigrations } from './check-migrations.mjs';

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

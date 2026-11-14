// Direct store tier (separate from the UI/API evidence): read the closed native gateway's file
// SQLite read-only and compare the Starter loop's version and run rows with what the API returned.
//   node store-readback.mjs <checkoutRoot> <dbFile> <evidenceDir>
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const [root, dbFile, evidence] = process.argv.slice(2);
const require = createRequire(join(root, 'packages', 'infrastructure', 'package.json'));
const { createClient } = require('@libsql/client');
const observed = JSON.parse(await readFile(join(evidence, 'native-observed-1.json'), 'utf8'));
const starter = observed.scenarios['N1-N2 Starter assistant to writer on file SQLite'];
const loopId = starter.loopId;
const before = await readFile(dbFile);
const client = createClient({ url: `file:${dbFile}` });
const versions = (
  await client.execute({
    sql: 'select id, version, status, definition, published_at from loop_versions where loop_id = ? order by version',
    args: [loopId],
  })
).rows.map((r) => ({ ...r, definition: JSON.parse(String(r.definition)) }));
const runs = (
  await client.execute({ sql: 'select id, version_id, status from runs where loop_id = ? order by id', args: [loopId] })
).rows.map((r) => ({ ...r }));
client.close();
const after = await readFile(dbFile);
const digest = (b) => createHash('sha256').update(b).digest('hex');
const v1 = versions.find((v) => v.version === 1);
const v2 = versions.find((v) => v.version === 2);
const result = {
  tier: 'direct store read (not UI or API evidence)',
  dbFile,
  dbSha256BeforeRead: digest(before),
  dbSha256AfterRead: digest(after),
  readDidNotModifyFile: digest(before) === digest(after),
  loopId,
  versions: versions.map((v) => ({ id: v.id, version: v.version, status: v.status, publishedAt: v.published_at, definitionSha256: digest(JSON.stringify(v.definition)), exitReturns: v.definition.nodes.find((n) => n.kind === 'exit')?.config?.returns, ids: v.definition.nodes.map((n) => n.id) })),
  runs,
  checks: {
    v1RowEqualsApiV1: isDeepStrictEqual(v1?.definition, starter.v1.definition),
    v2RowEqualsApiV2: isDeepStrictEqual(v2?.definition, starter.checks.v2Definition),
    v1ReadsAssistant: v1?.definition.nodes.some((n) => n.id === 'assistant'),
    v2ReadsWriter: v2?.definition.nodes.some((n) => n.id === 'writer'),
    threeSucceededRuns: runs.length === 3 && runs.every((r) => r.status === 'succeeded'),
    runsPinned: runs.filter((r) => r.version_id === v1?.id).length === 2 && runs.filter((r) => r.version_id === v2?.id).length === 1,
  },
};
await writeFile(join(evidence, 'store-readback.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result.checks), 'unmodified', result.readDidNotModifyFile);
